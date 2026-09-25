import assert from "node:assert/strict";
import test from "node:test";
import {
  createReleaseGitHub,
  integrationGateChecks,
  integrationPullPasses
} from "../src/release-github.mjs";
import {
  makeReleaseBuild,
  makeReleaseOperation,
  releaseBuildFiles,
  releaseEnvironments,
  releaseProtocol
} from "../src/release-contract.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { realProductWorkflowRuntime } from "../src/product-workflow-runtime-config.mjs";
import { integrationCommitInput } from "../src/release-plan.mjs";

const runtime = {
  workflow: "sandbox-release.yml",
  job: "Sandbox release",
  step: "Run sandbox release operation",
  branches: { staging: "1a-staging", prod: "main" },
  repositories: {
    backend: {
      stagingIntegrationChecks: ["Sandbox check"],
      files: {
        ".github/workflows/sandbox-release.yml": "a".repeat(40),
        "coordinator/src/release-contract.mjs": "b".repeat(40),
        "coordinator/sandbox/release-run.mjs": "c".repeat(40),
        "coordinator/sandbox/application-build.mjs": "1".repeat(40)
      }
    },
    frontend: {
      stagingIntegrationChecks: ["Sandbox check"],
      files: {
        ".github/workflows/sandbox-release.yml": "d".repeat(40),
        "coordinator/src/release-contract.mjs": "e".repeat(40),
        "coordinator/sandbox/release-run.mjs": "f".repeat(40),
        "coordinator/sandbox/application-build.mjs": "2".repeat(40)
      }
    }
  }
};

test("staging gates optional product checks while main still requires GitHub enforcement", () => {
  const commit = "a".repeat(40);
  const checks = [
    {
      __typename: "CheckRun",
      name: "DCO",
      isRequired: false,
      status: "COMPLETED",
      conclusion: "SUCCESS"
    },
    {
      __typename: "StatusContext",
      context: "security/snyk (6529)",
      isRequired: false,
      state: "SUCCESS"
    },
    {
      __typename: "CheckRun",
      name: "Other required check",
      isRequired: true,
      status: "COMPLETED",
      conclusion: "SUCCESS"
    }
  ];
  const selected = integrationGateChecks(
    checks,
    commit,
    ["DCO", "security/snyk (6529)"],
    false
  );
  assert.deepEqual(selected.checks, [checks[2], checks[0], checks[1]]);
  assert.deepEqual(selected.missing, []);
  assert.deepEqual(
    integrationGateChecks(checks, commit, ["DCO"], true).missing,
    ["DCO"]
  );
  assert.deepEqual(
    integrationGateChecks(checks, commit, ["Missing check"], false).missing,
    ["Missing check"]
  );
  assert.deepEqual(
    integrationGateChecks(checks, commit, ["Other required check"], true),
    { checks: [checks[2]], missing: [] }
  );
});

test("integration merge accepts only a verified approval bypass with green checks", () => {
  const head = "a".repeat(40);
  const base = "b".repeat(40);
  const check = {
    __typename: "CheckRun",
    status: "COMPLETED",
    conclusion: "SUCCESS"
  };
  const observed = {
    state: "OPEN",
    isDraft: false,
    headRefOid: head,
    baseRefOid: base,
    mergeable: "MERGEABLE",
    mergeStateStatus: "BLOCKED",
    reviewDecision: "REVIEW_REQUIRED",
    approvalBypass: {
      status: "eligible",
      ruleset_id: 23921709,
      head_commit: head,
      base_commit: base
    }
  };
  assert.equal(integrationPullPasses(observed, [check]), true);
  for (const change of [
    (value) => {
      value.approvalBypass = null;
    },
    (value) => {
      value.reviewDecision = "CHANGES_REQUESTED";
    },
    (value) => {
      value.mergeable = "CONFLICTING";
    },
    (value) => {
      value.headRefOid = "c".repeat(40);
    },
    (value) => {
      value.baseRefOid = "d".repeat(40);
    }
  ]) {
    const changed = structuredClone(observed);
    change(changed);
    assert.equal(integrationPullPasses(changed, [check]), false);
  }
  assert.equal(
    integrationPullPasses(observed, [{ ...check, conclusion: "FAILURE" }]),
    false
  );
  assert.equal(
    integrationPullPasses(observed, [
      { ...check, status: "IN_PROGRESS", conclusion: null }
    ]),
    false
  );
});

function runtimeFile(endpoint, changed = false) {
  const role = endpoint.includes("release-coordinator-test-frontend")
    ? "frontend"
    : "backend";
  const path = endpoint.match(/\/contents\/(.+)\?ref=/u)?.[1];
  assert.ok(path);
  return {
    type: "file",
    path,
    sha: changed ? "0".repeat(40) : runtime.repositories[role].files[path]
  };
}

function environmentRef(endpoint, operation) {
  const role = endpoint.includes("release-coordinator-test-frontend")
    ? "frontend"
    : "backend";
  return { object: { sha: operation[`${role}_commit`] } };
}

const apiResponse = (status, data) =>
  `HTTP/2 ${status} Result\nContent-Type: application/json\n\n${data === undefined ? "" : JSON.stringify(data)}`;

function fixture(role = "backend", kind = "deploy") {
  const e2e = kind === "e2e";
  const unit = e2e ? null : role === "backend" ? "worker" : "frontend";
  const runnerRole = e2e ? "backend" : role;
  const operation = makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: kind,
    environment: "staging",
    role: e2e ? null : role,
    unit,
    backend_commit: "c".repeat(40),
    frontend_commit: "d".repeat(40)
  });
  const record = {
    id: operation.operation_id,
    release_id: operation.release_id,
    step: {
      id: e2e ? "staging:e2e" : `staging:deploy:${role}:${unit}`,
      kind,
      environment: "staging",
      role: e2e ? null : role,
      unit
    },
    state: "running",
    actor: { id: "456", login: "tester" },
    created_at: "2026-09-11T12:00:00.000Z",
    workflow_id: 99,
    operation
  };
  const run = {
    id: 101,
    repository: {
      id: sandboxProfile.repositories[runnerRole].id,
      full_name: sandboxProfile.repositories[runnerRole].full_name
    },
    head_repository: { id: sandboxProfile.repositories[runnerRole].id },
    head_sha: operation[`${runnerRole}_commit`],
    head_branch: "1a-staging",
    event: "workflow_dispatch",
    run_attempt: 2,
    path: ".github/workflows/sandbox-release.yml",
    display_title: `Sandbox release ${record.id}`,
    actor: { id: 456 },
    workflow_id: 99,
    status: "completed",
    conclusion: "success",
    html_url: "https://example.invalid/run/101"
  };
  const report = {
    protocol: releaseProtocol,
    profile: "sandbox",
    release_id: operation.release_id,
    operation_id: operation.operation_id,
    operation_hash: operation.fingerprint,
    operation: operation.operation,
    environment: operation.environment,
    role: operation.role,
    unit: operation.unit,
    status: "passed",
    checks: [{ name: "worker", status: "passed" }],
    builds: Object.fromEntries(
      (e2e ? ["backend", "frontend"] : [role]).map((buildRole) => [
        buildRole,
        {
          manifest: makeReleaseBuild({
            role: buildRole,
            source_commit: operation[`${buildRole}_commit`],
            files: releaseBuildFiles[buildRole].map((path) => ({
              path,
              sha256: "a".repeat(64),
              bytes: 1
            }))
          }),
          artifact: {
            name: `sandbox-build-${operation.operation_id}-${buildRole}`,
            digest: "b".repeat(64)
          }
        }
      ])
    ),
    versions: {
      backend: operation.backend_commit,
      frontend: operation.frontend_commit
    },
    runner: {
      repository: sandboxProfile.repositories[runnerRole].full_name,
      run_id: run.id,
      attempt: run.run_attempt,
      commit: run.head_sha
    },
    completed_at: "2026-09-11T12:01:00.000Z"
  };
  const job = {
    id: 102,
    name: runtime.job,
    run_id: run.id,
    head_sha: run.head_sha,
    status: "completed",
    conclusion: "success",
    steps: [{ name: runtime.step, status: "completed", conclusion: "success" }]
  };
  return { operation, record, run, report, job };
}

