import assert from "node:assert/strict";
import { checkBatch } from "../src/batch-checks.mjs";
import { executeServiceSteps } from "../src/service-contract.mjs";
import { serviceAdapter } from "./service-fixture.mjs";

export function checkHarness(
  prepared,
  { codeFailure = false, baselineFails = false, pending = false } = {}
) {
  let saved;
  const events = [];
  const client = {
    identity: async () => ({
      actor: { id: "456", login: "tester" },
      workflow_id: 101
    }),
    open: async (record, _patch, save) => {
      assert.ok(saved.prs.some((pr) => pr.branch === record.branch));
      events.push(`open:${record.role}`);
      record.commit = "a".repeat(40);
      record.number = record.role === "backend" ? 21 : 22;
      await save(record);
    },
    result: async (record) =>
      pending ? null : { status: "passed", role: record.role },
    cleanup: async (record) => {
      events.push(`cleanup:${record.role}`);
      return { status: "removed" };
    }
  };
  const executeServices = async (plan, options) => {
    const baseline = plan.binding.purpose === "unchanged-batch-baseline";
    events.push(baseline ? "baseline" : "services");
    const attempt = options.previous ?? {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      plan_hash: plan.fingerprint,
      plan,
      actor: { id: "456", login: "tester" },
      workflow_id: 101,
      workflow_run_id: 1001,
      state: "running"
    };
    await options.save(attempt);
    const report = await executeServiceSteps(
      plan,
      serviceAdapter({
        ...(baseline && baselineFails ? { baselineFails: true } : {}),
        ...(!baseline && codeFailure ? { fail: "frontend" } : {})
      }),
      { attemptId: attempt.id }
    );
    attempt.state = "completed";
    attempt.result = {
      report,
      workflow: { id: 1001, url: "https://example.invalid/run" }
    };
    await options.save(attempt);
    return attempt;
  };
  const options = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    deadline: Date.now() + 60_000,
    save: async (state) => {
      saved = structuredClone(state);
    },
    guard: async () => {},
    verify: async () => {},
    client,
    executeServices,
    serviceClient: {
      identity: async () => ({}),
      result: async (attempt) => structuredClone(attempt.result)
    },
    maxPolls: 1
  };
  return {
    client,
    options,
    events,
    state: () => saved,
    run: (overrides) =>
      checkBatch(prepared, {
        ...options,
        ...overrides,
        save: async (value) => {
          saved = structuredClone(value);
          await overrides?.save?.(value);
        }
      })
  };
}
