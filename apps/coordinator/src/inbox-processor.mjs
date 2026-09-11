import { bindRunLog, loggedStep, runEvent } from "./run-log.mjs";
import { realProfile } from "./profiles.mjs";
import { readInbox, inspectIssue } from "./inbox-reader.mjs";
import { inspectReadiness } from "./readiness.mjs";
import { createJournal, inboxWorkflow } from "./inbox-journal.mjs";
import {
  scanRunTickets,
  prepareRunTickets,
  verifyBatchInputs
} from "./inbox-preparation.mjs";
import { presentRunTicket } from "./inbox-ticket-writer.mjs";
import { serviceAssert } from "./service-contract.mjs";
const isNumber = (value) => Number.isSafeInteger(value) && value > 0;

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
  release,
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
  const batching =
    batch &&
    profile.name === "sandbox" &&
    !issueNumber &&
    !closeTest &&
    ["inbox-run-v4", inboxWorkflow].includes(run.scope.workflow);
  let batchResult;
  let pendingNumber = null;
  try {
    if (batching && !run.batch_fingerprint) {
      serviceAssert(
        run.scope?.issue_number === null && run.scope.close_test === false,
        "batch-scope",
        "Only an unscoped sandbox run can continue an unfinished release."
      );
      const active = Object.values(state.batches ?? {}).filter(
        (record) =>
          record.policy?.version === "sandbox-batch-v2" &&
          record.status === "finished" &&
          record.selected.length &&
          record.execution?.status !== "completed"
      );
      if (active.length > 1)
        throw new Error("More than one unfinished sandbox release exists.");
      if (active.length === 1) {
        run.batch_fingerprint = active[0].fingerprint;
        run.ticket_numbers = active[0].inputs.map(({ number }) => number);
        state.lock.batch_fingerprint = run.batch_fingerprint;
        state.lock.ticket_numbers = structuredClone(run.ticket_numbers);
        await journal.save(state, run, "continue unfinished sandbox release");
      }
    }
    const scanned = await scanRunTickets({
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
    });
    const preparedTickets = await prepareRunTickets({
      ...scanned,
      activeBatch: run.batch_fingerprint
        ? state.batches?.[run.batch_fingerprint]
        : null,
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
      batching
    });
    if (batching) {
      batchResult = await batch({
        items: preparedTickets,
        state,
        run,
        profile,
        signal,
        guard: () => journal.guard(run),
        save: (message) => journal.save(state, run, message),
        loadBatch: (hash) => journal.loadHistory(state, run, "batches", hash),
        verify: (inputs) =>
          verifyBatchInputs(inputs, {
            preparedTickets,
            api,
            inspect,
            get,
            profile,
            observe,
            github,
            plan
          }),
        release
      });
    }
    for (const item of preparedTickets) {
      pendingNumber = item.number;
      results.push(
        await presentRunTicket(item, {
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
        })
      );
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
      recovery: `Stop the original process, settle in-flight requests and inspect the journal. Use --resume ${run.run_id} only if that run still holds the lock.`
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
      `${error.message} Stop this process and inspect the journal for run ${run.run_id}. Use --resume ${run.run_id} only if that run still holds the lock.`,
      { cause: error }
    );
  }
}
