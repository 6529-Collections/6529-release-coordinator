import { sandboxProfile } from "./profiles.mjs";
import { createBatchGitHub } from "./batch-github.mjs";
import { createServiceGitHub } from "./service-github.mjs";
import { runServiceAttempt } from "./inbox-services.mjs";
import { servicePlanFromSources } from "./service-plan.mjs";
import {
  serviceHash,
  serviceAssert,
  verifyServiceReport,
  ServiceError
} from "./service-contract.mjs";

export async function verifySavedBatch(
  prepared,
  state,
  {
    profile = sandboxProfile,
    guard = async () => {},
    client = createBatchGitHub({ profile, guard }),
    serviceClient = createServiceGitHub({ profile })
  } = {}
) {
  serviceAssert(
    profile === sandboxProfile &&
      state?.prepared_hash === serviceHash(prepared) &&
      state.result &&
      state.cleanup === "removed",
    "batch-evidence",
    "Saved batch evidence or cleanup is incomplete."
  );
  for (const record of state.prs) {
    await guard();
    const identity = await client.identity(record.role, record.base);
    const result = await client.result(record, { closed: true });
    serviceAssert(
      identity.workflow_id === record.workflow_id &&
        result &&
        serviceHash(result) === serviceHash(record.result),
      "batch-evidence",
      "The saved trial PR evidence changed or is unavailable."
    );
  }
  for (const attempt of Object.values(state.service_attempts)) {
    await guard();
    await serviceClient.identity();
    const result = await serviceClient.result(attempt);
    serviceAssert(
      result && serviceHash(result) === serviceHash(attempt.result),
      "batch-evidence",
      "The saved service evidence changed or is unavailable."
    );
    verifyServiceReport(result.report, attempt.plan, attempt.id);
  }
}

export function baselineBatchPlan(prepared) {
  const plan = prepared.service_plan;
  return servicePlanFromSources({
    binding: { ...plan.binding, purpose: "unchanged-batch-baseline" },
    runtime: plan.runtime,
    request: {
      target: "staging",
      database_change: "no",
      release_parts: [
        {
          id: "backend",
          repository: "6529seize-backend",
          depends_on: [],
          deploy_units: ["dbMigrationsLoop", "worker", "api"],
          deploy_dependencies: []
        },
        {
          id: "frontend",
          repository: "6529seize-frontend",
          depends_on: ["backend"]
        }
      ]
    },
    report: {
      input_hash: serviceHash({
        original: prepared.input_hash,
        purpose: "baseline"
      }),
      repositories: Object.entries(plan.sources).map(([role, source]) => ({
        role,
        repository: source.repository,
        destination: { commit: source.base_commit },
        pull_requests: [],
        final_tree: source.base_tree,
        service_source: {
          baseline: source.baseline,
          files: source.baseline,
          changed_paths: []
        }
      }))
    }
  });
}

