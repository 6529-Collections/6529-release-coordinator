import { randomUUID } from "node:crypto";
import { loggedStep, logOutcome } from "./run-log.mjs";
import {
  makeReleasePlan,
  operationForStep,
  validateReleasePlan
} from "./release-plan.mjs";
import { serviceAssert } from "./service-contract.mjs";

const successful = (result) => result?.status === "passed";

export function releaseTicketResult(batch, number) {
  const execution = batch.execution;
  if (!batch.selected.includes(number)) return null;
  if (batch.stop?.status === "stale")
    return {
      status: "waiting",
      code: "release-unverified",
      message:
        "The saved batch is stale, so its release result cannot complete this ticket.",
      execution
    };
  if (execution?.status === "completed")
    return {
      status: "completed",
      code: "release-completed",
      message: `The exact selected sandbox batch passed ${execution.plan.target === "production" ? "staging and production" : "staging"} deployment checks and matching E2E.`,
      execution
    };
  if (execution?.status === "needs-human")
    return {
      status: "blocked",
      code: "release-failed",
      message: execution.message,
      execution
    };
  return {
    status: "waiting",
    code: "release-unverified",
    message: "The selected batch has no complete sandbox release result.",
    execution
  };
}

export async function executeRelease({
  batch,
  client,
  save,
  guard,
  signal,
  uuid = randomUUID,
  now = () => new Date()
}) {
  const execution = batch.execution
    ? structuredClone(batch.execution)
    : {
        version: 1,
        plan: makeReleasePlan(batch, { uuid }),
        status: "prepared",
        step_index: 0,
        operations: {},
        versions: {},
        started_at: now().toISOString(),
        completed_at: null,
        message: "Sandbox release is prepared."
      };
  validateReleasePlan(execution.plan, batch);
  serviceAssert(
    execution.status !== "completed" ||
      execution.step_index === execution.plan.steps.length,
    "release-state",
    "Terminal release state has an incomplete step position."
  );
  if (["completed", "needs-human"].includes(execution.status)) return execution;
  const persist = async (message) => {
    signal?.throwIfAborted();
    await guard();
    batch.execution = structuredClone(execution);
    await save(message);
  };
  if (execution.status === "prepared") {
    const identity = await client.identity();
    execution.actor = identity.actor;
    execution.runtime = identity.runtime;
    execution.versions = identity.versions;
    execution.status = "running";
    execution.message = "Sandbox release is running.";
    await persist(`release ${execution.plan.release_id} started`);
  }
  while (execution.step_index < execution.plan.steps.length) {
    const step = execution.plan.steps[execution.step_index];
    let record = execution.operations[step.id];
    if (!record) {
      record = {
        id: uuid(),
        release_id: execution.plan.release_id,
        step,
        state: "prepared",
        created_at: now().toISOString(),
        result: null
      };
      execution.operations[step.id] = record;
      await persist(`release step ${step.id} prepared`);
    }
    const versions = execution.versions[step.environment] ?? {};
    let result;
    if (step.kind === "integrate") {
      record.actor ??= execution.actor;
      result = await loggedStep(
        {
          step: "release.integrate",
          operation_id: record.id,
          role: step.role,
          message: `Put the exact ${step.role} candidate on sandbox ${step.environment}.`
        },
        () =>
          client.integrate({
            record,
            candidate: execution.plan.candidates[step.role],
            actor: execution.actor,
            expectedBase: versions[step.role],
            save: () => persist(`release step ${step.id} progress`)
          }),
        (value) => ({ outcome: logOutcome(value.status), url: value.url })
      );
      if (successful(result)) {
        execution.versions[step.environment] = {
          ...versions,
          [step.role]: result.commit
        };
      }
    } else {
      serviceAssert(
        /^[0-9a-f]{40}$/u.test(versions.backend ?? "") &&
          /^[0-9a-f]{40}$/u.test(versions.frontend ?? ""),
        "release-state",
        "Both exact environment versions are required before checks."
      );
      record.operation ??= operationForStep(
        execution.plan,
        step,
        versions,
        record.id
      );
      const workflowRole = step.kind === "e2e" ? "backend" : step.role;
      record.actor ??= execution.actor;
      record.workflow_id ??= execution.runtime?.[workflowRole]?.workflow_id;
      await persist(`release step ${step.id} operation`);
      result = await loggedStep(
        {
          step: `release.${step.kind}`,
          operation_id: record.id,
          role: step.role,
          message:
            step.kind === "e2e"
              ? `Run matching ${step.environment} E2E.`
              : `Run ${step.role} ${step.unit} sandbox deployment check.`
        },
        () =>
          client.run({
            record,
            actor: execution.actor,
            save: () => persist(`release step ${step.id} progress`)
          }),
        (value) => ({
          outcome: logOutcome(value.status),
          url: value.workflow?.url
        })
      );
    }
    record.result = result;
    record.state = "completed";
    if (!successful(result)) {
      // A confirmed failure after a shared branch changes needs a person. This
      // version deliberately does not claim automatic rollback.
      execution.status = "needs-human";
      execution.message = `${step.id} failed. The sandbox release stopped; no later environment was changed.`;
      execution.completed_at = now().toISOString();
      await persist(`release step ${step.id} failed`);
      return execution;
    }
    execution.step_index++;
    await persist(`release step ${step.id} passed`);
  }
  execution.status = "completed";
  execution.completed_at = now().toISOString();
  execution.message =
    "Every required sandbox deployment and matching E2E passed.";
  await persist(`release ${execution.plan.release_id} completed`);
  return execution;
}
