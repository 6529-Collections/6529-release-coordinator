import { randomUUID } from "node:crypto";
import { loggedStep, logOutcome } from "./run-log.mjs";
import {
  makeStagingRecoveryPlan,
  makeReleasePlan,
  operationForStep,
  selectedPreparation,
  validateStagingRecoveryPlan,
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
      batch_status: "stale",
      code: "release-unverified",
      message:
        "The saved batch is stale, so its release result cannot complete this ticket.",
      execution
    };
  if (execution?.status === "completed")
    return {
      status: "completed",
      batch_status: "passed",
      code: "release-completed",
      message: `The exact selected sandbox batch passed ${execution.plan.target === "production" ? "staging and production" : "staging"} deployment checks and matching E2E.`,
      execution
    };
  if (execution?.status === "needs-human")
    return {
      status: "blocked",
      batch_status: "passed",
      code: "release-failed",
      message: execution.message,
      execution
    };
  return {
    status: "waiting",
    batch_status: "passed",
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
  serviceAssert(
    batch.stop?.status !== "stale",
    "release-stale",
    "A stale batch cannot start or resume release execution."
  );
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
  const databaseChange =
    selectedPreparation(batch).prepared.service_plan.database.observed ===
    "yes";
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
  const restoreStaging = async () => {
    const recovery = execution.recovery;
    validateStagingRecoveryPlan(recovery.plan, execution, batch);
    recovery.status = "running";
    while (recovery.step_index < recovery.plan.steps.length) {
      const step = recovery.plan.steps[recovery.step_index];
      let record = recovery.operations[step.id];
      if (!record) {
        record = {
          id: uuid(),
          release_id: execution.plan.release_id,
          step,
          state: "prepared",
          created_at: now().toISOString(),
          result: null
        };
        recovery.operations[step.id] = record;
        await persist(`restore step ${step.id} prepared`);
      }
      const versions = recovery.versions;
      let result;
      if (step.kind === "integrate") {
        record.actor ??= execution.actor;
        result = await loggedStep(
          {
            step: "release.restore",
            operation_id: record.id,
            role: step.role,
            message: `Restore the saved ${step.role} sandbox staging tree.`
          },
          () =>
            client.restore({
              record,
              restoreTo: recovery.plan.baseline[step.role],
              expectedBase: versions[step.role],
              actor: execution.actor,
              save: () => persist(`restore step ${step.id} progress`)
            }),
          (value) => ({ outcome: logOutcome(value.status), url: value.url })
        );
        if (successful(result))
          recovery.versions = { ...versions, [step.role]: result.commit };
      } else {
        serviceAssert(
          /^[0-9a-f]{40}$/u.test(versions.backend ?? "") &&
            /^[0-9a-f]{40}$/u.test(versions.frontend ?? ""),
          "release-recovery",
          "Both restored staging versions are required before checks."
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
        await persist(`restore step ${step.id} operation`);
        result = await loggedStep(
          {
            step: `release.restore.${step.kind}`,
            operation_id: record.id,
            role: step.role,
            message: `Check the restored ${step.environment} ${step.id}.`
          },
          () =>
            client.run({
              record,
              actor: execution.actor,
              save: () => persist(`restore step ${step.id} progress`)
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
        recovery.status = "needs-human";
        recovery.completed_at = now().toISOString();
        execution.status = "needs-human";
        execution.completed_at = recovery.completed_at;
        execution.message = `${recovery.plan.failed_step} failed. Staging restoration stopped at ${step.id}; a person must inspect staging. Test production was not changed.`;
        await persist(`restore step ${step.id} failed`);
        return execution;
      }
      recovery.step_index++;
      await persist(`restore step ${step.id} passed`);
    }
    const restoredTrees = Object.fromEntries(
      recovery.plan.steps
        .filter((step) => step.kind === "integrate")
        .map((step) => [step.role, recovery.operations[step.id].restore_tree])
    );
    recovery.verification = {
      ...(await client.verifyRestoredStaging({
        versions: recovery.versions,
        trees: restoredTrees,
        prodVersions: execution.versions.prod
      })),
      checked_at: now().toISOString()
    };
    recovery.status = "completed";
    recovery.completed_at = now().toISOString();
    execution.status = "needs-human";
    execution.completed_at = recovery.completed_at;
    execution.message = `${recovery.plan.failed_step} failed. Sandbox staging was restored and its matching E2E passed; test production was not changed.`;
    await persist(`release ${execution.plan.release_id} staging restored`);
    return execution;
  };
  if (execution.status === "recovering") return restoreStaging();
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
      const restoration =
        result?.status === "failed"
          ? makeStagingRecoveryPlan(execution, batch)
          : null;
      if (restoration) {
        execution.status = "recovering";
        execution.recovery = {
          status: "prepared",
          plan: restoration,
          step_index: 0,
          operations: {},
          versions: { ...restoration.starting_versions },
          started_at: now().toISOString(),
          completed_at: null
        };
        execution.message = `${step.id} failed. Restoring the saved sandbox staging versions before this run finishes.`;
        await persist(
          `release step ${step.id} failed; staging restoration prepared`
        );
        return restoreStaging();
      }
      execution.status = "needs-human";
      execution.message = databaseChange
        ? `${step.id} failed. This sandbox ticket changes the database. The release stopped without automatic restoration; a person must inspect the ${step.environment} state before another release.`
        : `${step.id} failed. The sandbox release stopped; no later environment was changed.`;
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
