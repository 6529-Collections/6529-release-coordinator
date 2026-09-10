import { randomUUID } from "node:crypto";
import { saveReleaseRequestIssue } from "../../../packages/release-request/src/inbox-issue.mjs";

export const statuses = [
  "received",
  "waiting",
  "action-needed",
  "eligible",
  "completed",
  "closed"
];
export const rehearsalStatuses = [
  "not-run",
  "passed",
  "blocked",
  "unknown",
  "stale"
];
export const reasons = [
  "outdated-commit",
  "already-merged",
  "checks-pending",
  "checks-failed",
  "merge-conflict",
  "review-required",
  "invalid-dependencies",
  "request-unverified",
  "deployment-unverified",
  "prerequisite-unverified",
  "coordinator-incomplete",
  "overlapping-requests",
  "cancelled",
  "replaced",
  "test",
  "merge-plan-required",
  "merge-plan-invalid",
  "merge-plan-unavailable",
  "rehearsal-blocked",
  "rehearsal-unverified",
  "rehearsal-stale"
];
export const managedLabels = new Set([
  "release-request",
  "pending",
  "target:staging",
  "target:production",
  "component:frontend",
  "component:backend",
  ...statuses.map((s) => `status:${s}`),
  ...reasons.map((s) => `reason:${s}`),
  ...rehearsalStatuses.map((s) => `rehearsal:${s}`)
]);
export const labelNames = (issue) =>
  issue.labels.map((label) => (typeof label === "string" ? label : label.name));
export const terminal = (decision) =>
  ["closed", "completed"].includes(decision.status);
