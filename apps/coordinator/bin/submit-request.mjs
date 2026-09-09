import { runSubmissionCli } from "../src/submission-cli.mjs";
process.exitCode = await runSubmissionCli(process.argv.slice(2));
