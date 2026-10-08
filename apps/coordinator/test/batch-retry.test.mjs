import test from "node:test";
import assert from "node:assert/strict";
import { failedChecks } from "./check-retry-fixture.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import {
  createJournal,
  inboxWorkflow,
  validateJournal
} from "../src/inbox-journal.mjs";
import { realProfile } from "../src/profiles.mjs";
import { readInboxSelection } from "../src/inbox-selection.mjs";
import { readInbox } from "../src/inbox-reader.mjs";
import {
  startCheckRetry,
  retryHistory,
  batchFingerprint
} from "../src/batch-retry.mjs";
import { serviceHash } from "../src/service-contract.mjs";
import { runInboxRunCli } from "../src/inbox-run-cli.mjs";
import { selectBatch } from "../src/batch-selection.mjs";

const retry = (h) => processInbox({ ...h.resume, retryChecks: h.attemptId });

test("an explicit retry preserves the archived failure, runs new Git/CI and retains budgets; repeated resume creates no replacement", async () => {
  const h = await failedChecks();
  const before = h.f.state(),
    archive = before.history.batches[h.parent.fingerprint];
  const archived = structuredClone(h.f.file(archive.path));
  const oldEvents = h.events.length;
  await assert.rejects(retry(h), /fixture stop before deployment/);
  const state = h.f.state(),
    next = state.batches[state.lock.batch_fingerprint];
  validateJournal(state, realProfile);
  assert.equal(next.version, 2);
  assert.equal(next.retry_of.attempt_id, h.attemptId);
  assert.equal(next.retry_of.record_hash, serviceHash(h.parent));
  assert.notEqual(next.fingerprint, h.parent.fingerprint);
  assert.deepEqual(next.inputs, h.parent.inputs);
  assert.deepEqual(state.batches[h.parent.fingerprint], h.parent);
  assert.deepEqual(h.f.file(archive.path), archived);
  assert.deepEqual(h.budgets.at(-1), { git: 1, checks: 1 });
  assert.equal(next.attempts[1].result.status, "passed");
  assert.notEqual(next.attempts[1].id, h.attemptId);
  assert.deepEqual(
    h.events.slice(oldEvents).map((event) => event.split(":")[0]),
    ["verify-removed", "prepare", "open", "cleanup", "release"]
  );
  const attempts = structuredClone(next.attempts);
  await assert.rejects(retry(h), /fixture stop before deployment/);
  assert.deepEqual(h.f.state().batches[next.fingerprint].attempts, attempts);
  assert.equal(h.events.filter((event) => event.startsWith("open:")).length, 2);
  const markerless = structuredClone(state);
  delete markerless.check_retry_history;
  assert.throws(() => validateJournal(markerless, realProfile), /retry/);
});

test("normal resume never treats changed diagnostic CI as a fresh candidate", async () => {
  const h = await failedChecks();
  const opens = h.events.filter((event) => event.startsWith("open:")).length;
  const report = await processInbox(h.resume);
  assert.deepEqual(report.batch.selected, []);
  assert.equal(report.release_executed, false);
  assert.equal(
    h.events.filter((event) => event.startsWith("open:")).length,
    opens
  );
  const state = h.f.state();
  assert.deepEqual(
    state.batches[h.parent.fingerprint] ??
      h.f.file(state.history.batches[h.parent.fingerprint].path).record,
    h.parent
  );
});

test("a moving main refreshes the same authorized round without resetting ancestor budgets", async () => {
  const h = await failedChecks();
  h.setBase("9".repeat(40));
  await assert.rejects(retry(h), /fixture stop before deployment/);
  const state = h.f.state(),
    next = state.batches[state.lock.batch_fingerprint];
  assert.equal(next.version, 2);
  assert.equal(
    next.inputs[0].input.repositories[0].destination.commit,
    "9".repeat(40)
  );
  assert.deepEqual(h.budgets.at(-1), { git: 1, checks: 1 });
  assert.deepEqual(state.batches[h.parent.fingerprint], h.parent);
  assert.ok(
    state.lock.reprepared_batches.includes(
      state.lock.check_retry.batch_fingerprint
    )
  );
});

