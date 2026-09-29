import { randomUUID } from "node:crypto";
import { loggedStep, logOutcome } from "./run-log.mjs";
import {
  makeProductionRecoveryPlan,
  makeStagingRecoveryPlan,
  makeReleasePlan,
  operationForStep,
  selectedPreparation,
  validateRecoveryPlan,
  validateReleasePlan
} from "./release-plan.mjs";
import { serviceAssert } from "./service-contract.mjs";

const successful = (result) => result?.status === "passed";
const requestsMonitoring = (batch) =>
  batch.inputs.some(
    (input) =>
      batch.selected.includes(input.number) &&
      (input.operational_deployments ?? []).includes("monitoring")
  );
function monitoringNote(batch, execution) {
  if (!requestsMonitoring(batch)) return "";
  if (execution.plan.version === 2)
    return execution.plan.target === "production"
      ? " Operational monitoring was deployed from staging to staging and from main to production, before each environment's application deployments."
      : " Operational monitoring was deployed from staging to staging before its application deployments.";
  return execution.plan.target === "production"
    ? ` Operational monitoring was deployed for staging and production from the merged ${execution.plan.profile === "sandbox" ? "test " : ""}main commit before the production application deployments.`
    : ` Operational monitoring in this request was not deployed: monitoring deploys only from ${execution.plan.profile === "sandbox" ? "test " : ""}main, so it deploys with the production release of this change.`;
}

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
  if (execution?.status === "awaiting-staging-choice") {
    const drift = execution.staging_drift;
    serviceAssert(
      ["expected", "observed"].every((pair) =>
        ["backend", "frontend"].every((role) =>
          /^[0-9a-f]{40}$/u.test(drift?.[pair]?.[role] ?? "")
        )
      ),
      "release-state",
      "Staging-change ticket projection lacks exact saved branch versions."
    );
    const timing =
      execution.operations?.["staging:e2e"]?.result?.status === "passed"
        ? "after E2E passed but before production"
        : "while E2E ran";
    return {
      status: "waiting",
      batch_status: "waiting",
      code: "release-staging-changed",
      message: `Staging changed from backend ${drift.expected.backend}, frontend ${drift.expected.frontend} to backend ${drift.observed.backend}, frontend ${drift.observed.frontend} ${timing}. Production has not started. Inspect the other deployment and choose a supported reconciliation path; the old E2E cannot authorize production.`,
      execution
    };
  }
  if (execution?.status === "completed")
    return {
      status: "completed",
      batch_status: "passed",
      code: "release-completed",
      message: `The exact selected ${execution.plan.profile} batch passed ${execution.plan.target === "production" ? "staging and production" : "staging"} deployment checks and matching E2E.${monitoringNote(batch, execution)}`,
      execution
    };
  if (execution?.status === "needs-human")
    return {
      status: "blocked",
      batch_status: "passed",
      code: execution.manual_stop ? "release-stopped" : "release-failed",
      message: execution.message,
      execution
    };
  return {
    status: "waiting",
    batch_status: "passed",
    code: "release-unverified",
    message: "The selected batch has no complete release result.",
    execution
  };
}

