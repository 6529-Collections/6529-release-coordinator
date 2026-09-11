import { randomUUID } from "node:crypto";
import { loggedStep } from "./run-log.mjs";
import { decideTicket, policyVersion } from "./inbox-policy.mjs";
import { runPolicyVersion } from "./inbox-rehearsal.mjs";
import { appendDecision, digest, receiptHash } from "./inbox-journal.mjs";
import {
  assignSubmitter,
  comments,
  desiredLabels,
  ensureLabels,
  labelNames,
  managedLabels,
  response,
  statusComment,
  terminal,
  ticketTitle
} from "./ticket-presentation.mjs";
const latest = (ticket) => ticket?.transitions.at(-1);
const isNumber = (value) => Number.isSafeInteger(value) && value > 0;

function commentIdentity(entry, actor) {
  const initial =
    entry.status === "valid" ? entry.workflow?.presentation : null;
  if (
    initial &&
    /^[0-9a-f-]{36}$/u.test(initial.marker) &&
    /^[1-9][0-9]*$/u.test(initial.author_id) &&
    (initial.comment_id === null || isNumber(initial.comment_id))
  ) {
    return {
      marker: initial.marker,
      id: initial.comment_id,
      author_id: initial.author_id
    };
  }
  return { marker: randomUUID(), id: null, author_id: actor.id };
}

