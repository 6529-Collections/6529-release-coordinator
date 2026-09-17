import { randomUUID } from "node:crypto";
import { isReleaseBatchPolicy } from "./batch-plan.mjs";
import {
  makeReleaseOperation,
  releaseBackendUnits,
  releaseHash,
  releaseMonitoringEnvironments,
  releaseMonitoringUnit
} from "./release-contract.mjs";
import { databaseBatchPolicies } from "./batch-plan.mjs";
import { serviceAssert } from "./service-contract.mjs";
import {
  isReleaseRequestTarget,
  releaseEnvironmentsForTarget
} from "./release-target.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");
export function selectedPreparation(batch) {
  const check = batch.attempts.find(
    (attempt) =>
      attempt.phase === "checks" &&
      attempt.members.join(",") === batch.selected.join(",") &&
      attempt.result?.status === "passed"
  );
  const prepared = batch.attempts.find(
    (attempt) =>
      attempt.phase === "git" &&
      attempt.members.join(",") === batch.selected.join(",") &&
      attempt.result?.status === "passed"
  )?.result;
  serviceAssert(
    check?.progress?.cleanup === "removed" && prepared,
    "release-input",
    "The selected batch has no exact passing and cleaned candidate."
  );
  const commits = Object.fromEntries(
    ["backend", "frontend"].map((role) => {
      const publication = prepared.publications.find(
        (value) => value.role === role
      );
      const trial = check.progress.prs.find((value) => value.role === role);
      const savedCandidate = batch.execution?.plan?.candidates?.[role];
      const savedLegacyUnchanged =
        !publication?.base_tree &&
        savedCandidate?.changed === false &&
        savedCandidate.base === publication?.base &&
        savedCandidate.tree === publication?.tree &&
        savedCandidate.commit === publication?.base;
      serviceAssert(
        publication &&
          sha(publication.base) &&
          sha(publication.tree) &&
          (publication.patch.length === 0
            ? (sha(publication.base_tree) &&
                publication.tree === publication.base_tree) ||
              savedLegacyUnchanged
            : sha(trial?.commit) && trial.tree === publication.tree),
        "release-input",
        `The ${role} selected candidate commit is unavailable.`
      );
      return [
        role,
        {
          role,
          repository: publication.repository,
          base: publication.base,
          tree: publication.tree,
          commit: trial?.commit ?? publication.base,
          changed: publication.patch.length > 0
        }
      ];
    })
  );
  return { prepared, check, commits };
}

