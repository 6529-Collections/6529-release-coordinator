import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./processing-fixture.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { createJournal, validateJournal } from "../src/inbox-journal.mjs";
import { saveOrganizedReleaseRequestIssue } from "../src/ticket-presentation.mjs";
import { createCoordinatorGitHub } from "../src/coordinator-github.mjs";
import { runProcessingCli } from "../src/processing-cli.mjs";
import { readInbox } from "../src/inbox-reader.mjs";
import { runCli } from "../src/cli.mjs";

const issueWrites = f => f.calls.filter(call => call.method !== "GET" && !call.path.startsWith("/git/"));
const processOne = (f, extra = {}) => processInbox({ ...f, issueNumber: 1, ...extra });
const intake = f => ({ request: f.request, actor: f.actor.login, actorId: String(f.actor.id),
  workflowRunUrl: f.run.html_url, submittedAt: f.request.created_at, githubRequest: f.api });

test("new intake creates readable scope, received status, verified assignment, and one separate comment", async () => {
  const f = fixture(); f.issues.length = 0;
  const saved = await saveOrganizedReleaseRequestIssue(intake(f));
  const issue = f.issues[0];
  assert.equal(saved.issue.created, true);
  assert.equal(issue.title, "Staging · backend PR #10 · api, dbMigrationsLoop");
  assert.deepEqual(issue.labels, ["component:backend", "release-request", "status:received", "target:staging"]);
  assert.equal(issue.assignees[0].id, f.actor.id);
  assert.equal(f.comments.length, 1);
  assert.match(f.comments[0].body, /None currently required/);
  assert.equal(saved.presentation.comment_id, f.comments[0].id);
  assert.deepEqual(saved.presentation.warnings, []);
  const original = issue.body;
  for (const state of ["open", "closed"]) {
    issue.state = state; issue.labels = ["release-request", "status:closed", "reason:test"];
    const before = issueWrites(f).length;
    const retry = await saveOrganizedReleaseRequestIssue(intake(f));
    assert.equal(retry.issue.created, false); assert.equal(issue.state, state);
    assert.equal(issueWrites(f).length, before); assert.equal(f.comments.length, 1); assert.equal(issue.body, original);
  }
  f.request.database_change = "yes";
  await assert.rejects(saveOrganizedReleaseRequestIssue(intake(f)), /different|checksum/iu);
});

test("processing legacy intake preserves receipt and unrelated labels; waiting stays readable and unchanged retry writes no tickets", async () => {
  const f = fixture(), body = f.issue.body;
  const first = await processOne(f);
  assert.equal(first.requests[0].status, "waiting"); assert.equal(first.release_authorized, false);
  assert.equal(f.issue.body, body); assert.equal(f.issue.state, "open");
  assert.ok(f.issue.labels.includes("user-note")); assert.ok(!f.issue.labels.includes("pending"));
  assert.deepEqual(f.issue.labels.filter(value => value.startsWith("status:")), ["status:waiting"]);
  assert.equal((await readInbox(f)).counts.pending, 1);
  assert.equal(f.comments.length, 1);
  const before = issueWrites(f).length, transition = f.state().tickets[1].transitions[0].id;
  const second = await processOne(f);
  assert.equal(issueWrites(f).length, before); assert.equal(f.comments.length, 1);
  assert.equal(second.requests[0].transition_id, transition);
  assert.equal(f.state().tickets[1].transitions.length, 1); assert.equal(f.state().lock, null);
});

test("processor adopts only the exact comment identity proven by the intake workflow", async () => {
  const f = fixture(); f.issues.length = 0;
  const saved = await saveOrganizedReleaseRequestIssue(intake(f)); f.result.inbox_presentation = saved.presentation;
  f.comments.push({ id: 8000, issue_number: 1, user: { id: 999 }, body: f.comments[0].body });
  await processOne(f);
  assert.equal(f.comments.length, 2); assert.equal(f.state().tickets[1].comment.id, saved.presentation.comment_id);
  assert.match(f.comments[0].body, /Status:\*\* waiting/); assert.match(f.comments[1].body, /Status:\*\* received/);
});

