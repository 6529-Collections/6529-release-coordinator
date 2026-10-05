import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./processing-fixture.mjs";
import {
  cleanupEvidence,
  closedCleanupEntry,
  inspectCleanup
} from "../src/inbox-cleanup-evidence.mjs";
import { cleanupInbox, decideCleanup } from "../src/inbox-cleanup.mjs";
import { createJournal, inboxWorkflow } from "../src/inbox-journal.mjs";
import { inspectIssue } from "../src/inbox-reader.mjs";
import { createReadinessGitHub } from "../src/readiness-github.mjs";
import { createInboxSelection } from "../src/inbox-selection.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { ensureLabels } from "../src/ticket-presentation.mjs";

const scope = {
  selection: createInboxSelection("inbox"),
  close_test: false,
  workflow: inboxWorkflow,
  cleanup: true
};
async function initialize(f) {
  const journal = createJournal(f.api, f.profile, { workflow: inboxWorkflow });
  const { state, run } = await journal.acquire(
    await f.identity(),
    undefined,
    scope
  );
  await journal.release(state, run);
  f.calls.length = 0;
}
function identities(f) {
  f.github.pullRequestIdentity = async () => ({
    ...structuredClone(f.pr),
    checks: []
  });
}

test("journal guards need one ref read and still reject changed ownership", async () => {
  const f = fixture();
  const journal = createJournal(f.api, f.profile, { workflow: inboxWorkflow });
  const { run } = await journal.acquire(await f.identity(), undefined, scope);
  f.calls.length = 0;
  await journal.guard(run);
  assert.deepEqual(
    f.calls.map(({ method, path }) => ({ method, path })),
    [{ method: "GET", path: "/git/ref/heads/codex/inbox-state" }]
  );
  await assert.rejects(
    journal.guard({ ...run, token: "another token" }),
    /lock changed/u
  );
  const other = createJournal(f.api, f.profile, { workflow: inboxWorkflow });
  await other.acquire(await f.identity(), run.run_id, scope);
  await assert.rejects(journal.guard(run), /lock changed/u);
});

test("intake reuse is bound to the exact receipt and never caches unknown proof", async () => {
  let inspections = 0;
  const evidence = cleanupEvidence({
    get: async () => {},
    github: {},
    inspect: async (issue) => {
      inspections++;
      return {
        status: issue.body === "unknown" ? "unverified" : "valid",
        errors: []
      };
    }
  });
  const issue = { id: 1, number: 1, body: "original" };
  const first = await evidence.inspect(issue, {});
  first.errors.push("not part of proof");
  assert.deepEqual((await evidence.inspect(issue, {})).errors, []);
  assert.equal(inspections, 1);
  await evidence.inspect({ ...issue, body: "changed" }, {});
  assert.equal(inspections, 2);
  await evidence.inspect({ ...issue, body: "unknown" }, {});
  await evidence.inspect({ ...issue, body: "unknown" }, {});
  assert.equal(inspections, 4);
});

test("only immutable logs and pinned catalogs are reused; mutable workflow reads and failures stay fresh", async () => {
  const reads = [],
    catalogs = [];
  let fail = true;
  const original = {
    get: async (path) => {
      reads.push(path);
      if (path.endsWith("/logs")) return "saved log";
      return { run_attempt: reads.length };
    },
    github: {
      catalog: async (commit) => {
        catalogs.push(commit);
        if (fail) {
          fail = false;
          throw new Error("temporary failure");
        }
        return { commit, catalog: { services: [] } };
      }
    },
    inspect: async () => {}
  };
  const evidence = cleanupEvidence(original);
  const log = "repos/example/actions/jobs/123/logs";
  await evidence.get(log);
  await evidence.get(log);
  assert.equal(reads.length, 1);
  const workflow = "repos/example/actions/runs/123";
  assert.notDeepEqual(
    await evidence.get(workflow),
    await evidence.get(workflow)
  );
  const commit = "a".repeat(40);
  await assert.rejects(evidence.github.catalog(commit), /temporary failure/u);
  const first = await evidence.github.catalog(commit);
  first.catalog.services.push("not in saved catalog");
  assert.deepEqual(
    (await evidence.github.catalog(commit)).catalog.services,
    []
  );
  assert.equal(catalogs.length, 2);
  await cleanupEvidence(original).get(log);
  assert.equal(reads.length, 4, "Resume starts with a new cache");
});

test("managed label existence is checked once per run while Issue labels stay freshly verified", async () => {
  const f = fixture(),
    verified = new Set();
  await ensureLabels(f.api, ["release-request", "status:closed"], verified);
  const calls = f.calls.length;
  await ensureLabels(f.api, ["release-request", "status:closed"], verified);
  assert.equal(f.calls.length, calls);
  await ensureLabels(f.api, ["release-request"], new Set());
  assert.equal(f.calls.length, calls + 1);
});

for (const profile of [realProfile, sandboxProfile]) {
  test(`${profile.name}: stable obsolete or merged code uses fresh identity reads without full readiness`, async () => {
    for (const merged of [false, true]) {
      const f = fixture(profile);
      const entry = await inspectIssue(f.issue, { get: f.get, profile });
      if (merged) f.pr.state = "MERGED";
      else f.pr.headRefOid = "e".repeat(40);
      let reads = 0;
      const github = {
        pullRequestIdentity: async () => {
          reads++;
          return { ...structuredClone(f.pr), checks: [] };
        },
        pullRequest: async () => assert.fail("Unneeded check/review read"),
        catalog: async () => assert.fail("Unneeded catalog read")
      };
      const observation = await inspectCleanup(entry, { github, profile });
      assert.equal(reads, 2);
      assert.equal(observation.release_authorized, false);
      assert.equal(observation.mode, "cleanup-identity");
      assert.equal(decideCleanup(entry, observation).status, "closed");
    }
  });
}