const runUrl =
  "https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs";
const activeRun = (id, status, login = "alice") => ({
  id,
  status,
  html_url: `${runUrl}/${id}`,
  actor: { login }
});

// A dispatching client: pinned runtime files, the active-run listing, the
// environment ref, the dispatch itself and the completed run's evidence.
function dispatchingClient(f, { active, wait, signal, pollMs } = {}) {
  const calls = [];
  let dispatched = false;
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    signal,
    ...(wait ? { wait } : {}),
    ...(pollMs ? { pollMs } : {}),
    execute: async (args, body) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint, body });
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      // GitHub's status filter returns only runs in that status; the newest
      // unfiltered page shows every recent run with its current status.
      if (endpoint.includes("/runs?status=")) {
        const status = endpoint.match(/status=([a-z_]+)/u)[1];
        const runs = active(status).filter((run) => run.status === status);
        return apiResponse("200 OK", {
          total_count: runs.length,
          workflow_runs: runs
        });
      }
      if (endpoint.endsWith("/runs?per_page=100")) {
        const runs = [...active("recent"), ...(dispatched ? [f.run] : [])];
        return apiResponse("200 OK", {
          total_count: runs.length,
          workflow_runs: runs
        });
      }
      if (endpoint.includes("/runs?"))
        return apiResponse(
          "200 OK",
          dispatched
            ? { total_count: 1, workflow_runs: [f.run] }
            : { total_count: 0, workflow_runs: [] }
        );
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", environmentRef(endpoint, f.operation));
      if (method === "POST" && endpoint.endsWith("/dispatches")) {
        dispatched = true;
        return apiResponse("204 No Content");
      }
      if (endpoint.endsWith(`/actions/runs/${f.run.id}`))
        return apiResponse("200 OK", f.run);
      if (endpoint.includes("/attempts/2/jobs"))
        return apiResponse("200 OK", { total_count: 1, jobs: [f.job] });
      assert.fail(`${method} ${endpoint}`);
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  return { client, calls };
}

test("release workflow result binds exact operation, commits, actor and rerun attempt", async () => {
  const f = fixture();
  let runSearch;
  const saves = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      let value;
      if (endpoint.includes("/contents/")) value = runtimeFile(endpoint);
      else if (endpoint.includes("/git/ref/heads/"))
        value = environmentRef(endpoint, f.operation);
      else if (endpoint.includes("/runs?")) {
        runSearch = endpoint;
        value = { total_count: 1, workflow_runs: [f.run] };
      } else if (endpoint.includes("/attempts/2/jobs"))
        value = { total_count: 1, jobs: [f.job] };
      else assert.fail(endpoint);
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify(value)}`;
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => saves.push(structuredClone(f.record))
  });
  assert.equal(result.status, "passed");
  assert.equal(result.report.runner.attempt, 2);
  assert.doesNotMatch(runSearch, /[?&]actor=/u);
  assert.ok(
    saves.some(
      (record) =>
        record.state === "running" &&
        record.workflow_run_id === f.run.id &&
        record.workflow_id === f.run.workflow_id
    )
  );
});

test("moved sandbox ref invalidates a matching completed workflow", async () => {
  const f = fixture();
  const calls = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      if (endpoint.includes("/runs?"))
        return apiResponse("200 OK", {
          total_count: 1,
          workflow_runs: [f.run]
        });
      if (endpoint.includes("/attempts/2/jobs"))
        return apiResponse("200 OK", { total_count: 1, jobs: [f.job] });
      if (endpoint.includes("/git/ref/heads/"))
        return apiResponse("200 OK", {
          object: { sha: "a".repeat(40) }
        });
      assert.fail(endpoint);
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  await assert.rejects(
    client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => {}
    }),
    /changed before workflow result acceptance/u
  );
  assert.equal(
    calls.some(({ method }) => method !== "GET"),
    false
  );
});

test("workflow recovery searches a bounded second page for the exact run", async () => {
  const f = fixture();
  const pages = [];
  const unrelated = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    display_title: "Another sandbox operation",
    actor: { id: 456 }
  }));
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      if (endpoint.includes("/git/ref/heads/"))
        return apiResponse("200 OK", environmentRef(endpoint, f.operation));
      if (endpoint.includes("/runs?")) {
        const page = Number(
          new URL(endpoint, "https://api.github.invalid").searchParams.get(
            "page"
          )
        );
        pages.push(page);
        return apiResponse("200 OK", {
          total_count: 101,
          workflow_runs: page === 1 ? unrelated : [f.run]
        });
      }
      if (endpoint.includes("/attempts/2/jobs"))
        return apiResponse("200 OK", {
          total_count: 1,
          jobs: [f.job]
        });
      assert.fail(endpoint);
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(pages, [1, 2]);
});

test("e2e workflow accepts only backend runner provenance", async () => {
  const run = async (f) => {
    const client = createReleaseGitHub({
      profile: sandboxProfile,
      runtime,
      execute: async (args) => {
        const endpoint = args[args.indexOf("--method") + 2];
        const value = endpoint.includes("/contents/")
          ? runtimeFile(endpoint)
          : endpoint.includes("/git/ref/heads/")
            ? environmentRef(endpoint, f.operation)
            : endpoint.includes("/runs?")
              ? { total_count: 1, workflow_runs: [f.run] }
              : { total_count: 1, jobs: [f.job] };
        return apiResponse("200 OK", value);
      },
      logs: async () =>
        `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
    });
    return client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => {}
    });
  };
  const accepted = await run(fixture("backend", "e2e"));
  assert.equal(
    accepted.report.runner.repository,
    sandboxProfile.repositories.backend.full_name
  );

  const rejected = fixture("backend", "e2e");
  rejected.report.runner.repository =
    sandboxProfile.repositories.frontend.full_name;
  rejected.report.runner.commit = rejected.operation.frontend_commit;
  await assert.rejects(
    run(rejected),
    /conclusion contradicts its exact report/u
  );
});

