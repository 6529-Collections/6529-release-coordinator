import assert from "node:assert/strict";
import test from "node:test";
import { createReleaseGitHub } from "../src/release-github.mjs";
import { createProductWorkflowReleaseGitHub } from "../src/product-workflow-release-github.mjs";
import { integrationCommitInput } from "../src/release-plan.mjs";
import { assertCancellableRelease } from "../src/release-cancellation.mjs";
import { ServiceError } from "../src/service-contract.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import {
  productWorkflowRuntime,
  realProductWorkflowRuntime
} from "../src/product-workflow-runtime-config.mjs";

function fixture(profile, { conditionalDelete = true } = {}) {
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
      id: "prod:integrate:frontend",
      kind: "integrate",
      role: "frontend",
      environment: "prod"
    },
    state: "checking",
    result: null,
    created_at: "2026-09-30T11:00:00.000Z",
    actor:
      profile.name === "real"
        ? { id: "209783236", login: "simo6529" }
        : { id: "456", login: "tester" },
    base: candidate.base,
    target_branch: "main",
    branch: "codex/release-11111111-1111-4111-8111-111111111111-prod-frontend",
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
      ref: "main",
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
  return { client, input, live, writes };
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
