import {
  validateReleaseOperation,
  verifyReleaseReport
} from "./release-contract.mjs";
import {
  integrationCommitInput,
  operationForStep,
  validateReleasePlan,
  validateRecoveryPlan
} from "./release-plan.mjs";
import { serviceAssert, serviceHash } from "./service-contract.mjs";

const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");

// GitHub workflow-run statuses that still hold or wait for a concurrency slot.
export const activeWorkflowRunStatuses = Object.freeze([
  "in_progress",
  "queued",
  "waiting",
  "pending",
  "requested"
]);

// A step that found someone else's active workflow run records what it waited
// for before its merge or dispatch. `unlisted` is a lag indicator (status
// counts in excess of listed runs), not an exact count of hidden runs; a note
// with no listed run needs a positive indicator to explain the wait. Older
// records without this note stay valid.
function validateWaitedFor(record) {
  if (!Object.hasOwn(record, "waited_for")) return;
  const waited = record.waited_for;
  serviceAssert(
    waited &&
      typeof waited === "object" &&
      !Array.isArray(waited) &&
      ["dispatch", "merge"].includes(waited.purpose) &&
      Number.isFinite(Date.parse(waited.first_seen_at)) &&
      Array.isArray(waited.runs) &&
      (waited.unlisted === undefined ||
        (Number.isSafeInteger(waited.unlisted) && waited.unlisted >= 0)) &&
      (waited.runs.length > 0 || waited.unlisted > 0) &&
      waited.runs.every(
        (run) =>
          Number.isSafeInteger(run?.id) &&
          run.id > 0 &&
          /^https:\/\/github\.com\//u.test(run.url ?? "") &&
          activeWorkflowRunStatuses.includes(run.status) &&
          (run.actor === null || typeof run.actor === "string")
      ) &&
      (waited.checks === undefined ||
        (Number.isSafeInteger(waited.checks) && waited.checks > 0)) &&
      (waited.quiet_at === undefined ||
        Number.isFinite(Date.parse(waited.quiet_at))),
    "release-state",
    "Invalid saved wait for active workflow runs."
  );
}

