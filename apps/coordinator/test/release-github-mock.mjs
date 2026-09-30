import assert from "node:assert/strict";
import { createReleaseGitHub } from "../src/release-github.mjs";

// Existing API fixtures model deletion as a synthetic DELETE. It is never a
// production transport: the adapter receives an explicit lease-delete mock,
// while owned-branch-delete.test.mjs verifies the actual Git lease with Git.
export const mockLeaseDeletion =
  (execute) =>
  async ({ repository, branch, commit }) => {
    assert.equal(typeof execute, "function");
    assert.match(commit, /^[0-9a-f]{40}$/u);
    assert.match(branch, /^codex\/release-/u);
    await execute([
      "api",
      "--method",
      "DELETE",
      `repos/${repository.full_name}/git/refs/heads/${branch}`
    ]);
  };

export const createMockReleaseGitHub = (options) =>
  createReleaseGitHub({
    ...options,
    deleteBranch: options.deleteBranch ?? mockLeaseDeletion(options.execute)
  });
