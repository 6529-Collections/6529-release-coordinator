import { randomUUID } from "node:crypto";
import {
  serviceHash,
  serviceAssert,
  ServiceError
} from "./service-contract.mjs";
import { batchPolicy } from "./batch-plan.mjs";

const members = (items) => items.map((item) => item.entry.issue_number);
const key = (items) => members(items).join(",");

// Pure orchestration with injected Git and check adapters. No subset is allowed
// to become a candidate unless it consists of complete saved ticket inputs.
export async function selectBatch({
  items,
  previous,
  prepare,
  check,
  revalidate = async () => {},
  save,
  verify,
  guard,
  signal,
  policy = batchPolicy,
  now = () => Date.now(),
  uuid = randomUUID
}) {
  const ordered = [...items].sort(
    (a, b) => a.entry.issue_number - b.entry.issue_number
  );
  const inputs = ordered.map((item) => ({
    number: item.entry.issue_number,
    input: item.input
  }));
  const fingerprint = serviceHash({ inputs, policy });
  const created = now();
  const state = previous
    ? structuredClone(previous)
    : {
        version: 1,
        fingerprint,
        inputs,
        policy,
        created_at: new Date(created).toISOString(),
        deadline: created + policy.max_elapsed_ms,
        attempts: [],
        selected: [],
        status: "searching"
      };
  serviceAssert(
    state.fingerprint === fingerprint &&
      serviceHash(state.inputs) === serviceHash(inputs) &&
      serviceHash(state.policy) === serviceHash(policy),
    "batch-state",
    "Saved batch inputs or limits changed."
  );
  const persist = async () => {
    signal?.throwIfAborted();
    await guard();
    await save(structuredClone(state));
  };
  const current = async () => {
    signal?.throwIfAborted();
    await guard();
    if (!(await verify()))
      throw new ServiceError(
        "batch-stale",
        "Ticket, PR gates or main changed; this batch cannot be used.",
        "stale"
      );
  };
  const counts = (phase) =>
    state.attempts.filter((attempt) => attempt.phase === phase).length;
  const limit = (phase) =>
    now() >= state.deadline ||
    counts(phase) >=
      (phase === "git" ? policy.max_git_attempts : policy.max_check_attempts);
  const limited = () => ({
    status: "unknown",
    kind: "limit",
    message: "The saved attempt or elapsed-time limit was reached."
  });
  async function attempt(group, phase, prepared) {
    const matching = state.attempts.find(
      (value) => value.phase === phase && value.members.join(",") === key(group)
    );
    if (matching?.result) return matching.result;
    // An in-flight check must reconcile/clean up even after its search deadline.
    if (!matching && limit(phase)) return limited();
    await current();
    const record = matching ?? {
      id: uuid(),
      phase,
      members: members(group),
      started_at: new Date(now()).toISOString()
    };
    if (!matching) {
      state.attempts.push(record);
      await persist();
    }
    const saveProgress = async (value) => {
      record.progress = structuredClone(value);
      await persist();
    };
    let result;
    try {
      result =
        phase === "git"
          ? await prepare(group)
          : await check(prepared, {
              id: record.id,
              previous: record.progress,
              save: saveProgress,
              guard,
              verify: current,
              signal,
              deadline: state.deadline
            });
    } catch (error) {
      // A check adapter must finish or preserve ownership before returning. An
      // uncertain write/save escapes and leaves the inbox locked for recovery.
      if (phase === "checks" || signal?.aborted) throw error;
      result = {
        status: error instanceof ServiceError ? error.status : "unknown",
        kind: "evidence",
        message:
          error instanceof ServiceError
            ? error.message
            : "The combined Git evidence could not be verified."
      };
    }
    serviceAssert(
      ["passed", "blocked", "unknown", "stale"].includes(result?.status),
      "batch-result",
      "Batch adapter returned no verifiable result."
    );
    await current();
    record.result = result;
    await persist();
    return result;
  }
  try {
    await persist();
    await current();
    // Re-read remote proof once per command, without recreating trials or
    // trusting a journal's internally consistent cached result as evidence.
    if (previous) {
      for (const record of state.attempts.filter(
        (value) => value.phase === "checks" && value.result
      )) {
        if (record.result.status === "stale") continue;
        const prepared = state.attempts.find(
          (value) =>
            value.phase === "git" &&
            value.members.join(",") === record.members.join(",")
        )?.result;
        await revalidate(prepared, record.progress, { guard });
      }
      await current();
    }
    if (state.status === "finished") return state;
    const pool = ordered.slice(0, policy.max_tickets);
    let candidate = pool;
    const initial = pool.length ? await attempt(pool, "git") : null;
    if (initial && initial.status !== "passed") {
      candidate = [];
      if (initial.kind === "conflict" && initial.status === "blocked") {
        // Cheap elimination happens for the whole pool before starting any CI.
        for (const item of pool) {
          const trial = [...candidate, item];
          const result = await attempt(trial, "git");
          if (result.status === "passed") candidate = trial;
          else if (result.kind !== "conflict") {
            state.stop = result;
            break;
          }
        }
      } else state.stop = initial;
    }
    async function test(group) {
      if (!group.length) return [];
      const prepared = await attempt(group, "git");
      if (prepared.status !== "passed") {
        state.stop ??= prepared;
        return [];
      }
      const result = await attempt(group, "checks", prepared);
      if (result.status === "passed") return group;
      if (result.status !== "blocked" || result.kind !== "code") {
        state.stop = result;
        return [];
      }
      if (group.length === 1) return [];
      const middle = Math.ceil(group.length / 2);
      const left = await test(group.slice(0, middle));
      if (state.stop) return left;
      const right = await test(group.slice(middle));
      if (!left.length) return right;
      if (!right.length || state.stop) return left;
      const union = [...left, ...right];
      const merged = await attempt(union, "git");
      if (merged.status !== "passed") {
        if (merged.kind !== "conflict") state.stop = merged;
        return left;
      }
      const combined = await attempt(union, "checks", merged);
      if (combined.status === "passed") return union;
      if (combined.status !== "blocked" || combined.kind !== "code")
        state.stop = combined;
      return left;
    }
    const selected = state.stop ? [] : await test(candidate);
    await current();
    state.selected = members(selected);
    state.status = "finished";
    await persist();
    return state;
  } catch (error) {
    if (!(error instanceof ServiceError) || error.status !== "stale")
      throw error;
    for (const record of state.attempts.filter(
      (attempt) =>
        attempt.phase === "checks" &&
        attempt.progress &&
        attempt.progress.cleanup !== "removed"
    )) {
      const prepared = state.attempts.find(
        (attempt) =>
          attempt.phase === "git" &&
          attempt.members.join(",") === record.members.join(",")
      )?.result;
      serviceAssert(
        prepared?.status === "passed",
        "batch-state",
        "Interrupted trial has no saved preparation."
      );
      record.result = await check(prepared, {
        id: record.id,
        previous: record.progress,
        deadline: state.deadline,
        signal,
        guard,
        verify: async () => {
          throw error;
        },
        save: async (value) => {
          record.progress = structuredClone(value);
          await persist();
        }
      });
    }
    state.selected = [];
    state.stop = { status: "stale", kind: "evidence", message: error.message };
    state.status = "finished";
    await persist();
    return state;
  }
}

