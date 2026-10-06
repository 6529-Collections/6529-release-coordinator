import { selectedPreparation } from "./release-plan.mjs";
import { serviceAssert } from "./service-contract.mjs";

const versions = (value) =>
  ["staging", "prod"].every((environment) =>
    ["backend", "frontend"].every((role) =>
      /^[0-9a-f]{40}$/u.test(value?.[environment]?.[role] ?? "")
    )
  );

// This is abandonment, not recovery. Never abandon an uncertain production
// operation or a database-changing release by clearing its journal lock.
export function assertCancellableRelease(
  execution,
  batch,
  code = "release-cancel"
) {
  const step = execution?.plan?.steps?.[execution.step_index];
  const record = execution?.operations?.[step?.id];
  serviceAssert(
    record && typeof record === "object" && !Array.isArray(record),
    code,
    "Cancellation requires its saved integration PR record."
  );
  // A thrown pre-merge check retains the last running checkpoint rather than
  // a review pause. Allow explicit abandonment only at the first staging PR,
  // before any other release operation exists. The adapter still verifies the
  // live PR is unmerged and its uniquely owned branch has not changed.
  const firstStagingCheckpoint =
    execution.status === "running" &&
    execution.step_index === 0 &&
    step?.environment === "staging" &&
    record.state === "checking" &&
    record.result === null &&
    record.cleanup_reason === undefined &&
    Object.keys(execution.operations).length === 1;
  serviceAssert(
    selectedPreparation(batch).prepared.service_plan.database.observed ===
      "no" &&
      !execution.recovery &&
      !execution.staging_drift &&
      !execution.manual_stop &&
      (execution.status === "awaiting-review" ||
        firstStagingCheckpoint ||
        (["running", "cancelling", "cancelled"].includes(execution.status) &&
          record?.cleanup_reason === "review-stop")) &&
      step?.kind === "integrate" &&
      ["checking", "cleaning", "completed"].includes(record?.state) &&
      Number.isSafeInteger(record.number) &&
      record.number > 0 &&
      /^[0-9a-f]{40}$/u.test(record.integration_commit ?? "") &&
      (record.result === null ||
        (record.state === "completed" &&
          record.result?.status === "failed" &&
          record.result.kind === "review-stop" &&
          record.cleanup === "removed")) &&
      !Object.values(execution.operations).some(
        (operation) =>
          operation.step.environment === "prod" && operation !== record
      ),
    code,
    "Keeping current code requires a no-database-change release at an owned, unmerged integration PR: awaiting review, its interrupted stop, or an interrupted first staging checkpoint with no other release operation. Uncertain merges, production work and recovery refuse cancellation."
  );
  return record;
}

export function validateReleaseCancellation(execution, batch) {
  const cancellation = execution.cancellation;
  serviceAssert(
    Boolean(cancellation) ===
      ["cancelling", "cancelled"].includes(execution.status),
    "release-state",
    "Cancellation evidence must remain in its cancellation state."
  );
  if (!cancellation) return;
  const record = assertCancellableRelease(execution, batch, "release-state");
  serviceAssert(
    cancellation.mode === "keep-current" &&
      cancellation.step_id === record.step.id &&
      Number.isFinite(Date.parse(cancellation.requested_at)) &&
      /^[1-9][0-9]*$/u.test(String(cancellation.actor?.id ?? "")) &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(
        cancellation.actor?.login ?? ""
      ) &&
      versions(cancellation.observed_before) &&
      (execution.status !== "cancelling" || execution.completed_at === null) &&
      (execution.status !== "cancelled" ||
        (record.state === "completed" &&
          record.result?.kind === "review-stop" &&
          record.result.status === "failed" &&
          record.cleanup === "removed" &&
          versions(cancellation.observed_after) &&
          execution.completed_at)),
    "release-state",
    "Cancellation lacks its explicit actor, observed refs, or confirmed owned PR cleanup."
  );
}