export function validateReleaseExecution(execution, batch) {
  serviceAssert(
    execution?.version === 1 &&
      [
        "prepared",
        "running",
        "recovering",
        "completed",
        "needs-human"
      ].includes(execution.status) &&
      Number.isSafeInteger(execution.step_index) &&
      execution.step_index >= 0 &&
      execution.step_index <= execution.plan?.steps?.length &&
      execution.operations &&
      typeof execution.operations === "object" &&
      !Array.isArray(execution.operations) &&
      execution.versions &&
      typeof execution.versions === "object" &&
      !Array.isArray(execution.versions) &&
      Number.isFinite(Date.parse(execution.started_at)) &&
      (execution.completed_at === null ||
        Number.isFinite(Date.parse(execution.completed_at))) &&
      typeof execution.message === "string",
    "release-state",
    "Invalid sandbox release execution state."
  );
  validateReleasePlan(execution.plan, batch);
  if (execution.status !== "prepared")
    serviceAssert(
      execution.actor?.id &&
        execution.runtime?.backend &&
        execution.runtime?.frontend,
      "release-state",
      "Started release lacks its saved actor or workflow identities."
    );
  const ids = new Set();
  for (const [stepId, record] of Object.entries(execution.operations)) {
    const index = execution.plan.steps.findIndex((step) => step.id === stepId);
    serviceAssert(
      index >= 0 &&
        uuid(record?.id) &&
        !ids.has(record.id) &&
        record.release_id === execution.plan.release_id &&
        serviceHash(record.step) === serviceHash(execution.plan.steps[index]) &&
        index <= execution.step_index &&
        [
          "prepared",
          "branch-prepared",
          "commit-prepared",
          "creating-pr",
          "checking",
          "cleaning",
          "merging",
          "merged",
          "dispatching",
          "running",
          "completed"
        ].includes(record.state) &&
        Number.isFinite(Date.parse(record.created_at)),
      "release-state",
      "Invalid or repeated sandbox release step state."
    );
    ids.add(record.id);
    validateWaitedFor(record);
    const hasIntegrationCommit = Object.hasOwn(record, "integration_commit");
    const hasIntegrationInput = Object.hasOwn(record, "integration_input");
    const hasIntegrationVersion = Object.hasOwn(record, "integration_version");
    const needsPreparedIntegrationInput =
      ["running", "recovering"].includes(execution.status) &&
      record.step.kind === "integrate" &&
      record.state === "commit-prepared";
    if (
      needsPreparedIntegrationInput &&
      !(hasIntegrationInput && hasIntegrationVersion && !hasIntegrationCommit)
    )
      serviceAssert(
        false,
        "release-recovery",
        "This unfinished release predates unique integration commits and needs manual recovery."
      );
    const needsCreatedIntegrationCommit =
      ["running", "recovering"].includes(execution.status) &&
      record.step.kind === "integrate" &&
      !["prepared", "commit-prepared"].includes(record.state);
    if (
      needsCreatedIntegrationCommit &&
      !(hasIntegrationCommit && hasIntegrationInput && hasIntegrationVersion)
    )
      serviceAssert(
        false,
        "release-recovery",
        "This unfinished release predates unique integration commits and needs manual recovery."
      );
    if (hasIntegrationCommit || hasIntegrationInput || hasIntegrationVersion) {
      const candidate = execution.plan.candidates[record.step.role];
      serviceAssert(
        record.step.kind === "integrate" &&
          record.integration_version === 1 &&
          serviceHash(record.integration_input) ===
            serviceHash(integrationCommitInput(record, candidate)) &&
          (record.state === "commit-prepared"
            ? !hasIntegrationCommit
            : /^[0-9a-f]{40}$/u.test(record.integration_commit ?? "")),
        "release-state",
        "Invalid sandbox integration commit state."
      );
    }
    if (record.state === "completed" && record.step.kind !== "integrate")
      serviceAssert(
        record.operation && record.result?.report,
        "release-state",
        "Completed release check lacks its exact operation or report."
      );
    if (record.operation) {
      validateReleaseOperation(record.operation);
      serviceAssert(
        record.operation.operation_id === record.id &&
          record.operation.release_id === execution.plan.release_id,
        "release-state",
        "Saved operation identity differs from its release step."
      );
      if (record.result?.report)
        verifyReleaseReport(record.result.report, record.operation);
    }
    if (record.step.kind === "integrate" && record.result)
      serviceAssert(
        ["passed", "failed"].includes(record.result.status) &&
          (record.result.status !== "passed" ||
            /^[0-9a-f]{40}$/u.test(record.result.commit ?? "")) &&
          (!record.branch || record.cleanup === "removed"),
        "release-state",
        "Integration result lacks exact commit or branch cleanup proof."
      );
  }
  for (const step of execution.plan.steps.slice(0, execution.step_index)) {
    const record = execution.operations[step.id];
    serviceAssert(
      record?.state === "completed" && record.result?.status === "passed",
      "release-state",
      "Completed release position has no saved passing result."
    );
  }
  serviceAssert(
    execution.status !== "completed" ||
      (execution.step_index === execution.plan.steps.length &&
        execution.completed_at),
    "release-state",
    "Completed release lacks every saved step."
  );
  if (execution.status === "needs-human") {
    const step = execution.plan.steps[execution.step_index];
    serviceAssert(
      execution.completed_at &&
        execution.operations[step?.id]?.result?.status === "failed",
      "release-state",
      "Stopped release lacks a confirmed failing step."
    );
  }
  if (execution.status === "recovering" || execution.recovery)
    validateRecovery(execution, batch, ids);
  return execution;
}

