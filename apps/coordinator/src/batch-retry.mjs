import { serviceAssert, serviceHash } from "./service-contract.mjs";
import { batchPolicyForProfile } from "./batch-plan.mjs";
import { createBatchGitHub } from "./batch-github.mjs";
import { releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";

import {
  checkRetryHistoryMarker,
  batchFingerprint,
  retryHistory
} from "./batch-retry-history.mjs";
export {
  checkRetryHistoryMarker,
  batchFingerprint,
  retryHistory
} from "./batch-retry-history.mjs";
const hash = (value) => /^[0-9a-f]{64}$/u.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");

export async function verifyRetryTrials(batch, { profile, guard, signal }) {
  const client = createBatchGitHub({
    profile,
    guard,
    signal,
    policy: batch.policy
  });
  for (const attempt of batch.attempts)
    for (const pr of attempt.progress?.prs ?? []) {
      await guard();
      await client.verifyRemoved(pr);
    }
}

// Only this operator-selected, settled pre-release failure can start a new
// round. A normal resume still reconciles the old evidence without retrying.
export async function startCheckRetry({
  attemptId,
  state,
  run,
  selection,
  entries,
  profile,
  loadBatch,
  guard,
  save,
  signal,
  verifyTrials = verifyRetryTrials,
  now = () => new Date()
}) {
  serviceAssert(
    uuid(attemptId) &&
      profile.name === "real" &&
      selection.mode === "filtered" &&
      !selection.legacy_single &&
      selection.issue_numbers.length === 1 &&
      selection.actor_login === run.actor.login.toLowerCase() &&
      run.scope.close_test === false &&
      run.scope.workflow === "inbox-run-v7" &&
      run.scope.release_adapter === "product-workflows" &&
      run.ticket_numbers?.length === 1 &&
      run.ticket_numbers[0] === selection.issue_numbers[0] &&
      (hash(run.batch_fingerprint) ||
        (run.check_retry?.attempt_id === attemptId &&
          run.reprepared_batches?.includes(run.check_retry.batch_fingerprint))),
    "batch-retry",
    "Check retry requires the owner's saved one-ticket filtered real release run."
  );
  if (run.check_retry?.attempt_id === attemptId) {
    serviceAssert(
      run.check_retry.batch_fingerprint === run.batch_fingerprint ||
        run.reprepared_batches?.includes(run.check_retry.batch_fingerprint),
      "batch-retry",
      "The saved retry identity no longer belongs to this run."
    );
    return;
  }
  await guard();
  const parent = await loadBatch(run.batch_fingerprint);
  const attempt = parent?.attempts.find((value) => value.id === attemptId);
  const input = parent?.inputs[0];
  const entry = entries.get(selection.issue_numbers[0]);
  serviceAssert(
    parent &&
      serviceHash(parent.policy) ===
        serviceHash(batchPolicyForProfile(profile)) &&
      parent.status === "finished" &&
      !parent.execution &&
      parent.selected.length === 0 &&
      parent.inputs.length === 1 &&
      input.number === selection.issue_numbers[0] &&
      input.database_change === "no" &&
      input.operational_deployments?.length === 0 &&
      input.input.repositories.length === 1 &&
      input.input.repositories[0].role === "frontend" &&
      entry?.status === "valid" &&
      entry.github_actor?.id === run.actor.id &&
      serviceHash(entry.request) ===
        serviceHash(state.tickets[input.number]?.request) &&
      entry.request.request_id === input.input.inbox.request_id &&
      releaseRequestChecksum(entry.request) === input.input.inbox.checksum &&
      serviceHash(run.plans?.[input.number]) === serviceHash(input.input) &&
      attempt?.phase === "checks" &&
      attempt.members.length === 1 &&
      attempt.members[0] === input.number &&
      attempt.result?.status === "unknown" &&
      attempt.result.kind === "evidence" &&
      attempt.progress?.prs.length === 1 &&
      attempt.progress.prs[0].result?.checks?.some(
        (check) =>
          check.name === "Installed app checks" &&
          check.status === "COMPLETED" &&
          check.conclusion === "FAILURE"
      ) &&
      parent.attempts.every(
        (record) =>
          record.result &&
          (record.phase === "git" ||
            (record.progress?.cleanup === "removed" &&
              record.progress.prs.every((pr) => pr.cleanup === "removed") &&
              Object.keys(record.progress.service_attempts).length === 0))
      ),
    "batch-retry",
    "Only a completed, cleaned-up frontend CI failure before any release can be retried."
  );
  const history = new Map(
    (await retryHistory(parent, loadBatch)).map((record) => [
      record.fingerprint,
      record
    ])
  );
  history.set(parent.fingerprint, parent);
  for (const fingerprint of run.reprepared_batches ?? []) {
    const record = await loadBatch(fingerprint);
    serviceAssert(
      record &&
        !record.execution &&
        record.stop?.status === "stale" &&
        record.status === "finished" &&
        record.selected.length === 0,
      "batch-retry",
      "Prior preparation history is unavailable or unsafe."
    );
    history.set(fingerprint, record);
  }
  for (const phase of ["git", "checks"])
    serviceAssert(
      [...history.values()].reduce(
        (sum, record) =>
          sum + record.attempts.filter((value) => value.phase === phase).length,
        0
      ) <
        parent.policy[
          phase === "git" ? "max_git_attempts" : "max_check_attempts"
        ],
      "batch-retry",
      "The existing attempt budget is exhausted; retry cannot reset it."
    );
  signal?.throwIfAborted();
  for (const record of history.values())
    await verifyTrials(record, { profile, guard, signal });
  await guard();
  signal?.throwIfAborted();
  const retry_of = {
    fingerprint: parent.fingerprint,
    attempt_id: attemptId,
    record_hash: serviceHash(parent),
    history: [...history.values()].map((record) => ({
      fingerprint: record.fingerprint,
      record_hash: serviceHash(record)
    }))
  };
  const next = {
    version: 2,
    inputs: structuredClone(parent.inputs),
    policy: structuredClone(parent.policy),
    retry_of,
    retry_authorization: {
      run_id: run.run_id,
      actor: structuredClone(run.actor),
      at: now().toISOString()
    },
    created_at: now().toISOString(),
    status: "searching",
    selected: [],
    attempts: []
  };
  next.fingerprint = batchFingerprint(next);
  serviceAssert(
    !state.batches?.[next.fingerprint] &&
      !state.history?.batches?.[next.fingerprint],
    "batch-retry",
    "This retry round already exists; reconcile its saved identity."
  );
  state.batches ??= {};
  state.batches[next.fingerprint] = next;
  state.check_retry_history = checkRetryHistoryMarker;
  run.check_retry = {
    attempt_id: attemptId,
    batch_fingerprint: next.fingerprint
  };
  run.batch_fingerprint = next.fingerprint;
  state.lock.check_retry = structuredClone(run.check_retry);
  state.lock.batch_fingerprint = next.fingerprint;
  await save("authorize fresh check retry without changing original history");
}
