import { digest } from "./inbox-journal.mjs";
import { releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";
import { productWorkflowRuntimeForProfile } from "./product-workflow-runtime-config.mjs";
import { expectedJobs } from "./product-workflow-release-github.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const time = (value) => Date.parse(value);
const requireProof = (condition, message) => {
  if (!condition) throw new Error(message);
};
export function cleanupReleaseRecords(entry, ticket, records) {
  const owned = records.filter((batch) =>
    batch.selected?.includes(entry.issue_number)
  );
  const projection = ticket?.transitions.findLast(
    ({ decision, policy_version }) =>
      !policy_version?.startsWith("inbox-cleanup-") && decision.batch?.release
  )?.decision.batch;
  return { owned, projection };
}

// This observes evidence only. It never changes an execution to completed,
// retests, restores branches, removes resources or acquires a release lane.
export async function inspectCleanupFollowup(
  entry,
  { ticket, records = [], github, profile }
) {
  const { owned, projection } = cleanupReleaseRecords(entry, ticket, records);
  if (!owned.length && !projection) return null;
  const checks = [],
    evidence = {
      profile: profile.name,
      ticket: entry.issue_url,
      attempts: owned.map((batch) => batch.fingerprint)
    };
  const check = async (id, action, inspect) => {
    try {
      const value = await inspect();
      checks.push({ id, status: "pass", message: action, evidence: value });
      return value;
    } catch (error) {
      checks.push({ id, status: "unknown", message: error.message, action });
      return null;
    }
  };
  const eligible = await check(
    "stopped_attempts",
    "Inspect the saved release and remaining follow-up before closing this ticket.",
    async () => {
      requireProof(
        entry.status === "valid" &&
          owned.length &&
          (!projection ||
            owned.some(
              (batch) => batch.fingerprint === projection.fingerprint
            )),
        "Full verified release history is missing; the displayed status alone cannot settle the attempt."
      );
      requireProof(
        entry.request.database_change === "no" &&
          entry.request.release_parts.every(
            (part) =>
              part.repository ===
              profile.repositories.frontend.full_name.split("/")[1]
          ),
        "Backend, monitoring or database effects require their maintainer's reconciliation; this checker can account for frontend-only changes."
      );
      for (const batch of owned) {
        const saved = batch.inputs?.find(
          (input) => input.number === entry.issue_number
        );
        requireProof(
          saved?.input?.inbox?.request_id === entry.request.request_id &&
            saved.input.inbox.repository_id === profile.inbox.id &&
            saved.input.inbox.checksum ===
              releaseRequestChecksum(entry.request),
          "The release attempt is not bound to this exact submitted request."
        );
        const execution = batch.execution;
        requireProof(
          execution?.status === "needs-human" &&
            execution.plan?.profile === profile.name &&
            Number.isFinite(time(execution.started_at)) &&
            Number.isFinite(time(execution.completed_at)),
          "An active or unverified release attempt still needs reconciliation."
        );
        requireProof(
          batch.inputs.every((input) => input.database_change === "no") &&
            execution.plan.steps.every(
              (step) => step.role === "frontend" || step.role === null
            ),
          "The shared attempt includes backend or database work that this frontend checker cannot settle."
        );
        requireProof(
          !execution.recovery &&
            !execution.cancellation &&
            !execution.staging_drift,
          "A saved recovery, cancellation or staging choice still needs explicit reconciliation."
        );
        requireProof(
          execution.manual_stop?.reason === "release-stale",
          "This stop lacks a verified staging-drift disposition; inspect its specific failure before closure."
        );
        for (const operation of Object.values(execution.operations)) {
          requireProof(
            operation.state === "completed" &&
              (operation.result?.status === "passed" ||
                (operation.step?.kind === "e2e" &&
                  operation.step.environment === "staging" &&
                  operation.result?.status === "stopped" &&
                  operation.result.reason === "release-stale")),
            "A saved operation is unfinished, failed or has an unknown effect."
          );
        }
        requireProof(
          !Object.values(execution.operations).some(
            (operation) => operation.step?.environment === "prod"
          ),
          "This attempt changed production; its production effects require separate reconciliation."
        );
        requireProof(
          batch.attempts.every(
            (attempt) =>
              !attempt.progress ||
              (attempt.progress.cleanup === "removed" &&
                attempt.progress.prs.every((pr) => pr.cleanup === "removed"))
          ),
          "Temporary trial cleanup is incomplete in the saved history."
        );
      }
      requireProof(
        github,
        "The read-only follow-up evidence client is unavailable."
      );
      return true;
    }
  );
  if (!eligible) return { status: "unknown", checks, evidence };
  const runtime = productWorkflowRuntimeForProfile(profile);
  const since = new Date(
    owned.reduce(
      (earliest, batch) => Math.min(earliest, time(batch.execution.started_at)),
      Infinity
    )
  ).toISOString();
  const lists = new Map();
  const runs = (role, key) => {
    const id = `${role}:${key}`;
    if (!lists.has(id)) lists.set(id, github.runs(role, key, since));
    return lists.get(id);
  };
  const identities = await check(
    "repository_identity",
    "Verify the selected profile's product repositories.",
    async () => {
      for (const role of ["backend", "frontend"]) {
        const value = await github.identity(role),
          expected = profile.repositories[role];
        requireProof(
          value?.id === expected.id &&
            value.full_name === expected.full_name &&
            value.private === expected.private,
          "Product repository identity does not match this profile."
        );
      }
      return true;
    }
  );
  if (!identities) return { status: "unknown", checks, evidence };
  const versions = async () =>
    Object.fromEntries(
      await Promise.all(
        ["staging", "prod"].map(async (environment) => [
          environment,
          Object.fromEntries(
            await Promise.all(
              ["backend", "frontend"].map(async (role) => {
                const ref = await github.ref(
                  role,
                  runtime.branches[environment]
                );
                requireProof(
                  sha(ref?.object?.sha),
                  "A current environment branch has no verifiable commit."
                );
                return [role, ref.object.sha];
              })
            )
          )
        ])
      )
    );
  const before = await check(
    "environment_versions",
    "Verify current staging and production branch versions.",
    versions
  );
  if (!before) return { status: "unknown", checks, evidence };
  evidence.versions = before;
  const quiet = await check(
    "workflow_activity",
    "Let existing deployment and test workflows settle, then check this ticket again.",
    async () => {
      for (const role of ["backend", "frontend"])
        for (const key of Object.keys(runtime.repositories[role].workflows)) {
          const values = await runs(role, key);
          requireProof(
            Array.isArray(values) &&
              values.every((run) => run.status === "completed"),
            "A deployment or test workflow is still active; its effects are not settled."
          );
        }
      return true;
    }
  );
  const runProof = async (role, run, key, environment, required) => {
    const repository = profile.repositories[role],
      configured = runtime.repositories[role].workflows[key];
    const latest = await github.run(role, run?.id),
      workflow = await github.workflow(role, key);
    requireProof(
      positive(latest?.id) &&
        latest.id === run.id &&
        [
          "workflow_id",
          "head_sha",
          "head_branch",
          "display_title",
          "event",
          "run_attempt",
          "status",
          "conclusion",
          "updated_at"
        ].every((key) => latest[key] === run[key]) &&
        digest(latest.actor) === digest(run.actor) &&
        sha(latest.head_sha) &&
        positive(latest.run_attempt) &&
        latest.status === "completed" &&
        latest.conclusion === "success" &&
        latest.repository?.id === repository.id &&
        latest.head_repository?.id === repository.id &&
        latest.repository.full_name === repository.full_name &&
        latest.head_repository.full_name === repository.full_name &&
        latest.html_url ===
          `https://github.com/${repository.full_name}/actions/runs/${latest.id}` &&
        latest.path === `.github/workflows/${configured.file}` &&
        workflow?.id === latest.workflow_id &&
        workflow.path === latest.path &&
        workflow.name === configured.name &&
        Number.isFinite(time(latest.created_at)) &&
        Number.isFinite(time(latest.updated_at)),
      "The exact deployment/test workflow did not finish successfully in the expected repository."
    );
    const files = new Set([latest.path]);
    if (key === "prodDeploy" && profile.name === "real")
      for (const file of [
        "production-build-artifact.yml",
        "production-artifact-metadata.yml",
        "production-artifact-verifier.yml"
      ])
        files.add(`.github/workflows/${file}`);
    if (key.endsWith("E2e") && profile.name === "real")
      files.add("ops/scripts/verify-deployment-version.cjs");
    for (const path of files) {
      const file = await github.file(role, path, latest.head_sha),
        pin = runtime.repositories[role].files[path];
      requireProof(
        file?.type === "file" &&
          file.path === path &&
          file.sha === (typeof pin === "string" ? pin : pin?.[environment]),
        `The approved evidence workflow changed: ${path}. Review its version before trusting this check.`
      );
    }
    const jobs = await github.jobs(role, latest);
    requireProof(
      Array.isArray(jobs) &&
        new Set(jobs.map((job) => job.name)).size === jobs.length &&
        jobs.every(
          (job) => job.run_id === latest.id && job.head_sha === latest.head_sha
        ) &&
        required.every((name) =>
          jobs.some(
            (job) =>
              job.name === name &&
              job.status === "completed" &&
              job.conclusion === "success"
          )
        ),
      "Required deployment/test jobs are missing, skipped or unsuccessful for this exact attempt."
    );
    return latest;
  };
  const newest = (values) =>
    [...values].sort(
      (a, b) =>
        time(b.run_started_at ?? b.created_at) -
          time(a.run_started_at ?? a.created_at) || b.id - a.id
    )[0];
  const chain = async (environment) => {
    const stage = environment === "staging",
      prefix = stage ? "staging" : "prod",
      label = stage ? "Staging" : "Production";
    const deploy = newest(
      (await runs("frontend", `${prefix}Deploy`)).filter(
        (run) => run.head_branch === runtime.branches[environment]
      )
    );
    requireProof(
      deploy && deploy.head_sha === before[environment].frontend,
      `${label} has no successful deployment for its current frontend version.`
    );
    const deployed = await runProof(
      "frontend",
      deploy,
      `${prefix}Deploy`,
      environment,
      expectedJobs({ kind: "frontend", environment }, runtime).required
    );
    requireProof(
      deployed.head_sha === before[environment].frontend &&
        deployed.head_branch === runtime.branches[environment] &&
        ["push", "workflow_dispatch"].includes(deployed.event),
      "Unexpected deployment trigger."
    );
    const wrappers = (await runs("frontend", `${prefix}Dispatch`)).filter(
      (run) => run.display_title === `${label} E2E dispatch [${deploy.id}]`
    );
    const tests = (await runs("frontend", `${prefix}E2e`)).filter(
      (run) => run.display_title === `${label} E2E automatic ${deploy.id}`
    );
    requireProof(
      wrappers.length === 1 && tests.length === 1,
      `${label} has no unique test chain tied to deployment ${deploy.id}.`
    );
    const wrapper = await runProof(
      "frontend",
      wrappers[0],
      `${prefix}Dispatch`,
      "prod",
      [`Dispatch successful ${stage ? "staging" : "production"} deployment`]
    );
    const tested = await runProof(
      "frontend",
      tests[0],
      `${prefix}E2e`,
      "prod",
      expectedJobs({ kind: "e2e", environment }, runtime).required
    );
    requireProof(
      wrapper.event === "workflow_run" &&
        wrapper.head_branch === "main" &&
        String(wrapper.actor?.id) === String(deployed.actor?.id) &&
        tested.event === "workflow_dispatch" &&
        tested.head_branch === "main" &&
        String(tested.actor?.id) === runtime.githubActionsActor.id &&
        tested.actor?.login === runtime.githubActionsActor.login &&
        wrapper.display_title === `${label} E2E dispatch [${deploy.id}]` &&
        tested.display_title === `${label} E2E automatic ${deploy.id}` &&
        time(wrapper.created_at) >= time(deployed.updated_at) &&
        time(tested.created_at) >= time(wrapper.created_at),
      "The passing tests do not belong to this deployment's automatic validation chain."
    );
    const backend = newest(
      (await runs("backend", "deploy")).filter(
        (run) => run.head_branch === runtime.branches[environment]
      )
    );
    requireProof(
      backend &&
        backend.head_sha === before[environment].backend &&
        backend.status === "completed" &&
        backend.conclusion === "success" &&
        time(backend.updated_at) <= time(deployed.created_at),
      `${label} backend changed or deployed after the frontend test chain; obtain matching validation for the current combination.`
    );
    // Fresh identity/status read prevents a rerun's changing state being treated
    // as settled merely because the workflow listing returned an older result.
    const freshBackend = await github.run("backend", backend.id);
    requireProof(
      freshBackend.repository?.id === profile.repositories.backend.id &&
        freshBackend.head_repository?.id === profile.repositories.backend.id &&
        freshBackend.head_sha === backend.head_sha &&
        freshBackend.run_attempt === backend.run_attempt &&
        freshBackend.status === "completed" &&
        freshBackend.conclusion === "success" &&
        freshBackend.updated_at === backend.updated_at,
      "Backend deployment evidence changed during inspection."
    );
    return {
      deployment: {
        id: deployed.id,
        url: deployed.html_url,
        commit: deployed.head_sha,
        attempt: deployed.run_attempt
      },
      e2e: { id: tested.id, url: tested.html_url, attempt: tested.run_attempt },
      backend: { id: backend.id, commit: backend.head_sha }
    };
  };
  if (quiet) {
    evidence.staging = await check(
      "staging_followup",
      "Verify a passing deployment and matching tests for the current staging combination.",
      () => chain("staging")
    );
    evidence.delivery =
      entry.request.target === "staging"
        ? evidence.staging
        : await check(
            "production_delivery",
            "Verify a successful live deployment and matching production tests containing the requested fix.",
            () => chain("prod")
          );
    if (evidence.delivery)
      await check(
        "requested_changes",
        "Verify every requested PR was included in the later delivered version.",
        async () => {
          const delivered = [];
          for (const part of entry.request.release_parts)
            for (const requested of part.pull_requests) {
              const pr = await github.pull("frontend", requested.number);
              requireProof(
                pr?.number === requested.number &&
                  pr.state === "closed" &&
                  pr.merged === true &&
                  sha(pr.merge_commit_sha) &&
                  sha(pr.head?.sha) &&
                  pr.head.ref === requested.branch &&
                  pr.head.repo?.id === profile.repositories.frontend.id &&
                  pr.base?.repo?.id === profile.repositories.frontend.id,
                "A requested PR is unmerged, changed repository, or lacks exact merge identity."
              );
              const source = await github.compare(
                "frontend",
                requested.commit,
                pr.head.sha
              );
              const deployed = await github.compare(
                "frontend",
                pr.merge_commit_sha,
                evidence.delivery.deployment.commit
              );
              requireProof(
                [source, deployed].every((value) =>
                  ["identical", "ahead"].includes(value?.status)
                ) &&
                  source.base_commit?.sha === requested.commit &&
                  deployed.base_commit?.sha === pr.merge_commit_sha,
                "The submitted commit is not proved included in the merged PR and delivered version."
              );
              requireProof(
                digest(await github.pull("frontend", requested.number)) ===
                  digest(pr),
                "The requested PR changed during delivery verification."
              );
              delivered.push({
                number: requested.number,
                url: pr.html_url,
                requested_commit: requested.commit,
                merged_head: pr.head.sha,
                merge_commit: pr.merge_commit_sha
              });
            }
          evidence.pull_requests = delivered;
          return delivered;
        }
      );
  }
  await check(
    "owned_resources",
    "Verify old temporary PRs are closed and their owned trial branches are gone.",
    async () => {
      for (const batch of owned) {
        for (const attempt of batch.attempts)
          for (const saved of attempt.progress?.prs ?? []) {
            const pr = await github.pull(saved.role, saved.number);
            requireProof(
              pr?.state === "closed" &&
                pr.merged === false &&
                pr.head?.ref === saved.branch &&
                pr.head.sha === saved.commit &&
                pr.head.repo?.id === profile.repositories[saved.role].id &&
                String(pr.user?.id) === String(saved.actor?.id) &&
                (await github.ref(saved.role, saved.branch)) === null,
              "An owned temporary trial PR or branch still needs cleanup; nothing was removed automatically."
            );
          }
        for (const operation of Object.values(
          batch.execution.operations
        ).filter((operation) => operation.step.kind === "integrate")) {
          const match = operation.result?.url?.match(
            new RegExp(
              `^https://github\\.com/${profile.repositories.frontend.full_name}/pull/([1-9][0-9]*)$`,
              "u"
            )
          );
          requireProof(
            match,
            "The old integration PR has no verifiable product identity."
          );
          const pr = await github.pull("frontend", Number(match[1]));
          requireProof(
            pr?.state === "closed" &&
              pr.merged === true &&
              pr.merge_commit_sha === operation.result.commit &&
              pr.base?.repo?.id === profile.repositories.frontend.id &&
              pr.base.ref === runtime.branches[operation.step.environment],
            "The old integration PR has an unresolved or changed outcome."
          );
          const included = await github.compare(
            "frontend",
            operation.result.commit,
            before[operation.step.environment].frontend
          );
          requireProof(
            ["identical", "ahead"].includes(included?.status) &&
              included.base_commit?.sha === operation.result.commit,
            "The old staging change was replaced or restored without verifiable follow-up; a maintainer must account for it."
          );
        }
      }
      return true;
    }
  );
  await check(
    "environment_stability",
    "Recheck current environment versions before accepting this follow-up.",
    async () => {
      for (const [id, listed] of lists) {
        const [role, key] = id.split(":");
        const fresh = await github.runs(role, key, since);
        const earlier = await listed;
        requireProof(
          Array.isArray(fresh) &&
            fresh.every((run) => run.status === "completed") &&
            digest(fresh) === digest(earlier),
          "Deployment or test workflow history changed during the follow-up check."
        );
      }
      requireProof(
        digest(await versions()) === digest(before),
        "Staging or production changed during the follow-up check."
      );
      return true;
    }
  );
  return {
    status: checks.every((value) => value.status === "pass")
      ? "passed"
      : "unknown",
    checks,
    evidence
  };
}
