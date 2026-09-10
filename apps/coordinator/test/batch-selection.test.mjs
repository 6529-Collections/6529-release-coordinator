import test from "node:test";
import assert from "node:assert/strict";
import { selectBatch, batchTicketResult } from "../src/batch-selection.mjs";
import { batchPolicy } from "../src/batch-plan.mjs";
import { ServiceError } from "../src/service-contract.mjs";

const items = (count = 4) =>
  Array.from({ length: count }, (_, i) => ({
    entry: { issue_number: i + 1 },
    input: { number: i + 1, code: `commit-${i}` }
  }));
function harness({
  git = () => true,
  checks = () => true,
  count = 4,
  policy = batchPolicy
} = {}) {
  const events = [],
    writes = [];
  const options = {
    items: items(count),
    policy,
    guard: async () => {},
    verify: async () => true,
    save: async (state) => {
      writes.push(structuredClone(state));
    },
    prepare: async (group) => {
      const numbers = group.map((item) => item.entry.issue_number);
      events.push({ phase: "git", numbers });
      return git(numbers)
        ? { status: "passed", numbers }
        : { status: "blocked", kind: "conflict", conflicts: ["shared.txt"] };
    },
    check: async (prepared, options) => {
      events.push({ phase: "checks", numbers: prepared.numbers });
      assert.ok(
        writes.at(-1).attempts.some((attempt) => attempt.id === options.id)
      );
      const result = checks(prepared.numbers);
      return typeof result === "object"
        ? result
        : result
          ? { status: "passed", kind: "checks" }
          : { status: "blocked", kind: "code", baseline: { status: "passed" } };
    }
  };
  return {
    options,
    events,
    writes,
    run: (overrides) => selectBatch({ ...options, ...overrides })
  };
}

test("compatible tickets receive one combined expensive run after the cheap pass", async () => {
  const h = harness();
  const result = await h.run();
  assert.deepEqual(result.selected, [1, 2, 3, 4]);
  assert.deepEqual(h.events, [
    { phase: "git", numbers: [1, 2, 3, 4] },
    { phase: "checks", numbers: [1, 2, 3, 4] }
  ]);
  assert.equal(batchTicketResult(result, 1).status, "passed");
});

test("all cheap conflict exclusions finish before any expensive checks", async () => {
  const h = harness({
    git: (numbers) => !(numbers.includes(1) && numbers.includes(2))
  });
  const result = await h.run();
  assert.deepEqual(result.selected, [1, 3, 4]);
  assert.equal(h.events.filter((event) => event.phase === "checks").length, 1);
  assert.equal(h.events.at(-1).phase, "checks");
  assert.deepEqual(h.events.at(-1).numbers, [1, 3, 4]);
  assert.equal(batchTicketResult(result, 2).code, "batch-incompatible");
  assert.equal(batchTicketResult(result, 2).status, "waiting");
});

test("a broken independent ticket is isolated and the exact surviving union is tested", async () => {
  const h = harness({ checks: (numbers) => !numbers.includes(2) });
  const result = await h.run();
  assert.deepEqual(result.selected, [1, 3, 4]);
  assert.ok(
    h.events.some(
      (event) => event.phase === "checks" && event.numbers.join() === "1,3,4"
    )
  );
  assert.equal(batchTicketResult(result, 2).status, "blocked");
  assert.equal(batchTicketResult(result, 2).code, "batch-ticket-failed");
});

test("passing halves whose union fails are never reported as one passing group", async () => {
  const h = harness({ count: 2, checks: (numbers) => numbers.length === 1 });
  const result = await h.run();
  assert.deepEqual(result.selected, [1]);
  assert.deepEqual(
    h.events.filter((e) => e.phase === "checks").map((e) => e.numbers),
    [[1, 2], [1], [2]]
  );
  assert.equal(batchTicketResult(result, 2).status, "waiting");
  assert.equal(batchTicketResult(result, 2).code, "batch-incompatible");
  assert.match(batchTicketResult(result, 2).message, /does not prove/);
});

test("runner or baseline uncertainty never triggers a split or code blame", async () => {
  for (const kind of ["evidence", "baseline"]) {
    const h = harness({
      checks: () => ({ status: "unknown", kind, message: "Missing proof" })
    });
    const result = await h.run();
    assert.deepEqual(result.selected, []);
    assert.equal(h.events.filter((e) => e.phase === "checks").length, 1);
    assert.equal(batchTicketResult(result, 1).status, "waiting");
    assert.equal(batchTicketResult(result, 1).code, "batch-deferred");
  }
});