test("uncertain cleanup prevents allocating or publishing a retry", async () => {
  const h = await failedChecks(),
    state = h.f.state();
  await assert.rejects(
    processInbox({
      ...h.resume,
      retryChecks: h.attemptId,
      retryTrials: async () => {
        throw new Error("previous workflow still running");
      }
    }),
    /still running/
  );
  assert.equal(
    h.f.state().lock.batch_fingerprint,
    state.lock.batch_fingerprint
  );
  assert.equal(h.f.state().check_retry_history, undefined);
});

test("source gate failure still prevents fresh trial publication or release", async () => {
  const h = await failedChecks();
  h.setGates(false);
  const opens = h.events.filter((event) => event.startsWith("open:")).length;
  const report = await retry(h);
  assert.deepEqual(report.batch.selected, []);
  assert.equal(report.release_executed, false);
  assert.equal(h.events.includes("release"), false);
  assert.equal(
    h.events.filter((event) => event.startsWith("open:")).length,
    opens
  );
});

async function retryOptions(h) {
  const journal = createJournal(h.f.api, realProfile, {
    workflow: inboxWorkflow,
    ticketConcurrency: true
  });
  const { state, run } = await journal.acquire(
    await h.f.identity(),
    h.resume.resume
  );
  const entries = new Map(
    (await readInbox({ get: h.f.get, profile: realProfile })).requests.map(
      (entry) => [entry.issue_number, entry]
    )
  );
  return {
    attemptId: h.attemptId,
    state,
    run,
    entries,
    profile: realProfile,
    selection: readInboxSelection(run.scope),
    loadBatch: async (hash) => state.batches[hash],
    verifyTrials: async () => {},
    guard: async () => {},
    save: async () => {}
  };
}

test("retry refuses wrong attempt/owner/scope/request, backend/database work, incomplete/selected/deployed attempts and attributed code failures", async () => {
  const h = await failedChecks();
  for (const mutate of [
    (o) => {
      o.attemptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    },
    (o) => {
      o.run.actor.login = "another-user";
    },
    (o) => {
      o.selection.mode = "inbox";
    },
    (o) => {
      o.entries.get(1).request.requested_by = "changed";
    },
    (o, b) => {
      b.inputs[0].database_change = "yes";
    },
    (o, b) => {
      b.inputs[0].input.repositories[0].role = "backend";
    },
    (o, b) => {
      b.execution = {};
    },
    (o, b) => {
      b.selected = [1];
    },
    (o, b) => {
      b.attempts[1].progress.cleanup = "pending";
    },
    (o, b) => {
      delete b.attempts[1].result;
    },
    (o, b) => {
      b.attempts[1].result = { status: "blocked", kind: "code" };
    }
  ]) {
    const o = await retryOptions(h),
      parent = o.state.batches[o.run.batch_fingerprint];
    mutate(o, parent);
    await assert.rejects(startCheckRetry(o), /retry|retried/);
    assert.equal(o.run.check_retry, undefined);
  }
});

test("retry ancestry rejects altered/missing records and cannot omit earlier spent rounds", async () => {
  const h = await failedChecks(),
    o = await retryOptions(h);
  await startCheckRetry(o);
  const next = o.state.batches[o.run.batch_fingerprint];
  assert.equal((await retryHistory(next, o.loadBatch)).length, 1);
  await assert.rejects(
    retryHistory(next, async () => undefined),
    /changed or is unavailable/
  );
  const changed = structuredClone(h.parent);
  changed.attempts[1].result.status = "passed";
  await assert.rejects(
    retryHistory(next, async () => changed),
    /changed or is unavailable/
  );
  const orphan = structuredClone(next);
  orphan.retry_of.history = [];
  orphan.fingerprint = batchFingerprint(orphan);
  await assert.rejects(retryHistory(orphan, o.loadBatch), /Invalid explicit/);
  const drift = structuredClone(next);
  drift.inputs[0].input.repositories[0].pull_requests[0].commit = "9".repeat(
    40
  );
  drift.fingerprint = batchFingerprint(drift);
  await assert.rejects(retryHistory(drift, o.loadBatch), /same failed request/);
});

test("cancellation after cleanup admission starts no new round", async () => {
  const h = await failedChecks(),
    o = await retryOptions(h),
    controller = new AbortController();
  o.signal = controller.signal;
  o.verifyTrials = async () => controller.abort(new Error("stop retry"));
  await assert.rejects(startCheckRetry(o), /stop retry/);
  assert.equal(o.run.check_retry, undefined);
});

