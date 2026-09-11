import assert from "node:assert/strict";
import { selectBatch } from "../src/batch-selection.mjs";
import { batchPolicy } from "../src/batch-plan.mjs";

export const items = (count = 4) =>
  Array.from({ length: count }, (_, i) => ({
    entry: { issue_number: i + 1 },
    input: { number: i + 1, code: `commit-${i}` }
  }));
export function harness({
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