test("release workflow rejects a report for another exact version", async () => {
  const f = fixture();
  f.report.versions.backend = "e".repeat(40);
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      const value = endpoint.includes("/contents/")
        ? runtimeFile(endpoint)
        : endpoint.includes("/git/ref/heads/")
          ? environmentRef(endpoint, f.operation)
          : endpoint.includes("/runs?")
            ? { total_count: 1, workflow_runs: [f.run] }
            : { total_count: 1, jobs: [f.job] };
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify(value)}`;
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  await assert.rejects(
    client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => {}
    }),
    /does not match/
  );
});

test("frontend workflow rejects backend runner provenance", async () => {
  const f = fixture("frontend");
  f.report.runner.repository = sandboxProfile.repositories.backend.full_name;
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      const value = endpoint.includes("/contents/")
        ? runtimeFile(endpoint)
        : endpoint.includes("/git/ref/heads/")
          ? environmentRef(endpoint, f.operation)
          : endpoint.includes("/runs?")
            ? { total_count: 1, workflow_runs: [f.run] }
            : { total_count: 1, jobs: [f.job] };
      return apiResponse("200 OK", value);
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  await assert.rejects(
    client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => {}
    }),
    /conclusion contradicts its exact report/u
  );
});

test("staging movement stops before an integration branch or PR is created", async () => {
  const writes = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      if (method !== "GET") writes.push({ method, endpoint });
      assert.match(endpoint, /git\/ref\/heads\/1a-staging$/u);
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify({ object: { sha: "f".repeat(40) } })}`;
    }
  });
  const actor = { id: "456", login: "tester" };
  await assert.rejects(
    client.integrate({
      record: {
        id: "22222222-2222-4222-8222-222222222222",
        release_id: "11111111-1111-4111-8111-111111111111",
        step: {
          id: "staging:integrate:backend",
          kind: "integrate",
          environment: "staging",
          role: "backend"
        },
        state: "prepared",
        created_at: "2026-09-11T12:00:00.000Z"
      },
      candidate: {
        role: "backend",
        base: "e".repeat(40),
        commit: "c".repeat(40),
        tree: "d".repeat(40),
        changed: true
      },
      actor,
      expectedBase: "e".repeat(40),
      save: async () => {}
    }),
    /staging changed after this release captured/u
  );
  assert.deepEqual(writes, []);
});

test("integration uses a unique checked commit with the exact candidate tree", async () => {
  const candidate = {
    role: "backend",
    base: "e".repeat(40),
    commit: "c".repeat(40),
    tree: "d".repeat(40),
    changed: true
  };
  const integrationCommit = "9".repeat(40);
  const testMerge = "8".repeat(40);
  const mergedCommit = "7".repeat(40);
  const actor = { id: "456", login: "tester" };
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: {
      id: "staging:integrate:backend",
      kind: "integrate",
      environment: "staging",
      role: "backend"
    },
    state: "prepared",
    created_at: "2026-09-11T12:00:00.000Z"
  };
  let branch = null;
  let merged = false;
  let pr = null;
  const commitBodies = [];
  const saved = [];
  const codeRabbitSummary =
    "\n\n<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\n\nA generated summary.\n\n<!-- end of auto-generated comment: release notes by coderabbit.ai -->";
  let summaryAdded = false;
  let waited = false;
  const order = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    wait: async () => {
      waited = true;
      order.push("wait");
    },
    gates: {
      pullRequest: async () => {
        if (!summaryAdded) {
          pr = { ...pr, body: `${pr.body}${codeRabbitSummary}` };
          summaryAdded = true;
        }
        return {
          headRefOid: integrationCommit,
          headRefName: record.branch,
          baseRefOid: candidate.base,
          baseRefName: "1a-staging",
          state: "OPEN",
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          checks: [
            {
              __typename: "CheckRun",
              id: "new-check",
              isRequired: false,
              name: "Sandbox check",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              startedAt: "2026-09-11T12:01:00.000Z"
            }
          ]
        };
      }
    },
    execute: async (args, body) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", {
          object: { sha: merged ? mergedCommit : candidate.base }
        });
      if (method === "POST" && endpoint.endsWith("/git/commits")) {
        commitBodies.push(body);
        return apiResponse("201 Created", {
          sha: integrationCommit,
          tree: { sha: candidate.tree },
          parents: [{ sha: candidate.commit }]
        });
      }
      if (endpoint.endsWith(`/git/commits/${integrationCommit}`))
        return apiResponse("200 OK", {
          sha: integrationCommit,
          tree: { sha: candidate.tree },
          parents: [{ sha: candidate.commit }]
        });
      if (endpoint.endsWith(`/git/ref/heads/${record.branch}`))
        return branch
          ? apiResponse("200 OK", { object: { sha: branch } })
          : apiResponse("404 Not Found", {});
      if (method === "POST" && endpoint.endsWith("/git/refs")) {
        branch = body.sha;
        return apiResponse("201 Created", {
          object: { sha: branch }
        });
      }
      if (method === "GET" && endpoint.includes("/pulls?state=all"))
        return apiResponse("200 OK", []);
      if (method === "POST" && endpoint.endsWith("/pulls")) {
        assert.equal(body.head, record.branch);
        pr = {
          number: 7,
          html_url: "https://example.invalid/pr/7",
          head: {
            repo: { id: sandboxProfile.repositories.backend.id },
            ref: record.branch,
            sha: integrationCommit
          },
          base: {
            repo: { id: sandboxProfile.repositories.backend.id },
            ref: "1a-staging"
          },
          user: { id: 456 },
          body: record.body,
          state: "open",
          merged: false,
          merge_commit_sha: testMerge
        };
        return apiResponse("201 Created", pr);
      }
      if (method === "GET" && endpoint.endsWith("/pulls/7"))
        return apiResponse("200 OK", pr);
      if (endpoint.endsWith(`/git/commits/${testMerge}`))
        return apiResponse("200 OK", { tree: { sha: candidate.tree } });
      if (endpoint.includes("/runs?"))
        return apiResponse(
          "200 OK",
          waited ||
            (endpoint.includes("status=") &&
              !endpoint.includes("status=in_progress"))
            ? { total_count: 0, workflow_runs: [] }
            : { total_count: 1, workflow_runs: [activeRun(555, "in_progress")] }
        );
      if (method === "PUT" && endpoint.endsWith("/pulls/7/merge")) {
        assert.equal(body.sha, integrationCommit);
        order.push("merge");
        merged = true;
        pr = {
          ...pr,
          state: "closed",
          merged: true,
          merge_commit_sha: mergedCommit
        };
        return apiResponse("200 OK", { merged: true, sha: mergedCommit });
      }
      if (endpoint.endsWith(`/git/commits/${mergedCommit}`))
        return apiResponse("200 OK", {
          tree: { sha: candidate.tree },
          parents: [{ sha: candidate.base }, { sha: integrationCommit }]
        });
      if (method === "DELETE" && endpoint.includes("/git/refs/heads/")) {
        branch = null;
        return apiResponse("204 No Content");
      }
      assert.fail(`${method} ${endpoint}`);
    }
  });
  const result = await client.integrate({
    record,
    candidate,
    actor,
    expectedBase: candidate.base,
    save: async () => saved.push(structuredClone(record))
  });
  assert.equal(result.status, "passed");
  assert.equal(record.integration_commit, integrationCommit);
  assert.equal(commitBodies.length, 1);
  assert.equal(commitBodies[0].tree, candidate.tree);
  assert.deepEqual(commitBodies[0].parents, [candidate.commit]);
  assert.notEqual(record.integration_commit, candidate.commit);
  assert.deepEqual(
    saved.slice(0, 3).map((value) => ({
      state: value.state,
      hasBase: Object.hasOwn(value, "base"),
      hasInput: Object.hasOwn(value, "integration_input"),
      hasCommit: Object.hasOwn(value, "integration_commit")
    })),
    [
      {
        state: "prepared",
        hasBase: true,
        hasInput: false,
        hasCommit: false
      },
      {
        state: "commit-prepared",
        hasBase: true,
        hasInput: true,
        hasCommit: false
      },
      {
        state: "branch-prepared",
        hasBase: true,
        hasInput: true,
        hasCommit: true
      }
    ]
  );
  // Branch cleanup polls with the same sleep after the merge.
  assert.deepEqual(order.slice(0, 2), ["wait", "merge"]);
  assert.equal(record.waited_for.purpose, "merge");
  assert.equal(record.waited_for.checks, 2);
  assert.deepEqual(record.waited_for.runs, [
    { id: 555, url: `${runUrl}/555`, status: "in_progress", actor: "alice" }
  ]);
  const waitingSave = saved.find((value) => value.waited_for);
  assert.equal(waitingSave.state, "checking");
  assert.equal(waitingSave.waited_for.checks, undefined);
});

