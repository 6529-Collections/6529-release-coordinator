import { selectedPreparation } from "./release-plan.mjs";
import { serviceAssert, serviceHash } from "./service-contract.mjs";
import { realProfile } from "./profiles.mjs";

export const untouchedRefreshMarker = "untouched-release-refresh-v1";

const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");
const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const only = (value, keys) =>
  value && Object.keys(value).every((key) => keys.includes(key));
export const untouchedBranch = (execution) =>
  `codex/release-${execution.plan.release_id}-staging-frontend`;

// Deliberately exclude even commit-prepared checkpoints: absence of a result is
// not proof of absence of effects. Unknown/new fields require fresh review.
export function assertUntouchedRelease(batch, execution = batch?.execution) {
  const input = batch?.inputs?.[0];
  const record = execution?.operations?.["staging:integrate:frontend"];
  serviceAssert(
    batch?.status === "finished" &&
      !batch.stop &&
      batch.inputs.length === 1 &&
      batch.selected.length === 1 &&
      batch.selected[0] === input.number &&
      input.target === "production" &&
      input.database_change === "no" &&
      input.operational_deployments?.length === 0 &&
      input.input.repositories.length === 1 &&
      input.input.repositories[0].role === "frontend" &&
      selectedPreparation(batch).prepared.service_plan.database.observed ===
        "no" &&
      execution?.status === "running" &&
      execution.plan.profile === "real" &&
      execution.plan.target === "production" &&
      serviceHash(execution.plan.candidates.frontend?.repository) ===
        serviceHash(realProfile.repositories.frontend) &&
      execution.step_index === 0 &&
      execution.completed_at === null &&
      ["staging", "prod"].every((environment) =>
        ["backend", "frontend"].every((role) =>
          sha(execution.versions?.[environment]?.[role])
        )
      ) &&
      Object.keys(execution.plan.candidates).join() === "frontend" &&
      Object.keys(execution.operations).join() ===
        "staging:integrate:frontend" &&
      only(execution, [
        "version",
        "plan",
        "status",
        "step_index",
        "operations",
        "versions",
        "started_at",
        "completed_at",
        "message",
        "actor",
        "runtime"
      ]) &&
      record?.state === "prepared" &&
      record.result === null &&
      (record.profile === undefined || record.profile === "real") &&
      (record.actor === undefined ||
        serviceHash(record.actor) === serviceHash(execution.actor)) &&
      only(record, [
        "id",
        "release_id",
        "step",
        "state",
        "created_at",
        "result",
        "profile",
        "actor",
        "waited_for"
      ]) &&
      batch.attempts.every(
        (attempt) =>
          attempt.result &&
          (attempt.phase === "git" ||
            (attempt.progress?.cleanup === "removed" &&
              attempt.progress.prs.every((pr) => pr.cleanup === "removed") &&
              Object.keys(attempt.progress.service_attempts).length === 0))
      ),
    "release-refresh",
    "Refresh requires an untouched first staging step of a cleaned, single frontend-only real production release with no database change."
  );
  return record;
}

export function validateUntouchedEvidence(evidence, execution) {
  const repository = execution.plan.candidates.frontend.repository;
  serviceAssert(
    evidence?.repository_id === repository.id &&
      evidence.repository === repository.full_name &&
      evidence.branch === untouchedBranch(execution) &&
      evidence.branch_absent === true &&
      evidence.prs_absent === true &&
      serviceHash(evidence.actor) === serviceHash(execution.actor) &&
      ["staging", "prod"].every((environment) =>
        ["backend", "frontend"].every((role) =>
          sha(evidence.versions?.[environment]?.[role])
        )
      ) &&
      Number.isFinite(Date.parse(evidence.checked_at)),
    "release-refresh",
    "Untouched release refresh lacks matching actor, repository, absent owned resources or current branch evidence."
  );
}

const withoutBases = (plan) => ({
  ...plan,
  repositories: plan.repositories.map((repository) => ({
    ...repository,
    destination: { ...repository.destination, commit: null }
  }))
});

export function validateUntouchedSupersession(execution, batch) {
  if (execution.status !== "superseded" && execution.refresh === undefined)
    return;
  const refresh = execution.refresh;
  serviceAssert(
    refresh && typeof refresh === "object",
    "release-refresh",
    "Superseded release lacks its explicit refresh record."
  );
  const previous = refresh?.previous_execution;
  const original = { ...batch, execution: previous };
  delete original.stop;
  assertUntouchedRelease(original, previous);
  validateUntouchedEvidence(refresh.evidence, previous);
  const restored = { ...execution };
  delete restored.refresh;
  restored.status = previous.status;
  restored.message = previous.message;
  restored.completed_at = previous.completed_at;
  const input = batch.inputs[0];
  const plan = refresh.plans?.[input.number];
  serviceAssert(
    execution.status === "superseded" &&
      batch.stop?.status === "stale" &&
      refresh.version === 1 &&
      uuid(refresh.run_id) &&
      serviceHash(refresh.actor) === serviceHash(previous.actor) &&
      refresh.previous_batch_hash === serviceHash(original) &&
      serviceHash(restored) === serviceHash(previous) &&
      execution.completed_at === refresh.at &&
      Number.isFinite(Date.parse(refresh.at)) &&
      plan &&
      Object.keys(refresh.plans).join() === String(input.number) &&
      serviceHash(withoutBases(plan)) ===
        serviceHash(withoutBases(input.input)) &&
      plan.repositories[0].destination.commit ===
        refresh.evidence.versions.prod.frontend &&
      plan.repositories[0].destination.commit !==
        input.input.repositories[0].destination.commit,
    "release-refresh",
    "Superseded release must preserve its exact original checkpoint and batches, with an unchanged request on a newly verified main."
  );
}

export const preparationHistory = (batch) =>
  batch?.stop?.status === "stale" &&
  (!batch.execution || batch.execution.status === "superseded");
