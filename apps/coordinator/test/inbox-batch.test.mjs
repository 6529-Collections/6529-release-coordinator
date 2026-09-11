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
    assert.equal(issue.state, "closed");
    assert.ok(issue.labels.includes("batch:passed"));
    assert.ok(issue.labels.includes("status:completed"));
    assert.ok(issue.labels.includes("reason:release-completed"));
  }
  const archive = Object.values(h.f.state().history.batches)[0];
  assert.ok(archive.evidence.includes("https://example.invalid/integration"));
  assert.ok(
    archive.evidence.some((url) =>
      url.startsWith("https://example.invalid/release/")
    )
  );
  const writes = h.f.calls.filter(
    (call) => call.method !== "GET" && !call.path.startsWith("/git/")
  ).length;
  const second = await processInbox(h.options);
  assert.deepEqual(second.batch.selected, []);
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

for (const exclusion of ["unsupported", "limit"]) {
  test(`an excluded ${exclusion} ticket changing PR evidence cannot invalidate the eligible pool`, async () => {
    const h = harness(exclusion === "limit" ? 11 : 2);
    const excluded = h.samples.length;
    if (exclusion === "unsupported")
      h.samples.at(-1).entry.request.database_change = "unknown";
    let batching = false;
    const result = await processInbox({
      ...h.options,
      batch: async (options) => {
        batching = true;
        return h.options.batch(options);
      },
      observe: async (entry) => {
        if (batching && entry.issue_number === excluded)
          assert.fail(
            "An excluded ticket must not participate in the batch's evidence recheck"
          );
        return h.options.observe(entry);
      }
    });
    assert.deepEqual(
      result.batch.selected,
      Array.from({ length: excluded - 1 }, (_, i) => i + 1)
    );
    assert.equal(h.dispatches(), 1);
    assert.ok(
      h.f.issues
        .at(-1)
        .labels.includes(
          `reason:batch-${exclusion === "limit" ? "limit" : "unsupported"}`
        )
    );
  });
}

test("changed PR evidence inside the frozen pool still stops the batch before expensive checks", async () => {
  const h = harness();
  let batching = false;
  const result = await processInbox({
    ...h.options,
    batch: async (options) => {
      batching = true;
      return h.options.batch(options);
    },
    observe: async (entry) => {
      const result = await h.options.observe(entry);
      if (batching && entry.issue_number === 1)
        result.checks[0].status = "fail";
      return result;
    }
  });
  assert.deepEqual(result.batch.selected, []);
  assert.equal(result.batch.stop.status, "stale");
  assert.equal(h.dispatches(), 0);
});