test("a current PR still gets full check/dependency evidence and pending checks need action", async () => {
  const f = fixture();
  identities(f);
  f.required.status = "IN_PROGRESS";
  f.required.conclusion = null;
  const entry = await inspectIssue(f.issue, { get: f.get, profile: f.profile });
  const observation = await inspectCleanup(entry, {
    github: f.github,
    profile: f.profile
  });
  const decision = decideCleanup(entry, observation);
  assert.equal(f.productCalls.length, 2);
  assert.equal(decision.status, "action-needed");
  assert.ok(decision.reasons.some(({ code }) => code === "checks-pending"));
});

test("moving or fork PR identities cannot establish an automatic closure", async () => {
  const f = fixture();
  const entry = await inspectIssue(f.issue, { get: f.get, profile: f.profile });
  f.pr.headRefOid = "e".repeat(40);
  let reads = 0;
  const github = {
    ...f.github,
    pullRequestIdentity: async () => {
      reads++;
      return {
        ...structuredClone(f.pr),
        headRefOid: (reads === 1 ? "e" : "f").repeat(40),
        checks: []
      };
    }
  };
  assert.equal(
    decideCleanup(
      entry,
      await inspectCleanup(entry, { github, profile: f.profile })
    ).status,
    "action-needed"
  );
  f.pr.headRepository.nameWithOwner = "outside/fork";
  identities(f);
  assert.equal(
    decideCleanup(
      entry,
      await inspectCleanup(entry, { github: f.github, profile: f.profile })
    ).status,
    "action-needed"
  );
});

test("a complete closure reuses scan proof and logs but rereads mutable workflow and PR evidence immediately before closing", async () => {
  const f = fixture();
  await initialize(f);
  identities(f);
  f.pr.state = "MERGED";
  const reads = [];
  const get = async (path) => {
    reads.push(path);
    return f.get(path);
  };
  await cleanupInbox({ ...f, get, selectionMode: "inbox" });
  assert.equal(f.issue.state, "closed");
  assert.equal(reads.filter((p) => /\/actions\/runs\/123$/u.test(p)).length, 2);
  assert.equal(reads.filter((p) => p.endsWith("/logs")).length, 1);
  assert.equal(f.productCalls.length, 0);
  assert.equal(f.state().lock, null);
});

test("a rerun of the intake workflow invalidates cached scan proof before closure", async () => {
  const f = fixture();
  await initialize(f);
  identities(f);
  f.pr.state = "MERGED";
  let workflowReads = 0;
  const get = async (path) => {
    if (/\/actions\/runs\/123$/u.test(path) && ++workflowReads === 2)
      return { ...structuredClone(f.run), status: "in_progress" };
    return f.get(path);
  };
  await assert.rejects(
    cleanupInbox({ ...f, get, selectionMode: "inbox" }),
    /evidence changed/u
  );
  assert.equal(f.issue.state, "open");
  assert.ok(f.state().cleanup_lock ?? f.state().lock);
});

test("closed, fully applied history needs no old submission reads; changed receipts or pending closure do", async () => {
  const f = fixture();
  await initialize(f);
  identities(f);
  f.pr.state = "MERGED";
  await cleanupInbox({ ...f, selectionMode: "inbox" });
  const ticket = f.state().tickets[1];
  assert.ok(closedCleanupEntry(f.issue, ticket, f.profile));
  assert.equal(
    closedCleanupEntry({ ...f.issue, state: "open" }, ticket, f.profile),
    null
  );
  assert.equal(
    closedCleanupEntry({ ...f.issue, body: "changed" }, ticket, f.profile),
    null
  );
  assert.equal(
    closedCleanupEntry(f.issue, { ...ticket, applied: null }, f.profile),
    null
  );
  const reads = [];
  const get = async (path) => {
    reads.push(path);
    return f.get(path);
  };
  const report = await cleanupInbox({ ...f, get, selectionMode: "inbox" });
  assert.equal(report.counts.unchanged, 1);
  assert.ok(!reads.some((path) => path.includes("/actions/")));
  assert.deepEqual(f.state().tickets[1], ticket);
});

test("source drift immediately before a lightweight closure retains ownership and safely resumes with an action", async () => {
  const f = fixture();
  await initialize(f);
  identities(f);
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
  f.after = async () => {};
  await cleanupInbox({ ...f, selectionMode: "inbox", resume });
  assert.equal(f.issue.state, "open");
  assert.ok(f.issue.labels.includes("status:action-needed"));
  assert.equal(f.comments.length, 1);
  assert.equal(f.state().lock, null);
});

test("the fixed lightweight GitHub query has no check pagination, catalogs or bypass discovery", async () => {
  const f = fixture(),
    calls = [];
  const github = createReadinessGitHub({
    execute: async (file, args) => {
      calls.push({ file, args });
      return {
        stdout: JSON.stringify({ data: { repository: { pullRequest: f.pr } } })
      };
    },
    approvalGitHub: {
      approvalBypass: async () => assert.fail("No bypass reads")
    }
  });
  const pr = await github.pullRequestIdentity("6529seize-backend", 10);
  assert.deepEqual(pr.checks, []);
  assert.equal(calls.length, 1);
  const query = calls[0].args.find((arg) => arg.startsWith("query="));
  assert.match(query, /CleanupPull/u);
  assert.doesNotMatch(query, /statusCheckRollup|cursor|mutation/u);
  await assert.rejects(
    github.pullRequestIdentity("outside-repository", 1),
    /Unsupported/u
  );
  assert.equal(calls.length, 1);
});
