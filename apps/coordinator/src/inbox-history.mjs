import {
  serviceHash,
  validateServicePlan,
  verifyServiceReport
} from "./service-contract.mjs";
import { validateBatchHistory } from "./batch-state.mjs";

const hash = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
export const archivePath = (path) =>
  typeof path === "string" &&
  /^history\/(batches|services)\/[0-9a-f]{64}\.json$/u.test(path);

export function validateServiceHistory(attempts, profile) {
  if (!object(attempts))
    throw new Error("Unsupported service attempt history.");
  for (const [hash, attempt] of Object.entries(attempts)) {
    if (
      hash !== attempt.plan_hash ||
      hash !== attempt.plan?.fingerprint ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(attempt.id) ||
      !attempt.actor?.id ||
      !["prepared", "dispatching", "running", "completed"].includes(
        attempt.state
      ) ||
      attempt.plan.binding?.repository !== profile.inbox.full_name ||
      profile.name !== "sandbox" ||
      (attempt.workflow_run_id !== null &&
        (!Number.isSafeInteger(attempt.workflow_run_id) ||
          attempt.workflow_run_id < 1))
    )
      throw new Error("Invalid service attempt identity or profile.");
    validateServicePlan(attempt.plan);
    if (attempt.result)
      verifyServiceReport(attempt.result.report, attempt.plan, attempt.id);
  }
}

export function validateHistoryReferences(history, profile) {
  if (
    !object(history) ||
    profile.name !== "sandbox" ||
    Object.keys(history).some((kind) => !["batches", "services"].includes(kind))
  )
    throw new Error("Invalid history index or profile.");
  for (const [kind, entries] of Object.entries(history)) {
    if (!object(entries)) throw new Error("Invalid history index.");
    for (const [identity, ref] of Object.entries(entries)) {
      if (
        !hash(identity) ||
        !object(ref) ||
        !hash(ref.checksum) ||
        ref.path !== `history/${kind}/${ref.checksum}.json` ||
        typeof ref.status !== "string" ||
        !Array.isArray(ref.tickets) ||
        !Array.isArray(ref.evidence) ||
        Object.keys(ref).some(
          (key) =>
            !["path", "checksum", "status", "tickets", "evidence"].includes(key)
        )
      )
        throw new Error("Invalid history reference.");
    }
  }
}

function summary(archive) {
  const { kind, record } = archive;
  const checksum = serviceHash(archive);
  const bindings =
    kind === "batches"
      ? record.inputs.map(({ input }) => input.inbox)
      : [record.plan.binding];
  const services =
    kind === "batches"
      ? record.attempts.flatMap((attempt) =>
          Object.values(attempt.progress?.service_attempts ?? {})
        )
      : [record];
  return {
    path: `history/${kind}/${checksum}.json`,
    checksum,
    status:
      kind === "batches"
        ? (record.stop?.status ??
          (record.selected.length ? "passed" : "no-candidate"))
        : record.result.report.status,
    tickets: bindings.map(({ issue_number, request_id, checksum }) => ({
      number: issue_number,
      request_id,
      checksum
    })),
    evidence: [
      ...new Set(
        services.map((attempt) => attempt.result?.workflow?.url).filter(Boolean)
      )
    ]
  };
}

const cleanedService = (attempt) =>
  Boolean(
    attempt.result &&
    (attempt.state === undefined || attempt.state === "completed") &&
    attempt.result.report?.cleanup?.status === "removed"
  );
export function historyReady(kind, record, tickets) {
  const bindings =
    kind === "batches"
      ? record.inputs.map(({ input }) => input.inbox)
      : [record.plan.binding];
  if (
    !bindings.every(({ issue_number }) => {
      const ticket = tickets[issue_number];
      return (
        ticket &&
        !ticket.application_error &&
        ticket.applied === ticket.transitions.at(-1)?.id &&
        ticket.transitions.some(({ decision }) =>
          kind === "batches"
            ? decision.batch?.fingerprint === record.fingerprint
            : decision.services?.plan_hash === record.plan_hash
        )
      );
    })
  )
    return false;
  return historyComplete(kind, record);
}

function historyComplete(kind, record) {
  if (kind === "services")
    return record.state === "completed" && cleanedService(record);
  return (
    record.status === "finished" &&
    record.attempts.every(
      (attempt) =>
        attempt.result &&
        (attempt.phase === "git" ||
          (attempt.progress?.cleanup === "removed" &&
            attempt.progress.prs.every((pr) => pr.cleanup === "removed") &&
            Object.values(attempt.progress.service_attempts).every(
              cleanedService
            )))
    )
  );
}

export function makeArchive(kind, identity, record, profile) {
  const archive = {
    schema: 1,
    repository: profile.inbox.full_name,
    kind,
    identity,
    record
  };
  return { archive, ref: summary(archive) };
}

export function verifyArchive(archive, kind, identity, ref, profile) {
  if (
    archive?.schema !== 1 ||
    archive.repository !== profile.inbox.full_name ||
    archive.kind !== kind ||
    archive.identity !== identity ||
    serviceHash(archive) !== ref.checksum
  )
    throw new Error(
      "History archive identity, profile or checksum is invalid; no new attempt is safe."
    );
  if (kind === "batches")
    validateBatchHistory({ [identity]: archive.record }, profile);
  else validateServiceHistory({ [identity]: archive.record }, profile);
  if (!historyComplete(kind, archive.record))
    throw new Error(
      "History archive still has unfinished operations or cleanup."
    );
  if (serviceHash(summary(archive)) !== serviceHash(ref))
    throw new Error("History archive summary differs from its saved evidence.");
  return archive.record;
}

// Only called as part of releasing a successfully presented run. The archive
// and smaller active state are published together; no background cleanup job.
export function archiveFinished(state, profile) {
  const files = [];
  for (const [kind, field] of [
    ["batches", "batches"],
    ["services", "service_attempts"]
  ]) {
    for (const [identity, record] of Object.entries(state[field] ?? {})) {
      if (!historyReady(kind, record, state.tickets)) continue;
      if (
        kind === "services" &&
        Object.values(state.batches ?? {}).some((batch) =>
          batch.attempts.some((attempt) =>
            Object.values(attempt.progress?.service_attempts ?? {}).some(
              (service) =>
                service.id === record.id || service.plan_hash === identity
            )
          )
        )
      )
        continue;
      const { archive, ref } = makeArchive(kind, identity, record, profile);
      verifyArchive(archive, kind, identity, ref, profile);
      state.history ??= {};
      state.history[kind] ??= {};
      state.history[kind][identity] = ref;
      delete state[field][identity];
      files.push({ path: ref.path, archive, ref });
    }
  }
  return files;
}
