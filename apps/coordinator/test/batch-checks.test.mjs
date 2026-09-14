import test from "node:test";
import assert from "node:assert/strict";
import { batchFixture } from "./batch-fixture.mjs";
import {
  checkBatch,
  baselineBatchPlan,
  verifySavedBatch
} from "../src/batch-checks.mjs";
import { batchMergePlan } from "../src/batch-plan.mjs";
import { generateInboxPlan } from "../src/inbox-merge-plan.mjs";
import { batchPolicy } from "../src/batch-plan.mjs";
import { serviceHash, ServiceError } from "../src/service-contract.mjs";
import { selectBatch } from "../src/batch-selection.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { validateBatchHistory } from "../src/batch-state.mjs";

import { checkHarness } from "./checks-harness.mjs";

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

test("real Git holds a net-zero candidate before expensive checks", async (t) => {
  const f = await batchFixture(t),
    item = await f.ticket();
  for (const part of item.entry.request.release_parts) {
    const repo = f.git.repositories[part.id];
    await f.git.git(repo.cwd, ["rm", "docs/ticket-1.md"]);
    await f.git.git(repo.cwd, ["commit", "-m", "Revert all requested changes"]);
    const commit = await f.git.git(repo.cwd, ["rev-parse", "HEAD"]);
    part.pull_requests[0].commit = commit;
  }
  item.input = await generateInboxPlan(item.entry, {
    profile: sandboxProfile,
    github: f.git.github
  });
  const state = await selectBatch({
    items: [item],
    prepare: f.prepare,
    check: async () =>
      assert.fail("a net-zero candidate must not start CI or services"),
    guard: async () => {},
    verify: async () => true,
    save: async () => {}
  });
  assert.deepEqual(state.selected, []);
  assert.equal(state.status, "finished");
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].phase, "git");
  assert.equal(state.stop.status, "unknown");
  assert.match(state.stop.message, /no changes against saved main/);
  validateBatchHistory({ [state.fingerprint]: state }, sandboxProfile);
});

test("empty publications cannot start checks or reuse a passing result without trials", async (t) => {
  const f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  const empty = structuredClone(prepared);
  for (const repo of empty.publications) repo.patch = [];
  const h = checkHarness(empty);
  await assert.rejects(h.run(), /without changed trees/);
  assert.deepEqual(h.events, []);
  assert.equal(h.state(), undefined);
  const valid = checkHarness(prepared);
  await valid.run();
  const invalid = valid.state();
  invalid.prs = [];
  await assert.rejects(
    verifySavedBatch(prepared, invalid, valid.options),
    /evidence or cleanup is incomplete/
  );
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
      inputs: items.map((item) => ({
        number: item.number,
        target: item.entry.request.target,
        input: item.input
      })),
      policy: batchPolicy
    })
  );
  validateBatchHistory({ [state.fingerprint]: state }, sandboxProfile);
  const empty = structuredClone(state);
  const prepared = empty.attempts.find(
    (attempt) => attempt.phase === "git"
  ).result;
  for (const repo of prepared.publications) repo.patch = [];
  const unchecked = empty.attempts.find(
    (attempt) => attempt.phase === "checks"
  );
  unchecked.progress.prs = [];
  unchecked.progress.prepared_hash = serviceHash(prepared);
  assert.throws(
    () => validateBatchHistory({ [empty.fingerprint]: empty }, sandboxProfile),
    /exact CI, service or cleanup proof/
  );
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
