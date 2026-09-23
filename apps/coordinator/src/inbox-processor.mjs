import { isReleaseBatchPolicy } from "./batch-plan.mjs";
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
import {
  createInboxSelection,
  filterInboxRequests,
  readInboxSelection
} from "./inbox-selection.mjs";

export async function processInbox({
  api,
  identity,
  get,
  github,
  selectionMode,
  issueNumbers = [],
  actorLogin,
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
  releaseAdapter,
  journal = createJournal(api, profile, {
    workflow: rehearsal ? inboxWorkflow : undefined
  }),
  loadInbox = readInbox,
  inspect = inspectIssue,
  observe = inspectReadiness
}) {
  const requestedSelection = resume
    ? undefined
    : createInboxSelection(selectionMode ?? "inbox", issueNumbers, actorLogin);
  if (
    closeTest &&
    (requestedSelection?.mode !== "filtered" ||
      requestedSelection.issue_numbers.length !== 1)
  )
    throw new Error("Test closure requires one explicit Issue number.");
  signal?.throwIfAborted();
  if (requestedSelection?.mode === "filtered") {
    const inbox = await loggedStep(
      {
        step: "inbox.selection",
        message: "Verify the filtered inbox Issues and trusted actor."
      },
      () => loadInbox({ get, now, profile })
    );
    filterInboxRequests(inbox.requests, requestedSelection);
  }
  const actor = await loggedStep(
    { step: "operator.identity", message: "Verify the acting GitHub account." },
    identity
  );
  const scope = resume
    ? undefined
    : {
        selection: requestedSelection,
        close_test: closeTest,
        ...(rehearsal ? { workflow: inboxWorkflow } : {}),
        ...(releaseAdapter ? { release_adapter: releaseAdapter } : {})
      };
  const { state, run } = await loggedStep(
    { step: "journal.acquire", message: "Acquire the inbox journal lock." },
    () => journal.acquire(actor, resume, scope)
  );
  bindRunLog(run.run_id, Boolean(resume));
  serviceAssert(
    run.scope &&
      state.lock?.scope &&
      typeof state.lock.scope === "object" &&
      !Array.isArray(state.lock.scope) &&
      typeof run.scope.close_test === "boolean",
    "run-scope",
    "The saved inbox run has no valid Issue selection or action."
  );
  const selection = readInboxSelection(run.scope);
  serviceAssert(
    !resume || selectionMode === undefined || selection.mode === selectionMode,
    "run-scope",
    `Resume requires RELEASE_COORDINATOR_SCOPE=${selection.mode}.`
  );
  if (releaseAdapter) {
    const savedAdapter =
      run.scope.release_adapter ??
      (profile.name === "sandbox" ? "generic" : releaseAdapter);
    serviceAssert(
      savedAdapter === releaseAdapter,
      "release-adapter",
      `Resume requires the saved ${profile.name === "sandbox" ? "sandbox " : ""}release adapter ${savedAdapter}.`
    );
    if (resume && run.scope.release_adapter === undefined) {
      run.scope.release_adapter = savedAdapter;
      state.lock.scope.release_adapter = savedAdapter;
      await journal.save(state, run, "record legacy release adapter");
    }
  }
  closeTest = run.scope.close_test;
  const results = [];
  const batching =
    batch &&
    !selection.legacy_single &&
    !closeTest &&
    ["inbox-run-v4", inboxWorkflow].includes(run.scope.workflow);
  let batchResult;
  let pendingNumber = null;
  try {
    if (batching && !run.batch_fingerprint) {
      serviceAssert(
        !selection.legacy_single && run.scope.close_test === false,
        "batch-scope",
        "Only a normal inbox selection can continue an unfinished release."
      );
      const active = Object.values(state.batches ?? {}).filter(
        (record) =>
          isReleaseBatchPolicy(record.policy) &&
          record.status === "finished" &&
          record.selected.length &&
          (!record.execution ||
            ["prepared", "running", "recovering"].includes(
              record.execution.status
            ))
      );
      if (active.length > 1)
        throw new Error("More than one unfinished release exists.");
      if (active.length === 1) {
        serviceAssert(
          selection.mode === "inbox" ||
            active[0].inputs.every((input) =>
              selection.issue_numbers.includes(input.number)
            ),
          "batch-scope",
          "An unfinished release exists outside the filtered inbox selection."
        );
        run.batch_fingerprint = active[0].fingerprint;
        run.ticket_numbers = active[0].inputs.map(({ number }) => number);
        state.lock.batch_fingerprint = run.batch_fingerprint;
        state.lock.ticket_numbers = structuredClone(run.ticket_numbers);
        await journal.save(state, run, "continue unfinished release");
      }
    }
    const scanned = await scanRunTickets({
      loadInbox,
      get,
      now,
      profile,
      run,
      selection,
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
      release_executed: batchResult?.release_executed === true,
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
