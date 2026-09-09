import { realProfile, validateProfileRequest, canonicalRequest } from "./profiles.mjs";
import { readInbox } from "./inbox-reader.mjs";
import { catalogServices, catalogSignature, inspectPartGraph, inspectServiceGraph } from "./readiness-dependencies.mjs";
import { catalogPath } from "./readiness-github.mjs";

const sha = /^[0-9a-f]{40}$/u;
const mergeStates = ["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"];
const check = (id, status, message, evidence) => ({ id, status, message, ...(evidence === undefined ? {} : { evidence }) });
const statusOf = checks => checks.some(item => item.status === "blocked") ? "blocked" : "unknown";

export function validatePull(pr, repository, number, fullName = `6529-Collections/${repository}`) {
  if (!pr || pr.number !== number || pr.repository?.nameWithOwner !== fullName
    || typeof pr.headRefOid !== "string" || !sha.test(pr.headRefOid)
    || typeof pr.baseRefOid !== "string" || !sha.test(pr.baseRefOid)
    || typeof pr.headRefName !== "string" || !pr.headRefName
    || typeof pr.baseRefName !== "string" || !pr.baseRefName
    || typeof pr.isDraft !== "boolean" || !["OPEN", "CLOSED", "MERGED"].includes(pr.state)
    || !["CONFLICTING", "MERGEABLE", "UNKNOWN"].includes(pr.mergeable)
    || !mergeStates.includes(pr.mergeStateStatus)
    || ![null, "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(pr.reviewDecision)
    || !Array.isArray(pr.checks)) {
    throw new Error("GitHub returned incomplete or unexpected PR metadata.");
  }
}

function requiredCheckStatus(item) {
  if (item.__typename === "StatusContext") {
    if (item.state === "SUCCESS") return "pass";
    if (["FAILURE", "ERROR", "PENDING", "EXPECTED"].includes(item.state)) return "blocked";
    return "unknown";
  }
  if (item.__typename !== "CheckRun") return "unknown";
  if (["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"].includes(item.status)) return "blocked";
  if (item.status !== "COMPLETED") return "unknown";
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(item.conclusion)) return "pass";
  if (["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STALE", "STARTUP_FAILURE"].includes(item.conclusion)) return "blocked";
  return "unknown";
}

