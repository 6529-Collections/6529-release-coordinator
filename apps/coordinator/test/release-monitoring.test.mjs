import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { processInbox } from "../src/inbox-processor.mjs";
import {
  executeRelease,
  releaseTicketResult
} from "../src/release-execution.mjs";
import {
  integrationCommitInput,
  operationForStep
} from "../src/release-plan.mjs";
import { validateReleaseExecution } from "../src/release-state.mjs";
import { validateBatchHistory } from "../src/batch-state.mjs";
import { createReleaseGitHub } from "../src/release-github.mjs";
import { inspectReadiness } from "../src/readiness.mjs";
import { decideTicket } from "../src/inbox-policy.mjs";
import { buildServicePlan } from "../src/service-plan.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { serviceHash } from "../src/service-contract.mjs";
import {
  makeReleaseBuild,
  makeReleaseOperation,
  monitoringTemplate,
  releaseBuildFiles,
  releaseBuildRoles,
  releaseBuildSourceRole,
  releaseHash,
  releaseMonitoringPaths,
  releaseProtocol,
  validateReleaseOperation,
  verifyReleaseReport
} from "../src/release-contract.mjs";
import {
  buildApplication,
  generateMonitoring,
  verifyApplicationBuild
} from "../sandbox/application-build.mjs";
import { runSandboxReleaseOperation } from "../sandbox/release-run.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import { monitoringFiles } from "../sandbox/monitoring-fixtures.mjs";
import { harness } from "./inbox-batch-harness.mjs";
import { serviceFixture } from "./service-fixture.mjs";
import { fixture as batchGitHubFixture } from "./batch-github-fixture.mjs";
import { batchFixture } from "./batch-fixture.mjs";

const ids = {
  release_id: "11111111-1111-4111-8111-111111111111",
  operation_id: "22222222-2222-4222-8222-222222222222"
};
const commits = {
  backend_commit: "b".repeat(40),
  frontend_commit: "f".repeat(40)
};
const monitoringOperation = (overrides = {}) =>
  makeReleaseOperation({
    ...ids,
    operation: "monitoring",
    environment: "prod",
    role: "backend",
    unit: "monitoring",
    ...commits,
    monitoring_environment: "staging",
    ...overrides
  });
const fileHash = (name) => createHash("sha256").update(name).digest("hex");
const fakeBuilds = (operation) =>
  Object.fromEntries(
    releaseBuildRoles(operation).map((role) => [
      role,
      {
        manifest: makeReleaseBuild({
          role,
          source_commit: operation[`${releaseBuildSourceRole(role)}_commit`],
          files: releaseBuildFiles[role].map((name) => ({
            path: name,
            sha256: fileHash(name),
            bytes: 1
          }))
        }),
        artifact: {
          name: `sandbox-build-${operation.operation_id}-${role}`,
          digest: `sha256:${"b".repeat(64)}`
        }
      }
    ])
  );
