import test from "node:test";
import assert from "node:assert/strict";
import { createBatchGitHub } from "../src/batch-github.mjs";
import { sandboxProfile, realProfile } from "../src/profiles.mjs";
import { batchPolicy } from "../src/batch-plan.mjs";

function fixture() {
  const repo = sandboxProfile.repositories.backend;
  const record = {
    role: "backend",
    branch: "codex/batch-trial-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    base: "a".repeat(40),
    tree: "b".repeat(40),
    actor: { id: "456", login: "tester" },
    workflow_id: 101,
    created_at: "2026-09-10T12:00:00.000Z",
    body: "Exact trial marker"
  };
  const calls = [],
    saved = [];
  let ref = null,
    pr = null,
    loseResponse = false;
  const run = {
    id: 55,
    workflow_id: 101,
    repository: repo,
    head_repository: repo,
    head_sha: "c".repeat(40),
    head_branch: record.branch,
    event: "pull_request",
    run_attempt: 1,
    actor: { id: 456 },
    path: ".github/workflows/sandbox-check.yml",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/example/actions/runs/55"
  };
  const job = {
    id: 66,
    run_id: 55,
    head_sha: run.head_sha,
    name: "Sandbox check",
    status: "completed",
    conclusion: "success",
    steps: [
      { name: "Set up job", status: "completed", conclusion: "success" },
      {
        name: "Run node scripts/check.mjs",
        status: "completed",
        conclusion: "success"
      }
    ]
  };
  const gate = {
    headRefOid: run.head_sha,
    baseRefOid: record.base,
    headRefName: record.branch,
    state: "OPEN",
    checks: [
      {
        __typename: "CheckRun",
        name: "Sandbox check",
        isRequired: true,
        status: "COMPLETED",
        conclusion: "SUCCESS"
      }
    ]
  };
  const merge = {
    sha: "d".repeat(40),
    tree: { sha: record.tree },
    parents: [{ sha: record.base }, { sha: run.head_sha }]
  };
  const execute = async (args, body) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    const path = endpoint.replace(`repos/${repo.full_name}`, "");
    calls.push({ method, path, body });
    let status = 200,
      data;
    if (method === "GET" && path === "")
      data = { ...repo, permissions: { push: true } };
    else if (path === "user") data = { id: 456, login: "tester" };
    else if (path.startsWith("/contents/"))
      data = { type: "file", sha: batchPolicy.workflow_blob };
    else if (path === "/actions/workflows/sandbox-check.yml")
      data = {
        id: 101,
        path: ".github/workflows/sandbox-check.yml",
        state: "active"
      };
    else if (path === "/git/ref/heads/main")
      data = { object: { sha: record.base } };
    else if (path === `/git/ref/heads/${record.branch}`) {
      status = ref ? 200 : 404;
      data = ref;
    } else if (path === `/git/commits/${record.base}`)
      data = { tree: { sha: "e".repeat(40) } };
    else if (path === "/git/trees" && method === "POST") {
      status = 201;
      data = { sha: record.tree };
    } else if (path === "/git/commits" && method === "POST") {
      status = 201;
      data = {
        sha: run.head_sha,
        tree: { sha: record.tree },
        parents: [{ sha: record.base }]
      };
    } else if (path === "/git/refs" && method === "POST") {
      status = 201;
      ref = { object: { sha: body.sha } };
      data = ref;
    } else if (path.startsWith("/pulls?")) data = pr ? [pr] : [];
    else if (path === "/pulls" && method === "POST") {
      status = 201;
      pr = {
        number: 25,
        state: "open",
        merged: false,
        user: { id: 456 },
        body: body.body,
        html_url: "https://github.com/example/pull/25",
        head: { ref: record.branch, sha: run.head_sha, repo },
        base: { ref: "main", sha: record.base, repo },
        merge_commit_sha: merge.sha
      };
      data = pr;
      if (loseResponse) {
        loseResponse = false;
        throw Error("Lost PR response");
      }
    } else if (path === "/pulls/25") {
      if (method === "PATCH") pr.state = body.state;
      data = pr;
    } else if (path === `/git/commits/${merge.sha}`) data = merge;
    else if (path.startsWith("/actions/workflows/101/runs?"))
      data = { total_count: 1, workflow_runs: [run] };
    else if (path === "/actions/runs/55/attempts/1/jobs?per_page=100")
      data = { total_count: 1, jobs: [job] };
    else if (
      path === `/git/refs/heads/${record.branch}` &&
      method === "DELETE"
    ) {
      ref = null;
      status = 204;
    } else throw new Error(`Unexpected fixture call: ${method} ${path}`);
    return `HTTP/2 ${status} OK\r\ncontent-type: application/json\r\n\r\n${data === undefined ? "" : JSON.stringify(data)}`;
  };
  const client = createBatchGitHub({
    profile: sandboxProfile,
    execute,
    gates: { pullRequest: async () => structuredClone(gate) },
    logs: async () =>
      `2026-09-10T12:00:00.000Z [command]/usr/bin/git log -1 --format=%H\n2026-09-10T12:00:00.000Z ${merge.sha}\n2026-09-10T12:00:01.000Z ##[group]Run node scripts/check.mjs\n` +
      '2026-09-10 {"status":"blocked","steps":[{"unit":"api","status":"blocked"}],"errors":[{"code":"service-failed"}],"cleanup":{"status":"removed"}}\n'
  });
  const patch = [
    { path: "src/api.mjs", mode: "100644", type: "blob", content: "example\n" }
  ];
  const save = async (value) => {
    saved.push(structuredClone(value));
  };
  return {
    record,
    calls,
    saved,
    client,
    run,
    job,
    gate,
    merge,
    patch,
    save,
    lose: () => {
      loseResponse = true;
    },
    pr: () => pr,
    move: () => {
      ref.object.sha = "f".repeat(40);
    }
  };
}

test("temporary PR writer saves exact identity, verifies checks, and only removes its own trial", async () => {
  const f = fixture();
  assert.equal(
    (await f.client.identity("backend", f.record.base)).workflow_id,
    101
  );
  await f.client.open(f.record, f.patch, f.save);
  assert.ok(f.saved.some((value) => value.commit && !value.number));
  assert.ok(f.saved.some((value) => value.pr_state === "creating"));
  assert.equal((await f.client.result(f.record)).status, "passed");
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
