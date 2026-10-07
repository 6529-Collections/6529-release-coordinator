import { selectedPreparation } from "./release-plan.mjs";
import { serviceAssert } from "./service-contract.mjs";
import { selectProfile } from "./profiles.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const positive = (value) => Number.isSafeInteger(value) && value > 0;

/** A stopped first frontend deployment may be abandoned, never promoted. */
function assertStagingDeploymentCheckpoint(execution, batch, code) {
  const merged = execution.operations["staging:integrate:frontend"];
  const deploy = execution.operations["staging:deploy:frontend:frontend"];
  serviceAssert(
    selectedPreparation(batch).prepared.service_plan.database.observed ===
      "no" &&
      ["running", "cancelling", "cancelled"].includes(execution.status) &&
      execution.step_index === 1 &&
      Object.keys(execution.operations).length === 2 &&
      Object.keys(execution.plan.candidates).join() === "frontend" &&
      execution.plan.steps[0]?.id === "staging:integrate:frontend" &&
      execution.plan.steps[1]?.id === "staging:deploy:frontend:frontend" &&
      !execution.plan.steps.some((step) => step.role === "backend") &&
      !execution.recovery &&
      !execution.staging_drift &&
      !execution.manual_stop &&
      !execution.review_pause &&
      merged?.state === "completed" &&
      merged.cleanup === "removed" &&
      merged.result?.status === "passed" &&
      merged.result.kind === "merge" &&
      positive(merged.number) &&
      sha(merged.integration_commit) &&
      sha(merged.result.commit) &&
      sha(merged.result.tree) &&
      deploy?.state === "running" &&
      deploy.result === null &&
      deploy.cleanup_reason === undefined &&
      deploy.operation?.operation === "deploy" &&
      deploy.operation.environment === "staging" &&
      deploy.operation.role === "frontend" &&
      deploy.operation.unit === "frontend" &&
      deploy.operation.frontend_commit === merged.result.commit &&
      positive(deploy.workflow_run_id) &&
      positive(deploy.workflow_id) &&
      (execution.status === "running" ||
        execution.cancellation?.checkpoint === "finished-staging-deployment"),
    code,
    "Staging closeout requires only a completed frontend merge and its interrupted first deployment, with no database change, E2E, production operation or recovery."
  );
  return deploy;
}

/** Validate separate abandonment evidence without rewriting a deployment result. */
export function validateStagingCloseoutEvidence(
  evidence,
  execution,
  code = "release-state"
) {
  const merged = execution.operations["staging:integrate:frontend"];
  const deploy = execution.operations["staging:deploy:frontend:frontend"];
  const repository = selectProfile(execution.plan.profile).repositories.frontend
    .full_name;
  serviceAssert(
    evidence?.version === 1 &&
      evidence.operation_id === deploy.id &&
      evidence.integration?.number === merged.number &&
      evidence.integration.url === merged.url &&
      evidence.integration.commit === merged.result.commit &&
      evidence.integration.tree === merged.result.tree &&
      evidence.integration.head === merged.integration_commit &&
      evidence.integration.branch === merged.branch &&
      evidence.integration.cleanup === "removed" &&
      evidence.deployment?.id === deploy.workflow_run_id &&
      evidence.deployment.workflow_id === deploy.workflow_id &&
      evidence.deployment.source_commit === deploy.operation.frontend_commit &&
      evidence.deployment.url ===
        `https://github.com/${repository}/actions/runs/${deploy.workflow_run_id}` &&
      positive(evidence.deployment.attempt) &&
      evidence.deployment.conclusion === "success" &&
      Number.isFinite(Date.parse(evidence.checked_at)),
    code,
    "Staging abandonment lacks its exact finished deployment and verified merged PR cleanup."
  );
}

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
  if (step.kind === "deploy")
    return assertStagingDeploymentCheckpoint(execution, batch, code);
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
  const stagingCloseout = record.step.kind === "deploy";
  if (stagingCloseout && cancellation.evidence)
    validateStagingCloseoutEvidence(cancellation.evidence, execution);
  serviceAssert(
    cancellation.mode === "keep-current" &&
      cancellation.step_id === record.step.id &&
      Number.isFinite(Date.parse(cancellation.requested_at)) &&
      /^[1-9][0-9]*$/u.test(String(cancellation.actor?.id ?? "")) &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(
        cancellation.actor?.login ?? ""
      ) &&
      versions(cancellation.observed_before) &&
      (stagingCloseout
        ? cancellation.checkpoint === "finished-staging-deployment"
        : cancellation.checkpoint === undefined &&
          cancellation.evidence === undefined) &&
      (execution.status !== "cancelling" || execution.completed_at === null) &&
      (execution.status !== "cancelled" ||
        ((stagingCloseout
          ? Boolean(cancellation.evidence)
          : record.state === "completed" &&
            record.result?.kind === "review-stop" &&
            record.result.status === "failed" &&
            record.cleanup === "removed") &&
          versions(cancellation.observed_after) &&
          execution.completed_at)),
    "release-state",
    "Cancellation lacks its explicit actor, observed refs, or confirmed owned PR cleanup."
  );
}