function fakeReport(record, status = "passed", runId = 100) {
  const operation = record.operation;
  const runnerRole = operation.operation === "e2e" ? "backend" : operation.role;
  const template =
    operation.operation === "monitoring"
      ? monitoringTemplate(operation.monitoring_environment)
      : null;
  const value = {
    protocol: releaseProtocol,
    profile: "sandbox",
    release_id: operation.release_id,
    operation_id: operation.operation_id,
    operation_hash: operation.fingerprint,
    operation: operation.operation,
    environment: operation.environment,
    role: operation.role,
    unit: operation.unit,
    status,
    checks: [{ name: "fixture", status }],
    builds: status === "passed" ? fakeBuilds(operation) : {},
    ...(operation.operation === "monitoring"
      ? {
          installed:
            status === "passed"
              ? {
                  environment: operation.monitoring_environment,
                  source_commit: operation.backend_commit,
                  template,
                  sha256: fileHash(template)
                }
              : null
        }
      : {}),
    versions: {
      backend: operation.backend_commit,
      frontend: operation.frontend_commit
    },
    runner: {
      repository: sandboxProfile.repositories[runnerRole].full_name,
      run_id: runId,
      attempt: 1,
      commit: operation[`${runnerRole}_commit`]
    },
    completed_at: "2026-09-17T12:00:00.000Z"
  };
  verifyReleaseReport(value, operation);
  return value;
}
function client(calls, { failStep, interruptAt } = {}) {
  let runId = 100;
  const versions = { backend: "b".repeat(40), frontend: "b".repeat(40) };
  return {
    identity: async () => ({
      actor: { id: "456", login: "tester" },
      runtime: {
        backend: { workflow_id: 201 },
        frontend: { workflow_id: 202 }
      },
      versions: { staging: { ...versions }, prod: { ...versions } }
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
      return {
        status: "passed",
        kind: "merge",
        commit: record.integration_commit,
        tree: record.restore_tree,
        url: "https://example.invalid/restore"
      };
    },
    verifyRestoredStaging: async ({ versions: saved, trees, prodVersions }) => {
      calls.push("verify:restored-staging");
      return {
        staging: { ...saved },
        prod: { ...prodVersions },
        trees: {
          backend: trees.backend ?? "b".repeat(40),
          frontend: trees.frontend ?? "b".repeat(40)
        }
      };
    },
    verifyRestoredEnvironments: async ({ versions: saved, trees }) => {
      calls.push("verify:restored-environments");
      return {
        prod: { ...saved.prod },
        staging: { ...saved.staging },
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
      if (record.step.id === interruptAt) throw new Error("interrupted");
      calls.push(record.step.id);
      const status = record.step.id === failStep ? "failed" : "passed";
      const value = fakeReport(record, status, runId++);
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
async function monitoringBatch({ target = "production" } = {}) {
  const h = harness(1, { monitoringTickets: [1] });
  await processInbox(h.options);
  const reference = Object.values(h.f.state().history.batches)[0];
  const batch = structuredClone(h.f.file(reference.path).record);
  delete batch.execution;
  if (target === "production") {
    for (const input of batch.inputs) input.target = "production";
    batch.fingerprint = serviceHash({
      inputs: batch.inputs,
      policy: batch.policy
    });
  }
  return batch;
}
const execute = (batch, options) =>
  executeRelease({
    batch,
    guard: async () => {},
    save: async () => {},
    ...options
  });

// ---------------------------------------------------------------- contract

test("a monitoring operation belongs to the prod stage and names its monitoring environment", () => {
  const operation = monitoringOperation();
  assert.equal(operation.monitoring_environment, "staging");
  assert.doesNotThrow(() => validateReleaseOperation(operation));
  assert.doesNotThrow(() =>
    monitoringOperation({ monitoring_environment: "prod" })
  );
  for (const overrides of [
    { environment: "staging" },
    { unit: "worker" },
    { role: "frontend" },
    { monitoring_environment: "test" },
    { monitoring_environment: undefined }
  ])
    assert.throws(
      () => monitoringOperation(overrides),
      /Invalid sandbox release operation/u,
      JSON.stringify(overrides)
    );
  const deploy = makeReleaseOperation({
    ...ids,
    operation: "deploy",
    environment: "prod",
    role: "backend",
    unit: "api",
    ...commits
  });
  assert.equal(Object.hasOwn(deploy, "monitoring_environment"), false);
  const { fingerprint: _ignored, ...contents } = deploy;
  const tampered = { ...contents, monitoring_environment: "staging" };
  assert.throws(
    () =>
      validateReleaseOperation({
        ...tampered,
        fingerprint: releaseHash(tampered)
      }),
    /Invalid sandbox release operation/u
  );
});

test("a monitoring report binds the installed template to its build and the exact backend commit", () => {
  const operation = monitoringOperation();
  const record = { operation };
  const passed = fakeReport(record);
  assert.equal(passed.installed.template, "monitoring-staging.json");
  const reject = (mutate, message) => {
    const report = structuredClone(passed);
    mutate(report);
    assert.throws(
      () => verifyReleaseReport(report, operation),
      /does not match its saved operation/u,
      message
    );
  };
  reject((report) => {
    report.installed.sha256 = "0".repeat(64);
  }, "template hash");
  reject((report) => {
    report.installed.environment = "prod";
    report.installed.template = "monitoring-prod.json";
    report.installed.sha256 = fileHash("monitoring-prod.json");
  }, "other environment");
  reject((report) => {
    report.installed.source_commit = "f".repeat(40);
  }, "other source");
  reject((report) => {
    delete report.installed;
  }, "missing installed");
  reject((report) => {
    report.builds.monitoring.manifest = makeReleaseBuild({
      role: "monitoring",
      source_commit: "f".repeat(40),
      files: report.builds.monitoring.manifest.files
    });
  }, "frontend commit as monitoring source");
  reject((report) => {
    report.builds.monitoring.manifest = makeReleaseBuild({
      role: "backend",
      source_commit: operation.backend_commit,
      files: releaseBuildFiles.backend.map((name) => ({
        path: name,
        sha256: fileHash(name),
        bytes: 1
      }))
    });
  }, "backend manifest under the monitoring key");
  assert.equal(fakeReport(record, "failed").installed, null);
  const deploy = makeReleaseOperation({
    ...ids,
    operation: "deploy",
    environment: "prod",
    role: "backend",
    unit: "api",
    ...commits
  });
  const deployReport = fakeReport({ operation: deploy });
  assert.equal(Object.hasOwn(deployReport, "installed"), false);
  assert.throws(
    () => verifyReleaseReport({ ...deployReport, installed: null }, deploy),
    /does not match its saved operation/u
  );
});

// ------------------------------------------------------------ build/runner

async function monitoringCandidate(
  root,
  files = monitoringFiles(),
  commit = "b".repeat(40)
) {
  const backend = path.join(root, "candidates", "backend");
  for (const [name, text] of Object.entries({
    ...sampleFiles().backend,
    ...files
  })) {
    await mkdir(path.dirname(path.join(backend, name)), { recursive: true });
    await writeFile(path.join(backend, name), text);
  }
  const opsRoot = path.join(backend, "ops", "monitoring");
  const manifest = await buildApplication("monitoring", {
    root: opsRoot,
    sourceCommit: commit
  });
  return { opsRoot, manifest };
}
const monitoringOutcome = () => ({
  monitoring: { build: "success", artifact: "success", digest: "a".repeat(64) }
});
const runner = {
  repository: sandboxProfile.repositories.backend.full_name,
  run_id: 123,
  attempt: 1,
  commit: "b".repeat(40)
};

test("the sample monitoring build generates from the catalog and rejects a stale inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-monitoring-"));
  try {
    const { opsRoot, manifest } = await monitoringCandidate(root);
    assert.equal(manifest.role, "monitoring");
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      [...releaseBuildFiles.monitoring]
    );
    await verifyApplicationBuild(opsRoot, "monitoring", "b".repeat(40));
    const inventory = JSON.parse(
      await readFile(path.join(opsRoot, "dist", "monitoring-staging.json"))
    );
    assert.deepEqual(inventory.functions, [
      "api",
      "dbMigrationsLoop",
      "worker"
    ]);
    assert.equal(inventory.alarms.length, 6);
    assert.equal(inventory.alarms[0].name, "staging-api-Errors");
    const alarms = path.join(opsRoot, "src", "alarms.json");
    await writeFile(
      alarms,
      `${JSON.stringify({ alarms: [{ metric: "Duration", threshold: 300 }] })}\n`
    );
    await assert.rejects(
      buildApplication("monitoring", {
        root: opsRoot,
        sourceCommit: "b".repeat(40)
      }),
      /stale/u
    );
    assert.deepEqual(await generateMonitoring(opsRoot), ["staging", "prod"]);
    const regenerated = await buildApplication("monitoring", {
      root: opsRoot,
      sourceCommit: "b".repeat(40)
    });
    assert.notEqual(regenerated.fingerprint, manifest.fingerprint);
    await writeFile(
      alarms,
      `${JSON.stringify({ alarms: [{ metric: "Latency", threshold: 1 }] })}\n`
    );
    await assert.rejects(
      buildApplication("monitoring", {
        root: opsRoot,
        sourceCommit: "b".repeat(40)
      }),
      /unsupported/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the sample runner installs monitoring only from test main and binds the installed template", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-monitoring-"));
  try {
    const { manifest } = await monitoringCandidate(root);
    const report = await runSandboxReleaseOperation(monitoringOperation(), {
      root,
      runner,
      outcomes: monitoringOutcome(),
      ref: "refs/heads/main",
      now: () => "2026-09-17T12:00:00.000Z"
    });
    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.checks.map(({ name, status }) => [name, status]),
      [
        ["monitoring:source", "passed"],
        ["build:monitoring", "passed"],
        ["artifact:monitoring", "passed"],
        ["monitoring:staging", "passed"]
      ]
    );
    assert.deepEqual(report.installed, {
      environment: "staging",
      source_commit: "b".repeat(40),
      template: "monitoring-staging.json",
      sha256: manifest.files.find(
        (file) => file.path === "monitoring-staging.json"
      ).sha256
    });
    const staging = await runSandboxReleaseOperation(monitoringOperation(), {
      root,
      runner,
      outcomes: monitoringOutcome(),
      ref: "refs/heads/1a-staging"
    });
    assert.equal(staging.status, "failed");
    assert.equal(staging.checks[0].name, "monitoring:source");
    assert.equal(staging.checks[0].status, "failed");
    assert.equal(staging.installed, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a controlled monitoring deployment failure fails only its environment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-monitoring-"));
  try {
    await monitoringCandidate(
      root,
      monitoringFiles({ failEnvironment: "staging" })
    );
    const staging = await runSandboxReleaseOperation(monitoringOperation(), {
      root,
      runner,
      outcomes: monitoringOutcome(),
      ref: "refs/heads/main"
    });
    assert.equal(staging.status, "failed");
    assert.match(staging.checks.at(-1).message, /Controlled monitoring/u);
    assert.equal(staging.installed, null);
    const prod = await runSandboxReleaseOperation(
      monitoringOperation({ monitoring_environment: "prod" }),
      { root, runner, outcomes: monitoringOutcome(), ref: "refs/heads/main" }
    );
    assert.equal(prod.status, "passed");
    assert.equal(prod.installed.environment, "prod");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing monitoring build outcome is a failed monitoring result", async () => {
  const report = await runSandboxReleaseOperation(monitoringOperation(), {
    runner,
    outcomes: {},
    ref: "refs/heads/main"
  });
  assert.equal(report.status, "failed");
  assert.deepEqual(report.checks, [
    { name: "monitoring:source", status: "passed" },
    {
      name: "build:monitoring",
      status: "failed",
      message: "monitoring npm build has no reported outcome."
    }
  ]);
  assert.equal(report.installed, null);
});

// ------------------------------------------------------- plan and release

test("monitoring deploys after the test-main merge and before production application deployments", async () => {
  const batch = await monitoringBatch();
  const calls = [];
  const execution = await execute(batch, { client: client(calls) });
  assert.equal(execution.status, "completed");
  assert.deepEqual(calls, [
    "staging:integrate:backend",
    "staging:deploy:backend:dbMigrationsLoop",
    "staging:deploy:backend:worker",
    "staging:deploy:backend:api",
    "staging:integrate:frontend",
    "staging:deploy:frontend:frontend",
    "staging:e2e",
    "prod:integrate:backend",
    "prod:monitoring:staging",
    "prod:monitoring:prod",
    "prod:deploy:backend:dbMigrationsLoop",
    "prod:deploy:backend:worker",
    "prod:deploy:backend:api",
    "prod:integrate:frontend",
    "prod:deploy:frontend:frontend",
    "prod:e2e"
  ]);
  const operation = execution.operations["prod:monitoring:staging"].operation;
  assert.equal(operation.operation, "monitoring");
  assert.equal(operation.environment, "prod");
  assert.equal(operation.unit, "monitoring");
  assert.equal(operation.monitoring_environment, "staging");
  assert.equal(
    operation.backend_commit,
    execution.operations["prod:integrate:backend"].result.commit
  );
  assert.equal(
    execution.operations["prod:monitoring:prod"].result.report.installed
      .environment,
    "prod"
  );
  assert.match(
    releaseTicketResult(batch, 1).message,
    /deployed for staging and production/u
  );
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("a staging release records that monitoring waits for production and saves the v6 inputs", async () => {
  const h = harness(1, { monitoringTickets: [1] });
  await processInbox(h.options);
  const reference = Object.values(h.f.state().history.batches)[0];
  const batch = h.f.file(reference.path).record;
  assert.equal(batch.policy.version, "sandbox-batch-v6");
  assert.deepEqual(batch.inputs[0].operational_deployments, ["monitoring"]);
  assert.equal(batch.execution.status, "completed");
  assert.equal(
    batch.execution.plan.steps.some((step) => step.kind === "monitoring"),
    false
  );
  assert.match(releaseTicketResult(batch, 1).message, /not deployed/u);
  assert.doesNotThrow(() =>
    validateBatchHistory({ [batch.fingerprint]: batch }, sandboxProfile)
  );
  for (const value of [
    ["monitoring", "monitoring"],
    ["alerts"],
    "monitoring"
  ]) {
    const changed = structuredClone(batch);
    changed.inputs[0].operational_deployments = value;
    changed.fingerprint = serviceHash({
      inputs: changed.inputs,
      policy: changed.policy
    });
    assert.throws(
      () =>
        validateBatchHistory(
          { [changed.fingerprint]: changed },
          sandboxProfile
        ),
      /scope changed/u,
      JSON.stringify(value)
    );
  }
});

test("a failed monitoring deployment stops before production application deployments and restores both environments", async () => {
  const batch = await monitoringBatch();
  const calls = [];
  const execution = await execute(batch, {
    client: client(calls, { failStep: "prod:monitoring:staging" })
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(execution.recovery.plan.version, 2);
  assert.equal(execution.recovery.status, "completed");
  const failedAt = calls.indexOf("prod:monitoring:staging");
  assert.ok(failedAt > 0);
  assert.ok(
    calls.slice(0, failedAt).every((step) => !step.startsWith("prod:deploy:"))
  );
  assert.equal(calls.includes("prod:monitoring:prod"), false);
  const restore = calls.filter((step) => step.startsWith("restore:"));
  assert.deepEqual(restore.slice(0, 3), [
    "restore:prod:integrate:backend",
    "restore:prod:monitoring:staging",
    "restore:prod:monitoring:prod"
  ]);
  for (const step of [
    "restore:prod:deploy:backend:dbMigrationsLoop",
    "restore:prod:e2e",
    "restore:staging:integrate:backend",
    "restore:staging:integrate:frontend",
    "restore:staging:e2e"
  ])
    assert.ok(restore.includes(step), step);
  assert.ok(
    restore.indexOf("restore:prod:monitoring:prod") <
      restore.indexOf("restore:prod:deploy:backend:dbMigrationsLoop")
  );
  assert.equal(calls.at(-1), "verify:restored-environments");
  assert.equal(releaseTicketResult(batch, 1).code, "release-failed");
  assert.match(execution.message, /prod:monitoring:staging failed/u);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("an interrupted monitoring deployment resumes without dispatching the finished one again", async () => {
  const batch = await monitoringBatch();
  const first = [];
  await assert.rejects(
    execute(batch, {
      client: client(first, { interruptAt: "prod:monitoring:prod" })
    }),
    /interrupted/u
  );
  assert.ok(first.includes("prod:monitoring:staging"));
  assert.equal(
    batch.execution.operations["prod:monitoring:staging"].result.status,
    "passed"
  );
  const second = [];
  const execution = await execute(batch, { client: client(second) });
  assert.equal(execution.status, "completed");
  assert.equal(second[0], "prod:monitoring:prod");
  assert.equal(second.includes("prod:monitoring:staging"), false);
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));
});

test("a batch without monitoring keeps the earlier plan shape", async () => {
  const h = harness(1);
  await processInbox(h.options);
  const reference = Object.values(h.f.state().history.batches)[0];
  const batch = h.f.file(reference.path).record;
  assert.deepEqual(batch.inputs[0].operational_deployments, []);
  assert.deepEqual(
    batch.execution.plan.steps.map((step) => step.id),
    [
      "staging:integrate:backend",
      "staging:deploy:backend:dbMigrationsLoop",
      "staging:deploy:backend:worker",
      "staging:deploy:backend:api",
      "staging:integrate:frontend",
      "staging:deploy:frontend:frontend",
      "staging:e2e"
    ]
  );
  assert.equal(
    batch.execution.plan.steps.some((step) =>
      Object.hasOwn(step, "monitoring_environment")
    ),
    false
  );
  assert.doesNotMatch(releaseTicketResult(batch, 1).message, /monitoring/u);
});

test("monitoring steps produce exact operations while other steps keep their shape", () => {
  const versions = { backend: "b".repeat(40), frontend: "f".repeat(40) };
  const plan = { release_id: ids.release_id };
  const monitoring = operationForStep(
    plan,
    {
      id: "prod:monitoring:prod",
      kind: "monitoring",
      environment: "prod",
      role: "backend",
      unit: "monitoring",
      monitoring_environment: "prod"
    },
    versions,
    ids.operation_id
  );
  assert.equal(monitoring.operation, "monitoring");
  assert.equal(monitoring.monitoring_environment, "prod");
  const deploy = operationForStep(
    plan,
    {
      id: "prod:deploy:backend:api",
      kind: "deploy",
      environment: "prod",
      role: "backend",
      unit: "api"
    },
    versions,
    ids.operation_id
  );
  assert.equal(Object.hasOwn(deploy, "monitoring_environment"), false);
  const e2e = operationForStep(
    plan,
    { id: "prod:e2e", kind: "e2e", environment: "prod", role: null },
    versions,
    ids.operation_id
  );
  assert.equal(e2e.unit, null);
});

// ------------------------------------------------------------------ adapter

const adapterRuntime = {
  workflow: "sandbox-release.yml",
  job: "Sandbox release",
  step: "Run sandbox release operation",
  branches: { staging: "1a-staging", prod: "main" },
  repositories: Object.fromEntries(
    ["backend", "frontend"].map((role, index) => [
      role,
      {
        files: Object.fromEntries(
          [
            ".github/workflows/sandbox-release.yml",
            "coordinator/src/release-contract.mjs",
            "coordinator/sandbox/application-build.mjs",
            "coordinator/sandbox/release-run.mjs"
          ].map((name, position) => [
            name,
            String(index * 4 + position + 1).repeat(40)
          ])
        )
      }
    ])
  )
};
function adapterFixture({ artifacts } = {}) {
  const operation = monitoringOperation();
  const record = {
    id: operation.operation_id,
    release_id: operation.release_id,
    step: {
      id: "prod:monitoring:staging",
      kind: "monitoring",
      environment: "prod",
      role: "backend",
      unit: "monitoring",
      monitoring_environment: "staging"
    },
    state: "running",
    actor: { id: "456", login: "tester" },
    created_at: "2026-09-17T12:00:00.000Z",
    workflow_id: 99,
    operation
  };
  const repo = sandboxProfile.repositories.backend;
  const run = {
    id: 101,
    repository: { id: repo.id, full_name: repo.full_name },
    head_repository: { id: repo.id },
    head_sha: operation.backend_commit,
    head_branch: "main",
    event: "workflow_dispatch",
    run_attempt: 1,
    path: ".github/workflows/sandbox-release.yml",
    display_title: `Sandbox release ${record.id}`,
    actor: { id: 456 },
    workflow_id: 99,
    status: "completed",
    conclusion: "success",
    html_url: "https://example.invalid/run/101"
  };
  const report = fakeReport(record, "passed", 101);
  const job = {
    id: 102,
    name: adapterRuntime.job,
    run_id: run.id,
    head_sha: run.head_sha,
    status: "completed",
    conclusion: "success",
    steps: [
      { name: adapterRuntime.step, status: "completed", conclusion: "success" }
    ]
  };
  const artifactList = artifacts ?? {
    total_count: 1,
    artifacts: [
      {
        id: 5,
        name: report.builds.monitoring.artifact.name,
        digest: report.builds.monitoring.artifact.digest,
        expired: false,
        workflow_run: { id: run.id }
      }
    ]
  };
  const calls = [];
  const client = createReleaseGitHub({
    profile: sandboxProfile,
    runtime: adapterRuntime,
    execute: async (args) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push({ method, endpoint });
      const role = endpoint.includes("release-coordinator-test-frontend")
        ? "frontend"
        : "backend";
      let value;
      if (endpoint.includes("/contents/"))
        value = {
          type: "file",
          path: endpoint.match(/\/contents\/(.+)\?ref=/u)[1],
          sha: adapterRuntime.repositories[role].files[
            endpoint.match(/\/contents\/(.+)\?ref=/u)[1]
          ]
        };
      else if (endpoint.includes("/git/ref/heads/"))
        value = { object: { sha: operation[`${role}_commit`] } };
      else if (endpoint.includes("/runs?"))
        value = { total_count: 1, workflow_runs: [run] };
      else if (endpoint.includes("/attempts/1/jobs"))
        value = { total_count: 1, jobs: [job] };
      else if (endpoint.includes("/artifacts?")) value = artifactList;
      else assert.fail(endpoint);
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify(value)}`;
    },
    logs: async () =>
      `COORDINATOR_RELEASE_RESULT:${Buffer.from(JSON.stringify(report)).toString("base64url")}\n`
  });
  return { client, record, calls, report };
}

test("a monitoring result is accepted only with GitHub's matching artifact for the installed template", async () => {
  const f = adapterFixture();
  const result = await f.client.run({
    record: f.record,
    actor: f.record.actor,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.installed, {
    ...f.report.installed,
    artifact: {
      id: 5,
      name: f.report.builds.monitoring.artifact.name,
      digest: "b".repeat(64)
    }
  });
  assert.ok(
    f.calls.every(({ method }) => method === "GET" || method === "POST")
  );
  const artifactRead = f.calls.findIndex(({ endpoint }) =>
    endpoint.includes("/artifacts?")
  );
  assert.ok(
    artifactRead >
      f.calls.findIndex(({ endpoint }) => endpoint.includes("/jobs"))
  );
  for (const [artifacts, message] of [
    [{ total_count: 0, artifacts: [] }, /no unique artifact/u],
    [
      {
        total_count: 1,
        artifacts: [
          {
            id: 5,
            name: f.report.builds.monitoring.artifact.name,
            digest: `sha256:${"0".repeat(64)}`,
            expired: false,
            workflow_run: { id: 101 }
          }
        ]
      },
      /does not match the verified report/u
    ],
    [
      {
        total_count: 1,
        artifacts: [
          {
            id: 5,
            name: f.report.builds.monitoring.artifact.name,
            digest: f.report.builds.monitoring.artifact.digest,
            expired: true,
            workflow_run: { id: 101 }
          }
        ]
      },
      /does not match the verified report/u
    ]
  ]) {
    const other = adapterFixture({ artifacts });
    await assert.rejects(
      other.client.run({
        record: structuredClone(other.record),
        actor: other.record.actor,
        save: async () => {}
      }),
      message
    );
  }
});

// -------------------------------------------------------- intake and gates

function sandboxEntry({ monitoringOnly = false, target = "staging" } = {}) {
  const { entry } = serviceFixture();
  entry.request.schema_version = "0.000002";
  entry.request.target = target;
  entry.request.release_parts[0].operational_deployments = ["monitoring"];
  if (monitoringOnly) entry.request.release_parts[0].deploy_units = [];
  return entry;
}
const readinessGitHub = () => ({
  pullRequest: async (repository, number) => {
    const commit = number === 10 ? "a".repeat(40) : "c".repeat(40);
    const nameWithOwner = `6529-Collections/${repository}`;
    return {
      number,
      state: "OPEN",
      isDraft: false,
      headRefOid: commit,
      headRefName: "codex/sample",
      baseRefOid: "b".repeat(40),
      baseRefName: "main",
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: "APPROVED",
      repository: { nameWithOwner },
      headRepository: { nameWithOwner },
      checks: [
        {
          __typename: "CheckRun",
          id: "build",
          name: "Sandbox check",
          status: "COMPLETED",
          conclusion: "SUCCESS",
          isRequired: true
        }
      ]
    };
  },
  catalog: async (commit) => ({
    commit,
    blob_sha: "c".repeat(40),
    catalog: JSON.parse(
      sampleFiles().backend["src/config/deploy-services.json"]
    )
  })
});
const operationalCheck = (result) =>
  result.checks.find((item) => item.id === "operational_deployments");

test("sandbox readiness accepts monitoring inside a complete ticket and explains the staging boundary", async () => {
  const staging = await inspectReadiness(sandboxEntry(), {
    github: readinessGitHub(),
    profile: sandboxProfile
  });
  assert.equal(operationalCheck(staging).status, "pass");
  assert.match(operationalCheck(staging).message, /does not deploy it/u);
  const production = await inspectReadiness(
    sandboxEntry({ target: "production" }),
    { github: readinessGitHub(), profile: sandboxProfile }
  );
  assert.equal(operationalCheck(production).status, "pass");
  assert.match(
    operationalCheck(production).message,
    /before the production application deployments/u
  );
  assert.equal(production.release_authorized, false);
});

test("a monitoring-only sandbox request waits with a sandbox-specific action", async () => {
  const entry = sandboxEntry({ monitoringOnly: true });
  const result = await inspectReadiness(entry, {
    github: readinessGitHub(),
    profile: sandboxProfile
  });
  const check = operationalCheck(result);
  assert.equal(check.status, "unknown");
  assert.match(check.message, /complete sample application ticket/u);
  assert.match(check.evidence.action, /complete sandbox ticket/u);
  const decision = decideTicket(entry, result);
  const reason = decision.reasons.find(
    (item) =>
      item.code === "coordinator-incomplete" &&
      /complete sample application ticket/u.test(item.message)
  );
  assert.ok(reason);
  assert.equal(reason.action, check.evidence.action);
  assert.equal(Object.hasOwn(reason.evidence, "action"), false);
  assert.deepEqual(reason.evidence.selected, check.evidence.selected);
});

test("changed sample monitoring files pass the trusted inspection rules only for the backend", () => {
  const f = serviceFixture();
  const report = f.report();
  report.repositories[0].service_source.changed_paths.push(
    ...releaseMonitoringPaths
  );
  assert.doesNotThrow(() =>
    buildServicePlan(f.entry, report, f.profile, f.runtime)
  );
  report.repositories[0].service_source.changed_paths.push(
    "ops/monitoring/package.json"
  );
  assert.throws(() => buildServicePlan(f.entry, report, f.profile, f.runtime), {
    code: "database-unverified"
  });
  const frontend = serviceFixture();
  const frontendReport = frontend.report();
  frontendReport.repositories[1].service_source.changed_paths.push(
    "ops/monitoring/src/alarms.json"
  );
  assert.throws(
    () =>
      buildServicePlan(
        frontend.entry,
        frontendReport,
        frontend.profile,
        frontend.runtime
      ),
    { code: "database-unverified" }
  );
});

test("temporary batch PRs accept only the sample monitoring files, and only for the backend", async () => {
  const file = (name) => ({
    path: name,
    mode: "100644",
    type: "blob",
    content: "{}\n"
  });
  const backend = batchGitHubFixture();
  await backend.client.open(
    backend.record,
    [file("ops/monitoring/src/alarms.json")],
    backend.save
  );
  assert.ok(backend.saved.some((value) => value.commit));
  for (const [options, name] of [
    [{}, "ops/monitoring/package.json"],
    [{}, "ops/monitoring/scripts/deploy.mjs"],
    [{ role: "frontend" }, "ops/monitoring/src/alarms.json"]
  ]) {
    const other = batchGitHubFixture(options);
    await assert.rejects(
      other.client.open(other.record, [file(name)], other.save),
      /supported/u,
      name
    );
    assert.ok(
      other.calls.every((call) => call.method === "GET"),
      name
    );
  }
});

test("the real Git workspace publishes the sample monitoring files for a backend candidate only", async (t) => {
  const f = await batchFixture(t);
  const backend = await f.ticket({ backend: monitoringFiles() });
  const prepared = await f.prepare([backend]);
  assert.equal(prepared.status, "passed", JSON.stringify(prepared));
  const publication = prepared.publications.find(
    (value) => value.role === "backend"
  );
  for (const name of releaseMonitoringPaths)
    assert.ok(
      publication.patch.some((file) => file.path === name),
      `${name} in the backend patch`
    );
  const frontend = await f.ticket({
    frontend: { "ops/monitoring/src/alarms.json": "{}\n" }
  });
  const refused = await f.prepare([frontend]);
  assert.notEqual(refused.status, "passed");
  assert.equal(refused.kind, "evidence");
});
