import test from "node:test";
import assert from "node:assert/strict";
import {
  batchPolicyForProfile,
  batchPolicyProfile,
  canRefreshBatchPreparationPolicy,
  batchPolicy,
  copiedBatchPolicy,
  copiedRealBatchPolicy,
  earlierElapsedBatchPolicy,
  previousBatchPolicy,
  priorRealBatchPolicy,
  realBatchPolicy,
  realServicePlan,
  trustedBatchPolicy
} from "../src/batch-plan.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { serviceHash } from "../src/service-contract.mjs";

test("reviewed frontend workflow refresh changes only its pin and keeps both historical policies trusted", () => {
  const expected = structuredClone(priorRealBatchPolicy);
  expected.workflow_blobs.frontend[".github/workflows/app-pr-ci.yml"] =
    "2cc4f7a5e36ba3d056b1f4b43d534f13f2ebde9a";
  assert.deepEqual(realBatchPolicy, expected);
  for (const historical of [copiedRealBatchPolicy, priorRealBatchPolicy])
    assert.equal(trustedBatchPolicy(structuredClone(historical)), historical);
  assert.equal(
    priorRealBatchPolicy.workflow_blobs.frontend[
      ".github/workflows/app-pr-ci.yml"
    ],
    "874b4eb0070101202d0d3eda081d5e616e87cabd"
  );
  assert.notEqual(
    serviceHash(priorRealBatchPolicy),
    serviceHash(realBatchPolicy)
  );
  const unknown = structuredClone(realBatchPolicy);
  unknown.workflow_blobs.frontend[".github/workflows/app-pr-ci.yml"] =
    "f".repeat(40);
  assert.throws(() => trustedBatchPolicy(unknown), { code: "batch-policy" });
});

test("policy refresh is limited to the reviewed unpublished preparation, not owned work or release history", () => {
  const batch = {
    policy: structuredClone(priorRealBatchPolicy),
    status: "searching",
    selected: [],
    attempts: [{ progress: { prs: [], service_attempts: {} } }]
  };
  assert.equal(canRefreshBatchPreparationPolicy(batch, realBatchPolicy), true);
  const retired = { ...batch, status: "finished", stop: { status: "stale" } };
  assert.equal(
    canRefreshBatchPreparationPolicy(retired, realBatchPolicy),
    true
  );
  for (const change of [
    { policy: copiedRealBatchPolicy },
    { policy: realBatchPolicy },
    { execution: { status: "prepared" } },
    { execution: { status: "completed" } },
    { status: "finished" },
    { selected: [1] },
    {
      attempts: [
        { progress: { prs: [{ cleanup: "removed" }], service_attempts: {} } }
      ]
    },
    {
      attempts: [{ progress: { prs: [], service_attempts: { candidate: {} } } }]
    }
  ])
    assert.equal(
      canRefreshBatchPreparationPolicy(
        { ...batch, ...change },
        realBatchPolicy
      ),
      false
    );
  assert.equal(
    canRefreshBatchPreparationPolicy(batch, priorRealBatchPolicy),
    false
  );
  assert.equal(canRefreshBatchPreparationPolicy(batch, batchPolicy), false);
});

test("history-preserving policies never reuse old copy-based publication proof", () => {
  for (const [old, current] of [
    [copiedBatchPolicy, batchPolicy],
    [copiedRealBatchPolicy, realBatchPolicy]
  ]) {
    assert.equal(trustedBatchPolicy(structuredClone(old)), old);
    assert.equal(trustedBatchPolicy(structuredClone(current)), current);
    assert.notEqual(serviceHash(old), serviceHash(current));
    assert.throws(
      () => trustedBatchPolicy({ ...old, preserve_source_history: false }),
      { code: "batch-policy" }
    );
  }
});

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
    repositories: [
      {
        role: "backend",
        final_tree: "b".repeat(40),
        merges: [{ commit: "c".repeat(40) }],
        catalog: {
          commit: "c".repeat(40),
          tree: "b".repeat(40),
          blob_sha: "d".repeat(40)
        },
        checks: []
      }
    ]
  };
  const items = [{ entry: { request: { database_change: "no" } } }];
  assert.throws(
    () => realServicePlan(plan, report, items),
    /exact product backend catalog/u
  );
  report.repositories[0].checks.push({
    id: "combined_services",
    status: "pass",
    evidence: {
      status: "pass",
      order: ["backend/api"],
      edges: []
    }
  });
  assert.deepEqual(realServicePlan(plan, report, items).steps, [
    { role: "backend", unit: "api", depends_on: [] }
  ]);
  report.repositories[0].catalog.tree = "e".repeat(40);
  assert.throws(
    () => realServicePlan(plan, report, items),
    /exact product backend catalog/u
  );
});
