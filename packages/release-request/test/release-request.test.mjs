import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createReleaseRequestRun,
  getInputTemplate,
  submitReleaseRequestRun,
  validateReleaseRequest
} from "../src/index.mjs";
import { submitReleaseRequestToGitHub } from "../src/github-submission.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(testDirectory, "..", "bin", "6529-release-request.mjs");

const fixedTime = "2026-08-31T10:00:00.000Z";

function validDraft() {
  return {
    requested_by: "simo",
    target: "staging",
    database_change: "no",
    release_parts: [
      {
        id: "backend",
        repository: "6529seize-backend",
        pull_requests: [
          {
            number: 123,
            branch: "feature/backend-change",
            commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        ],
        depends_on: [],
        deploy_units: ["api"],
        deploy_dependencies: []
      },
      {
        id: "frontend",
        repository: "6529seize-frontend",
        pull_requests: [
          {
            number: 456,
            branch: "feature/frontend-change",
            commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          }
        ],
        depends_on: ["backend"]
      }
    ]
  };
}

function validRequest() {
  return {
    schema_version: "0.000001",
    request_id: "22222222-2222-4222-8222-222222222222",
    created_at: fixedTime,
    ...validDraft()
  };
}

function idSequence(...ids) {
  let index = 0;
  return () => ids[index++] || `temporary-${index}`;
}

function workflowMarker(result) {
  return `RELEASE_REQUEST_RESULT=${Buffer.from(
    JSON.stringify(result)
  ).toString("base64url")}\n`;
}

async function temporaryProject(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "6529-release-request-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

test("template describes agent input and leaves generated fields to the CLI", () => {
  const template = getInputTemplate();

  assert.equal(template.schema_version, undefined);
  assert.equal(template.request_id, undefined);
  assert.equal(template.created_at, undefined);
  assert.equal(template.release_parts[0].repository, "6529seize-backend");
  assert.equal(template.release_parts[1].repository, "6529seize-frontend");
});

test("a complete release request can be validated again", () => {
  const result = validateReleaseRequest(validRequest());

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("complete request validation returns clear schema errors", () => {
  const request = validRequest();
  delete request.release_parts[0].deploy_units;

  const result = validateReleaseRequest(request);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === "required"), true);
  assert.equal(
    result.errors.some((error) => error.location.endsWith("/deploy_units")),
    true
  );
});

test("valid input saves a succeeded run and one outbox request", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const runId = "11111111-1111-4111-8111-111111111111";
  const requestId = "22222222-2222-4222-8222-222222222222";
  const inputText = JSON.stringify(validDraft());

  const result = await createReleaseRequestRun({
    projectDirectory,
    inputSource: "test",
    readInput: async () => inputText,
    now: () => new Date(fixedTime),
    createId: idSequence(runId, requestId)
  });

  assert.equal(result.ok, true);

  const run = await readJson(
    path.join(projectDirectory, ".release-coordinator", "runs", `${runId}.json`)
  );
  assert.equal(run.status, "succeeded");
  assert.equal(run.input.text, inputText);
  assert.equal(run.request.id, requestId);

  const request = await readJson(
    path.join(projectDirectory, ".release-coordinator", "outbox", `${requestId}.json`)
  );
  assert.equal(request.schema_version, "0.000001");
  assert.equal(request.request_id, requestId);
  assert.equal(request.created_at, fixedTime);
  assert.deepEqual(request.release_parts, validDraft().release_parts);
});

test("invalid JSON saves a failed run and no outbox request", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const runId = "33333333-3333-4333-8333-333333333333";

  const result = await createReleaseRequestRun({
    projectDirectory,
    inputSource: "test",
    readInput: async () => "{not-json",
    now: () => new Date(fixedTime),
    createId: idSequence(runId)
  });

  assert.equal(result.ok, false);
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.errors[0].code, "invalid_json");

  const run = await readJson(
    path.join(projectDirectory, ".release-coordinator", "runs", `${runId}.json`)
  );
  assert.equal(run.status, "failed");

  await assert.rejects(
    readdir(path.join(projectDirectory, ".release-coordinator", "outbox")),
    { code: "ENOENT" }
  );
});

