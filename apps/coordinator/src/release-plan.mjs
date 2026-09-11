import { randomUUID } from "node:crypto";
import {
  makeReleaseOperation,
  releaseBackendUnits,
  releaseHash
} from "./release-contract.mjs";
import { serviceAssert } from "./service-contract.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");
const environments = (target) =>
  target === "production" ? ["staging", "prod"] : ["staging"];

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
      serviceAssert(
        publication &&
          sha(publication.base) &&
          sha(publication.tree) &&
          (publication.patch.length === 0
            ? publication.tree === publication.base_tree ||
              !publication.base_tree
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
    batch.policy?.version === "sandbox-batch-v2" &&
      batch.status === "finished" &&
      batch.selected.length > 0,
    "release-input",
    "Only a selected v2 sandbox batch can enter release execution."
  );
  const targets = [
    ...new Set(
      batch.inputs
        .filter(({ number }) => batch.selected.includes(number))
        .map(({ target }) => target)
    )
  ];
  serviceAssert(
    targets.length === 1 && ["staging", "production"].includes(targets[0]),
    "release-input",
    "A release batch must have one shared target."
  );
  const { prepared, commits } = selectedPreparation(batch);
  const releaseId = nextUuid();
  serviceAssert(uuid(releaseId), "release-input", "Invalid release identity.");
  const steps = [];
  for (const environment of environments(targets[0])) {
    for (const role of ["backend", "frontend"])
      steps.push({
        id: `${environment}:integrate:${role}`,
        kind: "integrate",
        environment,
        role
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

export function operationForStep(plan, step, versions, operationId) {
  return makeReleaseOperation({
    release_id: plan.release_id,
    operation_id: operationId,
    operation: step.kind,
    environment: step.environment,
    role: step.kind === "e2e" ? null : step.role,
    unit: step.kind === "deploy" ? step.unit : null,
    backend_commit: versions.backend,
    frontend_commit: versions.frontend
  });
}
