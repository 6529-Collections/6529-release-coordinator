import test from "node:test";
import assert from "node:assert/strict";
import { createBatchGitHub } from "../src/batch-github.mjs";
import { realProfile } from "../src/profiles.mjs";
import {
  previousBatchPolicy,
  nativeCompetitionRealBatchPolicy,
  priorRealBatchPolicy,
  sessionRecoveryRealBatchPolicy,
  waveCreationRealBatchPolicy,
  realBatchPolicy
} from "../src/batch-plan.mjs";

import { fixture } from "./batch-github-fixture.mjs";

test("frontend pin refresh never accepts unreviewed backend PR workflow drift", async () => {
  const f = fixture({ profile: realProfile, role: "backend" });
  const path = ".github/workflows/on-pull-request.yml";
  assert.equal(
    (await f.client.identity("backend", f.record.base)).workflow_id,
    null
  );
  f.workflowBlobs[path] = "cb4754bf078b883d7620f0d26cdb2c92b8058f70";
  await assert.rejects(f.client.identity("backend", f.record.base), {
    code: "batch-runtime"
  });
  assert.ok(f.calls.every((call) => call.method === "GET"));
  assert.equal(
    realBatchPolicy.workflow_blobs.backend[path],
    priorRealBatchPolicy.workflow_blobs.backend[path]
  );
});

test("real frontend exact-pin admission rejects old or unverifiable workflow bytes", async () => {
  const path = ".github/workflows/app-pr-ci.yml";
  const f = fixture({ profile: realProfile, role: "frontend" });
  // Independent literals prevent the fixture and implementation sharing a typo.
  assert.equal(
    realBatchPolicy.workflow_blobs.frontend[path],
    "9209601a51023b4a17609fb7cdacb360a2e34977"
  );
  f.workflowBlobs[path] = "9209601a51023b4a17609fb7cdacb360a2e34977";
  assert.equal(
    (await f.client.identity("frontend", f.record.base)).workflow_id,
    null
  );
  for (const blob of [
    priorRealBatchPolicy.workflow_blobs.frontend[path],
    nativeCompetitionRealBatchPolicy.workflow_blobs.frontend[path],
    "0a506cbf14c340198c5273a560b0968d901cbebd",
    "134e53f46bfe207742adcc4fec392128bec75ab8",
    "f".repeat(40)
  ]) {
    f.workflowBlobs[path] = blob;
    await assert.rejects(f.client.identity("frontend", f.record.base), {
      code: "batch-runtime"
    });
  }
  for (const policy of [
    priorRealBatchPolicy,
    nativeCompetitionRealBatchPolicy,
    sessionRecoveryRealBatchPolicy,
    waveCreationRealBatchPolicy
  ]) {
    const historical = fixture({
      profile: realProfile,
      role: "frontend",
      policy
    });
    assert.equal(
      (await historical.client.identity("frontend", historical.record.base))
        .workflow_id,
      null
    );
    historical.workflowBlobs[path] =
      realBatchPolicy.workflow_blobs.frontend[path];
    await assert.rejects(
      historical.client.identity("frontend", historical.record.base),
      { code: "batch-runtime" }
    );
    assert.ok(historical.calls.every((call) => call.method === "GET"));
  }
  assert.ok(f.calls.every((call) => call.method === "GET"));
});

test("published candidate preserves every selected original head and rejects lost history", async () => {
  const f = fixture({ profile: realProfile });
  f.record.source_prs = [
    { number: 1, branch: "codex/a", commit: "1".repeat(40) },
    { number: 2, branch: "codex/b", commit: "2".repeat(40) }
  ];
  await f.client.open(f.record, f.patch, f.save);
  const commit = f.calls.find(
    (call) => call.path === "/git/commits" && call.method === "POST"
  ).body;
  assert.deepEqual(commit.parents, [
    f.record.base,
    "1".repeat(40),
    "2".repeat(40)
  ]);
  assert.equal((await f.client.result(f.record)).status, "passed");
  const parents = structuredClone(f.tested.parents);
  for (const mutate of [
    (tested) => tested.parents.pop(),
    (tested) => {
      tested.parents[1].sha = "f".repeat(40);
    },
    (tested) => tested.parents.reverse(),
    (tested) => {
      tested.tree.sha = "f".repeat(40);
    }
  ]) {
    f.tested.parents = structuredClone(parents);
    mutate(f.tested);
    await assert.rejects(f.client.result(f.record), /saved exact tested tree/);
  }
});

