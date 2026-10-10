import { serviceAssert, serviceHash } from "./service-contract.mjs";
import { batchPolicyForProfile } from "./batch-plan.mjs";
import { validateReleaseExecution } from "./release-state.mjs";
import { retryHistory } from "./batch-retry-history.mjs";
import { verifyRetryTrials } from "./batch-retry.mjs";
import { refreshedPreparationPlans } from "./preparation-refresh.mjs";
import {
  assertUntouchedRelease,
  preparationHistory,
  untouchedRefreshMarker,
  validateUntouchedEvidence
} from "./untouched-release-state.mjs";
import { releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";
import { runEvent } from "./run-log.mjs";

// Explicit same-run recovery only. All admission/absence reads finish before
// the one journal save; no branch, PR, workflow or Issue is changed here.
export async function refreshUntouchedRelease({
  releaseId,
  state,
  run,
  selection,
  entries,
  issues,
  profile,
  api,
  inspect,
  get,
  observe,
  github,
  plan,
  loadBatch,
  guard,
  save,
  verifyUntouched,
  verifyTrials = verifyRetryTrials,
  signal,
  now = () => new Date()
}) {
  serviceAssert(
    profile.name === "real" &&
      selection.mode === "filtered" &&
      !selection.legacy_single &&
      selection.issue_numbers.length === 1 &&
      selection.actor_login === run.actor.login.toLowerCase() &&
      run.scope.close_test === false &&
      run.scope.workflow === "inbox-run-v7" &&
      run.scope.release_adapter === "product-workflows" &&
      serviceHash(run.ticket_numbers) === serviceHash(selection.issue_numbers),
    "release-refresh",
    "Untouched refresh requires the owner's same one-ticket filtered real release run."
  );
  await guard();
  const prior = await Promise.all(
    (run.reprepared_batches ?? []).map((hash) => loadBatch(hash))
  );
  // A repeated command naming the old release continues the recorded fresh
  // preparation. It cannot retire a new execution or allocate another round.
  const recorded = prior.find(
    (batch) => batch.execution?.plan.release_id === releaseId
  );
  if (recorded) {
    validateReleaseExecution(recorded.execution, recorded);
    serviceAssert(
      recorded.execution.status === "superseded" &&
        recorded.execution.refresh.run_id === run.run_id &&
        serviceHash(recorded.execution.refresh.actor) ===
          serviceHash(run.actor),
      "release-refresh",
      "The named release was not refreshed by this same operator and run."
    );
    return;
  }
  const parent = await loadBatch(run.batch_fingerprint);
  validateReleaseExecution(parent?.execution, parent);
  assertUntouchedRelease(parent);
  const input = parent.inputs[0],
    entry = entries.get(input.number);
  serviceAssert(
    parent.execution.plan.release_id === releaseId &&
      serviceHash(parent.policy) ===
        serviceHash(batchPolicyForProfile(profile)) &&
      input.number === selection.issue_numbers[0] &&
      entry?.status === "valid" &&
      entry.github_actor?.id === run.actor.id &&
      serviceHash(parent.execution.actor) === serviceHash(run.actor) &&
      serviceHash(entry.request) ===
        serviceHash(state.tickets[input.number]?.request) &&
      entry.request.request_id === input.input.inbox.request_id &&
      releaseRequestChecksum(entry.request) === input.input.inbox.checksum &&
      serviceHash(run.plans?.[input.number]) === serviceHash(input.input) &&
      prior.every(preparationHistory) &&
      typeof verifyUntouched === "function",
    "release-refresh",
    "Untouched refresh cannot change the release identity, request, actor, scope, policy or prior history."
  );
  const ancestors = await retryHistory(parent, (hash) =>
    loadBatch(hash, { immutable: true })
  );
  const history = [
    ...new Map(
      [...prior, ...ancestors, parent].map((batch) => [
        batch.fingerprint,
        batch
      ])
    ).values()
  ];
  for (const phase of ["git", "checks"])
    serviceAssert(
      history.reduce(
        (count, batch) =>
          count +
          batch.attempts.filter((attempt) => attempt.phase === phase).length,
        0
      ) <
        parent.policy[
          phase === "git" ? "max_git_attempts" : "max_check_attempts"
        ],
      "release-refresh",
      "The existing attempt budget is exhausted; refresh cannot reset it."
    );
  const before = await verifyUntouched(parent);
  validateUntouchedEvidence(before, parent.execution);
  for (const batch of history)
    await verifyTrials(batch, { profile, guard, signal });
  const plans = await refreshedPreparationPlans(
    [
      {
        number: input.number,
        input: input.input,
        entry,
        issue: issues.get(input.number)
      }
    ],
    {
      api,
      inspect,
      get,
      profile,
      observe,
      github,
      plan,
      signal,
      priorInputs: history.map((batch) => batch.inputs)
    }
  );
  serviceAssert(
    plans,
    "release-refresh",
    "Fresh source gates and unchanged receipt are required on a new, not previously attempted main."
  );
  const evidence = await verifyUntouched(parent);
  validateUntouchedEvidence(evidence, parent.execution);
  serviceAssert(
    serviceHash({ ...before, checked_at: null }) ===
      serviceHash({ ...evidence, checked_at: null }) &&
      plans[input.number].repositories[0].destination.commit ===
        evidence.versions.prod.frontend,
    "release-refresh",
    "Release branches or owned-resource evidence changed during refresh admission."
  );
  await guard();
  signal?.throwIfAborted();
  const retired = structuredClone(parent),
    at = now().toISOString();
  retired.execution.refresh = {
    version: 1,
    run_id: run.run_id,
    actor: structuredClone(run.actor),
    at,
    previous_batch_hash: serviceHash(parent),
    previous_execution: structuredClone(parent.execution),
    evidence,
    plans
  };
  retired.execution.status = "superseded";
  retired.execution.completed_at = at;
  retired.execution.message =
    "Untouched release superseded after explicit verification; fresh Git and CI are required. No release effect or rollback is claimed.";
  retired.stop = { status: "stale", message: retired.execution.message };
  validateReleaseExecution(retired.execution, retired);
  state.batches[parent.fingerprint] = retired;
  state.untouched_release_refresh = untouchedRefreshMarker;
  run.reprepared_batches = [
    ...(run.reprepared_batches ?? []),
    parent.fingerprint
  ];
  run.plans = structuredClone(plans);
  state.lock.reprepared_batches = structuredClone(run.reprepared_batches);
  state.lock.plans = structuredClone(plans);
  delete run.batch_fingerprint;
  delete state.lock.batch_fingerprint;
  await save(
    "supersede verified untouched release; preserve history and spent budgets before fresh preparation"
  );
  runEvent({
    step: "release.refresh",
    outcome: "succeeded",
    message:
      "The explicitly named untouched release is preserved as superseded. Rebuilding and retesting the same request on current main; old CI cannot authorize deployment."
  });
}
