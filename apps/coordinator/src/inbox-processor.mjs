import { randomUUID } from "node:crypto";
import { readInbox, inspectIssue } from "./inbox-reader.mjs";
import { inspectReadiness } from "./readiness.mjs";
import { decideTicket, policyVersion } from "./inbox-policy.mjs";
import { appendDecision, createJournal, digest, receiptHash } from "./inbox-journal.mjs";
import { assignSubmitter, comments, desiredLabels, ensureLabels, labelNames, managedLabels,
  response, statusComment, terminal, ticketTitle } from "./ticket-presentation.mjs";

const latest = ticket => ticket?.transitions.at(-1);
const isNumber = value => Number.isSafeInteger(value) && value > 0;

function commentIdentity(entry, actor) {
  const initial = entry.status === "valid" ? entry.workflow?.presentation : null;
  if (initial && /^[0-9a-f-]{36}$/u.test(initial.marker) && /^[1-9][0-9]*$/u.test(initial.author_id)
    && (initial.comment_id === null || isNumber(initial.comment_id))) {
    return { marker: initial.marker, id: initial.comment_id, author_id: initial.author_id };
  }
  return { marker: randomUUID(), id: null, author_id: actor.id };
}

function overlapping(entry, entries) {
  if (entry.status !== "valid") return [];
  const keys = new Set(entry.request.release_parts.flatMap(part => part.pull_requests.map(pr => `${part.repository}#${pr.number}`)));
  return entries.filter(other => other.issue_number !== entry.issue_number && other.status === "valid"
    && other.request.target === entry.request.target && other.request.release_parts.some(part =>
      part.pull_requests.some(pr => keys.has(`${part.repository}#${pr.number}`)))).map(other => other.issue_number).sort((a, b) => a - b);
}

async function applyTicket({ api, journal, state, run, ticket, number, actor, verifyClosure }) {
  const writeApi = async call => {
    if (call.method !== "GET") await journal.guard(run);
    return api(call);
  };
  const issue = await response(api, "GET", `/issues/${number}`);
  if (receiptHash(issue) !== ticket.receipt_hash) throw new Error(`Issue #${number}'s saved receipt changed; manual investigation is required.`);
  const record = latest(ticket), decision = record.decision;
  const request = ticket.request;
  const labels = desiredLabels(issue, decision, request);
  await ensureLabels(writeApi, labels);
  const additions = labels.filter(label => managedLabels.has(label) && !labelNames(issue).includes(label));
  if (additions.length) await response(writeApi, "POST", `/issues/${number}/labels`, { labels: additions });
  for (const name of labelNames(issue).filter(label => managedLabels.has(label) && !labels.includes(label))) {
    const removed = await writeApi({ method: "DELETE", path: `/issues/${number}/labels/${encodeURIComponent(name)}` });
    if (![200, 404].includes(removed.status)) throw new Error(`Could not remove resolved label ${name}.`);
  }
  const assignment = await assignSubmitter(writeApi, issue, ticket.submitter);
  const list = await comments(api, number);
  const marker = `<!-- 6529-coordinator-status:${ticket.comment.marker} -->`;
  const matches = list.filter(comment => String(comment.user?.id) === ticket.comment.author_id && comment.body?.startsWith(`${marker}\n`));
  if (matches.length > 1) throw new Error(`Issue #${number} has ambiguous Coordinator comments; no comment was guessed.`);
  let comment = ticket.comment.id ? list.find(value => value.id === ticket.comment.id) : matches[0];
  if (ticket.comment.id && (!comment || String(comment.user?.id) !== ticket.comment.author_id || !comment.body?.startsWith(`${marker}\n`))) {
    throw new Error(`Issue #${number}'s recorded status comment was removed or changed; manual investigation is required.`);
  }
  if (comment && !ticket.comment.id) {
    ticket.comment.id = comment.id;
    await journal.save(state, run, `recover comment for #${number}`);
  }
  // If intake's uncertain POST never created a comment, this writer becomes
  // its author. Persist the identity BEFORE POST so a lost response is safe.
  if (!comment && ticket.comment.author_id !== actor.id) {
    ticket.comment.author_id = actor.id;
    await journal.save(state, run, `adopt missing comment for #${number}`);
  }
  const body = statusComment({ decision, actor: record.actor, at: record.at, submitter: ticket.submitter,
    request, number, marker: ticket.comment.marker, assignment });
  if (!comment) {
    comment = await response(writeApi, "POST", `/issues/${number}/comments`, { body }, 201);
    if (!isNumber(comment.id) || String(comment.user?.id) !== ticket.comment.author_id) throw new Error("GitHub returned an unexpected comment identity.");
    ticket.comment.id = comment.id;
    await journal.save(state, run, `save comment identity for #${number}`);
  } else if (comment.body !== body) await response(writeApi, "PATCH", `/issues/comments/${comment.id}`, { body });

  const patch = {};
  if (request && issue.title !== ticketTitle(request)) patch.title = ticketTitle(request);
  const expectedState = terminal(decision) ? "closed" : "open";
  // Never reopen an unrecorded/manual closure as a side effect of inspection.
  if (issue.state !== expectedState) {
    if (expectedState === "open") throw new Error(`Issue #${number} was closed outside recorded history; its outcome needs investigation.`);
    await verifyClosure();
    patch.state = "closed";
    patch.state_reason = decision.status === "completed" ? "completed" : "not_planned";
  }
  if (Object.keys(patch).length) await response(writeApi, "PATCH", `/issues/${number}`, patch);
  const finalIssue = await response(api, "GET", `/issues/${number}`);
  const finalComments = await comments(api, number);
  const finalManaged = labelNames(finalIssue).filter(label => managedLabels.has(label)).sort();
  const expectedManaged = labels.filter(label => managedLabels.has(label)).sort();
  if (receiptHash(finalIssue) !== ticket.receipt_hash || finalIssue.state !== expectedState
    || request && finalIssue.title !== ticketTitle(request)
    || digest(finalManaged) !== digest(expectedManaged)
    || finalComments.find(value => value.id === ticket.comment.id)?.body !== body
    || assignment === "assigned" && !finalIssue.assignees?.some(user => String(user.id) === ticket.submitter.id)) {
    throw new Error(`Issue #${number}'s applied presentation could not be verified.`);
  }
  if (ticket.applied !== record.id || ticket.assignment !== assignment) {
    ticket.applied = record.id; ticket.assignment = assignment; delete ticket.application_error;
    await journal.save(state, run, `verified #${number} ${decision.status}`);
  }
  return { issue_number: number, status: decision.status, reasons: [...new Set(decision.reasons.map(reason => reason.code))],
    applied: true, transition_id: record.id, assignment, comment_id: ticket.comment.id };
}

