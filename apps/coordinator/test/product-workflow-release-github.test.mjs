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
  verifyProductWorkflowReport
} from "../src/product-workflow-contract.mjs";
import { createProductWorkflowReleaseGitHub } from "../src/product-workflow-release-github.mjs";
import { productWorkflowRuntime } from "../src/product-workflow-runtime-config.mjs";
import { sandboxProfile } from "../src/profiles.mjs";

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
  return endpoint.includes("release-coordinator-test-frontend")
    ? "frontend"
    : "backend";
}

function runtimeFile(endpoint) {
  const role = repositoryRole(endpoint);
  const file = endpoint.match(/\/contents\/(.+)\?ref=/u)?.[1];
  assert.ok(file);
  return {
    type: "file",
    path: file,
    sha: productWorkflowRuntime.repositories[role].files[file]
  };
}

function runFixture(
  descriptor,
  {
    id = 501,
    conclusion = "success",
    createdAt = "2026-09-21T16:00:00.000Z"
  } = {}
) {
  const repository = sandboxProfile.repositories[descriptor.role];
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
  { conclusion = "success", priorRuns = [], mutateManifest } = {}
) {
  const calls = [];
  let dispatched = false;
  const run = runFixture(descriptor, { conclusion });
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
      return apiResponse("200 OK", runtimeFile(endpoint));
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
      if (query.has("event"))
        return apiResponse("200 OK", {
          total_count:
            priorRuns.length +
            (dispatched || descriptor.event === "push" ? 1 : 0),
          workflow_runs: [
            ...(dispatched || descriptor.event === "push" ? [run] : []),
            ...priorRuns
          ]
        });
      return apiResponse("200 OK", { total_count: 0, workflow_runs: [] });
    }
    if (method === "POST" && endpoint.endsWith("/dispatches")) {
      dispatched = true;
      return apiResponse("204 No Content");
    }
    throw new Error(`Unexpected ${method} ${endpoint}`);
  };
  const client = createProductWorkflowReleaseGitHub({
    profile: sandboxProfile,
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
          ? `prod:monitoring:${operation.monitoring_environment}`
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

test("product workflow contract keeps staging services on 1a-staging and staging monitoring on main", async () => {
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
    environment: "prod",
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
    ref: "main",
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
  assert.equal(monitoringDispatch.body.ref, "main");
  assert.deepEqual(monitoringDispatch.body.inputs, {
    environment: "staging",
    commit_sha: commits.backend
  });
  assert.equal(
    monitoringResult.report.deployments.monitoring.environment,
    "staging"
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
});

test("a monitoring build without its target template fails with a specific evidence error", async () => {
  const operation = makeReleaseOperation({
    release_id: "abababab-abab-4bab-8bab-abababababab",
    operation_id: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
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
    updated_at: "2026-09-21T16:01:00.000Z"
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
  const execute = async (args) => {
    const endpoint = args[args.indexOf("--method") + 2];
    if (endpoint.includes("/contents/"))
      return apiResponse("200 OK", runtimeFile(endpoint));
    if (endpoint.includes("/git/ref/heads/")) {
      const role = repositoryRole(endpoint);
      return apiResponse("200 OK", { object: { sha: commits[role] } });
    }
    if (endpoint.includes("staging-e2e-dispatch.yml/runs?"))
      return apiResponse("200 OK", {
        total_count: 1,
        workflow_runs: [wrapper]
      });
    if (endpoint.includes("staging-e2e.yml/runs?"))
      return apiResponse("200 OK", { total_count: 1, workflow_runs: [e2eRun] });
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
            conclusion: "success"
          }
        ]
      });
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  const client = createProductWorkflowReleaseGitHub({
    profile: sandboxProfile,
    execute,
    base: {},
    polls: 1,
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
  const record = {
    id: e2eOperation.operation_id,
    release_id: releaseId,
    step: steps[2],
    state: "prepared",
    actor,
    created_at: "2026-09-21T16:00:00.000Z",
    operation: e2eOperation
  };
  const result = await client.run({
    record,
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
  report.builds.backend.artifact.name = "forged";
  assert.throws(
    () => verifyProductWorkflowReport(report, operation),
    /does not match its saved operation/u
  );
});
