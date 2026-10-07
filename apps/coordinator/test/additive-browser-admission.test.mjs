import test from "node:test";
import assert from "node:assert/strict";
import {
  priorRealBatchPolicy,
  nativeCompetitionRealBatchPolicy,
  sessionRecoveryRealBatchPolicy,
  waveCreationRealBatchPolicy
} from "../src/batch-plan.mjs";
import { realProfile } from "../src/profiles.mjs";
import { reviewedFrontendPrWorkflow } from "../src/additive-browser-workflow.mjs";
import { fixture } from "./batch-github-fixture.mjs";
import {
  browserPack,
  extendWorkflow,
  gitWorkflow,
  reviewedWorkflow
} from "./additive-browser-fixture.mjs";

const workflowPath = ".github/workflows/app-pr-ci.yml";

function admission(
  bytes = extendWorkflow([browserPack("future-example")]),
  options = {}
) {
  const file = gitWorkflow(bytes);
  return fixture({
    profile: realProfile,
    role: "frontend",
    workflowFiles: { [workflowPath]: file },
    workflowObjects: {
      [reviewedFrontendPrWorkflow]: gitWorkflow(reviewedWorkflow)
    },
    ...options
  });
}

test("an unknown future workflow hash is admitted only after full baseline/current byte verification at the exact candidate base", async () => {
  const f = admission();
  assert.notEqual(
    f.workflowFiles[workflowPath].sha,
    reviewedFrontendPrWorkflow
  );
  assert.deepEqual(await f.client.identity("frontend", f.record.base), {
    actor: { id: "209783236", login: "simo6529" },
    workflow_id: null
  });
  assert.deepEqual(
    f.calls.map(({ method, path }) => ({ method, path })),
    [
      { method: "GET", path: "" },
      { method: "GET", path: "user" },
      { method: "GET", path: `/contents/${workflowPath}?ref=${f.record.base}` },
      { method: "GET", path: `/git/blobs/${reviewedFrontendPrWorkflow}` },
      {
        method: "GET",
        path: `/contents/.github/workflows/debt-ratchet.yml?ref=${f.record.base}`
      }
    ]
  );
});

test("matching baseline admission retains the exact-pin path without extra reads or a YAML dependency", async () => {
  const f = fixture({ profile: realProfile, role: "frontend" });
  await f.client.identity("frontend", f.record.base);
  assert.equal(f.calls.length, 4);
  assert.ok(
    f.calls.every(
      ({ method, path }) => method === "GET" && !path.startsWith("/git/blobs/")
    )
  );
});

for (const [name, mutate] of [
  [
    "missing current bytes",
    (f) => delete f.workflowFiles[workflowPath].content
  ],
  [
    "current encoding",
    (f) => (f.workflowFiles[workflowPath].encoding = "utf8")
  ],
  [
    "current digest",
    (f) => (f.workflowFiles[workflowPath].sha = "f".repeat(40))
  ],
  [
    "current truncation",
    (f) =>
      (f.workflowFiles[workflowPath].content = f.workflowFiles[
        workflowPath
      ].content.slice(0, -4))
  ],
  [
    "baseline bytes",
    (f) =>
      (f.workflowObjects[reviewedFrontendPrWorkflow].content = Buffer.from(
        "unreviewed baseline"
      ).toString("base64"))
  ],
  [
    "baseline metadata",
    (f) => (f.workflowObjects[reviewedFrontendPrWorkflow].sha = "f".repeat(40))
  ],
  [
    "baseline unavailable",
    (f) => delete f.workflowObjects[reviewedFrontendPrWorkflow]
  ],
  [
    "wrong path",
    (f) => (f.workflowFiles[workflowPath].path = ".github/workflows/other.yml")
  ],
  ["symlink", (f) => (f.workflowFiles[workflowPath].type = "symlink")],
  [
    "debt workflow drift",
    (f) =>
      (f.workflowBlobs[".github/workflows/debt-ratchet.yml"] = "f".repeat(40))
  ]
]) {
  test(`extension admission refuses ${name} before any mutation`, async () => {
    const f = admission();
    mutate(f);
    await assert.rejects(f.client.identity("frontend", f.record.base), {
      code: "batch-runtime"
    });
    assert.ok(f.calls.every(({ method }) => method === "GET"));
  });
}

test("correctly rehashed workflow tampering is still refused without writes", async () => {
  const changed = Buffer.from(
    extendWorkflow([browserPack("future-example")])
      .toString()
      .replace("contents: read", "contents: write")
  );
  const f = admission(changed);
  await assert.rejects(f.client.identity("frontend", f.record.base), {
    code: "batch-runtime"
  });
  assert.ok(f.calls.every(({ method }) => method === "GET"));
});

for (const policy of [
  priorRealBatchPolicy,
  nativeCompetitionRealBatchPolicy,
  sessionRecoveryRealBatchPolicy,
  waveCreationRealBatchPolicy
]) {
  test(`saved exact policy ${policy.workflow_blobs.frontend[workflowPath]} never inherits additive approval`, async () => {
    const f = admission(undefined, { policy });
    await assert.rejects(f.client.identity("frontend", f.record.base), {
      code: "batch-runtime"
    });
    assert.equal(f.calls.length, 3);
    assert.ok(f.calls.every(({ method }) => method === "GET"));
  });
}

test("every admission rechecks full bytes, including after a successful earlier admission", async () => {
  const f = admission();
  await f.client.identity("frontend", f.record.base);
  const unsafe = Buffer.from(
    extendWorkflow([browserPack("future-example")])
      .toString()
      .replace("contents: read", "contents: write")
  );
  f.workflowFiles[workflowPath] = gitWorkflow(unsafe);
  await assert.rejects(f.client.identity("frontend", f.record.base), {
    code: "batch-runtime"
  });
  assert.ok(f.calls.every(({ method }) => method === "GET"));
});