test("changed release runner stops before workflow lookup or dispatch", async () => {
  const f = fixture();
  const calls = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      assert.match(endpoint, /\/contents\//u);
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify(runtimeFile(endpoint, true))}`;
    }
  });
  await assert.rejects(
    client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => {}
    }),
    /runtime file changed/u
  );
  assert.equal(
    calls.some(({ method }) => method !== "GET"),
    false
  );
  assert.equal(
    calls.some(({ endpoint }) => endpoint.includes("/runs?")),
    false
  );
});

test("resumed operation stops before dispatch when a sandbox ref moved", async () => {
  const f = fixture();
  f.record.state = "prepared";
  const calls = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      if (endpoint.includes("/runs?"))
        return apiResponse("200 OK", {
          total_count: 0,
          workflow_runs: []
        });
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", {
          object: { sha: "a".repeat(40) }
        });
      assert.fail(endpoint);
    }
  });
  await assert.rejects(
    client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => {}
    }),
    /changed before workflow dispatch/u
  );
  assert.equal(f.record.state, "prepared");
  assert.equal(
    calls.some(({ method }) => method !== "GET"),
    false
  );
});

test("dispatch waits without a time limit until the release workflow is quiet", async () => {
  const f = fixture();
  f.record.state = "prepared";
  let rounds = 0;
  const waits = [];
  const saves = [];
  const { client, calls } = dispatchingClient(f, {
    active: () => (rounds < 2 ? [activeRun(555, "in_progress")] : []),
    wait: async (ms, options) => {
      waits.push({ ms, signal: options?.signal });
      rounds++;
    }
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => saves.push(structuredClone(f.record))
  });
  assert.equal(result.status, "passed");
  assert.equal(waits.length, 2);
  assert.ok(waits.every((entry) => entry.ms === 10_000));
  const statusQueries = calls.flatMap(({ endpoint }, index) =>
    endpoint.includes("/runs?status=") ? [index] : []
  );
  const dispatch = calls.findIndex(
    ({ method, endpoint }) =>
      method === "POST" && endpoint.endsWith("/dispatches")
  );
  assert.ok(dispatch > statusQueries.at(-1));
  assert.deepEqual(
    [
      ...new Set(
        statusQueries.map(
          (index) => calls[index].endpoint.match(/status=([a-z_]+)/u)[1]
        )
      )
    ].sort(),
    ["in_progress", "pending", "queued", "requested", "waiting"]
  );
  assert.ok(
    statusQueries.every((index) =>
      calls[index].endpoint.startsWith(
        "repos/6529-Collections/release-coordinator-test-backend/actions/workflows/sandbox-release.yml/runs?"
      )
    )
  );
  const waitingSave = saves.find((record) => record.waited_for);
  assert.equal(waitingSave.state, "prepared");
  assert.equal(waitingSave.waited_for.checks, undefined);
  assert.deepEqual(waitingSave.waited_for.runs, [
    { id: 555, url: `${runUrl}/555`, status: "in_progress", actor: "alice" }
  ]);
  assert.equal(saves.filter((record) => record.waited_for).length, 4);
  assert.equal(f.record.waited_for.purpose, "dispatch");
  assert.equal(f.record.waited_for.checks, 3);
  assert.ok(Number.isFinite(Date.parse(f.record.waited_for.first_seen_at)));
  assert.ok(Number.isFinite(Date.parse(f.record.waited_for.quiet_at)));
});

test("queued, waiting, pending and requested runs block dispatch; completed runs do not", async () => {
  for (const status of ["queued", "waiting", "pending", "requested"]) {
    const f = fixture();
    f.record.state = "prepared";
    let waits = 0;
    const { client } = dispatchingClient(f, {
      active: () => (waits ? [] : [activeRun(7, status, "bob")]),
      wait: async () => {
        waits++;
      }
    });
    const result = await client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => {}
    });
    assert.equal(result.status, "passed", status);
    assert.equal(waits, 1, status);
    assert.deepEqual(f.record.waited_for.runs, [
      { id: 7, url: `${runUrl}/7`, status, actor: "bob" }
    ]);
  }
  const f = fixture();
  f.record.state = "prepared";
  let waits = 0;
  const { client } = dispatchingClient(f, {
    active: () => [activeRun(8, "completed")],
    wait: async () => {
      waits++;
    }
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(waits, 0);
  assert.equal(Object.hasOwn(f.record, "waited_for"), false);
});

test("an interrupted wait presses nothing and keeps the step resumable", async () => {
  const f = fixture();
  f.record.state = "prepared";
  const controller = new AbortController();
  const saves = [];
  const { client, calls } = dispatchingClient(f, {
    signal: controller.signal,
    active: () => [activeRun(9, "queued")],
    wait: async () => {
      controller.abort();
    }
  });
  await assert.rejects(
    client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => saves.push(structuredClone(f.record))
    }),
    (error) => error.name === "AbortError"
  );
  assert.equal(
    calls.some(({ method }) => method !== "GET"),
    false
  );
  assert.equal(f.record.state, "prepared");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].waited_for.purpose, "dispatch");
  assert.equal(saves[0].waited_for.checks, undefined);

  // The default sleep also stops early when the signal fires mid-wait.
  const g = fixture();
  g.record.state = "prepared";
  const late = new AbortController();
  const { client: sleeping, calls: sleepingCalls } = dispatchingClient(g, {
    signal: late.signal,
    pollMs: 5_000,
    active: () => {
      setTimeout(() => late.abort(), 20);
      return [activeRun(10, "in_progress")];
    }
  });
  const started = performance.now();
  await assert.rejects(
    sleeping.run({
      record: g.record,
      actor: g.record.actor,
      save: async () => {}
    }),
    (error) => error.name === "AbortError"
  );
  assert.ok(performance.now() - started < 2_000);
  assert.equal(
    sleepingCalls.some(({ method }) => method !== "GET"),
    false
  );
});

test("a resumed running operation polls its own run and never waits for it", async () => {
  const f = fixture();
  f.record.state = "running";
  const own = { ...f.run, status: "in_progress", conclusion: null };
  let waits = 0;
  const calls = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    wait: async () => {
      waits++;
    },
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      // The Coordinator's own run is active in the listing, and matches the
      // saved release title and actor; it must never count as a blocker.
      if (endpoint.includes("/runs?status="))
        return apiResponse("200 OK", { total_count: 1, workflow_runs: [own] });
      if (endpoint.includes("/runs?"))
        return apiResponse("200 OK", { total_count: 1, workflow_runs: [own] });
      if (endpoint.endsWith(`/actions/runs/${f.run.id}`))
        return apiResponse("200 OK", waits ? f.run : own);
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", environmentRef(endpoint, f.operation));
      if (endpoint.includes("/attempts/2/jobs"))
        return apiResponse("200 OK", { total_count: 1, jobs: [f.job] });
      assert.fail(`${method} ${endpoint}`);
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(waits, 1);
  assert.equal(
    calls.some(({ endpoint }) => endpoint.includes("/runs?status=")),
    false
  );
  assert.equal(
    calls.some(({ method }) => method !== "GET"),
    false
  );
  assert.equal(Object.hasOwn(f.record, "waited_for"), false);
});

test("a blocking run that changes status keeps its latest observed status", async () => {
  const f = fixture();
  f.record.state = "prepared";
  let rounds = 0;
  const saves = [];
  const { client } = dispatchingClient(f, {
    active: () =>
      rounds === 0
        ? [activeRun(12, "queued")]
        : rounds === 1
          ? [activeRun(12, "in_progress")]
          : [],
    wait: async () => {
      rounds++;
    }
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => saves.push(structuredClone(f.record))
  });
  assert.equal(result.status, "passed");
  // One save when first seen, then the dispatching, running and run-identity
  // saves; the status change itself triggers no extra journal write.
  assert.equal(saves.filter((record) => record.waited_for).length, 4);
  assert.equal(
    saves.find((record) => record.waited_for).waited_for.runs[0].status,
    "queued"
  );
  assert.deepEqual(f.record.waited_for.runs, [
    { id: 12, url: `${runUrl}/12`, status: "in_progress", actor: "alice" }
  ]);
});

test("a lagging status listing blocks dispatch while it counts runs it does not show", async () => {
  const f = fixture();
  f.record.state = "prepared";
  let rounds = 0;
  const saves = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    wait: async () => {
      rounds++;
    },
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      // Observed live: total_count says one in-progress run, the list is empty.
      if (endpoint.includes("/runs?status=in_progress"))
        return apiResponse("200 OK", {
          total_count: rounds ? 0 : 1,
          workflow_runs: []
        });
      if (endpoint.includes("/runs?status="))
        return apiResponse("200 OK", { total_count: 0, workflow_runs: [] });
      // The newest page is empty throughout: the block comes from the count.
      if (endpoint.endsWith("/runs?per_page=100"))
        return apiResponse("200 OK", { total_count: 0, workflow_runs: [] });
      // findRun's event-filtered listing: the dispatched run appears after
      // the first round, once the dispatch has happened.
      if (endpoint.includes("/runs?"))
        return apiResponse("200 OK", {
          total_count: rounds ? 1 : 0,
          workflow_runs: rounds ? [f.run] : []
        });
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", environmentRef(endpoint, f.operation));
      if (method === "POST" && endpoint.endsWith("/dispatches"))
        return apiResponse("204 No Content");
      if (endpoint.endsWith(`/actions/runs/${f.run.id}`))
        return apiResponse("200 OK", f.run);
      if (endpoint.includes("/attempts/2/jobs"))
        return apiResponse("200 OK", { total_count: 1, jobs: [f.job] });
      assert.fail(`${method} ${endpoint}`);
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(f.report)).toString("base64url")}\n`
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => saves.push(structuredClone(f.record))
  });
  assert.equal(result.status, "passed");
  assert.equal(rounds, 1);
  const first = saves.find((record) => record.waited_for);
  assert.deepEqual(first.waited_for.runs, []);
  assert.equal(first.waited_for.unlisted, 1);
  assert.equal(f.record.waited_for.checks, 2);
  assert.equal(f.record.waited_for.unlisted, 1);
});

