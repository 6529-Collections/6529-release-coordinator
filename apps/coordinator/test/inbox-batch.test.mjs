import test from "node:test";
import assert from "node:assert/strict";
import { processInbox } from "../src/inbox-processor.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { createJournal, inboxWorkflow } from "../src/inbox-journal.mjs";
import { harness } from "./inbox-batch-harness.mjs";

test("one unscoped sandbox command finishes all cheap work, tests one group and updates the same tickets", async () => {
  const h = harness();
  const first = await processInbox(h.options);
  assert.deepEqual(first.batch.selected, [1, 2]);
  assert.deepEqual(h.events, [
    "git:1",
    "git:2",
    "combined-git",
    "combined-services"
  ]);
  assert.equal(h.dispatches(), 1);
  assert.equal(h.f.state().workflow, inboxWorkflow);
  assert.equal(h.f.state().lock, null);
  for (const issue of h.f.issues) {
    assert.equal(issue.state, "open");
    assert.ok(issue.labels.includes("batch:passed"));
    assert.ok(issue.labels.includes("status:waiting"));
  }
  const writes = h.f.calls.filter(
    (call) => call.method !== "GET" && !call.path.startsWith("/git/")
  ).length;
  const second = await processInbox(h.options);
  assert.deepEqual(second.batch.selected, [1, 2]);
  assert.equal(h.dispatches(), 1);
  assert.equal(h.f.comments.length, 2);
  assert.equal(
    h.f.calls.filter(
      (call) => call.method !== "GET" && !call.path.startsWith("/git/")
    ).length,
    writes
  );
  await assert.rejects(
    createJournal(h.f.api, sandboxProfile, {
      workflow: "inbox-run-v3"
    }).acquire(await h.f.identity()),
    /requires the combined/
  );
});

test("unsupported database batching stays visible without starting expensive work", async () => {
  const h = harness();
  for (const sample of h.samples)
    sample.entry.request.database_change = "unknown";
  const result = await processInbox(h.options);
  assert.deepEqual(result.batch.selected, []);
  assert.equal(h.dispatches(), 0);
  assert.ok(
    h.f.issues.every((issue) =>
      issue.labels.includes("reason:batch-unsupported")
    )
  );
});

test("an explicit issue keeps the single-ticket path and cannot silently expand into a batch", async () => {
  const h = harness();
  let calls = 0;
  const result = await processInbox({
    ...h.options,
    issueNumber: 1,
    batch: async () => assert.fail("single-ticket selection must stay scoped"),
    services: async ({ decision }) => {
      calls++;
      return { decision, result: { status: "not-run", message: "Fixture" } };
    }
  });
  assert.equal(result.requests.length, 1);
  assert.equal(calls, 1);
  assert.equal(result.batch, undefined);
});
