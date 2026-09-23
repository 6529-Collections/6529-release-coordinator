import assert from "node:assert/strict";
import test from "node:test";
import {
  makeReleaseBuild,
  makeReleaseOperation,
  releaseBuildFiles,
  releaseHash
} from "../src/release-contract.mjs";
import {
  productWorkflowReleaseAdapter,
  verifySavedReleaseReport,
  verifyProductWorkflowReport
} from "../src/product-workflow-contract.mjs";
import { createProductWorkflowReleaseGitHub } from "../src/product-workflow-release-github.mjs";
import {
  productWorkflowRuntime,
  realProductWorkflowRuntime
} from "../src/product-workflow-runtime-config.mjs";
import { makeProfileReleaseOperation } from "../src/profile-release-contract.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";

const apiResponse = (status, data) =>
  `HTTP/2 ${status} Result\nContent-Type: application/json\n\n${data === undefined ? "" : JSON.stringify(data)}`;
const commits = { backend: "b".repeat(40), frontend: "f".repeat(40) };
const actor = { id: "456", login: "tester" };
const savedRuntime = {
  backend: {
    workflows: { deploy: { workflow_id: 11 }, monitoring: { workflow_id: 12 } }
  },
  frontend: {
    workflows: {
      stagingDeploy: { workflow_id: 21 },
      stagingDispatch: { workflow_id: 22 },
      stagingE2e: { workflow_id: 23 },
      prodDeploy: { workflow_id: 24 },
      prodDispatch: { workflow_id: 25 },
      prodE2e: { workflow_id: 26 }
    }
  }
};

function build(role, sourceCommit) {
  return makeReleaseBuild({
    role,
    source_commit: sourceCommit,
    files: releaseBuildFiles[role].map((file) => ({
      path: file,
      sha256: file.charCodeAt(0).toString(16).padStart(2, "0").repeat(32),
      bytes: 1
    }))
  });
}

function repositoryRole(endpoint) {
  return endpoint.includes("frontend") ? "frontend" : "backend";
}

function runtimeFile(endpoint, runtime, environment) {
  const role = repositoryRole(endpoint);
  const file = endpoint.match(/\/contents\/(.+)\?ref=/u)?.[1];
  assert.ok(file);
  const pinned = runtime.repositories[role].files[file];
  return {
    type: "file",
    path: file,
    sha: typeof pinned === "string" ? pinned : pinned[environment]
  };
}

function runFixture(
  descriptor,
  {
    id = 501,
    conclusion = "success",
    createdAt = "2026-09-21T16:00:00.000Z",
    profile = sandboxProfile
  } = {}
) {
  const repository = profile.repositories[descriptor.role];
  return {
    id,
    repository: { id: repository.id, full_name: repository.full_name },
    head_repository: { id: repository.id },
    head_sha: descriptor.sourceCommit,
    head_branch: descriptor.ref,
    event: descriptor.event,
    run_attempt: 1,
    path: `.github/workflows/${descriptor.workflow}`,
    display_title: descriptor.title ?? "staging push",
    actor: { id: Number(actor.id), login: actor.login },
    workflow_id: descriptor.workflowId,
    status: "completed",
    conclusion,
    html_url: `https://example.invalid/runs/${id}`,
    created_at: createdAt,
    updated_at: "2026-09-21T16:00:00.000Z"
  };
}

