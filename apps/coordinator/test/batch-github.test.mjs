import test from "node:test";
import assert from "node:assert/strict";
import { createBatchGitHub } from "../src/batch-github.mjs";
import { realProfile } from "../src/profiles.mjs";

import { fixture } from "./batch-github-fixture.mjs";

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