export function batchTicketResult(batch, number) {
  const checked = batch.attempts.filter((a) => a.phase === "checks");
  const passed = checked.find(
    (a) =>
      a.members.join(",") === batch.selected.join(",") &&
      a.result?.status === "passed"
  );
  const singleton = checked.find(
    (a) =>
      a.members.length === 1 &&
      a.members[0] === number &&
      a.result?.status === "blocked" &&
      a.result.kind === "code"
  );
  const involved = batch.attempts.filter(
    (a) => a.members.includes(number) && a.result?.status === "blocked"
  );
  const selected = batch.selected.includes(number);
  const stale = batch.stop?.status === "stale";
  return {
    status: stale
      ? "stale"
      : selected
        ? "passed"
        : singleton
          ? "blocked"
          : batch.stop?.status === "stale"
            ? "stale"
            : "waiting",
    code: stale
      ? "batch-deferred"
      : selected
        ? "batch-selected"
        : singleton
          ? "batch-ticket-failed"
          : batch.stop?.kind === "limit"
            ? "batch-limit"
            : involved.length
              ? "batch-incompatible"
              : "batch-deferred",
    message: stale
      ? batch.stop.message
      : selected
        ? "This exact group passed its combined checks; it remains waiting for future release execution."
        : singleton
          ? "This complete ticket failed against the saved base, with a passing unchanged baseline. A correction is required."
          : involved.length
            ? `A tested combination containing this ticket failed. ${batch.selected.length ? "The saved priority kept another candidate" : "No passing candidate was selected"}; this does not prove this ticket is individually broken.${batch.stop ? ` ${batch.stop.message}` : ""}`
            : (batch.stop?.message ??
              "This ticket was outside the selected tested group; the Coordinator must reassess it."),
    fingerprint: batch.fingerprint,
    selected: batch.selected,
    evidence: [
      ...new Map(
        [
          ...(passed ? [passed] : []),
          ...involved,
          ...(singleton ? [singleton] : [])
        ].map((a) => [
          a.id,
          {
            attempt_id: a.id,
            tickets: a.members,
            phase: a.phase,
            status: a.result.status,
            conflicts: a.result.conflicts ?? [],
            checks: a.result.checks ?? [],
            services: a.result.services ?? null,
            baseline: a.result.baseline ?? null
          }
        ])
      ).values()
    ]
  };
}
