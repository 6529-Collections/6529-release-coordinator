import assert from "node:assert/strict";
import test from "node:test";
import { createRehearsalGitHub } from "../src/rehearsal-github.mjs";

function fixture() {
  const profile = {
    name: "sandbox",
    repositories: {
      frontend: {
        full_name: "6529-Collections/release-coordinator-test-frontend",
        id: 123,
        private: true
      }
    }
  };
  const identity = {
    nameWithOwner: profile.repositories.frontend.full_name,
    databaseId: 123,
    isPrivate: true
  };
  const check = {
    id: "one",
    __typename: "CheckRun",
    name: "Sandbox check",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    isRequired: true
  };
  const pr = {
    number: 1,
    headRefOid: "a".repeat(40),
    headRefName: "feature/test",
    baseRefOid: "b".repeat(40),
    baseRefName: "main",
    state: "OPEN",
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    repository: identity,
    headRepository: { ...identity },
    commits: {
      nodes: [
        {
          commit: {
            oid: "a".repeat(40),
            statusCheckRollup: {
              contexts: {
                nodes: [check],
                pageInfo: { hasNextPage: false, endCursor: null }
              }
            }
          }
        }
      ]
    }
  };
  const response = { data: { repository: { pullRequest: pr } } };
  return { profile, response, pr, identity, check };
}

test("MR-14/MR-15: sandbox adapter permits fixed reads and binds private repository identities", async () => {
  const f = fixture();
  const calls = [];
  const api = createRehearsalGitHub(f.profile, {
    execute: async (file, args, options) => {
      calls.push({ file, args, options });
      if (args.some((arg) => arg.includes("query RehearsalDestination")))
        return {
          stdout: JSON.stringify({
            data: {
              repository: {
                ...f.identity,
                ref: { name: "main", target: { oid: "b".repeat(40) } }
              }
            }
          })
        };
      return { stdout: JSON.stringify(f.response) };
    }
  });
  const pr = await api.pullRequest("frontend", 1);
  assert.equal(pr.checks.length, 1);
  assert.equal(pr.repository.databaseId, 123);
  assert.equal(
    (await api.destination("frontend", "main")).commit,
    "b".repeat(40)
  );
  for (const { file, args, options } of calls) {
    assert.equal(file, "gh");
    assert.deepEqual(args.slice(0, 6), [
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "graphql"
    ]);
    assert.ok(args.some((arg) => arg.startsWith("query=query Rehearsal")));
    assert.equal(
      args.some((arg) => arg.includes("mutation")),
      false
    );
    assert.equal(options.env.GH_HOST, "github.com");
    assert.equal(options.env.GH_DEBUG, "");
  }
  const count = calls.length;
  await assert.rejects(api.pullRequest("6529seize-frontend", 1));
  await assert.rejects(api.pullRequest("frontend", -1));
  await assert.rejects(api.destination("frontend", "--evil"));
  assert.equal(calls.length, count);
});

for (const condition of [
  "identity",
  "fork",
  "public",
  "head-binding",
  "partial",
  "duplicate",
  "cursor",
  "moving"
])
  test(`MR-14/MR-15: ${condition} evidence cannot produce a verified PR`, async () => {
    const f = fixture();
    let reads = 0;
    const api = createRehearsalGitHub(f.profile, {
      execute: async () => {
        reads++;
        if (condition === "identity") f.pr.repository.databaseId = 999;
        if (condition === "fork")
          f.pr.headRepository.nameWithOwner = "someone/fork";
        if (condition === "public") f.pr.repository.isPrivate = false;
        if (condition === "head-binding")
          f.pr.commits.nodes[0].commit.oid = "c".repeat(40);
        const connection =
          f.pr.commits.nodes[0].commit.statusCheckRollup.contexts;
        if (["partial", "duplicate", "cursor", "moving"].includes(condition)) {
          connection.pageInfo = { hasNextPage: true, endCursor: "cursor" };
          if (reads > 1) {
            if (condition === "partial") throw new Error("read failed");
            if (condition === "cursor")
              connection.nodes = [{ ...f.check, id: "two" }];
            if (condition === "moving") f.pr.reviewDecision = "REVIEW_REQUIRED";
          }
        }
        return { stdout: JSON.stringify(f.response) };
      }
    });
    await assert.rejects(api.pullRequest("frontend", 1));
    assert.ok(reads <= 2);
  });

test("MR-15: complete check pagination preserves all required contexts", async () => {
  const f = fixture();
  let reads = 0;
  const api = createRehearsalGitHub(f.profile, {
    execute: async () => {
      const connection =
        f.pr.commits.nodes[0].commit.statusCheckRollup.contexts;
      connection.pageInfo = { hasNextPage: ++reads === 1, endCursor: "next" };
      connection.nodes = [{ ...f.check, id: String(reads) }];
      return { stdout: JSON.stringify(f.response) };
    }
  });
  assert.equal((await api.pullRequest("frontend", 1)).checks.length, 2);
});

test("MR-21: unprovisioned identities fail before GitHub access", async () => {
  const f = fixture();
  f.profile.repositories.frontend.id = null;
  let calls = 0;
  const api = createRehearsalGitHub(f.profile, {
    execute: async () => {
      calls++;
    }
  });
  await assert.rejects(api.pullRequest("frontend", 1), {
    code: "unbound_repository"
  });
  assert.equal(calls, 0);
});
