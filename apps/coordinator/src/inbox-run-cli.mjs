import { selectProfile } from "./profiles.mjs";
import { createCoordinatorGitHub } from "./coordinator-github.mjs";
import { createGitHubReader } from "./github-reader.mjs";
import { createReadinessGitHub } from "./readiness-github.mjs";
import { processInbox } from "./inbox-processor.mjs";
import { rehearseInboxTicket } from "./rehearsal-runner.mjs";
import { generateInboxPlan } from "./inbox-merge-plan.mjs";
import { coordinateServices } from "./inbox-services.mjs";
import { coordinateInboxBatch } from "./inbox-batch.mjs";

const help = `Check requests, filter conflicts before expensive batch checks, and update the same Issues and history.

RELEASE_COORDINATOR_PROFILE=sandbox|real npm run inbox:run -- [--issue NUMBER] [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real npm run inbox:run -- --issue NUMBER --close-test [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real npm run inbox:run -- --resume RUN_ID [--json]

Writes managed labels, titles, submitter assignment, one status comment, justified
Issue closures, and the selected inbox's codex/inbox-state journal branch. Runs once.
Requires Node.js 20+, Git 2.38+, and gh with inbox write and selected PR-repository read access.
Sandbox service checks also require gh 2.97.0+ and Actions write access to the pinned sample backend.
Unscoped sandbox runs also need contents/PR write access to both sample repositories:
they create and close owned temporary trial PRs, never merge them or change source PRs.
  --issue NUMBER  Process only this Issue. Default: open requests plus known history.
                  With --issue, retain the one-ticket service/database workflow.
                  Without --issue, sandbox batches whole supported staging tickets.
                  Uses ticket dependencies/order and the profile's current main commits.
                  Obvious blockers skip rehearsal; plans/reports cannot be imported.
  --close-test    Explicitly retire your own verified test; requires --issue.
  --resume ID     Resume the stored action and selection after an interrupted run.
                  Stop the original process and wait at least 60 seconds first.
                  Never resume while the original process may still be running.
  --json         Print structured results.
  --help         Show this help without contacting GitHub.

Exit codes: 0 = closed/preserved tickets or all selected tickets passed their required trial;
1 = blocked or waiting for initial evidence; 2 = usage, unknown rehearsal/planning,
unverified presentation, or interrupted/partial processing; 3 = stale rehearsal.
Sandbox batches finish cheap request, scope, database and combined Git checks before
opening temporary PRs for normal CI, then check combined services on GitHub Actions.
Limits: 10 tickets, 10 PRs/repository, 40 combined Git attempts, 12 candidate check rounds,
45 minutes to start new work. In-flight attempts must still reconcile and clean up.
Only confirmed code failures trigger bounded splitting; uncertainty keeps tickets waiting.
Real mode only rehearses Git. --issue still supports one-ticket database-change tests.
No product merge, deployment, or release authorization.
`;

export async function runInboxRunCli(
  args,
  {
    client,
    get,
    github,
    env = process.env,
    run = processInbox,
    plan = generateInboxPlan,
    rehearse = rehearseInboxTicket,
    services = coordinateServices,
    batch = coordinateInboxBatch,
    signal,
    stdout = (value) => process.stdout.write(value),
    stderr = (value) => process.stderr.write(value)
  } = {}
) {
  if (args.length === 1 && args[0] === "--help") {
    stdout(help);
    return 0;
  }
  const options = {},
    seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (
      seen.has(key) ||
      !["--issue", "--close-test", "--resume", "--json"].includes(key)
    ) {
      stderr(help);
      return 2;
    }
    seen.add(key);
    if (key === "--issue") {
      const value = args[++index];
      if (
        !/^[1-9][0-9]*$/u.test(value ?? "") ||
        !Number.isSafeInteger(Number(value))
      ) {
        stderr(help);
        return 2;
      }
      options.issueNumber = Number(value);
    } else if (key === "--resume") {
      options.resume = args[++index];
      if (
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(
          options.resume ?? ""
        )
      ) {
        stderr(help);
        return 2;
      }
    } else if (key === "--close-test") options.closeTest = true;
  }
  if (
    (options.closeTest && !options.issueNumber) ||
    (options.resume && (options.issueNumber || options.closeTest))
  ) {
    stderr(help);
    return 2;
  }
  let profile;
  try {
    profile = selectProfile(env.RELEASE_COORDINATOR_PROFILE);
    client ??= createCoordinatorGitHub({ profile });
    get ??= createGitHubReader({ profile });
    github ??= createReadinessGitHub({ profile });
    await get.identity?.();
    const report = await run({
      ...options,
      signal,
      profile,
      api: client.request,
      identity: client.identity,
      get,
      github,
      services,
      batch,
      plan: (entry) => plan(entry, { profile, signal }),
      rehearsal: (entry, plan) =>
        rehearse(entry, plan, { profile, get, signal })
    });
    stdout(
      seen.has("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : `Inbox run ${report.run_id}; no release authorized.\n${report.batch ? `Batch: ${report.batch.status}; selected tickets: ${report.batch.selected.map((number) => `#${number}`).join(", ") || "none"}.\n` : ""}${report.requests
            .map(
              (item) =>
                `#${item.issue_number}: ${item.status}; ${item.applied ? "verified" : "left unchanged"}; rehearsal ${item.rehearsal?.status ?? "not-run"}; services ${item.services?.status ?? "not-run"}${item.reasons?.length ? `; ${item.reasons.join(", ")}` : ""}${item.rehearsal?.report_file ? `\nReport: ${item.rehearsal.report_file}` : ""}${item.services?.report_file ? `\nService report: ${item.services.report_file}` : ""}${item.assignment === "unavailable" ? "; submitter assignment unavailable; see status comment for lookup" : ""}`
            )
            .join("\n")}\n`
    );
    if (
      report.requests.some(
        (item) =>
          !item.applied ||
          item.rehearsal?.status === "unknown" ||
          item.services?.status === "unknown" ||
          item.batch?.status === "unknown"
      )
    )
      return 2;
    if (
      report.requests.some(
        (item) =>
          item.rehearsal?.status === "stale" ||
          item.services?.status === "stale" ||
          item.batch?.status === "stale"
      )
    )
      return 3;
    return report.requests.some(
      (item) =>
        !["closed", "completed"].includes(item.status) &&
        (item.rehearsal?.status !== "passed" ||
          (item.batch && item.batch.status !== "passed") ||
          item.services?.status === "blocked")
    )
      ? 1
      : 0;
  } catch (error) {
    const failure = {
      mode: "write",
      profile: profile?.name ?? null,
      repository: profile?.inbox.full_name ?? null,
      release_authorized: false,
      error: error.message
    };
    if (seen.has("--json")) stdout(`${JSON.stringify(failure, null, 2)}\n`);
    else stderr(`${failure.error}\n`);
    return 2;
  }
}
