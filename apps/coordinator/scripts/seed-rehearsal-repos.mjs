// Explicit setup only. Never imported by the rehearsal or run by npm test.
// Seeds pinned, empty sandbox repositories; reruns refuse nonempty repositories.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sandboxRepositories } from "../src/rehearsal-plan.mjs";

const resume = process.argv[2] === "--resume-recorded-sandbox-setup";
if (process.argv.length !== 3 || (!resume && process.argv[2] !== "--seed-empty-sandbox-repos")) throw new Error("Explicit --seed-empty-sandbox-repos or --resume-recorded-sandbox-setup is required. This creates test branches and PRs.");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = path.join(root, ".release-coordinator", "rehearsal-setup-20260909");
await mkdir(directory, { recursive: true });
const exec = promisify(execFile);
async function gh(endpoint, method = "GET", body) {
  const args = ["api", "--hostname", "github.com", "--method", method, endpoint];
  if (body !== undefined) {
    const filename = path.join(directory, "api-body.json");
    await writeFile(filename, `${JSON.stringify(body, null, 2)}\n`);
    args.push("--input", filename);
  }
  return JSON.parse((await exec("gh", args, { maxBuffer: 4 * 1024 * 1024 })).stdout);
}
const workflow = `name: Sandbox checks
on:
  pull_request:
    branches: [main, rehearsal-target]
permissions:
  contents: read
jobs:
  check:
    name: Sandbox check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: 20
      - run: node scripts/check.mjs
`;
const catalog = () => ({ services: [
  { name: "api", allowed_environments: ["staging", "prod"], default_dependencies: ["dbMigrationsLoop"] },
  { name: "dbMigrationsLoop", allowed_environments: ["staging"], default_dependencies: [] }
] });
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const seed = resume ? JSON.parse(await readFile(path.join(directory, "seed.json"), "utf8"))
  : { version: 1, created_at: new Date().toISOString(), repositories: {} };
