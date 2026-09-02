import { spawn } from "node:child_process";

export const COORDINATOR_REPOSITORY = "6529-Collections/6529-release-coordinator";
export const SUBMISSION_WORKFLOW = "submit-release-request.yml";

function errorRecord(code, message, location = "$") {
  return { code, location, message };
}

function shortMessage(result, fallback) {
  const message = result.stderr.trim() || result.stdout.trim();
  return message ? message.split("\n")[0] : fallback;
}

export function runGitHubCli(args, { input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {
      // A failed command may close stdin before the input has been written.
    });

    child.stdin.end(input);
  });
}

function failedSubmission(code, message, workflowRun = null, errors = null) {
  return {
    ok: false,
    status: "failed",
    repository: COORDINATOR_REPOSITORY,
    workflow: SUBMISSION_WORKFLOW,
    workflowRun,
    inboxIssue: null,
    github: null,
    reason: message,
    errors: errors || [errorRecord(code, message)]
  };
}

function workflowRunFromUrl(text) {
  const match = text.match(
    /https:\/\/github\.com\/[^\s]+\/actions\/runs\/(\d+)/
  );
  if (!match) {
    return null;
  }

  return { id: match[1], url: match[0] };
}

async function findWorkflowRun(requestId, runGh, sleep) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listed = await runGh([
      "run",
      "list",
      "--repo",
      COORDINATOR_REPOSITORY,
      "--workflow",
      SUBMISSION_WORKFLOW,
      "--event",
      "workflow_dispatch",
      "--limit",
      "20",
      "--json",
      "databaseId,displayTitle,url"
    ]);

    if (listed.exitCode !== 0) {
      return null;
    }

    try {
      const runs = JSON.parse(listed.stdout);
      const run = runs.find(
        (candidate) => candidate.displayTitle === `Release request ${requestId}`
      );
      if (run) {
        return { id: String(run.databaseId), url: run.url };
      }
    } catch {
      return null;
    }

    await sleep(1_000);
  }

  return null;
}

function readWorkflowResult(log) {
  const markers = [...log.matchAll(/RELEASE_REQUEST_RESULT=([A-Za-z0-9_-]+)/g)];
  const encoded = markers.at(-1)?.[1];
  if (!encoded) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function inboxIssueFromWorkflowResult(result) {
  const number = result.inbox_issue_number;
  const url = result.inbox_issue_url;
  if (!Number.isInteger(number) || number < 1 || typeof url !== "string") {
    return null;
  }

  const expectedUrl = `https://github.com/${COORDINATOR_REPOSITORY}/issues/${number}`;
  if (url !== expectedUrl) {
    return null;
  }

  return { number, url };
}

export async function submitReleaseRequestToGitHub({
  request,
  runGh = runGitHubCli,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  let authenticated;
  try {
    authenticated = await runGh(["auth", "status", "--hostname", "github.com"]);
  } catch (error) {
    if (error.code === "ENOENT") {
      return failedSubmission(
        "github_cli_missing",
        "GitHub CLI is not installed or is not available in PATH."
      );
    }
    return failedSubmission("github_cli", `Could not run GitHub CLI: ${error.message}`);
  }

  if (authenticated.exitCode !== 0) {
    return failedSubmission(
      "github_auth",
      shortMessage(authenticated, "GitHub CLI is not logged in to github.com.")
    );
  }

  const workflowInput = JSON.stringify({
    request_id: request.request_id,
    request_json: JSON.stringify(request)
  });
  let dispatched;
  try {
    dispatched = await runGh([
      "workflow",
      "run",
      SUBMISSION_WORKFLOW,
      "--repo",
      COORDINATOR_REPOSITORY,
      "--ref",
      "main",
      "--json"
    ], { input: workflowInput });
  } catch (error) {
    return failedSubmission(
      "github_dispatch",
      `Could not start the central workflow: ${error.message}`
    );
  }

  if (dispatched.exitCode !== 0) {
    return failedSubmission(
      "github_dispatch",
      shortMessage(dispatched, "GitHub refused to start the central workflow.")
    );
  }

  let workflowRun = workflowRunFromUrl(`${dispatched.stdout}\n${dispatched.stderr}`);
  if (!workflowRun) {
    try {
      workflowRun = await findWorkflowRun(request.request_id, runGh, sleep);
    } catch (error) {
      return failedSubmission(
        "github_run_lookup",
        `Could not find the central workflow run: ${error.message}`
      );
    }
  }
  if (!workflowRun) {
    return failedSubmission(
      "github_run_missing",
      "The workflow started, but its GitHub run could not be found."
    );
  }

  let watched;
  let viewed;
  try {
    watched = await runGh([
      "run",
      "watch",
      workflowRun.id,
      "--repo",
      COORDINATOR_REPOSITORY,
      "--exit-status"
    ]);
    viewed = await runGh([
      "run",
      "view",
      workflowRun.id,
      "--repo",
      COORDINATOR_REPOSITORY,
      "--log"
    ]);
  } catch (error) {
    return failedSubmission(
      "github_wait",
      `Could not wait for the central workflow: ${error.message}`,
      workflowRun
    );
  }
  const workflowResult = viewed.exitCode === 0
    ? readWorkflowResult(`${viewed.stdout}\n${viewed.stderr}`)
    : null;

  if (!workflowResult) {
    return failedSubmission(
      "github_result_missing",
      watched.exitCode === 0
        ? "The workflow finished, but its result could not be read."
        : "The central workflow failed without a readable reason.",
      workflowRun
    );
  }

  if (workflowResult.request_id !== request.request_id) {
    return failedSubmission(
      "github_result_mismatch",
      "The workflow result belongs to a different release request.",
      workflowRun
    );
  }

  if (watched.exitCode !== 0 || workflowResult.status !== "submitted") {
    const reason = workflowResult.reason || "The central workflow rejected the request.";
    const errors = Array.isArray(workflowResult.errors) && workflowResult.errors.length > 0
      ? workflowResult.errors
      : [errorRecord("workflow_failed", reason)];
    return failedSubmission("workflow_failed", reason, workflowRun, errors);
  }

  const inboxIssue = inboxIssueFromWorkflowResult(workflowResult);
  if (!inboxIssue) {
    return failedSubmission(
      "github_inbox_missing",
      "The workflow finished without a valid Coordinator inbox Issue.",
      workflowRun
    );
  }

  return {
    ok: true,
    status: "submitted",
    repository: COORDINATOR_REPOSITORY,
    workflow: SUBMISSION_WORKFLOW,
    workflowRun,
    inboxIssue,
    github: workflowResult.github || null,
    reason: null,
    errors: []
  };
}