export async function checkBatch(
  prepared,
  {
    id,
    previous,
    save,
    guard,
    verify,
    signal,
    profile = sandboxProfile,
    client = createBatchGitHub({ profile, guard }),
    serviceClient = createServiceGitHub({ profile }),
    executeServices = runServiceAttempt,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    maxPolls = 120,
    pollMs = 5000
  }
) {
  serviceAssert(
    profile === sandboxProfile && prepared.status === "passed",
    "batch-profile",
    "Checks need a prepared sandbox batch."
  );
  const hash = serviceHash(prepared);
  const state = previous
    ? structuredClone(previous)
    : {
        id,
        prepared_hash: hash,
        created_at: new Date(now()).toISOString(),
        prs: [],
        service_attempts: {},
        cleanup: "pending"
      };
  serviceAssert(
    state.id === id && state.prepared_hash === hash,
    "batch-state",
    "Saved check inputs changed."
  );
  const persist = async () => {
    await guard();
    await save(structuredClone(state));
  };
  await persist();
  if (state.result && state.cleanup === "removed") {
    if (state.result.status !== "stale")
      await verifySavedBatch(prepared, state, {
        profile,
        guard,
        client,
        serviceClient
      });
    return state.result;
  }
  async function cleanup() {
    for (const record of state.prs) {
      if (record.cleanup === "removed") continue;
      await guard();
      await client.cleanup(record);
      record.cleanup = "removed";
      await persist();
    }
    state.cleanup = "removed";
    await persist();
  }
  if (state.result) {
    await cleanup();
    if (state.result.status !== "stale")
      await verifySavedBatch(prepared, state, {
        profile,
        guard,
        client,
        serviceClient
      });
    return state.result;
  }
  try {
    await verify();
    if (previous) {
      for (const record of state.prs.filter((value) => value.result)) {
        const result = await client.result(record);
        serviceAssert(
          result && serviceHash(result) === serviceHash(record.result),
          "batch-evidence",
          "Previously completed trial evidence changed during resume."
        );
      }
    }
    for (const spec of prepared.publications) {
      if (!spec.patch.length) continue; // Unchanged repository tree; integration still checks both roles.
      let record = state.prs.find((value) => value.role === spec.role);
      if (record && !record.result) {
        const identity = await client.identity(spec.role, spec.base);
        serviceAssert(
          identity.actor.id === record.actor.id &&
            identity.workflow_id === record.workflow_id,
          "batch-ownership",
          "The saved trial actor or required workflow changed."
        );
      }
      if (!record) {
        // Selection applies the deadline before starting a candidate round.
        // A recorded round must finish both repositories and cleanup on resume,
        // even if the deadline passes after its first PR was created.
        const identity = await client.identity(spec.role, spec.base);
        record = {
          role: spec.role,
          base: spec.base,
          tree: spec.tree,
          branch: `codex/batch-trial-${id}`,
          created_at: state.created_at,
          ...identity,
          body: `Temporary Coordinator batch trial. Do not merge.\n\nAttempt: ${id}\nPlan: ${prepared.input_hash}\nTickets: ${prepared.binding.tickets.map((ticket) => `#${ticket.issue_number}`).join(", ")}\n`,
          cleanup: "pending"
        };
        state.prs.push(record);
        await persist();
      }
      if (!record.result)
        await client.open(record, spec.patch, async (saved) => {
          Object.assign(record, saved);
          await persist();
        });
    }
    for (let poll = 0; poll < maxPolls; poll++) {
      signal?.throwIfAborted();
      await guard();
      for (const record of state.prs) {
        if (record.result) continue;
        const result = await client.result(record);
        if (result) {
          record.result = result;
          await persist();
        }
      }
      if (state.prs.every((record) => record.result)) break;
      if (poll + 1 < maxPolls) await wait(pollMs);
    }
    serviceAssert(
      state.prs.every((record) => record.result),
      "batch-checks-pending",
      "Temporary PR checks are still pending. Resume the saved attempt; its PRs remain recorded."
    );
    await verify();
    const checks = state.prs.map((record) => record.result);
    async function services(plan, key) {
      const attempt = await executeServices(plan, {
        previous: state.service_attempts[key],
        client: serviceClient,
        signal,
        guard,
        save: async (attempt) => {
          state.service_attempts[key] = structuredClone(attempt);
          await persist();
        }
      });
      const report = verifyServiceReport(
        attempt.result.report,
        plan,
        attempt.id
      );
      return {
        status:
          report.status === "blocked" &&
          !(
            report.baseline?.status === "passed" &&
            report.cleanup?.status === "removed" &&
            report.steps.some((step) => step.status === "blocked") &&
            report.steps.every(
              (step) => !["unknown", "stale"].includes(step.status)
            )
          )
            ? "unknown"
            : report.status,
        errors: report.errors,
        cleanup: report.cleanup,
        steps: report.steps.map(({ unit, status }) => ({ unit, status })),
        workflow: attempt.result.workflow,
        plan_hash: plan.fingerprint
      };
    }
    let result;
    if (checks.some((check) => !["passed", "blocked"].includes(check.status))) {
      result = {
        status: "unknown",
        kind: "evidence",
        checks,
        message: "Required combined PR checks lack complete evidence."
      };
    } else {
      const service = checks.every((check) => check.status === "passed")
        ? await services(prepared.service_plan, "candidate")
        : null;
      if (service?.status === "passed")
        result = {
          status: "passed",
          kind: "checks",
          checks,
          services: service,
          message: "The exact combined PR and service checks passed."
        };
      else if (
        checks.some(
          (check) => check.status === "blocked" && check.kind === "code"
        ) ||
        service?.status === "blocked"
      ) {
        // Diagnose the unchanged baseline only after a confirmed test failure.
        const baseline = await services(
          baselineBatchPlan(prepared),
          "baseline"
        );
        result =
          baseline.status === "passed"
            ? {
                status: "blocked",
                kind: "code",
                checks,
                services: service,
                baseline,
                message:
                  "The combined code failed while the unchanged baseline passed."
              }
            : {
                status: "unknown",
                kind: "baseline",
                checks,
                services: service,
                baseline,
                message:
                  "The unchanged baseline did not pass; this failure cannot be attributed to the tickets."
              };
      } else
        result = {
          status: "unknown",
          kind: "evidence",
          checks,
          services: service,
          message:
            "Combined application evidence is incomplete; do not split or blame tickets."
        };
    }
    // Persist a final result before removing any temporary evidence/resources.
    await verify();
    state.result = result;
    await persist();
    await cleanup();
    return result;
  } catch (error) {
    if (error instanceof ServiceError && error.status === "stale") {
      state.result = {
        status: "stale",
        kind: "evidence",
        message: error.message
      };
      await persist();
      await cleanup();
      return state.result;
    }
    // Unknown writes, interrupted runs and unfinished checks retain identities
    // and the inbox lock. Explicit resume reconciles them; no replacement POST.
    throw error;
  }
}
