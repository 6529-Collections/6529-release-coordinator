import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { processInbox } from "../src/inbox-processor.mjs";
import { prepareRunTickets } from "../src/inbox-preparation.mjs";
import { receiptHash } from "../src/inbox-journal.mjs";
import { coordinateInboxBatch } from "../src/inbox-batch.mjs";
import {
  executeRelease,
  releaseTicketResult
} from "../src/release-execution.mjs";
import {
  makeReleaseBuild,
  makeReleaseOperation,
  releaseBuildFiles,
  releaseProtocol,
  verifyReleaseReport
} from "../src/release-contract.mjs";
import {
  integrationCommitInput,
  makeReleasePlan
} from "../src/release-plan.mjs";
import { serviceHash } from "../src/service-contract.mjs";
import { elapsedBatchPolicy, legacyBatchPolicy } from "../src/batch-plan.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import { buildApplication } from "../sandbox/application-build.mjs";

test("product integration commits use the verified GitHub actor identity", () => {
  const record = {
    profile: "real",
    actor: { id: "456", login: "tester" },
    created_at: "2026-09-23T00:00:00.000Z",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: { environment: "staging" }
  };
  const input = integrationCommitInput(record, {
    commit: "a".repeat(40),
    tree: "b".repeat(40)
  });
  assert.equal(input.author.email, "456+tester@users.noreply.github.com");
  assert.deepEqual(input.committer, input.author);
  assert.throws(
    () =>
      integrationCommitInput(
        { ...record, actor: null },
        {
          commit: "a".repeat(40),
          tree: "b".repeat(40)
        }
      ),
    /verified GitHub actor/u
  );
});
import { harness } from "./inbox-batch-harness.mjs";
import {
  isReleaseRequestTarget,
  releaseEnvironmentsForTarget
} from "../src/release-target.mjs";
import { validateBatchHistory } from "../src/batch-state.mjs";
import { validateReleaseExecution } from "../src/release-state.mjs";
import { batchStatuses } from "../src/ticket-presentation.mjs";
import { inboxRunExitCode } from "../src/inbox-run-cli.mjs";

const runFile = promisify(execFile);

function builds(operation) {
  const roles =
    operation.operation === "e2e" ? ["backend", "frontend"] : [operation.role];
  return Object.fromEntries(
    roles.map((role) => [
      role,
      {
        manifest: makeReleaseBuild({
          role,
          source_commit: operation[`${role}_commit`],
          files: releaseBuildFiles[role].map((file) => ({
            path: file,
            sha256: "a".repeat(64),
            bytes: 1
          }))
        }),
        artifact: {
          name: `sandbox-build-${operation.operation_id}-${role}`,
          digest: "b".repeat(64)
        }
      }
    ])
  );
}

function report(record, status = "passed", runId = 100) {
  const runnerRole =
    record.operation.operation === "e2e" ? "backend" : record.operation.role;
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
    builds: status === "passed" ? builds(record.operation) : {},
    versions: {
      backend: record.operation.backend_commit,
      frontend: record.operation.frontend_commit
    },
    runner: {
      repository: sandboxProfile.repositories[runnerRole].full_name,
      run_id: runId,
      attempt: 1,
      commit: record.operation[`${runnerRole}_commit`]
    },
    completed_at: new Date().toISOString()
  };
  verifyReleaseReport(value, record.operation);
  return value;
}

