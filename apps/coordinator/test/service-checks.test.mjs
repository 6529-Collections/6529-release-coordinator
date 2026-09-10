import assert from "node:assert/strict";
import test from "node:test";
import { fixtureServicePlan, databaseCandidate } from "../sandbox/fixtures.mjs";
import { serviceFixture, serviceAdapter } from "./service-fixture.mjs";
import {
  executeServiceSteps,
  verifyServiceReport,
  validateServicePlan,
  serviceHash,
  blobHash,
  ServiceError
} from "../src/service-contract.mjs";
import {
  buildServicePlan,
  captureServiceSource
} from "../src/service-plan.mjs";
import {
  runServiceAttempt,
  coordinateServices,
  serviceDecision
} from "../src/inbox-services.mjs";
import { realProfile } from "../src/profiles.mjs";
import { validateJournal, inboxWorkflow } from "../src/inbox-journal.mjs";

const attemptId = "33333333-3333-4333-8333-333333333333";
const compile = (f) =>
  buildServicePlan(f.entry, f.report(), f.profile, f.runtime);
const decision = () => ({
  status: "waiting",
  reasons: [
    {
      code: "coordinator-incomplete",
      owner: "Coordinator maintainers",
      message: "Release execution unavailable",
      action: "Wait for implementation."
    }
  ],
  next_action: "Wait",
  action_owner: "Coordinator maintainers",
  submitter_action: "None"
});

test("missing source identity and final checkpoint failure remain explicit uncertainty", async () => {
  const malformed = fixtureServicePlan();
  delete malformed.sources.backend.repository;
  const { fingerprint: _fingerprint, ...contents } = malformed;
  malformed.fingerprint = serviceHash(contents);
  assert.throws(() => validateServicePlan(malformed), {
    code: "source-unverified"
  });
  const invalidStep = fixtureServicePlan();
  invalidStep.steps[0] = null;
  const { fingerprint: _oldFingerprint, ...invalidContents } = invalidStep;
  invalidStep.fingerprint = serviceHash(invalidContents);
  assert.throws(() => validateServicePlan(invalidStep), {
    code: "invalid-services"
  });
  const plan = fixtureServicePlan();
  const report = await executeServiceSteps(plan, serviceAdapter(), {
    attemptId,
    save: async (value) => {
      if (value.cleanup.status === "removed")
        throw new Error("disk unavailable");
    }
  });
  assert.equal(report.status, "unknown");
  assert.equal(report.errors.at(-1).code, "evidence-save-failed");
  verifyServiceReport(report, plan, attemptId);
});

test("SD-01/02: exact complete ticket produces ordered no-change and upgrade plans", () => {
  for (const yes of [false, true]) {
    const f = yes ? serviceFixture(databaseCandidate()) : serviceFixture();
    f.entry.request.database_change = yes ? "yes" : "no";
    const plan = compile(f);
    assert.equal(plan.database.observed, yes ? "yes" : "no");
    assert.deepEqual(
      plan.steps.map((s) => s.unit),
      ["dbMigrationsLoop", "worker", "api", "frontend"]
    );
    assert.deepEqual(validateServicePlan(plan), plan);
    assert.equal(compile(f).fingerprint, plan.fingerprint);
    f.entry.request.release_parts[0].pull_requests[0].commit = "e".repeat(40);
    assert.notEqual(compile(f).fingerprint, plan.fingerprint);
  }
});

test("SD-03: unknown, false no, missing change, and unsupported files hold before execution", () => {
  const f = serviceFixture();
  f.entry.request.database_change = "unknown";
  assert.throws(() => compile(f), { code: "database-unverified" });
  f.entry.request.database_change = "yes";
  assert.throws(() => compile(f), { code: "database-unverified" });
  const yes = serviceFixture(databaseCandidate());
  assert.throws(() => compile(yes), {
    code: "database-declaration-mismatch",
    status: "blocked"
  });
  const report = serviceFixture().report();
  report.repositories[0].service_source.changed_paths.push(
    "scripts/unknown-data-update.mjs"
  );
  assert.throws(
    () =>
      buildServicePlan(serviceFixture().entry, report, f.profile, f.runtime),
    { code: "database-unverified" }
  );
});

