import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./processing-fixture.mjs";
import {
  createJournal,
  inboxWorkflow,
  validateJournal
} from "../src/inbox-journal.mjs";
import { cleanupInbox } from "../src/inbox-cleanup.mjs";
import { inspectCleanup } from "../src/inbox-cleanup-evidence.mjs";
import { createInboxSelection } from "../src/inbox-selection.mjs";
import { ticketVersion } from "../src/inbox-concurrency.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { harness } from "./inbox-batch-harness.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import {
  buildReleaseRequestIssueBody,
  releaseRequestChecksum
} from "../../../packages/release-request/src/inbox-issue.mjs";

const scope = (tickets, cleanup = false) => ({
  selection: tickets
    ? createInboxSelection("filtered", tickets, "trusted-user")
    : createInboxSelection("inbox"),
  close_test: false,
  workflow: inboxWorkflow,
  ...(cleanup ? { cleanup: true } : {})
});
const journalFor = (f) =>
  createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    ticketConcurrency: true,
    archiveOnRelease: false,
    pause: async () => {}
  });
function pair(profile = realProfile) {
  const f = fixture(profile),
    second = fixture(profile),
    original = f.get;
  const web = `https://github.com/${profile.inbox.full_name}`;
  second.request.request_id = "33333333-3333-4333-8333-333333333333";
  Object.assign(second.issue, {
    id: 1002,
    number: 2,
    html_url: `${web}/issues/2`
  });
  Object.assign(second.run, {
    id: 124,
    html_url: `${web}/actions/runs/124`,
    display_title: `Release request ${second.request.request_id}`
  });
  Object.assign(second.result, {
    request_id: second.request.request_id,
    request: structuredClone(second.request),
    inbox_issue_number: 2,
    inbox_issue_url: second.issue.html_url
  });
  Object.assign(second.result.github, {
    workflow_run_id: "124",
    workflow_run_url: second.run.html_url
  });
  second.issue.body = buildReleaseRequestIssueBody({
    request: second.request,
    checksum: releaseRequestChecksum(second.request),
    actor: second.actor.login,
    actorId: String(second.actor.id),
    workflowRunUrl: second.run.html_url,
    submittedAt: second.request.created_at
  });
  f.issues.push(second.issue);
  f.second = second.issue;
  f.get = async (path) => {
    if (path.includes("/actions/runs/124")) {
      const value = await second.get(path.replace("/124", "/123"));
      if (value.jobs)
        for (const job of value.jobs) {
          job.run_id = 124;
          job.id = 790;
        }
      return value;
    }
    if (path.includes("/actions/jobs/790/logs"))
      return second.get(path.replace("/790/", "/789/"));
    return original(path);
  };
  f.pr.headRefOid = "e".repeat(40);
  return f;
}

for (const profile of [realProfile, sandboxProfile])
  test(`${profile.name}: cleanup changes inactive tickets while a release keeps its own reservation and progress`, async () => {
    const f = pair(profile),
      release = journalFor(f);
    const { state, run } = await release.acquire(
      await f.identity(),
      undefined,
      scope([1])
    );
    const original = structuredClone(f.issue);
    let interleaved = false;
    f.before = async ({ method, path }) => {
      if (!interleaved && method === "POST" && path === "/issues/2/labels") {
        interleaved = true;
        state.lock.progress = "still deploying";
        await release.save(state, run, "release progress during cleanup");
      }
    };
    const result = await cleanupInbox({ ...f, selectionMode: "inbox" });
    assert.equal(interleaved, true);
    assert.equal(result.counts.closed, 1);
    assert.equal(f.second.state, "closed");
    assert.deepEqual(f.issue, original);
    assert.equal(f.state().lock.token, run.token);
    assert.equal(f.state().lock.progress, "still deploying");
    assert.equal(f.state().cleanup_lock, null);
    await release.guard(run, 1);
    state.lock.progress = "tests passed";
    await release.save(state, run, "continue original release");
    assert.equal(
      f.state().tickets[2].transitions.at(-1).decision.status,
      "closed"
    );
    assert.equal(f.state().lock.progress, "tests passed");
    validateJournal(f.state(), profile);
  });

