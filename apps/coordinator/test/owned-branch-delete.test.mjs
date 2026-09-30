import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import { deleteOwnedRemoteBranch } from "../src/owned-branch-delete.mjs";
import { runRehearsalProcess } from "../src/rehearsal-process.mjs";
import { ServiceError } from "../src/service-contract.mjs";

const branch =
  "codex/release-11111111-1111-4111-8111-111111111111-prod-frontend";
const ref = `refs/heads/${branch}`;
const repository = {
  full_name: "6529-Collections/release-coordinator-test-frontend"
};
const env = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: devNull,
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid"
};
const git = (args, input) => runRehearsalProcess("git", args, { env, input });

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "coordinator-lease-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git");
  await git(["init", "--bare", "--template=", remote]);
  const tree = (
    await git(["-C", remote, "hash-object", "-t", "tree", "--stdin"], "")
  ).stdout.trim();
  const first = (
    await git(["-C", remote, "commit-tree", tree], "First\n")
  ).stdout.trim();
  const second = (
    await git(["-C", remote, "commit-tree", tree, "-p", first], "Second\n")
  ).stdout.trim();
  await git(["-C", remote, "update-ref", ref, first]);
  await git(["-C", remote, "update-ref", "refs/heads/main", first]);
  const read = async (name) =>
    (await git(["-C", remote, "rev-parse", name])).stdout.trim();
  let directory;
  const calls = [];
  const run = async (file, args, options) => {
    assert.equal(file, "git");
    calls.push(args);
    if (args[0] === "init") directory = args.at(-1);
    const actual = args.map((arg) =>
      arg === `https://github.com/${repository.full_name}.git` ? remote : arg
    );
    // Real Git is used, but all transport is local and credentials are removed.
    return runRehearsalProcess(file, actual, {
      ...options,
      env: { ...options.env, GH_TOKEN: "", GITHUB_TOKEN: "" }
    });
  };
  return {
    remote,
    first,
    second,
    read,
    run,
    calls,
    directory: () => directory
  };
}

test("real Git conditionally deletes one exact branch from an isolated empty repository", async (t) => {
  const f = await fixture(t);
  await deleteOwnedRemoteBranch({
    repository,
    branch,
    commit: f.first,
    process: f.run
  });
  await assert.rejects(f.read(ref));
  assert.equal(await f.read("refs/heads/main"), f.first);
  await git(["-C", f.remote, "cat-file", "-e", f.first]);
  await assert.rejects(stat(f.directory()), { code: "ENOENT" });
  const push = f.calls.find((args) => args.includes("push"));
  assert.ok(push.includes(`--force-with-lease=${ref}:${f.first}`));
  assert.equal(push.at(-1), `:${ref}`);
  assert.equal(push.at(-2), `https://github.com/${repository.full_name}.git`);
  assert.ok(push.includes("credential.helper=!gh auth git-credential"));
  assert.ok(push.includes(`core.hooksPath=${devNull}`));
  assert.equal(push.includes("--force"), false);
});

test("real Git refuses a branch moved after the API observation and preserves its new commit", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.read(ref), f.first);
  await assert.rejects(
    deleteOwnedRemoteBranch({
      repository,
      branch,
      commit: f.first,
      process: async (file, args, options) => {
        if (args.includes("push"))
          await git(["-C", f.remote, "update-ref", ref, f.second]);
        return f.run(file, args, options);
      }
    }),
    (error) => error instanceof ServiceError && error.code === "release-cleanup"
  );
  assert.equal(await f.read(ref), f.second);
  assert.equal(await f.read("refs/heads/main"), f.first);
  await assert.rejects(stat(f.directory()), { code: "ENOENT" });
});

test("conditional deletion validates scope and redacts uncertain transport failure", async () => {
  for (const change of [
    { branch: "main" },
    { branch: "codex/release-a-prod-frontend" },
    { branch: `${branch}/../main` },
    { repository: { full_name: "https://elsewhere.invalid/repo" } },
    { commit: "unknown" }
  ])
    await assert.rejects(
      deleteOwnedRemoteBranch({
        repository,
        branch,
        commit: "a".repeat(40),
        ...change,
        process: async () => assert.fail("Invalid scope must not start Git")
      }),
      (error) =>
        error instanceof ServiceError && error.code === "release-ownership"
    );
  let directory;
  await assert.rejects(
    deleteOwnedRemoteBranch({
      repository,
      branch,
      commit: "a".repeat(40),
      process: async (_file, args) => {
        directory = args.at(-1);
        throw new Error("private credential and provider output");
      }
    }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "release-cleanup" &&
      !error.message.includes("private credential")
  );
  await assert.rejects(stat(directory), { code: "ENOENT" });
});
