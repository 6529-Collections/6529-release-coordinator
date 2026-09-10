import assert from "node:assert/strict";
import test from "node:test";
import { publishFixturePr } from "../sandbox/fixture-pr.mjs";

const entry = {
  repository: {
    id: 1362505082,
    full_name: "6529-Collections/release-coordinator-test-backend"
  },
  branch: "codex/services-case-example",
  commit: "a".repeat(40)
};
const pr = () => ({
  number: 42,
  state: "open",
  head: {
    ref: entry.branch,
    sha: entry.commit,
    repo: { id: entry.repository.id }
  },
  base: { ref: "main", repo: { id: entry.repository.id } },
  html_url: `https://github.com/${entry.repository.full_name}/pull/42`
});

test("fixture publication saves its branch before push and resumes a lost PR response", async () => {
  let saved,
    remote,
    created = 0,
    pushes = 0;
  const options = {
    save: async (value) => {
      saved = structuredClone(value);
    },
    push: async (value) => {
      assert.deepEqual(saved, value);
      pushes++;
    },
    find: async () => (remote ? [remote] : []),
    create: async () => {
      created++;
      remote = pr();
      throw new Error("response lost");
    }
  };
  await assert.rejects(publishFixturePr(entry, options), /response lost/);
  assert.equal(saved.commit, entry.commit);
  assert.equal(saved.url, undefined);
  const result = await publishFixturePr(saved, options);
  assert.equal(result.url, pr().html_url);
  assert.equal(saved.number, 42);
  assert.equal(created, 1);
  assert.equal(pushes, 2);
});

test("a failed fixture state save prevents push and PR creation", async () => {
  await assert.rejects(
    publishFixturePr(entry, {
      save: async () => {
        throw new Error("disk full");
      },
      push: async () => assert.fail("must save before pushing"),
      find: async () => assert.fail("must save first"),
      create: async () => assert.fail("must save first")
    }),
    /disk full/
  );
});

test("fixture recovery rejects ambiguous, closed or changed PRs without replacement", async () => {
  for (const matches of [
    [pr(), pr()],
    [{ ...pr(), state: "closed" }],
    [{ ...pr(), head: { ...pr().head, sha: "b".repeat(40) } }]
  ]) {
    await assert.rejects(
      publishFixturePr(entry, {
        save: async () => {},
        push: async () => {},
        find: async () => matches,
        create: async () => assert.fail("must not create a replacement")
      }),
      /ambiguous|no longer matches/
    );
  }
});
