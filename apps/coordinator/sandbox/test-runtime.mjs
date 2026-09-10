// Explicit Docker acceptance runner; deliberately outside the offline PR suite.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import {
  sampleFiles,
  databaseCandidate,
  fixtureServicePlan
} from "./fixtures.mjs";
import { runDockerServicePlan } from "../src/service-runtime.mjs";
import { verifyServiceReport } from "../src/service-contract.mjs";

if (process.argv[2] !== "--run-owned-containers" || process.argv.length !== 3)
  throw new Error(
    "Explicit --run-owned-containers required; creates and removes isolated test containers."
  );
const output = ".release-coordinator/service-development/runtime-cases";
await mkdir(output, { recursive: true });
const partial = databaseCandidate();
partial.backend["src/data/change.json"] = JSON.stringify({
  id: "partial-upgrade",
  increment: 5,
  fail_after_schema: true
});
const api = databaseCandidate();
api.backend["src/api.mjs"] =
  "export function run() { throw new Error('controlled failure'); }\n";
const mismatch = sampleFiles();
mismatch.frontend["src/render.mjs"] =
  "export function run() { return 'Wrong value'; }\n";
const timeout = sampleFiles();
timeout.backend["src/worker.mjs"] =
  "export async function run() { await new Promise(r => setTimeout(r, 60000)); }\n";
const isolation = sampleFiles();
isolation.backend["src/worker.mjs"] =
  `import { access, writeFile } from 'node:fs/promises';
export async function run({row}) {
  for (const key of Object.keys(process.env)) if (/TOKEN|SECRET|GITHUB|DOCKER|DATABASE/.test(key)) throw new Error('credential environment exposed');
  for (const path of ['/var/run/docker.sock', '/github/workspace', '/app/plan.json']) {
    let found = false; try { await access(path); found = true; } catch {}
    if (found) throw new Error('unexpected mount');
  }
  let writable = false; try { await writeFile('/app/program.mjs', 'bad'); writable = true; } catch {}
  if (writable) throw new Error('candidate mount writable');
  let reachable = false; try { await fetch('https://api.github.com', { signal: AbortSignal.timeout(1000) }); reachable = true; } catch {}
  if (reachable) throw new Error('outbound network reachable');
  return {id: row.id, value: row.value * 2};
}\n`;
for (const [name, files, expected, failed] of [
  ["no-change", sampleFiles(), "passed"],
  ["upgrade", databaseCandidate(), "passed"],
  ["partial-database", partial, "blocked", "dbMigrationsLoop"],
  ["api-failure", api, "blocked", "api"],
  ["frontend-mismatch", mismatch, "blocked", "frontend"],
  ["timeout", timeout, "unknown", "worker"],
  ["isolation", isolation, "passed"]
]) {
  const plan = fixtureServicePlan(files),
    attemptId = randomUUID();
  const filename = `${output}/${name}.json`;
  const report = await runDockerServicePlan(plan, {
    attemptId,
    save: (report) =>
      writeFile(filename, JSON.stringify({ plan, report }, null, 2) + "\n")
  });
  verifyServiceReport(report, plan, attemptId);
  assert.equal(report.status, expected, JSON.stringify(report.errors));
  assert.equal(report.cleanup.status, "removed");
  if (failed) {
    const index = report.steps.findIndex((step) => step.unit === failed);
    assert.equal(report.steps[index].status, expected);
    assert.ok(
      report.steps.slice(index + 1).every((step) => step.status === "not-run")
    );
  }
  if (name === "partial-database")
    assert.deepEqual(report.database_state.row, {
      id: 1,
      value: 10,
      display_value: null
    });
  if (name === "upgrade") {
    assert.equal(report.steps[0].result.repeat, "already-applied");
    assert.deepEqual(report.database_state.row, {
      id: 1,
      value: 30,
      display_value: 30
    });
  }
  console.log(`${name}: ${report.status}; cleanup ${report.cleanup.status}`);
}
