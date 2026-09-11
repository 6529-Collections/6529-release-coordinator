import {
  validateReleaseOperation,
  verifyReleaseReport
} from "./release-contract.mjs";
import { validateReleasePlan } from "./release-plan.mjs";
import { serviceAssert, serviceHash } from "./service-contract.mjs";

const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");

export function validateReleaseExecution(execution, batch) {
  serviceAssert(
    execution?.version === 1 &&
      ["prepared", "running", "completed", "needs-human"].includes(
        execution.status
      ) &&
      Number.isSafeInteger(execution.step_index) &&
      execution.step_index >= 0 &&
      execution.step_index <= execution.plan?.steps?.length &&
      execution.operations &&
      typeof execution.operations === "object" &&
      !Array.isArray(execution.operations) &&
      execution.versions &&
      typeof execution.versions === "object" &&
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
        [
          "prepared",
          "branch-prepared",
          "creating-pr",
          "checking",
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
    if (index < execution.step_index)
      serviceAssert(
        record.state === "completed" && record.result,
        "release-state",
        "Completed release position has no saved result."
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
  return execution;
}