test("temporary PR writer saves exact identity, verifies checks, and only removes its own trial", async () => {
  const f = fixture();
  assert.equal(
    (await f.client.identity("backend", f.record.base)).workflow_id,
    101
  );
  await f.client.open(f.record, f.patch, f.save);
  assert.ok(f.saved.some((value) => value.commit && !value.number));
  assert.ok(f.saved.some((value) => value.pr_state === "creating"));
  const result = await f.client.result(f.record);
  assert.equal(result.status, "passed");
  assert.equal(result.workflow, f.run.html_url);
  assert.equal(result.workflow_id, f.run.id);
  await f.client.cleanup(f.record);
  assert.equal(f.pr().state, "closed");
  assert.ok(
    !f.calls.some(
      (call) => call.method === "PUT" || call.path.includes("/merge")
    )
  );
  assert.ok(
    f.calls
      .filter((call) => call.method === "DELETE")
      .every((call) => call.path.includes("/codex/batch-trial-"))
  );
});

test("real trial checks bind the exact head tree and base without trusting mergeability", async () => {
  const f = fixture({ profile: realProfile });
  assert.equal(
    (await f.client.identity("backend", f.record.base)).workflow_id,
    null
  );
  await f.client.open(f.record, f.patch, f.save);
  const created = f.calls.find(
    (call) => call.method === "POST" && call.path === "/git/commits"
  ).body;
  assert.deepEqual(created.author, {
    name: "Simo",
    email: "209783236+simo6529@users.noreply.github.com",
    date: f.record.created_at
  });
  assert.deepEqual(created.committer, created.author);
  assert.equal(
    created.message,
    `Temporary batch trial ${f.record.branch}\n\nSigned-off-by: Simo <209783236+simo6529@users.noreply.github.com>`
  );
  f.gate.mergeable = "UNKNOWN";
  f.gate.mergeStateStatus = "BLOCKED";
  const result = await f.client.result(f.record);
  assert.equal(result.status, "passed");
  f.tested.tree.sha = "f".repeat(40);
  await assert.rejects(f.client.result(f.record), /saved exact tested tree/u);
});

test("real trial refuses a different authenticated signer before creating a commit", async () => {
  const f = fixture({ profile: realProfile });
  f.authenticatedActor.id = 999;
  await assert.rejects(
    f.client.open(f.record, f.patch, f.save),
    /authorized, currently authenticated/u
  );
  assert.equal(
    f.calls.some((call) => call.method === "POST"),
    false
  );
  f.authenticatedActor.id = 209783236;
  f.authenticatedActor.login = "another-account";
  await assert.rejects(
    f.client.open(f.record, f.patch, f.save),
    /authorized, currently authenticated/u
  );
  assert.equal(
    f.calls.some((call) => call.method === "POST"),
    false
  );
});

test("real trial waits for a missing required job and recognizes required status contexts", async () => {
  const f = fixture({ profile: realProfile, role: "frontend" });
  await f.client.open(f.record, f.patch, f.save);
  const snyk = f.gate.checks.find(
    (check) => check.name === "security/snyk (6529)"
  );
  snyk.__typename = "StatusContext";
  snyk.context = snyk.name;
  snyk.state = "SUCCESS";
  delete snyk.name;
  delete snyk.status;
  delete snyk.conclusion;

  const installed = f.gate.checks.find(
    (check) => check.name === "Installed app checks"
  );
  f.gate.checks = f.gate.checks.filter((check) => check !== installed);
  assert.equal(await f.client.result(f.record), null);
  snyk.isRequired = false;
  await assert.rejects(f.client.result(f.record), /no longer required/u);
  snyk.isRequired = true;
  f.gate.checks.push(installed);

  const passing = await f.client.result(f.record);
  assert.equal(passing.status, "passed");
  assert.ok(
    passing.checks.some((check) => check.name === "security/snyk (6529)")
  );
  f.gate.checks.find((check) => check.name === "DCO").conclusion =
    "ACTION_REQUIRED";
  assert.equal((await f.client.result(f.record)).status, "unknown");
  snyk.isRequired = false;
  await assert.rejects(f.client.result(f.record), /no longer required/u);
});

test("an archived product repository cannot start a real trial", async () => {
  const f = fixture({ profile: realProfile, archived: true });
  await assert.rejects(
    f.client.identity("backend", f.record.base),
    /Product repository access/u
  );
  assert.equal(
    f.calls.some((call) => call.method === "POST"),
    false
  );
});

test("each sandbox repository uses its own trusted build workflow", async () => {
  for (const role of ["backend", "frontend"]) {
    const f = fixture({ role });
    assert.equal(
      (await f.client.identity(role, f.record.base)).workflow_id,
      101
    );
  }
});

