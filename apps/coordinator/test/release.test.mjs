import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { processInbox } from "../src/inbox-processor.mjs";
import { coordinateInboxBatch } from "../src/inbox-batch.mjs";
import { executeRelease } from "../src/release-execution.mjs";
import {
  makeReleaseOperation,
  releaseProtocol,
  verifyReleaseReport
} from "../src/release-contract.mjs";
import { serviceHash } from "../src/service-contract.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import { harness } from "./inbox-batch-harness.mjs";

const runFile = promisify(execFile);

function report(record, status = "passed", runId = 100) {
  const value = {
    protocol: releaseProtocol,
    profile: "sandbox",
    release_id: record.operation.release_id,
    operation_id: record.operation.operation_id,
    operation_hash: record.operation.fingerprint,
    operation: record.operation.operation,
    environment: record.operation.environment,
    role: record.operation.role,
    unit: record.operation.unit,
    status,
    checks: [{ name: "fixture", status }],
    versions: {
      backend: record.operation.backend_commit,
      frontend: record.operation.frontend_commit
    },
    runner: {
      repository: sandboxProfile.repositories.backend.full_name,
      run_id: runId,
      attempt: 1,
      commit: record.operation.backend_commit
    },
    completed_at: new Date().toISOString()
  };
  verifyReleaseReport(value, record.operation);
  return value;
}

function client(calls, { failE2e = false } = {}) {
  let runId = 100;
  return {
    identity: async () => ({
      actor: { id: "456", login: "tester" },
      runtime: {
        backend: { workflow_id: 201 },
        frontend: { workflow_id: 202 }
      },
      versions: {
        staging: { backend: "b".repeat(40), frontend: "b".repeat(40) },
        prod: { backend: "b".repeat(40), frontend: "b".repeat(40) }
      }
    }),
    integrate: async ({ record, candidate }) => {
      calls.push(record.step.id);
      return {
        status: "passed",
        commit: candidate.commit,
        tree: candidate.tree,
        url: "https://example.invalid/integration"
      };
    },
    run: async ({ record }) => {
      calls.push(record.step.id);
      const status =
        failE2e && record.step.id === "staging:e2e" ? "failed" : "passed";
      const value = report(record, status, runId++);
      return {
        status,
        report: value,
        workflow: {
          id: value.runner.run_id,
          url: `https://example.invalid/release/${value.runner.run_id}`
        }
      };
    }
  };
}

async function selectedBatch() {
  const h = harness(1);
  await processInbox(h.options);
  const reference = Object.values(h.f.state().history.batches)[0];
  const batch = structuredClone(h.f.file(reference.path).record);
  delete batch.execution;
  return batch;
}

test("one release runs backend integration/services, frontend, then matching E2E", async () => {
  const batch = await selectedBatch();
  const calls = [];
  const saves = [];
  const execution = await executeRelease({
    batch,
    client: client(calls),
    guard: async () => {},
    save: async (message) => saves.push(message)
  });
  assert.equal(execution.status, "completed");
  assert.deepEqual(calls, [
    "staging:integrate:backend",
    "staging:deploy:backend:dbMigrationsLoop",
    "staging:deploy:backend:worker",
    "staging:deploy:backend:api",
    "staging:integrate:frontend",
    "staging:deploy:frontend:frontend",
    "staging:e2e"
  ]);
  assert.ok(saves.length > calls.length);
});

test("failed staging E2E stops a production request before prod", async () => {
  const batch = await selectedBatch();
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls, { failE2e: true }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(calls.at(-1), "staging:e2e");
  assert.equal(
    calls.some((value) => value.startsWith("prod:")),
    false
  );
});

test("a resumed completed release adds a complete batch ticket result", async () => {
  const batch = await selectedBatch();
  const deferredInput = structuredClone(batch.inputs[0]);
  deferredInput.number = 2;
  deferredInput.input.inbox.issue_number = 2;
  batch.inputs.push(deferredInput);
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  batch.execution = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  const item = {
    number: 1,
    decision: {
      status: "waiting",
      reasons: [
        {
          code: "coordinator-incomplete",
          message: "Waiting for release execution.",
          action: "Continue the Coordinator.",
          owner: "Coordinator"
        }
      ],
      next_action: "Continue the Coordinator.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const deferred = {
    number: 2,
    decision: structuredClone(item.decision)
  };
  const state = { batches: { [batch.fingerprint]: batch } };
  await coordinateInboxBatch({
    items: [item, deferred],
    state,
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    save: async () => {},
    loadBatch: async () => batch,
    release: async () => assert.fail("completed release must not run again")
  });
  assert.equal(item.decision.status, "completed");
  assert.equal(item.decision.batch.status, "passed");
  assert.equal(item.decision.batch.fingerprint, batch.fingerprint);
  assert.match(item.decision.reasons.at(-1).message, /passed staging/u);
  assert.equal(item.decision.batch.release.status, "completed");
  assert.equal(deferred.decision.status, "waiting");
  assert.equal(deferred.decision.batch.code, "batch-deferred");
});

test("release operation/report are exact and reject changed versions", () => {
  const operation = makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: "e2e",
    environment: "staging",
    backend_commit: "a".repeat(40),
    frontend_commit: "b".repeat(40)
  });
  const record = { operation };
  assert.equal(report(record).status, "passed");
  assert.throws(
    () =>
      verifyReleaseReport(
        {
          ...report(record),
          versions: { backend: "c".repeat(40), frontend: "b".repeat(40) }
        },
        operation
      ),
    /does not match/
  );
});

test("sandbox runner exercises the exact backend/frontend combination", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "release-runner-"));
  const files = sampleFiles();
  for (const role of ["backend", "frontend"])
    for (const [name, contents] of Object.entries(files[role])) {
      const location = path.join(directory, "candidates", role, name);
      await mkdir(path.dirname(location), { recursive: true });
      await writeFile(location, contents);
    }
  const operation = makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: "e2e",
    environment: "staging",
    backend_commit: "a".repeat(40),
    frontend_commit: "b".repeat(40)
  });
  const script = path.resolve("apps/coordinator/sandbox/release-run.mjs");
  const result = await runFile(process.execPath, [script], {
    cwd: directory,
    env: {
      ...process.env,
      OPERATION_ID: operation.operation_id,
      OPERATION_JSON: JSON.stringify(operation),
      GITHUB_REPOSITORY: sandboxProfile.repositories.backend.full_name,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: operation.backend_commit
    }
  });
  assert.match(result.stdout, /COORDINATOR_RELEASE_RESULT:/u);
});
