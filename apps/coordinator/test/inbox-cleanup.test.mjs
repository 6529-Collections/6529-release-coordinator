import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./processing-fixture.mjs";
import { cleanupInbox, cleanupPolicyVersion } from "../src/inbox-cleanup.mjs";
import { runInboxCleanupCli } from "../src/inbox-cleanup-cli.mjs";
import {
  createJournal,
  inboxWorkflow,
  appendDecision,
  validateJournal
} from "../src/inbox-journal.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { createInboxSelection } from "../src/inbox-selection.mjs";

const scope = (cleanup = true) => ({
  selection: createInboxSelection("inbox"),
  close_test: false,
  workflow: inboxWorkflow,
  ...(cleanup ? { cleanup: true } : {})
});
const cleanupHeld = (f) => f.state().cleanup_lock ?? f.state().lock;
const writes = (f) => f.calls.filter((call) => call.method !== "GET");
const issueWrites = (f) =>
  writes(f).filter((call) => !call.path.startsWith("/git/"));
async function initialize(f) {
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false
  });
  const { state, run } = await journal.acquire(
    await f.identity(),
    undefined,
    scope()
  );
  await journal.release(state, run);
  f.calls.length = 0;
}

for (const profile of [realProfile, sandboxProfile]) {
  test(`${profile.name}: cleanup records a concrete action, preserves the receipt and is idempotent`, async () => {
    const f = fixture(profile);
    await initialize(f);
    const body = f.issue.body;
    const first = await cleanupInbox({ ...f, selectionMode: "inbox" });
    assert.deepEqual(first.counts, {
      closed: 0,
      action_needed: 1,
      unchanged: 0
    });
    assert.equal(first.release_executed, false);
    assert.deepEqual(
      f.issue.labels.filter((name) => name.startsWith("status:")),
      ["status:action-needed"]
    );
    assert.ok(f.issue.labels.includes("reason:release-action-required"));
    assert.ok(f.issue.labels.includes("user-note"));
    assert.equal(f.issue.body, body);
    assert.match(f.comments[0].body, /explicit scoped release/u);
    assert.match(f.comments[0].body, /Coordinator maintainers/u);
    const count = issueWrites(f).length;
    const transition = f.state().tickets[1].transitions[0];
    assert.equal(transition.policy_version, cleanupPolicyVersion);
    await cleanupInbox({ ...f, selectionMode: "inbox" });
    assert.equal(issueWrites(f).length, count);
    assert.equal(f.comments.length, 1);
    assert.equal(f.state().tickets[1].transitions.length, 1);
    assert.equal(f.state().lock, null);
    validateJournal(f.state(), profile);
  });
  test(`${profile.name}: stable outdated and exact already-merged requests close without a release claim`, async () => {
    for (const merged of [false, true]) {
      const f = fixture(profile);
      await initialize(f);
      if (merged) f.pr.state = "MERGED";
      else f.pr.headRefOid = "e".repeat(40);
      const result = await cleanupInbox({ ...f, selectionMode: "inbox" });
      assert.equal(result.counts.closed, 1);
      assert.equal(f.issue.state, "closed");
      assert.equal(f.issue.state_reason, "not_planned");
      assert.ok(
        f.issue.labels.includes(
          merged ? "reason:already-merged" : "reason:outdated-commit"
        )
      );
      assert.ok(!f.issue.labels.includes("status:completed"));
      assert.equal(f.state().lock, null);
      const history = structuredClone(f.state().tickets[1]);
      const count = issueWrites(f).length;
      await cleanupInbox({ ...f, selectionMode: "inbox" });
      assert.equal(issueWrites(f).length, count);
      assert.deepEqual(f.state().tickets[1], history);
    }
  });
}

