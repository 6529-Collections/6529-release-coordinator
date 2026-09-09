import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { realProfile, sandboxProfile, selectProfile, canonicalRequest, validateProfileRequest } from "../src/profiles.mjs";
import { validateReleaseRequest } from "../../../packages/release-request/src/index.mjs";
import { buildReleaseRequestIssueBody, releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";
import { readInbox } from "../src/inbox-reader.mjs";
import { createGitHubReader } from "../src/github-reader.mjs";
import { runIntake } from "../src/intake.mjs";
import { submitProfileRequest, runSubmissionCli, dispatchRequest } from "../src/submission-cli.mjs";
import { saveProfileRecord } from "../src/profile-records.mjs";
import { verifiedInboxEntry, inboxBinding, inboxMergePlan } from "../src/inbox-merge-plan.mjs";
import { rehearseInboxTicket, saveRehearsalReport } from "../src/rehearsal-runner.mjs";
import { rehearseMerge } from "../src/rehearsal.mjs";
import { rehearsalFixture } from "./rehearsal-fixture.mjs";
import { createJournal, validateJournal } from "../src/inbox-journal.mjs";
import { createCoordinatorGitHub } from "../src/coordinator-github.mjs";
import { runCli } from "../src/cli.mjs";
import { runReadinessCli } from "../src/readiness-cli.mjs";
import { runInboxRunCli } from "../src/inbox-run-cli.mjs";

function request(profile, pulls = [{ number: 1, branch: "feature/test", commit: "a".repeat(40) }]) {
  return { schema_version: "0.000001", ...(profile.name === "sandbox" ? { profile: "sandbox" } : {}),
    request_id: "22222222-2222-4222-8222-222222222222", created_at: "2026-09-09T12:00:00.000Z", requested_by: "Supplied text",
    target: "staging", database_change: "no", release_parts: [{ id: "frontend", repository: profile.repositories.frontend.full_name.split("/")[1], pull_requests: pulls, depends_on: [] }] };
}

function receiptFixture(profile, value = request(profile)) {
  const web = `https://github.com/${profile.inbox.full_name}`, api = `repos/${profile.inbox.full_name}`;
  const f = { request: value, exists: true, calls: [], before: async () => {} };
  f.env = { RELEASE_COORDINATOR_PROFILE: profile.name, GITHUB_REPOSITORY: profile.inbox.full_name, GITHUB_REPOSITORY_ID: String(profile.inbox.id),
    GITHUB_SERVER_URL: "https://github.com", GITHUB_REF: "refs/heads/main", GITHUB_RUN_ID: "123", GITHUB_ACTOR: "trusted-user", GITHUB_ACTOR_ID: "456",
    GH_TOKEN: "fixture-token", REQUEST_ID: value.request_id, REQUEST_JSON: JSON.stringify(value) };
  f.issue = { id: 1001, number: 1, html_url: `${web}/issues/1`, title: "Sample receipt", state: "open", labels: ["release-request"],
    body: buildReleaseRequestIssueBody({ request: value, checksum: releaseRequestChecksum(value), actor: "trusted-user", actorId: "456",
      workflowRunUrl: `${web}/actions/runs/123`, submittedAt: value.created_at }) };
  f.run = { id: 123, repository: { full_name: profile.inbox.full_name, id: profile.inbox.id }, head_repository: { full_name: profile.inbox.full_name, id: profile.inbox.id },
    path: `.github/workflows/${profile.workflow}`, event: "workflow_dispatch", head_branch: "main", head_sha: "c".repeat(40), html_url: `${web}/actions/runs/123`,
    display_title: `Release request ${value.request_id}`, status: "completed", conclusion: "success", actor: { login: "trusted-user", id: 456 }, run_attempt: 1 };
  f.result = { status: "submitted", profile: profile.name, request_id: value.request_id, request: value, inbox_issue_number: 1, inbox_issue_url: f.issue.html_url,
    github: { actor: "trusted-user", actor_id: "456", workflow_run_id: "123", workflow_run_url: f.run.html_url } };
  f.get = async endpoint => {
    f.calls.push(endpoint); await f.before(endpoint);
    if (endpoint.startsWith(`${api}/issues?state=`)) return f.exists && (endpoint.includes("state=all") || f.issue.state === "open") ? [structuredClone(f.issue)] : [];
    if (endpoint === `${api}/actions/runs/123`) return structuredClone(f.run);
    if (endpoint === `${api}/actions/runs/123/attempts/1/jobs?per_page=100&page=1`) return { jobs: [{ id: 789, name: "Validate and save request", run_id: 123, run_attempt: 1,
      status: "completed", conclusion: "success", steps: [{ name: "Validate and save the release request", status: "completed", conclusion: "success" }] }] };
    if (endpoint === `${api}/actions/jobs/789/logs`) return `2026-09-09T12:00:01.000Z RELEASE_REQUEST_RESULT=${Buffer.from(JSON.stringify(f.result)).toString("base64url")}\n`;
    throw new Error(`Unexpected profile read: ${endpoint}`);
  };
  f.get.identity = async () => profile.inbox;
  return f;
}

function planInput(entry, profile, repositories) {
  const binding = inboxBinding(entry, profile);
  return { schema_version: "1", source: "inbox-plan", profile: profile.name,
    inbox: Object.fromEntries(["repository_id", "issue_number", "request_id", "checksum"].map(key => [key, binding[key]])), repositories };
}

test("profiles bind the whole inbox and reject cross-profile request formats", () => {
  for (const profile of [realProfile, sandboxProfile]) {
    assert.equal(selectProfile(profile.name), profile);
    assert.equal(validateProfileRequest(request(profile), profile).ok, true);
    assert.equal(validateProfileRequest(request(profile), profile === realProfile ? sandboxProfile : realProfile).ok, false);
  }
  assert.equal(validateReleaseRequest(request(sandboxProfile)).ok, false);
  assert.equal(validateReleaseRequest(request(realProfile)).ok, true);
  assert.equal(canonicalRequest(request(sandboxProfile), sandboxProfile).release_parts[0].repository, "6529seize-frontend");
  for (const name of [undefined, "", "Sandbox", "test", "https://example.org"]) assert.throws(() => selectProfile(name));
  assert.equal(selectProfile(undefined, { defaultReal: true }), realProfile);
  const bad = request(sandboxProfile); bad.release_parts[0].repository = "6529seize-frontend";
  assert.equal(validateProfileRequest(bad, sandboxProfile).ok, false);
});

for (const profile of [sandboxProfile, realProfile]) {
  test(`${profile.name}: dispatch -> shared intake validation -> verified receipt; retry reuses ticket`, async () => {
    const f = receiptFixture(profile); f.exists = false;
    let dispatches = 0, clock = 0;
    const dispatch = async (value, selected) => {
      dispatches++; assert.equal(selected, profile); assert.deepEqual(value, f.request);
      let output = "";
      const code = await runIntake({ env: f.env, stdout: text => { output += text; }, save: async options => {
        assert.equal(options.actor, "trusted-user"); assert.equal(options.actorId, "456"); assert.deepEqual(options.request, value);
        return { issue: { number: 1, url: f.issue.html_url, created: true } };
      } });
      assert.equal(code, 0);
      f.result = JSON.parse(Buffer.from(output.trim().split("=")[1], "base64url").toString()); f.exists = true;
    };
    const options = { profile, get: f.get, dispatch, now: () => clock, pause: async ms => { clock += ms; } };
    const result = await submitProfileRequest(f.request, options);
    assert.equal(result.issue_url, f.issue.html_url); assert.equal(result.workflow.run_id, "123");
    assert.equal(result.github_actor.login, "trusted-user"); assert.equal(dispatches, 1);
    assert.equal((await submitProfileRequest(f.request, options)).reused, true); assert.equal(dispatches, 1);
    f.issue.state = "closed";
    assert.equal((await submitProfileRequest(f.request, options)).issue_state, "closed"); assert.equal(dispatches, 1);
    assert.ok(f.calls.every(endpoint => endpoint.startsWith(`repos/${profile.inbox.full_name}/`)));
  });

  test(`${profile.name}: intake refuses wrong repository, ref, actor, or request before saving`, async () => {
    const f = receiptFixture(profile);
    for (const change of [{ GITHUB_REPOSITORY: "other/inbox" }, { GITHUB_REPOSITORY_ID: "1" }, { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_SERVER_URL: "https://example.org" }, { GITHUB_ACTOR_ID: "untrusted" }, { REQUEST_ID: "different" }, { REQUEST_JSON: "{}" },
      { REQUEST_JSON: JSON.stringify(request(profile === realProfile ? sandboxProfile : realProfile)) }]) {
      assert.equal(await runIntake({ env: { ...f.env, ...change }, save: async () => assert.fail("must not save"), stdout: () => {} }), 1);
    }
  });

  test(`${profile.name}: workflow receipt cannot be copied from the other inbox`, async () => {
    const f = receiptFixture(profile);
    assert.equal((await readInbox({ get: f.get, profile })).counts.valid, 1);
    f.result.profile = profile === sandboxProfile ? "real" : "sandbox";
    assert.equal((await readInbox({ get: f.get, profile })).counts.invalid, 1);
    f.result.profile = profile.name;
    f.run.repository.full_name = profile === sandboxProfile ? realProfile.inbox.full_name : sandboxProfile.inbox.full_name;
    assert.equal((await readInbox({ get: f.get, profile })).counts.invalid, 1);
  });

  test(`${profile.name}: a non-JSON GitHub failure cannot become an accepted receipt`, async () => {
    const f = receiptFixture(profile);
    let output = "", calls = 0;
    const code = await runIntake({ env: f.env, stdout: text => { output += text; }, fetcher: async (_url, options) => {
      calls++; assert.equal(options.method, "GET");
      return { status: 503, json: async () => { throw new Error("Non-JSON response"); } };
    } });
    const result = JSON.parse(Buffer.from(output.trim().split("=")[1], "base64url").toString());
    assert.equal(code, 1); assert.equal(calls, 1); assert.equal(result.status, "failed");
    assert.equal(result.inbox_issue_number, null); assert.match(result.reason, /503/);
  });

  test(`${profile.name}: one verified ticket uses the same real Git rehearsal engine`, async t => {
    const f = await rehearsalFixture(t);
    Object.assign(f.profile, { name: profile.name, inbox: profile.inbox, repositories: profile.repositories });
    const pull = await f.branch("frontend", "feature/one", { "one.txt": "sample\n" });
    const receipt = receiptFixture(profile, request(profile, [pull]));
    const entry = await verifiedInboxEntry(1, { get: receipt.get, profile });
    const input = planInput(entry, profile, [{ role: "frontend", destination: { branch: "main", commit: f.repositories.frontend.base }, pull_requests: [pull] }]);
    let report;
    await rehearseInboxTicket(entry, input, {
      profile, get: receipt.get, githubFactory: () => f.github,
      run: (plan, options) => rehearseMerge(plan, { ...options, createGit: f.createGit }), revision: async () => ({ commit: "f".repeat(40), dirty: false }),
      save: async value => { report = value; return "fixture-report"; }, stdout: () => {}
    });
    assert.equal(report.status, "pass"); assert.equal(report.input_source, "verified-inbox");
    assert.equal(report.profile, profile.name); assert.equal(report.inbox.repository_id, profile.inbox.id);
    assert.equal(report.checks.find(c => c.id === "inbox_stability").status, "pass");
    assert.equal(report.cleanup.status, "removed"); assert.equal(report.release_authorized, false);
  });
}

test("inbox plans reject changed binding, omitted/extra/substituted PRs, or contradictory dependency order", async () => {
  const profile = sandboxProfile, f = receiptFixture(profile);
  const entry = await verifiedInboxEntry(1, { get: f.get, profile });
  const input = planInput(entry, profile, [{ role: "frontend", destination: { branch: "main", commit: "b".repeat(40) }, pull_requests: f.request.release_parts[0].pull_requests }]);
  assert.equal(inboxMergePlan(input, entry, profile).input_source, "verified-inbox");
  for (const mutate of [i => i.profile = "real", i => i.source = "test-manifest", i => i.inbox.repository_id++, i => i.inbox.issue_number++,
    i => i.inbox.checksum = "f".repeat(64), i => i.repositories = [], i => i.repositories[0].pull_requests = [],
    i => i.repositories[0].pull_requests[0].commit = "f".repeat(40), i => i.repositories.push(i.repositories[0]),
    i => i.repositories[0].pull_requests.push({ number: 2, branch: "extra", commit: "f".repeat(40) })]) {
    const changed = structuredClone(input); mutate(changed); assert.throws(() => inboxMergePlan(changed, entry, profile));
  }
  entry.request.release_parts.push({ ...structuredClone(entry.request.release_parts[0]), id: "second", depends_on: ["frontend"],
    pull_requests: [{ number: 2, branch: "feature/two", commit: "d".repeat(40) }] });
  const wrongOrder = planInput(entry, profile, [{ ...input.repositories[0], pull_requests: entry.request.release_parts.flatMap(p => p.pull_requests).reverse() }]);
  assert.throws(() => inboxMergePlan(wrongOrder, entry, profile), /order contradicts/);
  entry.request.release_parts[1].depends_on = ["missing-part"];
  const missingDependency = planInput(entry, profile, wrongOrder.repositories);
  assert.throws(() => inboxMergePlan(missingDependency, entry, profile), error => error.code === "invalid_inbox_plan");
});

test("submission reports a failed result-record write while retaining the prepared record", async () => {
  let output = "", saves = 0;
  const code = await runSubmissionCli(["--input", "request.json", "--json"], {
    env: { RELEASE_COORDINATOR_PROFILE: "sandbox" }, load: async () => request(sandboxProfile),
    save: async () => { if (++saves === 1) return "prepared.json"; throw new Error("Disk full"); },
    submit: async () => { throw new Error("Receipt unavailable"); }, stdout: text => { output += text; }
  });
  const result = JSON.parse(output);
  assert.equal(code, 2); assert.equal(saves, 2); assert.equal(result.status, "unknown");
  assert.equal(result.prepared_record, "prepared.json"); assert.equal(result.error, "Receipt unavailable");
  assert.equal(result.result_record_error, "Disk full"); assert.equal(result.release_authorized, false);
});

test("ticket closure during a rehearsal prevents a pass and still cleans temporary Git data", async t => {
  const profile = sandboxProfile, f = await rehearsalFixture(t);
  Object.assign(f.profile, { inbox: profile.inbox, repositories: profile.repositories });
  const pull = await f.branch("frontend", "feature/one", { "one.txt": "sample\n" });
  const receipt = receiptFixture(profile, request(profile, [pull]));
  const entry = await verifiedInboxEntry(1, { get: receipt.get, profile });
  const input = planInput(entry, profile, [{ role: "frontend", destination: { branch: "main", commit: f.repositories.frontend.base }, pull_requests: [pull] }]);
  let report;
  await rehearseInboxTicket(entry, input, { profile,
    get: receipt.get, githubFactory: () => f.github, revision: async () => ({}),
    run: async (plan, options) => { const result = await rehearseMerge(plan, { ...options, createGit: f.createGit }); receipt.issue.state = "closed"; return result; },
    save: async value => { report = value; return "fixture-report"; }, stdout: () => {} });
  assert.equal(report.status, "unknown"); assert.equal(report.cleanup.status, "removed");
  assert.equal(report.checks.find(c => c.id === "inbox_stability").status, "unknown");
});

test("profile records, journal identity, and rehearsal reports cannot cross environments", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "profile-records-")); t.after(() => rm(root, { recursive: true, force: true }));
  const name = "22222222-2222-4222-8222-222222222222.prepared.json";
  for (const profile of [realProfile, sandboxProfile]) {
    const file = await saveProfileRecord(profile, name, { profile: profile.name }, root);
    assert.equal(JSON.parse(await readFile(file, "utf8")).profile, profile.name);
    const initial = await createJournal(async () => ({ status: 404 }), profile).read();
    assert.equal(initial.state.repository, profile.inbox.full_name);
    assert.throws(() => validateJournal(initial.state, profile === realProfile ? sandboxProfile : realProfile));
    const reportFile = await saveRehearsalReport({ profile: profile.name, run_id: "33333333-3333-4333-8333-333333333333", status: "pass", repositories: [], cleanup: {} }, root);
    assert.ok(reportFile.includes(`merge-rehearsal/${profile.name}/`));
  }
  await assert.rejects(saveProfileRecord(sandboxProfile, name, {}, root), { code: "EEXIST" });
  const second = await mkdtemp(path.join(tmpdir(), "profile-symlink-")); t.after(() => rm(second, { recursive: true, force: true }));
  await symlink(root, path.join(second, ".release-coordinator"));
  await assert.rejects(saveProfileRecord(sandboxProfile, name, {}, second), /without symlinks/);
});