test("normal archived-batch stale reconciliation keeps its archive; explicit retry refuses the changed resident record", async () => {
  const h = await failedChecks(),
    journal = createJournal(h.f.api, realProfile, {
      workflow: inboxWorkflow,
      ticketConcurrency: true
    });
  const { state, run } = await journal.acquire(
    await h.f.identity(),
    h.resume.resume
  );
  const identity = run.batch_fingerprint,
    ref = state.history.batches[identity],
    archive = structuredClone(h.f.file(ref.path)),
    original = await journal.loadHistory(state, run, "batches", identity, {
      immutable: true
    });
  const changed = await selectBatch({
    items: original.inputs.map((input) => ({
      entry: {
        issue_number: input.number,
        request: {
          target: input.target,
          database_change: input.database_change,
          operational_deployments: input.operational_deployments
        }
      },
      input: input.input
    })),
    previous: original,
    policy: original.policy,
    guard: () => journal.guard(run),
    verify: async () => false,
    prepare: async () => assert.fail("stale history cannot start Git work"),
    check: async () => assert.fail("cleaned history cannot start checks"),
    revalidate: async () => assert.fail("stale inputs cannot reuse proof"),
    save: async (value) => {
      state.batches[identity] = value;
      await journal.save(state, run, "fixture normal stale reconciliation");
    }
  });
  assert.equal(changed.stop.status, "stale");
  assert.deepEqual(
    await journal.loadHistory(state, run, "batches", identity),
    changed
  );
  await assert.rejects(retry(h), /Resident history differs/);
  assert.deepEqual(h.f.file(ref.path), archive);
  assert.equal(h.events.filter((event) => event.startsWith("open:")).length, 1);
});

test("valid CLI retry forwards the named round to the engine without changing its saved selection", async () => {
  const runId = "33333333-3333-4333-8333-333333333333",
    attempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let options;
  const log = {
    snapshot: () => ({ complete: true }),
    run: (fn) => fn(),
    finish: () => ({}),
    close: () => {}
  };
  assert.equal(
    await runInboxRunCli(
      ["--resume", runId, "--retry-checks", attempt, "--json"],
      {
        env: {
          RELEASE_COORDINATOR_PROFILE: "real",
          RELEASE_COORDINATOR_SCOPE: "filtered"
        },
        createLog: () => log,
        client: {
          request: async () => assert.fail("no CLI writes"),
          identity: async () => ({})
        },
        get: { identity: async () => {} },
        github: {},
        stdout: () => {},
        stderr: () => {},
        run: async (value) => {
          options = value;
          return { requests: [], release_executed: false };
        }
      }
    ),
    0
  );
  assert.equal(options.retryChecks, attempt);
  assert.equal(options.resume, runId);
  assert.equal(options.selectionMode, "filtered");
  assert.deepEqual(options.issueNumbers, []);
  assert.equal(options.actorLogin, undefined);
});

test("a failed fresh round holds for a person; another explicitly named round carries both rounds' budgets", async () => {
  const h = await failedChecks();
  h.setPass(false);
  const report = await retry(h);
  assert.equal(report.batch.stop.kind, "evidence");
  const firstState = h.f.state(),
    first = firstState.batches[firstState.lock.batch_fingerprint];
  assert.equal(first.attempts[1].result.status, "unknown");
  assert.equal(h.events.includes("release"), false);
  await retry(h);
  assert.deepEqual(h.f.state().batches[first.fingerprint], first);
  h.setPass(true);
  await assert.rejects(
    processInbox({ ...h.resume, retryChecks: first.attempts[1].id }),
    /fixture stop before deployment/
  );
  const state = h.f.state(),
    next = state.batches[state.lock.batch_fingerprint];
  assert.deepEqual(h.budgets.at(-1), { git: 2, checks: 2 });
  assert.equal(next.retry_of.history.length, 2);
  assert.deepEqual(state.batches[first.fingerprint], first);
  assert.deepEqual(state.batches[h.parent.fingerprint], h.parent);
  const omitted = structuredClone(next);
  omitted.retry_of.history = omitted.retry_of.history.filter(
    (ref) => ref.fingerprint !== h.parent.fingerprint
  );
  omitted.fingerprint = batchFingerprint(omitted);
  await assert.rejects(
    retryHistory(omitted, async (hash) => state.batches[hash]),
    /omitted earlier spent/
  );
});

