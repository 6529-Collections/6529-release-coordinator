#!/usr/bin/env node
import { runRehearsalCli } from "../src/rehearsal-cli.mjs";

const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try { process.exitCode = await runRehearsalCli(process.argv.slice(2), { signal: controller.signal }); }
finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
