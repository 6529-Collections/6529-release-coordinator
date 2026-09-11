import { mkdtemp, mkdir, readdir, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isSha,
  RehearsalError,
  sandboxRepositories
} from "./rehearsal-plan.mjs";
import { runRehearsalProcess } from "./rehearsal-process.mjs";

export async function createRehearsalGit({
  signal,
  execute = runRehearsalProcess,
  temporaryRoot = tmpdir(),
  remove = rm,
  // Test-only dependency injection; no manifest/CLI option can enable file remotes.
  fixtureRemotes,
  repositories = sandboxRepositories,
  authentication = async () => null,
  maxStorageBytes = 128 * 1024 * 1024
} = {}) {
  const directory = await mkdtemp(path.join(temporaryRoot, "6529-rehearsal-"));
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: fixtureRemotes ? "file" : "https",
    GIT_AUTHOR_NAME: "Coordinator rehearsal",
    GIT_AUTHOR_EMAIL: "rehearsal@example.invalid",
    GIT_COMMITTER_NAME: "Coordinator rehearsal",
    GIT_COMMITTER_EMAIL: "rehearsal@example.invalid"
  };
  let count = 0;
  let stopped = false;
  async function storageLimit() {
    let bytes = 0;
    let files = 0;
    async function walk(dir) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const name = path.join(dir, entry.name);
        let stat;
        try {
          stat = await lstat(name);
        } catch (error) {
          if (error.code === "ENOENT") continue;
          throw error;
        }
        bytes += stat.size;
        files += 1;
        if (bytes > maxStorageBytes || files > 20_000)
          throw new RehearsalError(
            "resource_limit",
            "Temporary repository exceeded its storage limit."
          );
        if (entry.isDirectory()) await walk(name);
      }
    }
    await walk(directory);
  }
  const config = [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.attributesFile=/dev/null",
    "-c",
    "credential.helper=",
    "-c",
    "http.followRedirects=false",
    "-c",
    "http.lowSpeedLimit=1024",
    "-c",
    "http.lowSpeedTime=20",
    "-c",
    "fetch.fsckObjects=true",
    "-c",
    "transfer.fsckObjects=true",
    "-c",
    "gc.auto=0",
    "-c",
    "maintenance.auto=false",
    "-c",
    "commit.gpgSign=false"
  ];
  async function git(cwd, args, options = {}) {
    if (stopped)
      throw new RehearsalError(
        "closed_workspace",
        "Temporary rehearsal workspace is closed."
      );
    const result = await execute("git", [...config, ...args], {
      cwd,
      env,
      signal,
      watch: storageLimit,
      ...options
    });
    await storageLimit();
    return result;
  }
  async function clean() {
    stopped = true;
    await remove(directory, { recursive: true, force: true, maxRetries: 2 });
  }
  try {
    await mkdir(path.join(directory, "empty-template"));
    const version = (await git(directory, ["--version"])).stdout.trim();
    const match = /^git version (\d+)\.(\d+)/u.exec(version);
    if (
      !match ||
      Number(match[1]) < 2 ||
      (Number(match[1]) === 2 && Number(match[2]) < 38)
    ) {
      throw new RehearsalError(
        "git_version",
        "Git 2.38 or newer is required for object-based merge rehearsals."
      );
    }
    return {
      directory,
      version,
      cleanup: clean,
      async repository(repo) {
        const cwd = path.join(directory, `repository-${++count}.git`);
        await git(directory, [
          "init",
          "--bare",
          `--template=${path.join(directory, "empty-template")}`,
          cwd
        ]);
        let remote;
        if (fixtureRemotes) remote = fixtureRemotes[repo.role];
        else {
          const trusted = repositories[repo.role];
          if (
            !trusted ||
            trusted.full_name !== repo.identity.full_name ||
            trusted.id !== repo.identity.id ||
            !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(trusted.full_name)
          )
            throw new RehearsalError(
              "repository_identity",
              "The Git transport rejects a repository outside its trusted profile."
            );
          remote = `https://github.com/${repo.identity.full_name}.git`;
        }
        if (typeof remote !== "string" || !remote || remote.startsWith("-"))
          throw new RehearsalError(
            "invalid_remote",
            "Invalid trusted repository source."
          );
        const commits = [
          ...new Set([
            repo.destination.commit,
            ...repo.pull_requests.map((pr) => pr.commit)
          ])
        ];
        if (!commits.every(isSha))
          throw new RehearsalError(
            "invalid_commit",
            "Invalid exact Git commit."
          );
        const header = fixtureRemotes ? null : await authentication();
        const fetchEnv = {
          ...env,
          ...(header
            ? {
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
                GIT_CONFIG_VALUE_0: header
              }
            : {})
        };
        await git(
          cwd,
          [
            "fetch",
            "--no-tags",
            "--no-recurse-submodules",
            "--no-write-fetch-head",
            "--",
            remote,
            ...commits
          ],
          { env: fetchEnv }
        );
        async function oid(args) {
          const value = (await git(cwd, args)).stdout.trim();
          if (!isSha(value))
            throw new RehearsalError(
              "git_evidence",
              "Git did not return an exact object identity."
            );
          return value;
        }
        async function blob(commit, filename) {
          const sha = await oid([
            "rev-parse",
            "--verify",
            `${commit}:${filename}`
          ]);
          const text = (
            await git(cwd, ["cat-file", "blob", sha], {
              maxOutput: 1024 * 1024
            })
          ).stdout;
          return { sha, text };
        }
        async function supportedTree(commit) {
          const entries = (
            await git(cwd, ["ls-tree", "-r", "-z", commit])
          ).stdout
            .split("\0")
            .filter(Boolean);
          for (const entry of entries) {
            const tab = entry.indexOf("\t");
            const [mode] = entry.slice(0, tab).split(" ");
            const filename = entry.slice(tab + 1);
            if (tab < 0 || mode === "160000")
              throw new RehearsalError(
                "unsupported_tree",
                "Submodules or unreadable trees require separate merge support."
              );
            if (filename.split("/").at(-1) === ".gitattributes") {
              const value = await blob(commit, filename);
              if (
                value.text
                  .split(/\r?\n/u)
                  .some((line) => line.trim() && !line.trim().startsWith("#"))
              ) {
                throw new RehearsalError(
                  "unsupported_attributes",
                  "Git attribute rules require separate merge support; no filters or custom drivers were executed."
                );
              }
            }
          }
        }
        for (const commit of commits) {
          if (
            (await oid(["rev-parse", "--verify", `${commit}^{commit}`])) !==
            commit
          )
            throw new RehearsalError(
              "git_evidence",
              "Fetched commit differs from the request."
            );
          await supportedTree(commit);
        }
        return {
          tree: (commit) => {
            if (!isSha(commit))
              throw new RehearsalError("invalid_commit", "Invalid tree input.");
            return oid(["rev-parse", "--verify", `${commit}^{tree}`]);
          },
          async patch(base, commit, names) {
            if (
              !isSha(base) ||
              !isSha(commit) ||
              !Array.isArray(names) ||
              names.length > 40
            )
              throw new RehearsalError(
                "invalid_snapshot",
                "Unsupported candidate patch."
              );
            const patch = [];
            for (const name of names) {
              if (
                !/^(?:src\/[a-zA-Z0-9_./-]+|docs\/[a-zA-Z0-9_./-]+\.md|README\.md|shared\.txt)$/u.test(
                  name
                ) ||
                name.includes("..")
              )
                throw new RehearsalError(
                  "invalid_snapshot",
                  "Candidate patch is outside sample paths."
                );
              const entry = (await git(cwd, ["ls-tree", commit, "--", name]))
                .stdout;
              if (!entry) {
                patch.push({
                  path: name,
                  mode: "100644",
                  type: "blob",
                  sha: null
                });
                continue;
              }
              const mode = entry.split(" ")[0];
              if (!["100644", "100755"].includes(mode))
                throw new RehearsalError(
                  "unsupported_tree",
                  "Candidate patches require regular files."
                );
              const file = await blob(commit, name);
              if (
                Buffer.byteLength(file.text) > 12_000 ||
                file.text.includes("\u0000")
              )
                throw new RehearsalError(
                  "resource_limit",
                  "Candidate patch file exceeds sample limits."
                );
              patch.push({
                path: name,
                mode,
                type: "blob",
                content: file.text
              });
            }
            return patch;
          },
          async files(commit, names) {
            if (
              !isSha(commit) ||
              !Array.isArray(names) ||
              names.length > 10 ||
              names.some(
                (name) =>
                  !/^src\/[a-zA-Z0-9_./-]+$/u.test(name) || name.includes("..")
              )
            )
              throw new RehearsalError(
                "invalid_snapshot",
                "Unsupported sample source paths."
              );
            const files = {};
            for (const name of names) {
              const entry = (await git(cwd, ["ls-tree", commit, "--", name]))
                .stdout;
              if (
                !entry.startsWith("100644 blob ") &&
                !entry.startsWith("100755 blob ")
              )
                throw new RehearsalError(
                  "unsupported_tree",
                  "A sample source must be a regular Git file."
                );
              const file = await blob(commit, name);
              if (Buffer.byteLength(file.text) > 12_000)
                throw new RehearsalError(
                  "resource_limit",
                  "Sample source exceeds its size limit."
                );
              files[name] = file;
            }
            return files;
          },
          async changedPaths(base, commit) {
            if (!isSha(base) || !isSha(commit))
              throw new RehearsalError(
                "invalid_commit",
                "Invalid source comparison."
              );
            return (
              await git(cwd, [
                "diff",
                "--no-ext-diff",
                "--name-only",
                "-z",
                base,
                commit
              ])
            ).stdout
              .split("\0")
              .filter(Boolean);
          },
          async merge(current, head) {
            if (!isSha(current) || !isSha(head))
              throw new RehearsalError(
                "invalid_commit",
                "Invalid exact merge input."
              );
            const result = await git(
              cwd,
              [
                "merge-tree",
                "--write-tree",
                "--name-only",
                "-z",
                "--no-messages",
                current,
                head
              ],
              { allowedCodes: [0, 1] }
            );
            const [tree, ...paths] = result.stdout.split("\0");
            if (!isSha(tree))
              throw new RehearsalError(
                "git_evidence",
                "Git did not produce a verifiable merge tree."
              );
            if (result.code === 1)
              return {
                status: "blocked",
                tree,
                conflicts: paths.filter(Boolean)
              };
            const commit = await oid([
              "commit-tree",
              tree,
              "-p",
              current,
              "-p",
              head,
              "-m",
              "Temporary Coordinator merge rehearsal"
            ]);
            await supportedTree(commit);
            return { status: "pass", tree, commit, conflicts: [] };
          },
          async catalog(commit) {
            const value = await blob(commit, "src/config/deploy-services.json");
            let catalog;
            try {
              catalog = JSON.parse(value.text);
            } catch {
              throw new RehearsalError(
                "catalog_unreadable",
                "The combined backend catalog is not readable JSON."
              );
            }
            return { blob_sha: value.sha, catalog };
          }
        };
      }
    };
  } catch (error) {
    try {
      await clean();
    } catch {
      const failure = new RehearsalError(
        "cleanup_failed",
        `Failed to remove owned rehearsal directory: ${directory}`
      );
      failure.owned_path = directory;
      throw failure;
    }
    throw error;
  }
}
