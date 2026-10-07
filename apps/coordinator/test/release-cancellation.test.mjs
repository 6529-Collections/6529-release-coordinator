import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseGitHub } from "../src/release-github.mjs";
import { createProductWorkflowReleaseGitHub } from "../src/product-workflow-release-github.mjs";
import { integrationCommitInput } from "../src/release-plan.mjs";
import { assertCancellableRelease } from "../src/release-cancellation.mjs";
import { makeProfileReleaseOperation } from "../src/profile-release-contract.mjs";
import { ServiceError } from "../src/service-contract.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import {
  productWorkflowRuntime,
  realProductWorkflowRuntime
} from "../src/product-workflow-runtime-config.mjs";

function fixture(
  profile,
  { conditionalDelete = true, environment = "prod" } = {}
) {
  const candidate = {
    role: "frontend",
    base: "a".repeat(40),
    commit: "b".repeat(40),
    tree: "c".repeat(40),
    changed: true
  };
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    profile: profile.name,
    step: {
      id: `${environment}:integrate:frontend`,
      kind: "integrate",
      role: "frontend",
      environment
    },
    state: "checking",
    result: null,
    created_at: "2026-09-30T11:00:00.000Z",
    actor:
      profile.name === "real"
        ? { id: "209783236", login: "simo6529" }
        : { id: "456", login: "tester" },
    base: candidate.base,
    target_branch: environment === "staging" ? "1a-staging" : "main",
    branch: `codex/release-11111111-1111-4111-8111-111111111111-${environment}-frontend`,
    body: "Owned release attempt",
    integration_version: 1,
    integration_commit: "d".repeat(40),
    cleanup_reason: "review-stop",
    number: 42,
    url: `https://github.com/${profile.repositories.frontend.full_name}/pull/42`
  };
  record.integration_input = integrationCommitInput(record, candidate);
  const live = {
    state: "open",
    merged: false,
    exists: true,
    commit: record.integration_commit,
    actor: record.actor.id,
    loseClose: false,
    loseDelete: false,
    moveBeforeDelete: false
  };
  const writes = [];
  const pull = () => ({
    number: record.number,
    html_url: record.url,
    state: live.state,
    merged: live.merged,
    user: { id: Number(live.actor) },
    body: record.body,
    head: {
      repo: { id: profile.repositories.frontend.id },
      ref: record.branch,
      sha: record.integration_commit
    },
    base: {
      repo: { id: profile.repositories.frontend.id },
      ref: record.target_branch,
      sha: "f".repeat(40)
    }
  });
  const execute = async (args) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    const respond = (status, data) =>
      `HTTP/2 ${status} Result\nContent-Type: application/json\n\n${data === undefined ? "" : JSON.stringify(data)}`;
    if (method !== "GET") writes.push(`${method} ${endpoint}`);
    if (endpoint.endsWith("/pulls/42")) {
      if (method === "PATCH") {
        live.state = "closed";
        if (live.loseClose) {
          live.loseClose = false;
          throw new Error("lost close response");
        }
      } else assert.equal(method, "GET");
      return respond(200, pull());
    }
    if (endpoint.endsWith(`/git/ref/heads/${record.branch}`)) {
      assert.equal(method, "GET");
      return respond(
        live.exists ? 200 : 404,
        live.exists
          ? { object: { sha: live.commit } }
          : { message: "Not Found" }
      );
    }
    if (live.merged && endpoint.includes("/git/commits/")) {
      const commit = endpoint.split("/").at(-1);
      return respond(200, {
        sha: commit,
        tree: { sha: record.result.tree },
        message: record.integration_input.message,
        parents: (commit === record.integration_commit
          ? record.integration_input.parents
          : [record.base, record.integration_commit]
        ).map((sha) => ({ sha }))
      });
    }
    assert.fail(`Cancellation must not access ${method} ${endpoint}`);
  };
  const base = createReleaseGitHub({
    profile,
    runtime:
      profile.name === "real"
        ? realProductWorkflowRuntime
        : productWorkflowRuntime,
    execute,
    deleteBranch: !conditionalDelete
      ? undefined
      : async ({ repository, branch, commit }) => {
          assert.equal(repository.id, profile.repositories.frontend.id);
          assert.equal(branch, record.branch);
          writes.push(`GIT ${branch}`);
          if (live.moveBeforeDelete) live.commit = "e".repeat(40);
          assert.equal(
            live.commit,
            commit,
            "conditional deletion rejected stale SHA"
          );
          live.exists = false;
          if (live.loseDelete) {
            live.loseDelete = false;
            throw new Error("lost delete response");
          }
        },
    wait: async () => {}
  });
  // Both profiles use the same product-shaped entry point. It must not wait
  // for deployments or invoke a merge before delegating this cleanup.
  const client = createProductWorkflowReleaseGitHub({
    profile,
    base,
    execute: async () => assert.fail("No workflow API needed for cancellation")
  });
  const input = { record, candidate, save: async () => {} };
  return { client, input, live, writes, base, execute };
}

