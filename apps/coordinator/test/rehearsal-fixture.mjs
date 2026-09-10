import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sandboxMergePlan } from "../src/rehearsal-plan.mjs";
import { createRehearsalGit } from "../src/rehearsal-git.mjs";
import { rehearseMerge } from "../src/rehearsal.mjs";

const exec = promisify(execFile);
export const sampleCatalog = () => ({
  services: [
    {
      name: "api",
      allowed_environments: ["staging", "prod"],
      default_dependencies: ["dbMigrationsLoop"]
    },
    {
      name: "dbMigrationsLoop",
      allowed_environments: ["staging"],
      default_dependencies: []
    }
  ]
});

export async function rehearsalFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "coordinator-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid"
  };
  const repositories = {};
  const profile = { name: "sandbox", repositories: {} };
  async function git(cwd, args) {
    return (
      await exec(
        "git",
        [
          "-c",
          "commit.gpgSign=false",
          "-c",
          "core.hooksPath=/dev/null",
          ...args
        ],
        { cwd, env }
      )
    ).stdout.trim();
  }
  for (const [index, role] of ["frontend", "backend"].entries()) {
    const cwd = path.join(directory, role);
    await mkdir(cwd);
    await git(cwd, ["init", "-b", "main"]);
    await writeFile(path.join(cwd, "shared.txt"), "original\n");
    if (role === "backend") {
      await mkdir(path.join(cwd, "src/config"), { recursive: true });
      await writeFile(
        path.join(cwd, "src/config/deploy-services.json"),
        `${JSON.stringify(sampleCatalog(), null, 2)}\n`
      );
    }
    await git(cwd, ["add", "."]);
    await git(cwd, ["commit", "-m", "Fixture baseline"]);
    repositories[role] = {
      cwd,
      base: await git(cwd, ["rev-parse", "HEAD"]),
      pulls: new Map()
    };
    profile.repositories[role] = {
      full_name: `6529-Collections/release-coordinator-test-${role}`,
      id: 100 + index,
      private: true,
      required_checks: ["Sandbox check"]
    };
  }
  async function branch(role, name, files, from = repositories[role].base) {
    const repo = repositories[role];
    await git(repo.cwd, ["checkout", "-b", name, from]);
    for (const [filename, value] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(repo.cwd, filename)), {
        recursive: true
      });
      await writeFile(path.join(repo.cwd, filename), value);
    }
    await git(repo.cwd, ["add", "."]);
    await git(repo.cwd, ["commit", "-m", `Fixture ${name}`]);
    const requested = {
      number: repo.pulls.size + 1,
      branch: name,
      commit: await git(repo.cwd, ["rev-parse", "HEAD"])
    };
    repo.pulls.set(requested.number, requested);
    return requested;
  }
  function manifest(parts, caseId = "MR-test") {
    return structuredClone({
      schema_version: "1",
      source: "test-manifest",
      profile: "sandbox",
      case_id: caseId,
      target: "staging",
      repositories: parts.map(({ role, pulls, ...other }) => ({
        role,
        destination: { branch: "main", commit: repositories[role].base },
        pull_requests: pulls,
        depends_on: [],
        ...(role === "backend"
          ? {
              deploy_units: ["api", "dbMigrationsLoop"],
              deploy_dependencies: []
            }
          : {}),
        ...other
      }))
    });
  }
  const github = {
    async destination(role, name) {
      return {
        repository: { ...profile.repositories[role] },
        branch: name,
        commit: await git(repositories[role].cwd, [
          "rev-parse",
          `refs/heads/${name}`
        ])
      };
    },
    async pullRequest(role, number) {
      const repo = repositories[role];
      const pr = repo.pulls.get(number);
      const identity = {
        nameWithOwner: profile.repositories[role].full_name,
        databaseId: profile.repositories[role].id,
        isPrivate: true
      };
      return {
        number,
        headRefName: pr.branch,
        headRefOid: pr.commit,
        baseRefName: "main",
        baseRefOid: repo.base,
        state: "OPEN",
        isDraft: false,
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        reviewDecision: "APPROVED",
        repository: identity,
        headRepository: { ...identity },
        checks: [
          {
            id: `check-${number}`,
            __typename: "CheckRun",
            name: "Sandbox check",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            isRequired: true
          }
        ]
      };
    }
  };
  const createGit = (options) =>
    createRehearsalGit({
      ...options,
      temporaryRoot: directory,
      fixtureRemotes: Object.fromEntries(
        Object.entries(repositories).map(([role, repo]) => [role, repo.cwd])
      )
    });
  const run = (input, options = {}) =>
    rehearseMerge(sandboxMergePlan(input, profile), {
      github,
      createGit,
      ...options
    });
  return {
    directory,
    repositories,
    profile,
    env,
    git,
    branch,
    manifest,
    github,
    createGit,
    run
  };
}