test("stable outdated code closes with evidence and retains terminal history through reopening and label removal", async () => {
  const f = fixture(); f.pr.headRefOid = "e".repeat(40);
  await processOne(f);
  assert.equal(f.issue.state, "closed"); assert.ok(f.issue.labels.includes("reason:outdated-commit"));
  assert.ok(!f.issue.labels.includes("reason:replaced"));
  assert.match(f.comments[0].body, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.match(f.comments[0].body, /eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/);
  f.issue.state = "open"; f.issue.labels = ["user-note"]; f.pr.headRefOid = "a".repeat(40);
  await processInbox(f);
  assert.equal(f.issue.state, "closed"); assert.equal(f.state().tickets[1].transitions.length, 1);
  assert.ok(f.issue.labels.includes("user-note"));
});

test("moving PR evidence never becomes automatic closure", async () => {
  const f = fixture(); let calls = 0;
  f.github.pullRequest = async () => ({ ...structuredClone(f.pr), headRefOid: (++calls % 2 ? "e" : "f").repeat(40) });
  await processOne(f);
  assert.equal(f.issue.state, "open"); assert.ok(f.issue.labels.includes("reason:coordinator-incomplete"));
  assert.ok(!f.issue.labels.includes("reason:outdated-commit"));
});

test("closure evidence is rechecked after journaling; changed facts leave an explicit partial run", async () => {
  const f = fixture(); f.pr.headRefOid = "e".repeat(40);
  f.after = async call => { if (call.method === "POST" && call.path === "/issues/1/comments") f.pr.headRefOid = "a".repeat(40); };
  await assert.rejects(processOne(f), /evidence changed before closure/);
  assert.equal(f.issue.state, "open"); assert.ok(f.state().lock); assert.equal(f.state().tickets[1].applied, null);
  f.after = async () => {};
  await processInbox({ ...f, resume: f.state().lock.run_id });
  assert.equal(f.issue.state, "open"); assert.ok(!f.issue.labels.includes("reason:outdated-commit"));
  assert.equal(f.state().tickets[1].transitions.length, 2); assert.equal(f.comments.length, 1);
});

for (const [name, change, status] of [
  ["missing proof", f => { f.run.conclusion = "failure"; }, "waiting"],
  ["contradictory proof", f => { f.result.github.actor_id = "999"; }, "action-needed"]
]) test(`${name} stays visible without product reads, assignment, or closure`, async () => {
  const f = fixture(); change(f); await processOne(f);
  assert.equal(f.issue.state, "open"); assert.ok(f.issue.labels.includes(`status:${status}`));
  assert.ok(f.issue.labels.includes("reason:request-unverified")); assert.equal(f.issue.assignees.length, 0);
  assert.equal(f.productCalls.length, 0); assert.match(f.comments[0].body, /Coordinator maintainers/);
});

test("merged code waits for deployment evidence and never becomes completed", async () => {
  const f = fixture(); f.pr.state = "MERGED";
  await processOne(f);
  assert.equal(f.issue.state, "open"); assert.ok(f.issue.labels.includes("status:waiting"));
  assert.ok(f.issue.labels.includes("reason:deployment-unverified"));
  assert.ok(!f.issue.labels.includes("status:completed")); assert.match(f.comments[0].body, /None currently required/);
});

test("an active intake workflow finishes its own setup before the processor can write", async () => {
  const f = fixture(); f.run.status = "in_progress"; f.run.conclusion = null;
  const report = await processOne(f);
  assert.equal(report.requests[0].status, "intake-running"); assert.equal(issueWrites(f).length, 0);
  assert.equal(f.productCalls.length, 0); assert.equal(f.state().lock, null);
});

test("new intake keeps its accepted receipt when assignment is unavailable", async () => {
  const f = fixture(); f.issues.length = 0; f.eligible = [];
  const saved = await saveOrganizedReleaseRequestIssue(intake(f));
  assert.equal(saved.issue.created, true); assert.equal(f.issues.length, 1); assert.equal(f.comments.length, 1);
  assert.ok(saved.presentation.warnings.length); assert.match(f.comments[0].body, /accepted request is preserved/);
});

test("an uncertain initial comment POST is bound by workflow proof and recovered without duplication", async () => {
  const f = fixture(); f.issues.length = 0;
  f.after = async call => { if (call.method === "POST" && call.path === "/issues/1/comments") throw new Error("Lost initial response"); };
  const saved = await saveOrganizedReleaseRequestIssue(intake(f));
  assert.equal(saved.presentation.comment_id, null); assert.equal(f.comments.length, 1);
  f.after = async () => {}; f.result.inbox_presentation = saved.presentation;
  await processOne(f);
  assert.equal(f.comments.length, 1); assert.equal(f.state().tickets[1].comment.id, f.comments[0].id);
});

test("invalid dependency scope names the submitter while missing prerequisites name maintainers", async () => {
  for (const [units, reason, status] of [[['api', 'typo'], 'invalid-dependencies', 'action-needed'], [['api'], 'prerequisite-unverified', 'waiting']]) {
    const f = fixture();
    // Model a new accepted request, not an edit made after verification.
    f.request.release_parts[0].deploy_units = units; f.result.request = structuredClone(f.request);
    const { buildReleaseRequestIssueBody, releaseRequestChecksum } = await import('../../../packages/release-request/src/inbox-issue.mjs');
    f.issue.body = buildReleaseRequestIssueBody({ ...intake(f), checksum: releaseRequestChecksum(f.request) });
    await processOne(f);
    assert.ok(f.issue.labels.includes(`reason:${reason}`)); assert.ok(f.issue.labels.includes(`status:${status}`));
  }
});

test("overlap is explained without choosing the newest or replacing either request", async () => {
  const f = fixture(); const { inspectIssue } = await import('../src/inbox-reader.mjs');
  const entry = await inspectIssue(f.issue, f);
  const other = structuredClone(entry); other.issue_number = 2; other.request.request_id = '33333333-3333-4333-8333-333333333333';
  await processOne(f, { loadInbox: async () => ({ requests: [entry, other] }) });
  assert.ok(f.issue.labels.includes('reason:overlapping-requests')); assert.equal(f.issue.state, 'open');
  assert.ok(!f.issue.labels.includes('reason:replaced')); assert.match(f.comments[0].body, /issue\\_numbers/);
});

test("failed and pending checks have different owners; resolved reasons disappear while history remains", async () => {
  const f = fixture(); f.required.conclusion = "FAILURE";
  await processOne(f); assert.ok(f.issue.labels.includes("status:action-needed")); assert.ok(f.issue.labels.includes("reason:checks-failed"));
  f.required.conclusion = null; f.required.status = "IN_PROGRESS";
  await processOne(f); assert.ok(f.issue.labels.includes("reason:checks-pending")); assert.ok(!f.issue.labels.includes("reason:checks-failed"));
  assert.ok(f.issue.labels.includes("status:waiting"));
  f.required.conclusion = "SUCCESS"; f.required.status = "COMPLETED";
  await processOne(f); assert.ok(!f.issue.labels.includes("reason:checks-pending"));
  assert.equal(f.state().tickets[1].transitions.length, 3); assert.equal(f.comments.length, 1);
});

test("assignment failure keeps the accepted request and supplies verified-identity lookup", async () => {
  const f = fixture(); f.eligible = [{ login: f.actor.login, id: 999 }];
  const result = await processOne(f);
  assert.equal(result.requests[0].assignment, "unavailable"); assert.equal(f.issue.assignees.length, 0);
  assert.equal(f.calls.some(call => call.method === "POST" && call.path.endsWith("/assignees")), false);
  assert.match(f.comments[0].body, /inbox:read -- --submitter trusted-user/);
  const output = [];
  assert.equal(await runCli(["--json", "--submitter", "trusted-user"], { get: f.get, stdout: value => output.push(value) }), 0);
  assert.equal(JSON.parse(output.join("")).requests.length, 1);
});

test("a lost comment response resumes the same scope and comment without a duplicate decision", async () => {
  const f = fixture(); let failed = false;
  f.after = async call => { if (!failed && call.method === "POST" && call.path === "/issues/1/comments") { failed = true; throw new Error("Response lost"); } };
  await assert.rejects(processOne(f), /Response lost/);
  const state = f.state(), run = state.lock.run_id;
  assert.equal(state.tickets[1].applied, null); assert.equal(f.comments.length, 1);
  await assert.rejects(processOne(f), /locked by run/);
  // A later reader could discover other real tickets; scoped resume must not touch them.
  f.issues.push({ ...structuredClone(f.issue), id: 1002, number: 2, labels: ["user-note"] });
  await processInbox({ ...f, resume: run });
  assert.equal(f.comments.length, 1); assert.equal(f.state().tickets[1].transitions.length, 1);
  assert.deepEqual(f.issues[1].labels, ["user-note"]); assert.equal(f.state().lock, null);
});

test("a lost close response resumes and verifies the explicit test disposition", async () => {
  const f = fixture(); let failed = false;
  f.after = async call => { if (!failed && call.method === "PATCH" && call.body.state === "closed") { failed = true; throw new Error("Close response lost"); } };
  await assert.rejects(processOne(f, { closeTest: true }), /Close response lost/);
  assert.equal(f.issue.state, "closed");
  await processInbox({ ...f, resume: f.state().lock.run_id });
  assert.ok(f.issue.labels.includes("reason:test")); assert.equal(f.state().tickets[1].transitions.length, 1); assert.equal(f.state().lock, null);
  const writes = issueWrites(f).length;
  await processOne(f); assert.equal(issueWrites(f).length, writes);
});

test("test labels or titles are not closure authority and another operator cannot retire someone else's test", async () => {
  const f = fixture(); f.issue.title = "TEST CANCELLED COMPLETED"; f.issue.labels.push("reason:test", "status:completed");
  await processOne(f); assert.equal(f.issue.state, "open"); assert.ok(!f.issue.labels.includes("reason:test"));
  await assert.rejects(processOne(f, { closeTest: true, identity: async () => ({ login: "other", id: "999" }) }), /operator's verified request/);
  assert.equal(f.issue.state, "open");
});

test("receipt edits and corrupted decision history fail closed", async () => {
  const f = fixture(); await processOne(f);
  const state = f.state(); state.tickets[1].transitions[0].decision.status = "completed";
  assert.throws(() => validateJournal(state), /Broken decision history/);
  const binding = f.state(); binding.tickets[1].submitter.id = "999";
  assert.throws(() => validateJournal(binding), /identity differs/);
  const active = f.state(); active.tickets[1].execution_owner = "future-worker";
  assert.throws(() => validateJournal(active), /unsupported ticket history\/ownership/);
  const writes = issueWrites(f).length; f.issue.body += "\nEdited";
  await assert.rejects(processOne(f), /receipt differs/);
  assert.equal(issueWrites(f).length, writes);
});

test("two machines cannot both acquire the journal; a stale writer cannot pass its guard", async () => {
  const f = fixture(); const a = createJournal(f.api), b = createJournal(f.api);
  const actor = await f.identity(), scope = { issue_number: 1, close_test: false };
  const results = await Promise.allSettled([a.acquire(actor, undefined, scope), b.acquire(actor, undefined, scope)]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  assert.equal(results.filter(value => value.status === "rejected").length, 1);
  const old = results.find(value => value.status === "fulfilled").value.run;
  const original = results[0].status === "fulfilled" ? a : b;
  const resumed = createJournal(f.api);
  await resumed.acquire(actor, old.run_id);
  await assert.rejects(original.guard(old), /lock changed/);
});

test("an already closed legacy test is not reopened, reset, or invented as completed", async () => {
  const f = fixture(); f.issue.state = "closed";
  const result = await processOne(f);
  assert.equal(result.requests[0].applied, false); assert.equal(issueWrites(f).length, 0);
  assert.deepEqual(f.state().tickets, {}); assert.equal(f.issue.state, "closed");
});

test("write adapter refuses arbitrary repositories, receipt edits, force pushes, and unknown label deletion", async () => {
  const client = createCoordinatorGitHub({ execute: async () => assert.fail("must not execute") });
  for (const call of [
    { method: "PATCH", path: "/issues/1", body: { body: "edited receipt" } },
    { method: "DELETE", path: "/issues/1/labels/user-note" },
    { method: "PATCH", path: "/git/refs/heads/main", body: { sha: "a".repeat(40), force: false } },
    { method: "PATCH", path: "/git/refs/heads/codex/inbox-state", body: { sha: "a".repeat(40), force: true } },
    { method: "GET", path: "https://other.example/secret" },
    { method: "POST", path: "/actions/workflows/deploy/dispatches", body: {} }
  ]) await assert.rejects(client.request(call), /unsupported/);
});

test("write adapter uses fixed gh arguments and stdin JSON; identity requires repository write permission", async () => {
  const calls = [];
  const client = createCoordinatorGitHub({ execute: async (args, body) => {
    calls.push({ args, body });
    if (args[5] === "user") return 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n{"id":456,"login":"dev"}';
    if (args[5] === "repos/6529-Collections/6529-release-coordinator") return 'HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"full_name":"6529-Collections/6529-release-coordinator","permissions":{"push":true}}';
    return 'HTTP/2.0 200 OK\nContent-Type: application/json\n\n{}';
  } });
  assert.deepEqual(await client.identity(), { login: "dev", id: "456" });
  await client.request({ method: "PATCH", path: "/issues/1", body: { title: "Literal $(no shell) `text`" } });
  assert.deepEqual(calls.at(-1).args.slice(-2), ["--input", "-"]); assert.equal(calls.at(-1).body.title, "Literal $(no shell) `text`");
});

test("processing help and bad options never contact GitHub", async () => {
  const opts = { run: async () => assert.fail("must not run"), stdout: () => {}, stderr: () => {} };
  assert.equal(await runProcessingCli(["--help"], opts), 0);
  for (const args of [["--deploy"], ["--issue", "../1"], ["--close-test"], ["--json", "--json"], ["--resume", "invalid"]]) assert.equal(await runProcessingCli(args, opts), 2);
});