/** Model a finished staging run without allowing a single product write. */
function finishedStagingFixture(profile) {
  const f = fixture(profile, { environment: "staging" });
  const merged = f.input.record;
  merged.state = "completed";
  merged.cleanup = "removed";
  delete merged.cleanup_reason;
  merged.result = {
    status: "passed",
    kind: "merge",
    commit: "e".repeat(40),
    tree: f.input.candidate.tree,
    url: merged.url
  };
  f.live.state = "closed";
  f.live.merged = true;
  f.live.exists = false;
  const runtime =
    profile.name === "real"
      ? realProductWorkflowRuntime
      : productWorkflowRuntime;
  const record = {
    id: "33333333-3333-4333-8333-333333333333",
    release_id: merged.release_id,
    step: {
      id: "staging:deploy:frontend:frontend",
      environment: "staging",
      kind: "deploy",
      role: "frontend",
      unit: "frontend"
    },
    state: "running",
    result: null,
    created_at: "2026-09-30T11:00:01.000Z",
    actor: merged.actor,
    workflow_id: 21,
    workflow_run_id: 501,
    dispatch_response_run_id: 501
  };
  record.operation = makeProfileReleaseOperation({
    profile: profile.name,
    release_id: record.release_id,
    operation_id: record.id,
    operation: "deploy",
    environment: "staging",
    role: "frontend",
    unit: "frontend",
    backend_commit: "b".repeat(40),
    frontend_commit: merged.result.commit
  });
  const run = {
    id: 501,
    repository: { id: profile.repositories.frontend.id },
    head_repository: { id: profile.repositories.frontend.id },
    head_sha: merged.result.commit,
    head_branch: "1a-staging",
    path: ".github/workflows/deploy-staging.yml",
    event: "workflow_dispatch",
    actor: { id: Number(merged.actor.id) },
    workflow_id: 21,
    run_attempt: 1,
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/${profile.repositories.frontend.full_name}/actions/runs/501`,
    created_at: "2026-09-30T11:01:00.000Z"
  };
  const control = {
    active: false,
    missing: false,
    badJob: false,
    changeAttempt: false,
    recreateBranch: false,
    foreignPull: false,
    badMerge: false
  };
  const calls = [];
  let reads = 0;
  const execute = async (args, body) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    calls.push({ method, endpoint });
    assert.equal(
      method,
      "GET",
      "Finished staging closeout is product-read-only"
    );
    if (endpoint.includes("/actions/workflows/") && endpoint.includes("/runs?"))
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify({ total_count: control.active ? 1 : 0, workflow_runs: [] })}`;
    if (endpoint.endsWith("/actions/runs/501")) {
      reads++;
      if (control.recreateBranch && reads > 1) f.live.exists = true;
      return `HTTP/2 ${control.missing ? 404 : 200} OK\nContent-Type: application/json\n\n${JSON.stringify({ ...run, run_attempt: control.changeAttempt && reads > 1 ? 2 : run.run_attempt })}`;
    }
    if (endpoint.includes("/jobs?per_page=100"))
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify(
        {
          total_count: 2,
          jobs: [
            "Build exact staging artifact",
            "Deploy exact staging artifact"
          ].map((name, index) => ({
            id: 801 + index,
            run_id: 501,
            head_sha: run.head_sha,
            name,
            status: "completed",
            conclusion: control.badJob && index === 1 ? "failure" : "success"
          }))
        }
      )}`;
    if (endpoint.includes("/contents/")) {
      const role = endpoint.includes("backend") ? "backend" : "frontend";
      const file = endpoint.match(/\/contents\/(.+)\?ref=/u)[1];
      const pinned = runtime.repositories[role].files[file];
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify({ type: "file", path: file, sha: typeof pinned === "string" ? pinned : pinned.staging })}`;
    }
    const response = await f.execute(args, body);
    const split = response.indexOf("\n\n");
    const data = JSON.parse(response.slice(split + 2));
    if (endpoint.endsWith("/pulls/42")) {
      data.merge_commit_sha = merged.result.commit;
      data.merged_at = "2026-09-30T11:00:01.000Z";
      if (control.foreignPull) data.user.id = 999;
    }
    if (
      endpoint.endsWith(`/git/commits/${merged.result.commit}`) &&
      control.badMerge
    )
      data.parents = [];
    return `${response.slice(0, split + 2)}${JSON.stringify(data)}`;
  };
  const base = createReleaseGitHub({
    profile,
    runtime,
    execute,
    wait: async () => {}
  });
  const client = createProductWorkflowReleaseGitHub({
    profile,
    runtime,
    base,
    execute,
    wait: async () => {}
  });
  const input = {
    record,
    integration: merged,
    candidate: f.input.candidate,
    runtime: { frontend: { workflows: { stagingDeploy: { workflow_id: 21 } } } }
  };
  return { ...f, client, input, run, control, calls };
}