test("a ticket claimed by the release during cleanup observation is skipped without ticket writes", async () => {
  const f = pair(),
    release = journalFor(f),
    { state, run } = await release.acquire(
      await f.identity(),
      undefined,
      scope([1])
    );
  let reserved = false;
  const result = await cleanupInbox({
    ...f,
    selectionMode: "inbox",
    observe: async (entry, options) => {
      const observation = await inspectCleanup(entry, options);
      if (entry.issue_number === 2 && !reserved) {
        reserved = true;
        await release.reserveRelease(state, run, [1, 2]);
      }
      return observation;
    }
  });
  assert.equal(reserved, true);
  assert.equal(result.counts.closed, 0);
  assert.equal(f.second.state, "open");
  assert.ok(result.requests.find((item) => item.issue_number === 2).unchanged);
  assert.equal(
    f.calls.filter(
      (call) => call.method !== "GET" && call.path.startsWith("/issues/")
    ).length,
    0
  );
  assert.deepEqual(f.state().lock.reserved_tickets, [1, 2]);
});

test("cleanup's durable ticket claim blocks overlapping release selection and survives an uncertain ticket update", async () => {
  const f = pair(),
    release = journalFor(f),
    { state, run } = await release.acquire(
      await f.identity(),
      undefined,
      scope([1])
    );
  f.after = async ({ method, path }) => {
    if (method === "POST" && path === "/issues/2/comments")
      throw new Error("Lost comment response");
  };
  let resume;
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    (error) => {
      resume = error.cleanupRunId;
      return Boolean(resume);
    }
  );
  assert.equal(f.state().cleanup_lock.current_ticket, 2);
  await assert.rejects(
    release.reserveRelease(state, run, [1, 2]),
    /same ticket/u
  );
  state.lock.reserved_tickets = [1];
  run.reserved_tickets = [1];
  assert.equal(f.state().lock.token, run.token);
  assert.equal(f.second.state, "open");
  f.after = async () => {};
  await cleanupInbox({ ...f, selectionMode: "inbox", resume });
  assert.equal(f.second.state, "closed");
  assert.equal(f.state().cleanup_lock, null);
  assert.equal(
    f.comments.filter((comment) => comment.issue_number === 2).length,
    1
  );
  await release.guard(run, 1);
});

test("simultaneous saves retry only verified disjoint fast-forward contention without losing either lane", async () => {
  const f = pair(),
    release = journalFor(f),
    first = await release.acquire(await f.identity(), undefined, scope([1]));
  const cleanup = journalFor(f),
    second = await cleanup.acquire(
      await f.identity(),
      undefined,
      scope(null, true)
    );
  let raced = false;
  f.before = async ({ method, path }) => {
    if (
      !raced &&
      method === "PATCH" &&
      path === "/git/refs/heads/codex/inbox-state"
    ) {
      raced = true;
      first.state.lock.progress = "advanced during competing save";
      await release.save(first.state, first.run, "competing release save");
    }
  };
  assert.equal(await cleanup.claimTicket(second.state, second.run, 2), true);
  assert.equal(raced, true);
  assert.equal(f.state().lock.progress, "advanced during competing save");
  assert.equal(f.state().cleanup_lock.current_ticket, 2);
  assert.ok(
    f.calls
      .filter(
        (call) => call.method === "PATCH" && call.path.includes("/git/refs")
      )
      .every((call) => call.body.force === false)
  );
});

test("an own saved commit can be confirmed beneath subsequent unrelated release progress after a lost response", async () => {
  const f = pair(),
    release = journalFor(f),
    first = await release.acquire(await f.identity(), undefined, scope([1]));
  const cleanup = journalFor(f),
    second = await cleanup.acquire(
      await f.identity(),
      undefined,
      scope(null, true)
    );
  let lost = false;
  f.after = async ({ method, path }) => {
    if (
      !lost &&
      method === "PATCH" &&
      path === "/git/refs/heads/codex/inbox-state"
    ) {
      lost = true;
      first.state.lock.progress = "release advanced after cleanup commit";
      await release.save(first.state, first.run, "later release progress");
      throw new Error("Lost response");
    }
  };
  assert.equal(await cleanup.claimTicket(second.state, second.run, 2), true);
  assert.equal(f.state().cleanup_lock.current_ticket, 2);
  assert.equal(
    f.state().lock.progress,
    "release advanced after cleanup commit"
  );
});

test("same-ticket changes, unknown ownership and cleanup-token takeover stop writes", async () => {
  const f = pair(),
    release = journalFor(f),
    first = await release.acquire(await f.identity(), undefined, scope([1]));
  const cleanup = journalFor(f),
    second = await cleanup.acquire(
      await f.identity(),
      undefined,
      scope(null, true)
    );
  assert.equal(await cleanup.claimTicket(second.state, second.run, 1), false);
  const expected = ticketVersion(second.state, 2);
  await release.reserveRelease(first.state, first.run, [1, 2]);
  assert.equal(
    await cleanup.claimTicket(second.state, second.run, 2, expected),
    false
  );
  await release.reserveRelease(first.state, first.run, [1]);
  const takeover = journalFor(f);
  await takeover.acquire(
    await f.identity(),
    second.run.run_id,
    scope(null, true)
  );
  const before = f.calls.filter((call) => call.method !== "GET").length;
  await assert.rejects(
    cleanup.claimTicket(second.state, second.run, 2),
    /ownership changed|lock changed/u
  );
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, before);
});

