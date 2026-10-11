import { serviceAssert, serviceHash } from "./service-contract.mjs";
import { isBrowserPolicyUpgrade } from "./batch-plan.mjs";
import { validateUntouchedSupersession } from "./untouched-release-state.mjs";

export const checkRetryHistoryMarker = "explicit-check-retry-v1";
const hash = (value) => /^[0-9a-f]{64}$/u.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");

export const batchFingerprint = ({ inputs, policy, retry_of }) =>
  serviceHash({ inputs, policy, ...(retry_of ? { retry_of } : {}) });
const withoutBases = (inputs) =>
  inputs.map((input) => ({
    ...input,
    input: {
      ...input.input,
      repositories: input.input.repositories.map((repo) => ({
        ...repo,
        destination: { ...repo.destination, commit: null }
      }))
    }
  }));

export function validateRetryLink(batch) {
  const link = batch.retry_of;
  serviceAssert(
    batch.version === 1
      ? link === undefined && batch.retry_authorization === undefined
      : batch.version === 2 &&
          hash(link?.fingerprint) &&
          hash(link.record_hash) &&
          uuid(link.attempt_id) &&
          Array.isArray(link.history) &&
          link.history.length > 0 &&
          new Set(link.history.map((ref) => ref.fingerprint)).size ===
            link.history.length &&
          link.history.every(
            (ref) =>
              hash(ref.fingerprint) &&
              ref.fingerprint !== batch.fingerprint &&
              hash(ref.record_hash)
          ) &&
          link.history.some(
            (ref) =>
              ref.fingerprint === link.fingerprint &&
              ref.record_hash === link.record_hash
          ) &&
          (link.policy_refresh === undefined ||
            (hash(link.policy_refresh.fingerprint) &&
              link.policy_refresh.fingerprint !== batch.fingerprint &&
              hash(link.policy_refresh.record_hash))) &&
          uuid(batch.retry_authorization?.run_id) &&
          typeof batch.retry_authorization.actor?.id === "string" &&
          Boolean(batch.retry_authorization.actor.id) &&
          typeof batch.retry_authorization.actor.login === "string" &&
          Number.isFinite(Date.parse(batch.retry_authorization.at)) &&
          batch.policy?.version === "real-batch-v1" &&
          batch.inputs?.length === 1 &&
          batch.inputs[0].database_change === "no" &&
          batch.inputs[0].operational_deployments?.length === 0 &&
          batch.inputs[0].input?.repositories?.length === 1 &&
          batch.inputs[0].input.repositories[0].role === "frontend",
    "batch-retry",
    "Invalid explicit check retry history or authorization."
  );
}

// Parent results remain historical, not reusable CI. Verify their immutable
// records and include every prior round/refresh in the existing count budgets.
export async function retryHistory(batch, loadBatch) {
  validateRetryLink(batch);
  const records = [];
  for (const ref of batch.retry_of?.history ?? []) {
    const record = await loadBatch(ref.fingerprint);
    serviceAssert(
      record &&
        serviceHash(record) === ref.record_hash &&
        !record.execution &&
        record.selected.length === 0 &&
        record.status === "finished",
      "batch-retry",
      "Prior check retry history changed or is unavailable."
    );
    records.push(record);
  }
  if (batch.retry_of) {
    const parent = records.find(
      (record) => record.fingerprint === batch.retry_of.fingerprint
    );
    const attempt = parent.attempts.find(
      (record) => record.id === batch.retry_of.attempt_id
    );
    let upgraded = false;
    const ref = batch.retry_of.policy_refresh;
    if (ref) {
      const retired = await loadBatch(ref.fingerprint);
      serviceAssert(
        retired &&
          serviceHash(retired) === ref.record_hash &&
          retired.execution?.status === "superseded" &&
          retired.execution.refresh?.version === 2,
        "batch-retry",
        "The explicit policy-refresh checkpoint changed or is unavailable."
      );
      validateUntouchedSupersession(retired.execution, retired);
      const { policy_refresh: _refresh, ...originalLink } = batch.retry_of;
      upgraded = Boolean(
        retired.execution.status === "superseded" &&
        retired.execution.refresh.version === 2 &&
        isBrowserPolicyUpgrade(parent.policy, batch.policy) &&
        serviceHash(retired.policy) === serviceHash(parent.policy) &&
        serviceHash(retired.execution.refresh.target_policy) ===
          serviceHash(batch.policy) &&
        serviceHash(retired.retry_of) === serviceHash(originalLink) &&
        serviceHash(retired.retry_authorization) ===
          serviceHash(batch.retry_authorization) &&
        retired.execution.refresh.run_id === batch.retry_authorization.run_id &&
        serviceHash(retired.execution.refresh.actor) ===
          serviceHash(batch.retry_authorization.actor)
      );
      serviceAssert(
        upgraded,
        "batch-retry",
        "Retry policy changed without its matching explicit untouched refresh."
      );
      records.push(retired);
    }
    serviceAssert(
      attempt?.phase === "checks" &&
        attempt.result?.status === "unknown" &&
        attempt.result.kind === "evidence" &&
        attempt.progress?.cleanup === "removed" &&
        (serviceHash(parent.policy) === serviceHash(batch.policy) ||
          upgraded) &&
        serviceHash(withoutBases(parent.inputs)) ===
          serviceHash(withoutBases(batch.inputs)) &&
        parent.inputs.length === batch.inputs.length &&
        parent.inputs.every(
          (input, index) =>
            input.number === batch.inputs[index].number &&
            serviceHash(input.input.inbox) ===
              serviceHash(batch.inputs[index].input.inbox)
        ),
      "batch-retry",
      "Retry is not linked to the same failed request and policy."
    );
    for (const record of records) {
      validateRetryLink(record);
      serviceAssert(
        (record.retry_of?.history ?? []).every((ref) =>
          batch.retry_of.history.some(
            (saved) =>
              saved.fingerprint === ref.fingerprint &&
              saved.record_hash === ref.record_hash
          )
        ),
        "batch-retry",
        "Retry history omitted earlier spent attempts."
      );
    }
  }
  return records;
}