test("a rising lag indicator is saved before an interruption can lose it", async () => {
  const f = fixture();
  f.record.state = "prepared";
  const controller = new AbortController();
  let rounds = 0;
  const saves = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    signal: controller.signal,
    wait: async () => {
      rounds++;
      if (rounds === 2) controller.abort();
    },
    execute: async (args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      // Round one counts one unlisted run, round two counts two.
      if (endpoint.includes("/runs?status=queued"))
        return apiResponse("200 OK", {
          total_count: rounds + 1,
          workflow_runs: []
        });
      if (endpoint.includes("/runs?"))
        return apiResponse("200 OK", { total_count: 0, workflow_runs: [] });
      assert.fail(endpoint);
    }
  });
  await assert.rejects(
    client.run({
      record: f.record,
      actor: f.record.actor,
      save: async () => saves.push(structuredClone(f.record))
    }),
    (error) => error.name === "AbortError"
  );
  assert.deepEqual(
    saves.map((record) => record.waited_for.unlisted),
    [1, 2]
  );
  assert.equal(f.record.state, "prepared");
});

test("an unfinished run on the newest page blocks dispatch even when every status count is zero", async () => {
  const f = fixture();
  f.record.state = "prepared";
  let rounds = 0;
  const { client } = dispatchingClient(f, {
    active: (query) =>
      query === "recent" && rounds === 0
        ? [activeRun(31, "queued", "carol")]
        : [],
    wait: async () => {
      rounds++;
    }
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(rounds, 1);
  assert.deepEqual(f.record.waited_for.runs, [
    { id: 31, url: `${runUrl}/31`, status: "queued", actor: "carol" }
  ]);
  assert.equal(f.record.waited_for.unlisted, 0);
});

test("an interruption after a quiet check rechecks on resume before dispatching", async () => {
  const f = fixture();
  f.record.state = "prepared";
  let rounds = 0;
  let interrupt = true;
  const { client, calls } = dispatchingClient(f, {
    active: () => (rounds < 1 ? [activeRun(21, "in_progress")] : []),
    wait: async () => {
      rounds++;
    }
  });
  const save = async () => {
    // The stop signal fires while the dispatching state is being saved: the
    // journal still holds the prepared state, and nothing was pressed.
    if (interrupt && f.record.state === "dispatching") {
      f.record.state = "prepared";
      throw new DOMException("Stopped.", "AbortError");
    }
  };
  await assert.rejects(
    client.run({ record: f.record, actor: f.record.actor, save }),
    (error) => error.name === "AbortError"
  );
  assert.equal(
    calls.some(({ method }) => method !== "GET"),
    false
  );
  assert.equal(f.record.waited_for.checks, 2);
  const before = calls.length;
  interrupt = false;
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save
  });
  assert.equal(result.status, "passed");
  const resumed = calls.slice(before);
  assert.ok(resumed.some(({ endpoint }) => endpoint.includes("/runs?status=")));
  assert.ok(
    resumed.findIndex(({ endpoint }) => endpoint.includes("/runs?status=")) <
      resumed.findIndex(({ method }) => method === "POST")
  );
  assert.equal(calls.filter(({ method }) => method === "POST").length, 1);
});

test("the dispatch input carries the validated environment the workflow lock is keyed on", async () => {
  const f = fixture();
  f.record.state = "prepared";
  const { client, calls } = dispatchingClient(f, { active: () => [] });
  await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => {}
  });
  const dispatch = calls.find(
    ({ method, endpoint }) =>
      method === "POST" && endpoint.endsWith("/dispatches")
  );
  assert.equal(dispatch.body.ref, "1a-staging");
  const operation = JSON.parse(dispatch.body.inputs.operation_json);
  assert.equal(operation.environment, "staging");
  assert.ok(releaseEnvironments.includes(operation.environment));
  assert.equal(dispatch.body.inputs.operation_id, f.record.id);
  assert.equal(operation.fingerprint, f.operation.fingerprint);
});

