// Explicit developer fixture setup. It adds only sandbox workflows/programs;
// it is not reachable from the operator inbox command.
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeGitHub } from "../src/coordinator-github.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { writeFileAtomically } from "./atomic-file.mjs";
import { sampleFiles } from "./fixtures.mjs";
import { monitoringFiles } from "./monitoring-fixtures.mjs";
import { publishFixturePr } from "./fixture-pr.mjs";

if (
  process.argv.length !== 3 ||
  process.argv[2] !== "--prepare-release-sandbox"
)
  throw new Error(
    "Explicit --prepare-release-sandbox required; creates sandbox workflow PRs."
  );

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = `${root}/.release-coordinator/release-monitoring-v7`;
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
  if (!match)
    throw new Error(`Fixture API ${method} ${endpoint} was unreadable.`);
  if (!allowed.includes(Number(match[1]))) {
    let detail = "";
    try {
      const message = JSON.parse(match[2])?.message;
      if (typeof message === "string")
        detail = `: ${message.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 200)}`;
    } catch {
      // The HTTP status remains enough to resume safely after an empty response.
    }
    throw new Error(
      `Fixture API ${method} ${endpoint} returned HTTP ${match[1]}${detail}.`
    );
  }
  if (Number(match[1]) === 404) return null;
  return match[2].trim() ? JSON.parse(match[2]) : null;
}

const checkWorkflow = (role) => `name: Sandbox checks
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
      - name: Install locked package
        run: npm ci --ignore-scripts
      - name: Run application checks
        run: npm test
${
  role === "backend"
    ? `      - name: Check monitoring package
        if: hashFiles('ops/monitoring/package.json') != ''
        working-directory: ops/monitoring
        env:
          SANDBOX_SOURCE_COMMIT: \${{ github.sha }}
        run: |
          npm ci --ignore-scripts
          npm run build
`
    : ""
}      - name: Build application artifact
        env:
          SANDBOX_SOURCE_COMMIT: \${{ github.sha }}
        run: npm run build
      - name: Upload application artifact
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: sandbox-pr-\${{ github.event.pull_request.number }}-\${{ github.run_attempt }}-${role}
          path: dist
          if-no-files-found: error
          retention-days: 7
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
      - id: backend-build
        name: Build exact backend package
        if: fromJSON(inputs.operation_json).operation == 'e2e' || (fromJSON(inputs.operation_json).operation == 'deploy' && fromJSON(inputs.operation_json).role == 'backend')
        continue-on-error: true
        working-directory: candidates/backend
        env:
          SANDBOX_SOURCE_COMMIT: \${{ fromJSON(inputs.operation_json).backend_commit }}
        run: |
          npm ci --ignore-scripts
          npm run build
      - id: backend-artifact
        name: Upload exact backend package
        if: steps.backend-build.outcome == 'success'
        continue-on-error: true
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: sandbox-build-\${{ inputs.operation_id }}-backend
          path: candidates/backend/dist
          if-no-files-found: error
          retention-days: 7
      - id: frontend-build
        name: Build exact frontend package
        if: fromJSON(inputs.operation_json).operation == 'e2e' || (fromJSON(inputs.operation_json).operation == 'deploy' && fromJSON(inputs.operation_json).role == 'frontend')
        continue-on-error: true
        working-directory: candidates/frontend
        env:
          SANDBOX_SOURCE_COMMIT: \${{ fromJSON(inputs.operation_json).frontend_commit }}
        run: |
          npm ci --ignore-scripts
          npm run build
      - id: frontend-artifact
        name: Upload exact frontend package
        if: steps.frontend-build.outcome == 'success'
        continue-on-error: true
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: sandbox-build-\${{ inputs.operation_id }}-frontend
          path: candidates/frontend/dist
          if-no-files-found: error
          retention-days: 7
      - id: monitoring-build
        name: Build exact monitoring package
        if: fromJSON(inputs.operation_json).operation == 'monitoring'
        continue-on-error: true
        working-directory: candidates/backend/ops/monitoring
        env:
          SANDBOX_SOURCE_COMMIT: \${{ fromJSON(inputs.operation_json).backend_commit }}
        run: |
          npm ci --ignore-scripts
          npm run build
      - id: monitoring-artifact
        name: Upload exact monitoring package
        if: steps.monitoring-build.outcome == 'success'
        continue-on-error: true
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: sandbox-build-\${{ inputs.operation_id }}-monitoring
          path: candidates/backend/ops/monitoring/dist
          if-no-files-found: error
          retention-days: 7
      - name: Run sandbox release operation
        env:
          OPERATION_ID: \${{ inputs.operation_id }}
          OPERATION_JSON: \${{ inputs.operation_json }}
          BACKEND_BUILD_OUTCOME: \${{ steps.backend-build.outcome }}
          BACKEND_ARTIFACT_OUTCOME: \${{ steps.backend-artifact.outcome }}
          BACKEND_ARTIFACT_DIGEST: \${{ steps.backend-artifact.outputs.artifact-digest }}
          FRONTEND_BUILD_OUTCOME: \${{ steps.frontend-build.outcome }}
          FRONTEND_ARTIFACT_OUTCOME: \${{ steps.frontend-artifact.outcome }}
          FRONTEND_ARTIFACT_DIGEST: \${{ steps.frontend-artifact.outputs.artifact-digest }}
          MONITORING_BUILD_OUTCOME: \${{ steps.monitoring-build.outcome }}
          MONITORING_ARTIFACT_OUTCOME: \${{ steps.monitoring-artifact.outcome }}
          MONITORING_ARTIFACT_DIGEST: \${{ steps.monitoring-artifact.outputs.artifact-digest }}
        run: node coordinator/sandbox/release-run.mjs
`;

