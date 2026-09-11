import { randomUUID } from "node:crypto";
import { loggedStep, runEvent, logOutcome } from "./run-log.mjs";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sandboxProfile } from "./profiles.mjs";
import { buildServicePlan } from "./service-plan.mjs";
import { sandboxServiceRuntime } from "./service-runtime-config.mjs";
import { createServiceGitHub } from "./service-github.mjs";
import {
  serviceHash,
  ServiceError,
  serviceAssert,
  verifyServiceReport
} from "./service-contract.mjs";

export async function saveServiceReport(id, value, root = process.cwd()) {
  serviceAssert(
    /^[0-9a-f-]{36}$/u.test(id),
    "invalid-attempt",
    "Invalid service report identity."
  );
  let directory = root;
  for (const part of [".release-coordinator", "service-checks", "sandbox"]) {
    directory = path.join(directory, part);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = await lstat(directory);
    serviceAssert(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "report-unverified",
      "Service reports require owned local directories."
    );
  }
  const filename = path.join(directory, `${id}.json`),
    contents = JSON.stringify(value, null, 2) + "\n";
  try {
    await writeFile(filename, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await lstat(filename);
    serviceAssert(
      stat.isFile() &&
        !stat.isSymbolicLink() &&
        (await readFile(filename, "utf8")) === contents,
      "report-unverified",
      "Existing service evidence differs; it was not overwritten."
    );
  }
  return filename;
}

export async function runServiceAttempt(
  plan,
  {
    previous,
    save,
    guard,
    client,
    signal,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxPolls = 120,
    pollMs = 5000,
    uuid = randomUUID,
    now = () => new Date().toISOString()
  }
) {
  const identity = await client.identity();
  let attempt = previous
    ? structuredClone(previous)
    : {
        id: uuid(),
        plan_hash: plan.fingerprint,
        plan,
        ...identity,
        state: "prepared",
        created_at: now(),
        workflow_run_id: null
      };
  serviceAssert(
    attempt.plan_hash === plan.fingerprint &&
      serviceHash(attempt.plan) === serviceHash(plan),
    "attempt-unverified",
    "Saved service attempt inputs changed."
  );
  if (!previous) await save(attempt);
  if (attempt.state === "prepared") {
    attempt.state = "dispatching";
    await save(attempt); // Lost POST responses never cause another dispatch.
    await guard();
    signal?.throwIfAborted();
    try {
      const dispatched = await loggedStep(
        {
          step: "services.dispatch",
          attempt_id: attempt.id,
          repository: plan.runtime?.repository,
          workflow_id: attempt.workflow_id,
          message:
            "Request the saved service workflow once; its result will be reconciled separately."
        },
        () => client.dispatch(attempt),
        () => ({
          message: "GitHub accepted dispatch; completion has not been verified."
        })
      );
      if (Number.isSafeInteger(dispatched?.workflow_run_id))
        attempt.workflow_run_id = dispatched.workflow_run_id;
    } catch {
      /* Reconcile by the saved unique attempt name. Do not repeat POST. */
    }
    await save(attempt);
  }
  return loggedStep(
    {
      step: "services.wait",
      attempt_id: attempt.id,
      repository: plan.runtime?.repository,
      workflow_id: attempt.workflow_run_id,
      message:
        "Find the saved workflow and wait for verified application results."
    },
    async () => {
      for (let poll = 0; poll < maxPolls; poll++) {
        signal?.throwIfAborted();
        await guard();
        if (!attempt.workflow_run_id) {
          const found = await client.find(attempt);
          if (found) {
            attempt.workflow_run_id = found.id;
            attempt.state = "running";
            await save(attempt);
            runEvent({
              step: "services.found",
              outcome: "succeeded",
              attempt_id: attempt.id,
              workflow_id: found.id,
              repository: plan.runtime?.repository,
              url: `https://github.com/${plan.runtime?.repository}/actions/runs/${found.id}`,
              message:
                "Found the workflow matching the saved attempt; no replacement was dispatched."
            });
          }
        }
        if (attempt.workflow_run_id) {
          const result = await client.result(attempt);
          if (result) {
            verifyServiceReport(result.report, plan, attempt.id);
            if (attempt.result)
              serviceAssert(
                serviceHash(attempt.result) === serviceHash(result),
                "result-unverified",
                "A previously recorded workflow result changed."
              );
            attempt.state = "completed";
            attempt.result = result;
            await save(attempt);
            // Remote step detail is observed after verified completion, not a live
            // heartbeat. Preserve source times separately from observation time.
            for (const step of result.report.steps)
              runEvent({
                step: "services.step",
                unit: step.unit,
                outcome: logOutcome(step.status),
                result_status: step.status,
                attempt_id: attempt.id,
                workflow_id: result.workflow.id,
                url: result.workflow.url,
                source_started_at: step.started_at,
                source_finished_at: step.finished_at,
                duration_ms:
                  step.started_at && step.finished_at
                    ? Math.max(
                        0,
                        Date.parse(step.finished_at) -
                          Date.parse(step.started_at)
                      )
                    : undefined,
                message:
                  "Observed this service step in the verified workflow report."
              });
            runEvent({
              step: "services.cleanup",
              outcome: logOutcome(result.report.cleanup?.status),
              cleanup_status: result.report.cleanup?.status,
              attempt_id: attempt.id,
              workflow_id: result.workflow.id,
              url: result.workflow.url,
              message:
                result.report.cleanup?.status === "removed"
                  ? "The verified report confirms temporary service/database cleanup."
                  : "Service/database cleanup is incomplete or unknown; inspect the saved workflow."
            });
            return attempt;
          }
        }
        if (poll + 1 < maxPolls) await wait(pollMs);
      }
      throw new ServiceError(
        "workflow-pending",
        "The saved sandbox attempt has no complete result yet. Recheck it; do not dispatch it again."
      );
    },
    (attempt) => ({
      outcome: logOutcome(attempt.result.report.status),
      result_status: attempt.result.report.status,
      workflow_id: attempt.result.workflow.id,
      url: attempt.result.workflow.url
    })
  );
}

export function serviceDecision(decision, result) {
  const next = structuredClone(decision);
  next.services = result;
  if (["not-run", "passed"].includes(result.status)) return next;
  const mismatch = result.code === "database-declaration-mismatch";
  const code = mismatch
    ? result.code
    : result.code === "database-unverified"
      ? "database-unverified"
      : result.status === "blocked"
        ? "service-checks-failed"
        : result.status === "stale"
          ? "service-checks-stale"
          : "service-checks-unverified";
  const action = mismatch
    ? "Submit a corrected request with the database change declared; preserve this receipt."
    : result.code === "database-unverified"
      ? "Confirm the database answer and inspection coverage. If the saved answer needs changing, submit a corrected request without editing this receipt; rerun after the missing information is resolved."
      : result.status === "blocked"
        ? "Correct the recorded sample failure and submit new exact code when needed."
        : "Resolve the recorded missing evidence or runtime problem and rerun inbox:run to reconcile the saved attempt.";
  const owner =
    mismatch || result.status === "blocked"
      ? "Submitter"
      : "Coordinator maintainers";
  next.reasons.push({ code, message: result.message, action, owner });
  if (next.status !== "action-needed")
    next.status = result.status === "blocked" ? "action-needed" : "waiting";
  next.next_action = [...new Set(next.reasons.map((r) => r.action))].join(" ");
  next.action_owner = [...new Set(next.reasons.map((r) => r.owner))].join("; ");
  if (owner === "Submitter") next.submitter_action = action;
  return next;
}

export async function coordinateServices({
  entry,
  rehearsal,
  profile,
  decision,
  attempts,
  saveAttempt,
  guard,
  signal,
  verifyInputs,
  runtime = sandboxServiceRuntime,
  client,
  execute = runServiceAttempt,
  saveReport = saveServiceReport
}) {
  let result;
  if (profile !== sandboxProfile || rehearsal?.report?.status !== "pass")
    return {
      decision,
      result: {
        status: "not-run",
        message: "Service execution requires a fresh passing sandbox rehearsal."
      }
    };
  try {
    const plan = await loggedStep(
      {
        step: "services.plan",
        issue_number: entry.issue_number,
        message: "Inspect the sample scope and declared database answer."
      },
      () => buildServicePlan(entry, rehearsal.report, profile, runtime)
    );
    serviceAssert(
      await verifyInputs(),
      "inputs-stale",
      "Ticket, PR gates, or destination changed before sample execution.",
      "stale"
    );
    client ??= createServiceGitHub({ profile, runtime });
    const attempt = await execute(plan, {
      previous: attempts[plan.fingerprint],
      save: saveAttempt,
      guard,
      client,
      signal
    });
    const report = verifyServiceReport(attempt.result.report, plan, attempt.id);
    serviceAssert(
      await verifyInputs(),
      "inputs-stale",
      "Ticket, PR gates, or destination changed during sample execution.",
      "stale"
    );
    const reportFile = await saveReport(attempt.id, attempt.result);
    result = {
      status: report.status,
      message:
        report.status === "passed"
          ? "The exact sandbox database, services, and frontend checks passed. The ticket still waits; no product release occurred."
          : report.errors.map((e) => e.message).join(" "),
      code: report.errors[0]?.code ?? null,
      plan_hash: plan.fingerprint,
      database: plan.database,
      steps: report.steps.map(
        ({ started_at: _start, finished_at: _end, ...step }) => step
      ),
      baseline: report.baseline,
      database_state: report.database_state,
      cleanup: report.cleanup,
      workflow: attempt.result.workflow
    };
    return {
      decision: serviceDecision(decision, result),
      result: { ...result, report_file: reportFile }
    };
  } catch (error) {
    if (error.service_journal_failure) throw error;
    result = {
      ...(error instanceof ServiceError && error.database
        ? { database: error.database }
        : {}),
      status: error instanceof ServiceError ? error.status : "unknown",
      code:
        error instanceof ServiceError
          ? error.code
          : "service-checks-unverified",
      message:
        error instanceof ServiceError
          ? error.message
          : "Service execution or durable evidence could not be verified; reconcile the saved attempt."
    };
    return { decision: serviceDecision(decision, result), result };
  }
}
