import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { processInbox } from "../src/inbox-processor.mjs";
import { coordinateInboxBatch } from "../src/inbox-batch.mjs";
import {
  executeRelease,
  releaseTicketResult
} from "../src/release-execution.mjs";
import {
  makeReleaseOperation,
  releaseProtocol,
  verifyReleaseReport
} from "../src/release-contract.mjs";
import { makeReleasePlan } from "../src/release-plan.mjs";
import { serviceHash } from "../src/service-contract.mjs";
import { legacyBatchPolicy } from "../src/batch-plan.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import { harness } from "./inbox-batch-harness.mjs";
import {
  isReleaseRequestTarget,
  releaseEnvironmentsForTarget
} from "../src/release-target.mjs";
import { validateBatchHistory } from "../src/batch-state.mjs";
import { validateReleaseExecution } from "../src/release-state.mjs";
import { batchStatuses } from "../src/ticket-presentation.mjs";
import { inboxRunExitCode } from "../src/inbox-run-cli.mjs";

const runFile = promisify(execFile);

function report(record, status = "passed", runId = 100) {
  const runnerRole =
    record.operation.operation === "e2e" ? "backend" : record.operation.role;
  const value = {
    protocol: releaseProtocol,
    profile: "sandbox",
    release_id: record.operation.release_id,
    operation_id: record.operation.operation_id,
    operation_hash: record.operation.fingerprint,
    operation: record.operation.operation,
    environment: record.operation.environment,
    role: record.operation.role,
    unit: record.operation.unit,
    status,
    checks: [{ name: "fixture", status }],
    versions: {
      backend: record.operation.backend_commit,
      frontend: record.operation.frontend_commit
    },
    runner: {
      repository: sandboxProfile.repositories[runnerRole].full_name,
      run_id: runId,
      attempt: 1,
      commit: record.operation[`${runnerRole}_commit`]
    },
    completed_at: new Date().toISOString()
  };
  verifyReleaseReport(value, record.operation);
  return value;
}

function client(calls, { failE2e = false } = {}) {
  let runId = 100;
  return {
    identity: async () => ({
      actor: { id: "456", login: "tester" },
      runtime: {
        backend: { workflow_id: 201 },
        frontend: { workflow_id: 202 }
      },
      versions: {
        staging: { backend: "b".repeat(40), frontend: "b".repeat(40) },
        prod: { backend: "b".repeat(40), frontend: "b".repeat(40) }
      }
    }),
    integrate: async ({ record, candidate }) => {
      calls.push(record.step.id);
      return {
        status: "passed",
        commit: candidate.commit,
        tree: candidate.tree,
        url: "https://example.invalid/integration"
      };
    },
    run: async ({ record }) => {
      calls.push(record.step.id);
      const status =
        failE2e && record.step.id === "staging:e2e" ? "failed" : "passed";
      const value = report(record, status, runId++);
      return {
        status,
        report: value,
        workflow: {
          id: value.runner.run_id,
          url: `https://example.invalid/release/${value.runner.run_id}`
        }
      };
    }
  };
}

async function selectedBatch() {
  const h = harness(1);
  await processInbox(h.options);
  const reference = Object.values(h.f.state().history.batches)[0];
  const batch = structuredClone(h.f.file(reference.path).record);
  delete batch.execution;
  return batch;
}

test("one release runs backend integration/services, frontend, then matching E2E", async () => {
  const batch = await selectedBatch();
  const calls = [];
  const saves = [];
  const execution = await executeRelease({
    batch,
    client: client(calls),
    guard: async () => {},
    save: async (message) => saves.push(message)
  });
  assert.equal(execution.status, "completed");
  assert.deepEqual(calls, [
    "staging:integrate:backend",
    "staging:deploy:backend:dbMigrationsLoop",
    "staging:deploy:backend:worker",
    "staging:deploy:backend:api",
    "staging:integrate:frontend",
    "staging:deploy:frontend:frontend",
    "staging:e2e"
  ]);
  assert.ok(saves.length > calls.length);
});

