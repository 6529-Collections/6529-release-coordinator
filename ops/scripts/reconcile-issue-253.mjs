// One-time, exact-state correction for the stopped real-product run on Issue
// #253. --check is read-only; --apply requires the same complete preflight.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createCoordinatorGitHub } from "../../apps/coordinator/src/coordinator-github.mjs";
import { createGitHubReader } from "../../apps/coordinator/src/github-reader.mjs";
import {
  createJournal,
  inboxWorkflow
} from "../../apps/coordinator/src/inbox-journal.mjs";
import { inspectIssue } from "../../apps/coordinator/src/inbox-reader.mjs";
import { presentRunTicket } from "../../apps/coordinator/src/inbox-ticket-writer.mjs";
import { stopStaleE2e } from "../../apps/coordinator/src/manual-stale-stop.mjs";
import { realProfile } from "../../apps/coordinator/src/profiles.mjs";
import { response } from "../../apps/coordinator/src/ticket-presentation.mjs";

const runFile = promisify(execFile);
const expected = Object.freeze({
  head: "a068b3f203d8d2d02f66ff52dc078a6feafa96a8",
  run: "d0194c08-e739-4d95-aab3-ff7ec45539e4",
  fingerprint:
    "e984346d2a546a7188f0d84c7868827f70213b17dab6cc7d7c3c9e674d9fb314",
  request: "dc1e7905-b2c9-4d32-8d0b-54784dc7bd75",
  commit: "c35be6bc5c4fc17925f3e3f69e687acbcac7c5b2",
  deployRun: 36400157350,
  e2eRun: 36401207046,
  externalBackendRun: 36402149030
});

async function github(pathname) {
  const { stdout } = await runFile("gh", ["api", pathname], {
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024
  });
  return JSON.parse(stdout);
}