test("inbox reader pins repository identity and disallows paths from the other profile", async () => {
  for (const profile of [realProfile, sandboxProfile]) {
    let calls = 0;
    const get = createGitHubReader({ profile, execute: async (file, args) => {
      calls++; assert.equal(file, "gh"); assert.equal(args[4], "GET");
      assert.equal(args[5], `repos/${profile.inbox.full_name}`); return { stdout: JSON.stringify(profile.inbox) };
    } });
    await get.identity();
    await assert.rejects(get(`repos/${profile === realProfile ? sandboxProfile.inbox.full_name : realProfile.inbox.full_name}/issues?state=open&labels=release-request&sort=created&direction=asc&per_page=100&page=1`), /unsupported/);
    assert.equal(calls, 1);
    await assert.rejects(createGitHubReader({ profile, execute: async () => ({ stdout: JSON.stringify({ ...profile.inbox, id: 1 }) }) }).identity(), /identity/);
  }
});

test("processing adapter routes sandbox writes only to its own inbox", async () => {
  const calls = [];
  const client = createCoordinatorGitHub({ profile: sandboxProfile, execute: async args => { calls.push(args); return "HTTP/2.0 200 OK\nContent-Type: application/json\n\n{}"; } });
  await client.request({ method: "PATCH", path: "/issues/1", body: { title: "sample" } });
  assert.equal(calls[0][5], `repos/${sandboxProfile.inbox.full_name}/issues/1`);
  await assert.rejects(client.request({ method: "PATCH", path: `/repos/${realProfile.inbox.full_name}/issues/1`, body: { title: "wrong" } }), /unsupported/);
  assert.equal(calls.length, 1);
});