export function inspectPull(pr, requested, repository, fullName = `6529-Collections/${repository}`) {
  const checks = [];
  const exact = pr.headRefOid === requested.commit && pr.headRefName === requested.branch;
  checks.push(check("requested_code", exact ? "pass" : "blocked",
    exact ? "The PR still names the requested branch and exact commit." : "The request is outdated: the PR branch or commit differs. This does not prove cancellation or replacement.",
    { requested_commit: requested.commit, current_commit: pr.headRefOid, requested_branch: requested.branch, current_branch: pr.headRefName }));
  checks.push(check("source_repository", pr.headRepository?.nameWithOwner === fullName ? "pass" : "unknown",
    pr.headRepository?.nameWithOwner === fullName ? "PR source is the named product repository." : "A deleted or fork source cannot be bound to this request's repository with the available evidence."));
  checks.push(check("pr_state", pr.state === "CLOSED" || pr.isDraft ? "blocked" : pr.state === "MERGED" ? "unknown" : "pass",
    pr.state === "MERGED" ? "PR is already merged. That is not proof of deployment; a further release needs target and history evidence."
      : pr.state === "CLOSED" ? "PR is closed without merging."
        : pr.isDraft ? "PR is still a draft." : "PR is open and is not a draft.",
    { state: pr.state, draft: pr.isDraft }));

  const open = pr.state === "OPEN" && !pr.isDraft;
  checks.push(check("merge_conflicts", !open ? "unknown" : pr.mergeable === "CONFLICTING" ? "blocked" : pr.mergeable === "MERGEABLE" ? "pass" : "unknown",
    !open ? "Current-base mergeability is not usable for this closed, merged, or draft PR."
      : pr.mergeable === "CONFLICTING" ? "GitHub reports conflicts with this PR's base branch."
        : pr.mergeable === "MERGEABLE" ? "GitHub reports no conflicts with this PR's base branch."
          : "GitHub has not established mergeability. Run the scan again later.",
    { base_branch: pr.baseRefName, base_commit: pr.baseRefOid, head_commit: pr.headRefOid }));
  const gatePass = open && ["CLEAN", "UNSTABLE"].includes(pr.mergeStateStatus);
  const gateBlocked = open && ["BEHIND", "BLOCKED", "DIRTY", "DRAFT"].includes(pr.mergeStateStatus);
  checks.push(check("github_merge_gate", gatePass ? "pass" : gateBlocked ? "blocked" : "unknown",
    `GitHub merge state for the PR base: ${pr.mergeStateStatus}. This is GitHub's summary, not an independent rules audit.`));

  const required = pr.checks.filter(item => item.isRequired === true).map(item => ({
    name: item.name ?? item.context, status: requiredCheckStatus(item),
    state: item.state ?? item.status, conclusion: item.conclusion ?? null
  }));
  const requiredStatus = required.some(item => item.status === "blocked") ? "blocked"
    : required.some(item => item.status === "unknown") || !gatePass ? "unknown" : "pass";
  checks.push(check("required_checks", requiredStatus,
    requiredStatus === "pass" ? "Reported required checks pass, and GitHub reports a mergeable gate."
      : requiredStatus === "blocked" ? "At least one required check is failing or unfinished."
        : "Required-check success is not established. Missing checks cannot be inferred from an empty list or a blocked/unknown gate.",
    { required, optional_check_count: pr.checks.filter(item => item.isRequired === false).length }));
  const review = pr.reviewDecision;
  checks.push(check("reviews", ["CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(review) ? "blocked"
    : review === "APPROVED" || (review === null && gatePass) ? "pass" : "unknown",
  review === null ? "GitHub reports no review decision; only a passing merge gate can establish that no review block is reported."
    : `GitHub review decision: ${review}.`));
  return checks;
}

export function fingerprint(pr) {
  return JSON.stringify({ ...pr, checks: [...pr.checks].sort((a, b) => a.id.localeCompare(b.id)) });
}

async function inspectCatalogs(request, github, checks) {
  const commits = [...new Set(request.release_parts.filter(part => part.repository === "6529seize-backend")
    .flatMap(part => part.pull_requests.map(pr => pr.commit)))];
  if (!commits.length) return;
  try {
    const evidence = [];
    let services;
    let signature;
    for (const commit of commits) {
      const source = await github.catalog(commit);
      if (source.commit !== commit || !sha.test(source.blob_sha)) throw new Error("Catalog evidence does not match the requested commit.");
      const current = catalogServices(source.catalog);
      const currentSignature = catalogSignature(current);
      evidence.push({ commit, blob_sha: source.blob_sha, path: catalogPath });
      if (signature !== undefined && signature !== currentSignature) {
        checks.push(check("backend_services", "unknown", "Requested backend commits contain different service definitions. A catalog from the exact combined merge result is needed.", evidence));
        return;
      }
      signature = currentSignature;
      services = current;
    }
    const graph = inspectServiceGraph(request, services);
    checks.push(check("backend_services", graph.status,
      graph.errors.length ? graph.errors.join(" ")
        : graph.missing_prerequisites.length ? "Catalog prerequisites are not selected. Their required deployed state is unverified; no services were added automatically."
          : "Selected services allow this target and the combined dependency graph has no cycle.",
      { catalogs: evidence, ...graph }));
  } catch (error) {
    checks.push(check("backend_services", "unknown", error.message));
  }
}

export async function inspectReadiness(entry, { github, profile = realProfile }) {
  const result = {
    issue_number: entry.issue_number, issue_url: entry.issue_url,
    request_id: entry.request?.request_id ?? null, target: entry.request?.target ?? null,
    status: "unknown", release_authorized: false, checks: [], pull_requests: []
  };
  const checks = result.checks;
  if (entry.status !== "valid" || !validateProfileRequest(entry.request, profile).ok) {
    checks.push(check("saved_record", entry.status === "invalid" ? "blocked" : "unknown",
      "Saved request proof did not pass; no product readiness reads were attempted.", { errors: entry.errors }));
    result.status = statusOf(checks);
    return result;
  }
  const request = entry.request;
  checks.push(check("saved_record", "pass", "Saved request matches its submission workflow proof."));
  const graph = inspectPartGraph(canonicalRequest(request, profile));
  checks.push(check("release_parts", graph.status, graph.errors.join(" ") || "Release-part IDs and PRs are unique; dependencies exist and contain no cycle.", { declared_part_order: graph.order }));

  const observed = [];
  for (const part of request.release_parts) {
    for (const requested of part.pull_requests) {
      const item = { part: part.id, repository: part.repository, number: requested.number,
        url: `https://github.com/6529-Collections/${part.repository}/pull/${requested.number}`, checks: [] };
      result.pull_requests.push(item);
      try {
        const pr = await github.pullRequest(part.repository, requested.number);
        validatePull(pr, part.repository, requested.number);
        item.checks = inspectPull(pr, requested, part.repository);
        observed.push({ part, requested, item, pr });
      } catch (error) {
        item.checks.push(check("github_evidence", "unknown", error.message));
      }
    }
  }
  if (graph.status === "pass") await inspectCatalogs(canonicalRequest(request, profile), github, checks);
  else checks.push(check("backend_services", "unknown", "Service ordering was not evaluated because the release-part graph is invalid."));

  // Re-read after catalog and other PR reads. Never silently switch the
  // requested code or reuse earlier green checks when the observed state moves.
  for (const { part, requested, item, pr } of observed) {
    try {
      const latest = await github.pullRequest(part.repository, requested.number);
      validatePull(latest, part.repository, requested.number);
      const changed = fingerprint(pr) !== fingerprint(latest);
      item.checks = inspectPull(latest, requested, part.repository);
      item.checks.push(check("observation_stability", changed ? "unknown" : "pass",
        changed ? "PR, base, checks, or review state changed during this scan. Run it again; this is not a stable observation."
          : "PR, base, check, and review observations matched on the final read. This does not lock GitHub state."));
    } catch (error) {
      item.checks.push(check("observation_stability", "unknown", `Final PR recheck failed. ${error.message}`));
    }
  }
  checks.push(check("release_merge_plan", "unknown",
    "Only individual PR merges into their own base branches were checked. The execution destination and any combined PR merge need an explicit plan and exact merge-result proof."));
  for (const fact of ["completed", "cancelled", "replaced"]) {
    checks.push(check(`history_${fact}`, "unknown",
      `Whether this request was ${fact} is unknown: this reader has no verified release-outcome source. Inbox disposition history, Issue labels, PR state, and newer requests do not prove a release outcome.`));
  }
  result.status = statusOf([...checks, ...result.pull_requests.flatMap(item => item.checks)]);
  return result;
}

export async function checkReadiness({ get, github, now = () => new Date(), profile = realProfile, loadInbox = readInbox }) {
  const inbox = await loadInbox({ get, now, profile });
  const requests = [];
  for (const entry of inbox.requests) requests.push(await inspectReadiness(entry, { github, profile }));
  for (let index = 0; index < inbox.requests.length; index += 1) {
    const entry = inbox.requests[index];
    if (entry.status !== "valid") continue;
    const keys = new Set(entry.request.release_parts.flatMap(part => part.pull_requests.map(pr => `${part.repository}#${pr.number}`)));
    const overlaps = inbox.requests.filter(other => other !== entry && other.status === "valid" && other.request.target === entry.request.target
      && other.request.release_parts.some(part => part.pull_requests.some(pr => keys.has(`${part.repository}#${pr.number}`))))
      .map(other => other.issue_number);
    if (overlaps.length) requests[index].checks.push(check("overlapping_requests", "unknown",
      "Other pending requests name the same PR and target. No request was chosen or marked replaced.", { issue_numbers: overlaps }));
  }
  return {
    mode: "read-only", profile: profile.name, repository: inbox.repository, checked_at: now().toISOString(),
    inbox_checked_at: inbox.checked_at, release_authorized: false,
    counts: { pending: requests.length, blocked: requests.filter(item => item.status === "blocked").length,
      unknown: requests.filter(item => item.status === "unknown").length }, requests
  };
}

function safe(value) {
  return String(value ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    character => `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`);
}

export function formatReadiness(report) {
  const lines = ["Release readiness observations (read-only; never permission to release)", `Checked: ${report.checked_at}`,
    `${report.counts.pending} pending; ${report.counts.blocked} blocked; ${report.counts.unknown} unknown.`];
  const add = (item, indent) => {
    lines.push(`${indent}${item.status.toUpperCase()} ${item.id}: ${safe(item.message)}`);
    if (item.evidence !== undefined) lines.push(`${indent}  Evidence: ${safe(JSON.stringify(item.evidence))}`);
  };
  for (const entry of report.requests) {
    lines.push("", `#${entry.issue_number} — ${entry.status.toUpperCase()} — ${safe(entry.request_id)} — ${safe(entry.target)}`, entry.issue_url);
    for (const item of entry.checks) add(item, "  ");
    for (const pr of entry.pull_requests) {
      lines.push(`  ${safe(pr.repository)} PR #${pr.number}: ${pr.url}`);
      for (const item of pr.checks) add(item, "    ");
    }
  }
  if (!report.requests.length) lines.push("No pending requests observed. This is not release authorization.");
  return `${lines.join("\n")}\n`;
}
