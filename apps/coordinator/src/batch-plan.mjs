import { sandboxProfile } from "./profiles.mjs";
import { inboxBinding, inboxMergePlan } from "./inbox-merge-plan.mjs";
import { normalizeMergePlan } from "./rehearsal-plan.mjs";
import { runMergePlan } from "./rehearsal-runner.mjs";
import {
  captureServiceSource,
  servicePlanFromSources
} from "./service-plan.mjs";
import { serviceAssert, serviceHash } from "./service-contract.mjs";
import { sandboxServiceRuntime } from "./service-runtime-config.mjs";
import { isReleaseRequestTarget } from "./release-target.mjs";

export const batchPolicy = Object.freeze({
  version: "sandbox-batch-v2",
  max_tickets: 10,
  max_prs_per_repository: 10,
  max_git_attempts: 40,
  max_check_attempts: 12,
  max_elapsed_ms: 45 * 60_000,
  priority: "github-issue-number-ascending",
  dependencies: "self-contained-tickets-only",
  required_workflow: "sandbox-check.yml",
  required_job: "Sandbox check",
  workflow_blob: "bb736a236bc1d14d2f8ea35ce40953686e91169f",
  runtime: sandboxServiceRuntime
});

export function batchMergePlan(items, profile = sandboxProfile) {
  serviceAssert(
    profile === sandboxProfile &&
      items.length > 0 &&
      items.length <= batchPolicy.max_tickets,
    "batch-scope",
    "Batch trials require whole sandbox tickets within the configured limit."
  );
  const targets = [...new Set(items.map((item) => item.entry.request.target))];
  serviceAssert(
    targets.length === 1 && isReleaseRequestTarget(targets[0]),
    "batch-unsupported",
    "Every ticket in one batch must have the same staging or production target."
  );
  const bindings = [],
    repos = new Map();
  for (const item of items) {
    serviceAssert(
      item.entry.request.target === targets[0] &&
        item.entry.request.database_change === "no",
      "batch-unsupported",
      "This batch stage requires one shared target and no database changes."
    );
    const plan = inboxMergePlan(item.input, item.entry, profile);
    bindings.push(inboxBinding(item.entry, profile));
    for (const repo of plan.repositories) {
      const prior = repos.get(repo.role);
      serviceAssert(
        !prior ||
          serviceHash(prior.destination) === serviceHash(repo.destination),
        "batch-stale",
        "All tickets in a batch must use the same saved main commits.",
        "stale"
      );
      if (!prior)
        repos.set(repo.role, {
          role: repo.role,
          destination: repo.destination,
          pull_requests: [],
          depends_on: [],
          ...(repo.role === "backend"
            ? { deploy_units: [], deploy_dependencies: [] }
            : {})
        });
      const combined = repos.get(repo.role);
      combined.pull_requests.push(...repo.pull_requests);
      combined.depends_on = [
        ...new Set([...combined.depends_on, ...repo.depends_on])
      ];
      if (repo.role === "backend") {
        combined.deploy_units = [
          ...new Set([...combined.deploy_units, ...repo.deploy_units])
        ];
        combined.deploy_dependencies = [
          ...new Map(
            [...combined.deploy_dependencies, ...repo.deploy_dependencies].map(
              (edge) => [serviceHash(edge), edge]
            )
          ).values()
        ];
      }
    }
  }
  const ordered = [repos.get("backend"), repos.get("frontend")].filter(Boolean);
  const plan = normalizeMergePlan(
    {
      schema_version: "1",
      source: "verified-batch",
      profile: profile.name,
      case_id: `batch-${serviceHash(bindings).slice(0, 24)}`,
      target: targets[0],
      repositories: ordered
    },
    profile
  );
  plan.batch = {
    profile: profile.name,
    repository: profile.inbox.full_name,
    repository_id: profile.inbox.id,
    tickets: bindings
  };
  plan.input_hash = serviceHash({ plan, policy: batchPolicy });
  return plan;
}

export async function prepareBatch(
  items,
  { profile = sandboxProfile, signal, ...options } = {}
) {
  const plan = batchMergePlan(items, profile);
  const report = await runMergePlan(plan, {
    ...options,
    profile,
    signal,
    captureRepository: async (workspace, repo, commit) => {
      const source = await captureServiceSource(workspace, repo, commit);
      if (!source.error) {
        source.base_tree = await workspace.tree(repo.destination.commit);
        source.patch = await workspace.patch(
          repo.destination.commit,
          commit,
          source.changed_paths
        );
      }
      return source;
    }
  });
  const conflicts = report.repositories.flatMap((repo) =>
    repo.merges
      .filter((merge) => merge.status === "blocked")
      .map((merge) => ({
        role: repo.role,
        pr_number: merge.pr_number,
        paths: merge.conflicts
      }))
  );
  const status = report.status === "pass" ? "passed" : report.status;
  if (status !== "passed")
    return {
      status,
      kind: conflicts.length && status === "blocked" ? "conflict" : "evidence",
      message: conflicts.length
        ? "The combined tickets have Git conflicts."
        : "The combined Git, catalog or current-input evidence did not pass.",
      conflicts,
      report_file: report.report_file
    };
  const publications = report.repositories.map((repo) => ({
    role: repo.role,
    repository: repo.repository,
    base: repo.destination.commit,
    base_tree: repo.service_source.base_tree,
    tree: repo.final_tree,
    patch: repo.service_source.patch
  }));
  if (!publications.some((repo) => repo.patch.length))
    return {
      status: "unknown",
      kind: "evidence",
      message:
        "The combined trees have no changes against saved main. No temporary PR can be checked; this candidate is held for Coordinator review.",
      report_file: report.report_file
    };
  for (const repo of report.repositories) delete repo.service_source.patch;
  const servicePlan = servicePlanFromSources({
    request: { ...plan.dependency_request, database_change: "no" },
    binding: plan.batch,
    report,
    runtime: batchPolicy.runtime
  });
  return {
    status: "passed",
    kind: "prepared",
    message: "Cheap combined checks passed; application checks have not run.",
    input_hash: plan.input_hash,
    binding: plan.batch,
    service_plan: servicePlan,
    publications,
    report_file: report.report_file
  };
}