test("pending checks become a named verification action, never Waiting or Eligible", async () => {
  const f = fixture();
  await initialize(f);
  f.required.status = "IN_PROGRESS";
  f.required.conclusion = null;
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  const decision = f.state().tickets[1].transitions.at(-1).decision;
  assert.equal(decision.status, "action-needed");
  assert.ok(
    decision.reasons.some((reason) => reason.code === "checks-pending")
  );
  assert.ok(!decision.action_owner.includes("Submitter"));
  assert.match(
    decision.next_action,
    /Check the required checks again before releasing/u
  );
});

test("unverified submissions get an action and never cause product reads or closure", async () => {
  const f = fixture();
  await initialize(f);
  f.issue.body = "Unverified request";
  const result = await cleanupInbox({ ...f, selectionMode: "inbox" });
  assert.equal(result.counts.action_needed, 1);
  assert.equal(f.productCalls.length, 0);
  assert.equal(f.issue.state, "open");
  assert.ok(f.issue.labels.includes("reason:request-unverified"));
});

test("unstable source observations cannot retire a request", async () => {
  const f = fixture();
  await initialize(f);
  let reads = 0;
  f.github.pullRequest = async () => ({
    ...structuredClone(f.pr),
    headRefOid: (++reads % 2 ? "e" : "f").repeat(40)
  });
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  assert.equal(f.issue.state, "open");
  assert.ok(f.issue.labels.includes("status:action-needed"));
  assert.ok(!f.issue.labels.includes("reason:outdated-commit"));
});

test("a stopped release is preserved as a handoff even if its source PR changed and merged", async () => {
  const f = fixture();
  await initialize(f);
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false,
    ticketConcurrency: true
  });
  const { state, run } = await journal.acquire(
    await f.identity(),
    undefined,
    scope(false)
  );
  const ticket = state.tickets[1];
  const last = ticket.transitions.at(-1);
  const previous = {
    ...structuredClone(last.decision),
    reasons: [
      {
        code: "release-stopped",
        message: "Staging changed after accepted tests.",
        action: "Inspect the affected environments.",
        owner: "Coordinator maintainers"
      }
    ],
    batch: {
      fingerprint: "a".repeat(64),
      status: "passed",
      message: "Candidate passed; release stopped.",
      selected: [1],
      release: { status: "needs-human", message: "Stopped", operations: [] }
    }
  };
  const { hash, ...record } = last;
  const stop = appendDecision(ticket, {
    ...record,
    policy_version: "inbox-run-2026-09-29",
    decision: previous,
    at: f.now().toISOString(),
    run_id: run.run_id
  });
  ticket.applied = stop.id;
  await journal.save(state, run, "record stopped fixture");
  await journal.release(state, run);
  const oldHistory = f.state().tickets[1].transitions;
  f.pr.state = "MERGED";
  f.pr.headRefOid = "e".repeat(40);
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  const updated = f.state().tickets[1];
  assert.equal(f.issue.state, "open");
  assert.deepEqual(updated.transitions.slice(0, oldHistory.length), oldHistory);
  assert.deepEqual(updated.transitions.at(-1).decision.batch, previous.batch);
  assert.match(
    updated.transitions.at(-1).decision.next_action,
    /remaining follow-up/u
  );
  assert.ok(f.issue.labels.includes("reason:release-stopped"));
  assert.ok(!f.issue.labels.includes("reason:outdated-commit"));
  validateJournal(f.state());
  const decisionCount = f.state().tickets[1].transitions.length;
  const updateCount = issueWrites(f).length;
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  assert.equal(f.state().tickets[1].transitions.length, decisionCount);
  assert.equal(issueWrites(f).length, updateCount);
});

