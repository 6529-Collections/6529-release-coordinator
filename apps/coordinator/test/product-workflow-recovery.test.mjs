import assert from "node:assert/strict";
import test from "node:test";
import { makeReleaseOperation } from "../src/release-contract.mjs";
import { createProductWorkflowReleaseGitHub } from "../src/product-workflow-release-github.mjs";
import { productWorkflowRuntime } from "../src/product-workflow-runtime-config.mjs";
import { sandboxProfile } from "../src/profiles.mjs";

const apiResponse = (status, data) =>
  `HTTP/2 ${status} Result\nContent-Type: application/json\n\n${data === undefined ? "" : JSON.stringify(data)}`;
const actor = { id: "456", login: "tester" };
const commits = { backend: "b".repeat(40), frontend: "f".repeat(40) };
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

function recoveryDispatch(operation, step, { block = false } = {}) {
  const calls = [];
  let quiet = !block;
  let waits = 0;
  const execute = async (args, body) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    calls.push({ method, endpoint, body });
    if (endpoint.includes("/contents/")) {
      const role = endpoint.includes("release-coordinator-test-frontend")
        ? "frontend"
        : "backend";
      const file = endpoint.match(/\/contents\/(.+)\?ref=/u)?.[1];
      return apiResponse("200 OK", {
        type: "file",
        path: file,
        sha: productWorkflowRuntime.repositories[role].files[file]
      });
    }
    if (endpoint.includes("/git/ref/heads/")) {
      const role = endpoint.includes("release-coordinator-test-frontend")
        ? "frontend"
        : "backend";
      return apiResponse("200 OK", { object: { sha: commits[role] } });
    }
    if (
      endpoint.includes("/actions/workflows/") &&
      endpoint.includes("/runs?")
    ) {
      const query = new URL(`https://example.invalid/${endpoint}`).searchParams;
      const blocking =
        !quiet && query.get("per_page") === "100" && !query.has("status")
          ? [
              {
                id: 490,
                html_url: "https://example.invalid/runs/490",
                status: "queued",
                actor: { login: "another-operator" }
              }
            ]
          : [];
      return apiResponse("200 OK", {
        total_count: blocking.length,
        workflow_runs: blocking
      });
    }
    if (method === "POST" && endpoint.endsWith("/dispatches"))
      return apiResponse("204 No Content");
    throw new Error(`Unexpected ${method} ${endpoint}`);
  };
  const client = createProductWorkflowReleaseGitHub({
    profile: sandboxProfile,
    execute,
    base: {},
    polls: 1,
    wait: async () => {
      // Each recoveryDispatch fixture runs one operation; its first wait makes
      // that operation's simulated external blocker finish.
      waits++;
      quiet = true;
    }
  });
  const record = {
    id: operation.operation_id,
    release_id: operation.release_id,
    step,
    state: "prepared",
    actor,
    created_at: "2026-09-21T17:00:00.000Z",
    operation
  };
  return {
    calls,
    waits: () => waits,
    run: () =>
      client.run({
        record,
        actor,
        runtime: savedRuntime,
        operations: {},
        steps: [step],
        save: async () => {}
      })
  };
}

test("recovery keeps restored staging services on 1a-staging and restored staging monitoring on main", async () => {
  const releaseId = "11111111-1111-4111-8111-111111111111";
  const backendOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: "deploy",
    environment: "staging",
    role: "backend",
    unit: "api",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const backend = recoveryDispatch(
    backendOperation,
    {
      id: "restore:staging:deploy:backend:api",
      kind: "deploy",
      environment: "staging",
      role: "backend",
      unit: "api"
    },
    { block: true }
  );
  await assert.rejects(
    backend.run(),
    /pending or ended without usable evidence/u
  );
  const backendRequest = backend.calls.find(
    (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
  );
  assert.equal(backendRequest.body.ref, "1a-staging");
  assert.equal(backendRequest.body.inputs.environment, "staging");
  assert.equal(backendRequest.body.inputs.expected_source_sha, commits.backend);
  assert.equal(backend.waits(), 1);
  assert.ok(
    backend.calls.some(({ endpoint }) =>
      endpoint.includes("/deploy.yml/runs?status=queued")
    )
  );

  const monitoringOperation = makeReleaseOperation({
    release_id: releaseId,
    operation_id: "33333333-3333-4333-8333-333333333333",
    operation: "monitoring",
    environment: "prod",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging",
    backend_commit: commits.backend,
    frontend_commit: commits.frontend
  });
  const monitoring = recoveryDispatch(monitoringOperation, {
    id: "restore:prod:monitoring:staging",
    kind: "monitoring",
    environment: "prod",
    role: "backend",
    unit: "monitoring",
    monitoring_environment: "staging"
  });
  await assert.rejects(
    monitoring.run(),
    /pending or ended without usable evidence/u
  );
  const monitoringRequest = monitoring.calls.find(
    (call) => call.method === "POST" && call.endpoint.endsWith("/dispatches")
  );
  assert.equal(monitoringRequest.body.ref, "main");
  assert.deepEqual(monitoringRequest.body.inputs, {
    environment: "staging",
    commit_sha: commits.backend
  });
});