function directHarness(
  descriptor,
  operation,
  {
    boundaryResponse,
    conclusion = "success",
    concurrentRuns = [],
    priorRuns = [],
    mutateManifest,
    mutateRun,
    profile = sandboxProfile
  } = {}
) {
  const calls = [];
  let dispatched = false;
  const runtime =
    profile.name === "real"
      ? realProductWorkflowRuntime
      : productWorkflowRuntime;
  const run = runFixture(descriptor, { conclusion, profile });
  mutateRun?.(run);
  const manifest = build(descriptor.buildRole, descriptor.sourceCommit);
  mutateManifest?.(manifest);
  const artifact = {
    id: 701,
    name:
      descriptor.kind === "backend"
        ? `fake-backend-${descriptor.environment}-${descriptor.unit}-${run.id}`
        : descriptor.kind === "monitoring"
          ? `fake-monitoring-${descriptor.environment}-${run.id}`
          : `fake-${descriptor.environment === "prod" ? "production" : "staging"}-deployment-${run.id}`,
    digest: `sha256:${"d".repeat(64)}`,
    expired: false,
    workflow_run: { id: run.id }
  };
  const execute = async (args, body) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    calls.push({ method, endpoint, body });
    if (endpoint.includes("/contents/"))
      return apiResponse(
        "200 OK",
        runtimeFile(endpoint, runtime, operation.environment)
      );
    if (endpoint.includes("/git/ref/heads/")) {
      const role = repositoryRole(endpoint);
      return apiResponse("200 OK", { object: { sha: commits[role] } });
    }
    if (
      endpoint.includes("/actions/runs/") &&
      endpoint.endsWith("/jobs?per_page=100")
    )
      return apiResponse("200 OK", {
        total_count: descriptor.jobs.length,
        jobs: descriptor.jobs.map((name, index) => ({
          id: 800 + index,
          name,
          run_id: run.id,
          head_sha: run.head_sha,
          status: "completed",
          conclusion:
            conclusion === "failure" && index === 0 ? "failure" : "success"
        }))
      });
    if (
      endpoint.includes("/actions/runs/") &&
      endpoint.endsWith("/artifacts?per_page=100")
    )
      return apiResponse("200 OK", {
        total_count: 1,
        artifacts: [artifact]
      });
    if (
      endpoint.includes("/actions/workflows/") &&
      endpoint.includes("/runs?")
    ) {
      const query = new URL(`https://example.invalid/${endpoint}`).searchParams;
      if (query.has("status"))
        return apiResponse("200 OK", { total_count: 0, workflow_runs: [] });
      if (query.get("per_page") === "1")
        return apiResponse(
          "200 OK",
          boundaryResponse ?? {
            // This branch simulates GitHub's already-filtered newest-first
            // response to the exact event/branch/head_sha query.
            total_count: priorRuns.length,
            workflow_runs: priorRuns.slice(0, 1)
          }
        );
      if (query.has("event")) {
        const observed =
          dispatched || descriptor.event === "push"
            ? [run, ...concurrentRuns]
            : [];
        return apiResponse("200 OK", {
          total_count: priorRuns.length + observed.length,
          workflow_runs: [...observed, ...priorRuns]
        });
      }
      return apiResponse("200 OK", { total_count: 0, workflow_runs: [] });
    }
    if (method === "POST" && endpoint.endsWith("/dispatches")) {
      dispatched = true;
      return apiResponse("204 No Content");
    }
    throw new Error(`Unexpected ${method} ${endpoint}`);
  };
  const client = createProductWorkflowReleaseGitHub({
    profile,
    execute,
    base: {},
    polls: 2,
    pollMs: 0,
    wait: async () => {},
    download: async () => ({ manifest })
  });
  const record = {
    id: operation.operation_id,
    release_id: operation.release_id,
    step: {
      id:
        operation.operation === "monitoring"
          ? `${operation.environment}:monitoring:${operation.monitoring_environment}`
          : `${operation.environment}:deploy:${operation.role}:${operation.unit}`,
      kind: operation.operation,
      environment: operation.environment,
      role: operation.role,
      unit: operation.unit,
      ...(operation.operation === "monitoring"
        ? { monitoring_environment: operation.monitoring_environment }
        : {})
    },
    state: "prepared",
    actor,
    created_at: "2026-09-21T15:59:00.000Z",
    operation
  };
  return { calls, client, record, run };
}

