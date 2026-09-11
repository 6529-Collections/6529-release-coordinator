import { sandboxProfile } from "./profiles.mjs";
import { runEvent } from "./run-log.mjs";
import { buildServicePlan } from "./service-plan.mjs";
import { batchPolicy, prepareBatch } from "./batch-plan.mjs";
import { selectBatch, batchTicketResult } from "./batch-selection.mjs";
import { checkBatch, verifySavedBatch } from "./batch-checks.mjs";
import {
  serviceHash,
  serviceAssert,
  ServiceError
} from "./service-contract.mjs";
import { terminal } from "./ticket-presentation.mjs";
import { releaseTicketResult } from "./release-execution.mjs";
import { isReleaseRequestTarget } from "./release-target.mjs";

export function batchDecision(decision, result) {
  const next = structuredClone(decision);
  next.batch = result;
  const owner = result.status === "blocked" ? "Submitter" : "Coordinator";
  const action =
    result.status === "blocked"
      ? "Correct the specific recorded blocker and submit a new request for changed code."
      : result.status === "passed"
        ? "Continue the saved sandbox release sequence. This batch pass authorizes no real release."
        : "Reassess this whole ticket when the recorded dependency, compatibility, limit or evidence condition changes.";
  next.reasons.push({
    code: result.code,
    message: result.message,
    action,
    owner
  });
  if (next.status !== "action-needed")
    next.status = result.status === "blocked" ? "action-needed" : "waiting";
  next.next_action = [
    ...new Set(next.reasons.map((reason) => reason.action))
  ].join(" ");
  next.action_owner = [
    ...new Set(next.reasons.map((reason) => reason.owner))
  ].join("; ");
  if (owner === "Submitter") next.submitter_action = action;
  return next;
}

function releasedDecision(decision, result) {
  const next = structuredClone(decision);
  next.reasons = next.reasons.filter(
    (reason) =>
      !["coordinator-incomplete", "batch-selected"].includes(reason.code)
  );
  const completed = result.status === "completed";
  const waiting = result.status === "waiting";
  const reason = {
    code: result.code,
    message: result.message,
    action: completed
      ? "No further action is required for this sandbox request."
      : waiting
        ? "Recheck the saved batch and release evidence before continuing."
        : "Inspect the saved failing release step before deciding recovery.",
    owner: completed ? "None" : "Coordinator maintainers"
  };
  next.reasons.push(reason);
  const batch = next.batch ?? {};
  next.batch = {
    fingerprint: batch.fingerprint ?? result.execution?.plan?.batch_fingerprint,
    status: result.batch_status,
    code: batch.code ?? result.code,
    message: batch.message ?? result.message,
    selected: Array.isArray(batch.selected) ? batch.selected : [],
    evidence: Array.isArray(batch.evidence) ? batch.evidence : [],
    release: {
      id: result.execution?.plan?.release_id,
      status: result.execution?.status,
      target: result.execution?.plan?.target,
      message: result.execution?.message,
      operations: Object.values(result.execution?.operations ?? {}).map(
        (operation) => ({
          id: operation.id,
          step: operation.step.id,
          status: operation.result?.status ?? operation.state,
          url: operation.result?.url ?? operation.result?.workflow?.url ?? null
        })
      )
    }
  };
  next.status = completed ? "completed" : waiting ? "waiting" : "action-needed";
  next.next_action = reason.action;
  next.action_owner = reason.owner;
  next.submitter_action = "None currently required.";
  return next;
}