for (const profile of [sandboxProfile, realProfile]) {
  test(`${profile.name}: finished staging inspection uses only GET and preserves all original records`, async () => {
    const f = finishedStagingFixture(profile);
    const original = structuredClone(f.input);
    const evidence = await f.client.verifyFinishedStaging(f.input);
    assert.equal(evidence.deployment.conclusion, "success");
    assert.equal(evidence.integration.cleanup, "removed");
    assert.equal(
      evidence.integration.commit,
      f.input.integration.result.commit
    );
    assert.deepEqual(f.input, original);
    assert.deepEqual(f.writes, []);
    assert.ok(f.calls.every((call) => call.method === "GET"));
  });
  test(`${profile.name}: finished staging inspection refuses pending, failed, foreign, rerun and incomplete evidence`, async () => {
    for (const mutate of [
      (f) => {
        f.run.status = "in_progress";
        f.run.conclusion = null;
      },
      (f) => {
        f.run.conclusion = "failure";
      },
      (f) => {
        f.run.conclusion = "cancelled";
      },
      (f) => {
        f.run.head_sha = "a".repeat(40);
      },
      (f) => {
        f.run.actor.id = 999;
      },
      (f) => {
        f.run.repository.id = 999;
      },
      (f) => {
        f.run.workflow_id = 999;
      },
      (f) => {
        f.run.event = "push";
      },
      (f) => {
        f.control.active = true;
      },
      (f) => {
        f.control.missing = true;
      },
      (f) => {
        f.control.badJob = true;
      },
      (f) => {
        f.control.changeAttempt = true;
      },
      (f) => {
        f.control.recreateBranch = true;
      },
      (f) => {
        f.control.foreignPull = true;
      },
      (f) => {
        f.control.badMerge = true;
      },
      (f) => {
        f.live.exists = true;
      }
    ]) {
      const f = finishedStagingFixture(profile);
      mutate(f);
      await assert.rejects(f.client.verifyFinishedStaging(f.input));
      assert.deepEqual(f.writes, []);
    }
  });
}

test("cancellation rejects a missing saved operation with a structured error", () => {
  for (const record of [undefined, null, []])
    assert.throws(
      () =>
        assertCancellableRelease(
          {
            plan: { steps: [{ id: "prod:integrate:frontend" }] },
            step_index: 0,
            operations: { "prod:integrate:frontend": record }
          },
          {}
        ),
      (error) =>
        error instanceof ServiceError &&
        error.code === "release-cancel" &&
        /saved integration PR record/u.test(error.message)
    );
});

