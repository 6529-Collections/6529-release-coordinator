import { loggedStep, runEvent } from "./run-log.mjs";
import { assertPinnedDestinations } from "./input-stability.mjs";
import { decideTicket } from "./inbox-policy.mjs";
import { coordinateTicket, canRehearse } from "./inbox-rehearsal.mjs";
import { digest, receiptHash } from "./inbox-journal.mjs";
import { response, labelNames, terminal } from "./ticket-presentation.mjs";
const latest = (ticket) => ticket?.transitions.at(-1);
const isNumber = (value) => Number.isSafeInteger(value) && value > 0;

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
export async function scanRunTickets({
  loadInbox,
  get,
  now,
  profile,
  run,
  issueNumber,
  state,
  batching,
  journal,
  signal,
  api,
  inspect
}) {
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
  return { numbers, entries, issues, all };
}

export async function prepareRunTickets({
  numbers,
  entries,
  issues,
  all,
  signal,
  state,
  results,
  closeTest,
  actor,
  observe,
  github,
  profile,
  rehearsal,
  run,
  plan,
  api,
  journal,
  services,
  batching,
  activeBatch
}) {
  const preparedTickets = [];
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
    const savedBatchInput = activeBatch?.inputs.find(
      (value) => value.number === number
    )?.input;
    if (!recordedTerminal && activeBatch) {
      observation = await loggedStep(
        {
          step: "ticket.readiness",
          issue_number: number,
          request_id: entry.request?.request_id,
          message: "Re-read ticket identity while continuing its saved release."
        },
        () => observe(entry, { github, profile })
      );
      decision = decideTicket(entry, observation);
      rehearsalResult = {
        status: "passed",
        message:
          "Continuing the exact saved batch; its earlier Git and check evidence remains in the journal."
      };
      decision.rehearsal = rehearsalResult;
    } else if (!recordedTerminal) {
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
            loadAttempt: async (hash) => {
              try {
                return await journal.loadHistory(state, run, "services", hash);
              } catch (error) {
                error.service_journal_failure = true;
                throw error;
              }
            },
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
      input: savedBatchInput ?? run.plans?.[number]
    });
  }
  return preparedTickets;
}

export async function verifyBatchInputs(
  inputs,
  { preparedTickets, api, inspect, get, profile, observe, github, plan }
) {
  for (const { number, input } of inputs) {
    const item = preparedTickets.find((value) => value.number === number);
    if (!item || digest(item.input) !== digest(input)) return false;
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
      !canRehearse(entry, observation, decideTicket(entry, observation)) ||
      digest(currentPlan) !== digest(item.input)
    )
      return false;
  }
  return true;
}