test("schema validation failure saves errors and no outbox request", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const runId = "44444444-4444-4444-8444-444444444444";
  const draft = validDraft();
  delete draft.release_parts[0].deploy_units;

  const result = await createReleaseRequestRun({
    projectDirectory,
    inputSource: "test",
    readInput: async () => JSON.stringify(draft),
    now: () => new Date(fixedTime),
    createId: idSequence(
      runId,
      "55555555-5555-4555-8555-555555555555"
    )
  });

  assert.equal(result.ok, false);
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.errors.some((error) => error.code === "required"), true);
  assert.equal(result.run.request, null);
});

test("input read failure is saved as a failed run", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const runId = "66666666-6666-4666-8666-666666666666";

  const result = await createReleaseRequestRun({
    projectDirectory,
    inputSource: "missing.json",
    readInput: async () => {
      throw new Error("file does not exist");
    },
    now: () => new Date(fixedTime),
    createId: idSequence(runId)
  });

  assert.equal(result.ok, false);
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.errors[0].code, "input_read");

  const run = await readJson(
    path.join(projectDirectory, ".release-coordinator", "runs", `${runId}.json`)
  );
  assert.equal(run.status, "failed");
  assert.equal(run.input.source, "missing.json");
});

test("the CLI rejects generated fields from the agent and saves the run", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const draft = validDraft();
  draft.request_id = "99999999-9999-4999-8999-999999999999";

  const execution = spawnSync(
    process.execPath,
    [binPath, "create", "--input", "-", "--project-dir", projectDirectory],
    {
      encoding: "utf8",
      input: JSON.stringify(draft)
    }
  );

  assert.equal(execution.status, 1);
  const summary = JSON.parse(execution.stderr);
  assert.equal(summary.status, "failed");
  assert.equal(summary.errors[0].code, "generated_field");

  const runs = await readdir(
    path.join(projectDirectory, ".release-coordinator", "runs")
  );
  assert.equal(runs.length, 1);
});

test("the CLI template command prints JSON", () => {
  const execution = spawnSync(process.execPath, [binPath, "template"], {
    encoding: "utf8"
  });

  assert.equal(execution.status, 0);
  const template = JSON.parse(execution.stdout);
  assert.equal(template.target, "staging");
  assert.equal(template.release_parts.length, 2);
});

test("the CLI create command saves a valid request end to end", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const execution = spawnSync(
    process.execPath,
    [binPath, "create", "--input", "-", "--project-dir", projectDirectory],
    {
      encoding: "utf8",
      input: JSON.stringify(validDraft())
    }
  );

  assert.equal(execution.status, 0, execution.stderr);
  const summary = JSON.parse(execution.stdout);
  assert.equal(summary.status, "succeeded");
  assert.match(summary.run_id, /^[0-9a-f-]{36}$/);
  assert.match(summary.request_id, /^[0-9a-f-]{36}$/);

  const run = await readJson(path.join(projectDirectory, summary.run_path));
  const request = await readJson(path.join(projectDirectory, summary.request_path));
  assert.equal(run.status, "succeeded");
  assert.equal(request.request_id, summary.request_id);
});