const clean = (text) => String(text).replace(/[\p{Cc}\p{Cf}]/gu, " ");
const prose = (text) =>
  clean(text)
    .replace(/[\\`*_{}[\]<>#|]/gu, "\\$&")
    .replaceAll("@", "＠");

export function ticketTitle(request) {
  return `${request.target === "staging" ? "Staging" : "Production"} · ${request.release_parts
    .map((part) => {
      const component = [
        "6529seize-backend",
        "release-coordinator-test-backend"
      ].includes(part.repository)
        ? "backend"
        : "frontend";
      return `${component} ${part.pull_requests.map((pr) => `PR #${pr.number}`).join(", ")}${part.deploy_units ? ` · ${part.deploy_units.join(", ")}` : ""}`;
    })
    .join(" + ")}`.slice(0, 240);
}

export function desiredLabels(issue, decision, request) {
  // An unverified request cannot supply scope. Keep its existing scope labels
  // until proof is available; neither a target label nor a title is evidence.
  const preserved = labelNames(issue).filter(
    (name) =>
      !managedLabels.has(name) ||
      (!request && /^(target|component):/u.test(name))
  );
  const scope = request
    ? [
        `target:${request.target}`,
        ...new Set(
          request.release_parts.map(
            (part) =>
              `component:${["6529seize-backend", "release-coordinator-test-backend"].includes(part.repository) ? "backend" : "frontend"}`
          )
        )
      ]
    : [];
  return [
    ...new Set([
      ...preserved,
      "release-request",
      `status:${decision.status}`,
      ...scope,
      ...decision.reasons.map((reason) => `reason:${reason.code}`),
      ...(decision.rehearsal ? [`rehearsal:${decision.rehearsal.status}`] : [])
    ])
  ].sort();
}

export async function ensureLabels(api, names) {
  for (const name of names.filter((value) => managedLabels.has(value))) {
    const found = await api({
      method: "GET",
      path: `/labels/${encodeURIComponent(name)}`
    });
    if (found.status === 200) continue;
    if (found.status !== 404)
      throw new Error(`Could not inspect label ${name}.`);
    const color = name.startsWith("reason:")
      ? "fbca04"
      : name.startsWith("status:")
        ? "5319e7"
        : "0969da";
    const created = await api({
      method: "POST",
      path: "/labels",
      body: { name, color }
    });
    if (created.status === 201) continue;
    if (
      created.status === 422 &&
      (
        await api({
          method: "GET",
          path: `/labels/${encodeURIComponent(name)}`
        })
      ).status === 200
    )
      continue;
    throw new Error(`Could not create label ${name}.`);
  }
}

export async function response(api, method, path, body, expected = 200) {
  const result = await api({
    method,
    path,
    ...(body === undefined ? {} : { body })
  });
  if (result.status !== expected)
    throw new Error(`GitHub ${method} ${path} failed (HTTP ${result.status}).`);
  return result.data;
}

export async function comments(api, number) {
  const all = [],
    seen = new Set();
  for (let page = 1; ; page++) {
    const batch = await response(
      api,
      "GET",
      `/issues/${number}/comments?per_page=100&page=${page}`
    );
    if (!Array.isArray(batch)) throw new Error("Incomplete comment list.");
    for (const item of batch) {
      if (!Number.isSafeInteger(item.id) || seen.has(item.id))
        throw new Error("Invalid or repeated comment identity.");
      all.push(item);
      seen.add(item.id);
    }
    if (batch.length < 100) return all;
  }
}

export function receivedDecision() {
  return {
    status: "received",
    reasons: [],
    next_action: "Inspect this request on the next inbox processing run.",
    action_owner: "Coordinator",
    submitter_action: "None currently required."
  };
}

export function statusComment({
  decision,
  actor,
  at,
  submitter,
  request,
  number,
  marker,
  assignment
}) {
  const lines = [
    `<!-- 6529-coordinator-status:${marker} -->`,
    "## Coordinator status",
    "",
    `**Status:** ${decision.status}`,
    "",
    `**Submitter:** ${submitter ? `${prose(submitter.login)} (GitHub ID ${submitter.id})` : "Identity not yet verified."}`,
    `**Next action:** ${prose(decision.next_action)}`,
    `**Action owner:** ${prose(decision.action_owner)}`,
    `**Submitter action:** ${prose(decision.submitter_action)}`,
    "",
    "**Why:**"
  ];
  if (!decision.reasons.length)
    lines.push("- Request received; inspection is pending.");
  for (const reason of decision.reasons) {
    lines.push(
      `- **${reason.code}:** ${prose(reason.message)} ${prose(reason.action ?? "")}`
    );
    if (reason.evidence)
      lines.push(`  Evidence: ${prose(JSON.stringify(reason.evidence))}`);
  }
  if (decision.rehearsal) {
    const rehearsal = decision.rehearsal;
    lines.push(
      "",
      `**Merge rehearsal:** ${prose(rehearsal.status)}. ${prose(rehearsal.message)}`
    );
    for (const finding of rehearsal.findings ?? []) {
      lines.push(
        `- ${prose(finding.role ?? "Request")}${finding.pr_number ? ` PR #${finding.pr_number}` : ""}: ${prose(finding.message)}`
      );
      if (finding.evidence?.conflicts?.length)
        lines.push(
          `  Conflict paths: ${prose(JSON.stringify(finding.evidence.conflicts))}`
        );
    }
    for (const repo of rehearsal.repositories ?? [])
      lines.push(
        `- ${prose(repo.role)} destination: \`${repo.destination.branch}\` at \`${repo.destination.commit}\`; result tree: \`${repo.final_tree ?? "unavailable"}\`.`
      );
    if (rehearsal.plan_hash)
      lines.push(`Plan fingerprint: \`${rehearsal.plan_hash}\`.`);
  }
  if (request) {
    lines.push(
      "",
      `**Target:** ${request.target}; **Request:** ${request.request_id}`
    );
    for (const part of request.release_parts) {
      for (const pr of part.pull_requests)
        lines.push(
          `- https://github.com/6529-Collections/${part.repository}/pull/${pr.number} — commit \`${pr.commit}\``
        );
      if (part.deploy_units)
        lines.push(`- Backend scope: ${prose(part.deploy_units.join(", "))}`);
    }
  }
  if (assignment === "unavailable")
    lines.push(
      "",
      "**Assignment:** GitHub did not assign the verified submitter. The accepted request is preserved.",
      `Lookup: run \`npm run inbox:read -- --submitter ${submitter.login}\` and find #${number}.`
    );
  lines.push(
    "",
    `**Last meaningful decision:** ${at}; ${prose(actor.login)} (GitHub ID ${actor.id}).`,
    "",
    "This ticket status does not authorize a merge or deployment."
  );
  const body = lines.join("\n");
  if (body.length > 60_000)
    throw new Error("Status explanation exceeds the GitHub comment limit.");
  return body;
}

