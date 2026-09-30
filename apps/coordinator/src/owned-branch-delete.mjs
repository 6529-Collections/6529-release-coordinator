import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import path from "node:path";
import {
  githubEnvironment,
  runRehearsalProcess
} from "./rehearsal-process.mjs";
import { serviceAssert, ServiceError } from "./service-contract.mjs";

// REST ref deletion has no expected-SHA condition. Git's explicit lease makes
// the remote compare and deletion one operation; never fall back to REST.
export async function deleteOwnedRemoteBranch({
  repository,
  branch,
  commit,
  signal,
  process: run = runRehearsalProcess
}) {
  serviceAssert(
    /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/u.test(repository?.full_name ?? "") &&
      /^codex\/release-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}-(?:staging|prod)-(?:backend|frontend)(?:-restore)?$/u.test(
        branch ?? ""
      ) &&
      /^[0-9a-f]{40}$/u.test(commit ?? ""),
    "release-ownership",
    "Conditional cleanup requires an exact owned release branch and commit."
  );
  const directory = await mkdtemp(path.join(tmpdir(), "coordinator-delete-"));
  const env = {
    ...githubEnvironment(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0"
  };
  try {
    await run("git", ["init", "--bare", "--template=", directory], {
      env,
      signal
    });
    const ref = `refs/heads/${branch}`;
    await run(
      "git",
      [
        "-C",
        directory,
        "-c",
        `core.hooksPath=${devNull}`,
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!gh auth git-credential",
        "-c",
        "http.followRedirects=false",
        "push",
        "--porcelain",
        `--force-with-lease=${ref}:${commit}`,
        "--",
        `https://github.com/${repository.full_name}.git`,
        `:${ref}`
      ],
      { env, signal }
    );
  } catch {
    throw new ServiceError(
      "release-cleanup",
      "Conditional branch deletion was not confirmed. The branch may have moved or the response may be unknown; ownership stays saved for inspection or resume."
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
