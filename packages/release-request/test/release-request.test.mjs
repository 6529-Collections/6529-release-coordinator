import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createReleaseRequestRun,
  getInputTemplate
} from "../src/index.mjs";

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

function idSequence(...ids) {
  let index = 0;
  return () => ids[index++] || `temporary-${index}`;
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