export function makeReleasePlan(batch, { uuid: nextUuid = randomUUID } = {}) {
  serviceAssert(
    isReleaseBatchPolicy(batch.policy) &&
      batch.status === "finished" &&
      batch.selected.length > 0,
    "release-input",
    "Only a selected release-capable sandbox batch can enter release execution."
  );
  const targets = [
    ...new Set(
      batch.inputs
        .filter(({ number }) => batch.selected.includes(number))
        .map(({ target }) => target)
    )
  ];
  serviceAssert(
    targets.length === 1 && isReleaseRequestTarget(targets[0]),
    "release-input",
    "A release batch must have one shared target."
  );
  const { prepared, commits } = selectedPreparation(batch);
  const database = prepared.service_plan.database;
  serviceAssert(
    ["no", "yes"].includes(database?.declared) &&
      database.declared === database.observed &&
      batch.inputs
        .filter((input) => batch.selected.includes(input.number))
        .every(
          (input) => (input.database_change ?? "no") === database.declared
        ) &&
      (database.declared !== "yes" ||
        (databaseBatchPolicies.includes(batch.policy.version) &&
          batch.selected.length === 1 &&
          batch.inputs.length === 1 &&
          prepared.service_plan.steps.some(
            (step) =>
              step.role === "backend" && step.unit === "dbMigrationsLoop"
          ))),
    "release-input",
    "A database-changing sandbox release needs one verified ticket and its database service."
  );
  const releaseId = nextUuid();
  serviceAssert(uuid(releaseId), "release-input", "Invalid release identity.");
  const monitoring = batch.inputs.some(
    (input) =>
      batch.selected.includes(input.number) &&
      (input.operational_deployments ?? []).includes(releaseMonitoringUnit)
  );
  const steps = [];
  for (const environment of releaseEnvironmentsForTarget(targets[0])) {
    steps.push({
      id: `${environment}:integrate:backend`,
      kind: "integrate",
      environment,
      role: "backend"
    });
    // The sample backend deploys monitoring only from test main, for both
    // monitoring environments, before any production application change.
    if (monitoring && environment === "prod")
      for (const monitoringEnvironment of releaseMonitoringEnvironments)
        steps.push({
          id: `prod:monitoring:${monitoringEnvironment}`,
          kind: "monitoring",
          environment,
          role: "backend",
          unit: releaseMonitoringUnit,
          monitoring_environment: monitoringEnvironment
        });
    steps.push({
      id: `${environment}:integrate:frontend`,
      kind: "integrate",
      environment,
      role: "frontend"
    });
    // Execution later keeps these steps in their declared dependency order,
    // but backend always completes before frontend is exposed.
    for (const step of prepared.service_plan.steps.filter(
      (value) => value.role === "backend"
    )) {
      serviceAssert(
        releaseBackendUnits.includes(step.unit),
        "release-input",
        "The sandbox release plan contains an unsupported backend unit."
      );
      steps.splice(steps.length - 1, 0, {
        id: `${environment}:deploy:backend:${step.unit}`,
        kind: "deploy",
        environment,
        role: "backend",
        unit: step.unit
      });
    }
    steps.push({
      id: `${environment}:deploy:frontend:frontend`,
      kind: "deploy",
      environment,
      role: "frontend",
      unit: "frontend"
    });
    steps.push({
      id: `${environment}:e2e`,
      kind: "e2e",
      environment,
      role: null
    });
  }
  const contents = {
    version: 1,
    profile: "sandbox",
    release_id: releaseId,
    batch_fingerprint: batch.fingerprint,
    target: targets[0],
    tickets: [...batch.selected],
    candidates: commits,
    steps
  };
  return { ...contents, fingerprint: releaseHash(contents) };
}

export function validateReleasePlan(plan, batch) {
  const { fingerprint, ...contents } = plan ?? {};
  const expected = makeReleasePlan(batch, { uuid: () => plan?.release_id });
  serviceAssert(
    releaseHash(contents) === fingerprint &&
      releaseHash(expected) === releaseHash(plan),
    "release-state",
    "Saved release plan differs from the exact selected batch."
  );
  return plan;
}

function recoveryStartingPoint(execution, environment) {
  const startingVersions = execution.versions[environment];
  const changed = ["backend", "frontend"].filter(
    (role) =>
      execution.operations[`${environment}:integrate:${role}`]?.result?.kind ===
      "merge"
  );
  serviceAssert(
    changed.every((role) => {
      const record = execution.operations[`${environment}:integrate:${role}`];
      return (
        record.state === "completed" &&
        record.cleanup === "removed" &&
        record.result?.status === "passed" &&
        record.result.commit === startingVersions?.[role] &&
        sha(record.base)
      );
    }),
    "release-recovery",
    `The saved ${environment} merges cannot identify exact restoration bases.`
  );
  const baseline = Object.fromEntries(
    ["backend", "frontend"].map((role) => [
      role,
      changed.includes(role)
        ? execution.operations[`${environment}:integrate:${role}`].base
        : startingVersions?.[role]
    ])
  );
  serviceAssert(
    ["backend", "frontend"].every(
      (role) => sha(baseline[role]) && sha(startingVersions?.[role])
    ),
    "release-recovery",
    `The failed ${environment} release lacks exact starting and changed versions.`
  );
  return { startingVersions, changed, baseline };
}

