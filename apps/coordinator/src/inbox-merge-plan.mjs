import { releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";
import { canonicalRequest, repositoryRole } from "./profiles.mjs";
import { readInbox } from "./inbox-reader.mjs";
import { inspectPartGraph } from "./readiness-dependencies.mjs";
import { normalizeMergePlan, RehearsalError } from "./rehearsal-plan.mjs";

const requireValue = (ok, message) => { if (!ok) throw new RehearsalError("invalid_inbox_plan", message); };
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export async function verifiedInboxEntry(number, { get, profile }) {
  const inbox = await readInbox({ get, profile });
  const entry = inbox.requests.find(value => value.issue_number === number);
  requireValue(entry?.status === "valid", "Select one open request with complete workflow proof in the selected inbox.");
  return entry;
}

export function inboxBinding(entry, profile) {
  return { profile: profile.name, repository: profile.inbox.full_name, repository_id: profile.inbox.id,
    issue_number: entry.issue_number, request_id: entry.request.request_id,
    checksum: releaseRequestChecksum(entry.request), workflow: entry.workflow, actor: entry.github_actor };
}

export function inboxMergePlan(input, entry, profile) {
  requireValue(exactKeys(input, ["schema_version", "profile", "source", "inbox", "repositories"]), "Inbox plan has missing or unsupported fields.");
  requireValue(input.schema_version === "1" && input.profile === profile.name && input.source === "inbox-plan", "Inbox plan profile/source/version does not match.");
  requireValue(entry?.status === "valid", "Only a freshly verified inbox entry can supply merge scope.");
  const binding = inboxBinding(entry, profile);
  requireValue(exactKeys(input.inbox, ["repository_id", "issue_number", "request_id", "checksum"])
    && Object.keys(input.inbox).every(key => input.inbox[key] === binding[key]), "Inbox plan does not match the selected ticket and exact request checksum.");
  const canonical = canonicalRequest(entry.request, profile);
  const graph = inspectPartGraph(canonical);
  requireValue(graph.status === "pass", "Request has duplicate PRs/parts, missing dependencies, or a dependency cycle.");
  const expected = new Map();
  for (const part of entry.request.release_parts) {
    const role = repositoryRole(part.repository, profile);
    const group = expected.get(role) ?? { pulls: [], parts: [] };
    group.pulls.push(...part.pull_requests); group.parts.push(part); expected.set(role, group);
  }
  requireValue(Array.isArray(input.repositories) && input.repositories.length === expected.size, "Plan must include every requested repository exactly once.");
  const seen = new Set();
  const repositories = input.repositories.map(repo => {
    requireValue(exactKeys(repo, ["role", "destination", "pull_requests"]) && expected.has(repo.role) && !seen.has(repo.role), "Invalid or repeated repository role.");
    seen.add(repo.role);
    const group = expected.get(repo.role);
    requireValue(Array.isArray(repo.pull_requests) && repo.pull_requests.length === group.pulls.length
      && group.pulls.every(pr => repo.pull_requests.some(value => exactKeys(value, ["number", "branch", "commit"])
        && value.number === pr.number && value.branch === pr.branch && value.commit === pr.commit)), "Plan must include exactly the PR versions saved in this ticket; no extra, missing, or substituted PRs.");
    const depends_on = [...new Set(group.parts.flatMap(part => part.depends_on.map(id =>
      repositoryRole(entry.request.release_parts.find(value => value.id === id).repository, profile))))].filter(role => role !== repo.role);
    // Preserve part ordering constraints within a repository's explicit PR order.
    for (const part of group.parts) for (const id of part.depends_on) {
      const dependency = group.parts.find(value => value.id === id);
      if (dependency) requireValue(Math.max(...dependency.pull_requests.map(pr => repo.pull_requests.findIndex(value => value.number === pr.number)))
        < Math.min(...part.pull_requests.map(pr => repo.pull_requests.findIndex(value => value.number === pr.number))), "PR merge order contradicts the request's part dependencies.");
    }
    return { ...repo, depends_on, ...(repo.role === "backend" ? {
      deploy_units: [...new Set(group.parts.flatMap(part => part.deploy_units))],
      deploy_dependencies: group.parts.flatMap(part => part.deploy_dependencies)
    } : {}) };
  });
  const plan = normalizeMergePlan({ schema_version: "1", source: "verified-inbox", profile: profile.name,
    case_id: `issue-${entry.issue_number}`, target: entry.request.target, repositories }, profile);
  plan.dependency_request = canonical;
  plan.inbox = binding;
  return plan;
}