test("submission dispatch has a fixed workflow/ref and sends request text only through stdin JSON", async () => {
  for (const profile of [realProfile, sandboxProfile]) {
    const value = request(profile); value.requested_by = "Literal $(do-not-run) `text`";
    let calls = 0;
    await dispatchRequest(value, profile, { execute: async (args, body) => {
      calls++; assert.deepEqual(args.slice(0, 5), ["api", "--hostname", "github.com", "--method", "POST"]);
      assert.equal(args[5], `repos/${profile.inbox.full_name}/actions/workflows/submit-release-request.yml/dispatches`);
      assert.deepEqual(args.slice(-2), ["--input", "-"]);
      assert.equal(body.ref, "main"); assert.deepEqual(JSON.parse(body.inputs.request_json), value);
      assert.equal(args.some(arg => arg.includes("do-not-run")), false);
      return "HTTP/2.0 204 No Content\n\n";
    } });
    assert.equal(calls, 1);
    await assert.rejects(dispatchRequest(value, profile, { execute: async () => "HTTP/2.0 500 Error\n\n" }), /before retrying/);
  }
});

test("bad profiles/help/crossed inbox plans stop before input, network, or writes", async () => {
  const never = async () => assert.fail("must not run");
  for (const run of [runCli, runReadinessCli, runInboxRunCli, runSubmissionCli]) {
    const opts = { env: { RELEASE_COORDINATOR_PROFILE: "typo" }, get: never, client: { request: never, identity: never }, github: {},
      run: never, load: never, submit: never, stdout: () => {}, stderr: () => {} };
    assert.equal(await run(["--help"], opts), 0);
    assert.equal(await run(run === runSubmissionCli ? ["--input", "file"] : [], opts), 2);
  }
  for (const args of [[], ["--json"]]) {
    let output = "";
    assert.equal(await runReadinessCli(args, { env: { RELEASE_COORDINATOR_PROFILE: "Sandbox" }, get: never,
      stdout: text => { output += text; }, stderr: text => { output += text; } }), 2);
    assert.match(output, /Set RELEASE_COORDINATOR_PROFILE to sandbox or real/);
    assert.doesNotMatch(output, /network availability/);
  }
  assert.equal(await runInboxRunCli(["--issue", "1", "--plan", "file"], { env: { RELEASE_COORDINATOR_PROFILE: "real" },
    load: async () => ({ profile: "sandbox" }), get: never, run: never, stdout: () => {}, stderr: () => {} }), 2);
});