test("a resumed wait checks again and dispatches once", async () => {
  const f = fixture();
  f.record.state = "prepared";
  f.record.waited_for = {
    purpose: "dispatch",
    first_seen_at: "2026-09-18T10:00:00.000Z",
    runs: [
      { id: 555, url: `${runUrl}/555`, status: "in_progress", actor: "alice" }
    ]
  };
  let waits = 0;
  const { client, calls } = dispatchingClient(f, {
    active: () => [],
    wait: async () => {
      waits++;
    }
  });
  const result = await client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(waits, 0);
  assert.equal(
    calls.filter(
      ({ method, endpoint }) =>
        method === "POST" && endpoint.endsWith("/dispatches")
    ).length,
    1
  );
  assert.equal(f.record.waited_for.runs.length, 1);
  assert.equal(f.record.waited_for.checks, 1);
});

test("owned branch cleanup requires two consecutive missing reads", async () => {
  const candidate = {
    role: "backend",
    base: "e".repeat(40),
    commit: "c".repeat(40),
    tree: "d".repeat(40),
    changed: true
  };
  const actor = { id: "456", login: "tester" };
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: {
      id: "staging:integrate:backend",
      kind: "integrate",
      environment: "staging",
      role: "backend"
    },
    state: "cleaning",
    actor,
    target_branch: "1a-staging",
    branch:
      "codex/release-11111111-1111-4111-8111-111111111111-staging-backend",
    body: `Sandbox release 11111111-1111-4111-8111-111111111111\n\nBatch: ${candidate.tree}`,
    base: candidate.base,
    number: 7,
    url: "https://example.invalid/pr/7",
    created_at: "2026-09-11T12:00:00.000Z"
  };
  const pr = {
    number: 7,
    head: {
      repo: { id: sandboxProfile.repositories.backend.id },
      ref: record.branch,
      sha: candidate.commit
    },
    base: {
      repo: { id: sandboxProfile.repositories.backend.id },
      ref: record.target_branch
    },
    user: { id: 456 },
    body: record.body,
    state: "open",
    merged: false
  };
  let deleted = false;
  let missingReads = 0;
  let closeResponseLost = false;
  let patchCalls = 0;
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    wait: async () => {},
    gates: {
      pullRequest: async () => ({
        headRefOid: candidate.commit,
        headRefName: record.branch,
        baseRefOid: record.base,
        baseRefName: record.target_branch,
        state: "OPEN",
        mergeable: "MERGEABLE",
        checks: [
          {
            __typename: "CheckRun",
            isRequired: false,
            name: "Sandbox check",
            status: "COMPLETED",
            conclusion: "FAILURE"
          }
        ]
      })
    },
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", { object: { sha: record.base } });
      if (endpoint.endsWith(`/git/ref/heads/${record.branch}`)) {
        if (deleted) {
          missingReads++;
          return apiResponse("404 Not Found", {});
        }
        return apiResponse("200 OK", {
          object: { sha: candidate.commit }
        });
      }
      if (method === "GET" && endpoint.endsWith("/pulls/7"))
        return apiResponse("200 OK", pr);
      if (method === "PATCH" && endpoint.endsWith("/pulls/7")) {
        patchCalls++;
        pr.state = "closed";
        if (!closeResponseLost) {
          closeResponseLost = true;
          throw new Error("lost close response");
        }
        return apiResponse("200 OK", pr);
      }
      if (method === "DELETE" && endpoint.includes("/git/refs/heads/")) {
        deleted = true;
        return apiResponse("204 No Content");
      }
      assert.fail(`${method} ${endpoint}`);
    }
  });
  const input = {
    record,
    candidate,
    actor,
    expectedBase: candidate.base,
    save: async () => {}
  };
  await assert.rejects(client.integrate(input), /lost close response/u);
  assert.equal(record.state, "cleaning");
  assert.equal(record.cleanup, undefined);
  const result = await client.integrate(input);
  assert.equal(result.status, "failed");
  assert.equal(record.cleanup, "removed");
  assert.equal(missingReads, 2);
  assert.equal(patchCalls, 1);
});

test("merged integration resumes cleanup without recreating its branch", async () => {
  const candidate = {
    role: "backend",
    base: "e".repeat(40),
    commit: "c".repeat(40),
    tree: "d".repeat(40),
    changed: true
  };
  const mergeCommit = "f".repeat(40);
  const integrationCommit = "9".repeat(40);
  const actor = { id: "456", login: "tester" };
  const createdAt = "2026-09-11T12:00:00.000Z";
  const integrationInput = {
    message: `Sandbox staging candidate for 11111111-1111-4111-8111-111111111111\n\nExact selected candidate ${candidate.commit}`,
    tree: candidate.tree,
    parents: [candidate.commit],
    author: {
      name: "Coordinator sandbox",
      email: "rehearsal@example.invalid",
      date: createdAt
    },
    committer: {
      name: "Coordinator sandbox",
      email: "rehearsal@example.invalid",
      date: createdAt
    }
  };
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: {
      id: "staging:integrate:backend",
      kind: "integrate",
      environment: "staging",
      role: "backend"
    },
    state: "merged",
    actor,
    target_branch: "1a-staging",
    branch:
      "codex/release-11111111-1111-4111-8111-111111111111-staging-backend",
    body: `Sandbox release 11111111-1111-4111-8111-111111111111\n\nBatch: ${candidate.tree}`,
    base: candidate.base,
    number: 7,
    url: "https://example.invalid/pr/7",
    checked_tree: candidate.tree,
    created_at: createdAt,
    integration_version: 1,
    integration_input: integrationInput,
    integration_commit: integrationCommit
  };
  const pr = {
    number: 7,
    head: {
      repo: { id: sandboxProfile.repositories.backend.id },
      ref: record.branch,
      sha: integrationCommit
    },
    base: {
      repo: { id: sandboxProfile.repositories.backend.id },
      ref: record.target_branch
    },
    user: { id: 456 },
    body: record.body,
    state: "closed",
    merged: true,
    merge_commit_sha: mergeCommit
  };
  let branchReads = 0;
  let branchCreates = 0;
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    wait: async () => {},
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      if (method === "POST" && endpoint.endsWith("/git/commits"))
        return apiResponse("201 Created", {
          sha: integrationCommit,
          tree: { sha: candidate.tree },
          parents: [{ sha: candidate.commit }]
        });
      if (endpoint.endsWith(`/git/commits/${integrationCommit}`))
        return apiResponse("200 OK", {
          sha: integrationCommit,
          tree: { sha: candidate.tree },
          parents: [{ sha: candidate.commit }]
        });
      if (endpoint.endsWith(`/git/ref/heads/${record.branch}`)) {
        branchReads++;
        return apiResponse("404 Not Found", {});
      }
      if (method === "POST" && endpoint.endsWith("/git/refs")) {
        branchCreates++;
        return apiResponse("201 Created", {});
      }
      if (endpoint.endsWith("/pulls/7")) return apiResponse("200 OK", pr);
      if (endpoint.endsWith(`/git/commits/${mergeCommit}`))
        return apiResponse("200 OK", {
          tree: { sha: candidate.tree },
          parents: [{ sha: candidate.base }, { sha: integrationCommit }]
        });
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", { object: { sha: mergeCommit } });
      assert.fail(`${method} ${endpoint}`);
    }
  });
  const result = await client.integrate({
    record,
    candidate,
    actor,
    expectedBase: candidate.base,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(record.cleanup, "removed");
  assert.equal(branchReads, 3);
  assert.equal(branchCreates, 0);

  pr.merge_commit_sha = null;
  await assert.rejects(
    client.integrate({
      record,
      candidate,
      actor,
      expectedBase: candidate.base,
      save: async () => {}
    }),
    /GitHub did not expose the exact checked integration commit/u
  );
});

