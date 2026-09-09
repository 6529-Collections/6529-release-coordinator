import { createGitHubReader } from "./github-reader.mjs";
import { COORDINATOR_REPOSITORY, formatReport, readInbox } from "./inbox-reader.mjs";

const help = `Read the open Release Coordinator inbox without changing GitHub.

Usage: npm run inbox:read -- [--json] [--submitter LOGIN]

Requires Node.js 20+ and an authenticated, current GitHub CLI (gh).
  --json  Print the report as JSON.
  --submitter LOGIN  Filter by verified GitHub submitter, even if unassigned.
  --help  Show this help without contacting GitHub.

Exit codes: 0 = all saved records verified (or inbox empty),
            1 = invalid or unverified records, 2 = inbox read or usage failure.
No merge, deployment, labels, or other GitHub writes occur.
`;

export async function runCli(args, {
  get = createGitHubReader(),
  stdout = value => process.stdout.write(value),
  stderr = value => process.stderr.write(value)
} = {}) {
  if (args.length === 1 && args[0] === "--help") {
    stdout(help);
    return 0;
  }
  let json = false, submitter;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg) || !["--json", "--submitter"].includes(arg)) { stderr(help); return 2; }
    seen.add(arg);
    if (arg === "--json") json = true;
    else {
      submitter = args[++index];
      if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/u.test(submitter ?? "")) { stderr(help); return 2; }
    }
  }
  try {
    const report = await readInbox({ get });
    if (submitter) {
      report.submitter_filter = submitter;
      report.requests = report.requests.filter(entry => entry.github_actor?.login.toLowerCase() === submitter.toLowerCase());
      report.counts = { pending: report.requests.length, valid: report.requests.filter(entry => entry.status === "valid").length,
        invalid: report.requests.filter(entry => entry.status === "invalid").length, unverified: report.requests.filter(entry => entry.status === "unverified").length };
    }
    stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    return report.counts.invalid || report.counts.unverified ? 1 : 0;
  } catch (error) {
    const failure = {
      mode: "read-only",
      repository: COORDINATOR_REPOSITORY,
      error: `Inbox read failed; no complete report is available. ${error.message}`
    };
    if (json) stdout(`${JSON.stringify(failure, null, 2)}\n`);
    else stderr(`${failure.error}\n`);
    return 2;
  }
}
