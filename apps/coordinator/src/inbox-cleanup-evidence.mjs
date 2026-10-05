import { receiptHash, digest } from "./inbox-journal.mjs";
import { inspectReadiness, validatePull } from "./readiness.mjs";
import { validateProfileRequest } from "./profiles.mjs";
import { terminal } from "./ticket-presentation.mjs";

export function closedCleanupEntry(issue, ticket, profile) {
  const last = ticket?.transitions.at(-1);
  if (
    issue.state !== "closed" ||
    !last ||
    ticket.applied !== last.id ||
    !terminal(last.decision) ||
    receiptHash(issue) !== ticket.receipt_hash ||
    !ticket.submitter ||
    !ticket.workflow ||
    !validateProfileRequest(ticket.request, profile).ok
  )
    return null;
  // This path cannot write a ticket or claim a new outcome. Its exact receipt
  // and terminal presentation were already verified in the validated journal.
  return {
    issue_number: issue.number,
    issue_state: issue.state,
    issue_url: `https://github.com/${profile.inbox.full_name}/issues/${issue.number}`,
    title: issue.title,
    status: "valid",
    request: structuredClone(ticket.request),
    github_actor: structuredClone(ticket.submitter),
    workflow: structuredClone(ticket.workflow),
    errors: []
  };
}

// Per-invocation caches only. Mutable workflow metadata and PRs are always read
// again; completed job logs and files at exact commits have immutable identity.
export function cleanupEvidence({ get, github, inspect }) {
  const logs = new Map(),
    catalogs = new Map(),
    receipts = new Map();
  const read = async (path) => {
    if (!/\/actions\/jobs\/[1-9][0-9]*\/logs$/u.test(path)) return get(path);
    if (logs.has(path)) return logs.get(path);
    const value = await get(path);
    if (typeof value === "string") logs.set(path, value);
    return value;
  };
  if (get.identity) read.identity = () => get.identity();
  const source = {
    ...github,
    catalog: async (commit) => {
      if (!catalogs.has(commit))
        catalogs.set(commit, await github.catalog(commit));
      return structuredClone(catalogs.get(commit));
    }
  };
  const intake = async (issue, options) => {
    const key = receiptHash(issue);
    if (receipts.has(key)) return structuredClone(receipts.get(key));
    const entry = await inspect(issue, options);
    if (entry.status === "valid" && !entry.intake_in_progress)
      receipts.set(key, structuredClone(entry));
    return entry;
  };
  return { get: read, github: source, inspect: intake };
}

function prChecks(pr, requested, fullName) {
  const exact =
    pr.headRefOid === requested.commit && pr.headRefName === requested.branch;
  return [
    {
      id: "requested_code",
      status: exact ? "pass" : "blocked",
      message: exact
        ? "PR matches the requested branch and commit."
        : "PR no longer matches the requested branch and commit.",
      evidence: {
        requested_commit: requested.commit,
        current_commit: pr.headRefOid,
        requested_branch: requested.branch,
        current_branch: pr.headRefName
      }
    },
    {
      id: "source_repository",
      status:
        pr.headRepository?.nameWithOwner === fullName ? "pass" : "unknown",
      message: "Compare the PR source with the named product repository."
    },
    {
      id: "pr_state",
      status: pr.state === "CLOSED" || pr.isDraft ? "blocked" : "unknown",
      message: `PR is ${pr.state}${pr.isDraft ? " and draft" : ""}.`,
      evidence: { state: pr.state, draft: pr.isDraft }
    }
  ];
}

export async function inspectCleanup(entry, { github, profile }) {
  if (
    entry.status !== "valid" ||
    !validateProfileRequest(entry.request, profile).ok ||
    typeof github.pullRequestIdentity !== "function"
  )
    return inspectReadiness(entry, { github, profile });
  const observed = [];
  for (const part of entry.request.release_parts)
    for (const requested of part.pull_requests) {
      const fullName = `6529-Collections/${part.repository}`;
      const item = {
        part: part.id,
        repository: part.repository,
        number: requested.number,
        url: `https://github.com/${fullName}/pull/${requested.number}`,
        checks: []
      };
      let pr;
      try {
        pr = await github.pullRequestIdentity(
          part.repository,
          requested.number
        );
        validatePull(pr, part.repository, requested.number, fullName);
        item.checks = prChecks(pr, requested, fullName);
      } catch (error) {
        item.checks.push({
          id: "github_evidence",
          status: "unknown",
          message: error.message
        });
      }
      observed.push({ part, requested, fullName, item, pr });
    }
  const outdated = observed.some(
    ({ item }) =>
      item.checks.find((c) => c.id === "requested_code")?.status ===
        "blocked" &&
      item.checks.find((c) => c.id === "source_repository")?.status === "pass"
  );
  const merged =
    observed.length > 0 &&
    observed.every(
      ({ item, pr }) =>
        pr?.state === "MERGED" &&
        item.checks.find((c) => c.id === "requested_code")?.status === "pass" &&
        item.checks.find((c) => c.id === "source_repository")?.status === "pass"
    );
  if (!outdated && !merged) return inspectReadiness(entry, { github, profile });
  for (const { part, requested, fullName, item, pr } of observed) {
    if (!pr) continue;
    try {
      const latest = await github.pullRequestIdentity(
        part.repository,
        requested.number
      );
      validatePull(latest, part.repository, requested.number, fullName);
      item.checks = prChecks(latest, requested, fullName);
      item.checks.push({
        id: "observation_stability",
        status: digest(pr) === digest(latest) ? "pass" : "unknown",
        message:
          "Compare independent current PR identity and state observations."
      });
    } catch (error) {
      item.checks.push({
        id: "observation_stability",
        status: "unknown",
        message: error.message
      });
    }
  }
  return {
    issue_number: entry.issue_number,
    issue_url: entry.issue_url,
    request_id: entry.request.request_id,
    target: entry.request.target,
    status: "unknown",
    release_authorized: false,
    mode: "cleanup-identity",
    checks: [],
    pull_requests: observed.map(({ item }) => item)
  };
}
