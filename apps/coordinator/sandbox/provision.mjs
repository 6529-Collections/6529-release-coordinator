// Explicit developer fixture setup, not an operator inbox or release command.
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sampleFiles } from "./fixtures.mjs";
import { executeGitHub } from "../src/coordinator-github.mjs";
import { sandboxProfile } from "../src/profiles.mjs";

if (
  process.argv.length !== 3 ||
  process.argv[2] !== "--prepare-service-sandbox"
)
  throw new Error(
    "Explicit --prepare-service-sandbox required; creates sample branches and PRs."
  );
const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = `${root}/.release-coordinator/service-development`;
await mkdir(output, { recursive: true });
const exec = promisify(execFile);
async function api(endpoint, method = "GET", body) {
  const args = [
    "api",
    "--hostname",
    "github.com",
    "--method",
    method,
    endpoint,
    "--include"
  ];
  if (body !== undefined) args.push("--input", "-");
  const raw = await executeGitHub(args, body);
  const match = raw.match(
    /^HTTP\/\S+ (\d{3})[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/u
  );
  if (!match || ![200, 201, 204].includes(Number(match[1])))
    throw new Error(
      `Fixture API ${method} ${endpoint} failed (HTTP ${match?.[1] ?? "unknown"}): ${match?.[2] ? JSON.parse(match[2]).message : "unreadable response"}`
    );
  return match[2].trim() ? JSON.parse(match[2]) : null;
}
const checks = `name: Sandbox checks
on:
  pull_request:
    branches: [main, rehearsal-target]
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
      - run: node scripts/check.mjs
`;
const dispatch = `name: Sandbox service checks
run-name: Sandbox services \${{ inputs.attempt_id }}
on:
  workflow_dispatch:
    inputs:
      attempt_id:
        required: true
        type: string
      plan_json:
        required: true
        type: string
permissions:
  contents: read
concurrency:
  group: sandbox-services-\${{ inputs.attempt_id }}
  cancel-in-progress: false
jobs:
  service-checks:
    name: Sandbox service checks
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Check out pinned runtime
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - name: Set up Node
        uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: 22
      - name: Run isolated sample
        env:
          PLAN_JSON: \${{ inputs.plan_json }}
          ATTEMPT_ID: \${{ inputs.attempt_id }}
        run: node coordinator/sandbox/run.mjs
`;
const bundle = {};
for (const name of [
  "src/service-contract.mjs",
  "src/service-runtime.mjs",
  "sandbox/fixtures.mjs",
  "sandbox/check.mjs",
  "sandbox/run.mjs"
])
  bundle[`coordinator/${name}`] = await readFile(
    `${root}/apps/coordinator/${name}`,
    "utf8"
  );
const record = { created_at: new Date().toISOString(), repositories: {} };
for (const role of ["frontend", "backend"]) {
  const identity = sandboxProfile.repositories[role],
    prefix = `repos/${identity.full_name}`;
  const repo = await api(prefix);
  if (
    repo.id !== identity.id ||
    repo.private !== false ||
    repo.permissions?.push !== true
  )
    throw new Error("Sample repository identity/access changed.");
  const base = await api(`${prefix}/git/ref/heads/main`);
  const files = {
    ...sampleFiles()[role],
    ...bundle,
    "README.md": `# Coordinator sample ${role}\n\nSmall executable programs and temporary MySQL checks for the sandbox only. No product credentials or deployments.\n\nThe coordinator directory is a generated, exact source bundle from the standalone Coordinator; edit the source project and republish the bundle, never maintain a second implementation.\n`,
    ".github/workflows/sandbox-check.yml": checks,
    "scripts/check.mjs": `import { checkSample } from '../coordinator/sandbox/check.mjs';\nawait checkSample('${role}');\n`,
    ...(role === "backend"
      ? { ".github/workflows/sandbox-service-check.yml": dispatch }
      : {})
  };
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
        { cwd: directory, maxBuffer: 4 * 1024 * 1024 }
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
    throw new Error("Sample main moved before fixture setup.");
  const branch = "codex/service-fixtures-v1";
  await git(["checkout", "-b", branch]);
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), contents);
  }
  await git(["add", "--", ...Object.keys(files)]);
  await git([
    "commit",
    "-m",
    "Add executable service and MySQL sandbox fixtures"
  ]);
  const head = await git(["rev-parse", "HEAD"]);
  await git(["push", "origin", branch]);
  const pr = await api(`${prefix}/pulls`, "POST", {
    head: branch,
    base: "main",
    title: "Add executable service and database sandbox checks",
    body: "Add small worker, API, and frontend fixtures with isolated temporary MySQL checks. The generated Coordinator runtime is shared with the local implementation. Required Sandbox check exercises application data/output; no product services or environments are accessed."
  });
  record.repositories[role] = {
    ...identity,
    base: base.object.sha,
    head,
    directory,
    pr: pr.number,
    url: pr.html_url
  };
  await writeFile(`${output}/provision.json`, JSON.stringify(record, null, 2));
  console.log(`${role}: ${pr.html_url}`);
}
