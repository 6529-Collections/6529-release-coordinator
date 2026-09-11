import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createJournal,
  inboxWorkflow,
  appendDecision
} from "../src/inbox-journal.mjs";
import { archiveFinished, historyReady } from "../src/inbox-history.mjs";
import {
  createCoordinatorGitHub,
  stateBranch,
  stateFile
} from "../src/coordinator-github.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { selectBatch, batchTicketResult } from "../src/batch-selection.mjs";
import { serviceHash, executeServiceSteps } from "../src/service-contract.mjs";
import { buildServicePlan } from "../src/service-plan.mjs";
import { harness } from "./inbox-batch-harness.mjs";
import { serviceFixture, serviceAdapter } from "./service-fixture.mjs";
import { fixture } from "./processing-fixture.mjs";

const writer = (f, workflow = inboxWorkflow) =>
  createJournal(f.api, sandboxProfile, { workflow });
const currentBatch = (f) =>
  f.file(Object.values(f.state().history.batches)[0].path).record;
function presented(ticket, change) {
  const {
    id: _id,
    hash: _hash,
    previous: _previous,
    ...last
  } = ticket.transitions.at(-1);
  appendDecision(ticket, {
    ...last,
    decision: { ...last.decision, ...change }
  });
  ticket.applied = ticket.transitions.at(-1).id;
}
async function completed() {
  const h = harness();
  await processInbox(h.options);
  return h;
}
async function activeCopy(h) {
  const journal = writer(h.f);
  const { state, run } = await journal.acquire(
    await h.f.identity(),
    undefined,
    {}
  );
  const record = currentBatch(h.f);
  state.batches[record.fingerprint] = structuredClone(record);
  await journal.save(state, run, "fixture loaded completed batch");
  return { journal, state, run, record };
}

test("completed batches leave the working file; ordinary saves preserve archives and exact repeats", async () => {
  const h = await completed();
  const before = h.f.state();
  assert.deepEqual(before.batches, {});
  const [identity, ref] = Object.entries(before.history.batches)[0];
  const archive = h.f.file(ref.path);
  const original = structuredClone(archive.record);
  const j = writer(h.f);
  const { state, run } = await j.acquire(await h.f.identity(), undefined, {});
  assert.equal(
    h.f.calls.filter((c) => c.path.startsWith("/contents/history/")).length,
    1,
    "ordinary reads do not load old payloads"
  );
  await j.save(state, run, "unrelated ordinary save");
  assert.deepEqual(h.f.file(ref.path), archive);
  assert.deepEqual(
    await j.loadHistory(state, run, "batches", identity),
    original
  );
  await j.release(state, run);
  const second = await processInbox(h.options);
  assert.deepEqual(second.batch.selected, [1, 2]);
  assert.equal(h.dispatches(), 1);
  assert.deepEqual(currentBatch(h.f), original);
  assert.deepEqual(h.f.state().tickets, before.tickets);
});

test("more than 100 completed batches archive without resetting search budgets or losing active work", async () => {
  const h = await completed();
  const { journal, state, run, record } = await activeCopy(h);
  for (let i = 0; i < 101; i++) {
    const input = structuredClone(record.inputs[0].input);
    input.inbox.request_id = randomUUID();
    const batch = await selectBatch({
      items: [{ entry: { issue_number: 1 }, input }],
      verify: async () => false,
      guard: async () => {},
      save: async () => {},
      prepare: async () => assert.fail("stale inputs do not start Git"),
      check: async () => assert.fail("stale inputs do not start checks")
    });
    state.batches[batch.fingerprint] = batch;
    presented(state.tickets[1], { batch: batchTicketResult(batch, 1) });
  }
  const pending = structuredClone(record);
  pending.inputs[0].input.inbox.request_id = randomUUID();
  pending.fingerprint = serviceHash({
    inputs: pending.inputs,
    policy: pending.policy
  });
  pending.selected = [];
  pending.status = "searching";
  pending.attempts = [];
  state.batches[pending.fingerprint] = pending;
  await journal.save(state, run, "fixture over old lifetime cap");
  await journal.release(state, run);
  assert.equal(Object.keys(h.f.state().history.batches).length, 102);
  assert.deepEqual(h.f.state().batches, { [pending.fingerprint]: pending });
  const later = writer(h.f);
  const next = await later.acquire(await h.f.identity(), undefined, {});
  const loaded = await later.loadHistory(
    next.state,
    next.run,
    "batches",
    record.fingerprint
  );
  assert.deepEqual(loaded.policy, record.policy);
  assert.equal(loaded.deadline, record.deadline);
  assert.deepEqual(loaded.attempts, record.attempts);
  await later.release(next.state, next.run);
});