test("limits preserve a proven group and do not label untested tickets broken", async () => {
  const h = harness({
    count: 2,
    checks: (numbers) => numbers.length === 1,
    policy: { ...batchPolicy, max_check_attempts: 2 }
  });
  const result = await h.run();
  assert.deepEqual(result.selected, [1]);
  assert.equal(result.stop.kind, "limit");
  assert.equal(h.events.filter((e) => e.phase === "checks").length, 2);
  assert.notEqual(batchTicketResult(result, 2).status, "blocked");
});

test("same inputs reuse saved evidence; changed inputs cannot inherit a pass", async () => {
  const h = harness();
  const first = await h.run();
  const count = h.events.length;
  const second = await h.run({ previous: first });
  assert.deepEqual(second.selected, first.selected);
  assert.equal(h.events.length, count);
  const changed = items();
  changed[0].input.code = "different";
  await assert.rejects(
    h.run({ previous: first, items: changed }),
    /inputs or limits changed/
  );
  await assert.rejects(
    h.run({
      previous: first,
      policy: { ...batchPolicy, max_check_attempts: 13 }
    }),
    /inputs or limits changed/
  );
  const stale = await h.run({ previous: first, verify: async () => false });
  assert.deepEqual(stale.selected, []);
  assert.equal(stale.stop.status, "stale");
});

test("an interrupted check resumes its same attempt and saved progress", async () => {
  const h = harness();
  let savedId;
  await assert.rejects(
    h.run({
      check: async (_prepared, options) => {
        savedId = options.id;
        await options.save({ token: "saved-owned-pr" });
        throw new Error("Lost response");
      }
    }),
    /Lost response/
  );
  const previous = h.writes.at(-1);
  assert.equal(previous.status, "searching");
  const result = await h.run({
    previous,
    check: async (_prepared, options) => {
      assert.equal(options.id, savedId);
      assert.deepEqual(options.previous, { token: "saved-owned-pr" });
      return { status: "passed" };
    }
  });
  assert.equal(result.attempts.filter((a) => a.phase === "checks").length, 1);
  assert.deepEqual(result.selected, [1, 2, 3, 4]);
});

test("elapsed search limit starts no new expensive work and survives resume", async () => {
  const h = harness();
  let clock = 1_000;
  const result = await h.run({
    now: () => clock,
    prepare: async (group) => {
      clock += batchPolicy.max_elapsed_ms + 1;
      return {
        status: "passed",
        numbers: group.map((item) => item.entry.issue_number)
      };
    },
    check: async () => assert.fail("expired selection must not start CI")
  });
  assert.deepEqual(result.selected, []);
  assert.equal(result.stop.kind, "limit");
  assert.equal(
    result.attempts.filter((attempt) => attempt.phase === "checks").length,
    0
  );
  const next = await h.run({ previous: result, now: () => clock });
  assert.equal(next.deadline, result.deadline);
  assert.deepEqual(next.selected, []);
});

test("a new base invalidates a saved pass even after successful cleanup", async () => {
  const h = harness({ count: 2 });
  const passed = await h.run();
  const stale = await h.run({ previous: passed, verify: async () => false });
  assert.deepEqual(stale.selected, []);
  assert.equal(batchTicketResult(stale, 1).status, "stale");
  assert.equal(h.events.filter((event) => event.phase === "checks").length, 1);
});

test("changed inputs and failed saves stop before starting expensive checks", async () => {
  const h = harness();
  await assert.rejects(
    h.run({
      save: async () => {
        throw new Error("journal failure");
      }
    }),
    /journal failure/
  );
  assert.equal(h.events.length, 0);
  const result = await h.run({
    prepare: async () => {
      throw new ServiceError("stale", "Main moved", "stale");
    },
    check: async () => assert.fail("must not run")
  });
  assert.equal(result.stop.status, "stale");
  assert.deepEqual(result.selected, []);
});

test("a repeated completed selection reads existing proof before reusing it", async () => {
  const h = harness();
  const previous = await h.run();
  let reads = 0;
  const repeated = await h.run({
    previous,
    revalidate: async () => {
      reads++;
    }
  });
  assert.deepEqual(repeated.selected, previous.selected);
  assert.equal(reads, 1);
  assert.equal(h.events.filter((event) => event.phase === "checks").length, 1);
  await assert.rejects(
    h.run({
      previous,
      revalidate: async () => {
        throw Error("Remote evidence changed");
      }
    }),
    /Remote evidence changed/
  );
});
