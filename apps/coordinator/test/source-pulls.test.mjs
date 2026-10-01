import test from "node:test";
import assert from "node:assert/strict";
import { assertSourcePulls, mergedSourcePulls } from "../src/source-pulls.mjs";
import { fixture } from "./processing-fixture.mjs";
import { realProfile } from "../src/profiles.mjs";

test("source gates are freshly checked before integration; pushes, closures, failures and new review blocks stop it", async () => {
  const f = fixture();
  const source = f.request.release_parts[0].pull_requests[0];
  const options = {
    sources: [source],
    repository: realProfile.repositories.backend,
    pullRequest: async () => f.pr
  };
  await assertSourcePulls(options);
  await assert.rejects(
    assertSourcePulls({
      ...options,
      pullRequest: async () => ({ ...f.pr, number: 11 })
    }),
    /PR metadata/
  );
  for (const change of [
    (pr) => {
      pr.headRefOid = "c".repeat(40);
    },
    (pr) => {
      pr.state = "CLOSED";
    },
    (pr) => {
      pr.baseRefName = "1a-staging";
    },
    (pr) => {
      pr.checks[0].conclusion = "FAILURE";
    },
    (pr) => {
      pr.reviewDecision = "CHANGES_REQUESTED";
    },
    (pr) => {
      pr.mergeStateStatus = "BEHIND";
    }
  ]) {
    const pr = structuredClone(f.pr);
    change(pr);
    await assert.rejects(
      assertSourcePulls({ ...options, pullRequest: async () => pr }),
      /Stop before merging/
    );
  }
});

test("indirectly merged originals must keep the exact requested head and repository", async () => {
  const sources = [
    { number: 10, branch: "codex/source", commit: "a".repeat(40) }
  ];
  const repository = { id: 123 };
  const original = {
    number: 10,
    merged: true,
    head: { repo: repository, ref: sources[0].branch, sha: sources[0].commit },
    base: { repo: repository, ref: "main" },
    html_url: "https://example.invalid/pull/10"
  };
  const options = { sources, repository, get: async () => original };
  assert.deepEqual(await mergedSourcePulls(options), [
    { number: 10, commit: sources[0].commit, url: original.html_url }
  ]);
  for (const change of [
    (pr) => {
      pr.merged = false;
    },
    (pr) => {
      pr.head.sha = "b".repeat(40);
    },
    (pr) => {
      pr.head.ref = "other";
    },
    (pr) => {
      pr.head.repo = { id: 456 };
    },
    (pr) => {
      pr.base.ref = "1a-staging";
    }
  ]) {
    const pr = structuredClone(original);
    change(pr);
    await assert.rejects(
      mergedSourcePulls({ ...options, get: async () => pr }),
      /requested exact commit/
    );
  }
});
