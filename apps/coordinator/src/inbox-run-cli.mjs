import { selectProfile } from "./profiles.mjs";
import { createCoordinatorGitHub } from "./coordinator-github.mjs";
import { createGitHubReader } from "./github-reader.mjs";
import { createReadinessGitHub } from "./readiness-github.mjs";
import { processInbox } from "./inbox-processor.mjs";
import { rehearseInboxTicket } from "./rehearsal-runner.mjs";
import { generateInboxPlan } from "./inbox-merge-plan.mjs";

const help = `Check requests, rehearse suitable tickets, and update the same Issues and history.

RELEASE_COORDINATOR_PROFILE=sandbox|real npm run inbox:run -- [--issue NUMBER] [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real npm run inbox:run -- --issue NUMBER --close-test [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real npm run inbox:run -- --resume RUN_ID [--json]

Writes managed labels, titles, submitter assignment, one status comment, justified
Issue closures, and the selected inbox's codex/inbox-state journal branch. Runs once.
Requires Node.js 20+, Git 2.38+, and gh with inbox write and selected PR-repository read access.
  --issue NUMBER  Process only this Issue. Default: open requests plus known history.
                  Each suitable ticket gets its own automatically saved merge plan.
                  Uses ticket dependencies/order and the profile's current main commits.
                  Obvious blockers skip rehearsal; plans/reports cannot be imported.
  --close-test    Explicitly retire your own verified test; requires --issue.
  --resume ID     Resume the stored action and selection after an interrupted run.
                  Stop the original process and wait at least 60 seconds first.
                  Never resume while the original process may still be running.
  --json         Print structured results.
  --help         Show this help without contacting GitHub.

Exit codes: 0 = closed/preserved tickets or a saved passing rehearsal;
1 = blocked or waiting for initial evidence; 2 = usage, unknown rehearsal/planning,
unverified presentation, or interrupted/partial processing; 3 = stale rehearsal.
Only temporary local Git merges occur. No product merge, build, deployment, or release authorization.
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
      plan: (entry) => plan(entry, { profile, signal }),
      rehearsal: (entry, plan) =>
        rehearse(entry, plan, { profile, get, signal })
    });
    stdout(
      seen.has("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : `Inbox run ${report.run_id}; no release authorized.\n${report.requests
            .map(
              (item) =>
                `#${item.issue_number}: ${item.status}; ${item.applied ? "verified" : "left unchanged"}; rehearsal ${item.rehearsal?.status ?? "not-run"}${item.reasons?.length ? `; ${item.reasons.join(", ")}` : ""}${item.rehearsal?.report_file ? `\nReport: ${item.rehearsal.report_file}` : ""}${item.assignment === "unavailable" ? "; submitter assignment unavailable; see status comment for lookup" : ""}`
            )
            .join("\n")}\n`
    );
    if (
      report.requests.some(
        (item) => !item.applied || item.rehearsal?.status === "unknown"
      )
    )
      return 2;
    if (report.requests.some((item) => item.rehearsal?.status === "stale"))
      return 3;
    return report.requests.some(
      (item) =>
        !["closed", "completed"].includes(item.status) &&
        item.rehearsal?.status !== "passed"
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
