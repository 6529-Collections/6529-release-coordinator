#!/usr/bin/env node
import { runInboxCleanupCli } from "../src/inbox-cleanup-cli.mjs";

const controller = new AbortController();
const stop = () => controller.abort();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  process.exitCode = await runInboxCleanupCli(process.argv.slice(2), {
    signal: controller.signal
  });
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
}
