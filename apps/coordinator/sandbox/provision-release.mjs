// Explicit developer fixture setup. It adds only sandbox workflows/programs;
// it is not reachable from the operator inbox command.
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeGitHub } from "../src/coordinator-github.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { sampleFiles } from "./fixtures.mjs";
import { publishFixturePr } from "./fixture-pr.mjs";

if (
  process.argv.length !== 3 ||
  process.argv[2] !== "--prepare-release-sandbox"
)
  throw new Error(
    "Explicit --prepare-release-sandbox required; creates sandbox workflow PRs."
  );

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = `${root}/.release-coordinator/release-development`;
await mkdir(output, { recursive: true });
const provisionFile = `${output}/provision.json`;
const exec = promisify(execFile);
async function api(endpoint, method = "GET", body, allowed = [200, 201, 204]) {
  const args = [
    "api",
    "--hostname",
    "github.com",
    "--method",
    method,
    endpoint,
    "--include",
    "--header",
    "Accept: application/vnd.github+json",
    "--header",
    "X-GitHub-Api-Version: 2022-11-28"
  ];
  if (body !== undefined) args.push("--input", "-");
  const raw = await executeGitHub(args, body);
  const match = raw.match(
    /^HTTP\/\S+ (\d{3})[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/u
  );
  if (!match || !allowed.includes(Number(match[1])))
    throw new Error(`Fixture API ${method} ${endpoint} failed.`);
  if (Number(match[1]) === 404) return null;
  return match[2].trim() ? JSON.parse(match[2]) : null;
}

const checkWorkflow = `name: Sandbox checks
on:
  pull_request:
    branches: [main, 1a-staging, rehearsal-target]
permissions:
  contents: read
jobs:
  check:
    name: Sandbox check
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: 22
      - name: Run node scripts/check.mjs
        run: node scripts/check.mjs
`;

const releaseWorkflow = `name: Sandbox release
run-name: Sandbox release \${{ inputs.operation_id }}
on:
  workflow_dispatch:
    inputs:
      operation_id:
        required: true
        type: string
      operation_json:
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: sandbox-release-\${{ inputs.operation_id }}
  cancel-in-progress: false
jobs:
  release:
    name: Sandbox release
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out pinned runtime
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - name: Check out exact backend
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          repository: 6529-Collections/release-coordinator-test-backend
          ref: \${{ fromJSON(inputs.operation_json).backend_commit }}
          path: candidates/backend
          persist-credentials: false
      - name: Check out exact frontend
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          repository: 6529-Collections/release-coordinator-test-frontend
          ref: \${{ fromJSON(inputs.operation_json).frontend_commit }}
          path: candidates/frontend
          persist-credentials: false
      - name: Set up Node
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: 22
      - name: Run sandbox release operation
        env:
          OPERATION_ID: \${{ inputs.operation_id }}
          OPERATION_JSON: \${{ inputs.operation_json }}
        run: node coordinator/sandbox/release-run.mjs
`;

const bundle = {};
for (const name of ["src/release-contract.mjs", "sandbox/release-run.mjs"])
  bundle[`coordinator/${name}`] = await readFile(
    `${root}/apps/coordinator/${name}`,
    "utf8"
  );

let record;
try {
  record = JSON.parse(await readFile(provisionFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error("Saved release provisioning state is unreadable.", {
      cause: error
    });
  record = { created_at: new Date().toISOString(), repositories: {} };
}
if (
  !record ||
  typeof record !== "object" ||
  Array.isArray(record) ||
  !record.repositories ||
  typeof record.repositories !== "object" ||
  Array.isArray(record.repositories)
)
  throw new Error("Saved release provisioning state is invalid.");

const runtimeBranch = "codex/sandbox-release-runtime-v1";
const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const savedEntry = (role, repository) => {
  const saved = record.repositories[role];
  if (!saved) return null;
  const entry = {
    repository: {
      id: saved.repository?.id ?? saved.id,
      full_name: saved.repository?.full_name ?? saved.full_name
    },
    base: saved.base,
    branch: saved.branch ?? runtimeBranch,
    commit: saved.commit ?? saved.head,
    directory: saved.directory,
    ...(saved.number || saved.pr
      ? { number: saved.number ?? saved.pr, url: saved.url }
      : {})
  };
  if (
    entry.repository.id !== repository.id ||
    entry.repository.full_name !== repository.full_name ||
    entry.branch !== runtimeBranch ||
    !sha(entry.base) ||
    !sha(entry.commit)
  )
    throw new Error(
      `Saved ${role} release provisioning identity is invalid; inspect ${provisionFile}.`
    );
  return entry;
};
async function saveEntry(role, entry) {
  record.repositories[role] = {
    ...entry.repository,
    base: entry.base,
    branch: entry.branch,
    commit: entry.commit,
    head: entry.commit,
    directory: entry.directory,
    ...(entry.number ? { number: entry.number, pr: entry.number } : {}),
    ...(entry.url ? { url: entry.url } : {})
  };
  await writeFile(provisionFile, JSON.stringify(record, null, 2));
}
const pullRequests = (repository, branch) => {
  const owner = repository.full_name.split("/")[0];
  return api(
    `repos/${repository.full_name}/pulls?state=all&base=main&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`
  );
};
const branchRef = (repository, branch) =>
  api(
    `repos/${repository.full_name}/git/ref/heads/${branch}`,
    "GET",
    undefined,
    [200, 404]
  );

for (const role of ["backend", "frontend"]) {
  const identity = sandboxProfile.repositories[role];
  const repo = await api(`repos/${identity.full_name}`);
  if (
    repo.id !== identity.id ||
    repo.private !== false ||
    repo.permissions?.push !== true
  )
    throw new Error("Sample repository identity/access changed.");
  const base = await api(`repos/${identity.full_name}/git/ref/heads/main`);
  const saved = savedEntry(role, identity);
  if (saved) {
    if (base.object.sha !== saved.base)
      throw new Error(
        `Saved ${role} setup uses an older main commit; inspect ${provisionFile} before retrying.`
      );
    const completed = await publishFixturePr(saved, {
      save: (entry) => saveEntry(role, entry),
      push: async (entry) => {
        const remote = await branchRef(entry.repository, entry.branch);
        if (remote?.object?.sha !== entry.commit)
          throw new Error(
            `Saved ${role} setup branch is missing or changed; inspect ${provisionFile}.`
          );
      },
      find: (entry) => pullRequests(entry.repository, entry.branch),
      create: (entry) =>
        api(`repos/${entry.repository.full_name}/pulls`, "POST", {
          title: "Add sandbox release sequence runtime",
          head: entry.branch,
          base: "main",
          body: "Add the generated sandbox-only deployment/E2E runner and make Sandbox check cover staging integration PRs. No product repository, secret, environment, or deployment is used."
        })
    });
    console.log(`${role}: ${completed.url}`);
    continue;
  }
  const existingRef = await branchRef(identity, runtimeBranch);
  const existingPulls = await pullRequests(identity, runtimeBranch);
  if (!Array.isArray(existingPulls))
    throw new Error(`The ${role} setup PR list is unreadable.`);
  if (existingRef || existingPulls.length)
    throw new Error(
      `Unsaved ${role} setup resources already exist; inspect them before retrying and do not create replacements.`
    );
  const directory = await mkdtemp(path.join(output, `${role}-`));
  const git = async (args) =>
    (
      await exec(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgSign=false",
          "-c",
          "user.name=Coordinator sandbox",
          "-c",
          "user.email=rehearsal@example.invalid",
          ...args
        ],
        {
          cwd: directory,
          maxBuffer: 4 * 1024 * 1024,
          timeout: 60_000
        }
      )
    ).stdout.trim();
  await git([
    "clone",
    "--single-branch",
    "--branch",
    "main",
    `git@github.com:${identity.full_name}.git`,
    "."
  ]);
  if ((await git(["rev-parse", "HEAD"])) !== base.object.sha)
    throw new Error("Sample main moved before release fixture setup.");
  await git(["checkout", "-b", runtimeBranch]);
  const files = {
    ...bundle,
    ".github/workflows/sandbox-check.yml": checkWorkflow,
    ".github/workflows/sandbox-release.yml": releaseWorkflow,
    ...(role === "backend"
      ? {
          "src/config/deploy-services.json":
            sampleFiles().backend["src/config/deploy-services.json"]
        }
      : {})
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), contents);
  }
  await git(["add", "--", ...Object.keys(files)]);
  await git(["commit", "-m", "Add sandbox release sequence runtime"]);
  const head = await git(["rev-parse", "HEAD"]);
  const completed = await publishFixturePr(
    {
      repository: identity,
      base: base.object.sha,
      branch: runtimeBranch,
      commit: head,
      directory
    },
    {
      save: (entry) => saveEntry(role, entry),
      push: (entry) => git(["push", "origin", entry.branch]),
      find: (entry) => pullRequests(entry.repository, entry.branch),
      create: (entry) =>
        api(`repos/${entry.repository.full_name}/pulls`, "POST", {
          title: "Add sandbox release sequence runtime",
          head: entry.branch,
          base: "main",
          body: "Add the generated sandbox-only deployment/E2E runner and make Sandbox check cover staging integration PRs. No product repository, secret, environment, or deployment is used."
        })
    }
  );
  console.log(`${role}: ${completed.url}`);
}
