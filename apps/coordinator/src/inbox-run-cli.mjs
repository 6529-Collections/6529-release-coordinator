import { createRunLog, loggedStep } from "./run-log.mjs";
import { selectProfile } from "./profiles.mjs";
import { createCoordinatorGitHub } from "./coordinator-github.mjs";
import { createGitHubReader } from "./github-reader.mjs";
import { createReadinessGitHub } from "./readiness-github.mjs";
import { processInbox } from "./inbox-processor.mjs";
import { rehearseInboxTicket } from "./rehearsal-runner.mjs";
import { generateInboxPlan } from "./inbox-merge-plan.mjs";
import { coordinateServices } from "./inbox-services.mjs";
import { coordinateInboxBatch } from "./inbox-batch.mjs";
import { executeRelease } from "./release-execution.mjs";
import {
  createProfileReleaseGitHub,
  selectReleaseAdapter
} from "./sandbox-release-client.mjs";
import { selectInboxScope } from "./inbox-selection.mjs";

const help = `Check requests, filter conflicts before expensive batch checks, and update the same Issues and history.

RELEASE_COORDINATOR_PROFILE=sandbox|real RELEASE_COORDINATOR_SCOPE=inbox npm run inbox:run -- [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real RELEASE_COORDINATOR_SCOPE=filtered npm run inbox:run -- --issue NUMBER [--issue NUMBER...] --actor LOGIN [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real RELEASE_COORDINATOR_SCOPE=filtered npm run inbox:run -- --issue NUMBER --actor LOGIN --close-test [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real RELEASE_COORDINATOR_SCOPE=inbox|filtered npm run inbox:run -- --resume RUN_ID [--json]
RELEASE_COORDINATOR_PROFILE=real RELEASE_COORDINATOR_SCOPE=filtered npm run inbox:run -- --resume RUN_ID --retry-checks ATTEMPT_ID [--json]
RELEASE_COORDINATOR_PROFILE=real RELEASE_COORDINATOR_SCOPE=filtered npm run inbox:run -- --resume RUN_ID --refresh-untouched-release RELEASE_ID [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real RELEASE_COORDINATOR_SCOPE=inbox|filtered npm run inbox:run -- --resume RUN_ID --staging-change retest|restore [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real RELEASE_COORDINATOR_SCOPE=inbox|filtered npm run inbox:run -- --resume RUN_ID --review-stop [--json]
RELEASE_COORDINATOR_PROFILE=sandbox|real RELEASE_COORDINATOR_SCOPE=inbox|filtered npm run inbox:run -- --resume RUN_ID --cancel-keep-current [--json]

Writes managed labels, titles, submitter assignment, one status comment, justified
Issue closures, and the selected inbox's codex/inbox-state journal branch. Runs once.
Requires Node.js 20+, Git 2.38+, and gh with inbox write and selected PR-repository read access.
Sandbox service checks also require gh 2.97.0+ and Actions write access to the pinned sample backend.
Batch runs need Actions and contents/PR write access to the selected profile repositories.
They close temporary trial PRs, then merge the selected exact candidate through protected
staging PRs. Production-target releases continue to protected main only after matching
staging E2E passes. In real profile these are real product changes and deployments.
  --issue NUMBER  In filtered scope, expose this Issue to normal processing. Repeat for more Issues.
  --actor LOGIN   In filtered scope, require every exposed Issue's verified actor to match.
                  Inbox scope accepts neither filter and exposes the full inbox.
                  Normal batching, database isolation, target ordering and release rules then apply.
                  Uses ticket dependencies/order and the profile's current main commits.
                  Obvious blockers skip rehearsal; plans/reports cannot be imported.
  --close-test    Explicitly retire your own verified test; requires --issue.
  --resume ID     Resume the stored action and selection after an interrupted run.
                  Stop the original process and wait at least 60 seconds first.
                  Never resume while the original process may still be running.
  --staging-change retest|restore
                  For a saved staging E2E drift only: explicitly retest the
                  new backend/frontend pair, or restore only this release's
                  frontend staging change. Requires --resume and an exact,
                  unchanged no-database-change frontend-only reconciliation.
  --retry-checks ID
                 Explicitly start fresh checks after a settled frontend CI failure,
                 not reuse a diagnostic rerun. Requires --resume of the owner's
                 one-ticket filtered real run, verified owned cleanup and no release.
                 Keeps the original failure and existing spent attempt budgets.
  --refresh-untouched-release ID
                 Explicitly supersede the named untouched first staging step,
                 after verifying absent owned resources, old cleanup and fresh
                 source gates on changed main. Requires the owner's same real,
                 filtered frontend-only no-database-change production run.
                 Preserves old execution/checks and all spent budgets; rebuilds
                 and retests the same request before ordinary release gates.
                 Never use before stopping the original process and settling calls.
  --review-stop  For a run awaiting integration PR review only: explicitly
                 close its owned PR, then apply ordinary release recovery.
                 Requires --resume; never discards an uncertain PR or branch.
  --cancel-keep-current
                 Cancel a no-database-change attempt paused at its owned PR,
                 its interrupted review stop, or an interrupted first staging
                 checkpoint with no other release operation. Also supports a
                 frontend-only first deployment after its staging merge, only
                 when that exact run finished successfully and owned cleanup
                 is verified. Preserve original deployment records; do not
                 restore, merge, deploy or cancel a GitHub workflow.
                 Requires --resume; closes selected tickets as not planned,
                 not as a completed release. Other production work refuses cancellation.
  --json         Print structured results; live progress goes to stderr.
                 Per-run logs are saved under ~/.6529-release-coordinator/logs/.
  --help         Show this help without contacting GitHub.

Exit codes: 0 = closed/preserved tickets or all selected tickets passed their required trial;
1 = blocked or waiting for initial evidence; 2 = usage, unknown rehearsal/planning,
unverified presentation, or interrupted/partial processing; 3 = stale rehearsal.
Both profiles finish cheap request, scope, database and combined Git checks before
opening temporary PRs for their normal CI. Sandbox also checks combined sample services.
The selected batch goes backend -> frontend -> matching E2E in its staging environment.
A production-target batch repeats that sequence on its main branches only after staging passes.
Limits: 10 tickets, 10 PRs/repository, 40 combined Git attempts, 12 candidate check rounds,
with no elapsed-time cutoff. In-flight attempts must still reconcile and clean up.
Only confirmed code failures trigger bounded splitting; uncertainty keeps tickets waiting.
The profile selects test or product repositories and workflows. The scope only filters which
verified inbox tickets are visible; normal release rules then run inside that selected set.
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
    executeReleaseSequence = executeRelease,
    createReleaseClient = createProfileReleaseGitHub,
    signal,
    logRoot,
    createLog = createRunLog,
    stdout = (value) => process.stdout.write(value),
    stderr = (value) => process.stderr.write(value)
  } = {}
) {
  if (args.length === 1 && args[0] === "--help") {
    stdout(help);
    return 0;
  }
  const options = { issueNumbers: [] },
    seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (
      (key !== "--issue" && seen.has(key)) ||
      ![
        "--issue",
        "--actor",
        "--close-test",
        "--resume",
        "--retry-checks",
        "--refresh-untouched-release",
        "--staging-change",
        "--review-stop",
        "--cancel-keep-current",
        "--json"
      ].includes(key)
    ) {
      stderr(help);
      return 2;
    }
    if (key !== "--issue") seen.add(key);
    if (key === "--issue") {
      const value = args[++index];
      if (
        !/^[1-9][0-9]*$/u.test(value ?? "") ||
        !Number.isSafeInteger(Number(value))
      ) {
        stderr(help);
        return 2;
      }
      const number = Number(value);
      if (options.issueNumbers.includes(number)) {
        stderr(help);
        return 2;
      }
      options.issueNumbers.push(number);
    } else if (key === "--actor") {
      options.actorLogin = args[++index];
      if (
        !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/u.test(
          options.actorLogin ?? ""
        )
      ) {
        stderr(help);
        return 2;
      }
    } else if (
      ["--resume", "--retry-checks", "--refresh-untouched-release"].includes(
        key
      )
    ) {
      const name =
        key === "--resume"
          ? "resume"
          : key === "--retry-checks"
            ? "retryChecks"
            : "refreshUntouched";
      options[name] = args[++index];
      if (
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(
          options[name] ?? ""
        )
      ) {
        stderr(help);
        return 2;
      }
    } else if (key === "--staging-change") {
      options.stagingChange = args[++index];
      if (!["retest", "restore"].includes(options.stagingChange)) {
        stderr(help);
        return 2;
      }
    } else if (key === "--review-stop") options.reviewStop = true;
    else if (key === "--cancel-keep-current") options.cancelKeepCurrent = true;
    else if (key === "--close-test") options.closeTest = true;
  }
  if (
    (options.closeTest && options.issueNumbers.length !== 1) ||
    (options.retryChecks &&
      (!options.resume ||
        options.refreshUntouched ||
        options.stagingChange ||
        options.reviewStop ||
        options.cancelKeepCurrent)) ||
    (options.refreshUntouched &&
      (!options.resume ||
        options.retryChecks ||
        options.stagingChange ||
        options.reviewStop ||
        options.cancelKeepCurrent)) ||
    (options.stagingChange && !options.resume) ||
    (options.reviewStop && (!options.resume || options.stagingChange)) ||
    (options.cancelKeepCurrent &&
      (!options.resume || options.reviewStop || options.stagingChange)) ||
    (options.resume &&
      (options.issueNumbers.length || options.actorLogin || options.closeTest))
  ) {
    stderr(help);
    return 2;
  }
  let profile, selectionMode, log;
  try {
    profile = selectProfile(env.RELEASE_COORDINATOR_PROFILE);
    selectionMode = selectInboxScope(env.RELEASE_COORDINATOR_SCOPE);
    if (
      (options.retryChecks || options.refreshUntouched) &&
      (profile.name !== "real" || selectionMode !== "filtered")
    )
      throw new Error(
        "Check retry or untouched refresh requires the real profile and filtered scope."
      );
    if (!options.resume) {
      if (
        (selectionMode === "filtered" &&
          (!options.issueNumbers.length || !options.actorLogin)) ||
        (selectionMode === "inbox" &&
          (options.issueNumbers.length ||
            options.actorLogin ||
            options.closeTest))
      )
        throw new Error(
          selectionMode === "filtered"
            ? "Filtered scope requires at least one --issue and one --actor."
            : "Inbox scope cannot be combined with Issue or actor filters."
        );
    }
    const releaseAdapter = selectReleaseAdapter(
      profile,
      env.RELEASE_COORDINATOR_SANDBOX_RELEASE_ADAPTER
    );
    log = createLog({
      profile,
      resume: options.resume,
      root: logRoot,
      stderr,
      env
    });
    if (!log.snapshot().complete)
      throw new Error(
        "Run log could not be initialized; no inbox work started."
      );
    return await log.run(async () => {
      client ??= createCoordinatorGitHub({ profile });
      get ??= createGitHubReader({ profile });
      github ??= createReadinessGitHub({ profile });
      let releaseClient;
      await loggedStep(
        { step: "inbox.identity", message: "Verify the selected inbox." },
        () => get.identity?.()
      );
      const report = await run({
        ...options,
        selectionMode,
        signal,
        profile,
        releaseAdapter,
        api: client.request,
        identity: client.identity,
        get,
        github,
        services,
        batch,
        verifyUntouched: (batch) => {
          releaseClient ??= createReleaseClient({
            profile,
            signal,
            adapter: releaseAdapter
          });
          return releaseClient.verifyUntouchedRelease({ batch });
        },
        release: (options) => {
          releaseClient ??= createReleaseClient({
            profile,
            signal,
            adapter: releaseAdapter
          });
          return executeReleaseSequence({
            ...options,
            client: releaseClient
          });
        },
        plan: (entry) => plan(entry, { profile, signal }),
        rehearsal: (entry, plan) =>
          rehearse(entry, plan, { profile, get, signal })
      });
      const exitCode = inboxRunExitCode(report);
      report.logging = log.finish({
        exitCode,
        remaining: report.requests
          .filter(
            (item) =>
              !item.applied ||
              item.status === "action-needed" ||
              item.batch?.status === "waiting" ||
              ["unknown", "stale", "blocked"].includes(item.services?.status) ||
              ["unknown", "stale", "blocked"].includes(item.rehearsal?.status)
          )
          .map((item) => `Ticket #${item.issue_number}: ${item.status}`)
      });
      log.close();
      report.logging = log.snapshot();
      stdout(
        seen.has("--json")
          ? `${JSON.stringify(report, null, 2)}\n`
          : `Inbox run ${report.run_id}; profile ${profile.name}.\n${report.batch ? `Batch: ${report.batch.status}; selected tickets: ${report.batch.selected.map((number) => `#${number}`).join(", ") || "none"}.\n` : ""}${report.requests
              .map(
                (item) =>
                  `#${item.issue_number}: ${item.status}; ${item.applied ? "verified" : "left unchanged"}; rehearsal ${item.rehearsal?.status ?? "not-run"}; services ${item.services?.status ?? "not-run"}${item.reasons?.length ? `; ${item.reasons.join(", ")}` : ""}${item.rehearsal?.report_file ? `\nReport: ${item.rehearsal.report_file}` : ""}${item.services?.report_file ? `\nService report: ${item.services.report_file}` : ""}${item.assignment === "unavailable" ? "; submitter assignment unavailable; see status comment for lookup" : ""}`
              )
              .join("\n")}\n`
      );
      return log.snapshot().complete ? exitCode : 2;
    });
  } catch (error) {
    const logging = log?.finish({
      exitCode: 2,
      interrupted: signal?.aborted,
      remaining: [
        "Processing may be partial; inspect the journal and recorded attempts."
      ],
      recovery: log.snapshot().run_id
        ? `Stop the original process, settle in-flight requests and inspect the journal. Use --resume ${log.snapshot().run_id} only if that run still holds the lock.`
        : "Inspect the inbox lock before retrying; acquisition may be uncertain."
    });
    log?.close();
    const failure = {
      mode: "write",
      profile: profile?.name ?? null,
      scope: selectionMode ?? null,
      repository: profile?.inbox.full_name ?? null,
      release_authorized: false,
      error: log ? log.redact(error.message) : error.message,
      ...(logging ? { logging: log.snapshot() } : {})
    };
    if (seen.has("--json")) stdout(`${JSON.stringify(failure, null, 2)}\n`);
    else stderr(`${failure.error}\n`);
    return 2;
  }
}

export function inboxRunExitCode(report) {
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
        (item.batch?.release && item.batch.release.status !== "completed") ||
        item.services?.status === "blocked")
  )
    ? 1
    : 0;
}