test("legacy in-flight integration states need manual recovery before any write", async () => {
  const candidate = {
    role: "backend",
    base: "e".repeat(40),
    commit: "c".repeat(40),
    tree: "d".repeat(40),
    changed: true
  };
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: {
      id: "staging:integrate:backend",
      kind: "integrate",
      environment: "staging",
      role: "backend"
    },
    state: "checking",
    actor: { id: "456", login: "tester" },
    target_branch: "1a-staging",
    branch:
      "codex/release-11111111-1111-4111-8111-111111111111-staging-backend",
    body: `Sandbox release 11111111-1111-4111-8111-111111111111\n\nBatch: ${candidate.tree}`,
    base: candidate.base,
    number: 7,
    url: "https://example.invalid/pr/7",
    created_at: "2026-09-11T12:00:00.000Z"
  };
  const calls = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    wait: async () => {},
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", { object: { sha: candidate.base } });
      assert.fail(`${method} ${endpoint}`);
    }
  });
  for (const state of ["branch-prepared", "checking"]) {
    const interrupted = structuredClone(record);
    interrupted.state = state;
    calls.length = 0;
    await assert.rejects(
      client.integrate({
        record: interrupted,
        candidate,
        actor: interrupted.actor,
        expectedBase: candidate.base,
        save: async () => {}
      }),
      /predates unique integration commits/u
    );
    assert.equal(
      calls.every(({ method }) => method === "GET"),
      true
    );
  }
});

test("staging restoration uses the exact saved tree and a distinct checked integration", async () => {
  const old = "a".repeat(40);
  const current = "b".repeat(40);
  const tree = "c".repeat(40);
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: {
      id: "restore:staging:integrate:backend",
      kind: "integrate",
      environment: "staging",
      role: "backend",
      recovery: true
    },
    state: "prepared",
    created_at: "2026-09-11T12:00:00.000Z"
  };
  const reads = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      reads.push(`${method} ${endpoint}`);
      assert.equal(method, "GET");
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      if (endpoint.endsWith(`/git/commits/${old}`))
        return apiResponse("200 OK", { sha: old, tree: { sha: tree } });
      assert.fail(endpoint);
    }
  });
  let integrations = 0;
  client.integrate = async ({ candidate, expectedBase, save }) => {
    integrations++;
    assert.deepEqual(candidate, {
      role: "backend",
      base: current,
      commit: current,
      tree,
      changed: true
    });
    assert.equal(expectedBase, current);
    await save();
    return { status: "passed", commit: "d".repeat(40), tree };
  };
  const actor = { id: "456", login: "tester" };
  let saves = 0;
  const args = {
    record,
    restoreTo: old,
    expectedBase: current,
    actor,
    save: async () => saves++
  };
  await client.restore(args);
  assert.equal(record.restore_to, old);
  assert.equal(record.restore_tree, tree);
  assert.equal(saves, 2);
  assert.equal(integrations, 1);
  assert.equal(reads.filter((value) => value.includes("/contents/")).length, 4);

  record.restore_tree = "e".repeat(40);
  await assert.rejects(client.restore(args), /restoration target changed/u);
  assert.equal(integrations, 1);
});

test("fake-production restoration accepts only the saved test main destination", async () => {
  const old = "a".repeat(40);
  const current = "b".repeat(40);
  const tree = "c".repeat(40);
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: {
      id: "restore:prod:integrate:backend",
      kind: "integrate",
      environment: "prod",
      role: "backend",
      recovery: true
    },
    target_branch: "main",
    state: "prepared",
    created_at: "2026-09-11T12:00:00.000Z"
  };
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      if (endpoint.includes("/contents/"))
        return apiResponse("200 OK", runtimeFile(endpoint));
      if (endpoint.endsWith(`/git/commits/${old}`))
        return apiResponse("200 OK", { sha: old, tree: { sha: tree } });
      assert.fail(endpoint);
    }
  });
  let integrated = false;
  client.integrate = async ({ candidate, expectedBase }) => {
    integrated = true;
    assert.equal(candidate.tree, tree);
    assert.equal(expectedBase, current);
    return { status: "passed", commit: "d".repeat(40), tree };
  };
  const args = {
    record,
    restoreTo: old,
    expectedBase: current,
    actor: { id: "456", login: "tester" },
    save: async () => {}
  };
  await client.restore(args);
  assert.equal(integrated, true);
  record.target_branch = "1a-staging";
  await assert.rejects(client.restore(args), /destination changed/u);
});

test("restoration completion rereads both environment refs and exact trees", async () => {
  const versions = { backend: "a".repeat(40), frontend: "b".repeat(40) };
  const prodVersions = { backend: "c".repeat(40), frontend: "d".repeat(40) };
  const trees = { backend: "e".repeat(40), frontend: "f".repeat(40) };
  const reads = [];
  let moved = false;
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      reads.push(`${method} ${endpoint}`);
      assert.equal(method, "GET");
      const role = endpoint.includes("release-coordinator-test-frontend")
        ? "frontend"
        : "backend";
      if (endpoint.endsWith("/git/ref/heads/1a-staging"))
        return apiResponse("200 OK", {
          object: { sha: moved ? prodVersions[role] : versions[role] }
        });
      if (endpoint.endsWith("/git/ref/heads/main"))
        return apiResponse("200 OK", { object: { sha: prodVersions[role] } });
      if (endpoint.endsWith(`/git/commits/${versions[role]}`))
        return apiResponse("200 OK", {
          sha: versions[role],
          tree: { sha: trees[role] }
        });
      assert.fail(endpoint);
    }
  });
  assert.deepEqual(
    await client.verifyRestoredStaging({ versions, trees, prodVersions }),
    { staging: versions, prod: prodVersions, trees }
  );
  assert.equal(reads.length, 6);
  moved = true;
  await assert.rejects(
    client.verifyRestoredStaging({ versions, trees, prodVersions }),
    /staging or test main moved/u
  );
});