for (const profile of [sandboxProfile, realProfile]) {
  test(`${profile.name}: first staging cancellation closes only the unmerged owned PR despite destination drift`, async () => {
    const { client, input, live, writes } = fixture(profile, {
      environment: "staging"
    });
    assert.equal(input.record.target_branch, "1a-staging");
    const result = await client.cancelIntegration(input);
    assert.equal(result.kind, "review-stop");
    assert.equal(live.state, "closed");
    assert.equal(live.exists, false);
    assert.equal(input.record.cleanup, "removed");
    assert.deepEqual(writes, [
      `PATCH repos/${profile.repositories.frontend.full_name}/pulls/42`,
      `GIT ${input.record.branch}`
    ]);
  });
  test(`${profile.name}: cancellation closes only its exact owned PR/branch despite main moving`, async () => {
    const { client, input, live, writes } = fixture(profile);
    const result = await client.cancelIntegration(input);
    assert.equal(result.kind, "review-stop");
    assert.equal(live.state, "closed");
    assert.equal(live.exists, false);
    assert.equal(input.record.cleanup, "removed");
    assert.deepEqual(
      writes.map((write) => write.split(" ")[0]),
      ["PATCH", "GIT"]
    );
    assert.ok(
      writes.every(
        (write) =>
          write.endsWith("/pulls/42") || write.endsWith(input.record.branch)
      )
    );
  });
  for (const loss of ["loseClose", "loseDelete"]) {
    test(`${profile.name}: cancellation safely resumes after ${loss} without recreating a branch`, async () => {
      const { client, input, live, writes } = fixture(profile);
      live[loss] = true;
      await assert.rejects(
        client.cancelIntegration(input),
        /lost .* response/u
      );
      assert.equal(input.record.state, "cleaning");
      const result = await client.cancelIntegration(input);
      assert.equal(result.kind, "review-stop");
      assert.equal(live.exists, false);
      assert.deepEqual(
        writes.map((write) => write.split(" ")[0]),
        ["PATCH", "GIT"]
      );
    });
  }
  test(`${profile.name}: cancellation refuses merged/foreign PRs, moved/missing open branches and uncertain merge states`, async () => {
    for (const change of [
      ({ live }) => {
        live.merged = true;
        live.state = "closed";
      },
      ({ live }) => {
        live.actor = "999";
      },
      ({ live }) => {
        live.commit = "e".repeat(40);
      },
      ({ live }) => {
        live.exists = false;
      },
      ({ input }) => {
        input.record.state = "merging";
      },
      ({ input }) => {
        input.record.branch = "main";
      },
      ({ input }) => {
        input.record.integration_input.tree = "e".repeat(40);
      },
      ({ input }) => {
        input.record.cleanup_reason = undefined;
      }
    ]) {
      const f = fixture(profile);
      change(f);
      await assert.rejects(f.client.cancelIntegration(f.input));
      assert.deepEqual(f.writes, []);
    }
  });
  test(`${profile.name}: a branch move between its final read and deletion survives cleanup`, async () => {
    const f = fixture(profile);
    f.live.moveBeforeDelete = true;
    await assert.rejects(
      f.client.cancelIntegration(f.input),
      /conditional deletion rejected stale SHA/u
    );
    assert.equal(f.live.state, "closed");
    assert.equal(f.live.exists, true);
    assert.equal(f.live.commit, "e".repeat(40));
    assert.equal(f.input.record.state, "cleaning");
    assert.equal(f.input.record.result, null);
    assert.equal(f.input.record.cleanup, undefined);
    await assert.rejects(
      f.client.cancelIntegration(f.input),
      /branch changed/u
    );
    assert.equal(f.live.exists, true);
    assert.deepEqual(
      f.writes.map((write) => write.split(" ")[0]),
      ["PATCH", "GIT"]
    );
  });
  test(`${profile.name}: an unavailable conditional transport cannot fall back to REST deletion`, async () => {
    const f = fixture(profile, { conditionalDelete: false });
    await assert.rejects(
      f.client.cancelIntegration(f.input),
      /REST deletion is not a fallback/u
    );
    assert.equal(f.live.state, "closed");
    assert.equal(f.live.exists, true);
    assert.equal(f.input.record.state, "cleaning");
    assert.equal(f.input.record.cleanup, undefined);
    assert.deepEqual(
      f.writes.map((write) => write.split(" ")[0]),
      ["PATCH"]
    );
  });
  test(`${profile.name}: an externally closed owned PR can be cleaned, but a late merge blocks branch deletion`, async () => {
    const f = fixture(profile);
    f.live.state = "closed";
    await f.client.cancelIntegration(f.input);
    assert.deepEqual(
      f.writes.map((write) => write.split(" ")[0]),
      ["GIT"]
    );
    const raced = fixture(profile);
    raced.input.save = async () => {
      raced.live.merged = true;
      raced.live.state = "closed";
    };
    await assert.rejects(raced.client.cancelIntegration(raced.input));
    assert.deepEqual(raced.writes, []);
    assert.equal(raced.input.record.state, "cleaning");
    assert.equal(raced.input.record.result, null);
    assert.equal(raced.live.exists, true);
  });
}