const roles = [];
for (const [role, identity] of Object.entries(sandboxRepositories)) {
  const remote = await gh(`repos/${identity.full_name}`);
  if (remote.id !== identity.id || remote.private !== identity.private || remote.permissions?.admin !== true) throw new Error(`Refusing to seed ${role}: identity, visibility, or admin access does not match the pinned repository.`);
  const branches = await gh(`repos/${identity.full_name}/branches`);
  const prior = seed.repositories[role];
  if (prior) {
    if (!resume || prior.id !== identity.id || prior.full_name !== identity.full_name
      || branches.find(b => b.name === "main")?.commit.sha !== prior.base
      || branches.find(b => b.name === "rehearsal-target")?.commit.sha !== prior.target) throw new Error(`Refusing to resume ${role}: recorded baseline identity changed.`);
  } else if (branches.length || remote.size !== 0) throw new Error(`Refusing to overwrite existing ${role} branches.`);
  roles.push({ role, identity });
}
for (const { role, identity } of roles) {
  const cwd = path.join(directory, role);
  const prior = seed.repositories[role];
  if (!prior) await mkdir(cwd);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Coordinator sandbox", GIT_AUTHOR_EMAIL: "rehearsal@example.invalid",
    GIT_COMMITTER_NAME: "Coordinator sandbox", GIT_COMMITTER_EMAIL: "rehearsal@example.invalid" };
  async function git(args) { return (await exec("git", ["-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
  async function files(values) {
    for (const [name, text] of Object.entries(values)) {
      const filename = path.join(cwd, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, text);
    }
  }
  let base;
  if (prior) {
    base = prior.base;
    if (await git(["rev-parse", "refs/heads/main"]) !== base || await git(["rev-parse", "refs/heads/rehearsal-target"]) !== prior.target) throw new Error("Local seed branches differ from recorded fixture evidence.");
    seed.repositories[role] = { ...prior, ...identity };
  } else {
  await git(["init", "-b", "main"]);
  await files({ "README.md": `# Coordinator test ${role}\n\nSample code for merge rehearsals. No deployments or real release requests.\n`,
    "shared.txt": "original\n", ".github/workflows/sandbox-check.yml": workflow,
    "scripts/check.mjs": 'import { existsSync } from "node:fs";\nif (existsSync("FAIL_CHECK")) throw new Error("Deliberate sandbox CI failure");\nconsole.log("Sandbox sample check passed");\n',
    ...(role === "backend" ? { "src/config/deploy-services.json": json(catalog()) } : {}) });
  await git(["add", "."]); await git(["commit", "-m", "Seed isolated Coordinator rehearsal fixtures"]);
  base = await git(["rev-parse", "HEAD"]);
  await git(["remote", "add", "origin", `git@github.com:${identity.full_name}.git`]);
  await git(["push", "origin", "main"]);
  await gh(`repos/${identity.full_name}`, "PATCH", { default_branch: "main" });
  await git(["checkout", "-b", "rehearsal-target", base]);
  await files({ "shared.txt": "destination change\n" }); await git(["add", "."]);
  await git(["commit", "-m", "Create alternative test destination"]); const target = await git(["rev-parse", "HEAD"]);
  await git(["push", "origin", "rehearsal-target"]);
  seed.repositories[role] = { ...identity, base, target, pulls: {} };
  await writeFile(path.join(directory, "seed.json"), json(seed));
  }
  const protection = {
    required_status_checks: { strict: false, checks: [{ context: "Sandbox check", app_id: 15368 }] },
    enforce_admins: true, required_pull_request_reviews: { required_approving_review_count: 0 }, restrictions: null,
    required_conversation_resolution: true, allow_force_pushes: false, allow_deletions: false
  };
  for (const branch of ["main", "rehearsal-target"]) {
    let status;
    try {
      const value = await gh(`repos/${identity.full_name}/branches/${branch}/protection`, "PUT", protection);
      if (!value.enforce_admins?.enabled || value.allow_force_pushes?.enabled !== false
        || !value.required_status_checks?.checks?.some(check => check.context === "Sandbox check" && check.app_id === 15368)) throw new Error("Required sandbox protections were not confirmed.");
      status = { status: "enforced", checked_at: new Date().toISOString() };
    } catch (error) {
      let response;
      try { response = JSON.parse(error.stdout); } catch { throw error; }
      if (response.status !== "403" || !response.message?.includes("Upgrade to GitHub Pro or make this repository public")) throw error;
      status = { status: "unavailable", message: response.message, checked_at: new Date().toISOString() };
      process.stdout.write(`${role}/${branch}: required-check protection unavailable on current private-repository plan.\n`);
    }
    seed.repositories[role].protection ??= {};
    seed.repositories[role].protection[branch] = status;
    await writeFile(path.join(directory, "seed.json"), json(seed));
  }
  const a = catalog(); a.services[0].name = "api-v2";
  const b = catalog(); b.services[1].allowed_environments.push("prod");
  const scenarios = role === "frontend" ? [
    ["clean-a", { "alpha.txt": "first compatible change\n" }],
    ["clean-b", { "beta.txt": "second compatible change\n" }],
    ["conflict-a", { "shared.txt": "first PR change\n" }],
    ["conflict-b", { "shared.txt": "second PR change\n" }],
    ["ci-failure", { "FAIL_CHECK": "deliberately fail the required check\n" }],
    ["draft", { "draft.txt": "draft sample\n" }, "draft"],
    ["closed", { "closed.txt": "closed sample\n" }, "closed"],
    ["outdated", { "outdated.txt": "original request version\n" }]
  ] : [
    ["catalog-a", { "src/config/deploy-services.json": json(a) }],
    ["catalog-b", { "src/config/deploy-services.json": json(b) }],
    ["conflict-a", { "shared.txt": "backend first PR\n" }],
    ["conflict-b", { "shared.txt": "backend second PR\n" }]
  ];
  for (const [name, values, state] of scenarios) {
    const saved = seed.repositories[role].pulls[name];
    if (saved) {
      const existing = await gh(`repos/${identity.full_name}/pulls/${saved.number}`);
      if (existing.head.sha !== (saved.current_commit ?? saved.commit) || existing.head.ref !== saved.branch) throw new Error("Existing fixture PR differs from the saved seed.");
      continue;
    }
    const branch = `codex/rehearsal-${name}`;
    await git(["checkout", "-b", branch, base]); await files(values);
    await git(["add", "."]); await git(["commit", "-m", `Sandbox scenario: ${name}`]);
    const commit = await git(["rev-parse", "HEAD"]); await git(["push", "origin", branch]);
    const pr = await gh(`repos/${identity.full_name}/pulls`, "POST", {
      title: `Sandbox: ${name}`, head: branch, base: "main", draft: state === "draft",
      body: `Controlled fake-code PR for Release Coordinator merge-rehearsal testing.\n\nScenario: ${name}. This repository has no deployment or publication workflow. The rehearsal only reads this PR and merges exact commits in a temporary local repository.\n\nRetain this PR and its branch as test evidence; do not merge it.`
    });
    seed.repositories[role].pulls[name] = { number: pr.number, branch, commit, url: pr.html_url };
    await writeFile(path.join(directory, "seed.json"), json(seed));
    if (state === "closed") await gh(`repos/${identity.full_name}/pulls/${pr.number}`, "PATCH", { state: "closed" });
    process.stdout.write(`${role} ${name}: ${pr.html_url}\n`);
  }
}
process.stdout.write(`Seed evidence: ${path.join(directory, "seed.json")}\n`);