test("SD-04: omitted, cyclic, and reordered dependencies cannot execute", () => {
  const f = serviceFixture();
  f.entry.request.release_parts[0].deploy_units = ["api", "worker"];
  assert.throws(() => compile(f), { code: "invalid-services" });
  const plan = fixtureServicePlan();
  [plan.steps[0], plan.steps[1]] = [plan.steps[1], plan.steps[0]];
  const { fingerprint: _hash, ...contents } = plan;
  plan.fingerprint = serviceHash(contents);
  assert.throws(() => validateServicePlan(plan), { code: "invalid-services" });
  const cycle = serviceFixture();
  cycle.entry.request.release_parts[0].deploy_dependencies.push({
    before: "api",
    after: "worker"
  });
  assert.throws(() => compile(cycle), { code: "invalid-services" });
});

test("SD-05/06: failed database/API and timeout stop dependents and retain state before cleanup", async () => {
  for (const [fail, status] of [
    ["dbMigrationsLoop", "blocked"],
    ["api", "blocked"],
    ["worker", "unknown"]
  ]) {
    const plan = fixtureServicePlan(),
      adapter = serviceAdapter({ fail, status }),
      snapshots = [];
    const result = await executeServiceSteps(plan, adapter, {
      attemptId,
      save: async (value) => snapshots.push(structuredClone(value))
    });
    assert.equal(result.status, status);
    const index = result.steps.findIndex((step) => step.unit === fail);
    assert.ok(
      result.steps.slice(index + 1).every((step) => step.status === "not-run")
    );
    assert.equal(result.database_state.status, "verified");
    assert.equal(result.cleanup.status, "removed");
    assert.equal(snapshots.at(-2).cleanup.status, "pending");
    assert.deepEqual(verifyServiceReport(result, plan, attemptId), result);
  }
});

test("SD-08: baseline failure and wrong version are uncertainty, not a ticket code failure", async () => {
  for (const mode of [
    { baselineFails: true },
    { wrongVersion: true },
    { cleanupFails: true }
  ]) {
    const adapter = serviceAdapter(mode),
      result = await executeServiceSteps(fixtureServicePlan(), adapter, {
        attemptId
      });
    assert.equal(result.status, "unknown");
    if (mode.baselineFails)
      assert.deepEqual(adapter.calls, ["baseline", "cleanup"]);
    if (mode.wrongVersion) assert.equal(result.steps[1].status, "not-run");
  }
});

test("SD-08: forged passes, crossed inputs, missing steps and versions are rejected", async () => {
  const plan = fixtureServicePlan(),
    good = await executeServiceSteps(plan, serviceAdapter(), { attemptId });
  for (const mutate of [
    (v) => {
      v.plan_hash = "a".repeat(64);
    },
    (v) => {
      v.cleanup.status = "pending";
    },
    (v) => {
      v.steps.pop();
    },
    (v) => {
      v.steps[1].result.version = "wrong";
    },
    (v) => {
      v.steps[0].status = "not-run";
    },
    (v) => {
      v.database_state.status = "unknown";
    }
  ]) {
    const bad = structuredClone(good);
    mutate(bad);
    assert.throws(() => verifyServiceReport(bad, plan, attemptId));
  }
});

test("SD-07: a lost dispatch response is reconciled once and unchanged retries reuse verified evidence", async () => {
  const plan = compile(serviceFixture());
  let saved,
    dispatches = 0,
    result;
  const client = {
    identity: async () => ({
      actor: { id: "456", login: "trusted-user" },
      workflow_id: 12
    }),
    dispatch: async (attempt) => {
      dispatches++;
      result = {
        report: await executeServiceSteps(plan, serviceAdapter(), {
          attemptId: attempt.id
        }),
        workflow: { id: 99 }
      };
      throw Error("lost response");
    },
    find: async () => ({ id: 99 }),
    result: async () => result
  };
  const options = {
    client,
    save: async (value) => {
      saved = structuredClone(value);
    },
    guard: async () => {},
    maxPolls: 1
  };
  await runServiceAttempt(plan, options);
  const first = structuredClone(saved);
  await runServiceAttempt(plan, { ...options, previous: saved });
  assert.equal(dispatches, 1);
  assert.deepEqual(saved, first);
  const state = {
    schema: 1,
    repository: "6529-Collections/release-coordinator-test-inbox",
    revision: 1,
    workflow: inboxWorkflow,
    tickets: {},
    service_attempts: { [saved.plan_hash]: saved }
  };
  assert.equal(validateJournal(state, serviceFixture().profile), state);
  state.service_attempts[saved.plan_hash].plan.target = "production";
  assert.throws(() => validateJournal(state, serviceFixture().profile));
});