test("selection finished is insufficient: pending operations, cleanup and ticket presentation stay active", async () => {
  const h = await completed();
  const record = currentBatch(h.f),
    tickets = h.f.state().tickets;
  for (const mutate of [
    (batch) => {
      batch.status = "searching";
    },
    (batch) => {
      delete batch.attempts[0].result;
    },
    (batch) => {
      batch.attempts.find((a) => a.phase === "checks").progress.cleanup =
        "pending";
    },
    (batch) => {
      batch.attempts.find((a) => a.phase === "checks").progress.prs[0].cleanup =
        "pending";
    },
    (batch) => {
      delete batch.attempts.find((a) => a.phase === "checks").progress
        .service_attempts.candidate.result;
    },
    (batch) => {
      batch.attempts.find(
        (a) => a.phase === "checks"
      ).progress.service_attempts.candidate.state = "running";
    },
    (_batch, values) => {
      values[1].applied = null;
    },
    (_batch, values) => {
      values[1].application_error = { message: "unfinished comment" };
    }
  ]) {
    const copy = structuredClone(record),
      values = structuredClone(tickets);
    mutate(copy, values);
    assert.equal(historyReady("batches", copy, values), false);
    const state = { tickets: values, batches: { [copy.fingerprint]: copy } };
    assert.deepEqual(archiveFinished(state, sandboxProfile), []);
    assert.equal(Object.keys(state.batches).length, 1);
  }
});

for (const failure of ["missing", "changed", "profile", "summary"]) {
  test(`${failure} archive stops exact reuse without a new dispatch`, async () => {
    const h = await completed();
    const original = h.f.api;
    const altered = async (call) => {
      const result = await original(call);
      if (call.path.startsWith("/contents/history/")) {
        if (failure === "missing") return { status: 404 };
        const archive = JSON.parse(
          Buffer.from(result.data.content, "base64").toString()
        );
        if (failure === "profile") archive.repository = "other/inbox";
        else archive.record.deadline++;
        result.data.content = Buffer.from(JSON.stringify(archive)).toString(
          "base64"
        );
      }
      return result;
    };
    if (failure === "summary") {
      const { journal, state, run } = await activeCopy(h);
      Object.values(state.history.batches)[0].status = "invented";
      state.batches = {};
      await journal.save(state, run, "fixture corrupt reference");
      await journal.release(state, run);
    }
    await assert.rejects(
      processInbox({
        ...h.options,
        api: failure === "summary" ? original : altered
      }),
      /archive|GitHub GET/
    );
    assert.equal(h.dispatches(), 1);
    assert.ok(h.f.state().lock);
  });
}

test("failed archive save preserves active evidence for explicit resume", async () => {
  const h = await completed();
  const { journal, state, run } = await activeCopy(h);
  const before = h.f.state();
  h.f.before = async (call) => {
    if (
      call.path === "/git/blobs" &&
      JSON.parse(call.body.content).kind === "batches"
    )
      throw Error("archive upload failed");
  };
  await assert.rejects(journal.release(state, run), /archive upload failed/);
  assert.deepEqual(h.f.state(), before);
  assert.equal(state.lock.run_id, run.run_id);
});

test("lost archive ref response is reconciled to the exact saved commit and pair", async () => {
  const h = await completed();
  const { journal, state, run, record } = await activeCopy(h);
  let lost = false;
  h.f.after = async (call) => {
    if (
      !lost &&
      call.method === "PATCH" &&
      call.path.startsWith("/git/refs/")
    ) {
      lost = true;
      throw Error("response lost after commit");
    }
  };
  await journal.release(state, run);
  assert.equal(lost, true);
  assert.equal(h.f.state().lock, null);
  assert.deepEqual(h.f.state().batches, {});
  assert.deepEqual(currentBatch(h.f), record);
  assert.equal(h.dispatches(), 1);
});

