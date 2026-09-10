import test from "node:test";
import assert from "node:assert/strict";
import { batchFixture } from "./batch-fixture.mjs";
import {
  checkBatch,
  baselineBatchPlan,
  verifySavedBatch
} from "../src/batch-checks.mjs";
import { batchMergePlan } from "../src/batch-plan.mjs";
import { batchPolicy } from "../src/batch-plan.mjs";
import {
  serviceHash,
  executeServiceSteps,
  ServiceError
} from "../src/service-contract.mjs";
import { serviceAdapter } from "./service-fixture.mjs";
import { selectBatch } from "../src/batch-selection.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { validateBatchHistory } from "../src/batch-state.mjs";

function checkHarness(
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

test("real Git combines whole cross-repository tickets and captures exact supported patches", async (t) => {
  const f = await batchFixture(t),
    a = await f.ticket(),
    b = await f.ticket();
  const result = await f.prepare([a, b]);
  assert.equal(result.status, "passed");
  assert.deepEqual(
    result.binding.tickets.map((ticket) => ticket.issue_number),
    [1, 2]
  );
  assert.deepEqual(
    result.publications.map((repo) => repo.patch.length),
    [2, 2]
  );
  assert.equal(result.service_plan.database.observed, "no");
  assert.equal(result.service_plan.sources.frontend.pull_requests.length, 2);
  const baseline = baselineBatchPlan(result);
  assert.equal(baseline.binding.purpose, "unchanged-batch-baseline");
  assert.equal(
    baseline.sources.backend.tree,
    result.service_plan.sources.backend.base_tree
  );
  for (const role of ["frontend", "backend"])
    assert.equal(
      await f.git.git(f.git.repositories[role].cwd, ["rev-parse", "main"]),
      f.git.repositories[role].base
    );
});

test("real Git catches conflicts between different tickets without running programs", async (t) => {
  const f = await batchFixture(t);
  const a = await f.ticket({ backend: { "shared.txt": "left\n" } });
  const b = await f.ticket({ backend: { "shared.txt": "right\n" } });
  const result = await f.prepare([a, b]);
  assert.equal(result.status, "blocked");
  assert.equal(result.kind, "conflict");
  assert.deepEqual(result.conflicts[0].paths, ["shared.txt"]);
});

test("batch scope cannot substitute versions, split a ticket, mix targets or use real repos", async (t) => {
  const f = await batchFixture(t),
    item = await f.ticket();
  assert.throws(() => batchMergePlan([item], realProfile), /sandbox/);
  for (const mutate of [
    (value) => {
      value.input.repositories.pop();
    },
    (value) => {
      value.input.repositories[0].pull_requests[0].commit = "f".repeat(40);
    },
    (value) => {
      value.entry.request.target = "production";
    },
    (value) => {
      value.entry.request.database_change = "yes";
    }
  ]) {
    const changed = structuredClone(item);
    mutate(changed);
    assert.throws(() => batchMergePlan([changed]));
  }
});

test("combined PR checks and integration run once, preserve progress and clean both temporary PRs", async (t) => {
  const f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket(), await f.ticket()]);
  const h = checkHarness(prepared);
  assert.equal((await h.run()).status, "passed");
  assert.deepEqual(h.events, [
    "open:backend",
    "open:frontend",
    "services",
    "cleanup:backend",
    "cleanup:frontend"
  ]);
  assert.equal(h.state().cleanup, "removed");
  await h.run({ previous: h.state() });
  assert.equal(h.events.length, 5);
  const changed = structuredClone(prepared);
  changed.input_hash = "f".repeat(64);
  await assert.rejects(
    checkBatch(changed, { ...h.options, previous: h.state() }),
    /inputs changed/
  );
});

test("failed combination checks the unchanged baseline before attributing a code failure", async (t) => {
  const f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  for (const baselineFails of [false, true]) {
    const h = checkHarness(prepared, { codeFailure: true, baselineFails });
    const result = await h.run();
    assert.equal(result.status, baselineFails ? "unknown" : "blocked");
    assert.equal(result.kind, baselineFails ? "baseline" : "code");
    assert.ok(h.events.indexOf("baseline") > h.events.indexOf("services"));
    assert.equal(h.state().cleanup, "removed");
  }
});

