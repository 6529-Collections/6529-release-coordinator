import { createGitHubReader } from "./github-reader.mjs";
import { COORDINATOR_REPOSITORY, formatReport, readInbox } from "./inbox-reader.mjs";

const help = `Read the pending Release Coordinator inbox without changing GitHub.

Usage: npm run inbox:read -- [--json]

Requires Node.js 20+ and an authenticated, current GitHub CLI (gh).
  --json  Print the report as JSON.
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
  if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
    stderr(help);
    return 2;
  }
  const json = args[0] === "--json";
  try {
    const report = await readInbox({ get });
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
