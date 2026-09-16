import {
  validateReleaseOperation,
  verifyReleaseReport
} from "./release-contract.mjs";
import {
  integrationCommitInput,
  operationForStep,
  validateReleasePlan,
  validateStagingRecoveryPlan
} from "./release-plan.mjs";
import { serviceAssert, serviceHash } from "./service-contract.mjs";

const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");

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
    validateStagingRecovery(execution, batch, ids);
  return execution;
}

function validateStagingRecovery(execution, batch, ids) {
  const recovery = execution.recovery;
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
      Object.keys(recovery.versions).length === 2 &&
      ["backend", "frontend"].every((role) =>
        /^[0-9a-f]{40}$/u.test(recovery.versions[role] ?? "")
      ) &&
      Number.isFinite(Date.parse(recovery.started_at)) &&
      (recovery.completed_at === null ||
        Number.isFinite(Date.parse(recovery.completed_at))) &&
      ["recovering", "needs-human"].includes(execution.status),
    "release-state",
    "Invalid sandbox staging restoration state."
  );
  validateStagingRecoveryPlan(recovery.plan, execution, batch);
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
    "Restoration is not attached to a failed staging step."
  );
  const versions = { ...recovery.plan.starting_versions };
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
      "Invalid or repeated staging restoration operation."
    );
    ids.add(record.id);
    if (step.kind === "integrate") {
      serviceAssert(
        !record.restore_to ||
          record.restore_to === recovery.plan.baseline[step.role],
        "release-state",
        "Restoration source differs from the saved staging version."
      );
      if (record.state !== "prepared")
        serviceAssert(
          record.restore_to === recovery.plan.baseline[step.role] &&
            /^[0-9a-f]{40}$/u.test(record.restore_tree ?? "") &&
            record.integration_version === 1 &&
            serviceHash(record.integration_input) ===
              serviceHash(
                integrationCommitInput(record, {
                  commit: recovery.plan.starting_versions[step.role],
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
              operationForStep(execution.plan, step, versions, record.id)
            ),
          "release-state",
          "Restoration check uses different staging versions."
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
      if (step.kind === "integrate") versions[step.role] = record.result.commit;
    }
  }
  // The completed v4 sandbox restoration predates the final branch readback.
  // Its saved merge, deploy and E2E results remain readable as historical
  // evidence. New v5 releases must save the final readback before completion.
  const historicalCompletedRestoration =
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
              serviceHash(recovery.verification?.staging) ===
                serviceHash(recovery.versions) &&
              serviceHash(recovery.verification?.prod) ===
                serviceHash(execution.versions.prod) &&
              Number.isFinite(Date.parse(recovery.verification?.checked_at)) &&
              ["backend", "frontend"].every((role) =>
                /^[0-9a-f]{40}$/u.test(
                  recovery.verification?.trees?.[role] ?? ""
                )
              ) &&
              recovery.plan.steps
                .filter((step) => step.kind === "integrate")
                .every(
                  (step) =>
                    recovery.verification.trees[step.role] ===
                    recovery.operations[step.id].restore_tree
                ))))) &&
      (recovery.status !== "needs-human" ||
        recovery.operations[recovery.plan.steps[recovery.step_index]?.id]
          ?.result?.status === "failed"),
    "release-state",
    "Restoration position or final versions are inconsistent."
  );
}
