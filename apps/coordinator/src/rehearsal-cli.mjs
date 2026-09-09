import { createGitHubReader } from "./github-reader.mjs";
import { createRehearsalGit } from "./rehearsal-git.mjs";
import { verifiedInboxEntry, inboxMergePlan, inboxBinding } from "./inbox-merge-plan.mjs";
import { open, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maxManifestBytes, selectRehearsalProfile, sandboxMergePlan, RehearsalError } from "./rehearsal-plan.mjs";
import { createRehearsalGitHub } from "./rehearsal-github.mjs";
import { rehearseMerge, rehearsalExitCode, formatRehearsal, safeRehearsalError } from "./rehearsal.mjs";
import { runRehearsalProcess } from "./rehearsal-process.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const help = `Rehearse exact PR commits from one verified inbox ticket or a sandbox manifest using temporary local Git repositories.

RELEASE_COORDINATOR_PROFILE=sandbox npm run merge:rehearse -- --manifest FILE [--json]

RELEASE_COORDINATOR_PROFILE=sandbox|real npm run merge:rehearse -- --issue NUMBER --plan FILE [--json]

Requires Node.js 20+, Git 2.38+, and authenticated gh with selected repository read access.
Real mode requires verified inbox input. Profile selection never enables a GitHub write or release.
Reports: .release-coordinator/merge-rehearsal/<profile>/<run-id>/report.json
Exit codes: 0 pass, 1 blocked, 2 unknown/usage/operational failure, 3 stale.
--help makes no repository reads or writes.
`;

export async function readRehearsalManifest(filename) {
  const handle = await open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxManifestBytes) throw new RehearsalError("invalid_manifest", "Manifest must be a regular file of at most 64 KiB.");
    const buffer = Buffer.alloc(maxManifestBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxManifestBytes) throw new RehearsalError("invalid_manifest", "Manifest exceeds 64 KiB.");
    try { return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")); }
    catch { throw new RehearsalError("invalid_manifest", "Manifest is not readable JSON."); }
  } finally { await handle.close(); }
}

export async function saveRehearsalReport(report, outputRoot = root) {
  if (!["sandbox", "real"].includes(report.profile) || !/^[0-9a-f-]{36}$/u.test(report.run_id)) throw new RehearsalError("invalid_report", "Report output identity is invalid.");
  let dir = outputRoot;
  for (const part of [".release-coordinator", "merge-rehearsal", report.profile]) {
    dir = path.join(dir, part);
    try { await mkdir(dir, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new RehearsalError("unsafe_report_path", "Report directory must be a local directory, not a symlink.");
  }
  dir = path.join(dir, report.run_id);
  await mkdir(dir, { mode: 0o700 }); // Unique run directory; never overwrite evidence.
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new RehearsalError("report_limit", "Rehearsal report exceeds its size limit.");
  await writeFile(path.join(dir, "report.json"), json, { flag: "wx", mode: 0o600 });
  await writeFile(path.join(dir, "report.txt"), formatRehearsal(report), { flag: "wx", mode: 0o600 });
  return path.join(dir, "report.json");
}

async function codeRevision() {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  const commit = (await runRehearsalProcess("git", ["rev-parse", "HEAD"], { cwd: root, env })).stdout.trim();
  const unstaged = await runRehearsalProcess("git", ["diff", "--quiet"], { cwd: root, env, allowedCodes: [0, 1] });
  const staged = await runRehearsalProcess("git", ["diff", "--cached", "--quiet"], { cwd: root, env, allowedCodes: [0, 1] });
  const added = await runRehearsalProcess("git", ["ls-files", "--others", "--exclude-standard", "--",
    "apps/coordinator/src", "apps/coordinator/bin", "packages/release-request/src", "packages/release-request/bin"], { cwd: root, env });
  return { commit, dirty: unstaged.code !== 0 || staged.code !== 0 || added.stdout.trim() !== "" };
}

export async function runRehearsalCli(args, {
  env = process.env, load = readRehearsalManifest, githubFactory = createRehearsalGitHub,
  run = rehearseMerge, save = saveRehearsalReport, revision = codeRevision, inboxReaderFactory = createGitHubReader,
  stdout = text => process.stdout.write(text), stderr = text => process.stderr.write(text),
  signal, timeout = 180_000
} = {}) {
  if (args.length === 1 && args[0] === "--help") { stdout(help); return 0; }
  const json = args.includes("--json");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeout);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const manifestMode = [2, 3].includes(args.length) && args[0] === "--manifest" && args[1] && !args[1].startsWith("--") && (args.length === 2 || args[2] === "--json");
    const inboxMode = [4, 5].includes(args.length) && args[0] === "--issue" && /^[1-9][0-9]*$/u.test(args[1]) && Number.isSafeInteger(Number(args[1]))
      && args[2] === "--plan" && args[3] && !args[3].startsWith("--") && (args.length === 4 || args[4] === "--json");
    if (!manifestMode && !inboxMode) throw new RehearsalError("usage", help);
    const profile = selectRehearsalProfile(env.RELEASE_COORDINATOR_PROFILE);
    if (manifestMode && profile.name !== "sandbox") throw new RehearsalError("sandbox_manifest_only", "Real rehearsals require a verified inbox ticket and an explicit inbox plan.");
    let plan, get;
    if (manifestMode) plan = sandboxMergePlan(await load(args[1]), profile);
    else {
      const input = await load(args[3]);
      // Reject crossed profiles before contacting any inbox.
      if (input?.profile !== profile.name || input?.source !== "inbox-plan" || input?.inbox?.repository_id !== profile.inbox.id
        || input.inbox.issue_number !== Number(args[1])) throw new RehearsalError("invalid_inbox_plan", "Inbox plan does not match the selected profile and ticket.");
      get = inboxReaderFactory({ profile });
      await get.identity?.();
      plan = inboxMergePlan(input, await verifiedInboxEntry(Number(args[1]), { get, profile }), profile);
    }
    const github = githubFactory(profile, { signal: controller.signal });
    const report = await run(plan, { github, signal: controller.signal, revision: await revision(),
      createGit: options => createRehearsalGit({ ...options, repositories: profile.repositories }) });
    if (inboxMode) {
      report.inbox = plan.inbox;
      try {
        await get.identity?.();
        const final = inboxBinding(await verifiedInboxEntry(Number(args[1]), { get, profile }), profile);
        report.inbox_final = final;
        const stable = JSON.stringify(final) === JSON.stringify(plan.inbox);
        report.checks.push({ id: "inbox_stability", status: stable ? "pass" : "stale", message: stable ? "The exact ticket receipt and workflow proof match the final read." : "Ticket receipt or workflow proof changed during rehearsal." });
        if (!stable && !report.operation_errors.length) report.status = "stale";
      } catch {
        report.checks.push({ id: "inbox_stability", status: "unknown", message: "The open verified ticket could not be confirmed again; no passing result is available." });
        report.status = "unknown";
      }
    }
    const filename = await save(report);
    stdout(json ? `${JSON.stringify({ ...report, report_file: filename }, null, 2)}\n` : `${formatRehearsal(report)}Report: ${filename}\n`);
    return rehearsalExitCode(report);
  } catch (error) {
    const problem = safeRehearsalError(error);
    const result = { status: "unknown", release_authorized: false, error: problem };
    if (json) stdout(`${JSON.stringify(result, null, 2)}\n`); else stderr(`${problem.message}\n`);
    return 2;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
