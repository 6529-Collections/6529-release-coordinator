import test from "node:test";
import assert from "node:assert/strict";
import {
  earlierElapsedBatchPolicy,
  previousBatchPolicy,
  trustedBatchPolicy
} from "../src/batch-plan.mjs";

test("the exact earlier v2 policy remains readable after its workflow changed", () => {
  assert.equal(
    trustedBatchPolicy(structuredClone(earlierElapsedBatchPolicy)),
    earlierElapsedBatchPolicy
  );

  assert.throws(
    () =>
      trustedBatchPolicy({
        ...earlierElapsedBatchPolicy,
        max_check_attempts: earlierElapsedBatchPolicy.max_check_attempts + 1
      }),
    /not a trusted Coordinator policy/u
  );
});

test("the exact earlier v3 policy remains readable after build checks changed", () => {
  assert.equal(
    trustedBatchPolicy(structuredClone(previousBatchPolicy)),
    previousBatchPolicy
  );
});
