import test from "node:test";
import assert from "node:assert/strict";
import { processInbox } from "../src/inbox-processor.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { createJournal, inboxWorkflow } from "../src/inbox-journal.mjs";
import { harness } from "./inbox-batch-harness.mjs";
import { batchMergePlan } from "../src/batch-plan.mjs";

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
  assert.ok(
    archive.evidence.some(
      (url) => url === "https://example.invalid/integration"
    )
  );
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

test("the oldest database-changing sandbox ticket releases alone and leaves other tickets queued", async () => {
  const h = harness(2, { databaseTickets: [1] });
  const result = await processInbox(h.options);
  assert.deepEqual(result.batch.selected, [1]);
  assert.equal(h.dispatches(), 1);
  assert.equal(h.f.issues[0].state, "closed");
  assert.ok(h.f.issues[0].labels.includes("reason:release-completed"));
  assert.equal(h.f.issues[1].state, "open");
  assert.ok(h.f.issues[1].labels.includes("reason:batch-deferred"));
  const record = Object.values(h.f.state().history.batches)[0];
  const saved = h.f.file(record.path).record;
  assert.deepEqual(
    saved.inputs.map((input) => input.database_change),
    ["yes"]
  );
  assert.equal(
    saved.attempts.find((attempt) => attempt.phase === "git").result
      .service_plan.database.observed,
    "yes"
  );
  assert.throws(
    () =>
      batchMergePlan(
        h.samples.map((sample, index) => ({
          entry: sample.entry,
          input: {
            profile: "sandbox",
            inbox: { issue_number: index + 1 },
            repositories: []
          }
        }))
      ),
    /database-changing sandbox release must contain exactly one/u
  );
});

test("a database-changing ticket waits while the older no-change ticket releases", async () => {
  const h = harness(2, { databaseTickets: [2] });
  const result = await processInbox(h.options);
  assert.deepEqual(result.batch.selected, [1]);
  assert.equal(h.f.issues[1].state, "open");
  assert.ok(h.f.issues[1].labels.includes("reason:batch-deferred"));
});

test("filtered Issues become the complete visible inbox before normal batching", async () => {
  const h = harness(3);
  const result = await processInbox({
    ...h.options,
    selectionMode: "filtered",
    issueNumbers: [1, 3],
    actorLogin: "trusted-user"
  });
  assert.deepEqual(result.batch.selected, [1, 3]);
  assert.deepEqual(
    result.requests.map((request) => request.issue_number),
    [1, 3]
  );
  assert.equal(h.f.issues[0].state, "closed");
  assert.equal(h.f.issues[1].state, "open");
  assert.deepEqual(h.f.issues[1].labels, [
    "release-request",
    "pending",
    "target:staging",
    "user-note"
  ]);
  assert.equal(h.f.issues[2].state, "closed");
});

test("a filtered mixed database inbox keeps the normal database isolation rule", async () => {
  const h = harness(3, { databaseTickets: [1] });
  const result = await processInbox({
    ...h.options,
    selectionMode: "filtered",
    issueNumbers: [1, 2],
    actorLogin: "trusted-user"
  });
  assert.deepEqual(result.batch.selected, [1]);
  assert.equal(h.f.issues[0].state, "closed");
  assert.ok(h.f.issues[1].labels.includes("reason:batch-deferred"));
  assert.equal(h.f.issues[2].state, "open");
});

test("a filtered actor mismatch stops before acquiring the journal", async () => {
  const h = harness();
  await assert.rejects(
    processInbox({
      ...h.options,
      selectionMode: "filtered",
      issueNumbers: [1],
      actorLogin: "another-user"
    }),
    /available verified request from the selected actor/u
  );
  assert.equal(h.f.head, null);
  assert.equal(h.f.comments.length, 0);
});

test("a duplicate request outside the filtered inbox cannot block a selected ticket", async () => {
  const h = harness();
  h.samples[1].entry.request.request_id = h.samples[0].entry.request.request_id;
  for (const sample of h.samples) {
    sample.entry.status = "invalid";
    sample.entry.errors = [
      "The same request ID appears in multiple open Issues: #1, #2."
    ];
  }
  const result = await processInbox({
    ...h.options,
    selectionMode: "filtered",
    issueNumbers: [1],
    actorLogin: "trusted-user",
    inspect: async (issue) => {
      const entry = structuredClone(h.samples[issue.number - 1].entry);
      entry.status = "valid";
      entry.errors = [];
      return entry;
    }
  });
  assert.deepEqual(result.batch.selected, [1]);
  assert.equal(h.f.issues[0].state, "closed");
  assert.equal(h.f.issues[1].state, "open");
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