const bundle = {};
for (const name of [
  "src/release-contract.mjs",
  "sandbox/application-build.mjs",
  "sandbox/release-run.mjs"
])
  bundle[`coordinator/${name}`] = await readFile(
    `${root}/apps/coordinator/${name}`,
    "utf8"
  );

const monitoringPackageFiles = () => {
  const name = "release-coordinator-sandbox-monitoring";
  const build =
    "node ../../coordinator/sandbox/application-build.mjs monitoring";
  return {
    "ops/monitoring/package.json": `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: { build, generate: `${build} --generate` }
      },
      null,
      2
    )}\n`,
    "ops/monitoring/package-lock.json": `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name, version: "1.0.0" } }
      },
      null,
      2
    )}\n`,
    "ops/monitoring/README.md":
      "# Sample operational monitoring\n\nA separate sample package, like the real backend's ops/monitoring: hand-edited alarm sources in src/, a controlled deployment switch, and committed inventories generated from src/config/deploy-services.json. The build fails when a committed inventory is stale; run npm run generate after editing src/alarms.json. The sandbox release deploys it only from test main. No AWS account, credential or product monitoring is involved.\n",
    ...monitoringFiles()
  };
};

const packageFiles = (role) => {
  const name = `release-coordinator-sandbox-${role}`;
  const value = {
    name,
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      test: "node scripts/check.mjs",
      build: `node coordinator/sandbox/application-build.mjs ${role}`
    }
  };
  return {
    "package.json": `${JSON.stringify(value, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify(
      {
        name,
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name, version: "1.0.0" } }
      },
      null,
      2
    )}\n`
  };
};