async function applyTicket({
  api,
  journal,
  state,
  run,
  ticket,
  number,
  actor,
  verifyClosure,
  signal
}) {
  const writeApi = async (call) => {
    signal?.throwIfAborted();
    if (call.method !== "GET") await journal.guard(run);
    return api(call);
  };
  const issue = await response(api, "GET", `/issues/${number}`);
  if (receiptHash(issue) !== ticket.receipt_hash)
    throw new Error(
      `Issue #${number}'s saved receipt changed; manual investigation is required.`
    );
  const record = latest(ticket),
    decision = record.decision;
  const request = ticket.request;
  const labels = desiredLabels(issue, decision, request);
  await ensureLabels(writeApi, labels);
  const additions = labels.filter(
    (label) => managedLabels.has(label) && !labelNames(issue).includes(label)
  );
  if (additions.length)
    await response(writeApi, "POST", `/issues/${number}/labels`, {
      labels: additions
    });
  for (const name of labelNames(issue).filter(
    (label) => managedLabels.has(label) && !labels.includes(label)
  )) {
    const removed = await writeApi({
      method: "DELETE",
      path: `/issues/${number}/labels/${encodeURIComponent(name)}`
    });
    if (![200, 404].includes(removed.status))
      throw new Error(`Could not remove resolved label ${name}.`);
  }
  const assignment = await assignSubmitter(writeApi, issue, ticket.submitter);
  const list = await comments(api, number);
  const marker = `<!-- 6529-coordinator-status:${ticket.comment.marker} -->`;
  const matches = list.filter(
    (comment) =>
      String(comment.user?.id) === ticket.comment.author_id &&
      comment.body?.startsWith(`${marker}\n`)
  );
  if (matches.length > 1)
    throw new Error(
      `Issue #${number} has ambiguous Coordinator comments; no comment was guessed.`
    );
  let comment = ticket.comment.id
    ? list.find((value) => value.id === ticket.comment.id)
    : matches[0];
  if (
    ticket.comment.id &&
    (!comment ||
      String(comment.user?.id) !== ticket.comment.author_id ||
      !comment.body?.startsWith(`${marker}\n`))
  ) {
    throw new Error(
      `Issue #${number}'s recorded status comment was removed or changed; manual investigation is required.`
    );
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
  const body = statusComment({
    decision,
    actor: record.actor,
    at: record.at,
    submitter: ticket.submitter,
    request,
    number,
    marker: ticket.comment.marker,
    assignment
  });
  if (!comment) {
    comment = await response(
      writeApi,
      "POST",
      `/issues/${number}/comments`,
      { body },
      201
    );
    if (
      !isNumber(comment.id) ||
      String(comment.user?.id) !== ticket.comment.author_id
    )
      throw new Error("GitHub returned an unexpected comment identity.");
    ticket.comment.id = comment.id;
    await journal.save(state, run, `save comment identity for #${number}`);
  } else if (comment.body !== body)
    await response(writeApi, "PATCH", `/issues/comments/${comment.id}`, {
      body
    });

  const patch = {};
  if (request && issue.title !== ticketTitle(request))
    patch.title = ticketTitle(request);
  const expectedState = terminal(decision) ? "closed" : "open";
  // Never reopen an unrecorded/manual closure as a side effect of inspection.
  if (issue.state !== expectedState) {
    if (expectedState === "open")
      throw new Error(
        `Issue #${number} was closed outside recorded history; its outcome needs investigation.`
      );
    await verifyClosure();
    patch.state = "closed";
    patch.state_reason =
      decision.status === "completed" ? "completed" : "not_planned";
  }
  if (Object.keys(patch).length)
    await response(writeApi, "PATCH", `/issues/${number}`, patch);
  const finalIssue = await response(api, "GET", `/issues/${number}`);
  const finalComments = await comments(api, number);
  const finalManaged = labelNames(finalIssue)
    .filter((label) => managedLabels.has(label))
    .sort();
  const expectedManaged = labels
    .filter((label) => managedLabels.has(label))
    .sort();
  if (
    receiptHash(finalIssue) !== ticket.receipt_hash ||
    finalIssue.state !== expectedState ||
    (request && finalIssue.title !== ticketTitle(request)) ||
    digest(finalManaged) !== digest(expectedManaged) ||
    finalComments.find((value) => value.id === ticket.comment.id)?.body !==
      body ||
    (assignment === "assigned" &&
      !finalIssue.assignees?.some(
        (user) => String(user.id) === ticket.submitter.id
      ))
  ) {
    throw new Error(
      `Issue #${number}'s applied presentation could not be verified.`
    );
  }
  if (ticket.applied !== record.id || ticket.assignment !== assignment) {
    ticket.applied = record.id;
    ticket.assignment = assignment;
    delete ticket.application_error;
    await journal.save(state, run, `verified #${number} ${decision.status}`);
  }
  return {
    issue_number: number,
    status: decision.status,
    reasons: [...new Set(decision.reasons.map((reason) => reason.code))],
    applied: true,
    transition_id: record.id,
    assignment,
    comment_id: ticket.comment.id
  };
}

export async function presentRunTicket(
  item,
  {
    api,
    journal,
    state,
    run,
    actor,
    signal,
    now,
    rehearsal,
    closeTest,
    inspect,
    get,
    profile,
    observe,
    github
  }
) {
  const {
    number,
    issue,
    entry,
    recordedTerminal,
    observation,
    decision,
    rehearsalResult,
    serviceResult
  } = item;
  let { ticket } = item;
  if (!recordedTerminal) {
    // Reverify immutable intake before the journaled intent. Readiness itself
    // rereads PR metadata after all catalog/check observations.
    const refreshed = await response(api, "GET", `/issues/${number}`);
    if (
      receiptHash(refreshed) !== receiptHash(issue) ||
      refreshed.state !== issue.state
    )
      throw new Error(
        `Issue #${number} changed during inspection; rerun after investigation.`
      );
    if (!ticket) {
      ticket = {
        issue_id: issue.id,
        receipt_hash: receiptHash(issue),
        request: null,
        submitter: null,
        workflow: null,
        comment: commentIdentity(entry, actor),
        transitions: [],
        applied: null,
        assignment: null
      };
      state.tickets[number] = ticket;
    }
    const trusted = entry.status === "valid";
    const bindingChanged =
      trusted &&
      (digest(ticket.request) !== digest(entry.request) ||
        digest(ticket.submitter) !== digest(entry.github_actor) ||
        digest(ticket.workflow) !== digest(entry.workflow));
    if (trusted) {
      ticket.request = entry.request;
      ticket.submitter = entry.github_actor;
      ticket.workflow = entry.workflow;
    }
    if (
      bindingChanged ||
      !latest(ticket) ||
      digest(latest(ticket).decision) !== digest(decision)
    ) {
      appendDecision(ticket, {
        at: now().toISOString(),
        actor,
        run_id: run.run_id,
        policy_version: rehearsal ? runPolicyVersion : policyVersion,
        decision,
        observation,
        previous_status: latest(ticket)?.decision.status ?? null,
        receipt_hash: ticket.receipt_hash,
        request: ticket.request,
        submitter: ticket.submitter,
        workflow: ticket.workflow
      });
      await journal.save(state, run, `decide #${number} ${decision.status}`);
    }
  }
  const applied = await loggedStep(
    {
      step: "ticket.update",
      issue_number: number,
      request_id: ticket.request?.request_id,
      message: "Apply and verify the saved ticket decision."
    },
    () =>
      applyTicket({
        api,
        journal,
        state,
        run,
        ticket,
        number,
        actor,
        signal,
        verifyClosure: async () => {
          if (recordedTerminal || closeTest) return;
          const freshIssue = await response(api, "GET", `/issues/${number}`);
          if (receiptHash(freshIssue) !== ticket.receipt_hash)
            throw new Error("Receipt changed before closure.");
          const freshEntry = await inspect(freshIssue, { get, profile });
          const freshObservation = await observe(freshEntry, {
            github,
            profile
          });
          const fresh = decideTicket(freshEntry, freshObservation);
          if (
            fresh.status !== "closed" ||
            digest(fresh.reasons) !== digest(latest(ticket).decision.reasons)
          )
            throw new Error(
              "PR evidence changed before closure; the intended decision was not applied."
            );
        }
      }),
    (applied) => ({ result_status: applied.status })
  );
  return {
    ...applied,
    ...(rehearsal ? { rehearsal: rehearsalResult } : {}),
    ...(serviceResult ? { services: serviceResult } : {}),
    ...(decision?.batch ? { batch: decision.batch } : {})
  };
}