function client(
  calls,
  { failE2e = false, failStep, failRestore = false, movedRestore = false } = {}
) {
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
    integrate: async ({ record, candidate, expectedBase }) => {
      calls.push(record.step.id);
      record.base = expectedBase;
      record.integration_version = 1;
      record.integration_input = integrationCommitInput(record, candidate);
      record.integration_commit = serviceHash(record.integration_input).slice(
        0,
        40
      );
      record.cleanup = "removed";
      return {
        status: "passed",
        kind: "merge",
        commit: record.integration_commit,
        tree: candidate.tree,
        url: "https://example.invalid/integration"
      };
    },
    restore: async ({ record, restoreTo, expectedBase }) => {
      calls.push(record.step.id);
      record.restore_to = restoreTo;
      record.restore_tree = "a".repeat(40);
      record.base = expectedBase;
      record.integration_version = 1;
      record.integration_input = integrationCommitInput(record, {
        commit: expectedBase,
        tree: record.restore_tree
      });
      record.integration_commit = serviceHash(record.integration_input).slice(
        0,
        40
      );
      return failRestore
        ? {
            status: "failed",
            kind: "checks",
            url: "https://example.invalid/restore"
          }
        : {
            status: "passed",
            kind: "merge",
            commit: record.integration_commit,
            tree: record.restore_tree,
            url: "https://example.invalid/restore"
          };
    },
    verifyRestoredStaging: async ({ versions, trees, prodVersions }) => {
      calls.push("verify:restored-staging");
      if (movedRestore)
        throw new Error(
          "Sandbox staging moved before restoration was confirmed."
        );
      return {
        staging: { ...versions },
        prod: { ...prodVersions },
        trees: {
          backend: trees.backend ?? "b".repeat(40),
          frontend: trees.frontend ?? "b".repeat(40)
        }
      };
    },
    verifyRestoredEnvironments: async ({ versions, trees }) => {
      calls.push("verify:restored-environments");
      if (movedRestore)
        throw new Error(
          "Sandbox environment moved before restoration was confirmed."
        );
      return {
        prod: { ...versions.prod },
        staging: { ...versions.staging },
        trees: Object.fromEntries(
          ["prod", "staging"].map((environment) => [
            environment,
            {
              backend: trees[environment].backend ?? "b".repeat(40),
              frontend: trees[environment].frontend ?? "b".repeat(40)
            }
          ])
        )
      };
    },
    run: async ({ record }) => {
      calls.push(record.step.id);
      const status =
        (failE2e && record.step.id === "staging:e2e") ||
        record.step.id === failStep
          ? "failed"
          : "passed";
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

async function selectedBatch({ database = false } = {}) {
  const h = harness(1, { databaseTickets: database ? [1] : [] });
  await processInbox(h.options);
  const reference = Object.values(h.f.state().history.batches)[0];
  const batch = structuredClone(h.f.file(reference.path).record);
  delete batch.execution;
  return batch;
}

async function productionBatch({ database = false } = {}) {
  const batch = await selectedBatch({ database });
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  return batch;
}

test("missing test-main role version stops before release mutations", async () => {
  const batch = await productionBatch();
  const calls = [];
  const releaseClient = client(calls);
  const identity = releaseClient.identity;
  releaseClient.identity = async () => {
    const result = await identity();
    delete result.versions.prod.frontend;
    return result;
  };
  let saves = 0;
  await assert.rejects(
    executeRelease({
      batch,
      client: releaseClient,
      guard: async () => {},
      save: async () => {
        saves++;
      }
    }),
    /Both exact sandbox repository versions are required/u
  );
  assert.deepEqual(calls, []);
  assert.equal(saves, 0);
  assert.equal(batch.execution, undefined);
});

test("database-changing ticket reaches the release sequence alone", async () => {
  const batch = await selectedBatch({ database: true });
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "completed");
  assert.deepEqual(batch.selected, [1]);
  assert.ok(
    calls.indexOf("staging:deploy:backend:dbMigrationsLoop") <
      calls.indexOf("staging:deploy:backend:worker")
  );
  assert.equal(execution.recovery, undefined);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("a saved wait for another workflow run validates; malformed notes are rejected", async () => {
  const batch = await selectedBatch();
  const execution = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  const record = Object.values(execution.operations).find(
    (value) => value.step.kind !== "integrate"
  );
  const waited = {
    purpose: "dispatch",
    first_seen_at: "2026-09-18T10:00:00.000Z",
    runs: [
      {
        id: 555,
        url: "https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/555",
        status: "in_progress",
        actor: "alice"
      }
    ],
    checks: 3,
    quiet_at: "2026-09-18T10:00:20.000Z"
  };
  record.waited_for = waited;
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
  record.waited_for = {
    purpose: "merge",
    first_seen_at: waited.first_seen_at,
    runs: waited.runs
  };
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
  record.waited_for = {
    purpose: "dispatch",
    first_seen_at: waited.first_seen_at,
    runs: [],
    unlisted: 1
  };
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
  for (const bad of [
    null,
    { ...waited, runs: [] },
    { ...waited, purpose: "deploy" },
    { ...waited, first_seen_at: "soon" },
    { ...waited, runs: [{ ...waited.runs[0], status: "completed" }] },
    {
      ...waited,
      runs: [{ ...waited.runs[0], url: "https://example.invalid/run" }]
    },
    { ...waited, runs: [{ ...waited.runs[0], actor: 7 }] },
    { ...waited, checks: 0 },
    { ...waited, runs: [], unlisted: 0 },
    { ...waited, unlisted: -1 },
    { ...waited, quiet_at: "later" }
  ]) {
    record.waited_for = bad;
    assert.throws(
      () => validateReleaseExecution(execution, batch),
      /Invalid saved wait/u
    );
  }
});

test("a failed database-changing release stops for a person without staging restoration", async () => {
  const batch = await selectedBatch({ database: true });
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
  assert.equal(execution.recovery, undefined);
  assert.equal(
    calls.some((step) => step.startsWith("restore:")),
    false
  );
  assert.equal(
    calls.some((step) => step.startsWith("prod:")),
    false
  );
  assert.match(execution.message, /changes the database/u);
  assert.match(execution.message, /without automatic restoration/u);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

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

test("failed staging E2E restores staging and stops before prod", async () => {
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
  assert.equal(execution.recovery.status, "completed");
  assert.equal(calls.at(-1), "verify:restored-staging");
  assert.deepEqual(
    calls.filter((value) => value.startsWith("restore:staging:integrate:")),
    ["restore:staging:integrate:backend", "restore:staging:integrate:frontend"]
  );
  assert.equal(
    calls.some((value) => value.startsWith("prod:")),
    false
  );
  assert.match(execution.message, /staging was restored/u);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
  const unverified = structuredClone(execution);
  delete unverified.recovery.verification;
  assert.throws(
    () => validateReleaseExecution(unverified, batch),
    /Restoration position or final versions are inconsistent/u
  );
});

test("failed fake-production E2E restores test main then staging and keeps the ticket failed", async () => {
  const batch = await productionBatch();
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls, { failStep: "prod:e2e" }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(execution.operations["prod:e2e"].result.status, "failed");
  assert.equal(execution.recovery.plan.version, 2);
  assert.equal(execution.recovery.status, "completed");
  assert.deepEqual(
    calls.filter(
      (step) => step.startsWith("restore:") && step.includes(":integrate:")
    ),
    [
      "restore:prod:integrate:backend",
      "restore:prod:integrate:frontend",
      "restore:staging:integrate:backend",
      "restore:staging:integrate:frontend"
    ]
  );
  assert.ok(
    calls.indexOf("restore:prod:e2e") <
      calls.indexOf("restore:staging:integrate:backend")
  );
  assert.equal(calls.at(-1), "verify:restored-environments");
  assert.match(
    execution.message,
    /test main and staging branches were restored/u
  );
  assert.equal(releaseTicketResult(batch, 1).code, "release-failed");
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
  const missing = structuredClone(execution);
  delete missing.recovery.verification.trees.prod.backend;
  assert.throws(
    () => validateReleaseExecution(missing, batch),
    /Restoration position/u
  );
});

test("failed fake-production check restores only branches that changed", async () => {
  const batch = await productionBatch();
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls, { failStep: "prod:deploy:backend:dbMigrationsLoop" }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.recovery.status, "completed");
  assert.deepEqual(
    calls.filter(
      (step) => step.startsWith("restore:") && step.includes(":integrate:")
    ),
    [
      "restore:prod:integrate:backend",
      "restore:staging:integrate:backend",
      "restore:staging:integrate:frontend"
    ]
  );
  assert.equal(calls.includes("restore:prod:deploy:frontend:frontend"), true);
  assert.equal(calls.includes("restore:prod:e2e"), true);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("database-changing fake-production failure stops without automatic restoration", async () => {
  const batch = await productionBatch({ database: true });
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls, { failStep: "prod:e2e" }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(execution.recovery, undefined);
  assert.equal(
    calls.some((step) => step.startsWith("restore:")),
    false
  );
  assert.match(execution.message, /changes the database/u);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("interrupted fake-production restoration resumes without replaying forward steps", async () => {
  const batch = await productionBatch();
  const calls = [];
  let interrupted = false;
  await assert.rejects(
    executeRelease({
      batch,
      client: client(calls, { failStep: "prod:e2e" }),
      guard: async () => {},
      save: async (message) => {
        if (
          !interrupted &&
          message === "restore step restore:staging:integrate:backend prepared"
        ) {
          interrupted = true;
          throw new Error("recovery interrupted");
        }
      }
    }),
    /recovery interrupted/u
  );
  const forwardCalls = calls.filter(
    (step) => !step.startsWith("restore:") && !step.startsWith("verify:")
  );
  assert.equal(batch.execution.status, "recovering");
  const execution = await executeRelease({
    batch,
    client: client(calls, { failStep: "prod:e2e" }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.recovery.status, "completed");
  assert.deepEqual(
    calls.filter(
      (step) => !step.startsWith("restore:") && !step.startsWith("verify:")
    ),
    forwardCalls
  );
  assert.equal(
    calls.filter((step) => step === "restore:prod:integrate:backend").length,
    1
  );
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("failed fake-production restoration preserves the original failure for a person", async () => {
  const batch = await productionBatch();
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls, { failStep: "prod:e2e", failRestore: true }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(execution.recovery.status, "needs-human");
  assert.equal(execution.operations["prod:e2e"].result.status, "failed");
  assert.equal(calls.at(-1), "restore:prod:integrate:backend");
  assert.match(execution.message, /inspect the sandbox environments/u);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("moved fake-production ref cannot be recorded as restored", async () => {
  const batch = await productionBatch();
  const calls = [];
  await assert.rejects(
    executeRelease({
      batch,
      client: client(calls, { failStep: "prod:e2e", movedRestore: true }),
      guard: async () => {},
      save: async () => {}
    }),
    /environment moved/u
  );
  assert.equal(batch.execution.status, "recovering");
  assert.equal(batch.execution.recovery.status, "running");
  assert.equal(calls.at(-1), "verify:restored-environments");
});

test("a lost save response cannot bypass failed staging E2E on resume", async () => {
  const batch = await selectedBatch();
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  const calls = [];
  let lost = false;
  await assert.rejects(
    executeRelease({
      batch,
      client: client(calls, { failE2e: true }),
      guard: async () => {},
      save: async (message) => {
        if (!lost && message === "release step staging:e2e operation") {
          lost = true;
          throw new Error("save response lost");
        }
      }
    }),
    /save response lost/u
  );
  const execution = await executeRelease({
    batch,
    client: client(calls, { failE2e: true }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(execution.recovery.status, "completed");
  assert.equal(calls.at(-1), "verify:restored-staging");
  assert.equal(
    calls.some((value) => value.startsWith("prod:")),
    false
  );
});

test("interrupted staging restoration resumes without replaying release steps", async () => {
  const batch = await selectedBatch();
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  const calls = [];
  let interrupted = false;
  await assert.rejects(
    executeRelease({
      batch,
      client: client(calls, { failE2e: true }),
      guard: async () => {},
      save: async (message) => {
        if (
          !interrupted &&
          message === "restore step restore:staging:integrate:frontend prepared"
        ) {
          interrupted = true;
          throw new Error("restore save interrupted");
        }
      }
    }),
    /restore save interrupted/u
  );
  assert.equal(batch.execution.status, "recovering");
  const originalCalls = calls.filter((value) => value.startsWith("staging:"));
  const execution = await executeRelease({
    batch,
    client: client(calls, { failE2e: true }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.recovery.status, "completed");
  assert.deepEqual(
    calls.filter((value) => value.startsWith("staging:")),
    originalCalls
  );
  assert.equal(
    calls.filter((value) => value === "restore:staging:integrate:backend")
      .length,
    1
  );
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("failed restoration stops without production and keeps the original failure", async () => {
  const batch = await selectedBatch();
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls, { failE2e: true, failRestore: true }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(execution.recovery.status, "needs-human");
  assert.equal(calls.at(-1), "restore:staging:integrate:backend");
  assert.equal(execution.operations["staging:e2e"].result.status, "failed");
  assert.equal(
    calls.some((value) => value.startsWith("prod:")),
    false
  );
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("a moved staging ref cannot be recorded as restored", async () => {
  const batch = await selectedBatch();
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  const calls = [];
  await assert.rejects(
    executeRelease({
      batch,
      client: client(calls, { failE2e: true, movedRestore: true }),
      guard: async () => {},
      save: async () => {}
    }),
    /staging moved/u
  );
  assert.equal(batch.execution.status, "recovering");
  assert.equal(batch.execution.recovery.status, "running");
  assert.equal(calls.at(-1), "verify:restored-staging");
  assert.equal(
    calls.some((value) => value.startsWith("prod:")),
    false
  );
});

test("request targets have one validated staging-to-production mapping", () => {
  assert.equal(isReleaseRequestTarget("staging"), true);
  assert.equal(isReleaseRequestTarget("production"), true);
  assert.equal(isReleaseRequestTarget("prod"), false);
  assert.deepEqual(releaseEnvironmentsForTarget("staging"), ["staging"]);
  assert.deepEqual(releaseEnvironmentsForTarget("production"), [
    "staging",
    "prod"
  ]);
  assert.throws(
    () => releaseEnvironmentsForTarget("prod"),
    /must be staging or production/u
  );
});

test("a new unchanged role needs base-tree proof while a saved old plan remains readable", async () => {
  const batch = await selectedBatch();
  const publication = batch.attempts
    .find((attempt) => attempt.phase === "git")
    .result.publications.find(({ role }) => role === "frontend");
  const checked = batch.attempts.find((attempt) => attempt.phase === "checks");
  checked.progress.prs = checked.progress.prs.filter(
    ({ role }) => role !== "frontend"
  );
  publication.patch = [];
  publication.tree = publication.base_tree;
  const savedPlan = makeReleasePlan(batch);
  delete publication.base_tree;
  assert.throws(
    () => makeReleasePlan(batch),
    /candidate commit is unavailable/u
  );
  batch.execution = { plan: savedPlan };
  assert.doesNotThrow(() => makeReleasePlan(batch));
});

test("a resumed completed release adds a complete batch ticket result", async () => {
  const batch = await selectedBatch();
  const deferredInput = structuredClone(batch.inputs[0]);
  deferredInput.number = 2;
  deferredInput.input.inbox.issue_number = 2;
  const terminalInput = structuredClone(batch.inputs[0]);
  terminalInput.number = 3;
  terminalInput.input.inbox.issue_number = 3;
  batch.inputs.push(deferredInput, terminalInput);
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
  const terminalDecision = {
    ...structuredClone(item.decision),
    status: "completed",
    next_action: "No further action is required.",
    action_owner: "None"
  };
  const completed = { number: 3, decision: structuredClone(terminalDecision) };
  const state = { batches: { [batch.fingerprint]: batch } };
  await coordinateInboxBatch({
    items: [item, deferred, completed],
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
  assert.deepEqual(item.decision.batch.selected, batch.selected);
  assert.ok(item.decision.batch.evidence.length > 0);
  assert.match(item.decision.reasons.at(-1).message, /passed staging/u);
  assert.equal(item.decision.batch.release.status, "completed");
  assert.deepEqual(Object.keys(item.decision.batch).sort(), [
    "code",
    "evidence",
    "fingerprint",
    "message",
    "release",
    "selected",
    "status"
  ]);
  assert.equal(deferred.decision.status, "waiting");
  assert.equal(deferred.decision.batch.code, "batch-deferred");
  assert.deepEqual(completed.decision, terminalDecision);
});

test("a resumed empty batch stays a no-candidate result", async () => {
  const batch = await selectedBatch();
  batch.selected = [];
  const result = await coordinateInboxBatch({
    items: [],
    state: { batches: { [batch.fingerprint]: batch }, lock: {} },
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    save: async () => {},
    loadBatch: async () => batch,
    release: async () => assert.fail("an empty batch must not start a release")
  });
  assert.equal(result.status, "no-candidate");
  assert.deepEqual(result.selected, []);
  batch.execution = { status: "needs-human" };
  assert.throws(
    () => validateBatchHistory({ [batch.fingerprint]: batch }, sandboxProfile),
    /Only a selected release-capable batch can own release execution/u
  );
});

test("an unfinished current batch keeps its saved ticket eligible on resume", async () => {
  const batch = await selectedBatch();
  batch.status = "searching";
  batch.selected = [];
  const saved = batch.inputs[0];
  const item = {
    number: saved.number,
    entry: {
      issue_number: saved.number,
      request: { target: saved.target, database_change: "no" }
    },
    recordedTerminal: false,
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue the saved run.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    },
    input: saved.input
  };
  let selected = false;
  const result = await coordinateInboxBatch({
    items: [item],
    state: { batches: { [batch.fingerprint]: batch }, lock: {} },
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    save: async () => {},
    verify: async () => true,
    loadBatch: async () => batch,
    select: async ({ items, previous, verify }) => {
      selected = true;
      assert.equal(items.length, 1);
      assert.equal(items[0].number, saved.number);
      assert.equal(await verify(), true);
      return {
        ...previous,
        status: "finished",
        selected: [],
        stop: {
          status: "unknown",
          kind: "evidence",
          message: "Controlled test stop."
        }
      };
    }
  });
  assert.equal(selected, true);
  assert.equal(result.stop.message, "Controlled test stop.");
});

for (const { cleanup, name } of [
  {
    cleanup: "pending",
    name: "an interrupted v1 batch cleans pending work before retirement"
  },
  {
    cleanup: "removed",
    name: "a v1 batch copies a saved cleanup result before retirement"
  }
])
  test(name, async () => {
    const batch = await selectedBatch();
    batch.inputs = batch.inputs.map(({ number, input }) => ({ number, input }));
    batch.policy = structuredClone(legacyBatchPolicy);
    batch.deadline = Date.parse(batch.created_at) + batch.policy.max_elapsed_ms;
    batch.fingerprint = serviceHash({
      inputs: batch.inputs,
      policy: batch.policy
    });
    batch.status = "searching";
    batch.selected = [];
    delete batch.execution;
    const interrupted = batch.attempts.find(
      (attempt) => attempt.phase === "checks"
    );
    delete interrupted.result;
    interrupted.progress.cleanup = cleanup;
    for (const pr of interrupted.progress.prs) pr.cleanup = cleanup;
    const attemptIds = batch.attempts.map((attempt) => attempt.id);
    const item = {
      number: batch.inputs[0].number,
      entry: {
        issue_number: batch.inputs[0].number,
        request: { target: "staging", database_change: "no" }
      },
      input: batch.inputs[0].input,
      decision: {
        status: "waiting",
        reasons: [],
        next_action: "Continue.",
        action_owner: "Coordinator",
        submitter_action: "None currently required."
      }
    };
    const state = { batches: { [batch.fingerprint]: batch } };
    const saves = [];
    let cleanupCalls = 0;
    const result = await coordinateInboxBatch({
      items: [item],
      state,
      run: { batch_fingerprint: batch.fingerprint },
      profile: sandboxProfile,
      guard: async () => {},
      save: async (message) => saves.push(message),
      verify: async () => assert.fail("v1 retirement starts no new checks"),
      loadBatch: async () => batch,
      prepare: async () => assert.fail("v1 retirement starts no new Git work"),
      check: async (_prepared, options) => {
        cleanupCalls++;
        assert.equal(options.id, interrupted.id);
        assert.equal(options.previous.cleanup, cleanup);
        assert.equal(options.policy.version, "sandbox-batch-v1");
        const progress = structuredClone(options.previous);
        if (cleanup === "pending") {
          progress.cleanup = "removed";
          for (const pr of progress.prs) pr.cleanup = "removed";
          progress.result = {
            status: "stale",
            kind: "policy",
            message: "Retired v1 trial."
          };
          await options.save(progress);
        } else assert.equal(progress.result.status, "passed");
        return progress.result;
      },
      revalidate: async () => {},
      release: async () => assert.fail("v1 evidence must not start a release")
    });
    const saved = state.batches[batch.fingerprint];
    assert.equal(result.status, "no-candidate");
    assert.deepEqual(result.selected, []);
    assert.deepEqual(
      saved.attempts.map((attempt) => attempt.id),
      attemptIds
    );
    assert.equal(saved.policy.version, "sandbox-batch-v1");
    assert.equal(saved.status, "finished");
    assert.deepEqual(saved.selected, []);
    assert.equal(saved.stop.status, "stale");
    assert.match(
      saved.stop.message,
      /fresh command to create a current batch/u
    );
    assert.equal(item.decision.batch.code, "batch-deferred");
    assert.equal(cleanupCalls, 1);
    assert.equal(
      saved.attempts.find((attempt) => attempt.id === interrupted.id).progress
        .cleanup,
      "removed"
    );
    assert.ok(saves.includes("retire recovered v1 batch"));
    assert.doesNotThrow(() =>
      validateBatchHistory({ [saved.fingerprint]: saved }, sandboxProfile)
    );
    const untrusted = structuredClone(saved);
    untrusted.policy.max_check_attempts++;
    untrusted.fingerprint = serviceHash({
      inputs: untrusted.inputs,
      policy: untrusted.policy
    });
    assert.throws(
      () =>
        validateBatchHistory(
          { [untrusted.fingerprint]: untrusted },
          sandboxProfile
        ),
      /not a trusted Coordinator policy/u
    );
  });

test("an unfinished v2 batch resumes after its retired deadline", async () => {
  const h = harness(1);
  await processInbox(h.options);
  const reference = Object.values(h.f.state().history.batches)[0];
  const batch = structuredClone(h.f.file(reference.path).record);
  delete batch.execution;
  batch.policy = structuredClone(elapsedBatchPolicy);
  for (const input of batch.inputs) {
    delete input.database_change;
    delete input.operational_deployments;
  }
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  batch.deadline = Date.parse(batch.created_at) + batch.policy.max_elapsed_ms;
  batch.attempts = batch.attempts.filter((attempt) => attempt.phase === "git");
  batch.status = "searching";
  batch.selected = [];
  delete batch.execution;
  const input = batch.inputs[0];
  const sample = h.samples[0];
  const item = {
    number: input.number,
    entry: structuredClone(sample.entry),
    input: input.input,
    coordinated: { report: sample.report() },
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  let checks = 0;
  const state = { lock: {}, batches: { [batch.fingerprint]: batch } };
  const result = await coordinateInboxBatch({
    items: [item],
    state,
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    guard: async () => {},
    save: async () => {},
    verify: async () => true,
    loadBatch: async () => batch,
    prepare: async () => assert.fail("saved Git evidence must be reused"),
    check: async (_prepared, options) => {
      checks++;
      assert.equal(options.policy.version, "sandbox-batch-v2");
      return { status: "passed" };
    },
    revalidate: async () => {}
  });
  assert.equal(checks, 1);
  assert.deepEqual(result.selected, [input.number]);
  assert.equal(result.status, "passed-candidate");
});

test("completed release history requires every exact operation and report", async () => {
  const batch = await selectedBatch();
  const execution = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));

  const arrayVersions = structuredClone(execution);
  arrayVersions.versions = [];
  assert.throws(
    () => validateReleaseExecution(arrayVersions, batch),
    /Invalid sandbox release execution state/u
  );

  const missingStep = structuredClone(execution);
  delete missingStep.operations[execution.plan.steps[0].id];
  assert.throws(
    () => validateReleaseExecution(missingStep, batch),
    /Completed release position has no saved passing result/u
  );

  const failedStep = structuredClone(execution);
  failedStep.operations[execution.plan.steps[0].id].result.status = "failed";
  assert.throws(
    () => validateReleaseExecution(failedStep, batch),
    /Completed release position has no saved passing result/u
  );

  const checkedStep = execution.plan.steps.find(
    (step) => step.kind === "deploy"
  );
  const missingOperation = structuredClone(execution);
  delete missingOperation.operations[checkedStep.id].operation;
  assert.throws(
    () => validateReleaseExecution(missingOperation, batch),
    /lacks its exact operation or report/u
  );

  const missingReport = structuredClone(execution);
  delete missingReport.operations[checkedStep.id].result.report;
  assert.throws(
    () => validateReleaseExecution(missingReport, batch),
    /lacks its exact operation or report/u
  );

  const firstIntegration = execution.plan.steps.find(
    (step) => step.kind === "integrate"
  );
  const unfinishedLegacy = structuredClone(execution);
  unfinishedLegacy.status = "running";
  unfinishedLegacy.step_index = 1;
  unfinishedLegacy.completed_at = null;
  unfinishedLegacy.operations = {
    [firstIntegration.id]: unfinishedLegacy.operations[firstIntegration.id]
  };
  delete unfinishedLegacy.operations[firstIntegration.id].integration_version;
  delete unfinishedLegacy.operations[firstIntegration.id].integration_input;
  delete unfinishedLegacy.operations[firstIntegration.id].integration_commit;
  for (const state of [
    "commit-prepared",
    "branch-prepared",
    "creating-pr",
    "checking",
    "cleaning",
    "merging",
    "merged",
    "dispatching",
    "running",
    "completed"
  ]) {
    unfinishedLegacy.operations[firstIntegration.id].state = state;
    assert.throws(
      () => validateReleaseExecution(unfinishedLegacy, batch),
      /predates unique integration commits/u
    );
  }
  unfinishedLegacy.operations[firstIntegration.id].state = "completed";
  for (const fields of [
    {
      integration_commit:
        execution.operations[firstIntegration.id].integration_commit
    },
    {
      integration_version:
        execution.operations[firstIntegration.id].integration_version,
      integration_input:
        execution.operations[firstIntegration.id].integration_input
    }
  ]) {
    const partialLegacy = structuredClone(unfinishedLegacy);
    Object.assign(partialLegacy.operations[firstIntegration.id], fields);
    assert.throws(
      () => validateReleaseExecution(partialLegacy, batch),
      /predates unique integration commits/u
    );
  }
});

test("integration commit recovery state stays bound to the exact candidate", async () => {
  const batch = await selectedBatch();
  const completed = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  const step = completed.plan.steps.find((value) => value.kind === "integrate");
  const old = completed.operations[step.id];
  const candidate = completed.plan.candidates[step.role];
  const signature = {
    name: "Coordinator sandbox",
    email: "rehearsal@example.invalid",
    date: old.created_at
  };
  const record = {
    id: old.id,
    release_id: old.release_id,
    step,
    state: "commit-prepared",
    created_at: old.created_at,
    result: null,
    integration_version: 1,
    integration_input: {
      message: `Sandbox ${step.environment} candidate for ${old.release_id}\n\nExact selected candidate ${candidate.commit}`,
      tree: candidate.tree,
      parents: [candidate.commit],
      author: signature,
      committer: signature
    }
  };
  const execution = {
    ...structuredClone(completed),
    status: "running",
    step_index: 0,
    completed_at: null,
    operations: { [step.id]: record }
  };
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));

  const changed = structuredClone(execution);
  changed.operations[step.id].integration_input.tree = "0".repeat(40);
  assert.throws(
    () => validateReleaseExecution(changed, batch),
    /Invalid sandbox integration commit state/u
  );

  record.state = "branch-prepared";
  record.integration_commit = "9".repeat(40);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("a malformed resumed run scope fails with a controlled error", async () => {
  await assert.rejects(
    processInbox({
      identity: async () => ({ id: "456", login: "tester" }),
      resume: "11111111-1111-4111-8111-111111111111",
      releaseAdapter: "generic",
      journal: {
        acquire: async () => ({
          state: {},
          run: {
            run_id: "11111111-1111-4111-8111-111111111111",
            scope: undefined
          }
        })
      }
    }),
    (error) => error.code === "run-scope"
  );
});

test("a terminal failed release is not adopted by the next unscoped run", async () => {
  let saves = 0;
  await assert.rejects(
    processInbox({
      identity: async () => ({ id: "456", login: "tester" }),
      profile: sandboxProfile,
      rehearsal: async () => {},
      batch: async () => {},
      journal: {
        acquire: async () => ({
          state: {
            lock: {
              scope: {
                issue_number: null,
                close_test: false,
                workflow: "inbox-run-v6"
              }
            },
            batches: {
              failed: {
                fingerprint: "f".repeat(64),
                policy: { version: "sandbox-batch-v2" },
                status: "finished",
                selected: [1],
                attempts: [],
                execution: { status: "needs-human" }
              }
            }
          },
          run: {
            run_id: "11111111-1111-4111-8111-111111111111",
            scope: {
              issue_number: null,
              close_test: false,
              workflow: "inbox-run-v6"
            }
          }
        }),
        save: async () => saves++
      },
      loadInbox: async () => {
        throw new Error("continued to the next inbox scan");
      }
    }),
    /continued to the next inbox scan/u
  );
  assert.equal(saves, 0);
});

test("a stale batch cannot start release execution", async () => {
  const batch = await selectedBatch();
  batch.stop = {
    status: "stale",
    kind: "evidence",
    message: "The saved main commit changed."
  };
  const item = {
    number: batch.selected[0],
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const result = await coordinateInboxBatch({
    items: [item],
    state: { batches: { [batch.fingerprint]: batch } },
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    save: async () => {},
    loadBatch: async () => batch,
    release: async () => assert.fail("a stale batch must not call release")
  });
  assert.equal(result.status, "release-unverified");
  assert.equal(item.decision.status, "waiting");
  assert.equal(item.decision.batch.status, "stale");
  await assert.rejects(
    executeRelease({
      batch,
      client: {
        identity: async () => assert.fail("must stop before identity")
      },
      guard: async () => {},
      save: async () => {}
    }),
    /stale batch cannot start/u
  );
});

test("a stale batch cannot project a completed release onto its ticket", async () => {
  const batch = await selectedBatch();
  batch.execution = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  batch.stop = {
    status: "stale",
    kind: "evidence",
    message: "The saved main commit changed."
  };
  const result = releaseTicketResult(batch, batch.selected[0]);
  assert.equal(result.status, "waiting");
  assert.equal(result.code, "release-unverified");
  const item = {
    number: batch.selected[0],
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const coordinate = () =>
    coordinateInboxBatch({
      items: [item],
      state: { batches: { [batch.fingerprint]: batch } },
      run: { batch_fingerprint: batch.fingerprint },
      profile: sandboxProfile,
      save: async () => {},
      loadBatch: async () => batch,
      release: async () => assert.fail("terminal release must not run again")
    });
  await coordinate();
  await coordinate();
  assert.equal(item.decision.status, "waiting");
  assert.equal(item.decision.batch.status, "stale");
  assert.equal(batchStatuses.includes(item.decision.batch.status), true);
  assert.deepEqual(
    item.decision.reasons.map(({ code }) => code),
    ["batch-deferred", "release-unverified"]
  );
  assert.equal(
    inboxRunExitCode({
      requests: [
        {
          applied: true,
          status: item.decision.status,
          rehearsal: { status: "passed" },
          batch: item.decision.batch
        }
      ]
    }),
    3
  );
  assert.doesNotThrow(() =>
    validateBatchHistory({ [batch.fingerprint]: batch }, sandboxProfile)
  );
});

test("a needs-human release projects one stable failure reason", async () => {
  const batch = await selectedBatch();
  batch.execution = await executeRelease({
    batch,
    client: client([], { failE2e: true }),
    guard: async () => {},
    save: async () => {}
  });
  const item = {
    number: batch.selected[0],
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const coordinate = () =>
    coordinateInboxBatch({
      items: [item],
      state: { batches: { [batch.fingerprint]: batch } },
      run: { batch_fingerprint: batch.fingerprint },
      profile: sandboxProfile,
      save: async () => {},
      loadBatch: async () => batch,
      release: async () => assert.fail("terminal release must not run again")
    });
  await coordinate();
  await coordinate();
  assert.equal(item.decision.status, "action-needed");
  assert.deepEqual(
    item.decision.reasons.map(({ code }) => code),
    ["release-failed"]
  );
});

test("a later unscoped run leaves an applied failed ticket open without selecting it again", async () => {
  const issue = {
    id: 23,
    number: 23,
    body: "Immutable sandbox receipt",
    state: "open",
    labels: []
  };
  const ticket = {
    receipt_hash: receiptHash(issue),
    applied: "decision-1",
    transitions: [
      {
        id: "decision-1",
        decision: {
          status: "action-needed",
          reasons: [{ code: "release-failed" }],
          batch: { release: { status: "needs-human" } }
        }
      }
    ]
  };
  const results = [];
  const prepared = await prepareRunTickets({
    numbers: [23],
    entries: new Map([[23, { issue_number: 23 }]]),
    issues: new Map([[23, issue]]),
    state: { tickets: { 23: ticket } },
    results,
    batching: true,
    activeBatch: null,
    closeTest: false,
    observe: async () => assert.fail("failed release must not rerun"),
    rehearsal: async () => assert.fail("failed release must not rehearse")
  });
  assert.deepEqual(prepared, []);
  assert.equal(results[0].status, "action-needed");
  assert.equal(ticket.transitions.length, 1);
});

test("a later run restores a failed ticket decision overwritten during resume", async () => {
  const issue = {
    id: 23,
    number: 23,
    body: "Immutable sandbox receipt",
    state: "open",
    labels: []
  };
  const failure = {
    status: "action-needed",
    reasons: [{ code: "release-failed", message: "Staging E2E failed." }],
    batch: { release: { status: "needs-human" } },
    rehearsal: { status: "passed" }
  };
  const ticket = {
    receipt_hash: receiptHash(issue),
    applied: "decision-2",
    transitions: [
      { id: "decision-1", decision: failure, observation: {} },
      { id: "decision-2", decision: { status: "waiting" } }
    ]
  };
  const items = await prepareRunTickets({
    numbers: [23],
    entries: new Map([[23, { issue_number: 23 }]]),
    issues: new Map([[23, issue]]),
    state: { tickets: { 23: ticket } },
    results: [],
    batching: true,
    activeBatch: { inputs: [{ number: 24 }] },
    closeTest: false,
    observe: async () => assert.fail("old failure must not rerun"),
    rehearsal: async () => assert.fail("old failure must not rehearse")
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].preservedDecision, true);
  assert.deepEqual(items[0].decision, failure);
  const result = await coordinateInboxBatch({
    items,
    state: { batches: {} },
    run: {},
    profile: sandboxProfile,
    save: async () => {}
  });
  assert.equal(result.status, "no-candidate");
});

test("a closed test ticket keeps its applied closure after an old failure is seen", async () => {
  const issue = {
    id: 20,
    number: 20,
    body: "Immutable sandbox receipt",
    state: "closed",
    labels: []
  };
  const closure = {
    status: "closed",
    reasons: [{ code: "test" }],
    rehearsal: { status: "passed" }
  };
  const ticket = {
    receipt_hash: receiptHash(issue),
    applied: "closed-1",
    transitions: [
      {
        id: "failed-1",
        decision: {
          status: "action-needed",
          reasons: [{ code: "release-failed" }],
          batch: { release: { status: "needs-human" } }
        }
      },
      { id: "closed-1", decision: closure, observation: {} },
      {
        id: "pending-1",
        decision: {
          status: "action-needed",
          reasons: [{ code: "release-failed" }],
          batch: { release: { status: "needs-human" } }
        }
      }
    ]
  };
  const prepared = await prepareRunTickets({
    numbers: [20],
    entries: new Map([[20, { issue_number: 20 }]]),
    issues: new Map([[20, issue]]),
    state: { tickets: { 20: ticket } },
    results: [],
    batching: true,
    activeBatch: null,
    closeTest: false,
    observe: async () => assert.fail("closed ticket must not rerun")
  });
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].preservedDecision, true);
  assert.deepEqual(prepared[0].decision, closure);
});

test("an unfinished release cannot produce a successful command exit", () => {
  assert.equal(
    inboxRunExitCode({
      requests: [
        {
          applied: true,
          status: "waiting",
          rehearsal: { status: "passed" },
          batch: {
            status: "passed",
            release: { status: "running" }
          }
        }
      ]
    }),
    1
  );
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
  const exact = report(record);
  assert.equal(exact.status, "passed");
  assert.equal(exact.role, null);
  assert.equal(exact.unit, null);
  assert.throws(
    () => verifyReleaseReport({ ...exact, role: "backend" }, operation),
    /does not match/u
  );
  for (const field of ["run_id", "attempt"])
    assert.throws(
      () =>
        verifyReleaseReport(
          {
            ...exact,
            runner: { ...exact.runner, [field]: String(exact.runner[field]) }
          },
          operation
        ),
      /does not match/u
    );
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

  const deployOperation = makeReleaseOperation({
    release_id: operation.release_id,
    operation_id: "33333333-3333-4333-8333-333333333333",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "worker",
    backend_commit: operation.backend_commit,
    frontend_commit: operation.frontend_commit
  });
  const deploy = report({ operation: deployOperation });
  assert.throws(
    () =>
      verifyReleaseReport(
        {
          ...deploy,
          builds: { ...deploy.builds, frontend: exact.builds.frontend }
        },
        deployOperation
      ),
    /does not match/u
  );
  assert.throws(
    () => verifyReleaseReport({ ...deploy, builds: {} }, deployOperation),
    /does not match/u
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
  for (const role of ["backend", "frontend"])
    await buildApplication(role, {
      root: path.join(directory, "candidates", role),
      sourceCommit: operation[`${role}_commit`]
    });
  const script = fileURLToPath(
    new URL("../sandbox/release-run.mjs", import.meta.url)
  );
  const result = await runFile(process.execPath, [script], {
    cwd: directory,
    env: {
      ...process.env,
      OPERATION_ID: operation.operation_id,
      OPERATION_JSON: JSON.stringify(operation),
      GITHUB_REPOSITORY: sandboxProfile.repositories.backend.full_name,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: operation.backend_commit,
      BACKEND_BUILD_OUTCOME: "success",
      BACKEND_ARTIFACT_OUTCOME: "success",
      BACKEND_ARTIFACT_DIGEST: "a".repeat(64),
      FRONTEND_BUILD_OUTCOME: "success",
      FRONTEND_ARTIFACT_OUTCOME: "success",
      FRONTEND_ARTIFACT_DIGEST: "b".repeat(64)
    }
  });
  const successEncoded = result.stdout.match(
    /COORDINATOR_RELEASE_RESULT:(\S+)/u
  )?.[1];
  assert.ok(successEncoded, "expected passing sandbox release result marker");
  const successReport = JSON.parse(
    Buffer.from(successEncoded, "base64url").toString()
  );
  assert.equal(successReport.status, "passed");
  for (const role of ["backend", "frontend"]) {
    assert.equal(
      successReport.builds[role].manifest.source_commit,
      operation[`${role}_commit`]
    );
    assert.equal(
      successReport.builds[role].artifact.name,
      `sandbox-build-${operation.operation_id}-${role}`
    );
  }

  await writeFile(
    path.join(directory, "candidates/backend/dist/worker.mjs"),
    'export function run() { throw new Error("a".repeat(499) + "😀tail"); }\n'
  );
  let failed;
  try {
    await runFile(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        OPERATION_ID: operation.operation_id,
        OPERATION_JSON: JSON.stringify(operation),
        GITHUB_REPOSITORY: sandboxProfile.repositories.backend.full_name,
        GITHUB_RUN_ID: "124",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_SHA: operation.backend_commit,
        BACKEND_BUILD_OUTCOME: "success",
        BACKEND_ARTIFACT_OUTCOME: "success",
        BACKEND_ARTIFACT_DIGEST: "a".repeat(64),
        FRONTEND_BUILD_OUTCOME: "success",
        FRONTEND_ARTIFACT_OUTCOME: "success",
        FRONTEND_ARTIFACT_DIGEST: "b".repeat(64)
      }
    });
  } catch (error) {
    failed = error;
  }
  assert.equal(failed?.code, 1);
  const encoded = failed.stdout.match(/COORDINATOR_RELEASE_RESULT:(\S+)/u)?.[1];
  assert.ok(encoded, "expected sandbox release result marker");
  const failedReport = JSON.parse(Buffer.from(encoded, "base64url"));
  assert.equal(
    failedReport.checks[0].message,
    "Sandbox build output differs from its manifest."
  );
});