test("an unselected full-inbox scan protects all tickets until the exact release reservation is saved", async () => {
  const f = pair(),
    release = journalFor(f),
    first = await release.acquire(await f.identity(), undefined, scope(null));
  const cleanup = journalFor(f),
    second = await cleanup.acquire(
      await f.identity(),
      undefined,
      scope(null, true)
    );
  assert.equal(await cleanup.claimTicket(second.state, second.run, 2), false);
  await release.reserveRelease(first.state, first.run, [1]);
  assert.equal(await cleanup.claimTicket(second.state, second.run, 2), true);
});

test("a competing ticket reservation at the final Git save is skipped without a stale local claim", async () => {
  const f = pair(),
    release = journalFor(f),
    first = await release.acquire(await f.identity(), undefined, scope([1]));
  const cleanup = journalFor(f),
    second = await cleanup.acquire(
      await f.identity(),
      undefined,
      scope(null, true)
    );
  let raced = false;
  f.before = async ({ method, path }) => {
    if (
      !raced &&
      method === "PATCH" &&
      path === "/git/refs/heads/codex/inbox-state"
    ) {
      raced = true;
      await release.reserveRelease(first.state, first.run, [1, 2]);
    }
  };
  assert.equal(await cleanup.claimTicket(second.state, second.run, 2), false);
  assert.equal(second.state.cleanup_lock.current_ticket, undefined);
  assert.equal(second.run.current_ticket, undefined);
  await cleanup.release(second.state, second.run);
  assert.deepEqual(f.state().lock.reserved_tickets, [1, 2]);
  assert.equal(f.state().cleanup_lock, null);
});

test("an ambiguous rejected transport never retries mutations just because the other lane advanced", async () => {
  const f = pair(),
    release = journalFor(f),
    first = await release.acquire(await f.identity(), undefined, scope([1]));
  const cleanup = journalFor(f),
    second = await cleanup.acquire(
      await f.identity(),
      undefined,
      scope(null, true)
    );
  let lost = false;
  f.before = async ({ method, path }) => {
    if (
      !lost &&
      method === "PATCH" &&
      path === "/git/refs/heads/codex/inbox-state"
    ) {
      lost = true;
      first.state.lock.progress = "unrelated progress";
      await release.save(
        first.state,
        first.run,
        "progress before lost request"
      );
      throw new Error("Unknown request outcome");
    }
  };
  const before = f.calls.filter(
    (call) => call.method === "PATCH" && call.path.includes("/git/refs")
  ).length;
  await assert.rejects(
    cleanup.claimTicket(second.state, second.run, 2),
    /Unknown request outcome/u
  );
  assert.equal(
    f.calls.filter(
      (call) => call.method === "PATCH" && call.path.includes("/git/refs")
    ).length - before,
    2
  );
  assert.equal(f.state().cleanup_lock.current_ticket, undefined);
  assert.equal(f.state().cleanup_lock.token, second.run.token);
  assert.equal(f.state().lock.progress, "unrelated progress");
});

for (const advances of [1, 3])
  test(`an unconfirmed own commit searches only the revision gap after ${advances} foreign saves on long history`, async () => {
    const f = pair(),
      release = journalFor(f),
      first = await release.acquire(await f.identity(), undefined, scope([1]));
    for (let index = 0; index < 40; index++) {
      first.state.lock.progress = `prior progress ${index}`;
      await release.save(first.state, first.run, "fixture prior history");
    }
    const cleanup = journalFor(f),
      second = await cleanup.acquire(
        await f.identity(),
        undefined,
        scope(null, true)
      );
    let interrupted = false,
      confirmationStart;
    f.before = async ({ method, path }) => {
      if (
        !interrupted &&
        method === "PATCH" &&
        path === "/git/refs/heads/codex/inbox-state"
      ) {
        interrupted = true;
        for (let index = 0; index < advances; index++) {
          first.state.lock.progress = `foreign progress ${index}`;
          await release.save(
            first.state,
            first.run,
            "fixture disjoint progress"
          );
        }
        confirmationStart = f.calls.length;
        throw new Error("Unknown request outcome");
      }
    };
    const before = f.calls.filter((call) => call.method === "PATCH").length;
    await assert.rejects(
      cleanup.claimTicket(second.state, second.run, 2),
      /Unknown request outcome/u
    );
    assert.equal(
      f.calls.filter((call) => call.method === "PATCH").length - before,
      advances + 1
    );
    assert.equal(
      f.calls
        .slice(confirmationStart)
        .filter((call) => call.path.startsWith("/git/commits/")).length,
      5 * advances
    );
    assert.equal(f.state().cleanup_lock.current_ticket, undefined);
    assert.equal(f.state().cleanup_lock.token, second.run.token);
    assert.equal(f.state().lock.progress, `foreign progress ${advances - 1}`);
  });