async function stoppedTicketFixture() {
  const f = fixture();
  await initialize(f);
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false,
    ticketConcurrency: true
  });
  const { state, run } = await journal.acquire(
    await f.identity(),
    undefined,
    scope(false)
  );
  const ticket = state.tickets[1],
    last = ticket.transitions.at(-1);
  const { hash, ...record } = last;
  const stop = appendDecision(ticket, {
    ...record,
    policy_version: "inbox-run-stopped",
    run_id: run.run_id,
    decision: {
      ...last.decision,
      batch: {
        fingerprint: "a".repeat(64),
        status: "passed",
        message: "Stopped release",
        release: { status: "needs-human", message: "Stopped", operations: [] }
      }
    }
  });
  ticket.applied = stop.id;
  await journal.save(state, run, "record stopped fixture");
  await journal.release(state, run);
  return f;
}
const reconciledFollowup = () => ({
  status: "passed",
  checks: [
    {
      id: "all_followup",
      status: "pass",
      message: "Separate delivery and follow-up verified."
    }
  ],
  evidence: {
    profile: "real",
    delivery: {
      deployment: {
        id: 40,
        url: "https://github.com/6529-Collections/6529seize-frontend/actions/runs/40"
      }
    }
  }
});

test("verified later delivery closes with independent follow-up readback and preserves the stopped attempt", async () => {
  const f = await stoppedTicketFixture(),
    original = f.state().tickets[1].transitions;
  let reads = 0;
  const followup = async () => {
    reads++;
    return reconciledFollowup();
  };
  const result = await cleanupInbox({ ...f, selectionMode: "inbox", followup });
  assert.equal(result.counts.closed, 1);
  assert.equal(result.release_executed, false);
  assert.equal(f.issue.state, "closed");
  assert.equal(f.issue.state_reason, "not_planned");
  assert.equal(reads, 2);
  assert.deepEqual(
    f.state().tickets[1].transitions.slice(0, original.length),
    original
  );
  assert.equal(
    f.state().tickets[1].transitions.at(-1).decision.batch.release.status,
    "needs-human"
  );
  assert.ok(f.issue.labels.includes("reason:release-reconciled"));
  assert.ok(!f.issue.labels.includes("status:completed"));
});

test("changed follow-up evidence before closure retains the lane; resume replaces intent with a specific action", async () => {
  const f = await stoppedTicketFixture();
  let reads = 0,
    resume;
  const followup = async () =>
    ++reads === 1
      ? reconciledFollowup()
      : {
          status: "unknown",
          checks: [
            {
              id: "staging_followup",
              status: "unknown",
              message: "Staging tests no longer match.",
              action: "Verify the current staging version."
            }
          ],
          evidence: { profile: "real" }
        };
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox", followup }),
    (error) => {
      resume = error.cleanupRunId;
      return /evidence changed/u.test(error.message);
    }
  );
  assert.equal(f.issue.state, "open");
  assert.equal(cleanupHeld(f).run_id, resume);
  await cleanupInbox({ ...f, selectionMode: "inbox", followup, resume });
  assert.equal(f.issue.state, "open");
  assert.equal(f.state().lock, null);
  assert.ok(f.issue.labels.includes("reason:release-followup-required"));
  assert.match(f.comments[0].body, /Verify the current staging version/u);
});

test("modern readers preserve source history and the cooperative marker fences older writers", async () => {
  const f = fixture();
  await initialize(f);
  await assert.rejects(
    createJournal(f.api, f.profile, { allowSourceHistory: false }).read(),
    /Unsupported/u
  );
  f.pr.state = "MERGED";
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  assert.equal(f.state().source_history, "original-pr-v1");
  assert.equal(f.state().ticket_updates, "cooperative-v1");
  assert.equal(f.issue.state, "closed");
  const count = writes(f).length;
  await assert.rejects(
    createJournal(f.api, f.profile, {
      workflow: inboxWorkflow,
      ticketConcurrency: false
    }).acquire(await f.identity(), undefined, scope(false)),
    /updated Cooperative/u
  );
  assert.equal(writes(f).length, count);
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    ticketConcurrency: true,
    archiveOnRelease: false
  });
  const acquired = await journal.acquire(
    await f.identity(),
    undefined,
    scope(false)
  );
  delete acquired.state.source_history;
  const before = writes(f).length;
  await assert.rejects(
    journal.save(acquired.state, acquired.run, "remove marker"),
    /marker must be preserved/u
  );
  assert.equal(writes(f).length, before);
});