test("fake-production restoration reads back both branches and rejects a moved main", async () => {
  const versions = {
    prod: { backend: "a".repeat(40), frontend: "b".repeat(40) },
    staging: { backend: "c".repeat(40), frontend: "d".repeat(40) }
  };
  const trees = {
    prod: { backend: "e".repeat(40), frontend: "f".repeat(40) },
    staging: { backend: "1".repeat(40), frontend: "2".repeat(40) }
  };
  let moved = false;
  const reads = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    execute: async (args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      reads.push(endpoint);
      const role = endpoint.includes("release-coordinator-test-frontend")
        ? "frontend"
        : "backend";
      const environment = endpoint.endsWith("/git/ref/heads/main")
        ? "prod"
        : "staging";
      if (endpoint.includes("/git/ref/heads/"))
        return apiResponse("200 OK", {
          object: {
            sha:
              moved && environment === "prod" && role === "backend"
                ? versions.staging.backend
                : versions[environment][role]
          }
        });
      for (const environment of ["prod", "staging"])
        if (endpoint.endsWith(`/git/commits/${versions[environment][role]}`))
          return apiResponse("200 OK", {
            sha: versions[environment][role],
            tree: { sha: trees[environment][role] }
          });
      assert.fail(endpoint);
    }
  });
  assert.deepEqual(
    await client.verifyRestoredEnvironments({ versions, trees }),
    { ...versions, trees }
  );
  assert.equal(reads.length, 8);
  moved = true;
  await assert.rejects(
    client.verifyRestoredEnvironments({ versions, trees }),
    /environment moved/u
  );
});

test("real profile and unpinned release runtime are refused", () => {
  assert.throws(
    () => createReleaseGitHub({ profile: realProfile, runtime }),
    /never a fallback/
  );
  assert.throws(
    () =>
      createReleaseGitHub({
        profile: sandboxProfile,
        runtime: {
          ...runtime,
          repositories: {
            ...runtime.repositories,
            backend: {
              files: {
                ...runtime.repositories.backend.files,
                "coordinator/sandbox/release-run.mjs": "PENDING"
              }
            }
          }
        }
      }),
    /never a fallback/
  );
});

test("real runtime checks a shared workflow pin against each backend branch", async () => {
  const shared = "9".repeat(40);
  const configured = {
    ...realProductWorkflowRuntime,
    repositories: {
      ...realProductWorkflowRuntime.repositories,
      backend: {
        ...realProductWorkflowRuntime.repositories.backend,
        files: {
          ...realProductWorkflowRuntime.repositories.backend.files,
          ".github/workflows/deploy.yml": { staging: shared, prod: shared }
        }
      }
    }
  };
  const versions = {
    staging: { backend: "a".repeat(40), frontend: "b".repeat(40) },
    prod: { backend: "c".repeat(40), frontend: "d".repeat(40) }
  };
  const seen = [];
  const clientFor = (drift) =>
    createReleaseGitHub({
      profile: realProfile,
      runtime: configured,
      execute: async (args) => {
        const endpoint = args[args.indexOf("--method") + 2];
        if (endpoint === "user")
          return apiResponse("200 OK", { id: 209783236, login: "simo6529" });
        const role = endpoint.includes("6529seize-frontend")
          ? "frontend"
          : "backend";
        const repository = realProfile.repositories[role];
        const prefix = `repos/${repository.full_name}`;
        if (endpoint === prefix)
          return apiResponse("200 OK", {
            id: repository.id,
            full_name: repository.full_name,
            private: false,
            permissions: { push: true }
          });
        for (const [environment, branch] of Object.entries(configured.branches))
          if (endpoint === `${prefix}/git/ref/heads/${branch}`)
            return apiResponse("200 OK", {
              object: { sha: versions[environment][role] }
            });
        const file = endpoint.match(/\/contents\/(.+)\?ref=([a-f0-9]{40})$/u);
        assert.ok(file, `Unexpected runtime request: ${endpoint}`);
        const environment =
          file[2] === versions.staging[role] ? "staging" : "prod";
        assert.equal(file[2], versions[environment][role]);
        const pin = configured.repositories[role].files[file[1]];
        assert.ok(pin, `Unexpected runtime file: ${file[1]}`);
        if (role === "backend" && file[1] === ".github/workflows/deploy.yml")
          seen.push(environment);
        return apiResponse("200 OK", {
          type: "file",
          path: file[1],
          sha:
            drift === environment &&
            role === "backend" &&
            file[1] === ".github/workflows/deploy.yml"
              ? "0".repeat(40)
              : typeof pin === "string"
                ? pin
                : pin[environment]
        });
      }
    });

  assert.deepEqual((await clientFor(null).identity()).versions, versions);
  assert.deepEqual(seen, ["staging", "prod"]);
  await assert.rejects(
    clientFor("staging").identity(),
    /runtime file changed/u
  );
  await assert.rejects(clientFor("prod").identity(), /runtime file changed/u);
});

test("real integration rejects a changed live account before creating a commit", async () => {
  const calls = [];
  const client = createReleaseGitHub({
    profile: realProfile,
    runtime: realProductWorkflowRuntime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      assert.equal(method, "GET");
      assert.equal(endpoint, "user");
      return 'HTTP/2 200 OK\r\ncontent-type: application/json\r\n\r\n{"id":999,"login":"another-account"}';
    }
  });
  const actor = { id: "209783236", login: "simo6529" };
  const record = {
    profile: "real",
    actor,
    release_id: "11111111-1111-4111-8111-111111111111",
    step: { kind: "integrate", environment: "staging", role: "frontend" },
    state: "merged",
    base: "a".repeat(40),
    integration_version: 1
  };
  await assert.rejects(
    client.integrate({
      record,
      candidate: {
        role: "frontend",
        commit: "b".repeat(40),
        tree: "c".repeat(40),
        changed: true
      },
      actor,
      expectedBase: record.base,
      save: async () => {}
    }),
    /authorized, currently authenticated/u
  );
  assert.deepEqual(calls, [{ method: "GET", endpoint: "user" }]);
});

test("real integration writes only a signed-off commit for the matching live account", async () => {
  const calls = [];
  let created;
  const client = createReleaseGitHub({
    profile: realProfile,
    runtime: realProductWorkflowRuntime,
    execute: async (args, body) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      if (method === "GET" && endpoint === "user")
        return 'HTTP/2 200 OK\r\ncontent-type: application/json\r\n\r\n{"id":209783236,"login":"simo6529"}';
      assert.equal(method, "POST");
      assert.equal(
        endpoint,
        `repos/${realProfile.repositories.frontend.full_name}/git/commits`
      );
      created = body;
      throw new Error("Stopped after inspecting the exact commit payload.");
    }
  });
  const actor = { id: "209783236", login: "simo6529" };
  const candidate = {
    role: "frontend",
    commit: "b".repeat(40),
    tree: "c".repeat(40),
    changed: true
  };
  const record = {
    profile: "real",
    actor,
    release_id: "11111111-1111-4111-8111-111111111111",
    step: { kind: "integrate", environment: "staging", role: "frontend" },
    state: "merged",
    base: "a".repeat(40),
    integration_version: 1,
    created_at: "2026-09-25T00:00:00.000Z"
  };
  record.integration_input = integrationCommitInput(record, candidate);
  await assert.rejects(
    client.integrate({
      record,
      candidate,
      actor,
      expectedBase: record.base,
      save: async () => {}
    }),
    /Stopped after inspecting/u
  );
  assert.deepEqual(calls, [
    { method: "GET", endpoint: "user" },
    {
      method: "POST",
      endpoint: `repos/${realProfile.repositories.frontend.full_name}/git/commits`
    }
  ]);
  assert.deepEqual(created, record.integration_input);
  assert.deepEqual(created.author, {
    name: "Simo",
    email: "209783236+simo6529@users.noreply.github.com",
    date: record.created_at
  });
  assert.match(
    created.message,
    /Signed-off-by: Simo <209783236\+simo6529@users\.noreply\.github\.com>$/u
  );
});
