import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseGitHub } from "../src/release-github.mjs";
import {
  makeReleaseBuild,
  makeReleaseOperation,
  releaseBuildFiles,
  releaseProtocol
} from "../src/release-contract.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";

const runtime = {
  workflow: "sandbox-release.yml",
  job: "Sandbox release",
  step: "Run sandbox release operation",
  branches: { staging: "1a-staging", prod: "main" },
  repositories: {
    backend: {
      files: {
        ".github/workflows/sandbox-release.yml": "a".repeat(40),
        "coordinator/src/release-contract.mjs": "b".repeat(40),
        "coordinator/sandbox/release-run.mjs": "c".repeat(40),
        "coordinator/sandbox/application-build.mjs": "1".repeat(40)
      }
    },
    frontend: {
      files: {
        ".github/workflows/sandbox-release.yml": "d".repeat(40),
        "coordinator/src/release-contract.mjs": "e".repeat(40),
        "coordinator/sandbox/release-run.mjs": "f".repeat(40),
        "coordinator/sandbox/application-build.mjs": "2".repeat(40)
      }
    }
  }
};

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
  const codeRabbitSummary =
    "\n\n<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\n\nA generated summary.\n\n<!-- end of auto-generated comment: release notes by coderabbit.ai -->";
  let summaryAdded = false;
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime,
    wait: async () => {},
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
          checks: [
            {
              __typename: "CheckRun",
              id: "new-check",
              isRequired: true,
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
      if (method === "PUT" && endpoint.endsWith("/pulls/7/merge")) {
        assert.equal(body.sha, integrationCommit);
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
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(record.integration_commit, integrationCommit);
  assert.equal(commitBodies.length, 1);
  assert.equal(commitBodies[0].tree, candidate.tree);
  assert.deepEqual(commitBodies[0].parents, [candidate.commit]);
  assert.notEqual(record.integration_commit, candidate.commit);
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
            isRequired: true,
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

test("legacy in-flight integration needs manual recovery before any write", async () => {
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
  await assert.rejects(
    client.integrate({
      record,
      candidate,
      actor: record.actor,
      expectedBase: candidate.base,
      save: async () => {}
    }),
    /predates unique integration commits/u
  );
  assert.equal(
    calls.every(({ method }) => method === "GET"),
    true
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
