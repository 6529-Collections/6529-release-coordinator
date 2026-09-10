import assert from "node:assert/strict";
import test from "node:test";
import {
  createServiceGitHub,
  readServiceLogs
} from "../src/service-github.mjs";
import { serviceFixture, serviceAdapter } from "./service-fixture.mjs";
import { buildServicePlan } from "../src/service-plan.mjs";
import { executeServiceSteps } from "../src/service-contract.mjs";
import { realProfile } from "../src/profiles.mjs";

test("Actions log transport accepts terminal controls without printing raw logs", async () => {
  const raw = "\u001b[36mrunner output\u001b[0m\n";
  const logs = await readServiceLogs(
    "repos/6529-Collections/release-coordinator-test-backend/actions/jobs/100/logs",
    async (file, args, options) => {
      assert.equal(file, "gh");
      assert.ok(args.includes("--allow-escape-sequences"));
      assert.equal(options.maxOutput, 4 * 1024 * 1024);
      assert.equal(options.timeout, 30000);
      return { stdout: raw };
    }
  );
  assert.equal(logs, raw);
});

async function githubFixture() {
  const f = serviceFixture(),
    plan = buildServicePlan(f.entry, f.report(), f.profile, f.runtime);
  const attempt = {
    id: "33333333-3333-4333-8333-333333333333",
    plan,
    plan_hash: plan.fingerprint,
    actor: { id: "456" },
    workflow_id: 12,
    workflow_run_id: 99
  };
  const run = {
    id: 99,
    repository: {
      id: f.runtime.repository_id,
      full_name: f.runtime.repository
    },
    head_repository: { id: f.runtime.repository_id },
    head_sha: f.runtime.commit,
    event: "workflow_dispatch",
    run_attempt: 1,
    path: ".github/workflows/sandbox-service-check.yml",
    display_title: `Sandbox services ${attempt.id}`,
    actor: { id: 456 },
    workflow_id: 12,
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/${f.runtime.repository}/actions/runs/99`
  };
  const job = {
    id: 100,
    name: "Sandbox service checks",
    run_id: 99,
    head_sha: f.runtime.commit,
    status: "completed",
    conclusion: "success",
    steps: [
      {
        name: "Run isolated sample",
        status: "completed",
        conclusion: "success"
      }
    ]
  };
  const report = await executeServiceSteps(plan, serviceAdapter(), {
    attemptId: attempt.id
  });
  report.runner = { run_id: "99", attempt: 1, commit: f.runtime.commit };
  const state = { report, run, job, duplicate: false, calls: [] };
  const prefix = `repos/${f.runtime.repository}`;
  const client = createServiceGitHub({
    profile: f.profile,
    runtime: f.runtime,
    execute: async (args, body) => {
      state.calls.push({ args, body });
      const method = args[args.indexOf("--method") + 1],
        endpoint = args[args.indexOf("--method") + 2];
      let value;
      if (endpoint === prefix)
        value = {
          id: f.runtime.repository_id,
          full_name: f.runtime.repository,
          private: false,
          permissions: { push: true }
        };
      else if (endpoint === "user") value = { id: 456, login: "trusted-user" };
      else if (endpoint.includes("/git/ref/heads/"))
        value = { object: { type: "commit", sha: f.runtime.commit } };
      else if (
        endpoint.endsWith("/actions/workflows/sandbox-service-check.yml")
      )
        value = { id: 12, path: run.path, state: "active" };
      else if (endpoint.endsWith("/dispatches")) {
        assert.equal(method, "POST");
        value = { workflow_run_id: 99 };
      } else if (endpoint.includes("/runs?"))
        value = {
          workflow_runs: state.duplicate ? [state.run, state.run] : [state.run]
        };
      else if (endpoint.endsWith("/actions/runs/99")) value = state.run;
      else if (endpoint.includes("/jobs?"))
        value = { total_count: 1, jobs: [state.job] };
      else assert.fail(endpoint);
      return `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify(value)}`;
    },
    logs: async () =>
      `2026-09-10T00:00:00Z COORDINATOR_SERVICE_RESULT:${Buffer.from(JSON.stringify(state.report)).toString("base64")}\n`
  });
  return { f, client, attempt, state };
}

test("GitHub adapter matches exact runtime, actor, plan, job and result", async () => {
  const { client, attempt, state } = await githubFixture();
  await client.identity();
  await client.dispatch(attempt);
  assert.equal((await client.find(attempt)).id, 99);
  assert.equal((await client.result(attempt)).report.status, "passed");
  assert.equal(
    state.calls.filter((call) => call.args.includes("POST")).length,
    1
  );
});

test("SD-08: wrong runtime, workflow, actor, attempts, cancelled/skipped steps and duplicate runs reject", async () => {
  for (const change of [
    (s) => {
      s.run.head_sha = "a".repeat(40);
    },
    (s) => {
      s.run.actor.id++;
    },
    (s) => {
      s.run.run_attempt = 2;
    },
    (s) => {
      s.run.event = "push";
    },
    (s) => {
      s.run.path = ".github/workflows/other.yml";
    },
    (s) => {
      s.run.conclusion = "cancelled";
    },
    (s) => {
      s.job.steps[0].conclusion = "skipped";
    },
    (s) => {
      s.report.runner.run_id = "another";
    },
    (s) => {
      s.report.plan_hash = "a".repeat(64);
    }
  ]) {
    const { client, attempt, state } = await githubFixture();
    change(state);
    await assert.rejects(client.result(attempt));
  }
  const { client, attempt, state } = await githubFixture();
  state.duplicate = true;
  await assert.rejects(client.find(attempt), /More than one/);
});

test("SD-09: a real profile or unpinned runtime cannot create the execution adapter", () => {
  assert.throws(
    () => createServiceGitHub({ profile: realProfile }),
    /never a fallback/
  );
  const f = serviceFixture();
  assert.throws(
    () =>
      createServiceGitHub({
        profile: f.profile,
        runtime: { ...f.runtime, ref: "main" }
      }),
    /never a fallback/
  );
  assert.throws(
    () =>
      createServiceGitHub({
        profile: f.profile,
        runtime: { ...f.runtime, repository_id: 579003578 }
      }),
    /never a fallback/
  );
});