for (const failure of ["journal read", "archive verification"]) {
  test(`lost archive confirmation followed by failed ${failure} stops safely and preserves exact reuse`, async () => {
    const h = harness();
    let lost = false,
      failedRead = false,
      callsAtLoss;
    await assert.rejects(
      processInbox({
        ...h.options,
        api: async (call) => {
          if (
            lost &&
            failure === "journal read" &&
            call.path === `/git/ref/heads/${stateBranch}`
          ) {
            failedRead = true;
            throw Error("journal read unavailable");
          }
          const result = await h.f.api(call);
          if (
            call.method === "PATCH" &&
            call.path === `/git/refs/heads/${stateBranch}` &&
            h.f.state().lock === null
          ) {
            lost = true;
            callsAtLoss = h.f.calls.length;
            throw Error("archive confirmation lost");
          }
          if (lost && call.path.startsWith("/contents/history/")) {
            failedRead = true;
            result.data.content = Buffer.from("{}").toString("base64");
          }
          return result;
        }
      }),
      (error) => {
        assert.match(error.message, /journal read unavailable|archive/i);
        assert.match(error.message, /inspect the journal/);
        assert.doesNotMatch(error.message, /remains locked/);
        return true;
      }
    );
    assert.ok(lost && failedRead);
    assert.equal(h.f.state().lock, null);
    assert.deepEqual(h.f.state().batches, {});
    const record = structuredClone(currentBatch(h.f));
    const tickets = structuredClone(h.f.state().tickets);
    const comments = structuredClone(h.f.comments);
    assert.equal(h.dispatches(), 1);
    assert.ok(
      h.f.calls.slice(callsAtLoss).every((call) => call.method === "GET")
    );

    // Readable durable history permits a new run; there is no lock to resume.
    await processInbox(h.options);
    assert.deepEqual(currentBatch(h.f), record);
    assert.deepEqual(h.f.state().tickets, tickets);
    assert.deepEqual(h.f.comments, comments);
    assert.equal(h.dispatches(), 1);
  });
}

for (const failure of ["transport", 403, 422]) {
  test(`archive ref update rejected with ${failure} preserves active evidence for resume`, async () => {
    const h = harness();
    let archiving = false,
      rejected = false;
    await assert.rejects(
      processInbox({
        ...h.options,
        api: async (call) => {
          if (call.path === "/git/trees" && call.body.tree.length > 1)
            archiving = true;
          if (
            archiving &&
            call.method === "PATCH" &&
            call.path === `/git/refs/heads/${stateBranch}`
          ) {
            rejected = true;
            if (failure === "transport") throw Error("ref update unavailable");
            return { status: failure };
          }
          return h.f.api(call);
        }
      }),
      /inspect the journal/
    );
    assert.equal(rejected, true);
    const before = h.f.state();
    const record = before.batches[before.lock.batch_fingerprint];
    assert.ok(record.attempts.length);
    assert.equal(Object.keys(before.history?.batches ?? {}).length, 0);
    assert.equal(h.dispatches(), 1);
    await processInbox({ ...h.options, resume: before.lock.run_id });
    assert.deepEqual(currentBatch(h.f), record);
    assert.equal(h.f.state().lock, null);
    assert.equal(h.dispatches(), 1);
  });
}

test("missing archive on an unchanged resumed batch cannot start a fresh attempt", async () => {
  const h = await completed();
  const journal = writer(h.f);
  const { state, run } = await journal.acquire(
    await h.f.identity(),
    undefined,
    {
      workflow: inboxWorkflow,
      issue_number: null,
      close_test: false
    }
  );
  const record = currentBatch(h.f);
  state.lock.batch_fingerprint = record.fingerprint;
  await journal.save(state, run, "fixture resume exact archived batch");
  const history = structuredClone(h.f.state().history);
  await assert.rejects(
    processInbox({
      ...h.options,
      resume: run.run_id,
      api: (call) =>
        call.path.startsWith("/contents/history/")
          ? Promise.resolve({ status: 404 })
          : h.f.api(call)
    }),
    /GitHub GET|archive/
  );
  assert.equal(h.dispatches(), 1);
  assert.deepEqual(h.f.state().batches, {});
  assert.deepEqual(h.f.state().history, history);
  assert.equal(h.f.state().lock.batch_fingerprint, record.fingerprint);
});

test("resume after saving only the first batch identity starts its first attempt once", async () => {
  const h = harness();
  let interrupted = false;
  h.f.after = async (call) => {
    if (call.method !== "PATCH" || !call.path.startsWith("/git/refs/")) return;
    const state = h.f.state();
    const fingerprint = state.lock?.batch_fingerprint;
    if (!interrupted && fingerprint && !state.batches?.[fingerprint]) {
      interrupted = true;
      throw Error("interrupted after saving initial identity");
    }
  };
  await assert.rejects(processInbox(h.options), /initial identity/);
  assert.equal(interrupted, true);
  assert.equal(h.dispatches(), 0);
  const run = h.f.state().lock;
  h.f.after = async () => {};
  await processInbox({ ...h.options, resume: run.run_id });
  assert.equal(currentBatch(h.f).fingerprint, run.batch_fingerprint);
  assert.equal(h.dispatches(), 1);
});