test("a changed ref observation stays verifiable when the other lane advances again during reread", async () => {
  const f = pair(),
    release = journalFor(f),
    first = await release.acquire(await f.identity(), undefined, scope([1]));
  const cleanup = journalFor(f),
    second = await cleanup.acquire(
      await f.identity(),
      undefined,
      scope(null, true)
    );
  let advanced = false;
  f.after = async ({ method, path }) => {
    if (
      !advanced &&
      method === "GET" &&
      path === "/git/ref/heads/codex/inbox-state"
    ) {
      advanced = true;
      second.state.cleanup_lock.progress = "later disjoint cleanup progress";
      await cleanup.save(
        second.state,
        second.run,
        "fixture progress after ref read"
      );
    }
  };
  await release.guard(first.run, 1);
  assert.equal(advanced, true);
  assert.equal(
    first.state.cleanup_lock.progress,
    "later disjoint cleanup progress"
  );
  assert.equal(f.state().lock.token, first.run.token);
});

for (const regressed of [false, true])
  test(`a ${regressed ? "regressed" : "rewritten same-revision"} head is rejected without searching old journal history`, async () => {
    const f = pair(),
      release = journalFor(f),
      first = await release.acquire(await f.identity(), undefined, scope([1]));
    for (let index = 0; index < 40; index++)
      await release.save(first.state, first.run, "fixture prior history");
    const prior = f.head;
    await release.save(first.state, first.run, "fixture latest snapshot");
    if (regressed) f.head = prior;
    else {
      const copy = "e".repeat(40);
      f.objects.set(copy, structuredClone(f.objects.get(f.head)));
      f.head = copy;
    }
    const before = f.calls.length;
    await assert.rejects(
      release.guard(first.run, 1),
      /history no longer descends/u
    );
    const calls = f.calls.slice(before);
    assert.equal(
      calls.filter((call) => call.path.startsWith("/git/commits/")).length,
      1
    );
    assert.ok(calls.every((call) => call.method === "GET"));
  });

test("a legacy release blocks activation and an interrupted legacy cleanup resumes in its original lane", async () => {
  const f = pair(),
    legacy = createJournal(f.api, f.profile, {
      workflow: inboxWorkflow,
      pause: async () => {}
    });
  const first = await legacy.acquire(await f.identity(), undefined, scope([1]));
  await assert.rejects(
    journalFor(f).acquire(await f.identity(), undefined, scope(null, true)),
    /legacy run/u
  );
  await legacy.release(first.state, first.run);
  const pending = await legacy.acquire(
    await f.identity(),
    undefined,
    scope(null, true)
  );
  const resumed = await journalFor(f).acquire(
    await f.identity(),
    pending.run.run_id,
    scope(null, true)
  );
  assert.equal(resumed.state.ticket_updates, undefined);
  assert.equal(resumed.state.cleanup_lock, undefined);
  assert.equal(resumed.state.lock.run_id, pending.run.run_id);
  assert.notEqual(resumed.run.token, pending.run.token);
});

