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

const elapsedBatchPolicyBase = {
  max_tickets: 10,
  max_prs_per_repository: 10,
  max_git_attempts: 40,
  max_check_attempts: 12,
  max_elapsed_ms: 45 * 60_000,
  priority: "github-issue-number-ascending",
  dependencies: "self-contained-tickets-only",
  required_workflow: "sandbox-check.yml",
  required_job: "Sandbox check",
  runtime: sandboxServiceRuntime
};

const commonBatchPolicy = {
  max_tickets: 10,
  max_prs_per_repository: 10,
  max_git_attempts: 40,
  max_check_attempts: 12,
  priority: "github-issue-number-ascending",
  dependencies: "self-contained-tickets-only",
  required_workflow: "sandbox-check.yml",
  required_job: "Sandbox check",
  runtime: sandboxServiceRuntime
};

export const legacyBatchPolicy = Object.freeze({
  ...elapsedBatchPolicyBase,
  version: "sandbox-batch-v1",
  workflow_blob: "6fe8f54d4f3147854c3186c9b3992f983612b0b0"
});

export const elapsedBatchPolicy = Object.freeze({
  ...elapsedBatchPolicyBase,
  version: "sandbox-batch-v2",
  workflow_blob: "bb736a236bc1d14d2f8ea35ce40953686e91169f"
});

// A short-lived v2 policy was saved before the sandbox check workflow changed.
// Keep that exact historical shape readable so it cannot block every later run.
export const earlierElapsedBatchPolicy = Object.freeze({
  ...elapsedBatchPolicyBase,
  version: "sandbox-batch-v2",
  workflow_blob: "6fe8f54d4f3147854c3186c9b3992f983612b0b0"
});

export const previousBatchPolicy = Object.freeze({
  ...commonBatchPolicy,
  version: "sandbox-batch-v3",
  workflow_blob: "bb736a236bc1d14d2f8ea35ce40953686e91169f"
});

export const priorBatchPolicy = Object.freeze({
  ...commonBatchPolicy,
  version: "sandbox-batch-v4",
  workflow_blob: Object.freeze({
    backend: "83f5fed03dc366bcf3643eb8ca74a0b15f820da4",
    frontend: "96d6e6c352013a32b96d386829cf50a1ecb91a11"
  })
});

export const databaseBatchPolicy = Object.freeze({
  ...commonBatchPolicy,
  version: "sandbox-batch-v5",
  workflow_blob: priorBatchPolicy.workflow_blob
});

// v6 batches record each ticket's operational deployments so the release plan
// can deploy sample monitoring after the test-main merge. The backend check
// workflow also builds the sample monitoring package on every PR.
export const batchPolicy = Object.freeze({
  ...commonBatchPolicy,
  version: "sandbox-batch-v6",
  workflow_blob: Object.freeze({
    backend: "58396920d9a75a6a1b524dba728f128105d3cbef",
    frontend: priorBatchPolicy.workflow_blob.frontend
  })
});

export const databaseBatchPolicies = Object.freeze([
  databaseBatchPolicy.version,
  batchPolicy.version
]);
export const operationalBatchPolicies = Object.freeze([batchPolicy.version]);

// One sorted list per ticket, from its request parts or a saved batch input.
export const requestedOperationalDeployments = (request) =>
  Array.isArray(request?.release_parts)
    ? [
        ...new Set(
          request.release_parts.flatMap(
            (part) => part.operational_deployments ?? []
          )
        )
      ].sort((a, b) => a.localeCompare(b))
    : [...(request?.operational_deployments ?? [])];

export function isReleaseBatchPolicy(policy) {
  return [
    elapsedBatchPolicy.version,
    previousBatchPolicy.version,
    priorBatchPolicy.version,
    databaseBatchPolicy.version,
    batchPolicy.version
  ].includes(policy?.version);
}

export function trustedBatchPolicy(policy) {
  const expected = [
    legacyBatchPolicy,
    earlierElapsedBatchPolicy,
    elapsedBatchPolicy,
    previousBatchPolicy,
    priorBatchPolicy,
    databaseBatchPolicy,
    batchPolicy
  ].find(
    (candidate) =>
      candidate.version === policy?.version &&
      serviceHash(candidate) === serviceHash(policy)
  );
  serviceAssert(
    expected,
    "batch-policy",
    "Saved batch policy is not a trusted Coordinator policy."
  );
  return expected;
}

export function batchMergePlan(
  items,
  profile = sandboxProfile,
  policy = batchPolicy
) {
  trustedBatchPolicy(policy);
  serviceAssert(
    profile === sandboxProfile &&
      items.length > 0 &&
      items.length <= policy.max_tickets,
    "batch-scope",
    "Batch trials require whole sandbox tickets within the configured limit."
  );
  const targets = [...new Set(items.map((item) => item.entry.request.target))];
  const databases = items.map((item) => item.entry.request.database_change);
  serviceAssert(
    targets.length === 1 && isReleaseRequestTarget(targets[0]),
    "batch-unsupported",
    "Every ticket in one batch must have the same staging or production target."
  );
  serviceAssert(
    databases.every((value) => ["no", "yes"].includes(value)) &&
      (!databases.includes("yes") || items.length === 1),
    "batch-unsupported",
    "A database-changing sandbox release must contain exactly one whole ticket."
  );
  const bindings = [],
    repos = new Map();
  for (const item of items) {
    serviceAssert(
      item.entry.request.target === targets[0],
      "batch-unsupported",
      "This batch stage requires one shared target."
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
  plan.input_hash = serviceHash({ plan, policy });
  return plan;
}

export async function prepareBatch(
  items,
  { profile = sandboxProfile, signal, policy = batchPolicy, ...options } = {}
) {
  const plan = batchMergePlan(items, profile, policy);
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
    request: {
      ...plan.dependency_request,
      database_change: items[0].entry.request.database_change
    },
    binding: plan.batch,
    report,
    runtime: policy.runtime
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