test("SD-07: ambiguous dispatch with no run never dispatches again", async () => {
  const plan = compile(serviceFixture());
  let saved,
    count = 0;
  const options = {
    client: {
      identity: async () => ({ actor: { id: "456" }, workflow_id: 12 }),
      dispatch: async () => {
        count++;
        throw Error("lost");
      },
      find: async () => null
    },
    save: async (value) => {
      saved = structuredClone(value);
    },
    guard: async () => {},
    maxPolls: 1
  };
  await assert.rejects(runServiceAttempt(plan, options), {
    code: "workflow-pending"
  });
  await assert.rejects(
    runServiceAttempt(plan, { ...options, previous: saved }),
    { code: "workflow-pending" }
  );
  assert.equal(count, 1);
});

test("SD-09: real profiles, cross-profile sources and modified blobs fail before effects", () => {
  const f = serviceFixture();
  assert.throws(
    () => buildServicePlan(f.entry, f.report(), realProfile, f.runtime),
    { code: "unsupported-profile" }
  );
  const plan = fixtureServicePlan();
  plan.sources.backend.files["src/worker.mjs"].text += "bad";
  const { fingerprint: _hash, ...contents } = plan;
  plan.fingerprint = serviceHash(contents);
  assert.throws(() => validateServicePlan(plan), { code: "source-unverified" });
  assert.notEqual(blobHash("hello"), blobHash("hello\n"));
});

test("source capture failures remain separate from Git rehearsal evidence", async () => {
  const snapshot = await captureServiceSource(
    {
      files: async () => {
        throw Error("symlink");
      }
    },
    { role: "backend", destination: { commit: "a".repeat(40) } },
    "b".repeat(40)
  );
  assert.match(snapshot.error, /supported sandbox application/);
});

test("ticket outcomes keep sandbox passes waiting and show mismatch ownership", () => {
  const passed = serviceDecision(decision(), {
    status: "passed",
    message: "Passed"
  });
  assert.equal(passed.status, "waiting");
  const mismatch = serviceDecision(decision(), {
    status: "blocked",
    code: "database-declaration-mismatch",
    message: "False no"
  });
  assert.equal(mismatch.status, "action-needed");
  assert.match(mismatch.submitter_action, /corrected request/);
  const unknown = serviceDecision(decision(), {
    status: "unknown",
    code: "database-unverified",
    message: "Answer needs confirmation"
  });
  assert.equal(unknown.status, "waiting");
  assert.match(unknown.next_action, /corrected request/);
  assert.doesNotMatch(unknown.next_action, /saved attempt/);
});

test("inputs moving during service execution cannot publish a passing result", async () => {
  const f = serviceFixture();
  let reads = 0;
  const checked = await coordinateServices({
    entry: f.entry,
    rehearsal: { report: f.report() },
    profile: f.profile,
    runtime: f.runtime,
    decision: decision(),
    attempts: {},
    saveAttempt: async () => {},
    guard: async () => {},
    client: {},
    verifyInputs: async () => ++reads === 1,
    execute: async (plan) => ({
      id: attemptId,
      result: {
        report: await executeServiceSteps(plan, serviceAdapter(), {
          attemptId
        }),
        workflow: {}
      }
    }),
    saveReport: async () => assert.fail("stale result must not be published")
  });
  assert.equal(checked.result.status, "stale");
});

test("journal save uncertainty escapes service handling before ticket presentation", async () => {
  const f = serviceFixture(),
    error = new ServiceError("save-uncertain", "Could not save");
  error.service_journal_failure = true;
  await assert.rejects(
    coordinateServices({
      entry: f.entry,
      rehearsal: { report: f.report() },
      profile: f.profile,
      runtime: f.runtime,
      decision: decision(),
      attempts: {},
      client: {},
      verifyInputs: async () => true,
      execute: async () => {
        throw error;
      }
    }),
    { code: "save-uncertain" }
  );
});
