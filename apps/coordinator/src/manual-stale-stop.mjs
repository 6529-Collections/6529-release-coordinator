import { validateReleaseExecution } from "./release-state.mjs";
import { selectProfile } from "./profiles.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");

// This records the failed acceptance of a successful E2E workflow. It does not
// relabel the workflow as failed, retest, restore, or touch a product branch.
export function stopStaleE2e(batch, { actor, observed, at, workflow }) {
  const execution = structuredClone(batch.execution);
  const step = execution?.plan?.steps?.[execution.step_index];
  const record = execution?.operations?.["staging:e2e"];
  const repositoryName = selectProfile(execution?.plan?.profile).repositories
    .frontend.full_name;
  const workflowUrl = `https://github.com/${repositoryName}/actions/runs/${record?.workflow_run_id}`;
  if (
    !["real", "sandbox"].includes(execution?.plan?.profile) ||
    execution.status !== "running" ||
    step?.id !== "staging:e2e" ||
    record?.state !== "running" ||
    record.result !== null ||
    !Number.isSafeInteger(record.workflow_run_id) ||
    record.workflow_run_id < 1 ||
    workflow?.id !== record.workflow_run_id ||
    workflow?.status !== "completed" ||
    workflow?.conclusion !== "success" ||
    workflow?.html_url !== workflowUrl ||
    !actor?.id ||
    !actor?.login ||
    !Number.isFinite(Date.parse(at)) ||
    !["backend", "frontend"].every(
      (role) => sha(execution.versions.staging?.[role]) && sha(observed?.[role])
    ) ||
    observed.backend === execution.versions.staging.backend ||
    execution.plan.steps.some(
      (planned) =>
        planned.environment === "prod" && execution.operations[planned.id]
    )
  )
    throw new Error(
      "The saved release is not the exact stale staging E2E stop."
    );
  execution.manual_stop = {
    reason: "release-stale",
    at,
    actor,
    expected: { ...execution.versions.staging },
    observed: { ...observed },
    e2e_workflow_run_id: record.workflow_run_id
  };
  record.state = "completed";
  record.result = {
    status: "stopped",
    reason: "release-stale",
    workflow: {
      id: workflow.id,
      url: workflow.html_url,
      conclusion: workflow.conclusion
    }
  };
  execution.status = "needs-human";
  execution.completed_at = at;
  execution.message =
    `Staging E2E workflow ${record.workflow_run_id} succeeded, but its release acceptance was stale after backend staging changed. ` +
    `The saved production steps never started. This release is stopped without retest or restoration; inspect current environments before any new release.`;
  validateReleaseExecution(execution, batch);
  batch.execution = execution;
  return execution;
}