test("competing compaction cannot replace another writer's state or discard its active work", async () => {
  const h = await completed();
  const { journal, state, run, record } = await activeCopy(h);
  let takeover;
  h.f.before = async (call) => {
    if (call.path === "/git/trees" && call.body.tree.length > 1) {
      h.f.before = async () => {};
      takeover = await writer(h.f).acquire(await h.f.identity(), run.run_id);
    }
  };
  await assert.rejects(journal.release(state, run), /concurrently/);
  assert.equal(h.f.state().lock.token, takeover.run.token);
  assert.deepEqual(h.f.state().batches[record.fingerprint], record);
});

test("v4 migration preserves full history and fences the old writer before writes", async () => {
  const h = await completed(),
    record = currentBatch(h.f);
  const f = fixture(sandboxProfile),
    old = writer(f, "inbox-run-v4");
  const { state, run } = await old.acquire(await f.identity(), undefined, {
    workflow: "inbox-run-v4",
    issue_number: null,
    close_test: false
  });
  state.tickets = h.f.state().tickets;
  state.batches = { [record.fingerprint]: record };
  state.lock.batch_fingerprint = record.fingerprint;
  state.lock.plans = Object.fromEntries(
    record.inputs.map(({ number, input }) => [number, input])
  );
  state.lock.ticket_numbers = [1, 2];
  await old.save(state, run, "fixture interrupted v4");
  const current = writer(f);
  const resumed = await current.acquire(await f.identity(), run.run_id, {
    workflow: inboxWorkflow,
    issue_number: null,
    close_test: false
  });
  assert.deepEqual(resumed.state.tickets, state.tickets);
  assert.equal(resumed.run.batch_fingerprint, record.fingerprint);
  assert.deepEqual(resumed.run.plans, state.lock.plans);
  assert.deepEqual(resumed.run.ticket_numbers, [1, 2]);
  await current.release(resumed.state, resumed.run);
  assert.deepEqual(currentBatch(f), record);
  const count = f.calls.filter((c) => c.method !== "GET").length;
  await assert.rejects(
    writer(f, "inbox-run-v4").acquire(await f.identity()),
    /older processor/
  );
  assert.equal(f.calls.filter((c) => c.method !== "GET").length, count);
});

test("later stale observation gets a new immutable snapshot, preserving the original result", async () => {
  const h = await completed();
  const before = Object.values(h.f.state().history.batches)[0];
  const original = h.f.file(before.path);
  const { journal, state, run, record } = await activeCopy(h);
  record.stop = {
    status: "stale",
    kind: "evidence",
    message: "Backend main changed."
  };
  record.selected = [];
  state.batches[record.fingerprint] = record;
  for (const number of [1, 2])
    presented(state.tickets[number], {
      batch: batchTicketResult(record, number)
    });
  await journal.save(state, run, "fixture later stale observation");
  await journal.release(state, run);
  const after = Object.values(h.f.state().history.batches)[0];
  assert.notEqual(after.path, before.path);
  assert.deepEqual(h.f.file(before.path), original);
  assert.equal(h.f.file(after.path).record.stop.status, "stale");
});

test("standalone services archive past 1000 while preserving pending or linked attempts", async () => {
  const h = await completed(),
    sample = serviceFixture();
  const { journal, state, run, record } = await activeCopy(h);
  state.service_attempts = {};
  let first;
  for (let i = 0; i < 1001; i++) {
    sample.entry.request.request_id = randomUUID();
    const plan = buildServicePlan(
      sample.entry,
      sample.report(),
      sandboxProfile,
      sample.runtime
    );
    const id = randomUUID();
    const attempt = {
      id,
      plan,
      plan_hash: plan.fingerprint,
      actor: { id: "456" },
      state: "completed",
      workflow_run_id: i + 1,
      result: {
        report: await executeServiceSteps(plan, serviceAdapter(), {
          attemptId: id
        }),
        workflow: { id: i + 1, url: `https://example.invalid/run/${i + 1}` }
      }
    };
    first ??= attempt;
    state.service_attempts[plan.fingerprint] = attempt;
    presented(state.tickets[1], {
      services: {
        status: "passed",
        message: "Fixture verified",
        plan_hash: plan.fingerprint
      }
    });
  }
  const pending = structuredClone(first);
  pending.plan.binding.request_id = randomUUID();
  const { fingerprint: _hash, ...contents } = pending.plan;
  pending.plan_hash = pending.plan.fingerprint = serviceHash(contents);
  pending.id = randomUUID();
  pending.state = "dispatching";
  pending.workflow_run_id = null;
  delete pending.result;
  state.service_attempts[pending.plan_hash] = pending;
  // An unfinished batch retaining a service identity also prevents its removal.
  record.selected = [];
  record.status = "searching";
  const check = record.attempts.find((a) => a.phase === "checks");
  delete check.result;
  delete check.progress.result;
  check.progress.cleanup = "pending";
  check.progress.service_attempts.candidate = first;
  state.batches[record.fingerprint] = record;
  await journal.save(state, run, "fixture over standalone lifetime cap");
  await journal.release(state, run);
  assert.equal(Object.keys(h.f.state().history.services).length, 1000);
  assert.deepEqual(
    Object.keys(h.f.state().service_attempts).sort(),
    [first.plan_hash, pending.plan_hash].sort()
  );
  assert.ok(h.f.state().batches[record.fingerprint]);
});

