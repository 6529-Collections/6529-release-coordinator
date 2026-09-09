import { selectProfile } from "./profiles.mjs";
import { createCoordinatorGitHub } from "./coordinator-github.mjs";
import { createGitHubReader } from "./github-reader.mjs";
import { createReadinessGitHub } from "./readiness-github.mjs";
import { processInbox } from "./inbox-processor.mjs";

const help = `Organize release-request Issues and record decisions in GitHub.

Usage: npm run inbox:process -- [--issue NUMBER] [--close-test] [--json]
       npm run inbox:process -- --resume RUN_ID [--json]

Writes managed labels, titles, submitter assignment, one status comment, justified
Issue closures, and the codex/inbox-state journal branch. Runs once; no release.
Requires Node.js 20+ and gh authenticated as a repository writer.
  --issue NUMBER  Process only this Issue. Default: open requests plus known history.
  --close-test    Explicitly retire your own verified test; requires --issue.
  --resume ID     Resume the stored action and selection after an interrupted run.
                  Stop the original process and wait at least 60 seconds first.
                  Never resume while the original process may still be running.
  --json         Print structured results.
  --help         Show this help without contacting GitHub.

Exit codes: 0 = all selected presentations verified; 1 = unchanged unverified
closure needs investigation; 2 = invalid usage or interrupted/partial processing.
No merge, build, deployment, completion claim, or release authorization occurs.
`;

export async function runProcessingCli(args, { client, get, github, env = process.env, run = processInbox,
  stdout = value => process.stdout.write(value), stderr = value => process.stderr.write(value) } = {}) {
  if (args.length === 1 && args[0] === "--help") { stdout(help); return 0; }
  const options = {}, seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key) || !["--issue", "--close-test", "--resume", "--json"].includes(key)) { stderr(help); return 2; }
    seen.add(key);
    if (key === "--issue") {
      const value = args[++index];
      if (!/^[1-9][0-9]*$/u.test(value ?? "") || !Number.isSafeInteger(Number(value))) { stderr(help); return 2; }
      options.issueNumber = Number(value);
    } else if (key === "--resume") {
      options.resume = args[++index];
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(options.resume ?? "")) { stderr(help); return 2; }
    } else if (key === "--close-test") options.closeTest = true;
  }
  if (options.closeTest && !options.issueNumber || options.resume && (options.issueNumber || options.closeTest)) { stderr(help); return 2; }
  let profile;
  try {
    profile = selectProfile(env.RELEASE_COORDINATOR_PROFILE, { defaultReal: true });
    client ??= createCoordinatorGitHub({ profile }); get ??= createGitHubReader({ profile }); github ??= createReadinessGitHub({ profile });
    await get.identity?.();
    const report = await run({ ...options, profile, api: client.request, identity: client.identity, get, github });
    stdout(seen.has("--json") ? `${JSON.stringify(report, null, 2)}\n`
      : `Inbox processing ${report.run_id}; no release authorized.\n${report.requests.map(item =>
        `#${item.issue_number}: ${item.status}; ${item.applied ? "verified" : "left unchanged"}${item.reasons?.length ? `; ${item.reasons.join(", ")}` : ""}${item.assignment === "unavailable" ? "; submitter assignment unavailable; see status comment for lookup" : ""}`).join("\n")}\n`);
    return report.requests.some(item => !item.applied) ? 1 : 0;
  } catch (error) {
    const failure = { mode: "write", profile: profile?.name ?? null, repository: profile?.inbox.full_name ?? null, release_authorized: false, error: error.message };
    if (seen.has("--json")) stdout(`${JSON.stringify(failure, null, 2)}\n`); else stderr(`${failure.error}\n`);
    return 2;
  }
}
