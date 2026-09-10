import { executeGitHub } from "./coordinator-github.mjs";
import {
  runRehearsalProcess,
  githubEnvironment
} from "./rehearsal-process.mjs";
import { sandboxProfile } from "./profiles.mjs";
import { sandboxServiceRuntime } from "./service-runtime-config.mjs";
import {
  serviceAssert,
  ServiceError,
  verifyServiceReport
} from "./service-contract.mjs";

export async function readServiceLogs(endpoint, process = runRehearsalProcess) {
  // Actions logs contain terminal controls. Keep them in memory, never display
  // raw logs, and parse only the trusted workflow's bounded result record.
  return (
    await process(
      "gh",
      ["api", "--hostname", "github.com", endpoint, "--allow-escape-sequences"],
      {
        env: githubEnvironment(),
        timeout: 30_000,
        maxOutput: 4 * 1024 * 1024
      }
    )
  ).stdout;
}

export function createServiceGitHub({
  profile,
  runtime = sandboxServiceRuntime,
  execute = executeGitHub,
  logs = readServiceLogs
} = {}) {
  serviceAssert(
    profile === sandboxProfile &&
      runtime.repository === sandboxProfile.repositories.backend.full_name &&
      runtime.repository_id === sandboxProfile.repositories.backend.id &&
      runtime.workflow === "sandbox-service-check.yml" &&
      runtime.ref === "codex/sandbox-services-runtime-v1" &&
      /^[0-9a-f]{40}$/u.test(runtime.commit ?? ""),
    "runtime-unavailable",
    "The pinned sandbox execution runtime is unavailable; real deployment is never a fallback."
  );
  const prefix = `repos/${runtime.repository}`;
  async function call(method, suffix, body) {
    const args = [
      "api",
      "--hostname",
      "github.com",
      "--method",
      method,
      suffix === "user" ? "user" : `${prefix}${suffix}`,
      "--include",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2022-11-28"
    ];
    if (body !== undefined) args.push("--input", "-");
    const output = await execute(args, body);
    const match = output.match(
      /^HTTP\/\S+ (\d{3})[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/u
    );
    serviceAssert(
      match,
      "github-unavailable",
      "Sandbox GitHub returned no readable HTTP response."
    );
    let data = null;
    try {
      if (match[2].trim()) data = JSON.parse(match[2]);
    } catch {
      throw new ServiceError(
        "github-unavailable",
        "Sandbox GitHub returned unreadable JSON."
      );
    }
    const status = Number(match[1]);
    serviceAssert(
      [200, 204].includes(status),
      "github-unavailable",
      `Sandbox GitHub operation returned HTTP ${status}.`
    );
    return data;
  }
  const title = (id) => `Sandbox services ${id}`;
  function validateRun(run, attempt) {
    serviceAssert(
      Number.isSafeInteger(run?.id) &&
        run.repository?.id === runtime.repository_id &&
        run.repository.full_name === runtime.repository &&
        run.head_repository?.id === runtime.repository_id &&
        run.head_sha === runtime.commit &&
        run.event === "workflow_dispatch" &&
        run.run_attempt === 1 &&
        run.path === `.github/workflows/${runtime.workflow}` &&
        run.display_title === title(attempt.id) &&
        String(run.actor?.id) === attempt.actor.id &&
        run.workflow_id === attempt.workflow_id,
      "workflow-unverified",
      "The workflow identity, source, actor, attempt, or request does not match."
    );
    return run;
  }
  return {
    runtime,
    async identity() {
      const repo = await call("GET", ""),
        actor = await call("GET", "user");
      const ref = await call("GET", `/git/ref/heads/${runtime.ref}`);
      const workflow = await call(
        "GET",
        `/actions/workflows/${runtime.workflow}`
      );
      serviceAssert(
        repo.id === runtime.repository_id &&
          repo.full_name === runtime.repository &&
          repo.private === false &&
          repo.permissions?.push === true &&
          Number.isSafeInteger(actor.id) &&
          ref.object?.type === "commit" &&
          ref.object.sha === runtime.commit &&
          workflow.path === `.github/workflows/${runtime.workflow}` &&
          workflow.state === "active" &&
          Number.isSafeInteger(workflow.id),
        "runtime-unverified",
        "Sandbox repository, access, runtime ref, or workflow changed."
      );
      return {
        actor: { id: String(actor.id), login: actor.login },
        workflow_id: workflow.id
      };
    },
    async dispatch(attempt) {
      serviceAssert(
        attempt.plan.profile === "sandbox" &&
          attempt.plan.fingerprint === attempt.plan_hash &&
          /^[0-9a-f-]{36}$/u.test(attempt.id),
        "invalid-attempt",
        "Only a saved sandbox service attempt can be dispatched."
      );
      return call("POST", `/actions/workflows/${runtime.workflow}/dispatches`, {
        ref: runtime.ref,
        inputs: {
          attempt_id: attempt.id,
          plan_json: JSON.stringify(attempt.plan)
        }
      });
    },
    async find(attempt) {
      const matches = [];
      for (let page = 1; page <= 5; page++) {
        const list = await call(
          "GET",
          `/actions/workflows/${runtime.workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(runtime.ref)}&per_page=100&page=${page}`
        );
        serviceAssert(
          Array.isArray(list.workflow_runs),
          "workflow-unverified",
          "The sandbox run list is incomplete."
        );
        for (const run of list.workflow_runs.filter(
          (run) => run.display_title === title(attempt.id)
        ))
          matches.push(validateRun(run, attempt));
        if (list.workflow_runs.length < 100) break;
      }
      serviceAssert(
        matches.length <= 1,
        "workflow-unverified",
        "More than one workflow claims this service attempt."
      );
      return matches[0] ?? null;
    },
    async result(attempt) {
      serviceAssert(
        Number.isSafeInteger(attempt.workflow_run_id) &&
          attempt.workflow_run_id > 0,
        "workflow-unverified",
        "The service workflow ID is missing."
      );
      const run = validateRun(
        await call("GET", `/actions/runs/${attempt.workflow_run_id}`),
        attempt
      );
      if (run.status !== "completed") return null;
      serviceAssert(
        ["success", "failure"].includes(run.conclusion),
        "workflow-unverified",
        "The required sandbox workflow was cancelled or skipped."
      );
      const jobs = await call(
        "GET",
        `/actions/runs/${run.id}/attempts/1/jobs?per_page=100`
      );
      serviceAssert(
        jobs.total_count === 1 && jobs.jobs?.length === 1,
        "workflow-unverified",
        "The exact sandbox job set could not be verified."
      );
      const job = jobs.jobs[0],
        step = job.steps?.find((s) => s.name === "Run isolated sample");
      serviceAssert(
        job.name === "Sandbox service checks" &&
          job.run_id === run.id &&
          job.head_sha === runtime.commit &&
          job.status === "completed" &&
          step?.status === "completed" &&
          ["success", "failure"].includes(step.conclusion),
        "workflow-unverified",
        "The required execution step did not complete on the pinned runtime."
      );
      const text = await logs(`${prefix}/actions/jobs/${job.id}/logs`);
      const records = [
        ...text.matchAll(/COORDINATOR_SERVICE_RESULT:([A-Za-z0-9+/=]+)/gu)
      ];
      serviceAssert(
        records.length === 1,
        "result-unverified",
        "The workflow has missing or ambiguous result evidence."
      );
      let report;
      try {
        report = JSON.parse(
          Buffer.from(records[0][1], "base64").toString("utf8")
        );
      } catch {
        throw new ServiceError(
          "result-unverified",
          "The workflow result is unreadable."
        );
      }
      verifyServiceReport(report, attempt.plan, attempt.id);
      serviceAssert(
        String(report.runner?.run_id) === String(run.id) &&
          report.runner?.commit === runtime.commit &&
          report.runner?.attempt === 1,
        "result-unverified",
        "The report runner identity differs from GitHub."
      );
      if (report.status === "passed")
        serviceAssert(
          run.conclusion === "success" &&
            job.conclusion === "success" &&
            job.steps.every(
              (s) => s.status === "completed" && s.conclusion === "success"
            ),
          "result-unverified",
          "A required workflow step did not pass."
        );
      return {
        report,
        workflow: {
          id: run.id,
          attempt: 1,
          job_id: job.id,
          url: run.html_url,
          commit: run.head_sha,
          conclusion: run.conclusion
        }
      };
    }
  };
}