test("archive API paths are narrow and cannot delete files, write other branches or read unpinned data", async () => {
  const calls = [];
  const client = createCoordinatorGitHub({
    execute: async (args, body) => {
      calls.push({ args, body });
      return "HTTP/2.0 200 OK\nContent-Type: application/json\n\n{}";
    }
  });
  const entry = {
    path: stateFile,
    type: "blob",
    mode: "100644",
    sha: "a".repeat(40)
  };
  const path = `history/batches/${"b".repeat(64)}.json`;
  await client.request({
    method: "GET",
    path: `/contents/${path}?ref=${"a".repeat(40)}`
  });
  await client.request({
    method: "POST",
    path: "/git/trees",
    body: { base_tree: "c".repeat(40), tree: [entry, { ...entry, path }] }
  });
  assert.equal(calls.length, 2);
  for (const call of [
    { method: "GET", path: `/contents/${path}?ref=main` },
    ...["../other", "history/other/a.json", ".github/workflows/deploy.yml"].map(
      (path) => ({
        method: "POST",
        path: "/git/trees",
        body: { tree: [entry, { ...entry, path }] }
      })
    ),
    {
      method: "POST",
      path: "/git/trees",
      body: { tree: [entry, { ...entry, path, sha: null }] }
    },
    { method: "POST", path: "/git/trees", body: { tree: [entry, entry] } },
    {
      method: "POST",
      path: "/git/trees",
      body: { tree: [{ ...entry, path }] }
    },
    {
      method: "POST",
      path: "/git/trees",
      body: { base_tree: "main", tree: [entry] }
    }
  ])
    await assert.rejects(client.request(call), /unsupported/);
  assert.equal(calls.length, 2);
});

test("archive readback failure reports uncertainty instead of success or an assumed lock", async () => {
  const h = harness();
  const api = h.f.api;
  await assert.rejects(
    processInbox({
      ...h.options,
      api: async (call) => {
        const result = await api(call);
        if (call.path.startsWith("/contents/history/"))
          result.data.content = Buffer.from("{}").toString("base64");
        return result;
      }
    }),
    (error) => {
      assert.match(error.message, /archive/);
      assert.match(error.message, /inspect the journal/);
      assert.doesNotMatch(error.message, /remains locked/);
      return true;
    }
  );
  // The atomic commit may already exist even though its readback failed.
  assert.equal(h.f.state().lock, null);
  assert.deepEqual(h.f.state().batches, {});
  assert.ok(currentBatch(h.f).attempts.length);
  assert.equal(h.dispatches(), 1);
});

test("an interrupted v4 batch resumes through the processor without individual service dispatch", async () => {
  const h = await completed(),
    record = currentBatch(h.f);
  const seed = fixture(sandboxProfile),
    legacy = writer(seed, "inbox-run-v4");
  const { state, run } = await legacy.acquire(
    await seed.identity(),
    undefined,
    { workflow: "inbox-run-v4", issue_number: null, close_test: false }
  );
  state.tickets = h.f.state().tickets;
  state.batches = { [record.fingerprint]: record };
  state.lock.batch_fingerprint = record.fingerprint;
  state.lock.plans = Object.fromEntries(
    record.inputs.map(({ number, input }) => [number, input])
  );
  state.lock.ticket_numbers = [1, 2];
  await legacy.save(state, run, "fixture interrupted v4 batch");
  h.f.head = seed.head;
  h.f.objects = seed.objects;
  h.f.nextId = seed.nextId;
  const result = await processInbox({ ...h.options, resume: run.run_id });
  assert.deepEqual(result.batch.selected, [1, 2]);
  assert.equal(h.dispatches(), 1);
  assert.equal(h.f.state().workflow, inboxWorkflow);
  assert.deepEqual(currentBatch(h.f), record);
});
