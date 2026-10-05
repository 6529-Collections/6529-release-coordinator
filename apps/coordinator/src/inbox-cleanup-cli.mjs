import { cleanupInbox } from "./inbox-cleanup.mjs";
import { selectProfile } from "./profiles.mjs";
import { selectInboxScope, createInboxSelection } from "./inbox-selection.mjs";

const help = `Check and clean up release tickets without releasing code.
RELEASE_COORDINATOR_PROFILE=real|sandbox RELEASE_COORDINATOR_SCOPE=inbox npm run inbox:cleanup -- [--json]
RELEASE_COORDINATOR_PROFILE=real|sandbox RELEASE_COORDINATOR_SCOPE=filtered npm run inbox:cleanup -- --issue NUMBER [--issue NUMBER...] --actor LOGIN [--json]
RELEASE_COORDINATOR_PROFILE=real|sandbox RELEASE_COORDINATOR_SCOPE=inbox|filtered npm run inbox:cleanup -- --resume RUN_ID [--json]
Updates GitHub tickets and the existing journal. Outputs only Action needed or Closed decisions.
Preserves closed tickets and active releases. Never merges, deploys, rehearses, or dispatches workflows.
--resume is only for the same interrupted cleanup, after its previous process has stopped.
`;

export async function runInboxCleanupCli(
  args,
  {
    env = process.env,
    stdout = (value) => process.stdout.write(value),
    stderr = (value) => process.stderr.write(value),
    run = cleanupInbox,
    signal,
    ...dependencies
  } = {}
) {
  if (args.length === 1 && args[0] === "--help") {
    stdout(help);
    return 0;
  }
  const options = { issueNumbers: [] };
  const seen = new Set();
  try {
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (
        !["--issue", "--actor", "--resume", "--json"].includes(key) ||
        (key !== "--issue" && seen.has(key))
      )
        throw new Error(help);
      seen.add(key);
      if (key === "--issue") {
        const value = args[++i];
        if (
          !/^[1-9][0-9]*$/u.test(value ?? "") ||
          !Number.isSafeInteger(Number(value))
        )
          throw new Error(help);
        options.issueNumbers.push(Number(value));
      } else if (key === "--actor") {
        options.actorLogin = args[++i];
        if (!options.actorLogin) throw new Error(help);
      } else if (key === "--resume") {
        options.resume = args[++i];
        if (
          !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(
            options.resume ?? ""
          )
        )
          throw new Error(help);
      }
    }
    const profile = selectProfile(env.RELEASE_COORDINATOR_PROFILE);
    const selectionMode = selectInboxScope(env.RELEASE_COORDINATOR_SCOPE);
    if (options.resume) {
      if (options.issueNumbers.length || options.actorLogin !== undefined)
        throw new Error(help);
    } else
      createInboxSelection(
        selectionMode,
        options.issueNumbers,
        options.actorLogin
      );
    const report = await run({
      ...dependencies,
      ...options,
      profile,
      selectionMode,
      signal
    });
    stdout(
      seen.has("--json")
        ? `${JSON.stringify(report)}\n`
        : `Cleanup ${report.run_id}: ${report.counts.closed} closed; ${report.counts.action_needed} need action; ${report.counts.unchanged} unchanged.\n${report.requests.map((item) => `#${item.issue_number}: ${item.unchanged ? "unchanged" : item.status}${item.message ? `; ${item.message}` : ""}`).join("\n")}\n`
    );
    return 0;
  } catch (error) {
    const failure = {
      mode: "cleanup",
      release_executed: false,
      error: error.message,
      run_id: error.cleanupRunId ?? null
    };
    if (seen.has("--json")) stdout(`${JSON.stringify(failure)}\n`);
    else stderr(`${error.message}\n`);
    return 2;
  }
}