export async function executeRelease({
  batch,
  client,
  save,
  guard,
  signal,
  stagingChange,
  operator,
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
        message: "Release is prepared."
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
  const sameVersions = (left, right) =>
    ["backend", "frontend"].every((role) => left?.[role] === right?.[role]);
  let chosenStagingChange = false;
  const stagingDrift = async (record) => {
    const observed = await client.environmentVersions?.("staging");
    const expected = execution.versions.staging;
    serviceAssert(
      observed &&
        ["backend", "frontend"].every((role) =>
          /^[0-9a-f]{40}$/u.test(observed[role] ?? "")
        ) &&
        !sameVersions(observed, expected),
      "release-stale",
      "Staging changed, but its exact new branch versions could not be saved."
    );
    execution.staging_drift = {
      status: "awaiting-choice",
      detected_at: now().toISOString(),
      step_id: record.step.id,
      expected: { ...expected },
      observed: { ...observed },
      superseded: execution.staging_drift
        ? [structuredClone(execution.staging_drift)]
        : []
    };
    execution.status = "awaiting-staging-choice";
    execution.message =
      record.result?.status === "passed"
        ? "Staging changed after E2E passed but before production. Production is stopped. A maintainer must choose a fresh staging test or restore only this release's staging change."
        : "Staging changed while E2E was running. Production is stopped. A maintainer must choose a fresh staging test or restore only this release's staging change.";
    await persist("staging changed; awaiting explicit reconciliation choice");
    return execution;
  };
  const supportedStagingChoice = () => {
    const drift = execution.staging_drift;
    const frontend = execution.operations["staging:integrate:frontend"];
    serviceAssert(
      !databaseChange &&
        drift?.step_id === "staging:e2e" &&
        drift.expected.frontend === drift.observed.frontend &&
        drift.expected.backend !== drift.observed.backend &&
        execution.operations["staging:integrate:backend"]?.result?.kind !==
          "merge" &&
        !execution.plan.steps.some(
          (step) =>
            step.environment === "staging" &&
            (step.role === "backend" ||
              (step.kind === "deploy" && step.role !== "frontend"))
        ) &&
        frontend?.result?.kind === "merge" &&
        frontend?.result?.status === "passed" &&
        frontend.result.commit === drift.observed.frontend &&
        /^[0-9a-f]{40}$/u.test(frontend.base ?? ""),
      "release-recovery",
      "Automatic staging reconciliation is safe only when an unrelated backend ref moved during a no-database-change frontend release. Inspect other changes manually."
    );
    return frontend;
  };
  const checkStagingChoice = async () => {
    const drift = execution.staging_drift;
    serviceAssert(
      typeof client.waitForStagingQuiet === "function",
      "release-recovery",
      "The selected release adapter cannot verify that staging workflows are quiet."
    );
    await client.waitForStagingQuiet(execution.operations[drift.step_id], () =>
      persist("wait for staging workflows to finish")
    );
    serviceAssert(
      sameVersions(
        await client.environmentVersions?.("staging"),
        drift.observed
      ) &&
        sameVersions(
          await client.environmentVersions?.("prod"),
          execution.versions.prod
        ),
      "release-stale",
      "Staging or production moved again. No reconciliation action was started; inspect the new state."
    );
  };
  const restoreChangedStaging = async () => {
    const drift = execution.staging_drift;
    const restoration = drift.restoration;
    while (restoration.step_index < restoration.steps.length) {
      const step = restoration.steps[restoration.step_index];
      let record = restoration.operations[step.id];
      if (!record) {
        record = {
          id: uuid(),
          release_id: execution.plan.release_id,
          step,
          state: "prepared",
          created_at: now().toISOString(),
          result: null
        };
        restoration.operations[step.id] = record;
        await persist(`staging reconciliation step ${step.id} prepared`);
      }
      let result;
      if (step.kind === "integrate") {
        record.profile ??= execution.plan.profile;
        record.actor ??= execution.actor;
        result = await client.restore({
          record,
          restoreTo: restoration.baseline,
          expectedBase: restoration.versions.frontend,
          actor: execution.actor,
          save: () => persist(`staging reconciliation step ${step.id} progress`)
        });
        if (successful(result)) restoration.versions.frontend = result.commit;
      } else {
        record.operation ??= operationForStep(
          execution.plan,
          step,
          restoration.versions,
          record.id
        );
        record.actor ??= execution.actor;
        record.workflow_id ??=
          execution.runtime?.[
            step.kind === "e2e" ? "backend" : step.role
          ]?.workflow_id;
        await persist(`staging reconciliation step ${step.id} operation`);
        result = await client.run({
          record,
          actor: execution.actor,
          runtime: execution.runtime,
          operations: restoration.operations,
          steps: restoration.steps,
          save: () => persist(`staging reconciliation step ${step.id} progress`)
        });
      }
      record.result = result;
      record.state = "completed";
      if (!successful(result)) {
        restoration.status = "failed";
        drift.status = "failed";
        execution.status = "needs-human";
        execution.completed_at = now().toISOString();
        execution.message = `Staging reconciliation failed at ${step.id}; the lane remains locked and a person must inspect the environments. Production was not started.`;
        await persist(`staging reconciliation step ${step.id} failed`);
        return execution;
      }
      restoration.step_index++;
      await persist(`staging reconciliation step ${step.id} passed`);
    }
    const restoreTree =
      restoration.operations["restore:staging:integrate:frontend"].restore_tree;
    serviceAssert(
      /^[0-9a-f]{40}$/u.test(restoreTree ?? ""),
      "release-recovery",
      "The frontend staging restoration has no verified source tree."
    );
    restoration.verification = await client.verifyRestoredStaging({
      versions: restoration.versions,
      trees: { frontend: restoreTree },
      prodVersions: execution.versions.prod
    });
    serviceAssert(
      sameVersions(restoration.verification?.staging, restoration.versions) &&
        sameVersions(restoration.verification?.prod, execution.versions.prod) &&
        restoration.verification?.trees?.frontend === restoreTree,
      "release-recovery",
      "Restored staging or production readback does not match the saved versions and frontend tree."
    );
    restoration.status = "completed";
    drift.status = "restored";
    execution.status = "needs-human";
    execution.completed_at = now().toISOString();
    execution.message =
      "Only this release's frontend staging change was restored. The other developer's backend staging version was preserved; matching frontend deployment and E2E passed. Production was not started.";
    await persist("staging reconciliation restoration verified");
    return execution;
  };
  if (execution.status === "awaiting-staging-choice") {
    if (!stagingChange) return execution;
    serviceAssert(
      operator?.id &&
        /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(
          operator.login ?? ""
        ),
      "release-recovery",
      "An authenticated Coordinator operator is required for the staging decision."
    );
    supportedStagingChoice();
    await checkStagingChoice();
    if (stagingChange === "retest") {
      chosenStagingChange = true;
      const deployIndex = execution.plan.steps.findIndex(
        (step) =>
          step.environment === "staging" &&
          step.kind === "deploy" &&
          step.role === "frontend"
      );
      serviceAssert(
        deployIndex >= 0 &&
          deployIndex < execution.step_index &&
          (execution.plan.steps[execution.step_index]?.id === "staging:e2e" ||
            (execution.plan.steps[execution.step_index]?.environment ===
              "prod" &&
              execution.plan.steps[execution.step_index]?.kind ===
                "integrate" &&
              execution.operations[
                execution.plan.steps[execution.step_index].id
              ]?.state === "prepared")),
        "release-recovery",
        "The saved frontend deployment cannot be restarted for a fresh E2E."
      );
      const deployStep = execution.plan.steps[deployIndex];
      const drift = execution.staging_drift;
      drift.choice = "retest";
      drift.chosen_by = {
        id: String(operator.id),
        login: operator.login
      };
      drift.chosen_at = now().toISOString();
      drift.status = "retesting";
      drift.previous_deploy = structuredClone(
        execution.operations[deployStep.id]
      );
      drift.previous_e2e = structuredClone(execution.operations[drift.step_id]);
      delete execution.operations[deployStep.id];
      delete execution.operations[drift.step_id];
      execution.versions.staging.backend = drift.observed.backend;
      execution.step_index = deployIndex;
      execution.status = "running";
      execution.message =
        "A fresh frontend staging deployment and E2E are required for the changed backend version.";
      await persist("restart frontend deployment for fresh staging E2E");
    } else if (stagingChange === "restore") {
      const drift = execution.staging_drift;
      const frontend = supportedStagingChoice();
      drift.choice = "restore";
      drift.chosen_by = {
        id: String(operator.id),
        login: operator.login
      };
      drift.chosen_at = now().toISOString();
      drift.status = "restoring";
      drift.restoration = {
        status: "running",
        baseline: frontend.base,
        versions: { ...drift.observed },
        step_index: 0,
        steps: [
          {
            id: "restore:staging:integrate:frontend",
            kind: "integrate",
            environment: "staging",
            role: "frontend",
            recovery: true
          },
          {
            id: "restore:staging:deploy:frontend:frontend",
            kind: "deploy",
            environment: "staging",
            role: "frontend",
            unit: "frontend"
          },
          {
            id: "restore:staging:e2e",
            kind: "e2e",
            environment: "staging",
            role: null
          }
        ],
        operations: {}
      };
      execution.status = "reconciling-staging";
      await persist("restore only this release's frontend staging change");
      return restoreChangedStaging();
    }
  }
  if (execution.status === "reconciling-staging")
    return restoreChangedStaging();
  serviceAssert(
    !stagingChange || chosenStagingChange,
    "release-recovery",
    "A staging reconciliation choice requires a saved staging change."
  );
  const restoreEnvironments = async () => {
    const recovery = execution.recovery;
    validateRecoveryPlan(recovery.plan, execution, batch);
    const productionFailure = recovery.plan.version === 2;
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
      const versions = productionFailure
        ? recovery.versions[step.environment]
        : recovery.versions;
      let result;
      if (step.kind === "integrate") {
        record.profile ??= execution.plan.profile;
        record.actor ??= execution.actor;
        result = await loggedStep(
          {
            step: "release.restore",
            operation_id: record.id,
            role: step.role,
            message: `Restore the saved ${step.role} ${execution.plan.profile} ${step.environment} tree.`
          },
          () =>
            client.restore({
              record,
              restoreTo: productionFailure
                ? recovery.plan.baseline[step.environment][step.role]
                : recovery.plan.baseline[step.role],
              expectedBase: versions[step.role],
              actor: execution.actor,
              save: () => persist(`restore step ${step.id} progress`)
            }),
          (value) => ({ outcome: logOutcome(value.status), url: value.url })
        );
        if (successful(result)) {
          const updated = { ...versions, [step.role]: result.commit };
          if (productionFailure)
            recovery.versions = {
              ...recovery.versions,
              [step.environment]: updated
            };
          else recovery.versions = updated;
        }
      } else {
        serviceAssert(
          /^[0-9a-f]{40}$/u.test(versions.backend ?? "") &&
            /^[0-9a-f]{40}$/u.test(versions.frontend ?? ""),
          "release-recovery",
          `Both restored ${step.environment} versions are required before checks.`
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
              runtime: execution.runtime,
              operations: recovery.operations,
              steps: recovery.plan.steps,
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
        execution.message = `${recovery.plan.failed_step} failed. Restoration stopped at ${step.id}; a person must inspect the ${execution.plan.profile} environments before another release.`;
        await persist(`restore step ${step.id} failed`);
        return execution;
      }
      recovery.step_index++;
      await persist(`restore step ${step.id} passed`);
    }
    const restoredTrees = (environment) =>
      Object.fromEntries(
        recovery.plan.steps
          .filter(
            (step) =>
              step.kind === "integrate" && step.environment === environment
          )
          .map((step) => [step.role, recovery.operations[step.id].restore_tree])
      );
    const observed = productionFailure
      ? await client.verifyRestoredEnvironments({
          versions: recovery.versions,
          trees: {
            prod: restoredTrees("prod"),
            staging: restoredTrees("staging")
          }
        })
      : await client.verifyRestoredStaging({
          versions: recovery.versions,
          trees: restoredTrees("staging"),
          prodVersions: execution.versions.prod
        });
    recovery.verification = { ...observed, checked_at: now().toISOString() };
    recovery.status = "completed";
    recovery.completed_at = now().toISOString();
    execution.status = "needs-human";
    execution.completed_at = recovery.completed_at;
    execution.message = productionFailure
      ? `${recovery.plan.failed_step} failed. ${execution.plan.profile === "sandbox" ? "The test main and staging branches" : "The product main and staging branches"} were restored to their saved trees; their matching build and E2E checks passed. The release still needs a person.`
      : `${recovery.plan.failed_step} failed. staging was restored and its matching E2E passed; production was not changed.`;
    await persist(`release ${execution.plan.release_id} restoration completed`);
    return execution;
  };
  if (execution.status === "recovering") return restoreEnvironments();
  if (execution.status === "prepared") {
    const identity = await client.identity();
    serviceAssert(
      ["staging", "prod"].every((environment) =>
        ["backend", "frontend"].every((role) =>
          /^[0-9a-f]{40}$/u.test(identity.versions?.[environment]?.[role] ?? "")
        )
      ),
      "release-runtime",
      `Both exact ${execution.plan.profile === "sandbox" ? "sandbox " : ""}repository versions are required in staging and main before release execution.`
    );
    execution.actor = identity.actor;
    execution.runtime = identity.runtime;
    execution.versions = identity.versions;
    execution.status = "running";
    execution.message = `${execution.plan.profile === "sandbox" ? "Sandbox" : "Product"} release is running.`;
    await persist(`release ${execution.plan.release_id} started`);
  }
  const firstProdIndex = execution.plan.steps.findIndex(
    (candidate) => candidate.environment === "prod"
  );
  while (execution.step_index < execution.plan.steps.length) {
    const step = execution.plan.steps[execution.step_index];
    if (execution.step_index === firstProdIndex) {
      serviceAssert(
        typeof client.environmentVersions === "function",
        "release-recovery",
        "The release adapter cannot verify staging before production."
      );
      const currentStaging = await client.environmentVersions("staging");
      if (!sameVersions(currentStaging, execution.versions.staging)) {
        const productionRecord = execution.operations[step.id];
        serviceAssert(
          !productionRecord ||
            (productionRecord.state === "prepared" &&
              productionRecord.result === null &&
              !productionRecord.operation &&
              !productionRecord.integration_version &&
              !productionRecord.integration_commit),
          "release-recovery",
          "Staging moved after production work may have begun. Inspect the saved production operation manually before reconciliation."
        );
        const earlierE2e = execution.operations["staging:e2e"];
        serviceAssert(
          earlierE2e?.result?.status === "passed",
          "release-recovery",
          "Staging changed without a saved passing E2E; production remains stopped."
        );
        return stagingDrift(earlierE2e);
      }
    }
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
      record.profile ??= execution.plan.profile;
      record.actor ??= execution.actor;
      result = await loggedStep(
        {
          step: "release.integrate",
          operation_id: record.id,
          role: step.role,
          message: `Put the exact ${step.role} candidate on ${execution.plan.profile} ${step.environment}.`
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
      if (
        execution.staging_drift?.status === "retesting" &&
        step.environment === "staging" &&
        step.kind === "deploy" &&
        step.role === "frontend"
      )
        record.force_dispatch = true;
      const workflowRole = step.kind === "e2e" ? "backend" : step.role;
      record.actor ??= execution.actor;
      record.workflow_id ??= execution.runtime?.[workflowRole]?.workflow_id;
      await persist(`release step ${step.id} operation`);
      try {
        result = await loggedStep(
          {
            step: `release.${step.kind}`,
            operation_id: record.id,
            role: step.role,
            message:
              step.kind === "e2e"
                ? `Run matching ${step.environment} E2E.`
                : step.kind === "monitoring"
                  ? `Deploy monitoring for ${step.monitoring_environment} from ${step.environment === "staging" ? "staging" : "main"}.`
                  : `Run ${step.role} ${step.unit} ${execution.plan.profile} deployment check.`
          },
          () =>
            client.run({
              record,
              actor: execution.actor,
              runtime: execution.runtime,
              operations: execution.operations,
              steps: execution.plan.steps,
              save: () => persist(`release step ${step.id} progress`)
            }),
          (value) => ({
            outcome: logOutcome(value.status),
            url: value.workflow?.url
          })
        );
      } catch (error) {
        if (error?.code === "release-stale" && step.id === "staging:e2e")
          return stagingDrift(record);
        throw error;
      }
    }
    record.result = result;
    record.state = "completed";
    if (!successful(result)) {
      const restoration =
        result?.status === "failed"
          ? (makeStagingRecoveryPlan(execution, batch) ??
            makeProductionRecoveryPlan(execution, batch))
          : null;
      if (restoration) {
        execution.status = "recovering";
        execution.recovery = {
          status: "prepared",
          plan: restoration,
          step_index: 0,
          operations: {},
          versions: structuredClone(restoration.starting_versions),
          started_at: now().toISOString(),
          completed_at: null
        };
        execution.message = `${step.id} failed. Restoring the saved ${execution.plan.profile} environment versions before this run finishes.`;
        await persist(`release step ${step.id} failed; restoration prepared`);
        return restoreEnvironments();
      }
      execution.status = "needs-human";
      execution.message = databaseChange
        ? `${step.id} failed. This ticket changes the database. The release stopped without automatic restoration; a person must inspect the ${step.environment} state before another release.`
        : `${step.id} failed. The release stopped; no later environment was changed.`;
      execution.completed_at = now().toISOString();
      await persist(`release step ${step.id} failed`);
      return execution;
    }
    execution.step_index++;
    if (
      step.id === "staging:e2e" &&
      execution.staging_drift?.status === "retesting"
    )
      execution.staging_drift.status = "retested";
    await persist(`release step ${step.id} passed`);
  }
  execution.status = "completed";
  execution.completed_at = now().toISOString();
  execution.message = "Every required deployment and matching E2E passed.";
  await persist(`release ${execution.plan.release_id} completed`);
  return execution;
}
