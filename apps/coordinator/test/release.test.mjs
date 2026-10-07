import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { ServiceError, serviceHash } from "../src/service-contract.mjs";
import { assertCancellableRelease } from "../src/release-cancellation.mjs";
import { stopStaleE2e } from "../src/manual-stale-stop.mjs";
import { elapsedBatchPolicy, legacyBatchPolicy } from "../src/batch-plan.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import {
  productWorkflowReleaseAdapter,
  verifyProductWorkflowReport
} from "../src/product-workflow-contract.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import { buildApplication } from "../sandbox/application-build.mjs";

test("product integration and recovery commits use Simo's authorized DCO identity", () => {
  const record = {
    profile: "real",
    actor: { id: "209783236", login: "simo6529" },
    created_at: "2026-09-23T00:00:00.000Z",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: { environment: "staging" }
  };
  const input = integrationCommitInput(record, {
    commit: "a".repeat(40),
    tree: "b".repeat(40)
  });
  assert.deepEqual(input.author, {
    name: "Simo",
    email: "209783236+simo6529@users.noreply.github.com",
    date: record.created_at
  });
  assert.deepEqual(input.committer, input.author);
  assert.match(
    input.message,
    /\n\nSigned-off-by: Simo <209783236\+simo6529@users\.noreply\.github\.com>$/u
  );
  const recovery = integrationCommitInput(
    {
      ...record,
      step: { ...record.step, recovery: true },
      restore_to: "c".repeat(40)
    },
    { commit: "a".repeat(40), tree: "b".repeat(40) }
  );
  assert.match(recovery.message, /restoration/u);
  assert.match(recovery.message, /Signed-off-by: Simo/u);
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
  assert.throws(
    () =>
      integrationCommitInput(
        { ...record, actor: { id: "456", login: "tester" } },
        { commit: "a".repeat(40), tree: "b".repeat(40) }
      ),
    /authorized, currently authenticated/u
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
import { archiveFinished, verifyArchive } from "../src/inbox-history.mjs";
import { createRunLog } from "../src/run-log.mjs";

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
  const liveVersions = {
    staging: { backend: "b".repeat(40), frontend: "b".repeat(40) },
    prod: { backend: "b".repeat(40), frontend: "b".repeat(40) }
  };
  return {
    identity: async () => ({
      actor: { id: "456", login: "tester" },
      runtime: {
        backend: { workflow_id: 201 },
        frontend: { workflow_id: 202 }
      },
      versions: structuredClone(liveVersions)
    }),
    environmentVersions: async (environment) => ({
      ...liveVersions[environment]
    }),
    waitForStagingQuiet: async () => {
      calls.push("wait:staging-quiet");
    },
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
      const result = {
        status: "passed",
        kind: "merge",
        commit: record.integration_commit,
        tree: candidate.tree,
        url: "https://example.invalid/integration"
      };
      liveVersions[record.step.environment][record.step.role] = result.commit;
      return result;
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
      const result = failRestore
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
      if (result.status === "passed")
        liveVersions[record.step.environment][record.step.role] = result.commit;
      return result;
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
      record.workflow_run_id = value.runner.run_id;
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

async function frontendOnlyProductionBatch() {
  const batch = await productionBatch();
  const prepared = batch.attempts.find(
    (attempt) => attempt.phase === "git" && attempt.result?.status === "passed"
  ).result;
  prepared.publications = prepared.publications.filter(
    (publication) => publication.role === "frontend"
  );
  prepared.service_plan.steps = prepared.service_plan.steps
    .filter((step) => step.role === "frontend")
    .map((step) => ({ ...step, depends_on: [] }));
  return batch;
}

async function frontendStagingDrift() {
  const batch = await frontendOnlyProductionBatch();
  const calls = [];
  const releaseClient = client(calls);
  const versions = {
    staging: { backend: "b".repeat(40), frontend: "b".repeat(40) },
    prod: { backend: "b".repeat(40), frontend: "b".repeat(40) }
  };
  const originalIntegrate = releaseClient.integrate;
  releaseClient.integrate = async (args) => {
    const result = await originalIntegrate(args);
    versions[args.record.step.environment][args.record.step.role] =
      result.commit;
    return result;
  };
  releaseClient.environmentVersions = async (environment) => ({
    ...versions[environment]
  });
  releaseClient.waitForStagingQuiet = async () => {
    calls.push("wait:staging-quiet");
  };
  const originalRun = releaseClient.run;
  let firstE2e = true;
  releaseClient.run = async (args) => {
    if (args.record.step.id === "staging:e2e" && firstE2e) {
      firstE2e = false;
      args.record.workflow_run_id = 990;
      args.record.state = "running";
      versions.staging.backend = "c".repeat(40);
      throw new ServiceError(
        "release-stale",
        "Staging changed before E2E result acceptance."
      );
    }
    return originalRun(args);
  };
  const options = {
    batch,
    client: releaseClient,
    operator: { id: "456", login: "tester" },
    guard: async () => {},
    save: async () => {}
  };
  const stopped = await executeRelease(options);
  assert.equal(stopped.status, "awaiting-staging-choice");
  assert.equal(stopped.staging_drift.observed.backend, "c".repeat(40));
  assert.doesNotThrow(() => validateReleaseExecution(stopped, batch));
  assert.equal(
    calls.some((step) => step.startsWith("prod:")),
    false
  );
  return { batch, calls, releaseClient, versions, options };
}

test("manual stale-E2E stop preserves the passing workflow without claiming production", async () => {
  const { batch } = await frontendStagingDrift();
  const execution = batch.execution;
  const record = execution.operations["staging:e2e"];
  delete execution.staging_drift;
  execution.status = "running";
  const at = "2026-09-29T06:00:00.000Z";
  const repositoryName = sandboxProfile.repositories.frontend.full_name;
  const workflow = {
    id: record.workflow_run_id,
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/${repositoryName}/actions/runs/${record.workflow_run_id}`
  };
  assert.ok(Number.isSafeInteger(record.workflow_run_id));
  assert.ok(record.workflow_run_id > 0);
  const stopOptions = {
    actor: { id: "456", login: "tester" },
    observed: {
      backend: "c".repeat(40),
      frontend: execution.versions.staging.frontend
    },
    workflow,
    at
  };
  for (const invalidWorkflow of [
    { ...workflow, id: workflow.id + 1 },
    { ...workflow, status: "in_progress" },
    { ...workflow, conclusion: "failure" },
    { ...workflow, html_url: `${workflow.html_url}/other` },
    undefined
  ]) {
    assert.throws(() =>
      stopStaleE2e(batch, { ...stopOptions, workflow: invalidWorkflow })
    );
  }
  assert.throws(() =>
    stopStaleE2e(batch, {
      ...stopOptions,
      observed: {
        ...stopOptions.observed,
        backend: execution.versions.staging.backend
      }
    })
  );
  assert.throws(() =>
    stopStaleE2e(batch, {
      ...stopOptions,
      actor: { id: "invalid", login: "tester" }
    })
  );
  const withProd = structuredClone(batch);
  const prodStep = execution.plan.steps.find(
    (step) => step.environment === "prod"
  );
  assert.ok(prodStep);
  withProd.execution.operations[prodStep.id] = { state: "running" };
  assert.throws(() => stopStaleE2e(withProd, stopOptions));
  const stopped = stopStaleE2e(batch, stopOptions);
  assert.equal(stopped.status, "needs-human");
  assert.equal(record.state, "running");
  assert.equal(stopped.operations["staging:e2e"].result.status, "stopped");
  assert.equal(
    stopped.operations["staging:e2e"].result.workflow.conclusion,
    "success"
  );
  assert.equal(
    stopped.operations["staging:e2e"].result.workflow.url,
    workflow.html_url
  );
  assert.equal(releaseTicketResult(batch, 1).code, "release-stopped");
  assert.doesNotThrow(() => validateReleaseExecution(stopped, batch));
  const missing = structuredClone(stopped);
  delete missing.manual_stop;
  assert.throws(() => validateReleaseExecution(missing, batch));
  const invalidRun = structuredClone(stopped);
  invalidRun.operations["staging:e2e"].workflow_run_id = 0;
  invalidRun.operations["staging:e2e"].result.workflow.id = 0;
  invalidRun.operations["staging:e2e"].result.workflow.url =
    `https://github.com/${repositoryName}/actions/runs/0`;
  invalidRun.manual_stop.e2e_workflow_run_id = 0;
  assert.throws(() => validateReleaseExecution(invalidRun, batch));
  assert.throws(() =>
    stopStaleE2e(batch, {
      ...stopOptions,
      observed: stopped.manual_stop.observed
    })
  );
});

test("a concurrent backend staging move is recorded and blocks production until a choice", async () => {
  const { batch, calls, options } = await frontendStagingDrift();
  assert.equal(releaseTicketResult(batch, 1).code, "release-staging-changed");
  const waiting = await executeRelease(options);
  assert.equal(waiting.status, "awaiting-staging-choice");
  assert.equal(
    calls.some((step) => step.startsWith("prod:")),
    false
  );
});

async function driftAfterPassingStagingE2e({ partialProduction = false } = {}) {
  const batch = await frontendOnlyProductionBatch();
  const calls = [];
  const releaseClient = client(calls);
  const options = {
    batch,
    client: releaseClient,
    operator: { id: "456", login: "tester" },
    guard: async () => {},
    save: async (message) => {
      if (message === "release step prod:integrate:frontend prepared")
        throw new Error("paused before production integration");
    }
  };
  await assert.rejects(
    executeRelease(options),
    /paused before production integration/u
  );
  assert.equal(batch.execution.step_index, 3);
  assert.equal(
    batch.execution.operations["staging:e2e"].result.status,
    "passed"
  );
  const versions = structuredClone(batch.execution.versions);
  versions.staging.backend = "c".repeat(40);
  if (partialProduction) {
    const record = batch.execution.operations["prod:integrate:frontend"];
    record.actor = batch.execution.actor;
    record.base = versions.prod.frontend;
    record.integration_version = 1;
    record.integration_input = integrationCommitInput(
      record,
      batch.execution.plan.candidates.frontend
    );
    record.state = "commit-prepared";
  }
  releaseClient.environmentVersions = async (environment) => ({
    ...versions[environment]
  });
  options.save = async () => {};
  if (partialProduction) {
    await assert.rejects(
      executeRelease(options),
      /Inspect the saved production operation manually/u
    );
    assert.equal(calls.includes("prod:integrate:frontend"), false);
    return { batch, calls, releaseClient, versions, options };
  }
  const waiting = await executeRelease(options);
  assert.equal(waiting.status, "awaiting-staging-choice");
  assert.equal(waiting.staging_drift.observed.backend, "c".repeat(40));
  assert.match(waiting.message, /after E2E passed but before production/u);
  assert.match(
    releaseTicketResult(batch, batch.selected[0]).message,
    /after E2E passed but before production/u
  );
  const damaged = structuredClone(batch);
  damaged.execution.staging_drift.expected = null;
  assert.throws(
    () => releaseTicketResult(damaged, damaged.selected[0]),
    /lacks exact saved branch versions/u
  );
  assert.equal(calls.includes("prod:integrate:frontend"), false);
  assert.doesNotThrow(() => validateReleaseExecution(waiting, batch));
  return { batch, calls, releaseClient, versions, options };
}

test("a staging move cannot offer automatic choices after production integration started", async () => {
  await driftAfterPassingStagingE2e({ partialProduction: true });
});

test("a backend move after passing staging E2E blocks the first production merge", async () => {
  const { batch, calls, releaseClient, options } =
    await driftAfterPassingStagingE2e();
  const done = await executeRelease({ ...options, stagingChange: "retest" });
  assert.equal(done.status, "completed");
  assert.equal(done.staging_drift.previous_e2e.result.status, "passed");
  assert.equal(
    done.operations["staging:e2e"].operation.backend_commit,
    "c".repeat(40)
  );
  assert.ok(
    calls.indexOf("prod:integrate:frontend") > calls.indexOf("staging:e2e")
  );
  assert.doesNotThrow(() => validateReleaseExecution(done, batch));
  assert.equal(typeof releaseClient.environmentVersions, "function");
});

test("a late backend move can restore only the frontend staging change", async () => {
  const { batch, calls, releaseClient, versions, options } =
    await driftAfterPassingStagingE2e();
  const originalRestore = releaseClient.restore;
  releaseClient.restore = async (args) => {
    const result = await originalRestore(args);
    versions.staging.frontend = result.commit;
    return result;
  };
  const stopped = await executeRelease({
    ...options,
    stagingChange: "restore"
  });
  assert.equal(stopped.status, "needs-human");
  assert.equal(stopped.staging_drift.status, "restored");
  assert.equal(versions.staging.backend, "c".repeat(40));
  assert.equal(
    calls.some((step) => step.startsWith("prod:")),
    false
  );
  assert.doesNotThrow(() => validateReleaseExecution(stopped, batch));
});

test("explicit staging retest keeps old evidence and deploys the frontend afresh before production", async () => {
  const { batch, calls, options } = await frontendStagingDrift();
  const done = await executeRelease({ ...options, stagingChange: "retest" });
  assert.equal(done.status, "completed");
  assert.equal(done.staging_drift.status, "retested");
  assert.deepEqual(done.staging_drift.chosen_by, {
    id: "456",
    login: "tester"
  });
  assert.equal(done.staging_drift.previous_e2e.workflow_run_id, 990);
  assert.notEqual(
    done.operations["staging:deploy:frontend:frontend"].id,
    done.staging_drift.previous_deploy.id
  );
  assert.notEqual(
    done.operations["staging:deploy:frontend:frontend"].workflow_run_id,
    done.staging_drift.previous_deploy.workflow_run_id
  );
  assert.equal(
    done.operations["staging:deploy:frontend:frontend"].force_dispatch,
    true
  );
  assert.equal(
    done.operations["staging:e2e"].operation.backend_commit,
    "c".repeat(40)
  );
  assert.equal(
    calls.filter((step) => step === "staging:deploy:frontend:frontend").length,
    2
  );
  assert.ok(
    calls.indexOf("wait:staging-quiet") <
      calls.indexOf("prod:integrate:frontend")
  );
  assert.doesNotThrow(() => validateReleaseExecution(done, batch));
});

test("a second backend move during retest stays resumable and needs another fresh E2E", async () => {
  const { batch, options, releaseClient, versions } =
    await frontendStagingDrift();
  const originalRun = releaseClient.run;
  let secondMove = true;
  releaseClient.run = async (args) => {
    if (args.record.step.id === "staging:e2e" && secondMove) {
      secondMove = false;
      args.record.workflow_run_id = 992;
      args.record.state = "running";
      versions.staging.backend = "d".repeat(40);
      throw new ServiceError(
        "release-stale",
        "Backend staging moved again during retest."
      );
    }
    return originalRun(args);
  };
  const waiting = await executeRelease({ ...options, stagingChange: "retest" });
  assert.equal(waiting.status, "awaiting-staging-choice");
  assert.equal(waiting.staging_drift.observed.backend, "d".repeat(40));
  assert.equal(waiting.staging_drift.superseded[0].choice, "retest");
  assert.doesNotThrow(() => validateReleaseExecution(waiting, batch));
  assert.equal(
    (await executeRelease(options)).status,
    "awaiting-staging-choice"
  );
  const done = await executeRelease({ ...options, stagingChange: "retest" });
  assert.equal(done.status, "completed");
  assert.equal(
    done.operations["staging:e2e"].operation.backend_commit,
    "d".repeat(40)
  );
  assert.doesNotThrow(() => validateReleaseExecution(done, batch));
});

test("explicit staging restoration preserves the external backend and stops before production", async () => {
  const { batch, calls, options, versions, releaseClient } =
    await frontendStagingDrift();
  const originalRestore = releaseClient.restore;
  releaseClient.restore = async (args) => {
    const result = await originalRestore(args);
    versions.staging.frontend = result.commit;
    return result;
  };
  releaseClient.verifyRestoredStaging = async ({
    versions: expected,
    trees
  }) => {
    calls.push("verify:restored-staging");
    assert.deepEqual(versions.staging, expected);
    assert.equal(trees.frontend, "a".repeat(40));
    return {
      staging: { ...versions.staging },
      prod: { ...versions.prod },
      trees: { frontend: "a".repeat(40) }
    };
  };
  const stopped = await executeRelease({
    ...options,
    stagingChange: "restore"
  });
  assert.equal(stopped.status, "needs-human");
  assert.equal(stopped.staging_drift.status, "restored");
  assert.equal(stopped.staging_drift.chosen_by.login, "tester");
  assert.equal(versions.staging.backend, "c".repeat(40));
  assert.equal(versions.prod.frontend, "b".repeat(40));
  assert.equal(
    calls.some((step) => step.startsWith("prod:")),
    false
  );
  assert.ok(calls.includes("restore:staging:integrate:frontend"));
  assert.ok(calls.includes("restore:staging:deploy:frontend:frontend"));
  assert.ok(calls.includes("restore:staging:e2e"));
  assert.doesNotThrow(() => validateReleaseExecution(stopped, batch));
});

test("a failed fresh frontend deploy remains recoverable after a staging retest choice", async () => {
  const { batch, options, releaseClient } = await frontendStagingDrift();
  const originalRun = releaseClient.run;
  releaseClient.run = async (args) => {
    if (
      args.record.step.id === "staging:deploy:frontend:frontend" &&
      args.record.force_dispatch === true
    ) {
      const failed = report(args.record, "failed", 992);
      return {
        status: "failed",
        report: failed,
        workflow: { id: 992, url: "https://example.invalid/release/992" }
      };
    }
    return originalRun(args);
  };
  const stopped = await executeRelease({ ...options, stagingChange: "retest" });
  assert.equal(stopped.status, "needs-human");
  assert.equal(stopped.recovery.status, "completed");
  assert.equal(stopped.staging_drift.status, "retesting");
  assert.equal(
    stopped.operations["staging:deploy:frontend:frontend"].result.status,
    "failed"
  );
  assert.doesNotThrow(() => validateReleaseExecution(stopped, batch));
});

test("a second environment move refuses the chosen staging reconciliation", async () => {
  const { calls, options, versions } = await frontendStagingDrift();
  versions.staging.backend = "d".repeat(40);
  await assert.rejects(
    executeRelease({ ...options, stagingChange: "retest" }),
    /moved again/u
  );
  assert.equal(
    calls.some((step) => step.startsWith("prod:")),
    false
  );
});

test("a backend-owned batch cannot automatically adopt someone else's staging backend", async () => {
  const batch = await productionBatch();
  const calls = [];
  const releaseClient = client(calls);
  const versions = {
    staging: { backend: "b".repeat(40), frontend: "b".repeat(40) },
    prod: { backend: "b".repeat(40), frontend: "b".repeat(40) }
  };
  const integrate = releaseClient.integrate;
  releaseClient.integrate = async (args) => {
    const result = await integrate(args);
    versions[args.record.step.environment][args.record.step.role] =
      result.commit;
    return result;
  };
  releaseClient.environmentVersions = async (environment) => ({
    ...versions[environment]
  });
  const run = releaseClient.run;
  releaseClient.run = async (args) => {
    if (args.record.step.id === "staging:e2e") {
      args.record.workflow_run_id = 991;
      versions.staging.backend = "c".repeat(40);
      throw new ServiceError("release-stale", "Staging changed.");
    }
    return run(args);
  };
  const options = {
    batch,
    client: releaseClient,
    operator: { id: "456", login: "tester" },
    guard: async () => {},
    save: async () => {}
  };
  assert.equal(
    (await executeRelease(options)).status,
    "awaiting-staging-choice"
  );
  await assert.rejects(
    executeRelease({ ...options, stagingChange: "retest" }),
    /frontend release/u
  );
  assert.equal(
    calls.some((step) => step.startsWith("prod:")),
    false
  );
});

test("staging restoration resumes its saved operations after interruption", async () => {
  const { batch, calls, options, versions, releaseClient } =
    await frontendStagingDrift();
  const restore = releaseClient.restore;
  releaseClient.restore = async (args) => {
    const result = await restore(args);
    versions.staging.frontend = result.commit;
    return result;
  };
  releaseClient.verifyRestoredStaging = async ({ trees }) => ({
    staging: { ...versions.staging },
    prod: { ...versions.prod },
    trees: { frontend: trees.frontend }
  });
  let interrupted = false;
  await assert.rejects(
    executeRelease({
      ...options,
      stagingChange: "restore",
      save: async (message) => {
        if (
          !interrupted &&
          message ===
            "staging reconciliation step restore:staging:integrate:frontend passed"
        ) {
          interrupted = true;
          throw new Error("saved restoration interrupted");
        }
      }
    }),
    /saved restoration interrupted/u
  );
  assert.equal(batch.execution.status, "reconciling-staging");
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
  const done = await executeRelease(options);
  assert.equal(done.staging_drift.status, "restored");
  assert.equal(
    calls.filter((step) => step === "restore:staging:integrate:frontend")
      .length,
    1
  );
});

test("a moved ref at staging-restoration readback cannot release the lane", async () => {
  const { batch, options, releaseClient } = await frontendStagingDrift();
  releaseClient.verifyRestoredStaging = async () => {
    throw new ServiceError(
      "release-recovery-moved",
      "Staging moved before restoration was confirmed."
    );
  };
  await assert.rejects(
    executeRelease({ ...options, stagingChange: "restore" }),
    /moved before restoration/u
  );
  assert.equal(batch.execution.status, "reconciling-staging");
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
});

test("a failed own-frontend staging restoration is recorded but not accepted", async () => {
  const { batch, options, releaseClient } = await frontendStagingDrift();
  releaseClient.restore = async ({ record }) => ({
    status: "failed",
    kind: "checks",
    url: `https://example.invalid/failed/${record.id}`
  });
  const stopped = await executeRelease({
    ...options,
    stagingChange: "restore"
  });
  assert.equal(stopped.status, "needs-human");
  assert.equal(stopped.staging_drift.status, "failed");
  assert.equal(stopped.staging_drift.restoration.status, "failed");
  assert.match(stopped.message, /lane remains locked/u);
  assert.doesNotThrow(() => validateReleaseExecution(stopped, batch));
});

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

test("a prepared release rechecks runtime identity after a stopped attempt", async () => {
  const batch = await selectedBatch();
  const calls = [];
  const oldClient = client(calls);
  oldClient.identity = async () => {
    calls.push("old runtime identity");
    throw new Error("A pinned product release runtime file changed.");
  };
  await assert.rejects(
    executeRelease({
      batch,
      client: oldClient,
      guard: async () => {},
      save: async () => {}
    }),
    /pinned product release runtime file changed/u
  );
  assert.deepEqual(calls, ["old runtime identity"]);
  assert.equal(batch.execution, undefined);

  const refreshedClient = client(calls);
  const refreshedIdentity = refreshedClient.identity;
  refreshedClient.identity = async () => {
    calls.push("refreshed runtime identity");
    return refreshedIdentity();
  };
  let guardCalls = 0;
  await assert.rejects(
    executeRelease({
      batch,
      client: refreshedClient,
      guard: async () => {
        if (++guardCalls === 2) throw new Error("stop before first operation");
      },
      save: async () => {}
    }),
    /stop before first operation/u
  );
  assert.deepEqual(calls, [
    "old runtime identity",
    "refreshed runtime identity"
  ]);
  assert.equal(batch.execution.status, "running");
  assert.deepEqual(batch.execution.operations, {});
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

for (const database of [false, true]) {
  test(`confirmed E2E wrapper failure reaches terminal release handling (database=${database})`, async () => {
    const batch = await productionBatch({ database });
    const calls = [];
    const releaseClient = client(calls);
    const originalRun = releaseClient.run;
    /** Supply the adapter's explicit failed-launcher contract at the engine boundary. */
    releaseClient.run = async (args) => {
      if (args.record.step.id !== "staging:e2e") return originalRun(args);
      calls.push(args.record.step.id);
      args.record.dispatch_workflow_run_id = 603;
      args.record.state = "running";
      await args.save();
      const failed = {
        ...report(args.record, "failed", 603),
        adapter: productWorkflowReleaseAdapter,
        failure_stage: "e2e-dispatch",
        checks: [{ name: "automatic-e2e-dispatch", status: "failed" }],
        deployments: {},
        runner: {
          repository: sandboxProfile.repositories.frontend.full_name,
          run_id: 603,
          attempt: 1,
          commit: "c".repeat(40),
          workflow: ".github/workflows/staging-e2e-dispatch.yml"
        }
      };
      verifyProductWorkflowReport(failed, args.record.operation);
      return {
        status: "failed",
        report: failed,
        report_hash: serviceHash(failed),
        workflow: { id: 603, url: "https://example.invalid/runs/603" }
      };
    };
    const options = {
      batch,
      client: releaseClient,
      /** Isolate engine failure routing from external admission checks. */
      guard: async () => {},
      /** Preserve execution state in the batch object without journal writes. */
      save: async () => {}
    };
    const execution = await executeRelease(options);
    const record = execution.operations["staging:e2e"];
    assert.equal(execution.status, "needs-human");
    assert.equal(record.state, "completed");
    assert.equal(record.result.report.failure_stage, "e2e-dispatch");
    assert.equal(record.workflow_run_id, undefined);
    assert.equal(record.dispatch_workflow_run_id, 603);
    assert.equal(
      execution.recovery?.status,
      database ? undefined : "completed"
    );
    assert.equal(
      calls.some((step) => step.startsWith("prod:")),
      false
    );
    assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
    const callsBeforeResume = calls.length;
    assert.deepEqual(await executeRelease(options), execution);
    assert.equal(calls.length, callsBeforeResume);
  });
}

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

async function pausedReviewFixture() {
  const batch = await selectedBatch();
  const calls = [];
  const releaseClient = client(calls);
  const integrate = releaseClient.integrate;
  releaseClient.integrate = async (args) => {
    if (args.record.step.id !== "staging:integrate:backend")
      return integrate(args);
    calls.push(`${args.record.step.id}:${args.reviewStop ? "stop" : "review"}`);
    if (args.reviewStop || args.record.cleanup_reason === "review-stop") {
      args.record.cleanup = "removed";
      return {
        status: "failed",
        kind: "review-stop",
        url: args.record.url
      };
    }
    if (args.record.number) return integrate(args);
    args.record.base = args.expectedBase;
    args.record.branch = `codex/release-${args.record.release_id}-staging-backend`;
    args.record.target_branch = "1a-staging";
    args.record.integration_version = 1;
    args.record.integration_input = integrationCommitInput(
      args.record,
      args.candidate
    );
    args.record.integration_commit = serviceHash(
      args.record.integration_input
    ).slice(0, 40);
    args.record.number = 42;
    args.record.url =
      "https://github.com/6529-Collections/release-coordinator-test-backend/pull/42";
    args.record.state = "checking";
    return { status: "waiting-review", kind: "review", url: args.record.url };
  };
  const options = {
    batch,
    client: releaseClient,
    guard: async () => {},
    save: async () => {}
  };
  const paused = await executeRelease(options);
  return { batch, calls, options, paused };
}

test("a blocked integration PR pauses, keeps its identity, and resumes only the saved step", async () => {
  const { batch, calls, options, paused } = await pausedReviewFixture();
  assert.equal(paused.status, "awaiting-review");
  assert.equal(paused.step_index, 0);
  assert.equal(paused.operations["staging:integrate:backend"].result, null);
  assert.equal(paused.review_pause.pr_number, 42);
  assert.equal(releaseTicketResult(batch, 1).code, "release-review-pending");
  assert.doesNotThrow(() => validateReleaseExecution(paused, batch));
  const completed = await executeRelease(options);
  assert.equal(completed.status, "completed");
  assert.equal(completed.review_pause, undefined);
  assert.equal(calls.filter((call) => call.endsWith(":review")).length, 2);
  assert.doesNotThrow(() => validateReleaseExecution(completed, batch));
});

test("only an explicitly stopped paused PR follows release recovery", async () => {
  const { batch, calls, options, paused } = await pausedReviewFixture();
  assert.equal(paused.status, "awaiting-review");
  const stopped = await executeRelease({ ...options, reviewStop: true });
  assert.equal(stopped.status, "needs-human");
  assert.equal(
    stopped.operations["staging:integrate:backend"].result.kind,
    "review-stop"
  );
  assert.equal(calls.filter((call) => call.endsWith(":stop")).length, 1);
  assert.equal(
    calls.some((call) => call.startsWith("prod:")),
    false
  );
  assert.doesNotThrow(() => validateReleaseExecution(stopped, batch));
  await assert.rejects(
    executeRelease({ ...options, reviewStop: true }),
    /requires a saved release awaiting review/u
  );
});

test("an interrupted saved review stop cannot turn into a merge on ordinary resume", async () => {
  const { batch, options } = await pausedReviewFixture();
  await assert.rejects(
    executeRelease({
      ...options,
      reviewStop: true,
      save: async (message) => {
        if (message === "stop paused integration PR")
          throw new Error("lost stop save response");
      }
    }),
    /lost stop save response/u
  );
  assert.equal(batch.execution.status, "running");
  assert.equal(
    batch.execution.operations["staging:integrate:backend"].cleanup_reason,
    "review-stop"
  );
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
  const stopped = await executeRelease(options);
  assert.equal(stopped.status, "needs-human");
  assert.equal(
    stopped.operations["staging:integrate:backend"].result.kind,
    "review-stop"
  );
});

async function cancellableProductionFixture() {
  const batch = await frontendOnlyProductionBatch();
  const calls = [];
  const releaseClient = client(calls);
  const integrate = releaseClient.integrate;
  releaseClient.integrate = async (args) => {
    if (args.record.step.environment !== "prod") return integrate(args);
    const record = args.record;
    record.base = args.expectedBase;
    record.target_branch = "main";
    record.branch = `codex/release-${record.release_id}-prod-frontend`;
    record.integration_version = 1;
    record.integration_input = integrationCommitInput(record, args.candidate);
    record.integration_commit = serviceHash(record.integration_input).slice(
      0,
      40
    );
    record.number = 42;
    record.url =
      "https://github.com/6529-Collections/release-coordinator-test-frontend/pull/42";
    record.state = "checking";
    return { status: "waiting-review", url: record.url };
  };
  releaseClient.cancelIntegration = async ({ record }) => {
    calls.push("cancel:owned-pr");
    record.cleanup = "removed";
    return { status: "failed", kind: "review-stop", url: record.url };
  };
  const options = {
    batch,
    client: releaseClient,
    operator: { id: "456", login: "tester" },
    guard: async () => {},
    save: async () => {}
  };
  await executeRelease(options);
  assert.equal(batch.execution.status, "awaiting-review");
  // Both environments can move independently. No saved promotion evidence is
  // reused, and cancellation must not restore either environment.
  const observed = {
    staging: { backend: "1".repeat(40), frontend: "2".repeat(40) },
    prod: { backend: "3".repeat(40), frontend: "4".repeat(40) }
  };
  releaseClient.environmentVersions = async (environment) => ({
    ...observed[environment]
  });
  releaseClient.integrate = async () =>
    assert.fail("cancellation must not integrate");
  releaseClient.run = async () =>
    assert.fail("cancellation must not deploy or test");
  releaseClient.restore = async () =>
    assert.fail("cancellation must not restore");
  calls.length = 0;
  return { batch, calls, options, observed };
}

async function interruptedFirstStagingFixture() {
  const batch = await frontendOnlyProductionBatch();
  const calls = [];
  const releaseClient = client(calls);
  releaseClient.integrate = async ({
    record,
    candidate,
    expectedBase,
    save
  }) => {
    assert.equal(record.step.id, "staging:integrate:frontend");
    record.base = expectedBase;
    record.target_branch = "1a-staging";
    record.branch = `codex/release-${record.release_id}-staging-frontend`;
    record.integration_version = 1;
    record.integration_input = integrationCommitInput(record, candidate);
    record.integration_commit = serviceHash(record.integration_input).slice(
      0,
      40
    );
    record.number = 42;
    record.url =
      "https://github.com/6529-Collections/release-coordinator-test-frontend/pull/42";
    record.state = "checking";
    await save();
    throw new ServiceError("release-source", "Source gate is not established.");
  };
  const options = {
    batch,
    client: releaseClient,
    operator: { id: "456", login: "tester" },
    guard: async () => {},
    save: async () => validateReleaseExecution(batch.execution, batch)
  };
  await assert.rejects(
    executeRelease(options),
    (error) => error instanceof ServiceError && error.code === "release-source"
  );
  assert.equal(batch.execution.status, "running");
  assert.equal(batch.execution.step_index, 0);
  assert.deepEqual(Object.keys(batch.execution.operations), [
    "staging:integrate:frontend"
  ]);
  const observed = {
    staging: { backend: "1".repeat(40), frontend: "2".repeat(40) },
    prod: { backend: "3".repeat(40), frontend: "4".repeat(40) }
  };
  releaseClient.environmentVersions = async (environment) => ({
    ...observed[environment]
  });
  releaseClient.cancelIntegration = async ({ record }) => {
    calls.push("cancel:owned-pr");
    record.cleanup = "removed";
    return { status: "failed", kind: "review-stop", url: record.url };
  };
  releaseClient.integrate = async () =>
    assert.fail("cancellation must not retry integration");
  releaseClient.run = async () =>
    assert.fail("cancellation must not deploy or test");
  releaseClient.restore = async () =>
    assert.fail("cancellation must not restore shared code");
  calls.length = 0;
  return { batch, calls, options, observed };
}

test("an interrupted first staging checkpoint cancels without promoting old proof or touching moved refs", async () => {
  const { batch, calls, options, observed } =
    await interruptedFirstStagingFixture();
  const attempts = structuredClone(batch.attempts);
  const plan = structuredClone(batch.execution.plan);
  const versions = structuredClone(batch.execution.versions);
  const operationId = batch.execution.operations[plan.steps[0].id].id;
  const cancelled = await executeRelease({
    ...options,
    cancelKeepCurrent: true
  });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(calls, ["cancel:owned-pr"]);
  assert.deepEqual(batch.attempts, attempts);
  assert.deepEqual(cancelled.plan, plan);
  assert.deepEqual(cancelled.versions, versions);
  assert.deepEqual(cancelled.cancellation.observed_before, observed);
  assert.deepEqual(cancelled.cancellation.observed_after, observed);
  assert.equal(cancelled.operations[plan.steps[0].id].id, operationId);
  assert.equal(cancelled.operations[plan.steps[0].id].cleanup, "removed");
  assert.equal(releaseTicketResult(batch, 1).code, "release-cancelled");
  assert.equal(releaseTicketResult(batch, 1).status, "closed");
  assert.doesNotThrow(() => validateReleaseExecution(cancelled, batch));
  await executeRelease(options);
  assert.deepEqual(calls, ["cancel:owned-pr"]);
});

test("interrupted first-checkpoint cancellation saves intent before cleanup and resumes only cancellation", async () => {
  const { batch, calls, options } = await interruptedFirstStagingFixture();
  await assert.rejects(
    executeRelease({
      ...options,
      cancelKeepCurrent: true,
      save: async (message) => {
        validateReleaseExecution(batch.execution, batch);
        if (message === "cancel release while keeping current code")
          throw new Error("lost first-checkpoint cancellation save");
      }
    }),
    /lost first-checkpoint cancellation save/u
  );
  assert.equal(batch.execution.status, "cancelling");
  assert.deepEqual(calls, []);
  const resumed = await executeRelease(options);
  assert.equal(resumed.status, "cancelled");
  assert.deepEqual(calls, ["cancel:owned-pr"]);
});

test("first-checkpoint cancellation retains its intent after uncertain cleanup", async () => {
  const { batch, calls, options } = await interruptedFirstStagingFixture();
  const cancel = options.client.cancelIntegration;
  options.client.cancelIntegration = async () => {
    throw new Error("lost first-checkpoint cleanup response");
  };
  await assert.rejects(
    executeRelease({ ...options, cancelKeepCurrent: true }),
    /lost first-checkpoint cleanup response/u
  );
  assert.equal(batch.execution.status, "cancelling");
  assert.equal(batch.execution.completed_at, null);
  assert.deepEqual(calls, []);
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
  options.client.cancelIntegration = cancel;
  const resumed = await executeRelease(options);
  assert.equal(resumed.status, "cancelled");
  assert.deepEqual(calls, ["cancel:owned-pr"]);
});

test("first-checkpoint cancellation refuses later operations, uncertain stages and database effects", async () => {
  const { batch, calls } = await interruptedFirstStagingFixture();
  for (const change of [
    (value) => {
      value.execution.step_index = 1;
    },
    (value) => {
      value.execution.operations.other = { step: { environment: "staging" } };
    },
    (value) => {
      value.execution.operations.other = { step: { environment: "prod" } };
    },
    (value) => {
      value.execution.operations["staging:integrate:frontend"].state =
        "merging";
    },
    (value) => {
      value.execution.operations["staging:integrate:frontend"].state = "merged";
    },
    (value) => {
      value.execution.operations["staging:integrate:frontend"].state =
        "creating-pr";
    },
    (value) => {
      value.execution.operations["staging:integrate:frontend"].result = {
        status: "passed"
      };
    },
    (value) => {
      value.execution.recovery = {};
    },
    (value) => {
      value.execution.staging_drift = {};
    },
    (value) => {
      value.execution.manual_stop = {};
    },
    (value) => {
      value.execution.status = "prepared";
    },
    (value) => {
      value.execution.status = "needs-human";
    },
    (value) => {
      value.execution.status = "cancelling";
    },
    (value) => {
      value.attempts.find(
        (attempt) => attempt.phase === "git"
      ).result.service_plan.database.observed = "yes";
    }
  ]) {
    const unsafe = structuredClone(batch);
    change(unsafe);
    assert.throws(
      () => assertCancellableRelease(unsafe.execution, unsafe),
      (error) => error instanceof ServiceError
    );
  }
  assert.deepEqual(calls, []);
});

test("explicit cancellation preserves moved staging/main and closes, not completes, the ticket", async () => {
  const { batch, calls, options, observed } =
    await cancellableProductionFixture();
  const savedVersions = structuredClone(batch.execution.versions);
  const cancelled = await executeRelease({
    ...options,
    cancelKeepCurrent: true
  });
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(calls, ["cancel:owned-pr"]);
  assert.deepEqual(cancelled.versions, savedVersions);
  assert.deepEqual(cancelled.cancellation.observed_before, observed);
  assert.deepEqual(cancelled.cancellation.observed_after, observed);
  assert.equal(cancelled.recovery, undefined);
  assert.equal(cancelled.review_pause, undefined);
  assert.equal(releaseTicketResult(batch, 1).code, "release-cancelled");
  assert.equal(releaseTicketResult(batch, 1).status, "closed");
  assert.equal(releaseTicketResult(batch, 1).batch_status, "passed");
  assert.equal(cancelled.cancellation.mode, "keep-current");
  const cleaned = cancelled.operations["prod:integrate:frontend"];
  assert.equal(cleaned.cleanup_reason, "review-stop");
  assert.equal(cleaned.result.status, "failed");
  assert.equal(cleaned.result.kind, "review-stop");
  const laterStale = structuredClone(batch);
  laterStale.stop = { status: "stale" };
  assert.equal(releaseTicketResult(laterStale, 1).code, "release-cancelled");
  assert.doesNotThrow(() => validateReleaseExecution(cancelled, batch));
  await executeRelease(options);
  assert.deepEqual(calls, ["cancel:owned-pr"]);
  for (const change of [
    (value) => {
      value.cancellation = undefined;
    },
    (value) => {
      value.cancellation.observed_after = undefined;
    },
    (value) => {
      delete value.cancellation.observed_after.prod;
    },
    (value) => {
      delete value.cancellation.observed_before.staging.frontend;
    },
    (value) => {
      value.cancellation.step_id = "prod:deploy:frontend:frontend";
    },
    (value) => {
      value.cancellation.requested_at = "later";
    },
    (value) => {
      value.operations["prod:integrate:frontend"].cleanup = "pending";
    },
    (value) => {
      value.status = "running";
    },
    (value) => {
      value.cancellation.actor = null;
    },
    (value) => {
      value.cancellation.actor.login = "invalid actor";
    }
  ]) {
    const corrupted = structuredClone(cancelled);
    change(corrupted);
    assert.throws(() => validateReleaseExecution(corrupted, batch));
  }
});

test("cancellation can take over an interrupted review-stop, saves intent, and ordinary resume only cancels", async () => {
  const { batch, calls, options } = await cancellableProductionFixture();
  batch.execution.status = "running";
  delete batch.execution.review_pause;
  batch.execution.operations["prod:integrate:frontend"].cleanup_reason =
    "review-stop";
  await assert.rejects(
    executeRelease({
      ...options,
      cancelKeepCurrent: true,
      save: async (message) => {
        assert.doesNotThrow(() =>
          validateReleaseExecution(batch.execution, batch)
        );
        if (message === "cancel release while keeping current code")
          throw new Error("lost cancellation save response");
      }
    }),
    /lost cancellation save response/u
  );
  assert.equal(batch.execution.status, "cancelling");
  assert.deepEqual(calls, []);
  const resumed = await executeRelease(options);
  assert.equal(resumed.status, "cancelled");
  assert.deepEqual(calls, ["cancel:owned-pr"]);
  assert.doesNotThrow(() => validateReleaseExecution(resumed, batch));
});

test("uncertain cancellation cleanup keeps the saved intent and refuses a terminal result", async () => {
  const { batch, options } = await cancellableProductionFixture();
  options.client.cancelIntegration = async () => {
    throw new Error("lost cleanup response");
  };
  await assert.rejects(
    executeRelease({ ...options, cancelKeepCurrent: true }),
    /lost cleanup response/u
  );
  assert.equal(batch.execution.status, "cancelling");
  assert.equal(batch.execution.completed_at, null);
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
  options.client.cancelIntegration = async () => ({
    status: "passed",
    kind: "merge"
  });
  await assert.rejects(executeRelease(options), /cleanup was not confirmed/u);
  assert.equal(batch.execution.status, "cancelling");
  options.client.cancelIntegration = async () => ({
    status: "failed",
    kind: "review-stop"
  });
  await assert.rejects(executeRelease(options), /cleanup was not confirmed/u);
  assert.equal(batch.execution.status, "cancelling");
  assert.equal(batch.execution.completed_at, null);
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
});

test("a cancelling journal without its saved stop choice is rejected as invalid state", async () => {
  const { batch, options } = await cancellableProductionFixture();
  options.client.cancelIntegration = async () => {
    throw new Error("interrupted cleanup");
  };
  await assert.rejects(
    executeRelease({ ...options, cancelKeepCurrent: true }),
    /interrupted cleanup/u
  );
  assert.equal(batch.execution.status, "cancelling");
  const corrupted = structuredClone(batch.execution);
  delete corrupted.operations["prod:integrate:frontend"].cleanup_reason;
  assert.throws(
    () => validateReleaseExecution(corrupted, batch),
    (error) => error instanceof ServiceError && error.code === "release-state"
  );
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
});

test("cancelled batch projection preserves terminal decisions of non-selected inputs", async () => {
  const { batch, options } = await cancellableProductionFixture();
  await executeRelease({ ...options, cancelKeepCurrent: true });
  // Exercise only the finished-batch projection: one selected ticket and an
  // already closed input outside the selected group.
  const active = {
    ...batch,
    inputs: [...batch.inputs, { ...batch.inputs[0], number: 2 }]
  };
  const unselected = {
    number: 2,
    decision: {
      status: "closed",
      reasons: [{ code: "outdated-commit", message: "Already closed." }]
    }
  };
  const original = structuredClone(unselected.decision);
  const selected = {
    number: 1,
    decision: { status: "closed", reasons: [] }
  };
  const result = await coordinateInboxBatch({
    items: [selected, unselected],
    state: { batches: { [active.fingerprint]: active } },
    run: { batch_fingerprint: active.fingerprint },
    profile: sandboxProfile,
    release: async () => assert.fail("A cancelled release cannot restart")
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.release_executed, false);
  assert.equal(selected.decision.status, "closed");
  assert.ok(
    selected.decision.reasons.some(
      (reason) => reason.code === "release-cancelled"
    )
  );
  assert.deepEqual(unselected.decision, original);
  assert.equal(releaseTicketResult(active, 2), null);
});

test("post-cleanup observation failure keeps cancellation resumable without promotion", async () => {
  const { batch, calls, options } = await cancellableProductionFixture();
  const cleanup = options.client.cancelIntegration;
  options.client.cancelIntegration = async (args) => {
    args.record.state = "cleaning";
    await args.save();
    const result = await cleanup(args);
    await args.save();
    return result;
  };
  const observe = options.client.environmentVersions;
  let observations = 0;
  options.client.environmentVersions = async (environment) => {
    if (++observations === 3) throw new Error("lost post-cleanup ref read");
    return observe(environment);
  };
  const record = batch.execution.operations["prod:integrate:frontend"];
  await assert.rejects(
    executeRelease({ ...options, cancelKeepCurrent: true }),
    /lost post-cleanup ref read/u
  );
  assert.deepEqual(calls, ["cancel:owned-pr"]);
  assert.equal(batch.execution.status, "cancelling");
  assert.equal(batch.execution.completed_at, null);
  assert.equal(
    batch.execution.operations["prod:integrate:frontend"].cleanup,
    "removed"
  );
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
  const resumed = await executeRelease(options);
  assert.equal(resumed.status, "cancelled");
  assert.equal(resumed.operations["prod:integrate:frontend"].id, record.id);
  assert.equal(resumed.operations["prod:integrate:frontend"].number, 42);
  assert.deepEqual(calls, ["cancel:owned-pr", "cancel:owned-pr"]);
  assert.doesNotThrow(() => validateReleaseExecution(resumed, batch));
});

test("keep-current cancellation without saved release execution refuses before product or ticket work", async () => {
  const h = harness(1);
  h.options.release = async () => {
    throw new Error("interrupted before release execution");
  };
  await assert.rejects(
    processInbox(h.options),
    /interrupted before release execution/u
  );
  const original = structuredClone(h.f.state());
  const issues = structuredClone(h.f.issues);
  const eventCount = h.events.length;
  assert.ok(original.lock.run_id);
  const saved = original.batches[original.lock.batch_fingerprint];
  assert.equal(saved.execution, undefined);
  await assert.rejects(
    processInbox({
      ...h.options,
      resume: original.lock.run_id,
      cancelKeepCurrent: true
    }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "release-cancel" &&
      error.message === "No saved release to cancel."
  );
  // Resuming renews the journal lease before checking the requested action.
  // That normal lease write must not clear ownership or alter tickets/batches.
  const current = h.f.state();
  assert.equal(current.lock.run_id, original.lock.run_id);
  assert.equal(current.lock.batch_fingerprint, original.lock.batch_fingerprint);
  assert.deepEqual(current.lock.scope, original.lock.scope);
  assert.deepEqual(current.batches, original.batches);
  assert.deepEqual(current.tickets, original.tickets);
  assert.deepEqual(h.f.issues, issues);
  assert.equal(h.events.length, eventCount);
});

test("processor cancellation exclusivity is checked before acquiring a journal lease", async () => {
  for (const options of [
    {},
    { resume: "saved-run", reviewStop: true },
    { resume: "saved-run", stagingChange: "restore" }
  ])
    await assert.rejects(
      processInbox({ cancelKeepCurrent: true, ...options }),
      (error) =>
        error instanceof ServiceError && error.code === "release-cancel"
    );
});

test("cancellation refuses DB changes, uncertain merges, other production steps, and conflicting choices", async () => {
  const { batch, options } = await cancellableProductionFixture();
  for (const change of [
    (value) => {
      value.execution.operations["prod:integrate:frontend"].state = "merging";
    },
    (value) => {
      value.execution.status = "running";
      delete value.execution.review_pause;
    },
    (value) => {
      value.execution.operations.other = { step: { environment: "prod" } };
    },
    (value) => {
      value.execution.recovery = {};
    },
    (value) => {
      value.execution.staging_drift = {};
    },
    (value) => {
      value.attempts.find(
        (attempt) => attempt.phase === "git"
      ).result.service_plan.database.observed = "yes";
    }
  ]) {
    const unsafe = structuredClone(batch);
    change(unsafe);
    await assert.rejects(
      executeRelease({ ...options, batch: unsafe, cancelKeepCurrent: true })
    );
  }
  await assert.rejects(
    executeRelease({ ...options, cancelKeepCurrent: true, reviewStop: true }),
    /cannot be combined/u
  );
  await assert.rejects(
    executeRelease({
      ...options,
      cancelKeepCurrent: true,
      stagingChange: "restore"
    }),
    /cannot be combined/u
  );
  await assert.rejects(
    executeRelease({
      ...options,
      cancelKeepCurrent: true,
      operator: undefined
    }),
    /verified operator/u
  );
});

for (const interrupted of [false, true]) {
  test(`${interrupted ? "interrupted first checkpoint" : "review-paused"}: cancelled multi-ticket attempt closes every selected ticket and releases the normal inbox lock`, async () => {
    const h = harness(2);
    let closed = false;
    const releaseClient = client([]);
    releaseClient.integrate = async ({
      record,
      candidate,
      expectedBase,
      save
    }) => {
      record.base = expectedBase;
      record.target_branch = "1a-staging";
      record.branch = `codex/release-${record.release_id}-staging-${record.step.role}`;
      record.integration_version = 1;
      record.integration_input = integrationCommitInput(record, candidate);
      record.integration_commit = serviceHash(record.integration_input).slice(
        0,
        40
      );
      record.number = 42;
      record.url =
        "https://github.com/6529-Collections/release-coordinator-test-backend/pull/42";
      record.state = "checking";
      if (interrupted) {
        await save();
        throw new ServiceError(
          "release-source",
          "Source gate is not established."
        );
      }
      return { status: "waiting-review", url: record.url };
    };
    releaseClient.cancelIntegration = async ({ record }) => {
      closed = true;
      record.cleanup = "removed";
      return { status: "failed", kind: "review-stop", url: record.url };
    };
    h.options.release = (options) =>
      executeRelease({ ...options, client: releaseClient });
    let runId;
    if (interrupted) {
      await assert.rejects(
        processInbox(h.options),
        /Source gate is not established/u
      );
      runId = h.f.state().lock.run_id;
      assert.equal(
        h.f.state().batches[h.f.state().lock.batch_fingerprint].execution
          .status,
        "running"
      );
    } else {
      const paused = await processInbox(h.options);
      assert.equal(paused.batch.status, "awaiting-review");
      runId = paused.run_id;
    }
    assert.equal(h.f.state().lock.run_id, runId);
    const cancelled = await processInbox({
      ...h.options,
      resume: runId,
      cancelKeepCurrent: true
    });
    assert.equal(cancelled.batch.status, "cancelled");
    assert.equal(cancelled.release_executed, false);
    assert.equal(closed, true);
    assert.equal(h.f.state().lock, null);
    assert.equal(cancelled.requests.length, 2);
    assert.equal(inboxRunExitCode(cancelled), 0);
    const history = h.f.state().history.batches[cancelled.batch.fingerprint];
    assert.equal(history.status, "cancelled");
    assert.equal(h.f.state().batches[cancelled.batch.fingerprint], undefined);
    const savedArchive = h.f.file(history.path);
    const savedBatch = verifyArchive(
      savedArchive,
      "batches",
      cancelled.batch.fingerprint,
      history,
      sandboxProfile
    );
    assert.equal(savedBatch.execution.status, "cancelled");
    const laterStale = structuredClone(savedBatch);
    laterStale.stop = {
      status: "stale",
      kind: "inputs",
      message: "Old source inputs changed after cancellation."
    };
    assert.doesNotThrow(() =>
      validateBatchHistory(
        { [laterStale.fingerprint]: laterStale },
        sandboxProfile
      )
    );
    const unfinishedStale = structuredClone(laterStale);
    unfinishedStale.execution.status = "cancelling";
    unfinishedStale.execution.completed_at = null;
    assert.throws(
      () =>
        validateBatchHistory(
          { [unfinishedStale.fingerprint]: unfinishedStale },
          sandboxProfile
        ),
      /stale batches can retain only terminal evidence/u
    );
    const cancelling = structuredClone(savedBatch);
    cancelling.execution.status = "cancelling";
    cancelling.execution.completed_at = null;
    const pendingState = {
      tickets: {},
      batches: { [cancelling.fingerprint]: cancelling }
    };
    assert.deepEqual(archiveFinished(pendingState, sandboxProfile), []);
    assert.ok(pendingState.batches[cancelling.fingerprint]);
    assert.equal(
      pendingState.history?.batches?.[cancelling.fingerprint],
      undefined
    );
    assert.equal(
      savedBatch.execution.operations["staging:integrate:backend"].cleanup,
      "removed"
    );
    const unfinished = structuredClone(savedBatch);
    unfinished.execution.operations["staging:integrate:backend"].cleanup =
      "pending";
    const unsafeState = {
      tickets: h.f.state().tickets,
      batches: { [unfinished.fingerprint]: unfinished }
    };
    assert.throws(() => archiveFinished(unsafeState, sandboxProfile));
    assert.ok(unsafeState.batches[unfinished.fingerprint]);
    for (const item of cancelled.requests) {
      assert.equal(item.status, "closed");
      assert.equal(item.applied, true);
      assert.equal(h.f.issues[item.issue_number - 1].state, "closed");
      assert.ok(
        h.f.issues[item.issue_number - 1].labels.some(
          (label) => (label.name ?? label) === "reason:release-cancelled"
        )
      );
    }
  });
}

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

  // New staging preparations remain separate from the selected main candidate.
  record.base = "b".repeat(40);
  record.profile = execution.plan.profile;
  record.integration_version = 2;
  record.staging_preparation = {
    version: "staging-merge-v1",
    profile: record.profile,
    role: step.role,
    base: record.base,
    base_tree: "c".repeat(40),
    candidate_commit: candidate.commit,
    candidate_tree: candidate.tree,
    tree: "7".repeat(40),
    patch: [
      {
        path: "changed.txt",
        mode: "100644",
        type: "blob",
        sha: "f".repeat(40)
      }
    ]
  };
  assert.notEqual(record.staging_preparation.tree, candidate.tree);
  record.integration_input = integrationCommitInput(record, candidate);
  assert.deepEqual(record.integration_input.parents, [
    record.base,
    candidate.commit
  ]);
  assert.equal(record.integration_input.tree, record.staging_preparation.tree);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
  for (const mutate of [
    (value) => {
      value.staging_preparation.candidate_commit = "0".repeat(40);
    },
    (value) => {
      value.integration_input.parents.reverse();
    },
    (value) => {
      value.integration_version = 1;
    },
    (value) => {
      value.checked_tree = candidate.tree;
    },
    (value) => {
      value.staging_preparation = null;
    }
  ]) {
    const bad = structuredClone(execution);
    mutate(bad.operations[step.id]);
    assert.throws(() => validateReleaseExecution(bad, batch));
  }
  record.state = "commit-prepared";
  delete record.integration_commit;
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

test("a staging merge conflict reaches the log, final stop and ticket explanation without running later steps", async (t) => {
  const batch = await selectedBatch();
  const calls = [];
  const adapter = client(calls);
  const conflicts = ["src/quote.test.txt", "src/composer.test.txt"];
  adapter.integrate = async ({ record }) => {
    calls.push(record.step.id);
    return {
      status: "failed",
      kind: "merge-conflict",
      commit: null,
      url: null,
      conflicts,
      message: `Staging has merge conflicts: ${conflicts.join(", ")}. No shared branch was changed.`
    };
  };
  const root = await mkdtemp(path.join(os.tmpdir(), "release-conflict-log-"));
  let log;
  t.after(async () => {
    log?.close();
    await rm(root, { recursive: true, force: true });
  });
  let terminal = "";
  log = createRunLog({
    root,
    profile: sandboxProfile,
    env: {},
    stderr: (text) => {
      terminal += text;
    }
  });
  batch.execution = await log.run(() =>
    executeRelease({
      batch,
      client: adapter,
      guard: async () => {},
      save: async () => {}
    })
  );
  const contents = (await readFile(log.snapshot().file, "utf8")).trim();
  assert.ok(
    contents,
    "Expected durable release log events after run resolved."
  );
  const events = contents.split("\n").map(JSON.parse);
  const failed = events.find(
    (event) => event.step === "release.integrate" && event.outcome === "failed"
  );
  assert.ok(failed);
  for (const name of conflicts) {
    assert.ok(failed.message.includes(name));
    assert.ok(terminal.includes(name));
  }
  assert.match(failed.message, /a person must resolve/u);
  assert.equal(batch.execution.status, "needs-human");
  assert.deepEqual(calls, ["staging:integrate:backend"]);
  assert.match(
    batch.execution.message,
    /merge conflicts: src\/quote.test.txt, src\/composer.test.txt/u
  );
  assert.doesNotMatch(batch.execution.message, /checks failed/u);
  const projected = releaseTicketResult(batch, batch.selected[0]);
  assert.equal(projected.message, batch.execution.message);
  assert.equal(projected.code, "release-failed");
  assert.doesNotThrow(() => validateReleaseExecution(batch.execution, batch));
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
