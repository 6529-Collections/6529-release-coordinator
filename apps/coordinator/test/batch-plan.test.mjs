import test from "node:test";
import assert from "node:assert/strict";
import {
  batchPolicyForProfile,
  batchPolicyProfile,
  earlierElapsedBatchPolicy,
  previousBatchPolicy,
  realBatchPolicy,
  realServicePlan,
  trustedBatchPolicy
} from "../src/batch-plan.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";

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

  const changed = structuredClone(previousBatchPolicy);
  changed.max_check_attempts += 1;
  assert.throws(
    () => trustedBatchPolicy(changed),
    /not a trusted Coordinator policy/u
  );
});

test("the selected profile chooses one exact trusted batch policy", () => {
  assert.equal(
    batchPolicyProfile(batchPolicyForProfile(sandboxProfile)),
    "sandbox"
  );
  assert.equal(batchPolicyForProfile(realProfile), realBatchPolicy);
  assert.equal(batchPolicyProfile(realBatchPolicy), "real");
  assert.equal(
    trustedBatchPolicy(structuredClone(realBatchPolicy)),
    realBatchPolicy
  );

  const changed = structuredClone(realBatchPolicy);
  changed.required_checks.backend.push("invented");
  assert.throws(
    () => trustedBatchPolicy(changed),
    /not a trusted Coordinator policy/u
  );
});

test("a frontend-only product batch has no backend service catalog to require", () => {
  const plan = { batch: { profile: "real", tickets: [1] } };
  const report = {
    input_hash: "a".repeat(64),
    repositories: [{ role: "frontend", checks: [] }]
  };
  const items = [{ entry: { request: { database_change: "no" } } }];
  const servicePlan = realServicePlan(plan, report, items);
  assert.deepEqual(servicePlan.steps, []);
  assert.equal(servicePlan.database.observed, "no");
});

test("a product backend batch requires the exact combined catalog graph", () => {
  const plan = { batch: { profile: "real", tickets: [1] } };
  const report = {
    input_hash: "a".repeat(64),
    repositories: [{ role: "backend", checks: [] }]
  };
  const items = [{ entry: { request: { database_change: "no" } } }];
  assert.throws(
    () => realServicePlan(plan, report, items),
    /exact product backend catalog/u
  );
  report.repositories[0].checks.push({
    id: "combined_services",
    evidence: {
      status: "pass",
      order: ["backend/api"],
      edges: []
    }
  });
  assert.deepEqual(realServicePlan(plan, report, items).steps, [
    { role: "backend", unit: "api", depends_on: [] }
  ]);
});