export async function processInbox({ api, identity, get, github, issueNumber, closeTest = false, resume,
  now = () => new Date(), journal = createJournal(api), loadInbox = readInbox, inspect = inspectIssue, observe = inspectReadiness }) {
  if (issueNumber !== undefined && !isNumber(issueNumber)) throw new Error("Issue number must be a positive integer.");
  if (closeTest && !issueNumber) throw new Error("Test closure requires one explicit Issue number.");
  const actor = await identity();
  const scope = resume && issueNumber === undefined && !closeTest ? undefined : { issue_number: issueNumber ?? null, close_test: closeTest };
  const { state, run } = await journal.acquire(actor, resume, scope);
  issueNumber = run.scope.issue_number ?? undefined;
  closeTest = run.scope.close_test;
  const results = [];
  let pendingNumber = null;
  try {
    // Complete the listing/proof pass before considering any Issue writes.
    const inbox = await loadInbox({ get, now });
    const numbers = issueNumber ? [issueNumber] : [...new Set([...inbox.requests.map(entry => entry.issue_number), ...Object.keys(state.tickets).map(Number)])].sort((a, b) => a - b);
    const entries = new Map();
    const issues = new Map();
    for (const number of numbers) {
      const issue = await response(api, "GET", `/issues/${number}`);
      if (!isNumber(issue.id) || issue.number !== number || issue.pull_request || !["open", "closed"].includes(issue.state) || !Array.isArray(issue.labels)) throw new Error(`Invalid Issue #${number}.`);
      if (!state.tickets[number] && !labelNames(issue).includes("release-request")) throw new Error(`Issue #${number} is not a release request.`);
      issues.set(number, issue);
      entries.set(number, await inspect(issue, { get }));
    }
    const all = new Map(inbox.requests.map(entry => [entry.issue_number, entry]));
    for (const [number, entry] of entries) all.set(number, entry);
    // A second, scoped read must not erase duplicate-request evidence found by
    // the full reader; include journal identities even after label removal.
    const counts = new Map();
    for (const entry of all.values()) if (entry.request) counts.set(entry.request.request_id, (counts.get(entry.request.request_id) ?? 0) + 1);
    for (const entry of entries.values()) if (entry.request && counts.get(entry.request.request_id) > 1) {
      entry.status = "invalid"; entry.github_actor = null; entry.errors.push("This request ID appears in multiple Issues; maintainers must resolve the identity conflict.");
    }
    for (const number of numbers) {
      const issue = issues.get(number), entry = entries.get(number);
      let ticket = state.tickets[number];
      if (entry.intake_in_progress) {
        results.push({ issue_number: number, applied: false, status: "intake-running", message: "Submission workflow is still setting up this ticket; run processing after it finishes." });
        continue;
      }
      if (ticket && receiptHash(issue) !== ticket.receipt_hash) throw new Error(`Issue #${number}'s receipt differs from recorded history.`);
      const recordedTerminal = ticket && terminal(latest(ticket).decision) && ticket.applied === latest(ticket).id;
      const pendingTerminal = ticket && terminal(latest(ticket).decision);
      if (!pendingTerminal && issue.state === "closed") {
        results.push({ issue_number: number, applied: false, status: "unverified-closure", message: "Already closed without an applied terminal decision; left unchanged." });
        continue;
      }
      if (closeTest && (entry.status !== "valid" || entry.github_actor?.id !== actor.id)) throw new Error("Test closure is limited to the authenticated operator's verified request.");
      if (!recordedTerminal) {
        const observation = await observe(entry, { github });
        const decision = decideTicket(entry, observation, { overlaps: overlapping(entry, [...all.values()].filter(value => issues.get(value.issue_number)?.state !== "closed")), closeTest });
        // Reverify immutable intake before the journaled intent. Readiness itself
        // rereads PR metadata after all catalog/check observations.
        const refreshed = await response(api, "GET", `/issues/${number}`);
        if (receiptHash(refreshed) !== receiptHash(issue) || refreshed.state !== issue.state) throw new Error(`Issue #${number} changed during inspection; rerun after investigation.`);
        if (!ticket) {
          ticket = { issue_id: issue.id, receipt_hash: receiptHash(issue), request: null, submitter: null, workflow: null,
            comment: commentIdentity(entry, actor), transitions: [], applied: null, assignment: null };
          state.tickets[number] = ticket;
        }
        const trusted = entry.status === "valid";
        const bindingChanged = trusted && (digest(ticket.request) !== digest(entry.request)
          || digest(ticket.submitter) !== digest(entry.github_actor) || digest(ticket.workflow) !== digest(entry.workflow));
        if (trusted) { ticket.request = entry.request; ticket.submitter = entry.github_actor; ticket.workflow = entry.workflow; }
        if (bindingChanged || !latest(ticket) || digest(latest(ticket).decision) !== digest(decision)) {
          appendDecision(ticket, { at: now().toISOString(), actor, run_id: run.run_id, policy_version: policyVersion,
            decision, observation, previous_status: latest(ticket)?.decision.status ?? null,
            receipt_hash: ticket.receipt_hash, request: ticket.request, submitter: ticket.submitter, workflow: ticket.workflow });
          pendingNumber = number;
          await journal.save(state, run, `decide #${number} ${decision.status}`);
        }
      }
      pendingNumber = number;
      results.push(await applyTicket({ api, journal, state, run, ticket, number, actor, verifyClosure: async () => {
        if (recordedTerminal || closeTest) return;
        const freshIssue = await response(api, "GET", `/issues/${number}`);
        if (receiptHash(freshIssue) !== ticket.receipt_hash) throw new Error("Receipt changed before closure.");
        const freshEntry = await inspect(freshIssue, { get });
        const freshObservation = await observe(freshEntry, { github });
        const fresh = decideTicket(freshEntry, freshObservation);
        if (fresh.status !== "closed" || digest(fresh.reasons) !== digest(latest(ticket).decision.reasons)) throw new Error("PR evidence changed before closure; the intended decision was not applied.");
      } }));
      pendingNumber = null;
    }
    await journal.release(state, run);
    return { mode: "write", run_id: run.run_id, checked_at: now().toISOString(), release_authorized: false, requests: results };
  } catch (error) {
    // Retain the lock on failure, even on an uncertain API response. Recovery
    // is explicit, after the prior process has stopped; it never uses a timer.
    if (pendingNumber && state.tickets[pendingNumber]) {
      state.tickets[pendingNumber].application_error = { at: now().toISOString(), message: error.message };
      try { await journal.save(state, run, `partial update #${pendingNumber}`); } catch { /* ownership may have changed */ }
    }
    throw new Error(`${error.message} Run ${run.run_id} remains locked. After this process has stopped, resume with --resume ${run.run_id}.`, { cause: error });
  }
}