test("a lost retry-intent save starts no test and resumes its one durable allocation", async () => {
  const h = await failedChecks(),
    o = await retryOptions(h);
  let saved;
  o.save = async () => {
    saved = structuredClone(o.state);
    throw new Error("lost save response");
  };
  await assert.rejects(startCheckRetry(o), /lost save/);
  const fingerprint = saved.lock.batch_fingerprint;
  const resumed = {
    ...o,
    state: saved,
    run: structuredClone(saved.lock),
    save: async () => assert.fail("must not allocate again")
  };
  await startCheckRetry(resumed);
  assert.equal(resumed.run.batch_fingerprint, fingerprint);
  assert.equal(saved.batches[fingerprint].attempts.length, 0);
  delete resumed.run.batch_fingerprint;
  resumed.run.reprepared_batches = [fingerprint];
  await startCheckRetry(resumed);
  assert.equal(resumed.run.batch_fingerprint, undefined);
});

test("a failed retry can archive without losing its writer fence or either failure record", async () => {
  const h = await failedChecks();
  h.setPass(false);
  await retry(h);
  const journal = createJournal(h.f.api, realProfile, {
    workflow: inboxWorkflow,
    ticketConcurrency: true
  });
  const { state, run } = await journal.acquire(
    await h.f.identity(),
    h.resume.resume
  );
  const fingerprint = run.batch_fingerprint,
    failed = structuredClone(state.batches[fingerprint]);
  await journal.release(state, run);
  assert.equal(h.f.state().lock, null);
  assert.equal(h.f.state().check_retry_history, "explicit-check-retry-v1");
  assert.deepEqual(
    h.f.file(h.f.state().history.batches[fingerprint].path).record,
    failed
  );
  assert.deepEqual(
    h.f.file(h.f.state().history.batches[h.parent.fingerprint].path).record,
    h.parent
  );
  const nextJournal = createJournal(h.f.api, realProfile, {
    workflow: inboxWorkflow
  });
  await nextJournal.read();
});

test("prior preparation and retries spend the existing budget, never a new allowance", async () => {
  const h = await failedChecks(),
    o = await retryOptions(h);
  o.run.reprepared_batches = [];
  for (let i = 0; i < 11; i++) {
    const record = structuredClone(h.parent);
    record.inputs[0].input.repositories[0].destination.commit = String(
      i
    ).padStart(40, "0");
    record.fingerprint = batchFingerprint(record);
    record.stop = { status: "stale", kind: "inputs" };
    o.state.batches[record.fingerprint] = record;
    o.run.reprepared_batches.push(record.fingerprint);
  }
  await assert.rejects(startCheckRetry(o), /budget is exhausted/);
  assert.equal(o.run.check_retry, undefined);
});

test("CLI refuses unscoped, duplicate, malformed and mixed recovery retry flags before calling the engine", async () => {
  const runId = "33333333-3333-4333-8333-333333333333",
    attempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const [args, profile, scope] of [
    [["--retry-checks", attempt], "real", "filtered"],
    [["--resume", runId, "--retry-checks", "bad"], "real", "filtered"],
    [
      ["--resume", runId, "--retry-checks", attempt, "--retry-checks", attempt],
      "real",
      "filtered"
    ],
    [
      ["--resume", runId, "--retry-checks", attempt, "--review-stop"],
      "real",
      "filtered"
    ],
    [
      [
        "--resume",
        runId,
        "--retry-checks",
        attempt,
        "--staging-change",
        "restore"
      ],
      "real",
      "filtered"
    ],
    [
      ["--resume", runId, "--retry-checks", attempt, "--cancel-keep-current"],
      "real",
      "filtered"
    ],
    [["--resume", runId, "--retry-checks", attempt], "sandbox", "filtered"],
    [["--resume", runId, "--retry-checks", attempt], "real", "inbox"]
  ])
    assert.equal(
      await runInboxRunCli(args, {
        env: {
          RELEASE_COORDINATOR_PROFILE: profile,
          RELEASE_COORDINATOR_SCOPE: scope
        },
        run: async () => assert.fail("invalid flags cannot call engine"),
        stdout: () => {},
        stderr: () => {}
      }),
      2
    );
});
