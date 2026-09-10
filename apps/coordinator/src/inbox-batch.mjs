import { sandboxProfile } from "./profiles.mjs";
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

export function batchDecision(decision, result) {
  const next = structuredClone(decision);
  next.batch = result;
  const owner = result.status === "blocked" ? "Submitter" : "Coordinator";
  const action =
    result.status === "blocked"
      ? "Correct the specific recorded blocker and submit a new request for changed code."
      : result.status === "passed"
        ? "Keep the exact tested candidate recorded. Release execution is not implemented or authorized."
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

export async function coordinateInboxBatch({
  items,
  state,
  run,
  profile,
  signal,
  guard,
  save,
  verify,
  prepare = prepareBatch,
  check = checkBatch,
  revalidate = verifySavedBatch,
  select = selectBatch
}) {
  serviceAssert(
    profile === sandboxProfile,
    "batch-profile",
    "Batch execution requires the sandbox profile."
  );
  const suitable = [],
    totals = { frontend: 0, backend: 0 };
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
      item.entry.request.target !== "staging"
    ) {
      result = {
        status: "waiting",
        code: "batch-unsupported",
        message:
          "Batching currently supports staging tickets without database changes. This whole ticket is held for the appropriate capability."
      };
    } else {
      try {
        // Source/database/catalog inspection is cheap. It must happen for all
        // tickets before any batch PR or service workflow is created.
        buildServicePlan(
          item.entry,
          item.coordinated.report,
          profile,
          batchPolicy.runtime
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
  }
  if (!suitable.length && !run.batch_fingerprint)
    return { status: "no-candidate", selected: [], release_authorized: false };
  const inputs = suitable.map((item) => ({
    number: item.entry.issue_number,
    input: item.input
  }));
  const freshFingerprint = serviceHash({ inputs, policy: batchPolicy });
  const fingerprint = run.batch_fingerprint ?? freshFingerprint;
  const changed = fingerprint !== freshFingerprint;
  const original = state.batches?.[fingerprint];
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
          entry: { issue_number: value.number },
          input: value.input
        }))
      : suitable,
    previous: state.batches[fingerprint],
    signal,
    guard,
    verify: changed ? async () => false : verify,
    prepare: (group) => prepare(group, { profile, signal }),
    check: (prepared, options) => check(prepared, { ...options, profile }),
    revalidate: (prepared, progress, options) =>
      revalidate(prepared, progress, { ...options, profile }),
    save: async (value) => {
      state.batches[fingerprint] = structuredClone(value);
      await save(`batch ${fingerprint.slice(0, 12)} ${value.status}`);
    }
  });
  for (const item of changed
    ? items.filter(
        (item) =>
          original.inputs.some((value) => value.number === item.number) &&
          item.decision &&
          !terminal(item.decision)
      )
    : suitable)
    item.decision = batchDecision(
      item.decision,
      batchTicketResult(batch, item.number)
    );
  return {
    fingerprint,
    status: batch.selected.length ? "passed-candidate" : "no-candidate",
    selected: batch.selected,
    attempts: batch.attempts.map(({ id, phase, members, result }) => ({
      id,
      phase,
      tickets: members,
      status: result?.status ?? "pending"
    })),
    stop: batch.stop ?? null,
    release_authorized: false
  };
}