test("GitHub submission returns a clear authentication failure", async () => {
  const result = await submitReleaseRequestToGitHub({
    request: validRequest(),
    runGh: async (args) => {
      assert.deepEqual(args, ["auth", "status", "--hostname", "github.com"]);
      return { exitCode: 1, stdout: "", stderr: "not logged in\n" };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "github_auth");
  assert.equal(result.reason, "not logged in");
});

test("GitHub submission starts, waits for, and reads the central workflow", async () => {
  const request = validRequest();
  const calls = [];
  const runUrl = "https://github.com/6529-Collections/6529-release-coordinator/actions/runs/12345";
  const workflowResult = {
    status: "submitted",
    request_id: request.request_id,
    github: {
      actor: "simo6529",
      actor_id: "209783236",
      workflow_run_id: "12345",
      workflow_run_url: runUrl
    }
  };

  const result = await submitReleaseRequestToGitHub({
    request,
    runGh: async (args, options = {}) => {
      calls.push(args.slice(0, 2).join(" "));
      if (args[0] === "auth") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "workflow") {
        const input = JSON.parse(options.input);
        assert.equal(input.request_id, request.request_id);
        assert.deepEqual(JSON.parse(input.request_json), request);
        return { exitCode: 0, stdout: `${runUrl}\n`, stderr: "" };
      }
      if (args[1] === "watch") {
        return { exitCode: 0, stdout: "completed\n", stderr: "" };
      }
      if (args[1] === "view") {
        return { exitCode: 0, stdout: workflowMarker(workflowResult), stderr: "" };
      }
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "submitted");
  assert.equal(result.workflowRun.id, "12345");
  assert.equal(result.github.actor, "simo6529");
  assert.deepEqual(calls, ["auth status", "workflow run", "run watch", "run view"]);
});

test("GitHub submission returns the workflow rejection reason", async () => {
  const request = validRequest();
  const runUrl = "https://github.com/6529-Collections/6529-release-coordinator/actions/runs/67890";
  const workflowResult = {
    status: "failed",
    request_id: request.request_id,
    reason: "Request does not match the release-request schema.",
    errors: [
      {
        code: "required",
        location: "/release_parts/0/deploy_units",
        message: "must have required property 'deploy_units'"
      }
    ]
  };

  const result = await submitReleaseRequestToGitHub({
    request,
    runGh: async (args) => {
      if (args[0] === "auth") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "workflow") {
        return { exitCode: 0, stdout: `${runUrl}\n`, stderr: "" };
      }
      if (args[1] === "watch") {
        return { exitCode: 1, stdout: "", stderr: "workflow failed\n" };
      }
      return { exitCode: 0, stdout: workflowMarker(workflowResult), stderr: "" };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, workflowResult.reason);
  assert.deepEqual(result.errors, workflowResult.errors);
  assert.equal(result.workflowRun.id, "67890");
});

test("a successful submit run saves GitHub proof locally", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const runId = "77777777-7777-4777-8777-777777777777";
  const requestId = "88888888-8888-4888-8888-888888888888";
  const runUrl = "https://github.com/6529-Collections/6529-release-coordinator/actions/runs/24680";

  const result = await submitReleaseRequestRun({
    projectDirectory,
    inputSource: "test",
    readInput: async () => JSON.stringify(validDraft()),
    now: () => new Date(fixedTime),
    createId: idSequence(runId, requestId),
    submitRequest: async ({ request }) => {
      assert.equal(request.request_id, requestId);
      return {
        ok: true,
        status: "submitted",
        repository: "6529-Collections/6529-release-coordinator",
        workflow: "submit-release-request.yml",
        workflowRun: { id: "24680", url: runUrl },
        github: { actor: "simo6529", actor_id: "209783236" },
        reason: null,
        errors: []
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.run.status, "succeeded");
  assert.equal(result.run.submission.status, "submitted");

  const run = await readJson(path.join(projectDirectory, result.runPath));
  assert.equal(run.request.id, requestId);
  assert.equal(run.submission.workflow_run_url, runUrl);
  assert.equal(run.submission.actor, "simo6529");
});

test("a rejected submit run keeps the valid request and failure reason", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const runId = "99999999-9999-4999-8999-999999999999";
  const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const error = {
    code: "github_auth",
    location: "$",
    message: "GitHub CLI is not logged in."
  };

  const result = await submitReleaseRequestRun({
    projectDirectory,
    inputSource: "test",
    readInput: async () => JSON.stringify(validDraft()),
    now: () => new Date(fixedTime),
    createId: idSequence(runId, requestId),
    submitRequest: async () => ({
      ok: false,
      status: "failed",
      repository: "6529-Collections/6529-release-coordinator",
      workflow: "submit-release-request.yml",
      workflowRun: null,
      github: null,
      reason: error.message,
      errors: [error]
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.request.id, requestId);
  assert.equal(result.run.submission.reason, error.message);
  assert.deepEqual(result.run.errors, [error]);

  const request = await readJson(path.join(projectDirectory, result.requestPath));
  assert.equal(request.request_id, requestId);
});

test("the CLI submit command saves invalid local input without calling GitHub", async (t) => {
  const projectDirectory = await temporaryProject(t);
  const execution = spawnSync(
    process.execPath,
    [binPath, "submit", "--input", "-", "--project-dir", projectDirectory],
    { encoding: "utf8", input: "{not-json" }
  );

  assert.equal(execution.status, 1);
  const summary = JSON.parse(execution.stderr);
  assert.equal(summary.status, "failed");
  assert.equal(summary.errors[0].code, "invalid_json");
  assert.equal(summary.workflow_run_id, null);

  const runs = await readdir(path.join(projectDirectory, ".release-coordinator", "runs"));
  assert.equal(runs.length, 1);
});