export async function assignSubmitter(api, issue, submitter) {
  if (!submitter) return "unverified";
  if (issue.assignees?.some((user) => String(user.id) === submitter.id))
    return "assigned";
  // Resolve by stable ID: a renamed/recycled login must not assign another user.
  let eligible = false;
  for (let page = 1; ; page++) {
    const result = await api({
      method: "GET",
      path: `/assignees?per_page=100&page=${page}`
    });
    if (result.status !== 200 || !Array.isArray(result.data))
      return "unavailable";
    if (
      result.data.some(
        (user) =>
          user.login === submitter.login && String(user.id) === submitter.id
      )
    )
      eligible = true;
    if (result.data.length < 100) break;
  }
  if (!eligible) return "unavailable";
  const assigned = await api({
    method: "POST",
    path: `/issues/${issue.number}/assignees`,
    body: { assignees: [submitter.login] }
  });
  if (assigned.status !== 201) return "unavailable";
  return assigned.data.assignees?.some(
    (value) => String(value.id) === submitter.id
  )
    ? "assigned"
    : "unavailable";
}

// Called only for a newly created receipt by the central workflow. Retries of
// saveOrganizedReleaseRequestIssue never enter here, including closed tickets.
export async function initializeTicket({
  api,
  issue,
  request,
  submitter,
  at,
  writer
}) {
  const marker = randomUUID();
  const presentation = {
    marker,
    author_id: String(writer.id),
    comment_id: null,
    warnings: []
  };
  try {
    const decision = receivedDecision();
    const labels = desiredLabels(issue, decision, request);
    await ensureLabels(api, labels);
    await response(api, "PATCH", `/issues/${issue.number}`, {
      title: ticketTitle(request),
      labels
    });
    const assignment = await assignSubmitter(api, issue, submitter);
    if (assignment !== "assigned")
      presentation.warnings.push(
        "Submitter assignment unavailable; lookup remains available."
      );
    const body = statusComment({
      decision,
      actor: writer,
      at,
      submitter,
      request,
      number: issue.number,
      marker,
      assignment
    });
    const comment = await response(
      api,
      "POST",
      `/issues/${issue.number}/comments`,
      { body },
      201
    );
    if (
      String(comment.user?.id) !== presentation.author_id ||
      !Number.isSafeInteger(comment.id)
    )
      throw new Error("Unexpected status comment author or identity.");
    presentation.comment_id = comment.id;
  } catch (error) {
    // Acceptance is independent of optional presentation. Persist this marker
    // in the workflow result even after an uncertain POST, for safe recovery.
    presentation.warnings.push(error.message);
  }
  return presentation;
}

export async function saveOrganizedReleaseRequestIssue(options) {
  const inbox = await saveReleaseRequestIssue(options);
  if (!inbox.issue.created) return inbox;
  try {
    const issue = await response(
      options.githubRequest,
      "GET",
      `/issues/${inbox.issue.number}`
    );
    inbox.presentation = await initializeTicket({
      api: options.githubRequest,
      issue,
      request: options.request,
      submitter: { login: options.actor, id: String(options.actorId) },
      at: options.submittedAt,
      writer: { login: issue.user.login, id: String(issue.user.id) }
    });
  } catch {
    inbox.presentation = {
      warnings: [
        "Request accepted; initial presentation needs repair by the processor."
      ]
    };
  }
  return inbox;
}
