import { randomUUID } from "node:crypto";
import { bindRunLog, loggedStep, runEvent } from "./run-log.mjs";
import { assertPinnedDestinations } from "./input-stability.mjs";
import { realProfile } from "./profiles.mjs";
import { readInbox, inspectIssue } from "./inbox-reader.mjs";
import { inspectReadiness } from "./readiness.mjs";
import { decideTicket, policyVersion } from "./inbox-policy.mjs";
import {
  coordinateTicket,
  runPolicyVersion,
  canRehearse
} from "./inbox-rehearsal.mjs";
import {
  appendDecision,
  createJournal,
  digest,
  receiptHash,
  inboxWorkflow
} from "./inbox-journal.mjs";
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

function overlapping(entry, entries) {
  if (entry.status !== "valid") return [];
  const keys = new Set(
    entry.request.release_parts.flatMap((part) =>
      part.pull_requests.map((pr) => `${part.repository}#${pr.number}`)
    )
  );
  return entries
    .filter(
      (other) =>
        other.issue_number !== entry.issue_number &&
        other.status === "valid" &&
        other.request.target === entry.request.target &&
        other.request.release_parts.some((part) =>
          part.pull_requests.some((pr) =>
            keys.has(`${part.repository}#${pr.number}`)
          )
        )
    )
    .map((other) => other.issue_number)
    .sort((a, b) => a - b);
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

export async function processInbox({
  api,
  identity,
  get,
  github,
  issueNumber,
  closeTest = false,
  resume,
  rehearsal,
  services,
  batch,
  plan,
  signal,
  now = () => new Date(),
  profile = realProfile,
  journal = createJournal(api, profile, {
    workflow: rehearsal ? inboxWorkflow : undefined
  }),
  loadInbox = readInbox,
  inspect = inspectIssue,
  observe = inspectReadiness
}) {
  if (issueNumber !== undefined && !isNumber(issueNumber))
    throw new Error("Issue number must be a positive integer.");
  if (closeTest && !issueNumber)
    throw new Error("Test closure requires one explicit Issue number.");
  signal?.throwIfAborted();
  const actor = await loggedStep(
    { step: "operator.identity", message: "Verify the acting GitHub account." },
    identity
  );
  const scope =
    resume && issueNumber === undefined && !closeTest
      ? undefined
      : {
          issue_number: issueNumber ?? null,
          close_test: closeTest,
          ...(rehearsal ? { workflow: inboxWorkflow } : {})
        };
  const { state, run } = await loggedStep(
    { step: "journal.acquire", message: "Acquire the inbox journal lock." },
    () => journal.acquire(actor, resume, scope)
  );
  bindRunLog(run.run_id, Boolean(resume));
  issueNumber = run.scope.issue_number ?? undefined;
  closeTest = run.scope.close_test;
  const results = [];
  const preparedTickets = [];
  const batching =
    batch &&
    profile.name === "sandbox" &&
    !issueNumber &&
    !closeTest &&
    run.scope.workflow === inboxWorkflow;
  let batchResult;
  let pendingNumber = null;
  try {
    // Complete the listing/proof pass before considering any Issue writes.
    const inbox = await loggedStep(
      {
        step: "inbox.scan",
        message: "Read requests and verify intake receipts."
      },
      () => loadInbox({ get, now, profile })
    );
    const numbers =
      run.ticket_numbers ??
      (issueNumber
        ? [issueNumber]
        : [
            ...new Set([
              ...inbox.requests.map((entry) => entry.issue_number),
              ...Object.keys(state.tickets).map(Number)
            ])
          ].sort((a, b) => a - b));
    if (batching && !run.ticket_numbers) {
      run.ticket_numbers = numbers;
      state.lock.ticket_numbers = numbers;
      await journal.save(state, run, "save complete batch scan selection");
    }
    const entries = new Map();
    const issues = new Map();
    for (const number of numbers) {
      signal?.throwIfAborted();
      const issue = await response(api, "GET", `/issues/${number}`);
      if (
        !isNumber(issue.id) ||
        issue.number !== number ||
        issue.pull_request ||
        !["open", "closed"].includes(issue.state) ||
        !Array.isArray(issue.labels)
      )
        throw new Error(`Invalid Issue #${number}.`);
      if (
        !state.tickets[number] &&
        !labelNames(issue).includes("release-request")
      )
        throw new Error(`Issue #${number} is not a release request.`);
      issues.set(number, issue);
      entries.set(
        number,
        await loggedStep(
          {
            step: "ticket.intake",
            issue_number: number,
            message: "Verify this ticket's immutable request and receipt."
          },
          () => inspect(issue, { get, profile }),
          (entry) => ({
            outcome: entry.status === "valid" ? "succeeded" : "unknown",
            result_status: entry.status
          })
        )
      );
    }
    const all = new Map(
      inbox.requests.map((entry) => [entry.issue_number, entry])
    );
    for (const [number, entry] of entries) all.set(number, entry);
    // A second, scoped read must not erase duplicate-request evidence found by
    // the full reader; include journal identities even after label removal.
    const counts = new Map();
    for (const entry of all.values())
      if (entry.request)
        counts.set(
          entry.request.request_id,
          (counts.get(entry.request.request_id) ?? 0) + 1
        );
    for (const entry of entries.values())
      if (entry.request && counts.get(entry.request.request_id) > 1) {
        entry.status = "invalid";
        entry.github_actor = null;
        entry.errors.push(
          "This request ID appears in multiple Issues; maintainers must resolve the identity conflict."
        );
      }
    for (const number of numbers) {
      signal?.throwIfAborted();
      const issue = issues.get(number),
        entry = entries.get(number);
      let rehearsalResult = {
        status: "not-run",
        message: "Recorded terminal ticket; its disposition is preserved."
      };
      let serviceResult;
      let observation, decision, coordinated;
      let ticket = state.tickets[number];
      if (entry.intake_in_progress) {
        results.push({
          issue_number: number,
          applied: false,
          status: "intake-running",
          message:
            "Submission workflow is still setting up this ticket; run processing after it finishes."
        });
        continue;
      }
      if (ticket && receiptHash(issue) !== ticket.receipt_hash)
        throw new Error(
          `Issue #${number}'s receipt differs from recorded history.`
        );
      const recordedTerminal =
        ticket &&
        terminal(latest(ticket).decision) &&
        ticket.applied === latest(ticket).id;
      const pendingTerminal = ticket && terminal(latest(ticket).decision);
      if (!pendingTerminal && issue.state === "closed") {
        results.push({
          issue_number: number,
          applied: false,
          status: "unverified-closure",
          message:
            "Already closed without an applied terminal decision; left unchanged."
        });
        continue;
      }
      if (
        closeTest &&
        (entry.status !== "valid" || entry.github_actor?.id !== actor.id)
      )
        throw new Error(
          "Test closure is limited to the authenticated operator's verified request."
        );
      if (!recordedTerminal) {
        observation = await loggedStep(
          {
            step: "ticket.readiness",
            issue_number: number,
            request_id: entry.request?.request_id,
            message: "Read current PR checks, reviews and dependencies."
          },
          () => observe(entry, { github, profile })
        );
        decision = decideTicket(entry, observation, {
          overlaps: overlapping(
            entry,
            [...all.values()].filter(
              (value) => issues.get(value.issue_number)?.state !== "closed"
            )
          ),
          closeTest
        });
        runEvent({
          step: "ticket.filter",
          issue_number: number,
          request_id: entry.request?.request_id,
          outcome: "succeeded",
          message:
            "Initial ticket policy evaluated; blockers are recorded before rehearsal.",
          result_status: decision.status,
          remaining: decision.reasons.map((reason) => reason.code)
        });
        if (rehearsal) {
          // Resume retains this run's pinned destinations. The legacy fallback
          // only continues an already saved v1 run; new callers supply no plan.
          const stored =
            run.plans?.[number] ??
            (run.scope.workflow === "inbox-run-v1" &&
            run.scope.issue_number === number
              ? run.scope.merge_plan
              : undefined);
          coordinated = await coordinateTicket({
            entry,
            observation,
            decision,
            profile,
            rehearse: rehearsal,
            preparePlan: () => (stored ? structuredClone(stored) : plan(entry)),
            savePlan: async (input) => {
              if (stored) return;
              signal?.throwIfAborted();
              const currentIssue = await response(
                api,
                "GET",
                `/issues/${number}`
              );
              if (
                receiptHash(currentIssue) !== receiptHash(issue) ||
                currentIssue.state !== issue.state
              )
                throw new Error(`Issue #${number} changed during planning.`);
              run.plans ??= {};
              run.plans[number] = structuredClone(input);
              state.lock.plans = structuredClone(run.plans);
              await journal.save(state, run, `plan #${number}`);
            }
          });
          signal?.throwIfAborted();
          await journal.guard(run);
          decision = coordinated.decision;
          rehearsalResult = coordinated.result;
          if (coordinated.evidence)
            observation = { ...observation, rehearsal: coordinated.evidence };
          if (services && !batching) {
            const checked = await services({
              entry,
              rehearsal: coordinated,
              profile,
              decision,
              attempts: state.service_attempts ?? {},
              signal,
              verifyInputs: async () => {
                const currentIssue = await response(
                  api,
                  "GET",
                  `/issues/${number}`
                );
                if (
                  receiptHash(currentIssue) !== receiptHash(issue) ||
                  currentIssue.state !== "open"
                )
                  return false;
                const currentObservation = await observe(entry, {
                  github,
                  profile
                });
                const currentPlan = await plan(entry);
                assertPinnedDestinations(
                  run.plans?.[number] ?? stored,
                  currentPlan,
                  profile
                );
                return (
                  canRehearse(
                    entry,
                    currentObservation,
                    decideTicket(entry, currentObservation)
                  ) &&
                  digest(currentPlan) === digest(run.plans?.[number] ?? stored)
                );
              },
              guard: () => journal.guard(run),
              saveAttempt: async (attempt) => {
                try {
                  signal?.throwIfAborted();
                  state.service_attempts ??= {};
                  state.service_attempts[attempt.plan_hash] =
                    structuredClone(attempt);
                  await journal.save(
                    state,
                    run,
                    `service attempt #${number} ${attempt.state}`
                  );
                } catch (error) {
                  error.service_journal_failure = true;
                  throw error;
                }
              }
            });
            await journal.guard(run);
            signal?.throwIfAborted();
            decision = checked.decision;
            serviceResult = checked.result;
          }
        }
      }
      preparedTickets.push({
        number,
        issue,
        entry,
        ticket,
        recordedTerminal,
        observation,
        decision,
        coordinated,
        rehearsalResult,
        serviceResult,
        input: run.plans?.[number]
      });
    }
    if (batching) {
      batchResult = await batch({
        items: preparedTickets,
        state,
        run,
        profile,
        signal,
        guard: () => journal.guard(run),
        save: (message) => journal.save(state, run, message),
        verify: async () => {
          for (const item of preparedTickets.filter(
            (value) => value.coordinated?.report?.status === "pass"
          )) {
            const fresh = await response(api, "GET", `/issues/${item.number}`);
            if (
              receiptHash(fresh) !== receiptHash(item.issue) ||
              fresh.state !== "open"
            )
              return false;
            const entry = await inspect(fresh, { get, profile });
            if (
              digest(entry.request) !== digest(item.entry.request) ||
              digest(entry.workflow) !== digest(item.entry.workflow) ||
              digest(entry.github_actor) !== digest(item.entry.github_actor)
            )
              return false;
            const observation = await observe(entry, { github, profile });
            const currentPlan = await plan(entry);
            assertPinnedDestinations(item.input, currentPlan, profile);
            if (
              !canRehearse(
                entry,
                observation,
                decideTicket(entry, observation)
              ) ||
              digest(currentPlan) !== digest(item.input)
            )
              return false;
          }
          return true;
        }
      });
    }
    for (const item of preparedTickets) {
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
          pendingNumber = number;
          await journal.save(
            state,
            run,
            `decide #${number} ${decision.status}`
          );
        }
      }
      pendingNumber = number;
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
              const freshIssue = await response(
                api,
                "GET",
                `/issues/${number}`
              );
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
                digest(fresh.reasons) !==
                  digest(latest(ticket).decision.reasons)
              )
                throw new Error(
                  "PR evidence changed before closure; the intended decision was not applied."
                );
            }
          }),
        (applied) => ({ result_status: applied.status })
      );
      results.push({
        ...applied,
        ...(rehearsal ? { rehearsal: rehearsalResult } : {}),
        ...(serviceResult ? { services: serviceResult } : {}),
        ...(decision?.batch ? { batch: decision.batch } : {})
      });
      pendingNumber = null;
    }
    signal?.throwIfAborted();
    await loggedStep(
      {
        step: "journal.release",
        message: "Release the completed run's inbox lock."
      },
      () => journal.release(state, run)
    );
    return {
      mode: "write",
      profile: profile.name,
      repository: profile.inbox.full_name,
      run_id: run.run_id,
      checked_at: now().toISOString(),
      release_authorized: false,
      requests: results,
      ...(batchResult ? { batch: batchResult } : {})
    };
  } catch (error) {
    // Retain the lock on failure, even on an uncertain API response. Recovery
    // is explicit, after the prior process has stopped; it never uses a timer.
    const trials = Object.values(state.batches ?? {}).flatMap((batch) =>
      batch.attempts.flatMap((attempt) =>
        (attempt.progress?.prs ?? [])
          .filter((pr) => pr.cleanup !== "removed")
          .map(
            (pr) =>
              `${pr.role}: ${pr.number ? `PR #${pr.number}, ` : ""}${pr.branch}`
          )
      )
    );
    runEvent({
      step: "run.unfinished",
      outcome: signal?.aborted ? "interrupted" : "unknown",
      message:
        "The run did not finish; recorded operations may need reconciliation. No rollback is claimed.",
      remaining: [
        ...trials,
        ...[
          ...Object.values(state.service_attempts ?? {}),
          ...Object.values(state.batches ?? {}).flatMap((batch) =>
            batch.attempts.flatMap((attempt) =>
              Object.values(attempt.progress?.service_attempts ?? {})
            )
          )
        ]
          .filter(
            (attempt) =>
              !attempt.result ||
              attempt.result.report?.cleanup?.status !== "removed"
          )
          .map((attempt) => {
            const workflowId =
              attempt.workflow_run_id ?? attempt.result?.workflow?.id;
            return `Service attempt ${attempt.id}: ${
              workflowId
                ? `https://github.com/${attempt.plan?.runtime?.repository}/actions/runs/${workflowId}`
                : "dispatch outcome unverified"
            }`;
          }),
        ...(pendingNumber ? [`Ticket #${pendingNumber} presentation`] : [])
      ],
      recovery: `Stop the original process and settle in-flight requests before --resume ${run.run_id}.`
    });
    if (pendingNumber && state.tickets[pendingNumber]) {
      state.tickets[pendingNumber].application_error = {
        at: now().toISOString(),
        message: error.message
      };
      try {
        await journal.save(state, run, `partial update #${pendingNumber}`);
      } catch {
        /* ownership may have changed */
      }
    }
    throw new Error(
      `${error.message} Run ${run.run_id} remains locked. After this process has stopped, resume with --resume ${run.run_id}.`,
      { cause: error }
    );
  }
}
