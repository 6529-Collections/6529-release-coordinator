import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeFileAtomically } from "../sandbox/atomic-file.mjs";
import { publishFixturePr } from "../sandbox/fixture-pr.mjs";

const entry = {
  repository: {
    id: 1362505082,
    full_name: "6529-Collections/release-coordinator-test-backend"
  },
  branch: "codex/services-case-example",
  commit: "a".repeat(40),
  base: "b".repeat(40)
};
const pr = () => ({
  number: 42,
  state: "open",
  head: {
    ref: entry.branch,
    sha: entry.commit,
    repo: { id: entry.repository.id }
  },
  base: {
    ref: "main",
    sha: entry.base,
    repo: { id: entry.repository.id }
  },
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

test("an interrupted atomic fixture checkpoint preserves the prior file", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "fixture-checkpoint-")
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "provision.json");
  await writeFile(destination, "previous");
  await assert.rejects(
    writeFileAtomically(destination, "replacement", {
      writeFile: async (temporary, contents) => {
        await writeFile(temporary, contents);
      },
      rename: async () => {
        throw new Error("interrupted before replace");
      },
      rm
    }),
    /interrupted before replace/u
  );
  assert.equal(await readFile(destination, "utf8"), "previous");
  await writeFileAtomically(destination, "replacement");
  assert.equal(await readFile(destination, "utf8"), "replacement");
});

test("fixture recovery rejects ambiguous, closed or changed PRs without replacement", async () => {
  for (const matches of [
    [pr(), pr()],
    [{ ...pr(), state: "closed" }],
    [{ ...pr(), head: { ...pr().head, sha: "c".repeat(40) } }],
    [{ ...pr(), base: { ...pr().base, sha: "c".repeat(40) } }]
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
  await assert.rejects(
    publishFixturePr(
      { ...entry, number: 42, url: pr().html_url },
      {
        save: async () => {},
        push: async () => {},
        find: async () => [],
        create: async () => assert.fail("must not create a replacement")
      }
    ),
    /saved fixture PR is missing/u
  );
});