test("the active lane refuses cleanup before any writes; cleanup cannot resume a release", async () => {
  const f = fixture();
  await initialize(f);
  const journal = createJournal(f.api, f.profile, { workflow: inboxWorkflow });
  const { run } = await journal.acquire(
    await f.identity(),
    undefined,
    scope(false)
  );
  const count = writes(f).length;
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    /locked by run/u
  );
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox", resume: run.run_id }),
    /currently locked cleanup/u
  );
  assert.equal(writes(f).length, count);
  assert.equal(cleanupHeld(f).run_id, run.run_id);
});

test("inbox:run cannot resume an interrupted cleanup or rotate its lock", async () => {
  const f = fixture();
  await initialize(f);
  const journal = createJournal(f.api, f.profile, { workflow: inboxWorkflow });
  const { run } = await journal.acquire(await f.identity(), undefined, scope());
  const count = writes(f).length;
  await assert.rejects(
    journal.acquire(await f.identity(), run.run_id),
    /cleanup run can only resume/u
  );
  assert.equal(writes(f).length, count);
  assert.equal(cleanupHeld(f).token, run.token);
});

test("missing history refuses cleanup without creating a new journal", async () => {
  const f = fixture();
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    /existing current-profile inbox journal/u
  );
  assert.equal(writes(f).length, 0);
});

test("stopped cleanup closeout preserves applied progress and releases without reacquiring or touching tickets", async () => {
  const f = fixture();
  await initialize(f);
  f.pr.state = "MERGED";
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false
  });
  journal.release = async () => {
    throw new Error("Operator stopped before closeout");
  };
  await assert.rejects(
    cleanupInbox({ ...f, journal, selectionMode: "inbox" }),
    /stopped/u
  );
  const prior = structuredClone(f.state());
  const head = f.head;
  f.calls.length = 0;
  f.productCalls.length = 0;
  const closeout = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false
  });
  const saved = await closeout.releaseStoppedCleanup(prior.lock.run_id, head);
  assert.equal(saved.state.lock, null);
  assert.deepEqual(saved.state.tickets, prior.tickets);
  assert.equal(saved.state.revision, prior.revision + 1);
  assert.equal(saved.state.parent, head);
  assert.equal(issueWrites(f).length, 0);
  assert.equal(f.productCalls.length, 0);
  const commits = writes(f).filter(({ path }) => path === "/git/commits");
  assert.equal(commits.length, 1);
  assert.equal(
    commits[0].body.message,
    `Inbox journal: release ${prior.lock.run_id}`
  );
});

test("stopped cleanup closeout refuses pending ticket intent without writes", async () => {
  const f = fixture();
  await initialize(f);
  f.pr.state = "MERGED";
  f.before = async ({ method, path }) => {
    if (method === "PATCH" && path === "/issues/1")
      throw new Error("Uncertain ticket write");
  };
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    /partial/u
  );
  const count = writes(f).length;
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false
  });
  await assert.rejects(
    journal.releaseStoppedCleanup(cleanupHeld(f).run_id, f.head),
    /unsettled/u
  );
  assert.equal(writes(f).length, count);
  assert.ok(cleanupHeld(f));
});

test("stopped cleanup closeout rejects wrong run, stale head, release ownership and archiving", async () => {
  for (const scenario of ["wrong-run", "stale-head", "release", "archive"]) {
    const f = fixture();
    await initialize(f);
    const journal = createJournal(f.api, f.profile, {
      workflow: inboxWorkflow,
      archiveOnRelease: false
    });
    const { run } = await journal.acquire(
      await f.identity(),
      undefined,
      scope(scenario !== "release")
    );
    const count = writes(f).length;
    const closeout = createJournal(f.api, f.profile, {
      workflow: inboxWorkflow,
      archiveOnRelease: scenario === "archive"
    });
    await assert.rejects(
      closeout.releaseStoppedCleanup(
        scenario === "wrong-run" ? "different-run" : run.run_id,
        scenario === "stale-head" ? "f".repeat(40) : f.head
      ),
      /journal/u
    );
    assert.equal(writes(f).length, count);
    assert.equal(cleanupHeld(f).token, run.token);
  }
});