export async function coordinateInboxBatch({
  items,
  state,
  run,
  profile,
  signal,
  guard,
  save,
  verify,
  loadBatch = async (hash) => state.batches?.[hash],
  prepare = prepareBatch,
  check = checkBatch,
  revalidate = verifySavedBatch,
  select = selectBatch,
  release
}) {
  serviceAssert(
    profile === sandboxProfile,
    "batch-profile",
    "Batch execution requires the sandbox profile."
  );
  const active = run.batch_fingerprint
    ? await loadBatch(run.batch_fingerprint)
    : null;
  if (
    active?.policy?.version === "sandbox-batch-v2" &&
    active.status === "finished"
  ) {
    if (
      release &&
      (!active.execution ||
        !["completed", "needs-human"].includes(active.execution.status))
    )
      await release?.({
        batch: active,
        state,
        run,
        signal,
        guard,
        save: async (message) => {
          state.batches[active.fingerprint] = structuredClone(active);
          await save(message);
        }
      });
    for (const item of items.filter(
      (value) =>
        active.inputs.some((input) => input.number === value.number) &&
        value.decision
    )) {
      item.decision = batchDecision(
        item.decision,
        batchTicketResult(active, item.number)
      );
      const result = release ? releaseTicketResult(active, item.number) : null;
      if (result) item.decision = releasedDecision(item.decision, result);
    }
    return {
      fingerprint: active.fingerprint,
      status: active.execution?.status ?? "release-unverified",
      selected: active.selected,
      release: active.execution ?? null,
      release_authorized: false
    };
  }
  const suitable = [],
    totals = { frontend: 0, backend: 0 };
  let selectedTarget;
  runEvent({
    step: "batch.filter",
    outcome: "started",
    message: "Finish cheap scope and database checks before combined CI.",
    tickets: items.map((item) => item.number)
  });
  for (const item of [...items].sort((a, b) => a.number - b.number)) {
    if (item.recordedTerminal || !item.decision || terminal(item.decision))
      continue;
    let result;
    if (item.coordinated?.report?.status !== "pass") {
      result = {
        status: "waiting",
        code: "batch-deferred",
        message:
          "Initial request or Git evidence did not pass; no batch checks were started for this ticket."
      };
    } else if (
      item.entry.request.database_change !== "no" ||
      !isReleaseRequestTarget(item.entry.request.target)
    ) {
      result = {
        status: "waiting",
        code: "batch-unsupported",
        message:
          "Batching currently supports staging or production tickets without database changes. This whole ticket is held for the appropriate capability."
      };
    } else if (selectedTarget && item.entry.request.target !== selectedTarget) {
      result = {
        status: "waiting",
        code: "batch-target-deferred",
        message: `This run is forming a ${selectedTarget} batch. This complete ${item.entry.request.target} ticket remains queued for a separate release.`
      };
    } else {
      try {
        // Source/database/catalog inspection is cheap. It must happen for all
        // tickets before any batch PR or service workflow is created.
        buildServicePlan(
          item.entry,
          item.coordinated.report,
          profile,
          batchPolicy.runtime,
          { allowProduction: true }
        );
        const counts = Object.fromEntries(
          item.input.repositories.map((repo) => [
            repo.role,
            repo.pull_requests.length
          ])
        );
        if (
          suitable.length >= batchPolicy.max_tickets ||
          Object.keys(counts).some(
            (role) =>
              totals[role] + counts[role] > batchPolicy.max_prs_per_repository
          )
        ) {
          result = {
            status: "waiting",
            code: "batch-limit",
            message:
              "The oldest suitable tickets filled this run's ticket/PR limit. This complete ticket remains queued."
          };
        } else {
          selectedTarget ??= item.entry.request.target;
          suitable.push(item);
          for (const role of Object.keys(counts)) totals[role] += counts[role];
        }
      } catch (error) {
        result = {
          status:
            error instanceof ServiceError && error.status === "blocked"
              ? "blocked"
              : "waiting",
          code:
            error instanceof ServiceError &&
            error.code === "database-declaration-mismatch"
              ? error.code
              : "batch-unsupported",
          message:
            error instanceof ServiceError
              ? error.message
              : "The ticket's complete sample scope could not be verified."
        };
      }
    }
    if (result) item.decision = batchDecision(item.decision, result);
    runEvent({
      step: "batch.ticket",
      issue_number: item.number,
      request_id: item.entry.request?.request_id,
      outcome: result ? "unknown" : "succeeded",
      result_status: result?.code ?? "suitable",
      message: result
        ? "This whole ticket is held before combined checks; its saved decision explains why."
        : "This whole ticket is suitable for combined Git filtering."
    });
  }
  runEvent({
    step: "batch.filter",
    outcome: "succeeded",
    tickets: suitable.map((item) => item.number),
    message:
      "Cheap ticket filtering finished; only suitable whole tickets enter the batch search."
  });
  if (!suitable.length && !run.batch_fingerprint)
    return { status: "no-candidate", selected: [], release_authorized: false };
  const inputs = suitable.map((item) => ({
    number: item.entry.issue_number,
    target: item.entry.request.target,
    input: item.input
  }));
  const freshFingerprint = serviceHash({ inputs, policy: batchPolicy });
  const fingerprint = run.batch_fingerprint ?? freshFingerprint;
  const changed = fingerprint !== freshFingerprint;
  const original = await loadBatch(fingerprint);
  // The first identity is saved before its first attempt. Resuming that narrow
  // gap may have no record yet. A referenced but missing archive throws in
  // loadBatch; it must never be treated as a new attempt.
  serviceAssert(
    !changed || original,
    "batch-state",
    "Interrupted batch has no saved selection to reconcile."
  );
  run.batch_fingerprint = fingerprint;
  state.lock.batch_fingerprint = fingerprint;
  await save("save batch selection identity");
  state.batches ??= {};
  const batch = await select({
    items: changed
      ? original.inputs.map((value) => ({
          entry: {
            issue_number: value.number,
            request: { target: value.target }
          },
          input: value.input
        }))
      : suitable,
    previous: original,
    signal,
    guard,
    verify: changed ? async () => false : () => verify(inputs),
    prepare: (group) => prepare(group, { profile, signal }),
    check: (prepared, options) => check(prepared, { ...options, profile }),
    revalidate: (prepared, progress, options) =>
      revalidate(prepared, progress, { ...options, profile }),
    save: async (value) => {
      state.batches[fingerprint] = structuredClone(value);
      await save(`batch ${fingerprint.slice(0, 12)} ${value.status}`);
    }
  });
  if (batch.selected.length && release)
    await release({
      batch,
      state,
      run,
      signal,
      guard,
      save: async (message) => {
        state.batches[fingerprint] = structuredClone(batch);
        await save(message);
      }
    });
  for (const item of changed
    ? items.filter(
        (item) =>
          original.inputs.some((value) => value.number === item.number) &&
          item.decision &&
          !terminal(item.decision)
      )
    : suitable) {
    item.decision = batchDecision(
      item.decision,
      batchTicketResult(batch, item.number)
    );
    const released = release ? releaseTicketResult(batch, item.number) : null;
    if (released) item.decision = releasedDecision(item.decision, released);
  }
  return {
    fingerprint,
    status:
      batch.execution?.status ??
      (batch.selected.length ? "passed-candidate" : "no-candidate"),
    selected: batch.selected,
    attempts: batch.attempts.map(({ id, phase, members, result }) => ({
      id,
      phase,
      tickets: members,
      status: result?.status ?? "pending"
    })),
    stop: batch.stop ?? null,
    release: batch.execution ?? null,
    release_authorized: false
  };
}
