import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  COORDINATOR_REPOSITORY,
  SUBMISSION_WORKFLOW,
  submitReleaseRequestToGitHub
} from "./github-submission.mjs";

const RUN_RECORD_VERSION = "0.000001";
const GENERATED_FIELDS = ["schema_version", "request_id", "created_at"];

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(packageDirectory, "..", "release-request.schema.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const RELEASE_REQUEST_SCHEMA_VERSION = schema.properties.schema_version.const;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  // These fields are defined on release_part and required inside its backend condition.
  strictRequired: false
});
addFormats(ajv);
const validateRequestSchema = ajv.compile(schema);

const inputTemplate = {
  requested_by: "",
  target: "staging",
  database_change: "unknown",
  release_parts: [
    {
      id: "backend",
      repository: "6529seize-backend",
      pull_requests: [
        {
          number: 0,
          branch: "",
          commit: ""
        }
      ],
      depends_on: [],
      deploy_units: [""],
      deploy_dependencies: []
    },
    {
      id: "frontend",
      repository: "6529seize-frontend",
      pull_requests: [
        {
          number: 0,
          branch: "",
          commit: ""
        }
      ],
      depends_on: ["backend"]
    }
  ]
};

export function getInputTemplate() {
  return structuredClone(inputTemplate);
}

export function getReleaseRequestSchema() {
  return structuredClone(schema);
}

export function validateReleaseRequest(request) {
  const ok = validateRequestSchema(request);

  return {
    ok,
    errors: ok ? [] : validationErrors(validateRequestSchema.errors)
  };
}

function timestamp(now) {
  return now().toISOString();
}

function relativeRuntimePath(...parts) {
  return path.posix.join(".release-coordinator", ...parts);
}

function absoluteRuntimePath(projectDirectory, ...parts) {
  return path.join(projectDirectory, ".release-coordinator", ...parts);
}

async function writeNewJson(filePath, value, createTemporaryId) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${createTemporaryId()}.tmp`;

  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });

  try {
    await link(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
}

async function replaceJson(filePath, value, createTemporaryId) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${createTemporaryId()}.tmp`;

  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });

  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function errorRecord(code, message, location = "$") {
  return { code, location, message };
}

