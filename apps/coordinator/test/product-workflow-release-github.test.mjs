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

/** Build controlled direct-workflow responses without GitHub or deployments. */
function directHarness(
  descriptor,
  operation,
  {
    boundaryResponse,
    conclusion = "success",
    concurrentRuns = [],
    priorRuns = [],
    returnRunDetails = false,
    dispatchRunId,
    jobStatuses = [],
    runStatuses = [],
    missingRun = false,
    missingKnownRunAfter,
    observeRun,
    signal,
    polls = 2,
    wait = async () => {},
    baseTree = "a".repeat(40),
    mutateManifest,
    mutateRun,
    mutateRuntimeFile,
    profile = sandboxProfile
  } = {}
) {
  const calls = [];
  let dispatched = false;
  let jobReads = 0;
  let runReads = 0;
  let knownRunReads = 0;
  const runtime =
    profile.name === "real"
      ? realProductWorkflowRuntime
      : productWorkflowRuntime;
  const run = runFixture(descriptor, { conclusion, profile });
  mutateRun?.(run);
  /** Advance one simulated run observation, with optional drift or cancellation. */
  const readRun = () => {
    const status = runStatuses[runReads++] ?? run.status;
    const observed = {
      ...run,
      status,
      conclusion: status === "completed" ? run.conclusion : null
    };
    observeRun?.(observed, runReads);
    return observed;
  };
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
  /** Serve only the expected direct-workflow requests and retain dispatch evidence. */
  const execute = async (args, body) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    calls.push({ method, endpoint, body });
    if (endpoint.includes("/contents/")) {
      const observed = runtimeFile(endpoint, runtime, operation.environment);
      mutateRuntimeFile?.(observed);
      return apiResponse("200 OK", observed);
    }
    if (endpoint.includes("/git/ref/heads/")) {
      const role = repositoryRole(endpoint);
      return apiResponse("200 OK", { object: { sha: commits[role] } });
    }
    if (method === "GET" && endpoint.includes("/git/commits/"))
      return apiResponse("200 OK", {
        sha: endpoint.split("/").at(-1),
        tree: { sha: baseTree }
      });
    if (method === "GET" && endpoint.endsWith(`/actions/runs/${run.id}`)) {
      if (++knownRunReads > missingKnownRunAfter)
        return apiResponse("404 Not Found", { message: "Not Found" });
      return apiResponse("200 OK", readRun());
    }
    if (
      endpoint.includes("/actions/runs/") &&
      endpoint.endsWith("/jobs?per_page=100")
    ) {
      const status = jobStatuses[jobReads++] ?? "completed";
      return apiResponse("200 OK", {
        total_count: descriptor.jobs.length,
        jobs: descriptor.jobs.map((name, index) => ({
          id: 800 + index,
          name,
          run_id: run.id,
          head_sha: run.head_sha,
          status,
          conclusion:
            status !== "completed"
              ? null
              : conclusion === "failure" && index === 0
                ? "failure"
                : "success"
        }))
      });
    }
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
          !missingRun && (dispatched || descriptor.event === "push")
            ? [readRun(), ...concurrentRuns]
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
      return returnRunDetails
        ? apiResponse("200 OK", {
            workflow_run_id: dispatchRunId ?? run.id,
            run_url: `https://api.github.com/runs/${run.id}`,
            html_url: run.html_url
          })
        : apiResponse("204 No Content");
    }
    throw new Error(`Unexpected ${method} ${endpoint}`);
  };
  const client = createProductWorkflowReleaseGitHub({
    profile,
    execute,
    base: {},
    polls,
    pollMs: 0,
    wait,
    signal,
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

/** Create the same backend waiting fixture using each profile's actual unit name. */
function backendWaitHarness(options = {}) {
  const profile = options.profile ?? sandboxProfile;
  const unit =
    profile.name === "real" ? "worker" : "transactionsProcessingLoop";
  const operation = makeProfileReleaseOperation({
    profile: profile.name,
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "worker",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  return directHarness(
    {
      kind: "backend",
      role: "backend",
      buildRole: "backend",
      environment: "staging",
      sourceCommit: commits.backend,
      ref: "1a-staging",
      event: "workflow_dispatch",
      workflow: "deploy.yml",
      workflowId: savedRuntime.backend.workflows.deploy.workflow_id,
      title: `Deploy ${unit} to staging`,
      unit,
      jobs: [`Build and deploy ${unit} to staging`]
    },
    operation,
    options
  );
}

/** Execute the fixture's saved direct operation with no external side effects. */
const runDirectHarness = (harness) =>
  harness.client.run({
    record: harness.record,
    actor,
    runtime: savedRuntime,
    operations: {},
    steps: [harness.record.step],
    /** The fixture keeps saved state in memory instead of writing a journal. */
    save: async () => {}
  });

for (const profile of [sandboxProfile, realProfile]) {
  test(`${profile.name} waits beyond sixty polls for the same confirmed deployment`, async () => {
    let waits = 0;
    const harness = backendWaitHarness({
      profile,
      runStatuses: ["queued", "waiting", ...Array(65).fill("in_progress")],
      /** Count polls without delaying the offline test. */
      wait: async () => waits++
    });
    const result = await runDirectHarness(harness);
    assert.equal(result.status, "passed");
    assert.equal(result.workflow.id, harness.run.id);
    assert.ok(waits > 60);
    assert.equal(
      harness.calls.filter(({ method }) => method === "POST").length,
      1
    );
  });
}

test("a slow confirmed deployment still reports its eventual failure", async () => {
  const harness = backendWaitHarness({
    runStatuses: Array(65).fill("in_progress"),
    conclusion: "failure"
  });
  const result = await runDirectHarness(harness);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.report.builds, {});
  assert.equal(
    harness.calls.filter(({ method }) => method === "POST").length,
    1
  );
});

test("a saved running deployment waits without redispatching on resume", async () => {
  const harness = backendWaitHarness({ runStatuses: Array(65).fill("queued") });
  Object.assign(harness.record, {
    state: "running",
    workflow_run_id: harness.run.id,
    dispatch_after_run_id: 0
  });
  const result = await runDirectHarness(harness);
  assert.equal(result.status, "passed");
  assert.equal(
    harness.calls.some(({ method }) => method === "POST"),
    false
  );
});

test("missing deployment discovery stays bounded without a replacement dispatch", async () => {
  let waits = 0;
  const harness = backendWaitHarness({
    missingRun: true,
    /** Count only the bounded missing-run discovery polls. */
    wait: async () => waits++
  });
  await assert.rejects(
    runDirectHarness(harness),
    /pending or ended without usable evidence/u
  );
  assert.equal(waits, 1);
  assert.equal(
    harness.calls.filter(({ method }) => method === "POST").length,
    1
  );
  assert.equal(harness.record.state, "running");
  assert.equal(harness.record.workflow_run_id, undefined);
});

test("cancellation interrupts a known deployment even when the wait ignores its signal", async () => {
  const controller = new AbortController();
  let callsAtAbort;
  const harness = backendWaitHarness({
    runStatuses: Array(65).fill("in_progress"),
    signal: controller.signal,
    /** Abort a known-run wait even when the injected delay ignores its signal. */
    wait: async () => {
      callsAtAbort = harness.calls.length;
      controller.abort();
    }
  });
  await assert.rejects(runDirectHarness(harness), { name: "AbortError" });
  assert.equal(harness.calls.length, callsAtAbort);
  assert.equal(harness.record.workflow_run_id, harness.run.id);
  assert.equal(harness.record.state, "running");
});

test("cancellation during the final deployment read cannot accept success", async () => {
  const controller = new AbortController();
  const harness = backendWaitHarness({
    runStatuses: ["in_progress"],
    signal: controller.signal,
    /** Abort as GitHub returns the terminal response, before it can be accepted. */
    observeRun: (run) => {
      if (run.status === "completed") controller.abort();
    }
  });
  await assert.rejects(runDirectHarness(harness), { name: "AbortError" });
  assert.equal(
    harness.calls.some(({ endpoint }) =>
      endpoint.endsWith("/jobs?per_page=100")
    ),
    false
  );
});

test("a completed run waits for its exact job evidence beyond the old poll window", async () => {
  const harness = backendWaitHarness({
    jobStatuses: Array(65).fill("in_progress")
  });
  assert.equal((await runDirectHarness(harness)).status, "passed");
  assert.equal(
    harness.calls.filter(({ endpoint }) =>
      endpoint.endsWith("/jobs?per_page=100")
    ).length,
    66
  );
});

for (const conclusion of [
  "cancelled",
  "timed_out",
  "action_required",
  "skipped"
]) {
  test(`confirmed deployment ending ${conclusion} never passes`, async () => {
    const harness = backendWaitHarness({ conclusion });
    await assert.rejects(
      runDirectHarness(harness),
      /ended without usable evidence/u
    );
  });
}

for (const field of [
  "id",
  "head_sha",
  "status",
  "workflow_id",
  "actor",
  "head_branch",
  "event"
]) {
  test(`waiting stops when a confirmed deployment's ${field} changes`, async () => {
    const harness = backendWaitHarness({
      returnRunDetails: true,
      runStatuses: Array(65).fill("in_progress"),
      /** Change one identity field after the run was already confirmed. */
      observeRun: (run, read) => {
        if (read === 4)
          run[field] =
            field === "id"
              ? 999
              : field === "actor"
                ? { ...run.actor, id: "999" }
                : "unexpected";
      }
    });
    await assert.rejects(
      runDirectHarness(harness),
      /workflow identity, source, actor or dispatch boundary/u
    );
  });
}

test("a confirmed deployment disappearing stops without redispatching", async () => {
  const harness = backendWaitHarness({
    runStatuses: Array(65).fill("in_progress"),
    missingKnownRunAfter: 1
  });
  await assert.rejects(runDirectHarness(harness), /404/u);
  assert.equal(harness.record.workflow_run_id, harness.run.id);
  assert.equal(
    harness.calls.filter(({ method }) => method === "POST").length,
    1
  );
});

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
  const backend = directHarness(backendDescriptor, backendOperation, {
    // GitHub can expose a completed run before its jobs endpoint catches up.
    jobStatuses: ["in_progress", "completed"]
  });
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
  assert.equal(backendDispatch.body.return_run_details, true);
  assert.deepEqual(backendDispatch.body.inputs, {
    environment: "staging",
    service: "transactionsProcessingLoop",
    expected_source_sha: commits.backend
  });
  assert.equal(
    backend.calls.filter((call) => call.endpoint.endsWith("/jobs?per_page=100"))
      .length,
    2
  );
  assert.equal(
    backend.calls.filter((call) => call.method === "POST").length,
    1
  );

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
      inputs: { environment },
      return_run_details: true
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
    returnRunDetails: true,
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

test("concurrent monitoring runs require an exact dispatch ID or stop", async () => {
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
  const exact = directHarness(descriptor, operation, {
    profile: realProfile,
    concurrentRuns: [concurrent],
    returnRunDetails: true,
    mutateRun: (run) => {
      // GitHub rounds to seconds; this is the same dispatch second.
      run.created_at = "2026-09-21T15:59:00Z";
    }
  });
  exact.record.created_at = "2026-09-21T15:59:00.789Z";
  const result = await exact.client.run({
    record: exact.record,
    actor,
    runtime: savedRuntime,
    operations: {},
    steps: [exact.record.step],
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(exact.record.workflow_run_id, 501);
  assert.equal(exact.record.dispatch_response_run_id, 501);
  const resumed = await exact.client.run({
    record: exact.record,
    actor,
    runtime: savedRuntime,
    operations: {},
    steps: [exact.record.step],
    save: async () => {}
  });
  assert.equal(resumed.status, "passed");
  assert.equal(exact.record.workflow_run_id, 501);
  assert.equal(exact.calls.filter((call) => call.method === "POST").length, 1);
  const missingId = directHarness(descriptor, operation, {
    profile: realProfile,
    returnRunDetails: true,
    dispatchRunId: -1
  });
  await assert.rejects(
    missingId.client.run({
      record: missingId.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [missingId.record.step],
      save: async () => {}
    }),
    /without a usable run ID/u
  );
  assert.equal(missingId.record.state, "dispatching");
  const stale = directHarness(descriptor, operation, {
    profile: realProfile,
    mutateRun: (run) => {
      run.created_at = "2026-09-21T15:58:00Z";
    }
  });
  stale.record.state = "running";
  stale.record.dispatch_after_run_id = 0;
  stale.record.workflow_run_id = stale.run.id;
  await assert.rejects(
    stale.client.run({
      record: stale.record,
      actor,
      runtime: savedRuntime,
      operations: {},
      steps: [stale.record.step],
      save: async () => {}
    }),
    /do not redispatch it/u
  );
  assert.equal(stale.calls.filter((call) => call.method === "POST").length, 0);
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
        base: "b".repeat(40),
        result: { status: "passed", kind: "merge", tree: "c".repeat(40) }
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
  assert.equal(harness.record.dispatch_after_run_id, undefined);
  assert.equal(harness.record.workflow_run_id, harness.run.id);
  const readsBeforeResume = harness.calls.filter((call) =>
    call.endpoint.includes("/git/commits/")
  ).length;
  const resumed = await harness.client.run({
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
  assert.equal(resumed.status, "passed");
  assert.equal(
    harness.calls.filter((call) => call.endpoint.includes("/git/commits/"))
      .length,
    readsBeforeResume
  );
});

for (const environment of ["staging", "prod"]) {
  test(`real frontend ${environment} deploy verifies its own runtime pins before dispatch`, async () => {
    const staging = environment === "staging";
    const operation = makeProfileReleaseOperation({
      profile: "real",
      release_id: "55555555-5555-4555-8555-555555555555",
      operation_id: "66666666-6666-4666-8666-666666666666",
      operation: "deploy",
      environment,
      role: "frontend",
      unit: "frontend",
      backend_commit: commits.backend,
      frontend_commit: commits.frontend
    });
    const descriptor = {
      kind: "frontend",
      role: "frontend",
      buildRole: "frontend",
      environment,
      sourceCommit: commits.frontend,
      ref: staging ? "1a-staging" : "main",
      event: "workflow_dispatch",
      workflow: staging ? "deploy-staging.yml" : "build-upload-deploy-prod.yml",
      workflowId:
        savedRuntime.frontend.workflows[
          staging ? "stagingDeploy" : "prodDeploy"
        ].workflow_id,
      title: staging ? null : `Production deploy ${commits.frontend}`,
      unit: null,
      jobs: staging
        ? ["Build exact staging artifact", "Deploy exact staging artifact"]
        : [
            "Verify expected source commit",
            "Build exact production artifact / Build exact production artifact",
            "Resolve production artifact metadata / Resolve uploaded production artifact",
            "Verify exact production artifact / Verify exact production artifact",
            "Deploy verified production artifact"
          ]
    };
    const run = (harness) =>
      harness.client.run({
        record: harness.record,
        actor,
        runtime: savedRuntime,
        operations: {},
        steps: [harness.record.step],
        save: async () => {}
      });
    const accepted = directHarness(descriptor, operation, {
      profile: realProfile,
      returnRunDetails: true
    });
    assert.equal((await run(accepted)).status, "passed");
    const dispatches = accepted.calls.filter(
      ({ method, endpoint }) =>
        method === "POST" && endpoint.endsWith("/dispatches")
    );
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].body.ref, descriptor.ref);
    if (!staging)
      assert.deepEqual(dispatches[0].body.inputs, {
        expected_source_sha: commits.frontend,
        release_note_opt_out: false
      });
    assert.ok(
      accepted.calls.some(({ endpoint }) =>
        endpoint.includes(
          `/contents/.github/workflows/deploy-staging.yml?ref=${commits.frontend}`
        )
      )
    );

    for (const [path, superseded] of Object.entries({
      ".github/workflows/deploy-staging.yml":
        "36d10cd5f855d1510c5f2c6ffced7baf86db3987",
      ".github/workflows/production-build-artifact.yml":
        "22bafb14740b35388d7f6e07f67af01c42486c11",
      ".github/workflows/production-e2e.yml":
        "93c6e39132308f9733eab70ba1191e8a4bd9cd15"
    })) {
      // Both branches legitimately have the same staging-workflow blob now.
      // Refuse stale and unknown blobs, not an otherwise approved other-branch pin.
      for (const unapproved of [superseded, "e".repeat(40)]) {
        const rejected = directHarness(descriptor, operation, {
          profile: realProfile,
          returnRunDetails: true,
          mutateRuntimeFile: (file) => {
            if (file.path === path) file.sha = unapproved;
          }
        });
        await assert.rejects(
          run(rejected),
          /pinned product workflow or evidence file changed/u
        );
        assert.equal(
          rejected.calls.some(({ method }) => method !== "GET"),
          false
        );
      }
    }
  });
}

test("a tree-identical staging merge dispatches and verifies a fresh real frontend deploy", async () => {
  const operation = makeProfileReleaseOperation({
    profile: "real",
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
    event: "workflow_dispatch",
    workflow: "deploy-staging.yml",
    workflowId: savedRuntime.frontend.workflows.stagingDeploy.workflow_id,
    title: null,
    unit: null,
    jobs: ["Build exact staging artifact", "Deploy exact staging artifact"]
  };
  const harness = directHarness(descriptor, operation, {
    profile: realProfile,
    returnRunDetails: true
  });
  const result = await harness.client.run({
    record: harness.record,
    actor,
    runtime: savedRuntime,
    operations: {
      "staging:integrate:frontend": {
        base: "b".repeat(40),
        result: { status: "passed", kind: "merge", tree: "a".repeat(40) }
      }
    },
    steps: [harness.record.step],
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  assert.equal(result.workflow.id, harness.run.id);
  const dispatches = harness.calls.filter(
    (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
  );
  assert.equal(dispatches.length, 1);
  assert.equal(harness.record.dispatch_after_run_id, 0);
  assert.equal(harness.record.workflow_run_id, harness.run.id);
  assert.deepEqual(dispatches[0].body, {
    ref: "1a-staging",
    inputs: {},
    return_run_details: true
  });
  const readsBeforeResume = harness.calls.filter((call) =>
    call.endpoint.includes("/git/commits/")
  ).length;
  const resumed = await harness.client.run({
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
  assert.equal(resumed.status, "passed");
  assert.equal(
    harness.calls.filter((call) => call.endpoint.includes("/git/commits/"))
      .length,
    readsBeforeResume
  );
  assert.equal(
    harness.calls.filter(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    ).length,
    1
  );
});

test("an unverifiable staging merge tree stops before dispatch", async () => {
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
    event: "workflow_dispatch",
    workflow: "deploy-staging.yml",
    workflowId: savedRuntime.frontend.workflows.stagingDeploy.workflow_id,
    title: null,
    unit: null,
    jobs: ["Build exact staging artifact", "Deploy exact staging artifact"]
  };
  const harness = directHarness(descriptor, operation);
  await assert.rejects(
    harness.client.run({
      record: harness.record,
      actor,
      runtime: savedRuntime,
      operations: {
        "staging:integrate:frontend": {
          base: "b".repeat(40),
          result: { status: "passed", kind: "merge" }
        }
      },
      steps: [harness.record.step],
      save: async () => {}
    }),
    /lacks its exact base or merged tree/u
  );
  assert.equal(
    harness.calls.some(
      (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
    ),
    false
  );
});

test("a chosen staging retest forces a new frontend deployment instead of adopting the old push run", async () => {
  const operation = makeReleaseOperation({
    release_id: "55555555-5555-4555-8555-555555555555",
    operation_id: "77777777-7777-4777-8777-777777777777",
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
    event: "workflow_dispatch",
    workflow: "deploy-staging.yml",
    workflowId: savedRuntime.frontend.workflows.stagingDeploy.workflow_id,
    title: null,
    unit: null,
    jobs: ["Build exact staging artifact", "Deploy exact staging artifact"]
  };
  const harness = directHarness(descriptor, operation);
  harness.record.force_dispatch = true;
  assert.deepEqual(
    await harness.client.environmentVersions("staging"),
    commits
  );
  const result = await harness.client.run({
    record: harness.record,
    actor,
    runtime: savedRuntime,
    operations: {
      "staging:integrate:frontend": {
        base: "b".repeat(40),
        result: { status: "passed", kind: "merge", tree: "a".repeat(40) }
      }
    },
    steps: [harness.record.step],
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  const dispatches = harness.calls.filter(
    (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
  );
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].body.ref, "1a-staging");
  assert.equal(dispatches[0].body.return_run_details, true);
  assert.deepEqual(dispatches[0].body.inputs, {});
  assert.equal(result.workflow.id, harness.run.id);
});

test("staging recovery dispatches a fresh frontend deploy after backend recovery", async () => {
  const operation = makeReleaseOperation({
    release_id: "12121212-1212-4212-8212-121212121212",
    operation_id: "34343434-3434-4434-8434-343434343434",
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
    event: "workflow_dispatch",
    workflow: "deploy-staging.yml",
    workflowId: savedRuntime.frontend.workflows.stagingDeploy.workflow_id,
    title: null,
    unit: null,
    jobs: ["Build exact staging artifact", "Deploy exact staging artifact"]
  };
  const harness = directHarness(descriptor, operation);
  harness.record.step.id = "restore:staging:deploy:frontend:frontend";
  const result = await harness.client.run({
    record: harness.record,
    actor,
    runtime: savedRuntime,
    operations: {
      "restore:staging:integrate:frontend": {
        result: { status: "passed", kind: "merge" }
      }
    },
    steps: [harness.record.step],
    save: async () => {}
  });
  assert.equal(result.status, "passed");
  const dispatches = harness.calls.filter(
    (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
  );
  assert.equal(dispatches.length, 1);
  assert.deepEqual(dispatches[0].body, {
    ref: "1a-staging",
    inputs: {},
    return_run_details: true
  });
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

/** Construct verified deployment evidence for the chosen profile's E2E inputs. */
function dependencyReport(
  operation,
  role,
  runId,
  unit,
  profile = sandboxProfile
) {
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
    repository: profile.repositories[role].full_name,
    run_id: runId,
    ...(profile.name === "real" ? { run_attempt: 1 } : { artifact })
  };
  const report = {
    protocol: operation.protocol,
    profile: profile.name,
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
    builds: profile.name === "real" ? {} : { [role]: { manifest, artifact } },
    deployments: { [role]: deployment },
    versions: { ...commits },
    runner: {
      repository: profile.repositories[role].full_name,
      run_id: runId,
      attempt: 1,
      commit: sourceCommit,
      workflow
    },
    completed_at: "2026-09-21T15:58:00.000Z"
  };
  verifyProductWorkflowReport(report, operation);
  return report;
}

/** Model the causal deployment, wrapper and E2E chain using read-only fake responses. */
function automaticHarness({
  profile = sandboxProfile,
  environment = "staging",
  wrapperStatuses = ["in_progress"],
  wrapperJobConclusion,
  e2eStatuses = [],
  missingWrapper = false,
  missingE2e = false,
  missingKnownRun,
  observeRun,
  signal,
  wait = async () => {},
  save = async () => {}
} = {}) {
  const staging = environment === "staging";
  const label = staging ? "Staging" : "Production";
  const filePrefix = staging ? "staging" : "production";
  const runtime =
    profile.name === "real"
      ? realProductWorkflowRuntime
      : productWorkflowRuntime;
  const releaseId = "77777777-7777-4777-8777-777777777777";
  const backendOperation = makeProfileReleaseOperation({
    profile: profile.name,
    release_id: releaseId,
    operation_id: "88888888-8888-4888-8888-888888888888",
    operation: "deploy",
    environment,
    role: "backend",
    unit: "api",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const frontendOperation = makeProfileReleaseOperation({
    profile: profile.name,
    release_id: releaseId,
    operation_id: "99999999-9999-4999-8999-999999999999",
    operation: "deploy",
    environment,
    role: "frontend",
    unit: "frontend",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const e2eOperation = makeProfileReleaseOperation({
    profile: profile.name,
    release_id: releaseId,
    operation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    operation: "e2e",
    environment,
    role: null,
    unit: null,
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const backendReport = dependencyReport(
    backendOperation,
    "backend",
    601,
    "api",
    profile
  );
  const frontendReport = dependencyReport(
    frontendOperation,
    "frontend",
    602,
    null,
    profile
  );
  const wrapper = {
    id: 603,
    repository: {
      id: profile.repositories.frontend.id,
      full_name: profile.repositories.frontend.full_name
    },
    head_repository: { id: profile.repositories.frontend.id },
    head_sha: "c".repeat(40),
    head_branch: "main",
    event: "workflow_run",
    run_attempt: 1,
    path: `.github/workflows/${filePrefix}-e2e-dispatch.yml`,
    display_title: `${label} E2E dispatch [602]`,
    actor,
    workflow_id:
      savedRuntime.frontend.workflows[
        staging ? "stagingDispatch" : "prodDispatch"
      ].workflow_id,
    status: "completed",
    conclusion: "success",
    html_url: "https://example.invalid/runs/603",
    created_at: "2026-09-21T16:00:00.000Z",
    updated_at: "2026-09-21T16:01:00.000Z"
  };
  const e2eRun = {
    ...wrapper,
    id: 604,
    event: "workflow_dispatch",
    path: `.github/workflows/${filePrefix}-e2e.yml`,
    display_title: `${label} E2E automatic 602`,
    actor: runtime.githubActionsActor,
    workflow_id:
      savedRuntime.frontend.workflows[staging ? "stagingE2e" : "prodE2e"]
        .workflow_id,
    html_url: "https://example.invalid/runs/604",
    updated_at: "2026-09-21T16:02:00.000Z"
  };
  const deploymentRun = {
    ...wrapper,
    id: 602,
    head_sha: commits.frontend,
    head_branch: staging ? "1a-staging" : "main",
    event: "push",
    path: `.github/workflows/${staging ? "deploy-staging" : "build-upload-deploy-prod"}.yml`,
    display_title: `${label} deployment`,
    workflow_id:
      savedRuntime.frontend.workflows[staging ? "stagingDeploy" : "prodDeploy"]
        .workflow_id,
    created_at: "2026-09-21T15:59:00.000Z"
  };
  const automaticQueries = [];
  const calls = [];
  const reads = { wrapper: 0, e2e: 0 };
  /** Advance the selected automatic phase without mutating its base identity. */
  const readRun = (run, key, statuses) => {
    const status = statuses[reads[key]++] ?? run.status;
    const observed = {
      ...run,
      status,
      conclusion: status === "completed" ? run.conclusion : null
    };
    observeRun?.(observed, key, reads[key]);
    return observed;
  };
  /** Serve the automatic chain and fail if the adapter tries any write request. */
  const execute = async (args) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    calls.push({ method, endpoint });
    assert.equal(method, "GET", "E2E must only adopt the automatic chain");
    if (endpoint.includes("/contents/"))
      return apiResponse("200 OK", runtimeFile(endpoint, runtime, environment));
    if (endpoint.includes("/git/ref/heads/")) {
      const role = repositoryRole(endpoint);
      return apiResponse("200 OK", { object: { sha: commits[role] } });
    }
    if (endpoint.endsWith(`/actions/runs/${deploymentRun.id}`))
      return apiResponse("200 OK", deploymentRun);
    if (
      endpoint.endsWith(`/actions/runs/${wrapper.id}`) &&
      missingKnownRun === "wrapper"
    )
      return apiResponse("404 Not Found", { message: "Not Found" });
    if (
      endpoint.endsWith(`/actions/runs/${e2eRun.id}`) &&
      missingKnownRun === "e2e"
    )
      return apiResponse("404 Not Found", { message: "Not Found" });
    if (endpoint.endsWith(`/actions/runs/${wrapper.id}`))
      return apiResponse(
        "200 OK",
        readRun(wrapper, "wrapper", wrapperStatuses)
      );
    if (endpoint.endsWith(`/actions/runs/${e2eRun.id}`))
      return apiResponse("200 OK", readRun(e2eRun, "e2e", e2eStatuses));
    if (endpoint.includes(`${filePrefix}-e2e-dispatch.yml/runs?`)) {
      automaticQueries.push(endpoint);
      return apiResponse("200 OK", {
        total_count: missingWrapper ? 0 : 1,
        workflow_runs: missingWrapper
          ? []
          : [readRun(wrapper, "wrapper", wrapperStatuses)]
      });
    }
    if (endpoint.includes(`${filePrefix}-e2e.yml/runs?`)) {
      automaticQueries.push(endpoint);
      return apiResponse("200 OK", {
        total_count: missingE2e ? 0 : 1,
        workflow_runs: missingE2e ? [] : [readRun(e2eRun, "e2e", e2eStatuses)]
      });
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
            name: `Dispatch successful ${staging ? "staging" : "production"} deployment`,
            run_id: wrapper.id,
            head_sha: wrapper.head_sha,
            status: "completed",
            conclusion: wrapperJobConclusion ?? wrapper.conclusion
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
            name: staging
              ? "Staging E2E packs"
              : "Production read-only E2E packs",
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
    profile,
    execute,
    base: {},
    polls: 2,
    pollMs: 0,
    signal,
    wait
  });
  const steps = [
    {
      id: `${environment}:deploy:backend:api`,
      kind: "deploy",
      environment,
      role: "backend",
      unit: "api"
    },
    {
      id: `${environment}:deploy:frontend:frontend`,
      kind: "deploy",
      environment,
      role: "frontend",
      unit: "frontend"
    },
    {
      id: `${environment}:e2e`,
      kind: "e2e",
      environment,
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
  /** Start an E2E record whose deployment-triggered chain may already exist. */
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
  const record = makeRecord();
  /** Follow the mutable saved fixture record, including interrupted-run snapshots. */
  const run = () =>
    client.run({
      record,
      actor,
      runtime: savedRuntime,
      operations,
      steps,
      save
    });
  return {
    client,
    steps,
    operations,
    makeRecord,
    record,
    run,
    wrapper,
    e2eRun,
    deploymentRun,
    automaticQueries,
    calls
  };
}

for (const profile of [sandboxProfile, realProfile]) {
  for (const environment of ["staging", "prod"]) {
    for (const phase of ["wrapper", "e2e"]) {
      test(`${profile.name} ${environment} automatic ${phase} waits past sixty polls without a new dispatch`, async () => {
        let waits = 0;
        const harness = automaticHarness({
          profile,
          environment,
          [phase === "wrapper" ? "wrapperStatuses" : "e2eStatuses"]: [
            "queued",
            "waiting",
            ...Array(65).fill("in_progress")
          ],
          /** Count long-chain polls without sleeping. */
          wait: async () => waits++
        });
        const result = await harness.run();
        assert.equal(result.status, "passed");
        assert.equal(result.workflow.id, harness.e2eRun.id);
        assert.ok(waits > 60);
        assert.equal(
          harness.calls.some(({ method }) => method !== "GET"),
          false
        );
      });
    }
  }
}

test("slow automatic E2E keeps a genuine failure and its matching deployment", async () => {
  const harness = automaticHarness({
    e2eStatuses: Array(65).fill("in_progress")
  });
  harness.e2eRun.conclusion = "failure";
  const result = await harness.run();
  assert.equal(result.status, "failed");
  assert.equal(result.deployment_workflow.id, 602);
  assert.deepEqual(result.report.deployments, {});
});

for (const phase of ["Wrapper", "E2e"]) {
  test(`automatic missing ${phase} discovery stays bounded`, async () => {
    let waits = 0;
    const harness = automaticHarness({
      [`missing${phase}`]: true,
      /** Count the discovery budget separately from known-run duration. */
      wait: async () => waits++
    });
    await assert.rejects(harness.run(), /could not be found/u);
    assert.ok(waits <= 2);
    assert.equal(harness.record.workflow_run_id, undefined);
  });
}

test("cancellation leaves the exact E2E chain resumable without another dispatch", async () => {
  const controller = new AbortController();
  const harness = automaticHarness({
    e2eStatuses: Array(65).fill("in_progress"),
    signal: controller.signal,
    /** Interrupt only after the E2E run ID has been saved. */
    wait: async () => {
      if (harness.record.workflow_run_id) controller.abort();
    }
  });
  await assert.rejects(harness.run(), { name: "AbortError" });
  assert.equal(harness.record.workflow_run_id, 604);
  assert.equal(harness.record.dispatch_workflow_run_id, 603);
  const resumed = automaticHarness({ e2eStatuses: Array(65).fill("queued") });
  Object.assign(resumed.record, harness.record);
  assert.equal((await resumed.run()).status, "passed");
  assert.equal(
    resumed.calls.some(({ endpoint }) => endpoint.includes("/runs?")),
    false
  );
});

test("cancellation during the wrapper-only wait saves that exact run for resume", async () => {
  const controller = new AbortController();
  const snapshots = [];
  const harness = automaticHarness({
    wrapperStatuses: Array(65).fill("in_progress"),
    signal: controller.signal,
    /** Interrupt before the wrapper has launched a discoverable E2E run. */
    wait: async () => controller.abort(),
    /** Capture the exact persisted wrapper-only state for JSON round-trip resume. */
    save: async () => snapshots.push(structuredClone(harness.record))
  });
  await assert.rejects(harness.run(), { name: "AbortError" });
  assert.equal(snapshots.length, 1);
  const saved = JSON.parse(JSON.stringify(snapshots.at(-1)));
  assert.equal(saved.dispatch_workflow_run_id, 603);
  assert.equal(saved.deployment_workflow_run_id, 602);
  assert.equal(saved.workflow_run_id, undefined);
  assert.equal(saved.state, "running");
  const resumed = automaticHarness({ wrapperStatuses: ["in_progress"] });
  Object.assign(resumed.record, saved);
  assert.equal((await resumed.run()).status, "passed");
  assert.equal(
    resumed.calls.some(({ endpoint }) =>
      endpoint.includes("staging-e2e-dispatch.yml/runs?")
    ),
    false
  );
});

test("cancellation during the wrapper-only save makes no further API request", async () => {
  const controller = new AbortController();
  let callsAtAbort;
  const harness = automaticHarness({
    wrapperStatuses: ["in_progress"],
    signal: controller.signal,
    /** Abort during persistence to detect any subsequent API request. */
    save: async () => {
      callsAtAbort = harness.calls.length;
      controller.abort();
    }
  });
  await assert.rejects(harness.run(), { name: "AbortError" });
  assert.equal(harness.calls.length, callsAtAbort);
  assert.equal(harness.record.dispatch_workflow_run_id, 603);
  assert.equal(harness.record.workflow_run_id, undefined);
});

for (const phase of ["wrapper", "e2e"]) {
  for (const field of [
    "id",
    "status",
    "actor",
    "workflow_id",
    "head_branch",
    "event"
  ]) {
    test(`automatic ${phase} rejects changed ${field} while waiting`, async () => {
      const harness = automaticHarness({
        [phase === "wrapper" ? "wrapperStatuses" : "e2eStatuses"]:
          Array(65).fill("in_progress"),
        /** Corrupt one previously confirmed phase identity during polling. */
        observeRun: (run, key, read) => {
          if (key === phase && read === 4)
            run[field] =
              field === "id"
                ? 999
                : field === "actor"
                  ? { ...run.actor, id: "999" }
                  : "unexpected";
        }
      });
      await assert.rejects(harness.run(), /chain does not match/u);
    });
  }
  test(`a confirmed automatic ${phase} disappearing stops without a replacement`, async () => {
    const harness = automaticHarness({
      missingKnownRun: phase,
      [phase === "wrapper" ? "wrapperStatuses" : "e2eStatuses"]:
        Array(65).fill("in_progress")
    });
    await assert.rejects(harness.run(), /404/u);
    assert.equal(
      harness.calls.every(({ method }) => method === "GET"),
      true
    );
  });
}

for (const conclusion of ["cancelled", "timed_out"]) {
  test(`automatic E2E ending ${conclusion} is never accepted`, async () => {
    const harness = automaticHarness();
    harness.e2eRun.conclusion = conclusion;
    await assert.rejects(harness.run(), /ended without usable evidence/u);
  });
}

for (const profile of [sandboxProfile, realProfile]) {
  for (const environment of ["staging", "prod"]) {
    test(`${profile.name} ${environment} confirmed wrapper failure returns genuine failed evidence without claiming E2E ran`, async () => {
      const harness = automaticHarness({
        profile,
        environment,
        wrapperStatuses: Array(65).fill("in_progress")
      });
      harness.wrapper.conclusion = "failure";
      const result = await harness.run();
      assert.equal(result.status, "failed");
      assert.equal(result.report.failure_stage, "e2e-dispatch");
      assert.equal(result.report.runner.run_id, 603);
      assert.equal(result.report.runner.workflow, harness.wrapper.path);
      assert.deepEqual(result.report.builds, {});
      assert.deepEqual(result.report.deployments, {});
      assert.equal(harness.record.workflow_run_id, undefined);
      assert.equal(harness.record.dispatch_workflow_run_id, 603);
      assert.equal(
        harness.calls.some(({ endpoint }) =>
          endpoint.includes(
            `${environment === "staging" ? "staging" : "production"}-e2e.yml/runs?`
          )
        ),
        false
      );
      assert.equal(
        verifyProductWorkflowReport(result.report, harness.record.operation),
        result.report
      );
      for (const change of [
        { status: "passed" },
        { failure_stage: "unknown" },
        { checks: [{ name: "product-shaped-workflow", status: "failed" }] },
        { checks: [{ name: "automatic-e2e-dispatch", status: "passed" }] },
        { deployments: { frontend: {} } },
        { builds: { frontend: {} } },
        { adapter: "product-workflow-mirror-v1" },
        { failure_stage: undefined }
      ]) {
        assert.throws(() =>
          verifyProductWorkflowReport(
            { ...result.report, ...change },
            harness.record.operation
          )
        );
      }
    });
  }
}

test("a failed wrapper with successful jobs remains uncertain rather than triggering recovery", async () => {
  const harness = automaticHarness({ wrapperJobConclusion: "success" });
  harness.wrapper.conclusion = "failure";
  await assert.rejects(harness.run(), /contradicts its jobs/u);
  assert.equal(harness.record.state, "running");
  assert.equal(harness.record.dispatch_workflow_run_id, 603);
  assert.equal(harness.record.workflow_run_id, undefined);
});

test("cancellation during the failed wrapper read cannot accept failed evidence", async () => {
  const controller = new AbortController();
  const harness = automaticHarness({
    signal: controller.signal,
    /** Interrupt precisely when the confirmed wrapper reports a terminal failure. */
    observeRun: (run, key) => {
      if (key === "wrapper" && run.status === "completed") controller.abort();
    }
  });
  harness.wrapper.conclusion = "failure";
  await assert.rejects(harness.run(), { name: "AbortError" });
  assert.equal(
    harness.calls.some(({ endpoint }) =>
      endpoint.endsWith("/jobs?per_page=100")
    ),
    false
  );
});

for (const conclusion of ["cancelled", "timed_out"]) {
  test(`a slow automatic dispatch wrapper ending ${conclusion} stops before E2E acceptance`, async () => {
    const harness = automaticHarness({
      wrapperStatuses: Array(65).fill("in_progress")
    });
    harness.wrapper.conclusion = conclusion;
    await assert.rejects(harness.run(), /dispatch wrapper did not pass/u);
    assert.equal(
      harness.calls.some(({ endpoint }) =>
        endpoint.includes("staging-e2e.yml/runs?")
      ),
      false
    );
  });
}

test("cancellation while reading the completed E2E result cannot accept it", async () => {
  const controller = new AbortController();
  const harness = automaticHarness({
    signal: controller.signal,
    e2eStatuses: ["in_progress"],
    /** Cancel the completed E2E response before job evidence can be read. */
    observeRun: (run, key) => {
      if (key === "e2e" && run.status === "completed") controller.abort();
    }
  });
  await assert.rejects(harness.run(), { name: "AbortError" });
  assert.equal(
    harness.calls.some(({ endpoint }) =>
      endpoint.endsWith("/jobs?per_page=100")
    ),
    false
  );
});

test("automatic E2E is bound to the exact frontend deployment and saved backend deployment", async () => {
  const {
    client,
    steps,
    operations,
    makeRecord,
    e2eRun,
    deploymentRun,
    automaticQueries
  } = automaticHarness();
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
  const frontendOnly = await client.run({
    record: makeRecord(),
    actor,
    runtime: savedRuntime,
    operations: { [steps[1].id]: operations[steps[1].id] },
    steps: steps.slice(1),
    save: async () => {}
  });
  assert.equal(frontendOnly.status, "passed");
  assert.deepEqual(Object.keys(frontendOnly.report.deployments), ["frontend"]);
  assert.equal(frontendOnly.report.deployments.frontend.run_id, 602);
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
  deploymentRun.created_at = "2026-09-21T15:57:00.000Z";
  await assert.rejects(
    client.run({
      record: makeRecord(),
      actor,
      runtime: savedRuntime,
      operations,
      steps,
      save: async () => {}
    }),
    /frontend deployment started before the matching backend deployment finished/u
  );
  assert.equal(automaticQueries.length, 6);
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

test("the product-shaped sandbox accepts frontend-only E2E evidence for its selected deployment", () => {
  const releaseId = "edededed-eded-4ded-8ded-edededededed";
  const frontendOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "12121212-1212-4212-8212-121212121212",
    operation: "deploy",
    environment: "staging",
    role: "frontend",
    unit: "frontend",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const e2eOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "34343434-3434-4434-8434-343434343434",
    operation: "e2e",
    environment: "staging",
    role: null,
    unit: null,
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const frontend = dependencyReport(frontendOperation, "frontend", 602, null);
  const report = {
    protocol: e2eOperation.protocol,
    profile: "sandbox",
    adapter: productWorkflowReleaseAdapter,
    release_id: releaseId,
    operation_id: e2eOperation.operation_id,
    operation_hash: e2eOperation.fingerprint,
    operation: "e2e",
    environment: "staging",
    role: null,
    unit: null,
    status: "passed",
    checks: [{ name: "product-shaped-workflow", status: "passed" }],
    builds: frontend.builds,
    deployments: frontend.deployments,
    versions: { ...commits },
    runner: {
      repository: sandboxProfile.repositories.frontend.full_name,
      run_id: 604,
      attempt: 1,
      commit: "c".repeat(40),
      workflow: ".github/workflows/staging-e2e.yml"
    },
    completed_at: "2026-09-21T16:02:00.000Z"
  };
  assert.equal(verifyProductWorkflowReport(report, e2eOperation), report);
  delete report.deployments.frontend;
  assert.throws(
    () => verifyProductWorkflowReport(report, e2eOperation),
    /does not match its saved operation/u
  );
});

test("product-shaped E2E cannot omit a backend deployment selected by the plan", async () => {
  const releaseId = "56565656-5656-4656-8656-565656565656";
  const frontendOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "78787878-7878-4878-8878-787878787878",
    operation: "deploy",
    environment: "staging",
    role: "frontend",
    unit: "frontend",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const e2eOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "90909090-9090-4090-8090-909090909090",
    operation: "e2e",
    environment: "staging",
    role: null,
    unit: null,
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
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
  const client = createProductWorkflowReleaseGitHub({
    profile: sandboxProfile,
    execute: async () => assert.fail("missing dependency must precede GitHub"),
    base: {},
    polls: 1,
    wait: async () => {}
  });
  await assert.rejects(
    client.run({
      record: {
        id: e2eOperation.operation_id,
        release_id: releaseId,
        step: steps[2],
        state: "prepared",
        actor,
        created_at: "2026-09-21T16:00:00.000Z",
        operation: e2eOperation
      },
      actor,
      runtime: savedRuntime,
      operations: {
        [steps[1].id]: {
          result: {
            status: "passed",
            report: dependencyReport(frontendOperation, "frontend", 602, null)
          },
          operation: frontendOperation
        }
      },
      steps,
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