test("full-inbox processing frees unselected tickets before deployment and never overwrites their concurrent cleanup", async () => {
  const h = harness(2, { databaseTickets: [1] }),
    originalRelease = h.options.release;
  let cleanupRan = false;
  h.options.release = async (options) => {
    assert.deepEqual(h.f.state().lock.reserved_tickets, [1]);
    assert.ok(h.f.issues[1].labels.includes("reason:batch-deferred"));
    const result = await cleanupInbox({
      ...h.options,
      selectionMode: "inbox",
      observe: async (entry) => ({
        checks: [],
        pull_requests: entry.request.release_parts.flatMap((part) =>
          part.pull_requests.map((pr) => ({
            part: part.id,
            repository: part.repository,
            number: pr.number,
            checks: [
              {
                id: "requested_code",
                status: "blocked",
                evidence: {
                  requested_commit: pr.commit,
                  current_commit: "e".repeat(40)
                }
              },
              { id: "source_repository", status: "pass" },
              { id: "observation_stability", status: "pass" }
            ]
          }))
        )
      })
    });
    assert.equal(result.counts.closed, 1);
    assert.equal(h.f.issues[0].state, "open");
    assert.equal(h.f.issues[1].state, "closed");
    cleanupRan = true;
    return originalRelease(options);
  };
  const result = await processInbox(h.options);
  assert.equal(cleanupRan, true);
  assert.deepEqual(result.batch.selected, [1]);
  const state = h.f.state();
  assert.equal(state.lock, null);
  assert.equal(state.cleanup_lock, null);
  assert.equal(
    state.tickets[1].transitions.at(-1).decision.status,
    "completed"
  );
  assert.equal(state.tickets[2].transitions.at(-1).decision.status, "closed");
  assert.ok(h.f.issues[1].labels.includes("reason:outdated-commit"));
  assert.ok(!h.f.issues[1].labels.includes("reason:batch-deferred"));
});

test("a regressed or unreadable journal ref cannot turn a changed-head guard into permission to write", async () => {
  for (const unreadable of [false, true]) {
    const f = pair(),
      original = f.api;
    let fakeHead;
    const api = async (call) => {
      if (
        fakeHead &&
        call.method === "GET" &&
        call.path === "/git/ref/heads/codex/inbox-state"
      ) {
        const head = fakeHead;
        fakeHead = null;
        return {
          status: 200,
          data: { object: { sha: unreadable ? "unreadable" : head } }
        };
      }
      return original(call);
    };
    const release = journalFor({ ...f, api }),
      first = await release.acquire(await f.identity(), undefined, scope([1]));
    const oldHead = f.head;
    const cleanup = journalFor(f);
    await cleanup.acquire(await f.identity(), undefined, scope(null, true));
    fakeHead = f.head;
    f.head = oldHead;
    const before = f.calls.filter((call) => call.method !== "GET").length;
    await assert.rejects(
      release.guard(first.run, 1),
      /lock changed|history no longer descends/u
    );
    assert.equal(
      f.calls.filter((call) => call.method !== "GET").length,
      before
    );
  }
});

test("resume settles the claimed ticket before revisiting earlier still-open actionable tickets", async () => {
  const f = pair(),
    setup = journalFor(f),
    first = await setup.acquire(await f.identity(), undefined, scope([1]));
  await setup.release(first.state, first.run);
  f.pr.headRefOid = "a".repeat(40);
  f.after = async ({ method, path }) => {
    if (method === "POST" && path === "/issues/2/comments")
      throw new Error("Interrupted ticket 2");
  };
  let resume;
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    (error) => {
      resume = error.cleanupRunId;
      return Boolean(resume);
    }
  );
  assert.equal(
    f.state().tickets[1].transitions.at(-1).decision.status,
    "action-needed"
  );
  assert.equal(f.state().cleanup_lock.current_ticket, 2);
  f.after = async () => {};
  const checked = [];
  await cleanupInbox({
    ...f,
    selectionMode: "inbox",
    resume,
    progress: (value) => {
      if (value.phase === "checking") checked.push(value.issue_number);
    }
  });
  assert.deepEqual(checked, [2, 1]);
  assert.equal(f.state().cleanup_lock, null);
  assert.equal(f.comments.length, 2);
  assert.ok(f.issues.every((issue) => issue.state === "open"));
});

test("a verified closed claimed ticket releases its reservation on resume before the next ticket", async () => {
  const f = pair(),
    setup = journalFor(f),
    first = await setup.acquire(await f.identity(), undefined, scope([1]));
  await setup.release(first.state, first.run);
  let stopped = false,
    resume;
  f.before = async ({ method, path, body }) => {
    if (!stopped && method === "POST" && path === "/git/blobs") {
      const record = JSON.parse(body.content);
      if (
        record.cleanup_lock?.current_ticket === undefined &&
        record.tickets[1]?.applied
      ) {
        stopped = true;
        throw new Error("Stopped before releasing ticket claim");
      }
    }
  };
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    (error) => {
      resume = error.cleanupRunId;
      return Boolean(resume);
    }
  );
  assert.equal(f.issue.state, "closed");
  assert.equal(f.state().cleanup_lock.current_ticket, 1);
  f.before = async () => {};
  await cleanupInbox({ ...f, selectionMode: "inbox", resume });
  assert.equal(f.second.state, "closed");
  assert.equal(f.state().cleanup_lock, null);
});