function validationErrors(errors = []) {
  return errors.map((error) => {
    let location = error.instancePath || "$";
    if (error.keyword === "required" && error.params?.missingProperty) {
      location = `${location === "$" ? "" : location}/${error.params.missingProperty}` || "$";
    }

    return errorRecord(error.keyword, error.message || "is invalid", location);
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createFinalRequest(draft, requestId, createdAt) {
  const errors = [];

  if (!isPlainObject(draft)) {
    return {
      errors: [errorRecord("input_type", "Input must be one JSON object.")],
      request: null
    };
  }

  for (const field of GENERATED_FIELDS) {
    if (Object.hasOwn(draft, field)) {
      errors.push(
        errorRecord(
          "generated_field",
          `${field} is created by the CLI and must not be provided.`,
          `/${field}`
        )
      );
    }
  }

  if (errors.length > 0) {
    return { errors, request: null };
  }

  const request = {
    schema_version: RELEASE_REQUEST_SCHEMA_VERSION,
    request_id: requestId,
    created_at: createdAt,
    ...draft
  };

  const validation = validateReleaseRequest(request);
  if (!validation.ok) {
    return {
      errors: validation.errors,
      request: null
    };
  }

  return { errors: [], request };
}

function baseRunRecord({ runId, startedAt, inputSource }) {
  return {
    run_record_version: RUN_RECORD_VERSION,
    run_id: runId,
    status: "running",
    started_at: startedAt,
    finished_at: null,
    input: {
      source: inputSource,
      text: null
    },
    errors: [],
    request: null,
    submission: null
  };
}

async function finishFailedRun({ run, runPath, errors, now, createTemporaryId }) {
  const failedRun = {
    ...run,
    status: "failed",
    finished_at: timestamp(now),
    errors,
    request: null
  };

  await replaceJson(runPath, failedRun, createTemporaryId);
  return failedRun;
}

export async function createReleaseRequestRun({
  projectDirectory = process.cwd(),
  inputSource = "stdin",
  readInput,
  now = () => new Date(),
  createId = randomUUID,
  createTemporaryId = randomUUID
}) {
  if (typeof readInput !== "function") {
    throw new TypeError("readInput must be a function.");
  }

  const runId = createId();
  const startedAt = timestamp(now);
  const runRelativePath = relativeRuntimePath("runs", `${runId}.json`);
  const runPath = absoluteRuntimePath(projectDirectory, "runs", `${runId}.json`);
  let run = baseRunRecord({ runId, startedAt, inputSource });

  try {
    await writeNewJson(runPath, run, createTemporaryId);
  } catch (error) {
    throw new Error(`Could not save the initial run record: ${error.message}`, {
      cause: error
    });
  }

  let inputText;
  try {
    inputText = await readInput();
  } catch (error) {
    const failedRun = await finishFailedRun({
      run,
      runPath,
      errors: [errorRecord("input_read", `Could not read input: ${error.message}`)],
      now,
      createTemporaryId
    });

    return { ok: false, run: failedRun, runPath: runRelativePath };
  }

  if (typeof inputText !== "string") {
    inputText = String(inputText);
  }

  run = {
    ...run,
    input: {
      source: inputSource,
      text: inputText
    }
  };
  await replaceJson(runPath, run, createTemporaryId);

  let draft;
  try {
    draft = JSON.parse(inputText);
  } catch (error) {
    const failedRun = await finishFailedRun({
      run,
      runPath,
      errors: [errorRecord("invalid_json", `Input is not valid JSON: ${error.message}`)],
      now,
      createTemporaryId
    });

    return { ok: false, run: failedRun, runPath: runRelativePath };
  }

  const requestId = createId();
  const createdAt = timestamp(now);
  const result = createFinalRequest(draft, requestId, createdAt);

  if (result.errors.length > 0) {
    const failedRun = await finishFailedRun({
      run,
      runPath,
      errors: result.errors,
      now,
      createTemporaryId
    });

    return { ok: false, run: failedRun, runPath: runRelativePath };
  }

  const requestRelativePath = relativeRuntimePath("outbox", `${requestId}.json`);
  const requestPath = absoluteRuntimePath(projectDirectory, "outbox", `${requestId}.json`);

  try {
    await writeNewJson(requestPath, result.request, createTemporaryId);
  } catch (error) {
    const failedRun = await finishFailedRun({
      run,
      runPath,
      errors: [errorRecord("request_save", `Could not save request: ${error.message}`)],
      now,
      createTemporaryId
    });

    return { ok: false, run: failedRun, runPath: runRelativePath };
  }

  const succeededRun = {
    ...run,
    status: "succeeded",
    finished_at: timestamp(now),
    errors: [],
    request: {
      id: requestId,
      path: requestRelativePath
    }
  };
  await replaceJson(runPath, succeededRun, createTemporaryId);

  return {
    ok: true,
    request: result.request,
    requestPath: requestRelativePath,
    run: succeededRun,
    runPath: runRelativePath
  };
}

export async function submitReleaseRequestRun({
  projectDirectory = process.cwd(),
  inputSource = "stdin",
  readInput,
  now = () => new Date(),
  createId = randomUUID,
  createTemporaryId = randomUUID,
  submitRequest = submitReleaseRequestToGitHub
}) {
  const created = await createReleaseRequestRun({
    projectDirectory,
    inputSource,
    readInput,
    now,
    createId,
    createTemporaryId
  });

  if (!created.ok) {
    return { ...created, submission: null };
  }

  const runPath = absoluteRuntimePath(
    projectDirectory,
    "runs",
    `${created.run.run_id}.json`
  );
  let run = {
    ...created.run,
    status: "running",
    finished_at: null,
    submission: {
      status: "running",
      repository: COORDINATOR_REPOSITORY,
      workflow: SUBMISSION_WORKFLOW,
      workflow_run_id: null,
      workflow_run_url: null,
      inbox_issue_number: null,
      inbox_issue_url: null,
      actor: null,
      actor_id: null,
      reason: null
    }
  };
  await replaceJson(runPath, run, createTemporaryId);

  let submission;
  try {
    submission = await submitRequest({ request: created.request });
  } catch (error) {
    submission = {
      ok: false,
      status: "failed",
      repository: COORDINATOR_REPOSITORY,
      workflow: SUBMISSION_WORKFLOW,
      workflowRun: null,
      inboxIssue: null,
      github: null,
      reason: `Could not submit the release request: ${error.message}`,
      errors: [
        errorRecord(
          "submission_error",
          `Could not submit the release request: ${error.message}`
        )
      ]
    };
  }

  const errors = submission.ok
    ? []
    : submission.errors || [
      errorRecord(
        "submission_failed",
        submission.reason || "The release request submission failed."
      )
    ];
  run = {
    ...run,
    status: submission.ok ? "succeeded" : "failed",
    finished_at: timestamp(now),
    errors,
    submission: {
      status: submission.status,
      repository: submission.repository || COORDINATOR_REPOSITORY,
      workflow: submission.workflow || SUBMISSION_WORKFLOW,
      workflow_run_id: submission.workflowRun?.id || null,
      workflow_run_url: submission.workflowRun?.url || null,
      inbox_issue_number: submission.inboxIssue?.number || null,
      inbox_issue_url: submission.inboxIssue?.url || null,
      actor: submission.github?.actor || null,
      actor_id: submission.github?.actor_id || null,
      reason: submission.reason || null
    }
  };
  await replaceJson(runPath, run, createTemporaryId);

  return {
    ...created,
    ok: submission.ok,
    run,
    submission
  };
}