test("the historical scalar workflow pin resolves for both roles", async () => {
  for (const role of ["backend", "frontend"]) {
    const f = fixture({ role, policy: previousBatchPolicy });
    assert.equal(
      (await f.client.identity(role, f.record.base)).workflow_id,
      101
    );
  }
});

test("lost PR creation response is recovered by its saved branch without a second POST", async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(
    f.client.open(f.record, f.patch, f.save),
    /Lost PR response/
  );
  assert.equal(f.record.pr_state, "creating");
  await f.client.open(f.record, f.patch, f.save);
  assert.equal(f.record.number, 25);
  assert.equal(
    f.calls.filter((call) => call.method === "POST" && call.path === "/pulls")
      .length,
    1
  );
});

test("unknown PR creation can be reconciled for cleanup without reopening it", async () => {
  const f = fixture();
  f.lose();
  await assert.rejects(f.client.open(f.record, f.patch, f.save));
  await f.client.cleanup(f.record);
  assert.equal(f.pr().state, "closed");
  assert.equal(
    f.calls.filter((call) => call.method === "POST" && call.path === "/pulls")
      .length,
    1
  );
});

test("real profile, source branches, workflows and moved trial refs are refused", async () => {
  assert.throws(() => createBatchGitHub({ profile: realProfile }), /sandbox/);
  for (const branch of ["main", "codex/source", "codex/inbox-state"]) {
    const f = fixture();
    f.record.branch = branch;
    await assert.rejects(f.client.open(f.record, f.patch, f.save), /identity/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(
    f.client.open(
      f.record,
      [{ ...f.patch[0], path: ".github/workflows/evil.yml" }],
      f.save
    ),
    /supported/
  );
  assert.ok(f.calls.every((call) => call.method === "GET"));
  await f.client.open(f.record, f.patch, f.save);
  f.move();
  await assert.rejects(f.client.cleanup(f.record), /ref changed/);
  assert.ok(!f.calls.some((call) => call.method === "DELETE"));
});

test("missing/skipped checks, wrong actors, wrong trees and reruns cannot supply passing evidence", async () => {
  for (const change of [
    (f) => {
      f.run.actor.id = 999;
    },
    (f) => {
      f.run.run_attempt = 2;
    },
    (f) => {
      f.merge.tree.sha = "f".repeat(40);
    },
    (f) => {
      f.job.steps[1].conclusion = "skipped";
    },
    (f) => {
      f.gate.checks = [];
    },
    (f) => {
      f.run.conclusion = "cancelled";
    }
  ]) {
    const f = fixture();
    await f.client.open(f.record, f.patch, f.save);
    change(f);
    await assert.rejects(f.client.result(f.record));
  }
});

test("only a completed trusted sample failure is classified as code failure", async () => {
  const f = fixture();
  await f.client.open(f.record, f.patch, f.save);
  f.run.conclusion = "failure";
  f.job.conclusion = "failure";
  f.job.steps[1].conclusion = "failure";
  f.gate.checks[0].conclusion = "FAILURE";
  const result = await f.client.result(f.record);
  assert.equal(result.status, "blocked");
  assert.equal(result.kind, "code");
  f.job.steps[0].conclusion = "failure";
  f.job.steps[1].conclusion = "skipped";
  await assert.rejects(f.client.result(f.record), /did not run/);
});

test("closed trial proof can be verified without any writes or rerunning CI", async () => {
  const f = fixture();
  await f.client.open(f.record, f.patch, f.save);
  const original = await f.client.result(f.record);
  await f.client.cleanup(f.record);
  f.gate.state = "CLOSED";
  f.pr().merge_commit_sha = null;
  const count = f.calls.length;
  assert.deepEqual(await f.client.result(f.record, { closed: true }), original);
  assert.ok(f.calls.slice(count).every((call) => call.method === "GET"));
  f.merge.tree.sha = "f".repeat(40);
  await assert.rejects(
    f.client.result(f.record, { closed: true }),
    /actual checkout/
  );
});

test("appended review summaries preserve identity but editing the original trial block does not", async () => {
  const f = fixture();
  await f.client.open(f.record, f.patch, f.save);
  f.pr().body += "\n\n## Summary by a review bot\nExtra untrusted notes.";
  assert.equal((await f.client.result(f.record)).status, "passed");
  const withNotes = f.pr().body;
  f.pr().body = withNotes.replace("Exact trial marker", "Changed trial marker");
  await assert.rejects(f.client.result(f.record), /ownership/);
  f.pr().body = withNotes;
  await f.client.cleanup(f.record);
  assert.equal(f.pr().state, "closed");
});
