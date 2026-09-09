import { randomUUID } from "node:crypto";
import { inspectPull, validatePull, fingerprint } from "./readiness.mjs";
import { catalogServices, inspectServiceGraph } from "./readiness-dependencies.mjs";
import { createRehearsalGit } from "./rehearsal-git.mjs";
import { isSha, RehearsalError } from "./rehearsal-plan.mjs";

const check = (id, status, message, evidence) => ({ id, status, message, ...(evidence === undefined ? {} : { evidence }) });
export const rehearsalExitCode = report => ({ pass: 0, blocked: 1, unknown: 2, stale: 3 })[report.status] ?? 2;
export function safeRehearsalError(error) {
  return error instanceof RehearsalError ? { code: error.code, message: error.message, ...(error.owned_path ? { owned_path: error.owned_path } : {}) }
    : { code: "operation_failed", message: "Rehearsal evidence could not be obtained; raw tool output was suppressed." };
}
function stableObservation(observation) {
  return JSON.stringify({ destination: observation.destination, pulls: observation.pulls.map(pr => fingerprint(pr)) });
}
// The merge algorithm consumes a normalized plan. Repository/profile/input
// selection stays in adapters; it does not choose between fake and real code.
export async function rehearseMerge(planInput, {
  github, createGit = createRehearsalGit, signal, revision = { commit: "unavailable", dirty: true },
  now = () => new Date().toISOString(), uuid = randomUUID
} = {}) {
  const plan = structuredClone(planInput);
  const report = {
    schema_version: "1", run_id: uuid(), case_id: plan.case_id, profile: plan.profile,
    input_source: plan.input_source, input_hash: plan.input_hash, revision,
    started_at: now(), finished_at: null, status: "unknown", release_authorized: false,
    strategy: "ort-merge-tree-two-parent-v1", git_version: null,
    repositories: [], checks: [], operation_errors: [], cleanup: { status: "not-needed" }
  };
  let session;
  async function observe(repo) {
    const destination = await github.destination(repo.role, repo.destination.branch);
    if (destination?.repository?.id !== repo.identity.id || destination.repository.full_name !== repo.identity.full_name
      || destination.branch !== repo.destination.branch || !isSha(destination.commit)) {
      throw new RehearsalError("destination_identity", "Destination observation does not match the selected repository and branch.");
    }
    const pulls = [];
    for (const requested of repo.pull_requests) {
      const pr = await github.pullRequest(repo.role, requested.number);
      validatePull(pr, repo.role, requested.number, repo.identity.full_name);
      if (pr.repository.databaseId !== repo.identity.id || pr.headRepository?.databaseId !== repo.identity.id
        || pr.headRepository.nameWithOwner !== repo.identity.full_name) throw new RehearsalError("source_identity", "PR source identity differs from the selected repository.");
      pulls.push(pr);
    }
    return { destination, pulls };
  }
  for (const repo of plan.repositories) {
    const item = { role: repo.role, repository: repo.identity, destination: repo.destination,
      pull_requests: repo.pull_requests.map(pr => ({ ...pr, url: `https://github.com/${repo.identity.full_name}/pull/${pr.number}` })),
      initial: null, final: null, checks: [], merges: [], final_tree: null };
    report.repositories.push(item);
    try {
      item.initial = await observe(repo);
      item.checks.push(check("destination_commit", item.initial.destination.commit === repo.destination.commit ? "pass" : "blocked",
        item.initial.destination.commit === repo.destination.commit ? "Destination still matches the recorded commit." : "Destination input is outdated; regenerate the explicit plan."));
      item.initial.pulls.forEach((pr, index) => {
        item.checks.push(...inspectPull(pr, repo.pull_requests[index], repo.role, repo.identity.full_name).map(c => ({ ...c, pr_number: pr.number })));
        for (const name of repo.identity.required_checks ?? []) {
          item.checks.push({ ...check("configured_required_check", pr.checks.some(c => c.isRequired === true && (c.name ?? c.context) === name) ? "pass" : "unknown",
            "The selected profile requires GitHub to enforce this named check; an optional or absent check is insufficient.", { name }), pr_number: pr.number });
        }
        item.checks.push({ ...check("destination_gate", pr.baseRefName === repo.destination.branch && pr.baseRefOid === repo.destination.commit ? "pass" : "unknown",
          "GitHub gates refer to the PR base only; a different destination has no inferred gate proof.", { pr_base: pr.baseRefName, pr_base_commit: pr.baseRefOid }), pr_number: pr.number });
      });
    } catch (error) { item.initial_error = safeRehearsalError(error); item.checks.push(check("initial_evidence", "unknown", item.initial_error.message)); }
  }
  try {
    for (const [index, repo] of plan.repositories.entries()) {
      const item = report.repositories[index];
      const exactOpen = item.initial && item.initial.destination.commit === repo.destination.commit
        && item.initial.pulls.every((pr, n) => pr.state === "OPEN" && !pr.isDraft
          && pr.headRefOid === repo.pull_requests[n].commit && pr.headRefName === repo.pull_requests[n].branch);
      if (!exactOpen) { item.checks.push(check("local_merge", "unknown", "No merge attempted for an unverified, outdated, or inactive PR input.")); continue; }
      try {
        if (!session) {
          session = await createGit({ signal, authentication: () => github.gitAuthentication() });
          report.git_version = session.version;
          report.cleanup = { status: "pending", owned_path: session.directory };
        }
        const workspace = await session.repository(repo);
        let current = repo.destination.commit;
        for (const pr of repo.pull_requests) {
          const merge = await workspace.merge(current, pr.commit);
          item.merges.push({ pr_number: pr.number, base_commit: current, head_commit: pr.commit, ...merge });
          if (merge.status === "blocked") { item.checks.push(check("local_merge", "blocked", "Requested changes conflict in the declared order.", { pr_number: pr.number, conflicts: merge.conflicts })); break; }
          current = merge.commit;
        }
        if (item.merges.length === repo.pull_requests.length && item.merges.every(merge => merge.status === "pass")) {
          item.final_tree = item.merges.at(-1).tree;
          item.checks.push(check("local_merge", "pass", "All requested commits combine in the explicit order. The combined code was not built or executed."));
          if (repo.role === "backend") {
            try {
              const result = await workspace.catalog(current);
              item.catalog = { commit: current, tree: item.final_tree, blob_sha: result.blob_sha };
              const graph = inspectServiceGraph(plan.dependency_request, catalogServices(result.catalog));
              item.checks.push(check("combined_services", graph.status,
                graph.errors.length ? graph.errors.join(" ") : graph.missing_prerequisites.length ? "Runtime prerequisites are not proven; no services were added." : "Selected dependencies are valid in the exact combined catalog.", graph));
            } catch (error) { item.checks.push(check("combined_catalog", "unknown", safeRehearsalError(error).message)); }
          }
        }
      } catch (error) {
        const problem = safeRehearsalError(error);
        if (problem.code === "cleanup_failed") report.cleanup = { status: "failed", owned_path: problem.owned_path };
        item.checks.push(check("local_merge", "unknown", problem.message));
        report.operation_errors.push({ role: repo.role, ...problem });
        // Do not start another workspace after losing cleanup ownership of one.
        // The original leftover must remain visible in the final report.
        if (problem.code === "cleanup_failed") break;
      }
    }
    // Re-observe even after a failed merge. Nothing locks GitHub in this stage.
    for (const [index, repo] of plan.repositories.entries()) {
      const item = report.repositories[index];
      try {
        item.final = await observe(repo);
        item.stability = item.initial ? stableObservation(item.initial) === stableObservation(item.final) ? "pass" : "stale" : "unknown";
      } catch (error) { item.final_error = safeRehearsalError(error); item.stability = "unknown"; }
    }
  } finally {
    if (session) {
      try { await session.cleanup(); report.cleanup = { status: "removed" }; }
      catch { report.cleanup = { status: "failed", owned_path: session.directory }; report.operation_errors.push({ code: "cleanup_failed", message: `Owned temporary directory could not be removed: ${session.directory}` }); }
    }
  }
  const checks = [...report.checks, ...report.repositories.flatMap(repo => repo.checks)];
  report.status = report.operation_errors.length ? "unknown"
    : report.repositories.some(repo => repo.stability === "stale") ? "stale"
      : report.repositories.some(repo => repo.stability !== "pass") ? "unknown"
        : checks.some(c => c.status === "blocked") ? "blocked"
          : checks.some(c => c.status !== "pass") ? "unknown" : "pass";
  report.finished_at = now();
  return report;
}

export function formatRehearsal(report) {
  const lines = [`Merge rehearsal: ${report.status} (${report.profile})`, `Case: ${report.case_id}`, "Local merge evidence only. Release authorized: false."];
  for (const repo of report.repositories) {
    lines.push(`${repo.repository.full_name}: ${repo.merges.length} merge step(s); snapshot ${repo.stability}`);
    for (const c of repo.checks.filter(c => c.status !== "pass")) lines.push(`  ${c.status}: ${c.id}${c.pr_number ? ` PR #${c.pr_number}` : ""} — ${JSON.stringify(c.message)}`);
    for (const merge of repo.merges.filter(m => m.conflicts.length)) lines.push(`  Conflict paths: ${JSON.stringify(merge.conflicts)}`);
  }
  if (report.cleanup.status === "failed") lines.push(`Cleanup required: ${JSON.stringify(report.cleanup.owned_path)}`);
  return `${lines.join("\n")}\n`;
}
