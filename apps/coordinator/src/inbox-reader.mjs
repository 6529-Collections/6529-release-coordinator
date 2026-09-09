import { realProfile, validateProfileRequest } from "./profiles.mjs";
import { releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";
import {
  COORDINATOR_REPOSITORY
} from "../../../packages/release-request/src/github-submission.mjs";

export { COORDINATOR_REPOSITORY };

const pageSize = 100;

class RecordProblem extends Error {
  constructor(message, status = "invalid") {
    super(message);
    this.status = status;
  }
}

function requireRecord(condition, message, status) {
  if (!condition) throw new RecordProblem(message, status);
}

function oneMatch(text, expression, description) {
  const matches = [...text.matchAll(expression)];
  requireRecord(matches.length === 1, `Expected exactly one ${description}.`);
  return matches[0][1];
}

export function parseSavedIssue(issue, profile = realProfile) {
  const web = `https://github.com/${profile.inbox.full_name}`;
  requireRecord(typeof issue.body === "string" && issue.body.length <= 65_536,
    "The Issue body is missing or exceeds the inbox format limit.");
  const body = issue.body.replaceAll("\r\n", "\n");
  const requestId = oneMatch(body, /^<!-- 6529-release-request-id:([^\n]*) -->$/gmu, "request ID marker");
  const checksum = oneMatch(body, /^<!-- 6529-release-request-checksum:([^\n]*) -->$/gmu, "checksum marker");
  requireRecord(/^[0-9a-f]{64}$/u.test(checksum), "The checksum marker is not a SHA-256 checksum.");
  requireRecord([...body.matchAll(/^## Release JSON$/gmu)].length === 1,
    "Expected exactly one Release JSON section.");
  const requestText = oneMatch(body, /^## Release JSON\n\n```json\n([\s\S]*?)\n```(?:\n|$)/gmu, "Release JSON block");
  let request;
  try {
    request = JSON.parse(requestText);
  } catch {
    throw new RecordProblem("The saved release request is not valid JSON.");
  }
  const validation = validateProfileRequest(request, profile);
  requireRecord(validation.ok,
    `The saved request does not match the schema: ${validation.errors.map(error => `${error.location}: ${error.message}`).join("; ")}`);
  requireRecord(request.request_id === requestId, "The request ID marker does not match the JSON request ID.");
  requireRecord(releaseRequestChecksum(request) === checksum, "The saved JSON does not match its checksum.");

  // Read each displayed metadata field exactly once. Labels and this table are
  // editable, so none of them become trusted until workflow verification below.
  const fields = new Map();
  const header = body.slice(0, body.indexOf("\n## Release JSON\n"));
  for (const [, key, value] of header.matchAll(/^\| ([^|\n]+) \| ([^|\n]*) \|$/gmu)) {
    requireRecord(!fields.has(key), `The Issue repeats the ${key} field.`);
    fields.set(key, value);
  }
  for (const [key, value] of Object.entries({
    "Request ID": `\`${requestId}\``,
    Target: `\`${request.target}\``,
    Checksum: `\`${checksum}\``,
    "Inbox result": "`accepted`"
  })) {
    requireRecord(fields.get(key) === value, `The Issue's ${key} field does not match the saved request.`);
  }
  const actor = fields.get("Trusted GitHub actor")?.match(/^@([a-zA-Z0-9-]+)$/u)?.[1];
  const actorId = fields.get("GitHub actor ID")?.match(/^`([1-9][0-9]*)`$/u)?.[1];
  const workflowUrl = fields.get("Workflow");
  const runId = workflowUrl?.startsWith(`${web}/actions/runs/`)
    ? workflowUrl.slice(`${web}/actions/runs/`.length) : "";
  requireRecord(actor && actorId, "The Issue is missing a valid GitHub actor and actor ID.");
  requireRecord(/^[1-9][0-9]*$/u.test(runId), "The workflow link must identify a run in the Coordinator repository on github.com.");
  return { request, checksum, actor, actorId, runId, workflowUrl };
}

function requireApiArray(value, description) {
  if (!Array.isArray(value)) throw new Error(`GitHub returned an unexpected ${description} response.`);
  return value;
}

export async function openIssues(get, profile = realProfile, includeClosed = false) {
  const api = `repos/${profile.inbox.full_name}`;
  const issues = [];
  const seen = new Set();
  for (let page = 1; ; page += 1) {
    const batch = requireApiArray(await get(
      `${api}/issues?state=${includeClosed ? "all" : "open"}&labels=release-request&sort=created&direction=asc&per_page=${pageSize}&page=${page}`
    ), "Issue list");
    for (const issue of batch) {
      if (!issue || !Number.isSafeInteger(issue.number) || issue.number < 1
          || !["open", "closed"].includes(issue.state) || !Array.isArray(issue.labels)) {
        throw new Error("GitHub returned an incomplete Issue record; the inbox scan is incomplete.");
      }
      if (seen.has(issue.number)) throw new Error("GitHub repeated an Issue across pages; run the inbox scan again.");
      seen.add(issue.number);
      const labels = issue.labels.map(label => typeof label === "string" ? label : label?.name);
      if ((includeClosed || issue.state === "open") && !issue.pull_request
          && labels.includes("release-request")) {
        issues.push(issue);
      }
    }
    if (batch.length < pageSize) return issues;
  }
}

async function verifyWorkflow(issue, saved, get, profile) {
  const api = `repos/${profile.inbox.full_name}`;
  const web = `https://github.com/${profile.inbox.full_name}`;
  const run = await get(`${api}/actions/runs/${saved.runId}`);
  requireRecord(run && String(run.id) === saved.runId
    && run.repository?.full_name === profile.inbox.full_name
    && run.head_repository?.full_name === profile.inbox.full_name
    && run.path === `.github/workflows/${profile.workflow}`
    && run.event === "workflow_dispatch" && run.head_branch === profile.branch
    && run.html_url === saved.workflowUrl
    && run.display_title === `Release request ${saved.request.request_id}`
    && /^[0-9a-f]{40}$/u.test(run.head_sha),
  "The linked run is not the expected inbox workflow for this request on main.");
  if (run.status !== "completed") {
    const error = new RecordProblem("The linked intake workflow is still running; wait for it to finish ticket setup.", "unverified");
    error.intakeInProgress = true;
    throw error;
  }
  requireRecord(run.conclusion === "success",
    "The linked workflow's latest attempt has not completed successfully.", "unverified");
  requireRecord(run.actor?.login === saved.actor && String(run.actor?.id) === saved.actorId,
    "The Issue's GitHub actor does not match the workflow actor.");
  requireRecord(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0,
    "GitHub did not identify the workflow attempt.", "unverified");

  const jobs = [];
  for (let page = 1; ; page += 1) {
    const response = await get(`${api}/actions/runs/${saved.runId}/attempts/${run.run_attempt}/jobs?per_page=${pageSize}&page=${page}`);
    const batch = requireApiArray(response?.jobs, "workflow jobs");
    for (const job of batch) {
      requireRecord(job && Number.isSafeInteger(job.id) && job.id > 0
        && !jobs.some(existing => existing.id === job.id),
      "GitHub returned missing or repeated workflow jobs.", "unverified");
      jobs.push(job);
    }
    if (batch.length < pageSize) break;
  }
  const matches = jobs.filter(job => job.name === "Validate and save request");
  requireRecord(matches.length === 1, "The inbox workflow's save job could not be identified uniquely.", "unverified");
  const job = matches[0];
  requireRecord(String(job.run_id) === saved.runId && job.run_attempt === run.run_attempt
    && job.status === "completed" && job.conclusion === "success"
    && job.steps?.some(step => step.name === "Validate and save the release request"
      && step.status === "completed" && step.conclusion === "success"),
  "The inbox workflow's save job has no successful result for this attempt.", "unverified");
  const logs = await get(`${api}/actions/jobs/${job.id}/logs`);
  requireRecord(typeof logs === "string", "The workflow logs are unavailable.", "unverified");
  // Match actual output lines, never a quoted command or echoed REQUEST_JSON.
  const markers = [...logs.matchAll(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z RELEASE_REQUEST_RESULT=([A-Za-z0-9_-]+)\r?$/gmu)];
  requireRecord(markers.length === 1, "The workflow logs do not contain exactly one saved-request result.", "unverified");
  let result;
  try {
    result = JSON.parse(Buffer.from(markers[0][1], "base64url").toString("utf8"));
  } catch {
    throw new RecordProblem("The workflow's saved-request result is unreadable.", "unverified");
  }
  requireRecord(result?.status === "submitted"
    && (result.profile === undefined ? profile.name === "real" : result.profile === profile.name)
    && result.request_id === saved.request.request_id
    && result.inbox_issue_number === issue.number
    && result.inbox_issue_url === `${web}/issues/${issue.number}`
    && result.github?.workflow_run_id === saved.runId
    && result.github?.workflow_run_url === saved.workflowUrl
    && result.github?.actor === saved.actor && result.github?.actor_id === saved.actorId,
  "The workflow result does not confirm this exact Issue, request ID, and GitHub actor.");
  requireRecord(validateProfileRequest(result.request, profile).ok
    && releaseRequestChecksum(result.request) === saved.checksum,
  "The saved JSON differs from the request confirmed by the workflow.");
  return { run_id: saved.runId, attempt: run.run_attempt, url: saved.workflowUrl, head_sha: run.head_sha,
    ...(result.inbox_presentation ? { presentation: result.inbox_presentation } : {}) };
}

export async function inspectIssue(issue, { get, profile = realProfile }) {
  const web = `https://github.com/${profile.inbox.full_name}`;
  const entry = {
    issue_number: issue.number, issue_state: issue.state,
    issue_url: `${web}/issues/${issue.number}`,
    title: issue.title,
    status: "unverified",
    request: null,
    github_actor: null,
    workflow: null,
    errors: []
  };
  try {
    const saved = parseSavedIssue(issue, profile);
    entry.request = saved.request;
    entry.workflow = await verifyWorkflow(issue, saved, get, profile);
    entry.github_actor = { login: saved.actor, id: saved.actorId };
    entry.status = "valid";
  } catch (error) {
    entry.status = error instanceof RecordProblem ? error.status : "unverified";
    if (error.intakeInProgress) entry.intake_in_progress = true;
    entry.errors.push(error.message);
  }
  return entry;
}

export async function readInbox({ get, now = () => new Date(), profile = realProfile, includeClosed = false }) {
  // Complete listing before verification, so page/auth failures cannot produce
  // a misleading empty or partially successful inbox report.
  const issues = await openIssues(get, profile, includeClosed);
  const requests = [];
  for (const issue of issues) requests.push(await inspectIssue(issue, { get, profile }));
  const byRequestId = new Map();
  for (const entry of requests) {
    if (!entry.request) continue;
    const id = entry.request.request_id;
    const group = byRequestId.get(id) ?? [];
    group.push(entry);
    byRequestId.set(id, group);
  }
  for (const group of byRequestId.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      entry.status = "invalid";
      entry.errors.push(`The same request ID appears in multiple open Issues: ${group.map(item => `#${item.issue_number}`).join(", ")}.`);
    }
  }
  return {
    mode: "read-only",
    repository: profile.inbox.full_name, profile: profile.name,
    checked_at: now().toISOString(),
    counts: {
      pending: requests.length,
      valid: requests.filter(entry => entry.status === "valid").length,
      invalid: requests.filter(entry => entry.status === "invalid").length,
      unverified: requests.filter(entry => entry.status === "unverified").length
    },
    requests
  };
}

// Issue/request text is untrusted terminal input. Escape controls, line breaks
// and directional formatting so it cannot overwrite the report or its status.
function text(value) {
  return String(value ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    character => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`);
}

export function formatReport(report) {
  const lines = [
    `Inbox: ${report.repository} (read-only)`,
    `Checked: ${report.checked_at}`,
    `${report.counts.pending} open requests; ${report.counts.valid} valid saved records; ${report.counts.invalid} invalid; ${report.counts.unverified} unverified.`,
    "Valid means the saved record matches its workflow proof. Current PR readiness and permission to release are not checked."
  ];
  if (!report.requests.length) lines.push("No open Issues carry release-request.");
  for (const entry of report.requests) {
    lines.push("", `#${entry.issue_number} — ${entry.status.toUpperCase()} — ${text(entry.title)}`, entry.issue_url);
    if (entry.request) {
      const request = entry.request;
      lines.push(`  Request: ${request.request_id}`, `  Target: ${request.target}; database change: ${request.database_change}`,
        `  Requested by (supplied text): ${text(request.requested_by)}`);
      if (entry.github_actor) lines.push(`  Verified GitHub actor: @${entry.github_actor.login} (ID ${entry.github_actor.id})`);
      for (const part of request.release_parts) {
        lines.push(`  ${part.id}: ${part.repository}; depends on: ${part.depends_on.join(", ") || "none"}`);
        for (const pr of part.pull_requests) lines.push(`    PR #${pr.number}; branch ${pr.branch}; commit ${pr.commit}`);
        if (part.deploy_units) {
          lines.push(`    Backend units: ${part.deploy_units.join(", ")}`,
            `    Unit order: ${part.deploy_dependencies.map(edge => `${edge.before} -> ${edge.after}`).join(", ") || "none"}`);
        }
      }
    }
    if (entry.workflow) lines.push(`  Workflow proof: ${entry.workflow.url} (attempt ${entry.workflow.attempt})`);
    for (const error of entry.errors) lines.push(`  Problem: ${text(error)}`);
  }
  return `${lines.join("\n")}\n`;
}
