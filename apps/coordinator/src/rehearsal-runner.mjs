import { createGitHubReader } from "./github-reader.mjs";
import { createRehearsalGit } from "./rehearsal-git.mjs";
import {
  verifiedInboxEntry,
  inboxMergePlan,
  inboxBinding
} from "./inbox-merge-plan.mjs";
import { open, mkdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  maxManifestBytes,
  selectRehearsalProfile,
  sandboxMergePlan,
  RehearsalError
} from "./rehearsal-plan.mjs";
import { createRehearsalGitHub } from "./rehearsal-github.mjs";
import {
  rehearseMerge,
  rehearsalExitCode,
  formatRehearsal,
  safeRehearsalError
} from "./rehearsal.mjs";
import { runRehearsalProcess } from "./rehearsal-process.mjs";
import { captureServiceSource } from "./service-plan.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export async function readRehearsalManifest(filename) {
  const handle = await open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxManifestBytes)
      throw new RehearsalError(
        "invalid_manifest",
        "Manifest must be a regular file of at most 64 KiB."
      );
    const buffer = Buffer.alloc(maxManifestBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxManifestBytes)
      throw new RehearsalError("invalid_manifest", "Manifest exceeds 64 KiB.");
    try {
      return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    } catch {
      throw new RehearsalError(
        "invalid_manifest",
        "Manifest is not readable JSON."
      );
    }
  } finally {
    await handle.close();
  }
}

export async function saveRehearsalReport(report, outputRoot = root) {
  if (
    !["sandbox", "real"].includes(report.profile) ||
    !/^[0-9a-f-]{36}$/u.test(report.run_id)
  )
    throw new RehearsalError(
      "invalid_report",
      "Report output identity is invalid."
    );
  let dir = outputRoot;
  for (const part of [
    ".release-coordinator",
    "merge-rehearsal",
    report.profile
  ]) {
    dir = path.join(dir, part);
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = await lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new RehearsalError(
        "unsafe_report_path",
        "Report directory must be a local directory, not a symlink."
      );
  }
  dir = path.join(dir, report.run_id);
  await mkdir(dir, { mode: 0o700 }); // Unique run directory; never overwrite evidence.
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(json) > 16 * 1024 * 1024)
    throw new RehearsalError(
      "report_limit",
      "Rehearsal report exceeds its size limit."
    );
  await writeFile(path.join(dir, "report.json"), json, {
    flag: "wx",
    mode: 0o600
  });
  await writeFile(path.join(dir, "report.txt"), formatRehearsal(report), {
    flag: "wx",
    mode: 0o600
  });
  return path.join(dir, "report.json");
}

export async function codeRevision() {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null"
  };
  const commit = (
    await runRehearsalProcess("git", ["rev-parse", "HEAD"], { cwd: root, env })
  ).stdout.trim();
  const unstaged = await runRehearsalProcess("git", ["diff", "--quiet"], {
    cwd: root,
    env,
    allowedCodes: [0, 1]
  });
  const staged = await runRehearsalProcess(
    "git",
    ["diff", "--cached", "--quiet"],
    { cwd: root, env, allowedCodes: [0, 1] }
  );
  const added = await runRehearsalProcess(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "--",
      "apps/coordinator/src",
      "apps/coordinator/bin",
      "packages/release-request/src",
      "packages/release-request/bin"
    ],
    { cwd: root, env }
  );
  return {
    commit,
    dirty:
      unstaged.code !== 0 || staged.code !== 0 || added.stdout.trim() !== ""
  };
}

export async function runMergePlan(
  plan,
  {
    profile,
    get,
    githubFactory = createRehearsalGitHub,
    run = rehearseMerge,
    save = saveRehearsalReport,
    revision = codeRevision,
    signal,
    captureRepository,
    timeout = 180_000
  } = {}
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeout);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const github = githubFactory(profile, { signal: controller.signal });
    const report = await run(plan, {
      github,
      signal: controller.signal,
      captureRepository,
      revision: await revision(),
      createGit: (options) =>
        createRehearsalGit({ ...options, repositories: profile.repositories })
    });
    if (plan.inbox) {
      report.inbox = plan.inbox;
      try {
        await get.identity?.();
        const final = inboxBinding(
          await verifiedInboxEntry(plan.inbox.issue_number, { get, profile }),
          profile
        );
        report.inbox_final = final;
        const stable = JSON.stringify(final) === JSON.stringify(plan.inbox);
        report.checks.push({
          id: "inbox_stability",
          status: stable ? "pass" : "stale",
          message: stable
            ? "The exact ticket receipt and workflow proof match the final read."
            : "Ticket receipt or workflow proof changed during rehearsal."
        });
        if (!stable && !report.operation_errors.length) report.status = "stale";
      } catch {
        report.checks.push({
          id: "inbox_stability",
          status: "unknown",
          message:
            "The open verified ticket could not be confirmed again; no passing result is available."
        });
        report.status = "unknown";
      }
    }
    return { ...report, report_file: await save(report) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function rehearseInboxTicket(
  entry,
  input,
  { profile, get = createGitHubReader({ profile }), ...options }
) {
  await get.identity?.();
  const fresh = await verifiedInboxEntry(entry.issue_number, { get, profile });
  if (
    JSON.stringify(inboxBinding(fresh, profile)) !==
    JSON.stringify(inboxBinding(entry, profile))
  ) {
    throw new RehearsalError(
      "changed_receipt",
      "Ticket proof changed before rehearsal; inspect it again."
    );
  }
  const plan = inboxMergePlan(input, fresh, profile);
  return runMergePlan(plan, {
    ...options,
    profile,
    get,
    ...(profile.name === "sandbox"
      ? { captureRepository: captureServiceSource }
      : {})
  });
}

// Developer fixture harness only: no ticket input or Issue-writing mode.
export async function runRehearsalFixture(
  args,
  {
    env = process.env,
    load = readRehearsalManifest,
    stdout = (text) => process.stdout.write(text),
    ...options
  } = {}
) {
  if (args.length === 1 && args[0] === "--help") {
    stdout("Sandbox fixture harness: --manifest FILE [--json]\n");
    return 0;
  }
  try {
    if (
      ![2, 3].includes(args.length) ||
      args[0] !== "--manifest" ||
      !args[1] ||
      args[1].startsWith("--") ||
      (args.length === 3 && args[2] !== "--json")
    )
      throw new RehearsalError(
        "usage",
        "Fixture harness requires --manifest FILE [--json]."
      );
    const profile = selectRehearsalProfile(env.RELEASE_COORDINATOR_PROFILE);
    if (profile.name !== "sandbox")
      throw new RehearsalError(
        "sandbox_manifest_only",
        "Fixture harness only accepts sandbox manifests."
      );
    const report = await runMergePlan(
      sandboxMergePlan(await load(args[1]), profile),
      { ...options, profile }
    );
    stdout(
      args.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatRehearsal(report)
    );
    return rehearsalExitCode(report);
  } catch (error) {
    stdout(
      `${JSON.stringify({ status: "unknown", release_authorized: false, error: safeRehearsalError(error) })}\n`
    );
    return 2;
  }
}
