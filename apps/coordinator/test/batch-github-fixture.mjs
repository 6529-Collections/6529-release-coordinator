import { createBatchGitHub } from "../src/batch-github.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { batchPolicy } from "../src/batch-plan.mjs";

export function fixture({
  guard = async () => {},
  after = async () => {}
} = {}) {
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
    await after({ method, path, body });
    return `HTTP/2 ${status} OK\r\ncontent-type: application/json\r\n\r\n${data === undefined ? "" : JSON.stringify(data)}`;
  };
  const client = createBatchGitHub({
    profile: sandboxProfile,
    guard,
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