test("pending checks and uncertain PR writes retain owned state for explicit resume", async (t) => {
  const f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  const h = checkHarness(prepared, { pending: true });
  await assert.rejects(h.run(), /still pending/);
  assert.equal(h.state().prs.length, 2);
  assert.equal(h.state().cleanup, "pending");
  assert.ok(!h.events.includes("services"));
  h.client.result = async () => ({ status: "passed" });
  assert.equal((await h.run({ previous: h.state() })).status, "passed");
  assert.equal(h.events.filter((event) => event === "services").length, 1);
});

test("stale input cleans owned temporary PRs and cannot publish a passing result", async (t) => {
  const f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  const h = checkHarness(prepared);
  let reads = 0;
  const result = await h.run({
    verify: async () => {
      if (++reads === 2)
        throw new ServiceError("batch-stale", "Main moved", "stale");
    }
  });
  assert.equal(result.status, "stale");
  assert.equal(h.state().cleanup, "removed");
  assert.ok(!h.events.includes("services"));
});

test("durable batch history requires the exact selected group and completed cleanup", async (t) => {
  const f = await batchFixture(t),
    items = [await f.ticket(), await f.ticket()];
  const state = await selectBatch({
    items,
    prepare: f.prepare,
    guard: async () => {},
    verify: async () => true,
    save: async () => {},
    check: async (prepared, options) => {
      const h = checkHarness(prepared);
      return h.run({ ...options, deadline: Date.now() + 60_000 });
    }
  });
  assert.equal(
    state.fingerprint,
    serviceHash({
      inputs: items.map((item) => ({ number: item.number, input: item.input })),
      policy: batchPolicy
    })
  );
  validateBatchHistory({ [state.fingerprint]: state }, sandboxProfile);
  const broken = structuredClone(state);
  broken.attempts.find(
    (attempt) => attempt.phase === "checks"
  ).progress.cleanup = "pending";
  assert.throws(
    () =>
      validateBatchHistory({ [broken.fingerprint]: broken }, sandboxProfile),
    /cleanup proof/
  );
  assert.throws(
    () => validateBatchHistory({ [state.fingerprint]: state }, realProfile),
    /Invalid/
  );
  const unsupportedBlame = structuredClone(state);
  unsupportedBlame.selected = [];
  const failed = unsupportedBlame.attempts.find(
    (attempt) => attempt.phase === "checks"
  );
  failed.result = { status: "blocked", kind: "code" };
  failed.progress.result = structuredClone(failed.result);
  assert.throws(
    () =>
      validateBatchHistory(
        { [state.fingerprint]: unsupportedBlame },
        sandboxProfile
      ),
    /passing baseline proof/
  );
});

test("saved checks are reverified and changed remote evidence cannot be reused", async (t) => {
  const f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  const h = checkHarness(prepared);
  await h.run();
  const count = h.events.length;
  await verifySavedBatch(prepared, h.state(), h.options);
  assert.equal(h.events.length, count);
  h.client.result = async () => ({ status: "blocked" });
  await assert.rejects(
    verifySavedBatch(prepared, h.state(), h.options),
    /trial PR evidence changed/
  );
  h.client.result = async (record) => structuredClone(record.result);
  h.options.serviceClient.result = async (attempt) => ({
    ...attempt.result,
    workflow: { id: 999 }
  });
  await assert.rejects(
    verifySavedBatch(prepared, h.state(), h.options),
    /service evidence changed/
  );
});

test("an interrupted candidate finishes its second repository after the search deadline", async (t) => {
  const f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  const h = checkHarness(prepared);
  const open = h.client.open;
  h.client.open = async (...args) => {
    await open(...args);
    throw Error("Interrupted after the first PR was saved");
  };
  await assert.rejects(h.run(), /first PR was saved/);
  assert.equal(h.state().prs.length, 1);
  h.client.open = open;
  const result = await h.run({ previous: h.state(), deadline: Date.now() - 1 });
  assert.equal(result.status, "passed");
  assert.equal(h.state().cleanup, "removed");
  assert.equal(h.state().prs.length, 2);
});