function recoverySteps(execution, environment, changed) {
  if (!changed.length) return [];
  return [
    ...changed.map((role) => ({
      id: `restore:${environment}:integrate:${role}`,
      kind: "integrate",
      environment,
      role,
      recovery: true
    })),
    ...execution.plan.steps
      .filter(
        (step) =>
          step.environment === environment &&
          ["deploy", "e2e", "monitoring"].includes(step.kind)
      )
      .map((step) => ({ ...step, id: `restore:${step.id}` }))
  ];
}

function confirmedRecoverableFailure(execution, batch) {
  const failed = execution.plan.steps[execution.step_index];
  const database = selectedPreparation(batch).prepared.service_plan.database;
  return failed &&
    execution.operations[failed.id]?.result?.status === "failed" &&
    database?.declared === "no" &&
    database?.observed === "no"
    ? failed
    : null;
}

export function makeStagingRecoveryPlan(execution, batch) {
  const failed = confirmedRecoverableFailure(execution, batch);
  if (failed?.environment !== "staging") return null;
  if (
    !["backend", "frontend"].some(
      (role) =>
        execution.operations[`staging:integrate:${role}`]?.result?.kind ===
        "merge"
    )
  )
    return null;
  const { startingVersions, changed, baseline } = recoveryStartingPoint(
    execution,
    "staging"
  );
  if (!changed.length) return null;
  const steps = recoverySteps(execution, "staging", changed);
  const contents = {
    version: 1,
    failed_step: failed.id,
    baseline,
    starting_versions: { ...startingVersions },
    steps
  };
  return { ...contents, fingerprint: releaseHash(contents) };
}

export function makeProductionRecoveryPlan(execution, batch) {
  const failed = confirmedRecoverableFailure(execution, batch);
  if (failed?.environment !== "prod") return null;
  serviceAssert(
    execution.operations["staging:e2e"]?.result?.status === "passed",
    "release-recovery",
    "Production restoration needs the saved passing staging E2E."
  );
  const prod = recoveryStartingPoint(execution, "prod");
  const staging = recoveryStartingPoint(execution, "staging");
  if (!prod.changed.length && !staging.changed.length) return null;
  const contents = {
    version: 2,
    failed_step: failed.id,
    baseline: { prod: prod.baseline, staging: staging.baseline },
    starting_versions: {
      prod: { ...prod.startingVersions },
      staging: { ...staging.startingVersions }
    },
    steps: [
      ...recoverySteps(execution, "prod", prod.changed),
      ...recoverySteps(execution, "staging", staging.changed)
    ]
  };
  return { ...contents, fingerprint: releaseHash(contents) };
}

export function validateRecoveryPlan(plan, execution, batch) {
  const expected =
    plan?.version === 1
      ? makeStagingRecoveryPlan(execution, batch)
      : plan?.version === 2
        ? makeProductionRecoveryPlan(execution, batch)
        : null;
  serviceAssert(
    expected && releaseHash(plan) === releaseHash(expected),
    "release-state",
    "Saved restoration differs from the failed release."
  );
  return plan;
}

export function integrationCommitInput(record, candidate) {
  const signature = {
    name: "Coordinator sandbox",
    email: "rehearsal@example.invalid",
    date: record.created_at
  };
  return {
    message: record.step.recovery
      ? `Sandbox ${record.step.environment} restoration for ${record.release_id}\n\nRestore ${record.restore_to} after ${candidate.commit}`
      : `Sandbox ${record.step.environment} candidate for ${record.release_id}\n\nExact selected candidate ${candidate.commit}`,
    tree: candidate.tree,
    parents: [candidate.commit],
    author: signature,
    committer: signature
  };
}

export function operationForStep(plan, step, versions, operationId) {
  return makeReleaseOperation({
    release_id: plan.release_id,
    operation_id: operationId,
    operation: step.kind,
    environment: step.environment,
    role: step.kind === "e2e" ? null : step.role,
    unit: ["deploy", "monitoring"].includes(step.kind) ? step.unit : null,
    backend_commit: versions.backend,
    frontend_commit: versions.frontend,
    ...(step.kind === "monitoring"
      ? { monitoring_environment: step.monitoring_environment }
      : {})
  });
}