test("stopped cleanup closeout rechecks the pinned head before its release write", async () => {
  const f = fixture();
  await initialize(f);
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false
  });
  const { run } = await journal.acquire(await f.identity(), undefined, scope());
  const head = f.head,
    count = writes(f).length;
  let refs = 0;
  f.before = async ({ method, path }) => {
    if (
      method === "GET" &&
      path === "/git/ref/heads/codex/inbox-state" &&
      ++refs === 2
    )
      f.head = "f".repeat(40);
  };
  const closeout = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false
  });
  await assert.rejects(
    closeout.releaseStoppedCleanup(run.run_id, head),
    /lock changed/u
  );
  assert.equal(writes(f).length, count);
});

test("filtered cleanup updates only its verified selection; a wrong actor does not acquire a lock", async () => {
  const f = fixture();
  await initialize(f);
  const hidden = {
    ...structuredClone(f.issue),
    id: 1002,
    number: 2,
    title: "Unselected request"
  };
  f.issues.push(hidden);
  const original = structuredClone(hidden);
  const count = writes(f).length;
  await assert.rejects(
    cleanupInbox({
      ...f,
      selectionMode: "filtered",
      issueNumbers: [1],
      actorLogin: "wrong-user"
    }),
    /selected actor/u
  );
  assert.equal(writes(f).length, count);
  assert.equal(f.state().lock, null);
  const result = await cleanupInbox({
    ...f,
    selectionMode: "filtered",
    issueNumbers: [1],
    actorLogin: "trusted-user"
  });
  assert.deepEqual(
    result.requests.map((item) => item.issue_number),
    [1]
  );
  assert.deepEqual(hidden, original);
  assert.ok(!f.state().tickets[2]);
  assert.equal(f.state().lock, null);
});

test("a failure before the first decision preserves the original error and resumable cleanup claim", async () => {
  const f = fixture();
  await initialize(f);
  const journal = createJournal(f.api, f.profile, {
    workflow: inboxWorkflow,
    archiveOnRelease: false,
    ticketConcurrency: true
  });
  const acquire = journal.acquire.bind(journal);
  let working, resume;
  journal.acquire = async (...args) => {
    const result = await acquire(...args);
    working = result.state;
    return result;
  };
  await assert.rejects(
    cleanupInbox({
      ...f,
      selectionMode: "inbox",
      journal,
      now: () => {
        if (working?.tickets[1]?.transitions.length === 0)
          throw new Error("Clock unavailable before first decision");
        return f.now();
      }
    }),
    (error) => {
      resume = error.cleanupRunId;
      assert.match(error.message, /Clock unavailable before first decision/u);
      assert.equal(
        error.cause.message,
        "Clock unavailable before first decision"
      );
      return Boolean(resume);
    }
  );
  assert.equal(issueWrites(f).length, 0);
  assert.equal(f.state().tickets[1], undefined);
  assert.equal(cleanupHeld(f).run_id, resume);
  assert.equal(cleanupHeld(f).current_ticket, 1);
  await cleanupInbox({ ...f, selectionMode: "inbox", resume });
  assert.equal(cleanupHeld(f), null);
  assert.equal(f.state().tickets[1].transitions.length, 1);
  assert.equal(f.comments.length, 1);
});