test("product workflow contract dispatches staging services and monitoring from 1a-staging", async () => {
  const backendOperation = makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "worker",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const backendDescriptor = {
    kind: "backend",
    role: "backend",
    buildRole: "backend",
    environment: "staging",
    sourceCommit: commits.backend,
    ref: "1a-staging",
    event: "workflow_dispatch",
    workflow: "deploy.yml",
    workflowId: savedRuntime.backend.workflows.deploy.workflow_id,
    title: "Deploy transactionsProcessingLoop to staging",
    unit: "transactionsProcessingLoop",
    jobs: ["Build and deploy transactionsProcessingLoop to staging"]
  };
  const backend = directHarness(backendDescriptor, backendOperation);
  const backendResult = await backend.client.run({
    record: backend.record,
    actor,
    runtime: savedRuntime,
    operations: {},
    steps: [backend.record.step],
    save: async () => {}
  });
  assert.equal(backendResult.status, "passed");
  const backendDispatch = backend.calls.find(
    (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
  );
  assert.equal(backendDispatch.body.ref, "1a-staging");
  assert.deepEqual(backendDispatch.body.inputs, {
    environment: "staging",
    service: "transactionsProcessingLoop",
    expected_source_sha: commits.backend
  });

  const monitoringOperation = makeReleaseOperation({
    release_id: "33333333-3333-4333-8333-333333333333",
    operation_id: "44444444-4444-4444-8444-444444444444",
    operation: "monitoring",
    environment: "staging",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const monitoringDescriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "staging",
    sourceCommit: commits.backend,
    ref: "1a-staging",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const monitoring = directHarness(monitoringDescriptor, monitoringOperation);
  const monitoringResult = await monitoring.client.run({
    record: monitoring.record,
    actor,
    runtime: savedRuntime,
    operations: {},
    steps: [monitoring.record.step],
    save: async () => {}
  });
  assert.equal(monitoringResult.status, "passed");
  const monitoringDispatch = monitoring.calls.find(
    (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
  );
  assert.equal(monitoringDispatch.body.ref, "1a-staging");
  assert.deepEqual(monitoringDispatch.body.inputs, {
    environment: "staging"
  });
  assert.equal(
    monitoringResult.report.deployments.monitoring.environment,
    "staging"
  );
});

test("the real monitoring adapter uses each branch and only the existing workflow input", async () => {
  for (const environment of ["staging", "prod"]) {
    const ref = environment === "staging" ? "1a-staging" : "main";
    const operation = makeProfileReleaseOperation({
      profile: "real",
      release_id: "91919191-9191-4919-8919-919191919191",
      operation_id: "92929292-9292-4929-8929-929292929292",
      operation: "monitoring",
      environment,
      role: "backend",
      unit: "monitoring",
      monitoring_environment: environment,
      backend_commit: commits.backend,
      frontend_commit: commits.frontend
    });
    const descriptor = {
      kind: "monitoring",
      role: "backend",
      buildRole: "monitoring",
      environment,
      sourceCommit: commits.backend,
      ref,
      event: "workflow_dispatch",
      workflow: "deploy-operational-monitoring.yml",
      workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
      title: "Deploy operational monitoring",
      unit: null,
      jobs: ["monitoring"]
    };
    const harness = directHarness(descriptor, operation, {
      profile: realProfile
    });
    const result = await harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [harness.record.step],
      save: async () => {}
    });
    assert.equal(result.status, "passed");
    const dispatch = harness.calls.find(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    );
    assert.deepEqual(dispatch.body, {
      ref,
      inputs: { environment }
    });
    assert.equal(result.report.runner.commit, commits.backend);
    assert.equal(result.report.builds.monitoring, undefined);
  }
});

test("a monitoring run from a moved branch tip is detected after dispatch", async () => {
  const operation = makeProfileReleaseOperation({
    profile: "real",
    release_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    operation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    operation: "monitoring",
    environment: "staging",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "staging",
    sourceCommit: commits.backend,
    ref: "1a-staging",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const harness = directHarness(descriptor, operation, {
    profile: realProfile,
    mutateRun: (run) => {
      run.head_sha = "c".repeat(40);
    }
  });
  await assert.rejects(
    harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [harness.record.step],
      save: async () => {}
    }),
    /may already have deployed; stop for a person/u
  );
  assert.ok(
    harness.calls.some(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    )
  );
});

test("concurrent monitoring runs stop instead of guessing which dispatch is ours", async () => {
  const operation = makeProfileReleaseOperation({
    profile: "real",
    release_id: "abababab-abab-4bab-8bab-abababababab",
    operation_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
    operation: "monitoring",
    environment: "staging",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "staging",
    sourceCommit: commits.backend,
    ref: "1a-staging",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const concurrent = runFixture(descriptor, { id: 502, profile: realProfile });
  concurrent.head_sha = "c".repeat(40);
  const harness = directHarness(descriptor, operation, {
    profile: realProfile,
    concurrentRuns: [concurrent]
  });
  await assert.rejects(
    harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [harness.record.step],
      save: async () => {}
    }),
    /More than one workflow claims/u
  );
  assert.ok(
    harness.calls.some(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    )
  );
});

test("an unfinished v1 monitoring step cannot use the new branch-only workflow", async () => {
  const operation = makeReleaseOperation({
    release_id: "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1",
    operation_id: "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2",
    operation: "monitoring",
    environment: "prod",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "staging",
    sourceCommit: commits.backend,
    ref: "main",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const harness = directHarness(descriptor, operation);
  await assert.rejects(
    harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [harness.record.step],
      save: async () => {}
    }),
    /former branch contract/u
  );
  assert.equal(harness.calls.length, 0);
});

test("product workflow integration waits for its pinned workflows to become quiet", async () => {
  let quiet = false;
  let waits = 0;
  let integrations = 0;
  let saves = 0;
  const queries = [];
  const blockingRun = {
    id: 490,
    html_url: "https://example.invalid/runs/490",
    status: "queued",
    actor: { login: "another-operator" }
  };
  const execute = async (args) => {
    const endpoint = args[args.indexOf("--method") + 2];
    if (
      endpoint.includes("/actions/workflows/") &&
      endpoint.includes("/runs?")
    ) {
      queries.push(endpoint);
      const query = new URL(`https://example.invalid/${endpoint}`).searchParams;
      const runs =
        !quiet && endpoint.includes("/deploy.yml/") && !query.has("status")
          ? [blockingRun]
          : [];
      return apiResponse("200 OK", {
        total_count: runs.length,
        workflow_runs: runs
      });
    }
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  const client = createProductWorkflowReleaseGitHub({
    profile: sandboxProfile,
    execute,
    base: {
      integrate: async () => {
        integrations++;
        return { status: "passed" };
      }
    },
    wait: async () => {
      waits++;
      quiet = true;
    },
    pollMs: 0
  });
  const record = { step: { role: "backend" } };
  const result = await client.integrate({
    record,
    save: async () => {
      saves++;
    }
  });
  assert.deepEqual(result, { status: "passed" });
  assert.equal(waits, 1);
  assert.equal(integrations, 1);
  assert.equal(saves, 1);
  assert.equal(record.waited_for.runs[0].id, blockingRun.id);
  assert.equal(record.waited_for.checks, 2);
  assert.ok(record.waited_for.quiet_at);
  assert.ok(
    queries.some(
      (endpoint) =>
        endpoint.includes("/deploy.yml/runs?per_page=100") &&
        !endpoint.includes("status=")
    )
  );
  assert.ok(
    queries.some(
      (endpoint) =>
        endpoint.includes("/deploy.yml/runs?status=queued") &&
        endpoint.includes("per_page=100")
    )
  );
});

test("a fresh manual operation cannot adopt an older matching workflow run", async () => {
  const operation = makeReleaseOperation({
    release_id: "12121212-1212-4212-8212-121212121212",
    operation_id: "34343434-3434-4434-8434-343434343434",
    operation: "monitoring",
    environment: "prod",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "prod",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "prod",
    sourceCommit: commits.backend,
    ref: "main",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const priorRun = runFixture(descriptor, {
    id: 499,
    createdAt: "2026-09-21T15:58:00.000Z"
  });
  const harness = directHarness(descriptor, operation, {
    priorRuns: [priorRun]
  });
  const result = await harness.client.run({
    record: harness.record,
    actor,
    runtime: savedRuntime,
    operations: {},
    steps: [harness.record.step],
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(result.workflow.id, harness.run.id);
  assert.equal(harness.record.dispatch_after_run_id, priorRun.id);
  assert.equal(
    harness.calls.some(({ endpoint }) => {
      if (
        !endpoint.includes("/actions/workflows/") ||
        !endpoint.includes("/runs?")
      )
        return false;
      const query = new URL(`https://example.invalid/${endpoint}`).searchParams;
      return (
        query.get("per_page") === "1" &&
        query.get("event") === descriptor.event &&
        query.get("branch") === descriptor.ref &&
        !query.has("head_sha")
      );
    }),
    true
  );
  assert.equal(
    harness.calls.filter(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    ).length,
    1
  );
});

test("a resumed manual operation cannot adopt any run without its saved dispatch boundary", async () => {
  const operation = makeReleaseOperation({
    release_id: "56565656-5656-4656-8656-565656565656",
    operation_id: "78787878-7878-4878-8878-787878787878",
    operation: "monitoring",
    environment: "prod",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "prod",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "prod",
    sourceCommit: commits.backend,
    ref: "main",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const harness = directHarness(descriptor, operation, {
    priorRuns: [runFixture(descriptor, { id: 777 })]
  });
  harness.record.state = "running";
  await assert.rejects(
    harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [harness.record.step],
      save: async () => {}
    }),
    /lacks its saved workflow boundary/u
  );
  assert.equal(
    harness.calls.some(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    ),
    false
  );
});

test("an inconsistent newest-run response stops before dispatch", async () => {
  const operation = makeReleaseOperation({
    release_id: "89898989-8989-4989-8989-898989898989",
    operation_id: "90909090-9090-4090-8090-909090909090",
    operation: "monitoring",
    environment: "prod",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "prod",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "prod",
    sourceCommit: commits.backend,
    ref: "main",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const harness = directHarness(descriptor, operation, {
    boundaryResponse: { total_count: 1, workflow_runs: [] }
  });
  await assert.rejects(
    harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [harness.record.step],
      save: async () => {}
    }),
    /dispatch boundary is unreadable/u
  );
  assert.equal(
    harness.calls.some(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    ),
    false
  );
});

test("a changed staging frontend adopts its automatic push deployment without dispatching another", async () => {
  const operation = makeReleaseOperation({
    release_id: "55555555-5555-4555-8555-555555555555",
    operation_id: "66666666-6666-4666-8666-666666666666",
    operation: "deploy",
    environment: "staging",
    role: "frontend",
    unit: "frontend",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "frontend",
    role: "frontend",
    buildRole: "frontend",
    environment: "staging",
    sourceCommit: commits.frontend,
    ref: "1a-staging",
    event: "push",
    workflow: "deploy-staging.yml",
    workflowId: savedRuntime.frontend.workflows.stagingDeploy.workflow_id,
    title: null,
    unit: null,
    jobs: ["Build exact staging artifact", "Deploy exact staging artifact"]
  };
  const harness = directHarness(descriptor, operation);
  const result = await harness.client.run({
    record: harness.record,
    actor,
    runtime: savedRuntime,
    operations: {
      "staging:integrate:frontend": {
        result: { status: "passed", kind: "merge" }
      }
    },
    steps: [harness.record.step],
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(
    harness.calls.some(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    ),
    false
  );
  assert.equal(result.workflow.id, harness.run.id);
});

test("a confirmed product-shaped workflow failure returns failed evidence for recovery", async () => {
  const operation = makeReleaseOperation({
    release_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    operation_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    operation: "monitoring",
    environment: "staging",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "staging",
    sourceCommit: commits.backend,
    ref: "1a-staging",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const harness = directHarness(descriptor, operation, {
    conclusion: "failure"
  });
  const result = await harness.client.run({
    record: harness.record,
    actor,
    runtime: savedRuntime,
    operations: {},
    steps: [harness.record.step],
    save: async () => {}
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(result.report.builds, {});
  assert.deepEqual(result.report.deployments, {});
  assert.equal(result.report.checks[0].status, "failed");
  assert.equal(
    verifyProductWorkflowReport(result.report, operation),
    result.report
  );
  const explicitNoInstall = { ...result.report, installed: null };
  assert.equal(
    verifyProductWorkflowReport(explicitNoInstall, operation),
    explicitNoInstall
  );
});

test("a monitoring build without its target template fails with a specific evidence error", async () => {
  const operation = makeReleaseOperation({
    release_id: "abababab-abab-4bab-8bab-abababababab",
    operation_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
    operation: "monitoring",
    environment: "staging",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const descriptor = {
    kind: "monitoring",
    role: "backend",
    buildRole: "monitoring",
    environment: "staging",
    sourceCommit: commits.backend,
    ref: "1a-staging",
    event: "workflow_dispatch",
    workflow: "deploy-operational-monitoring.yml",
    workflowId: savedRuntime.backend.workflows.monitoring.workflow_id,
    title: "Deploy operational monitoring",
    unit: null,
    jobs: ["monitoring"]
  };
  const harness = directHarness(descriptor, operation, {
    mutateManifest: (manifest) => {
      manifest.files = manifest.files.filter(
        (file) => file.path !== "monitoring-staging.json"
      );
    }
  });
  await assert.rejects(
    harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [harness.record.step],
      save: async () => {}
    }),
    /missing its installed template/u
  );
});

function dependencyReport(operation, role, runId, unit) {
  const sourceRole = role === "monitoring" ? "backend" : role;
  const sourceCommit = operation[`${sourceRole}_commit`];
  const environment = operation.environment;
  const workflow =
    role === "backend"
      ? ".github/workflows/deploy.yml"
      : environment === "staging"
        ? ".github/workflows/deploy-staging.yml"
        : ".github/workflows/build-upload-deploy-prod.yml";
  const name =
    role === "backend"
      ? `fake-backend-${environment}-${unit}-${runId}`
      : `fake-${environment === "prod" ? "production" : "staging"}-deployment-${runId}`;
  const manifest = build(role, sourceCommit);
  const artifact = { id: runId + 1000, name, digest: "a".repeat(64) };
  const deployment = {
    role,
    environment,
    source_commit: sourceCommit,
    unit,
    workflow,
    repository: sandboxProfile.repositories[role].full_name,
    run_id: runId,
    artifact
  };
  const report = {
    protocol: operation.protocol,
    profile: "sandbox",
    adapter: productWorkflowReleaseAdapter,
    release_id: operation.release_id,
    operation_id: operation.operation_id,
    operation_hash: operation.fingerprint,
    operation: operation.operation,
    environment: operation.environment,
    role: operation.role,
    unit: operation.unit,
    status: "passed",
    checks: [{ name: "product-shaped-workflow", status: "passed" }],
    builds: { [role]: { manifest, artifact } },
    deployments: { [role]: deployment },
    versions: { ...commits },
    runner: {
      repository: sandboxProfile.repositories[role].full_name,
      run_id: runId,
      attempt: 1,
      commit: sourceCommit,
      workflow
    },
    completed_at: "2026-09-21T16:00:00.000Z"
  };
  verifyProductWorkflowReport(report, operation);
  return report;
}

test("automatic E2E is bound to the exact frontend deployment and saved backend deployment", async () => {
  const releaseId = "77777777-7777-4777-8777-777777777777";
  const backendOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "88888888-8888-4888-8888-888888888888",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "api",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const frontendOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "99999999-9999-4999-8999-999999999999",
    operation: "deploy",
    environment: "staging",
    role: "frontend",
    unit: "frontend",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const e2eOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    operation: "e2e",
    environment: "staging",
    role: null,
    unit: null,
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const backendReport = dependencyReport(
    backendOperation,
    "backend",
    601,
    "api"
  );
  const frontendReport = dependencyReport(
    frontendOperation,
    "frontend",
    602,
    null
  );
  const wrapper = {
    id: 603,
    repository: {
      id: sandboxProfile.repositories.frontend.id,
      full_name: sandboxProfile.repositories.frontend.full_name
    },
    head_repository: { id: sandboxProfile.repositories.frontend.id },
    head_sha: "c".repeat(40),
    head_branch: "main",
    event: "workflow_run",
    run_attempt: 1,
    path: ".github/workflows/staging-e2e-dispatch.yml",
    display_title: "Staging E2E dispatch [602]",
    actor,
    workflow_id: savedRuntime.frontend.workflows.stagingDispatch.workflow_id,
    status: "completed",
    conclusion: "success",
    html_url: "https://example.invalid/runs/603",
    created_at: "2026-09-21T16:00:00.000Z",
    updated_at: "2026-09-21T16:01:00.000Z"
  };
  const listedWrapper = {
    ...wrapper,
    status: "in_progress",
    conclusion: null
  };
  const e2eRun = {
    ...wrapper,
    id: 604,
    event: "workflow_dispatch",
    path: ".github/workflows/staging-e2e.yml",
    display_title: "Staging E2E automatic 602",
    actor: productWorkflowRuntime.githubActionsActor,
    workflow_id: savedRuntime.frontend.workflows.stagingE2e.workflow_id,
    html_url: "https://example.invalid/runs/604",
    updated_at: "2026-09-21T16:02:00.000Z"
  };
  const deploymentRun = {
    ...wrapper,
    id: 602,
    head_sha: commits.frontend,
    head_branch: "1a-staging",
    event: "push",
    path: ".github/workflows/deploy-staging.yml",
    display_title: "Staging deployment",
    workflow_id: savedRuntime.frontend.workflows.stagingDeploy.workflow_id,
    created_at: "2026-09-21T15:59:00.000Z"
  };
  const automaticQueries = [];
  const execute = async (args) => {
    const endpoint = args[args.indexOf("--method") + 2];
    if (endpoint.includes("/contents/"))
      return apiResponse(
        "200 OK",
        runtimeFile(endpoint, productWorkflowRuntime, "staging")
      );
    if (endpoint.includes("/git/ref/heads/")) {
      const role = repositoryRole(endpoint);
      return apiResponse("200 OK", { object: { sha: commits[role] } });
    }
    if (endpoint.endsWith(`/actions/runs/${deploymentRun.id}`))
      return apiResponse("200 OK", deploymentRun);
    if (endpoint.endsWith(`/actions/runs/${wrapper.id}`))
      return apiResponse("200 OK", wrapper);
    if (endpoint.includes("staging-e2e-dispatch.yml/runs?")) {
      automaticQueries.push(endpoint);
      return apiResponse("200 OK", {
        total_count: 1,
        workflow_runs: [listedWrapper]
      });
    }
    if (endpoint.includes("staging-e2e.yml/runs?")) {
      automaticQueries.push(endpoint);
      return apiResponse("200 OK", { total_count: 1, workflow_runs: [e2eRun] });
    }
    if (
      endpoint.endsWith(
        `/actions/runs/${wrapper.id}/attempts/1/jobs?per_page=100`
      )
    )
      return apiResponse("200 OK", {
        total_count: 1,
        jobs: [
          {
            name: "Dispatch successful staging deployment",
            run_id: wrapper.id,
            head_sha: wrapper.head_sha,
            status: "completed",
            conclusion: "success"
          }
        ]
      });
    if (
      endpoint.endsWith(
        `/actions/runs/${e2eRun.id}/attempts/1/jobs?per_page=100`
      )
    )
      return apiResponse("200 OK", {
        total_count: 1,
        jobs: [
          {
            name: "Staging E2E packs",
            run_id: e2eRun.id,
            head_sha: e2eRun.head_sha,
            status: "completed",
            conclusion: e2eRun.conclusion
          }
        ]
      });
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  const client = createProductWorkflowReleaseGitHub({
    profile: sandboxProfile,
    execute,
    base: {},
    polls: 2,
    wait: async () => {}
  });
  const steps = [
    {
      id: "staging:deploy:backend:api",
      kind: "deploy",
      environment: "staging",
      role: "backend",
      unit: "api"
    },
    {
      id: "staging:deploy:frontend:frontend",
      kind: "deploy",
      environment: "staging",
      role: "frontend",
      unit: "frontend"
    },
    {
      id: "staging:e2e",
      kind: "e2e",
      environment: "staging",
      role: null
    }
  ];
  const operations = {
    [steps[0].id]: {
      operation: backendOperation,
      result: {
        status: "passed",
        workflow: { id: 601 },
        report: backendReport
      }
    },
    [steps[1].id]: {
      operation: frontendOperation,
      result: {
        status: "passed",
        workflow: { id: 602 },
        report: frontendReport
      }
    }
  };
  const makeRecord = () => ({
    id: e2eOperation.operation_id,
    release_id: releaseId,
    step: steps[2],
    state: "prepared",
    actor,
    // The automatic chain can finish before recovery saves its E2E operation.
    // It remains valid because it was caused by the exact saved deployment.
    created_at: "2026-09-21T16:05:00.000Z",
    operation: e2eOperation
  });
  const result = await client.run({
    record: makeRecord(),
    actor,
    runtime: savedRuntime,
    operations,
    steps,
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(result.deployment_workflow.id, 602);
  assert.equal(result.dispatch_workflow.id, 603);
  assert.equal(result.workflow.id, 604);
  assert.equal(result.report.deployments.backend.run_id, 601);
  assert.equal(result.report.deployments.frontend.run_id, 602);
  assert.equal(result.report.report_hash, undefined);
  assert.equal(result.report_hash, releaseHash(result.report));
  e2eRun.conclusion = "failure";
  const failed = await client.run({
    record: makeRecord(),
    actor,
    runtime: savedRuntime,
    operations,
    steps,
    save: async () => {}
  });
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.report.builds, {});
  assert.deepEqual(failed.report.deployments, {});
  assert.equal(automaticQueries.length, 4);
  for (const [index, endpoint] of automaticQueries.entries()) {
    const dispatchQuery = index % 2 === 0;
    const query = new URL(`https://example.invalid/${endpoint}`).searchParams;
    assert.equal(
      query.get("actor"),
      dispatchQuery
        ? actor.login
        : productWorkflowRuntime.githubActionsActor.login
    );
    assert.equal(query.get("branch"), "main");
    assert.equal(query.get("created"), ">=2026-09-21T15:59:00.000Z");
    assert.equal(
      query.get("event"),
      dispatchQuery ? "workflow_run" : "workflow_dispatch"
    );
  }
});

test("E2E refuses a plan without matching successful backend and frontend deployments", async () => {
  const operation = makeReleaseOperation({
    release_id: "edededed-eded-4ded-8ded-edededededed",
    operation_id: "fefefefe-fefe-4efe-8efe-fefefefefefe",
    operation: "e2e",
    environment: "staging",
    role: null,
    unit: null,
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const step = {
    id: "staging:e2e",
    kind: "e2e",
    environment: "staging",
    role: null
  };
  const client = createProductWorkflowReleaseGitHub({
    profile: sandboxProfile,
    execute: async () => assert.fail("dependency failure must precede GitHub"),
    base: {},
    polls: 1,
    wait: async () => {}
  });
  await assert.rejects(
    client.run({
      record: {
        id: operation.operation_id,
        release_id: operation.release_id,
        step,
        state: "prepared",
        actor,
        created_at: "2026-09-21T16:00:00.000Z",
        operation
      },
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [step],
      save: async () => {}
    }),
    /Matching backend and frontend deployments are required before E2E/u
  );
});

test("product-shaped reports reject a deployment artifact that is not the saved workflow artifact", () => {
  const operation = makeReleaseOperation({
    release_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    operation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "api",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const report = dependencyReport(operation, "backend", 901, "api");
  report.builds.backend.artifact = {
    ...report.builds.backend.artifact,
    name: "forged"
  };
  assert.throws(
    () => verifyProductWorkflowReport(report, operation),
    /does not match its saved operation/u
  );
});

test("product-shaped reports reject malformed and partial contract evidence", () => {
  const operation = makeReleaseOperation({
    release_id: "10101010-1010-4010-8010-101010101010",
    operation_id: "20202020-2020-4020-8020-202020202020",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "api",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const valid = dependencyReport(operation, "backend", 902, "api");
  for (const [name, mutate] of [
    ["adapter", (report) => (report.adapter = "unknown")],
    ["deployment", (report) => delete report.deployments.backend],
    ["checks", (report) => (report.checks = [])],
    ["runner workflow", (report) => delete report.runner.workflow],
    [
      "artifact identity",
      (report) => {
        report.builds.backend.artifact = {
          ...report.builds.backend.artifact,
          id: report.builds.backend.artifact.id + 1
        };
      }
    ]
  ]) {
    const report = structuredClone(valid);
    mutate(report);
    assert.throws(
      () => verifyProductWorkflowReport(report, operation),
      /does not match its saved operation/u,
      name
    );
  }
});

test("failed non-monitoring reports reject installed evidence", () => {
  const operation = makeReleaseOperation({
    release_id: "30303030-3030-4030-8030-303030303030",
    operation_id: "40404040-4040-4040-8040-404040404040",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "api",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const report = dependencyReport(operation, "backend", 903, "api");
  report.status = "failed";
  report.checks[0].status = "failed";
  assert.equal(verifyProductWorkflowReport(report, operation), report);
  report.installed = null;
  assert.throws(
    () => verifyProductWorkflowReport(report, operation),
    /does not match its saved operation/u
  );
});

test("reports with product deployment fields cannot route as generic", () => {
  const operation = makeReleaseOperation({
    release_id: "50505050-5050-4050-8050-505050505050",
    operation_id: "60606060-6060-4060-8060-606060606060",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "api",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const report = dependencyReport(operation, "backend", 904, "api");
  delete report.adapter;
  assert.throws(
    () => verifySavedReleaseReport(report, operation),
    /Unknown sandbox release report adapter/u
  );
});

test("a real product report trusts the exact workflow run instead of sandbox artifacts", () => {
  const operation = makeProfileReleaseOperation({
    profile: "real",
    release_id: "70707070-7070-4070-8070-707070707070",
    operation_id: "80808080-8080-4080-8080-808080808080",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "transactionsProcessingLoop",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const workflow = ".github/workflows/deploy.yml";
  const report = {
    protocol: operation.protocol,
    profile: "real",
    adapter: productWorkflowReleaseAdapter,
    release_id: operation.release_id,
    operation_id: operation.operation_id,
    operation_hash: operation.fingerprint,
    operation: operation.operation,
    environment: operation.environment,
    role: operation.role,
    unit: operation.unit,
    status: "passed",
    checks: [{ name: "product-workflow", status: "passed" }],
    builds: {},
    deployments: {
      backend: {
        role: "backend",
        environment: "staging",
        source_commit: commits.backend,
        unit: operation.unit,
        workflow,
        repository: realProfile.repositories.backend.full_name,
        run_id: 905,
        run_attempt: 1
      }
    },
    versions: { ...commits },
    runner: {
      repository: realProfile.repositories.backend.full_name,
      run_id: 905,
      attempt: 1,
      commit: commits.backend,
      workflow
    },
    completed_at: "2026-09-22T12:00:00.000Z"
  };

  assert.equal(verifyProductWorkflowReport(report, operation), report);
  report.deployments.backend.artifact = { id: 1 };
  assert.throws(
    () => verifyProductWorkflowReport(report, operation),
    /does not match its saved operation/u
  );
});

test("a failed real E2E is valid without successful deployment entries", () => {
  const operation = makeProfileReleaseOperation({
    profile: "real",
    release_id: "70707070-7070-4070-8070-707070707070",
    operation_id: "80808080-8080-4080-8080-808080808080",
    operation: "e2e",
    environment: "staging",
    role: null,
    unit: null,
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const report = {
    protocol: operation.protocol,
    profile: "real",
    adapter: productWorkflowReleaseAdapter,
    release_id: operation.release_id,
    operation_id: operation.operation_id,
    operation_hash: operation.fingerprint,
    operation: "e2e",
    environment: "staging",
    role: null,
    unit: null,
    status: "failed",
    checks: [{ name: "product-workflow", status: "failed" }],
    builds: {},
    deployments: {},
    versions: { ...commits },
    runner: {
      repository: realProfile.repositories.frontend.full_name,
      run_id: 906,
      attempt: 1,
      commit: commits.frontend,
      workflow: ".github/workflows/staging-e2e.yml"
    },
    completed_at: "2026-09-22T12:00:00.000Z"
  };
  assert.equal(verifyProductWorkflowReport(report, operation), report);
  report.deployments.unexpected = {
    role: "unexpected",
    environment: "staging",
    repository: realProfile.repositories.frontend.full_name,
    run_id: 906,
    run_attempt: 1,
    workflow: ".github/workflows/staging-e2e.yml"
  };
  assert.throws(
    () => verifyProductWorkflowReport(report, operation),
    /does not match its saved operation/u
  );
});