async function preflight() {
  const client = createCoordinatorGitHub({ profile: realProfile });
  const journal = createJournal(client.request, realProfile, {
    workflow: inboxWorkflow
  });
  const actor = await client.identity();
  assert.deepEqual(actor, { id: "209783236", login: "simo6529" });
  const saved = await journal.read();
  assert.equal(
    saved.sha,
    expected.head,
    "Journal head moved; inspect it before any write."
  );
  assert.equal(saved.state.lock?.run_id, expected.run);
  assert.deepEqual(saved.state.lock?.ticket_numbers, [253]);
  assert.deepEqual(saved.state.lock?.scope?.selection, {
    mode: "filtered",
    issue_numbers: [253],
    actor_login: "simo6529"
  });
  assert.equal(saved.state.lock?.batch_fingerprint, expected.fingerprint);
  assert.equal(saved.state.tickets[253], undefined);
  const batch = saved.state.batches?.[expected.fingerprint];
  assert.deepEqual(batch?.selected, [253]);
  assert.equal(batch?.execution?.status, "running");
  assert.equal(
    batch.execution?.plan?.release_id,
    "6628dd05-c87c-4345-bd9d-9c56d6ac8b21"
  );
  assert.equal(batch.execution?.plan?.target, "production");
  assert.equal(
    batch.execution?.plan?.steps?.[batch.execution.step_index]?.id,
    "staging:e2e"
  );
  assert.equal(
    batch.execution?.operations?.["staging:e2e"]?.workflow_run_id,
    expected.e2eRun
  );
  assert.equal(
    batch.execution?.operations?.["staging:deploy:frontend:frontend"]?.result
      ?.workflow?.id,
    expected.deployRun
  );
  assert.equal(
    Object.keys(batch.execution.operations).some((id) =>
      id.startsWith("prod:")
    ),
    false
  );

  const issue = await response(client.request, "GET", "/issues/253");
  assert.equal(issue.state, "open");
  assert.deepEqual(
    issue.labels.map((label) => label.name).sort(),
    [
      "component:frontend",
      "release-request",
      "status:received",
      "target:production"
    ].sort()
  );
  const get = createGitHubReader({ profile: realProfile });
  const entry = await inspectIssue(issue, { get, profile: realProfile });
  assert.equal(entry.status, "valid", entry.errors.join("; "));
  assert.equal(entry.request.request_id, expected.request);
  assert.equal(entry.request.target, "production");
  assert.deepEqual(
    entry.request.release_parts.map((part) => part.repository),
    ["6529seize-frontend"]
  );
  assert.equal(
    entry.request.release_parts[0].pull_requests[0].commit,
    expected.commit
  );
  assert.deepEqual(entry.github_actor, { id: "209783236", login: "simo6529" });

  const logPath = path.join(
    os.homedir(),
    ".6529-release-coordinator",
    "logs",
    "real",
    "1346244762",
    `${expected.run}.jsonl`
  );
  const events = (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.equal(
    events.some(
      (event) =>
        event.run_id === expected.run &&
        event.step === "release.e2e" &&
        event.outcome === "unknown" &&
        event.error_code === "release-stale"
    ),
    true
  );
  assert.equal(events.at(-1).step, "run.finish");
  const [e2e, deployment, externalBackend, frontendStaging, backendStaging] =
    await Promise.all([
      github(
        `repos/6529-Collections/6529seize-frontend/actions/runs/${expected.e2eRun}`
      ),
      github(
        `repos/6529-Collections/6529seize-frontend/actions/runs/${expected.deployRun}`
      ),
      github(
        `repos/6529-Collections/6529seize-backend/actions/runs/${expected.externalBackendRun}`
      ),
      github(
        "repos/6529-Collections/6529seize-frontend/git/ref/heads/1a-staging"
      ),
      github(
        "repos/6529-Collections/6529seize-backend/git/ref/heads/1a-staging"
      )
    ]);
  for (const run of [e2e, deployment, externalBackend]) {
    assert.equal(run.status, "completed");
    assert.equal(run.conclusion, "success");
  }
  assert.equal(e2e.id, expected.e2eRun);
  assert.equal(deployment.id, expected.deployRun);
  assert.equal(deployment.head_sha, batch.execution.versions.staging.frontend);
  assert.equal(externalBackend.id, expected.externalBackendRun);
  assert.equal(externalBackend.head_branch, "1a-staging");
  assert.ok(
    Date.parse(externalBackend.created_at) < Date.parse(e2e.updated_at)
  );
  const observed = {
    backend: backendStaging.object.sha,
    frontend: frontendStaging.object.sha
  };
  assert.notEqual(observed.backend, batch.execution.versions.staging.backend);
  assert.notEqual(observed.frontend, batch.execution.versions.staging.frontend);
  return {
    actor,
    journal,
    saved,
    issue,
    entry,
    get,
    observed,
    e2e,
    api: client.request
  };
}

async function main() {
  assert.ok(["--check", "--apply"].includes(process.argv[2]));
  assert.equal(process.argv.length, 3);
  const context = await preflight();
  if (process.argv[2] === "--check") {
    process.stdout.write(
      JSON.stringify({
        ready: true,
        issue: 253,
        journal_head: expected.head,
        observed: context.observed
      }) + "\n"
    );
    return;
  }
  const { journal, actor, entry, issue, get, observed, e2e, api } = context;
  const { state, run } = await journal.acquire(actor, expected.run);
  const batch = state.batches[expected.fingerprint];
  const at = new Date().toISOString();
  const execution = stopStaleE2e(batch, {
    actor,
    observed,
    at,
    workflow: e2e
  });
  await journal.save(
    state,
    run,
    "reconcile stopped stale staging E2E for #253"
  );
  const action =
    "Inspect the stopped release and current environments. A new release requires fresh exact-head authorization and checks.";
  const decision = {
    status: "action-needed",
    reasons: [
      {
        code: "release-stopped",
        message: execution.message,
        action,
        owner: "Coordinator maintainers",
        evidence: {
          staging_deployment: `https://github.com/6529-Collections/6529seize-frontend/actions/runs/${expected.deployRun}`,
          staging_e2e: `https://github.com/6529-Collections/6529seize-frontend/actions/runs/${expected.e2eRun}`,
          external_backend_deployment: `https://github.com/6529-Collections/6529seize-backend/actions/runs/${expected.externalBackendRun}`,
          expected: execution.manual_stop.expected,
          observed
        }
      }
    ],
    next_action: action,
    action_owner: "Coordinator maintainers",
    submitter_action: "None currently required.",
    batch: {
      fingerprint: expected.fingerprint,
      status: "passed",
      code: "batch-selected",
      message:
        "The exact frontend candidate passed batch checks; release execution stopped at stale staging E2E acceptance.",
      selected: [253],
      evidence: [],
      release: {
        id: execution.plan.release_id,
        profile: "real",
        status: execution.status,
        target: "production",
        message: execution.message,
        operations: Object.values(execution.operations).map((operation) => ({
          id: operation.id,
          step: operation.step.id,
          status: operation.result?.status ?? operation.state,
          url: operation.result?.url ?? operation.result?.workflow?.url ?? null
        }))
      }
    }
  };
  let presentationError = null;
  try {
    await presentRunTicket(
      {
        number: 253,
        issue,
        entry,
        ticket: null,
        recordedTerminal: false,
        observation: {
          kind: "manual-stale-e2e-stop",
          run_id: expected.run,
          expected: execution.manual_stop.expected,
          observed,
          e2e_workflow_run_id: expected.e2eRun
        },
        decision
      },
      {
        api,
        journal,
        state,
        run,
        actor,
        now: () => new Date(),
        inspect: inspectIssue,
        get,
        profile: realProfile
      }
    );
  } catch (error) {
    presentationError = error;
  }
  try {
    await journal.release(state, run);
  } catch (error) {
    throw new Error(
      `Manual stop was saved, but the lock could not be released and ticket presentation may be incomplete. Inspect the journal and Issue #253 before further release work: ${error.message}`,
      { cause: error }
    );
  }
  if (presentationError)
    throw new Error(
      `Manual stop was saved and the lock released, but Issue #253 presentation failed. Inspect the journal and Issue before further release work: ${presentationError.message}`,
      { cause: presentationError }
    );
  const final = await journal.read();
  assert.equal(final.state.lock, null);
  assert.equal(
    final.state.batches[expected.fingerprint].execution.status,
    "needs-human"
  );
  assert.equal(
    final.state.tickets[253].applied,
    final.state.tickets[253].transitions.at(-1).id
  );
  process.stdout.write(
    JSON.stringify({
      issue: 253,
      journal_head: final.sha,
      status: "needs-human",
      lock_released: true
    }) + "\n"
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
