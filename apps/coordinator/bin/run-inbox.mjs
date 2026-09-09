#!/usr/bin/env node
import { runInboxRunCli } from "../src/inbox-run-cli.mjs";

const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try { process.exitCode = await runInboxRunCli(process.argv.slice(2), { signal: controller.signal }); }
finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