test("a failed error timestamp never masks a partial ticket update or loses its resume identity", async () => {
  const f = fixture();
  await initialize(f);
  let interrupted = false,
    resume;
  f.after = async ({ method, path }) => {
    if (!interrupted && method === "POST" && path === "/issues/1/comments") {
      interrupted = true;
      throw new Error("Lost ticket comment response");
    }
  };
  await assert.rejects(
    cleanupInbox({
      ...f,
      selectionMode: "inbox",
      now: () => {
        if (interrupted) throw new Error("Error timestamp unavailable");
        return f.now();
      }
    }),
    (error) => {
      resume = error.cleanupRunId;
      assert.match(error.message, /Lost ticket comment response/u);
      assert.equal(error.cause.message, "Lost ticket comment response");
      return Boolean(resume);
    }
  );
  assert.equal(cleanupHeld(f).run_id, resume);
  assert.equal(cleanupHeld(f).current_ticket, 1);
  assert.equal(f.state().tickets[1].transitions.length, 1);
  f.after = async () => {};
  await cleanupInbox({ ...f, selectionMode: "inbox", resume });
  assert.equal(cleanupHeld(f), null);
  assert.equal(f.state().tickets[1].transitions.length, 1);
  assert.equal(f.comments.length, 1);
});

test("a lost closure response retains ownership; resume verifies the same decision without duplication", async () => {
  const f = fixture();
  await initialize(f);
  f.pr.state = "MERGED";
  let lost = false;
  f.after = async ({ method, path, body }) => {
    if (
      !lost &&
      method === "PATCH" &&
      path === "/issues/1" &&
      body.state === "closed"
    ) {
      lost = true;
      throw new Error("Lost response");
    }
  };
  let resume;
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    (error) => {
      resume = error.cleanupRunId;
      return /partial/u.test(error.message);
    }
  );
  assert.equal(f.issue.state, "closed");
  assert.equal(cleanupHeld(f).run_id, resume);
  assert.ok(f.state().tickets[1].application_error);
  f.after = async () => {};
  await cleanupInbox({ ...f, selectionMode: "inbox", resume });
  assert.equal(f.state().lock, null);
  assert.equal(f.state().tickets[1].application_error, undefined);
  assert.equal(f.state().tickets[1].transitions.length, 1);
  assert.equal(f.comments.length, 1);
});

test("closure evidence is rechecked immediately; resume can replace an unapplied stale closure with an action", async () => {
  const f = fixture();
  await initialize(f);
  f.pr.headRefOid = "e".repeat(40);
  f.after = async ({ method, path }) => {
    if (method === "POST" && path === "/issues/1/comments")
      f.pr.headRefOid = "a".repeat(40);
  };
  let resume;
  await assert.rejects(
    cleanupInbox({ ...f, selectionMode: "inbox" }),
    (error) => {
      resume = error.cleanupRunId;
      return /evidence changed/u.test(error.message);
    }
  );
  assert.equal(f.issue.state, "open");
  assert.equal(cleanupHeld(f).run_id, resume);
  f.after = async () => {};
  await cleanupInbox({ ...f, selectionMode: "inbox", resume });
  assert.equal(f.issue.state, "open");
  assert.deepEqual(
    f.issue.labels.filter((name) => name.startsWith("status:")),
    ["status:action-needed"]
  );
  assert.equal(f.state().tickets[1].transitions.length, 2);
  assert.equal(f.state().lock, null);
});

test("CLI requires explicit profile/scope, accepts only cleanup arguments and makes help read-only", async () => {
  let output = "",
    calls = 0;
  const deps = {
    env: {},
    stdout: (value) => {
      output += value;
    },
    stderr: (value) => {
      output += value;
    },
    run: async () => {
      calls++;
    }
  };
  assert.equal(await runInboxCleanupCli(["--help"], deps), 0);
  assert.equal(await runInboxCleanupCli(["--json"], deps), 2);
  assert.equal(calls, 0);
  assert.match(output, /PROFILE/u);
  for (const args of [
    ["--resume", "bad"],
    ["--issue", "1", "--json"],
    ["--deploy"],
    ["--issue", "1", "--issue", "1", "--actor", "trusted-user"]
  ]) {
    assert.equal(
      await runInboxCleanupCli(args, {
        ...deps,
        env: {
          RELEASE_COORDINATOR_PROFILE: "real",
          RELEASE_COORDINATOR_SCOPE: "filtered"
        }
      }),
      2
    );
  }
  assert.equal(calls, 0);
});