let record;
try {
  record = JSON.parse(await readFile(provisionFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error("Saved release provisioning state is unreadable.", {
      cause: error
    });
  record = { created_at: new Date().toISOString(), targets: {} };
}
if (
  !record ||
  typeof record !== "object" ||
  Array.isArray(record) ||
  !record.targets ||
  typeof record.targets !== "object" ||
  Array.isArray(record.targets)
)
  throw new Error("Saved release provisioning state is invalid.");

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const setupBranch = "codex/sandbox-monitoring-runtime-v7-main";
const keyFor = (role, base) => `${role}:${base}`;
const branchRef = (repository, branch) =>
  api(
    `repos/${repository.full_name}/git/ref/heads/${branch}`,
    "GET",
    undefined,
    [200, 404]
  );
const pullRequests = (repository, branch, base) => {
  const owner = repository.full_name.split("/")[0];
  return api(
    `repos/${repository.full_name}/pulls?state=all&base=${base}&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`
  );
};
async function saveEntry(key, entry) {
  record.targets[key] = entry;
  await writeFileAtomically(provisionFile, JSON.stringify(record, null, 2));
}

for (const role of ["backend", "frontend"]) {
  const identity = sandboxProfile.repositories[role];
  const repository = await api(`repos/${identity.full_name}`);
  if (
    repository.id !== identity.id ||
    repository.private !== false ||
    repository.permissions?.push !== true
  )
    throw new Error("Sample repository identity/access changed.");
  // Publish the runtime to main only. After those PRs merge, main must be
  // merged into 1a-staging through a normal protected PR. Publishing matching
  // files as unrelated commits on both branches makes later release PRs
  // conflict even though their trees look similar.
  for (const baseBranch of ["main"]) {
    const key = keyFor(role, baseBranch);
    const branch = setupBranch;
    const base = await api(
      `repos/${identity.full_name}/git/ref/heads/${baseBranch}`
    );
    const saved = record.targets[key];
    if (saved) {
      if (
        saved.repository?.id !== identity.id ||
        saved.repository?.full_name !== identity.full_name ||
        saved.base_branch !== baseBranch ||
        saved.branch !== branch ||
        !sha(saved.base) ||
        !sha(saved.commit) ||
        base.object.sha !== saved.base
      )
        throw new Error(
          `Saved ${key} provisioning identity is invalid; inspect ${provisionFile}.`
        );
      const completed = await publishFixturePr(saved, {
        save: (entry) => saveEntry(key, entry),
        push: async (entry) => {
          const remote = await branchRef(entry.repository, entry.branch);
          if (remote?.object?.sha !== entry.commit)
            throw new Error(
              `Saved ${key} setup branch is missing or changed; inspect ${provisionFile}.`
            );
        },
        find: (entry) =>
          pullRequests(entry.repository, entry.branch, entry.base_branch),
        create: (entry) =>
          api(`repos/${entry.repository.full_name}/pulls`, "POST", {
            title: "Deploy sample operational monitoring in sandbox releases",
            head: entry.branch,
            base: entry.base_branch,
            body: "Add the sample ops/monitoring package, build it on every backend PR check, and let the pinned sandbox release workflow build and install it as a monitoring operation dispatched only from test main. This uses only test repositories and GitHub-hosted runners; no product monitoring, AWS account or credential is involved."
          })
      });
      console.log(`${key}: ${completed.url}`);
      continue;
    }
    const existingRef = await branchRef(identity, branch);
    const existingPulls = await pullRequests(identity, branch, baseBranch);
    if (!Array.isArray(existingPulls))
      throw new Error(`The ${key} setup PR list is unreadable.`);
    if (existingRef || existingPulls.length)
      throw new Error(
        `Unsaved ${key} setup resources already exist; inspect them before retrying.`
      );
    const directory = await mkdtemp(
      path.join(output, `${role}-${baseBranch}-`)
    );
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
      baseBranch,
      `git@github.com:${identity.full_name}.git`,
      "."
    ]);
    if ((await git(["rev-parse", "HEAD"])) !== base.object.sha)
      throw new Error("Sample branch moved before release fixture setup.");
    await git(["checkout", "-b", branch]);
    const files = {
      ...bundle,
      ...packageFiles(role),
      ".github/workflows/sandbox-check.yml": checkWorkflow(role),
      ".github/workflows/sandbox-release.yml": releaseWorkflow,
      "README.md": `# Coordinator sample ${role}\n\nSmall executable programs, locked npm builds, short-lived GitHub Actions artifacts and temporary test services for the sandbox only. No product credentials, environments or deployments are used.\n\nThe coordinator directory is generated from the standalone Coordinator; edit the source project and republish the bundle instead of maintaining a second implementation.\n`,
      ...(role === "backend"
        ? {
            "src/config/deploy-services.json":
              sampleFiles().backend["src/config/deploy-services.json"],
            ...monitoringPackageFiles()
          }
        : {})
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, file)), {
        recursive: true
      });
      await writeFile(path.join(directory, file), contents);
    }
    await git(["add", "--", ...Object.keys(files)]);
    await git(["commit", "-m", "Deploy sample operational monitoring"]);
    const commit = await git(["rev-parse", "HEAD"]);
    const completed = await publishFixturePr(
      {
        repository: identity,
        base: base.object.sha,
        base_branch: baseBranch,
        branch,
        commit,
        directory
      },
      {
        save: (entry) => saveEntry(key, entry),
        push: (entry) => git(["push", "origin", entry.branch]),
        find: (entry) =>
          pullRequests(entry.repository, entry.branch, entry.base_branch),
        create: (entry) =>
          api(`repos/${entry.repository.full_name}/pulls`, "POST", {
            title: "Deploy sample operational monitoring in sandbox releases",
            head: entry.branch,
            base: entry.base_branch,
            body: "Add the sample ops/monitoring package, build it on every backend PR check, and let the pinned sandbox release workflow build and install it as a monitoring operation dispatched only from test main. This uses only test repositories and GitHub-hosted runners; no product monitoring, AWS account or credential is involved."
          })
      }
    );
    console.log(`${key}: ${completed.url}`);
  }
}

console.log(
  "After both main PRs merge, merge each repository's current main into protected 1a-staging before running a sandbox release."
);
