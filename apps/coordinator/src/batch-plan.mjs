import { sandboxProfile } from "./profiles.mjs";
import { inboxBinding, inboxMergePlan } from "./inbox-merge-plan.mjs";
import { normalizeMergePlan } from "./rehearsal-plan.mjs";
import { runMergePlan } from "./rehearsal-runner.mjs";
import {
  captureServiceSource,
  servicePlanFromSources
} from "./service-plan.mjs";
import {
  serviceAssert,
  serviceHash,
  validateServicePlan
} from "./service-contract.mjs";
import { sandboxServiceRuntime } from "./service-runtime-config.mjs";
import { isReleaseRequestTarget } from "./release-target.mjs";
import { realProductWorkflowRuntime } from "./product-workflow-runtime-config.mjs";

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

// The product profile uses the same bounded candidate search and exact-tree
// PR rehearsal. Product repositories supply their own required PR checks, so
// there is no sandbox-only service workflow or sample artifact contract here.
export const realBatchPolicy = Object.freeze({
  max_tickets: commonBatchPolicy.max_tickets,
  max_prs_per_repository: commonBatchPolicy.max_prs_per_repository,
  max_git_attempts: commonBatchPolicy.max_git_attempts,
  max_check_attempts: commonBatchPolicy.max_check_attempts,
  priority: commonBatchPolicy.priority,
  dependencies: commonBatchPolicy.dependencies,
  version: "real-batch-v1",
  profile: "real",
  required_checks: Object.freeze({
    backend: Object.freeze(["Build backend and API"]),
    frontend: Object.freeze([
      "DCO",
      "security/snyk (6529)",
      "Plan risk and security checks",
      "Installed app checks",
      "Debt ratchet"
    ])
  }),
  workflow_blobs: Object.freeze({
    backend: Object.freeze({
      ".github/workflows/on-pull-request.yml":
        "9e5b5c526c2aa5150b89b06fe218de41b9c0d719"
    }),
    frontend: Object.freeze({
      ".github/workflows/app-pr-ci.yml":
        "874b4eb0070101202d0d3eda081d5e616e87cabd",
      ".github/workflows/debt-ratchet.yml":
        "8de45e342ad45535577299b089d64e11601e9e4d"
    })
  })
});

export const databaseBatchPolicies = Object.freeze([
  databaseBatchPolicy.version,
  batchPolicy.version,
  realBatchPolicy.version
]);
export const operationalBatchPolicies = Object.freeze([
  batchPolicy.version,
  realBatchPolicy.version
]);

export const batchPolicyProfile = (policy) =>
  policy?.profile ??
  (String(policy?.version ?? "").startsWith("sandbox-") ? "sandbox" : null);

export const batchPolicyForProfile = (profile) =>
  profile?.name === "real" ? realBatchPolicy : batchPolicy;

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
    batchPolicy.version,
    realBatchPolicy.version
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
    batchPolicy,
    realBatchPolicy
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
    batchPolicyProfile(policy) === profile?.name &&
      items.length > 0 &&
      items.length <= policy.max_tickets,
    "batch-scope",
    `Batch trials require whole ${batchPolicyProfile(policy)} tickets within the configured limit.`
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
    `A database-changing ${profile.name === "sandbox" ? "sandbox " : ""}release must contain exactly one whole ticket.`
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
    candidatePatchMode: profile.name,
    captureRepository: async (workspace, repo, commit) => {
      if (profile.name === "real") {
        const changedPaths = await workspace.changedPaths(
          repo.destination.commit,
          commit
        );
        return {
          base_tree: await workspace.tree(repo.destination.commit),
          changed_paths: changedPaths,
          patch: await workspace.patch(
            repo.destination.commit,
            commit,
            changedPaths
          )
        };
      }
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
  if (profile.name === "real")
    for (const publication of publications) {
      const pinned = [
        ...Object.keys(policy.workflow_blobs[publication.role]),
        ...Object.keys(
          realProductWorkflowRuntime.repositories[publication.role].files
        )
      ];
      serviceAssert(
        publication.patch.every((file) => !pinned.includes(file.path)),
        "batch-runtime",
        "A candidate changes the workflow used to verify its own product PR."
      );
    }
  if (!publications.some((repo) => repo.patch.length))
    return {
      status: "unknown",
      kind: "evidence",
      message:
        "The combined trees have no changes against saved main. No temporary PR can be checked; this candidate is held for Coordinator review.",
      report_file: report.report_file
    };
  for (const repo of report.repositories) delete repo.service_source.patch;
  const servicePlan =
    profile.name === "sandbox"
      ? servicePlanFromSources({
          request: {
            ...plan.dependency_request,
            database_change: items[0].entry.request.database_change
          },
          binding: plan.batch,
          report,
          runtime: policy.runtime
        })
      : realServicePlan(plan, report, items);
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

export function realServicePlan(plan, report, items) {
  // runMergePlan reads the backend catalog from the exact combined commit and
  // records this check independently of the profile-specific captureRepository.
  const backend = report.repositories.find(
    (repository) => repository.role === "backend"
  );
  const catalogCheck = backend?.checks?.find(
    (check) => check.id === "combined_services"
  );
  const graph = catalogCheck?.evidence;
  if (backend)
    serviceAssert(
      /^[0-9a-f]{40}$/u.test(backend.catalog?.commit ?? "") &&
        backend.catalog.commit === backend.merges?.at(-1)?.commit &&
        /^[0-9a-f]{40}$/u.test(backend.catalog?.tree ?? "") &&
        backend.catalog.tree === backend.final_tree &&
        /^[0-9a-f]{40}$/u.test(backend.catalog?.blob_sha ?? "") &&
        catalogCheck?.status === "pass" &&
        graph?.status === "pass" &&
        Array.isArray(graph.order) &&
        Array.isArray(graph.edges),
      "invalid-services",
      "The exact product backend catalog did not confirm the requested deployment order."
    );
  const declared = items[0].entry.request.database_change;
  serviceAssert(
    ["yes", "no"].includes(declared),
    "database-unverified",
    "The product request needs a verified yes/no database answer."
  );
  const steps = (graph?.order ?? []).map((node) => {
    const unit = node.split("/").at(-1);
    return {
      unit,
      role: unit === "frontend" ? "frontend" : "backend",
      depends_on: graph.edges
        .filter((edge) => edge.after === node)
        .map((edge) => edge.before.split("/").at(-1))
    };
  });
  const contents = {
    protocol: "product-services-v1",
    profile: "real",
    binding: plan.batch,
    rehearsal_input_hash: report.input_hash,
    database: { declared, observed: declared },
    steps
  };
  return { ...contents, fingerprint: serviceHash(contents) };
}

export function validateBatchServicePlan(plan, profileName) {
  if (profileName === "sandbox") return validateServicePlan(plan);
  const { fingerprint, ...contents } = plan ?? {};
  serviceAssert(
    profileName === "real" &&
      plan?.protocol === "product-services-v1" &&
      plan.profile === "real" &&
      serviceHash(contents) === fingerprint &&
      ["yes", "no"].includes(plan.database?.declared) &&
      plan.database.declared === plan.database.observed &&
      Array.isArray(plan.steps) &&
      plan.steps.every(
        (step) =>
          ["backend", "frontend"].includes(step.role) &&
          /^[A-Za-z][A-Za-z0-9_-]{0,119}$/u.test(step.unit) &&
          Array.isArray(step.depends_on)
      ),
    "batch-state",
    "Invalid product release preparation."
  );
  return plan;
}
