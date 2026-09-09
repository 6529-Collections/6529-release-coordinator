// Explicit fixture provisioning only; never imported by commands or tests.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sandboxProfile, realProfile } from "../src/profiles.mjs";

if (process.argv.length !== 5 || process.argv[2] !== "--seed-empty-inbox" || process.argv[3] !== "--coordinator-ref"
  || !/^[0-9a-f]{40}$/u.test(process.argv[4])) throw new Error("Usage: --seed-empty-inbox --coordinator-ref FULL_COMMIT. Creates fixture main and branch protection.");
const source = process.argv[4], inbox = sandboxProfile.inbox;
const exec = promisify(execFile);
const gh = async endpoint => JSON.parse((await exec("gh", ["api", "--hostname", "github.com", "--method", "GET", endpoint])).stdout);
const repo = await gh(`repos/${inbox.full_name}`);
if (repo.id !== inbox.id || repo.private !== inbox.private || repo.permissions?.admin !== true
  || (await gh(`repos/${inbox.full_name}/branches`)).length || repo.size !== 0) throw new Error("Refusing to seed a nonempty, unowned, or unexpected inbox.");
if ((await gh(`repos/${realProfile.inbox.full_name}/commits/${source}`)).sha !== source) throw new Error("Coordinator source commit is not available on GitHub.");
const workflow = `name: Submit release request
run-name: Release request \${{ inputs.request_id }}
on:
  workflow_dispatch:
    inputs:
      request_id:
        required: true
        type: string
      request_json:
        required: true
        type: string
permissions:
  contents: read
  issues: write
concurrency:
  group: release-request-inbox-\${{ inputs.request_id }}
  cancel-in-progress: false
jobs:
  validate-and-save:
    name: Validate and save request
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          repository: ${realProfile.inbox.full_name}
          ref: ${source}
          persist-credentials: false
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: 20
          cache: npm
      - run: npm ci --ignore-scripts
      - name: Validate and save the release request
        env:
          RELEASE_COORDINATOR_PROFILE: sandbox
          GH_TOKEN: \${{ github.token }}
          REQUEST_ID: \${{ inputs.request_id }}
          REQUEST_JSON: \${{ inputs.request_json }}
        run: node apps/coordinator/bin/save-inbox-request.mjs
`;
const directory = await mkdtemp(path.join(tmpdir(), "coordinator-test-inbox-"));
try {
  await mkdir(path.join(directory, ".github/workflows"), { recursive: true });
  await writeFile(path.join(directory, ".github/workflows/submit-release-request.yml"), workflow);
  await writeFile(path.join(directory, "README.md"), `# Coordinator test inbox\n\nPublic sample requests only. No release, deployment, or package publication.\n\nThe workflow runs the shared Coordinator implementation pinned at \`${source}\`.\nThe sandbox profile restricts requests to the two sample repositories.\nUpdate this pin through a reviewed PR when testing a new Coordinator version.\n`);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Coordinator sandbox", GIT_AUTHOR_EMAIL: "rehearsal@example.invalid",
    GIT_COMMITTER_NAME: "Coordinator sandbox", GIT_COMMITTER_EMAIL: "rehearsal@example.invalid" };
  const git = async args => (await exec("git", ["-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: directory, env })).stdout.trim();
  await git(["init", "-b", "main"]); await git(["add", "."]); await git(["commit", "-m", "Seed isolated inbox with pinned shared Coordinator intake"]);
  const commit = await git(["rev-parse", "HEAD"]);
  await git(["remote", "add", "origin", `git@github.com:${inbox.full_name}.git`]); await git(["push", "origin", "main"]);
  const bodyFile = path.join(directory, "protection.json");
  await writeFile(bodyFile, JSON.stringify({ required_status_checks: null, enforce_admins: true,
    required_pull_request_reviews: { required_approving_review_count: 0 }, restrictions: null,
    required_conversation_resolution: true, allow_force_pushes: false, allow_deletions: false }));
  await exec("gh", ["api", "--hostname", "github.com", "--method", "PUT", `repos/${inbox.full_name}/branches/main/protection`, "--input", bodyFile]);
  const protection = await gh(`repos/${inbox.full_name}/branches/main/protection`);
  if (!protection.enforce_admins?.enabled || protection.allow_force_pushes?.enabled !== false || protection.allow_deletions?.enabled !== false
    || !protection.required_pull_request_reviews || !protection.required_conversation_resolution?.enabled) throw new Error("Inbox main protection was not verified.");
  process.stdout.write(`${JSON.stringify({ inbox, main_commit: commit, coordinator_source: source, protection_verified: true }, null, 2)}\n`);
} finally { await rm(directory, { recursive: true, force: true }); }
