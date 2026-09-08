import { createGitHubReader } from "./github-reader.mjs";
import { createReadinessGitHub } from "./readiness-github.mjs";
import { checkReadiness, formatReadiness } from "./readiness.mjs";

const help = `Inspect pending release requests and current GitHub evidence without changing GitHub.

Usage: npm run readiness:check -- [--json]

Requires Node.js 20+ and a current, authenticated GitHub CLI (gh).
  --json  Print JSON (use npm run --silent to suppress npm's banner).
  --help  Show help without contacting GitHub.

Exit codes: 0 = inbox empty, 1 = blocked or unknown readiness,
            2 = inbox read or usage failure.
No request can be authorized by this command. Release history and exact
execution-merge proof are not available yet. No merge, deploy, or GitHub write.
`;

export async function runReadinessCli(args, {
  get = createGitHubReader(), github = createReadinessGitHub(),
  stdout = value => process.stdout.write(value), stderr = value => process.stderr.write(value)
} = {}) {
  if (args.length === 1 && args[0] === "--help") { stdout(help); return 0; }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) { stderr(help); return 2; }
  const json = args[0] === "--json";
  try {
    const report = await checkReadiness({ get, github });
    stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatReadiness(report));
    return report.counts.pending ? 1 : 0;
  } catch {
    const error = "Inbox read failed; no complete readiness report is available. Check GitHub read access and network availability.";
    if (json) stdout(`${JSON.stringify({ mode: "read-only", release_authorized: false, error }, null, 2)}\n`);
    else stderr(`${error}\n`);
    return 2;
  }
}