test("failed staging E2E stops a production request before prod", async () => {
  const batch = await selectedBatch();
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  const calls = [];
  const execution = await executeRelease({
    batch,
    client: client(calls, { failE2e: true }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(calls.at(-1), "staging:e2e");
  assert.equal(
    calls.some((value) => value.startsWith("prod:")),
    false
  );
});

test("a lost save response cannot bypass failed staging E2E on resume", async () => {
  const batch = await selectedBatch();
  for (const input of batch.inputs) input.target = "production";
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  const calls = [];
  let lost = false;
  await assert.rejects(
    executeRelease({
      batch,
      client: client(calls, { failE2e: true }),
      guard: async () => {},
      save: async (message) => {
        if (!lost && message === "release step staging:e2e operation") {
          lost = true;
          throw new Error("save response lost");
        }
      }
    }),
    /save response lost/u
  );
  const execution = await executeRelease({
    batch,
    client: client(calls, { failE2e: true }),
    guard: async () => {},
    save: async () => {}
  });
  assert.equal(execution.status, "needs-human");
  assert.equal(calls.at(-1), "staging:e2e");
  assert.equal(
    calls.some((value) => value.startsWith("prod:")),
    false
  );
});

test("request targets have one validated staging-to-production mapping", () => {
  assert.equal(isReleaseRequestTarget("staging"), true);
  assert.equal(isReleaseRequestTarget("production"), true);
  assert.equal(isReleaseRequestTarget("prod"), false);
  assert.deepEqual(releaseEnvironmentsForTarget("staging"), ["staging"]);
  assert.deepEqual(releaseEnvironmentsForTarget("production"), [
    "staging",
    "prod"
  ]);
  assert.throws(
    () => releaseEnvironmentsForTarget("prod"),
    /must be staging or production/u
  );
});

test("a new unchanged role needs base-tree proof while a saved old plan remains readable", async () => {
  const batch = await selectedBatch();
  const publication = batch.attempts
    .find((attempt) => attempt.phase === "git")
    .result.publications.find(({ role }) => role === "frontend");
  const checked = batch.attempts.find((attempt) => attempt.phase === "checks");
  checked.progress.prs = checked.progress.prs.filter(
    ({ role }) => role !== "frontend"
  );
  publication.patch = [];
  publication.tree = publication.base_tree;
  const savedPlan = makeReleasePlan(batch);
  delete publication.base_tree;
  assert.throws(
    () => makeReleasePlan(batch),
    /candidate commit is unavailable/u
  );
  batch.execution = { plan: savedPlan };
  assert.doesNotThrow(() => makeReleasePlan(batch));
});

test("a resumed completed release adds a complete batch ticket result", async () => {
  const batch = await selectedBatch();
  const deferredInput = structuredClone(batch.inputs[0]);
  deferredInput.number = 2;
  deferredInput.input.inbox.issue_number = 2;
  const terminalInput = structuredClone(batch.inputs[0]);
  terminalInput.number = 3;
  terminalInput.input.inbox.issue_number = 3;
  batch.inputs.push(deferredInput, terminalInput);
  batch.fingerprint = serviceHash({
    inputs: batch.inputs,
    policy: batch.policy
  });
  batch.execution = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  const item = {
    number: 1,
    decision: {
      status: "waiting",
      reasons: [
        {
          code: "coordinator-incomplete",
          message: "Waiting for release execution.",
          action: "Continue the Coordinator.",
          owner: "Coordinator"
        }
      ],
      next_action: "Continue the Coordinator.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const deferred = {
    number: 2,
    decision: structuredClone(item.decision)
  };
  const terminalDecision = {
    ...structuredClone(item.decision),
    status: "completed",
    next_action: "No further action is required.",
    action_owner: "None"
  };
  const completed = { number: 3, decision: structuredClone(terminalDecision) };
  const state = { batches: { [batch.fingerprint]: batch } };
  await coordinateInboxBatch({
    items: [item, deferred, completed],
    state,
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    save: async () => {},
    loadBatch: async () => batch,
    release: async () => assert.fail("completed release must not run again")
  });
  assert.equal(item.decision.status, "completed");
  assert.equal(item.decision.batch.status, "passed");
  assert.equal(item.decision.batch.fingerprint, batch.fingerprint);
  assert.deepEqual(item.decision.batch.selected, batch.selected);
  assert.ok(item.decision.batch.evidence.length > 0);
  assert.match(item.decision.reasons.at(-1).message, /passed staging/u);
  assert.equal(item.decision.batch.release.status, "completed");
  assert.deepEqual(Object.keys(item.decision.batch).sort(), [
    "code",
    "evidence",
    "fingerprint",
    "message",
    "release",
    "selected",
    "status"
  ]);
  assert.equal(deferred.decision.status, "waiting");
  assert.equal(deferred.decision.batch.code, "batch-deferred");
  assert.deepEqual(completed.decision, terminalDecision);
});

test("a resumed empty batch stays a no-candidate result", async () => {
  const batch = await selectedBatch();
  batch.selected = [];
  const result = await coordinateInboxBatch({
    items: [],
    state: { batches: { [batch.fingerprint]: batch } },
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    save: async () => {},
    loadBatch: async () => batch,
    release: async () => assert.fail("an empty batch must not start a release")
  });
  assert.equal(result.status, "no-candidate");
  assert.deepEqual(result.selected, []);
  batch.execution = { status: "needs-human" };
  assert.throws(
    () => validateBatchHistory({ [batch.fingerprint]: batch }, sandboxProfile),
    /Only a selected v2 batch can own release execution/u
  );
});

for (const { cleanup, name } of [
  {
    cleanup: "pending",
    name: "an interrupted v1 batch cleans pending work before retirement"
  },
  {
    cleanup: "removed",
    name: "a v1 batch copies a saved cleanup result before retirement"
  }
])
  test(name, async () => {
    const batch = await selectedBatch();
    batch.inputs = batch.inputs.map(({ number, input }) => ({ number, input }));
    batch.policy = structuredClone(legacyBatchPolicy);
    batch.fingerprint = serviceHash({
      inputs: batch.inputs,
      policy: batch.policy
    });
    batch.status = "searching";
    batch.selected = [];
    delete batch.execution;
    const interrupted = batch.attempts.find(
      (attempt) => attempt.phase === "checks"
    );
    delete interrupted.result;
    interrupted.progress.cleanup = cleanup;
    for (const pr of interrupted.progress.prs) pr.cleanup = cleanup;
    const attemptIds = batch.attempts.map((attempt) => attempt.id);
    const item = {
      number: batch.inputs[0].number,
      entry: {
        issue_number: batch.inputs[0].number,
        request: { target: "staging", database_change: "no" }
      },
      input: batch.inputs[0].input,
      decision: {
        status: "waiting",
        reasons: [],
        next_action: "Continue.",
        action_owner: "Coordinator",
        submitter_action: "None currently required."
      }
    };
    const state = { batches: { [batch.fingerprint]: batch } };
    const saves = [];
    let cleanupCalls = 0;
    const result = await coordinateInboxBatch({
      items: [item],
      state,
      run: { batch_fingerprint: batch.fingerprint },
      profile: sandboxProfile,
      guard: async () => {},
      save: async (message) => saves.push(message),
      verify: async () => assert.fail("v1 retirement starts no new checks"),
      loadBatch: async () => batch,
      prepare: async () => assert.fail("v1 retirement starts no new Git work"),
      check: async (_prepared, options) => {
        cleanupCalls++;
        assert.equal(options.id, interrupted.id);
        assert.equal(options.previous.cleanup, cleanup);
        assert.equal(options.policy.version, "sandbox-batch-v1");
        const progress = structuredClone(options.previous);
        if (cleanup === "pending") {
          progress.cleanup = "removed";
          for (const pr of progress.prs) pr.cleanup = "removed";
          progress.result = {
            status: "stale",
            kind: "policy",
            message: "Retired v1 trial."
          };
          await options.save(progress);
        } else assert.equal(progress.result.status, "passed");
        return progress.result;
      },
      revalidate: async () => {},
      release: async () => assert.fail("v1 evidence must not start a release")
    });
    const saved = state.batches[batch.fingerprint];
    assert.equal(result.status, "no-candidate");
    assert.deepEqual(result.selected, []);
    assert.deepEqual(
      saved.attempts.map((attempt) => attempt.id),
      attemptIds
    );
    assert.equal(saved.policy.version, "sandbox-batch-v1");
    assert.equal(saved.status, "finished");
    assert.deepEqual(saved.selected, []);
    assert.equal(saved.stop.status, "stale");
    assert.match(saved.stop.message, /fresh command to create a v2 batch/u);
    assert.equal(item.decision.batch.code, "batch-deferred");
    assert.equal(cleanupCalls, 1);
    assert.equal(
      saved.attempts.find((attempt) => attempt.id === interrupted.id).progress
        .cleanup,
      "removed"
    );
    assert.ok(saves.includes("retire recovered v1 batch"));
    assert.doesNotThrow(() =>
      validateBatchHistory({ [saved.fingerprint]: saved }, sandboxProfile)
    );
    const untrusted = structuredClone(saved);
    untrusted.policy.max_check_attempts++;
    untrusted.fingerprint = serviceHash({
      inputs: untrusted.inputs,
      policy: untrusted.policy
    });
    assert.throws(
      () =>
        validateBatchHistory(
          { [untrusted.fingerprint]: untrusted },
          sandboxProfile
        ),
      /not a trusted Coordinator policy/u
    );
  });

test("completed release history requires every exact operation and report", async () => {
  const batch = await selectedBatch();
  const execution = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  assert.doesNotThrow(() => validateReleaseExecution(execution, batch));

  const arrayVersions = structuredClone(execution);
  arrayVersions.versions = [];
  assert.throws(
    () => validateReleaseExecution(arrayVersions, batch),
    /Invalid sandbox release execution state/u
  );

  const missingStep = structuredClone(execution);
  delete missingStep.operations[execution.plan.steps[0].id];
  assert.throws(
    () => validateReleaseExecution(missingStep, batch),
    /Completed release position has no saved passing result/u
  );

  const failedStep = structuredClone(execution);
  failedStep.operations[execution.plan.steps[0].id].result.status = "failed";
  assert.throws(
    () => validateReleaseExecution(failedStep, batch),
    /Completed release position has no saved passing result/u
  );

  const checkedStep = execution.plan.steps.find(
    (step) => step.kind === "deploy"
  );
  const missingOperation = structuredClone(execution);
  delete missingOperation.operations[checkedStep.id].operation;
  assert.throws(
    () => validateReleaseExecution(missingOperation, batch),
    /lacks its exact operation or report/u
  );

  const missingReport = structuredClone(execution);
  delete missingReport.operations[checkedStep.id].result.report;
  assert.throws(
    () => validateReleaseExecution(missingReport, batch),
    /lacks its exact operation or report/u
  );
});

test("a malformed resumed run scope fails with a controlled error", async () => {
  await assert.rejects(
    processInbox({
      identity: async () => ({ id: "456", login: "tester" }),
      resume: "11111111-1111-4111-8111-111111111111",
      journal: {
        acquire: async () => ({
          state: {},
          run: {
            run_id: "11111111-1111-4111-8111-111111111111",
            scope: undefined
          }
        })
      }
    }),
    (error) => error.code === "run-scope"
  );
});

test("a terminal failed release is not adopted by the next unscoped run", async () => {
  let saves = 0;
  await assert.rejects(
    processInbox({
      identity: async () => ({ id: "456", login: "tester" }),
      profile: sandboxProfile,
      rehearsal: async () => {},
      batch: async () => {},
      journal: {
        acquire: async () => ({
          state: {
            lock: {},
            batches: {
              failed: {
                fingerprint: "f".repeat(64),
                policy: { version: "sandbox-batch-v2" },
                status: "finished",
                selected: [1],
                attempts: [],
                execution: { status: "needs-human" }
              }
            }
          },
          run: {
            run_id: "11111111-1111-4111-8111-111111111111",
            scope: {
              issue_number: null,
              close_test: false,
              workflow: "inbox-run-v6"
            }
          }
        }),
        save: async () => saves++
      },
      loadInbox: async () => {
        throw new Error("continued to the next inbox scan");
      }
    }),
    /continued to the next inbox scan/u
  );
  assert.equal(saves, 0);
});

test("a stale batch cannot start release execution", async () => {
  const batch = await selectedBatch();
  batch.stop = {
    status: "stale",
    kind: "evidence",
    message: "The saved main commit changed."
  };
  const item = {
    number: batch.selected[0],
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const result = await coordinateInboxBatch({
    items: [item],
    state: { batches: { [batch.fingerprint]: batch } },
    run: { batch_fingerprint: batch.fingerprint },
    profile: sandboxProfile,
    save: async () => {},
    loadBatch: async () => batch,
    release: async () => assert.fail("a stale batch must not call release")
  });
  assert.equal(result.status, "release-unverified");
  assert.equal(item.decision.status, "waiting");
  assert.equal(item.decision.batch.status, "stale");
  await assert.rejects(
    executeRelease({
      batch,
      client: {
        identity: async () => assert.fail("must stop before identity")
      },
      guard: async () => {},
      save: async () => {}
    }),
    /stale batch cannot start/u
  );
});

test("a stale batch cannot project a completed release onto its ticket", async () => {
  const batch = await selectedBatch();
  batch.execution = await executeRelease({
    batch,
    client: client([]),
    guard: async () => {},
    save: async () => {}
  });
  batch.stop = {
    status: "stale",
    kind: "evidence",
    message: "The saved main commit changed."
  };
  const result = releaseTicketResult(batch, batch.selected[0]);
  assert.equal(result.status, "waiting");
  assert.equal(result.code, "release-unverified");
  const item = {
    number: batch.selected[0],
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const coordinate = () =>
    coordinateInboxBatch({
      items: [item],
      state: { batches: { [batch.fingerprint]: batch } },
      run: { batch_fingerprint: batch.fingerprint },
      profile: sandboxProfile,
      save: async () => {},
      loadBatch: async () => batch,
      release: async () => assert.fail("terminal release must not run again")
    });
  await coordinate();
  await coordinate();
  assert.equal(item.decision.status, "waiting");
  assert.equal(item.decision.batch.status, "stale");
  assert.equal(batchStatuses.includes(item.decision.batch.status), true);
  assert.deepEqual(
    item.decision.reasons.map(({ code }) => code),
    ["batch-deferred", "release-unverified"]
  );
  assert.equal(
    inboxRunExitCode({
      requests: [
        {
          applied: true,
          status: item.decision.status,
          rehearsal: { status: "passed" },
          batch: item.decision.batch
        }
      ]
    }),
    3
  );
  assert.doesNotThrow(() =>
    validateBatchHistory({ [batch.fingerprint]: batch }, sandboxProfile)
  );
});

test("a needs-human release projects one stable failure reason", async () => {
  const batch = await selectedBatch();
  batch.execution = await executeRelease({
    batch,
    client: client([], { failE2e: true }),
    guard: async () => {},
    save: async () => {}
  });
  const item = {
    number: batch.selected[0],
    decision: {
      status: "waiting",
      reasons: [],
      next_action: "Continue.",
      action_owner: "Coordinator",
      submitter_action: "None currently required."
    }
  };
  const coordinate = () =>
    coordinateInboxBatch({
      items: [item],
      state: { batches: { [batch.fingerprint]: batch } },
      run: { batch_fingerprint: batch.fingerprint },
      profile: sandboxProfile,
      save: async () => {},
      loadBatch: async () => batch,
      release: async () => assert.fail("terminal release must not run again")
    });
  await coordinate();
  await coordinate();
  assert.equal(item.decision.status, "action-needed");
  assert.deepEqual(
    item.decision.reasons.map(({ code }) => code),
    ["release-failed"]
  );
});

test("an unfinished release cannot produce a successful command exit", () => {
  assert.equal(
    inboxRunExitCode({
      requests: [
        {
          applied: true,
          status: "waiting",
          rehearsal: { status: "passed" },
          batch: {
            status: "passed",
            release: { status: "running" }
          }
        }
      ]
    }),
    1
  );
});

test("release operation/report are exact and reject changed versions", () => {
  const operation = makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: "e2e",
    environment: "staging",
    backend_commit: "a".repeat(40),
    frontend_commit: "b".repeat(40)
  });
  const record = { operation };
  const exact = report(record);
  assert.equal(exact.status, "passed");
  assert.equal(exact.role, null);
  assert.equal(exact.unit, null);
  assert.throws(
    () => verifyReleaseReport({ ...exact, role: "backend" }, operation),
    /does not match/u
  );
  for (const field of ["run_id", "attempt"])
    assert.throws(
      () =>
        verifyReleaseReport(
          {
            ...exact,
            runner: { ...exact.runner, [field]: String(exact.runner[field]) }
          },
          operation
        ),
      /does not match/u
    );
  assert.throws(
    () =>
      verifyReleaseReport(
        {
          ...report(record),
          versions: { backend: "c".repeat(40), frontend: "b".repeat(40) }
        },
        operation
      ),
    /does not match/
  );
});

test("sandbox runner exercises the exact backend/frontend combination", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "release-runner-"));
  const files = sampleFiles();
  for (const role of ["backend", "frontend"])
    for (const [name, contents] of Object.entries(files[role])) {
      const location = path.join(directory, "candidates", role, name);
      await mkdir(path.dirname(location), { recursive: true });
      await writeFile(location, contents);
    }
  const operation = makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: "e2e",
    environment: "staging",
    backend_commit: "a".repeat(40),
    frontend_commit: "b".repeat(40)
  });
  const script = fileURLToPath(
    new URL("../sandbox/release-run.mjs", import.meta.url)
  );
  const result = await runFile(process.execPath, [script], {
    cwd: directory,
    env: {
      ...process.env,
      OPERATION_ID: operation.operation_id,
      OPERATION_JSON: JSON.stringify(operation),
      GITHUB_REPOSITORY: sandboxProfile.repositories.backend.full_name,
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_SHA: operation.backend_commit
    }
  });
  assert.match(result.stdout, /COORDINATOR_RELEASE_RESULT:/u);

  await writeFile(
    path.join(directory, "candidates/backend/src/worker.mjs"),
    'export function run() { throw new Error("a".repeat(499) + "😀tail"); }\n'
  );
  let failed;
  try {
    await runFile(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        OPERATION_ID: operation.operation_id,
        OPERATION_JSON: JSON.stringify(operation),
        GITHUB_REPOSITORY: sandboxProfile.repositories.backend.full_name,
        GITHUB_RUN_ID: "124",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_SHA: operation.backend_commit
      }
    });
  } catch (error) {
    failed = error;
  }
  assert.equal(failed?.code, 1);
  const encoded = failed.stdout.match(/COORDINATOR_RELEASE_RESULT:(\S+)/u)?.[1];
  assert.ok(encoded, "expected sandbox release result marker");
  const failedReport = JSON.parse(Buffer.from(encoded, "base64url"));
  assert.equal(failedReport.checks[0].message, "a".repeat(499));
});