function validateRecovery(execution, batch, ids) {
  const recovery = execution.recovery;
  const productionFailure = recovery?.plan?.version === 2;
  const validVersions = (value) =>
    value &&
    Object.keys(value).length === 2 &&
    ["backend", "frontend"].every((role) =>
      /^[0-9a-f]{40}$/u.test(value[role] ?? "")
    );
  serviceAssert(
    recovery &&
      ["prepared", "running", "completed", "needs-human"].includes(
        recovery.status
      ) &&
      Number.isSafeInteger(recovery.step_index) &&
      recovery.step_index >= 0 &&
      recovery.step_index <= recovery.plan?.steps?.length &&
      recovery.operations &&
      typeof recovery.operations === "object" &&
      !Array.isArray(recovery.operations) &&
      recovery.versions &&
      typeof recovery.versions === "object" &&
      !Array.isArray(recovery.versions) &&
      (productionFailure
        ? Object.keys(recovery.versions).length === 2 &&
          validVersions(recovery.versions.prod) &&
          validVersions(recovery.versions.staging)
        : validVersions(recovery.versions)) &&
      Number.isFinite(Date.parse(recovery.started_at)) &&
      (recovery.completed_at === null ||
        Number.isFinite(Date.parse(recovery.completed_at))) &&
      ["recovering", "needs-human"].includes(execution.status),
    "release-state",
    "Invalid sandbox restoration state."
  );
  validateRecoveryPlan(recovery.plan, execution, batch);
  serviceAssert(
    Object.keys(recovery.operations).every((id) =>
      recovery.plan.steps.some((step) => step.id === id)
    ) &&
      execution.operations[recovery.plan.failed_step]?.result?.status ===
        "failed" &&
      (execution.status !== "recovering" ||
        (recovery.completed_at === null &&
          ["prepared", "running"].includes(recovery.status))) &&
      (execution.status !== "needs-human" ||
        (["completed", "needs-human"].includes(recovery.status) &&
          recovery.completed_at)),
    "release-state",
    "Restoration is not attached to a failed release step."
  );
  const versions = structuredClone(recovery.plan.starting_versions);
  for (const [index, step] of recovery.plan.steps.entries()) {
    const record = recovery.operations[step.id];
    if (!record) {
      serviceAssert(
        index >= recovery.step_index,
        "release-state",
        "A completed restoration step has no record."
      );
      continue;
    }
    serviceAssert(
      index <= recovery.step_index &&
        uuid(record.id) &&
        !ids.has(record.id) &&
        record.release_id === execution.plan.release_id &&
        serviceHash(record.step) === serviceHash(step) &&
        [
          "prepared",
          "branch-prepared",
          "commit-prepared",
          "creating-pr",
          "checking",
          "cleaning",
          "merging",
          "merged",
          "dispatching",
          "running",
          "completed"
        ].includes(record.state) &&
        Number.isFinite(Date.parse(record.created_at)),
      "release-state",
      "Invalid or repeated restoration operation."
    );
    ids.add(record.id);
    validateWaitedFor(record);
    if (step.kind === "integrate") {
      serviceAssert(
        !record.restore_to ||
          record.restore_to ===
            (productionFailure
              ? recovery.plan.baseline[step.environment][step.role]
              : recovery.plan.baseline[step.role]),
        "release-state",
        "Restoration source differs from the saved environment version."
      );
      if (record.state !== "prepared")
        serviceAssert(
          record.restore_to ===
            (productionFailure
              ? recovery.plan.baseline[step.environment][step.role]
              : recovery.plan.baseline[step.role]) &&
            /^[0-9a-f]{40}$/u.test(record.restore_tree ?? "") &&
            record.integration_version === 1 &&
            serviceHash(record.integration_input) ===
              serviceHash(
                integrationCommitInput(record, {
                  commit: productionFailure
                    ? recovery.plan.starting_versions[step.environment][
                        step.role
                      ]
                    : recovery.plan.starting_versions[step.role],
                  tree: record.restore_tree
                })
              ) &&
            (record.state === "commit-prepared"
              ? !record.integration_commit
              : /^[0-9a-f]{40}$/u.test(record.integration_commit ?? "")),
          "release-state",
          "Restoration commit lacks its exact saved input."
        );
      if (record.result)
        serviceAssert(
          ["passed", "failed"].includes(record.result.status) &&
            (record.result.status !== "passed" ||
              (/^[0-9a-f]{40}$/u.test(record.result.commit ?? "") &&
                record.result.tree === record.restore_tree)) &&
            (!record.branch || record.cleanup === "removed"),
          "release-state",
          "Restoration merge lacks exact tree or cleanup evidence."
        );
    } else {
      if (record.operation) {
        validateReleaseOperation(record.operation);
        serviceAssert(
          serviceHash(record.operation) ===
            serviceHash(
              operationForStep(
                execution.plan,
                step,
                productionFailure ? versions[step.environment] : versions,
                record.id
              )
            ),
          "release-state",
          "Restoration check uses different environment versions."
        );
        if (record.result?.report)
          verifyReleaseReport(record.result.report, record.operation);
      }
      if (record.state === "completed")
        serviceAssert(
          record.operation && record.result?.report,
          "release-state",
          "Completed restoration check lacks its exact report."
        );
    }
    if (index < recovery.step_index) {
      serviceAssert(
        record.state === "completed" && record.result?.status === "passed",
        "release-state",
        "Completed restoration position has no passing result."
      );
      if (step.kind === "integrate") {
        if (productionFailure)
          versions[step.environment][step.role] = record.result.commit;
        else versions[step.role] = record.result.commit;
      }
    }
  }
  // The completed v4 sandbox restoration predates the final branch readback.
  // Its saved merge, deploy and E2E results remain readable as historical
  // evidence. New v5 releases must save the final readback before completion.
  const historicalCompletedRestoration =
    !productionFailure &&
    batch.policy.version === "sandbox-batch-v4" &&
    batch.status === "finished" &&
    recovery.status === "completed" &&
    recovery.verification === undefined;
  serviceAssert(
    serviceHash(recovery.versions) === serviceHash(versions) &&
      (recovery.status !== "completed" ||
        (recovery.step_index === recovery.plan.steps.length &&
          (historicalCompletedRestoration ||
            (recovery.verification?.staging &&
              recovery.verification?.prod &&
              serviceHash(recovery.verification.staging) ===
                serviceHash(
                  productionFailure
                    ? recovery.versions.staging
                    : recovery.versions
                ) &&
              serviceHash(recovery.verification?.prod) ===
                serviceHash(
                  productionFailure
                    ? recovery.versions.prod
                    : execution.versions.prod
                ) &&
              Number.isFinite(Date.parse(recovery.verification?.checked_at)) &&
              ["backend", "frontend"].every((role) =>
                ["staging", ...(productionFailure ? ["prod"] : [])].every(
                  (environment) =>
                    /^[0-9a-f]{40}$/u.test(
                      productionFailure
                        ? (recovery.verification?.trees?.[environment]?.[
                            role
                          ] ?? "")
                        : (recovery.verification?.trees?.[role] ?? "")
                    )
                )
              ) &&
              recovery.plan.steps
                .filter((step) => step.kind === "integrate")
                .every((step) => {
                  const tree = productionFailure
                    ? recovery.verification.trees[step.environment][step.role]
                    : recovery.verification.trees[step.role];
                  return tree === recovery.operations[step.id].restore_tree;
                }))))) &&
      (recovery.status !== "needs-human" ||
        recovery.operations[recovery.plan.steps[recovery.step_index]?.id]
          ?.result?.status === "failed"),
    "release-state",
    "Restoration position or final versions are inconsistent."
  );
}
