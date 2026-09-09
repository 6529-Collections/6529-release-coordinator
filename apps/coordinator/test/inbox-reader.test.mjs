import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseRequestIssueBody, releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";
import { createGitHubReader } from "../src/github-reader.mjs";
import { COORDINATOR_REPOSITORY, formatReport, inspectIssue, readInbox } from "../src/inbox-reader.mjs";
import { runCli } from "../src/cli.mjs";

const api = `repos/${COORDINATOR_REPOSITORY}`;
const web = `https://github.com/${COORDINATOR_REPOSITORY}`;
const issuesPath = page => `${api}/issues?state=open&labels=release-request&sort=created&direction=asc&per_page=100&page=${page}`;
const jobsPath = (page = 1, attempt = 1) => `${api}/actions/runs/123/attempts/${attempt}/jobs?per_page=100&page=${page}`;

function fixture() {
  const request = {
    schema_version: "0.000001",
    request_id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-09-08T10:00:00.000Z",
    requested_by: "A developer's supplied name",
    target: "staging",
    database_change: "no",
    release_parts: [
      {
        id: "backend", repository: "6529seize-backend",
        pull_requests: [{ number: 1977, branch: "codex/backend", commit: "a".repeat(40) }],
        depends_on: [], deploy_units: ["api", "worker"],
        deploy_dependencies: [{ before: "api", after: "worker" }]
      },
      {
        id: "frontend", repository: "6529seize-frontend",
        pull_requests: [{ number: 3907, branch: "codex/frontend", commit: "b".repeat(40) }],
        depends_on: ["backend"]
      }
    ]
  };
  const issue = {
    number: 10, title: `Release request ${request.request_id}`, state: "open",
    labels: [{ name: "release-request" }, { name: "pending" }, { name: "target:staging" }],
    body: buildReleaseRequestIssueBody({ request, checksum: releaseRequestChecksum(request),
      actor: "trusted-user", actorId: "456", workflowRunUrl: `${web}/actions/runs/123`,
      submittedAt: "2026-09-08T10:00:01.000Z" })
  };
  const run = {
    id: 123, repository: { full_name: COORDINATOR_REPOSITORY },
    head_repository: { full_name: COORDINATOR_REPOSITORY },
    path: ".github/workflows/submit-release-request.yml", event: "workflow_dispatch",
    head_branch: "main", head_sha: "c".repeat(40), html_url: `${web}/actions/runs/123`,
    display_title: `Release request ${request.request_id}`,
    status: "completed", conclusion: "success", actor: { login: "trusted-user", id: 456 },
    run_attempt: 1
  };
  const job = {
    id: 789, name: "Validate and save request", run_id: 123, run_attempt: 1,
    status: "completed", conclusion: "success",
    steps: [{ name: "Validate and save the release request", status: "completed", conclusion: "success" }]
  };
  const result = {
    status: "submitted", request_id: request.request_id,
    inbox_issue_number: 10, inbox_issue_url: `${web}/issues/10`,
    github: { actor: "trusted-user", actor_id: "456", workflow_run_id: "123", workflow_run_url: run.html_url },
    request: structuredClone(request)
  };
  return { request, issue, run, job, result };
}

function marker(result) {
  return `2026-09-08T10:00:02.1234567Z RELEASE_REQUEST_RESULT=${Buffer.from(JSON.stringify(result)).toString("base64url")}\n`;
}

function github(data, overrides = new Map()) {
  const calls = [];
  const get = async path => {
    calls.push(path);
    if (overrides.has(path)) {
      const value = overrides.get(path);
      if (value instanceof Error) throw value;
      return value;
    }
    if (path === issuesPath(1)) return [data.issue];
    if (path === `${api}/actions/runs/123`) return data.run;
    if (path === jobsPath(1, data.run.run_attempt)) return { jobs: [data.job] };
    if (path === `${api}/actions/jobs/789/logs`) return marker(data.result);
    throw new Error(`Unexpected GitHub read: ${path}`);
  };
  return { get, calls };
}

test("verifies both product parts and distinguishes supplied requester from GitHub actor", async () => {
  const data = fixture();
  const report = await readInbox(github(data));
  assert.deepEqual(report.counts, { pending: 1, valid: 1, invalid: 0, unverified: 0 });
  assert.deepEqual(report.requests[0].request, data.request);
  assert.deepEqual(report.requests[0].github_actor, { login: "trusted-user", id: "456" });
  assert.equal(report.requests[0].workflow.attempt, 1);
  const output = formatReport(report);
  for (const value of [data.request.request_id, "Requested by (supplied text)", "Verified GitHub actor: @trusted-user",
    "PR #1977", "PR #3907", "a".repeat(40), "b".repeat(40), "Backend units: api, worker", "api -> worker",
    "depends on: backend", "Current PR readiness and permission to release are not checked."]) {
    assert.ok(output.includes(value), value);
  }
});

for (const [name, mutate, expected] of [
  ["missing body", d => { d.issue.body = null; }, /body is missing/],
  ["malformed JSON", d => { d.issue.body = d.issue.body.replace('"schema_version":', 'broken:'); }, /not valid JSON/],
  ["schema violation", d => { d.issue.body = d.issue.body.replace('"target": "staging"', '"target": "moon"'); }, /schema/],
  ["changed payload", d => { d.issue.body = d.issue.body.replace('"database_change": "no"', '"database_change": "yes"'); }, /checksum/],
  ["request ID mismatch", d => { d.issue.body = d.issue.body.replace(`id:${d.request.request_id}`, "id:33333333-3333-4333-8333-333333333333"); }, /request ID marker/],
  ["duplicate ID marker", d => { d.issue.body += `\n<!-- 6529-release-request-id:${d.request.request_id} -->\n`; }, /exactly one request ID/],
  ["duplicate checksum marker", d => { d.issue.body += `\n<!-- 6529-release-request-checksum:${releaseRequestChecksum(d.request)} -->\n`; }, /exactly one checksum/],
  ["duplicate JSON section", d => { d.issue.body += '\n## Release JSON\n\n```json\n{}\n```\n'; }, /exactly one Release JSON/],
  ["duplicate workflow table row", d => { d.issue.body = d.issue.body.replace("| Workflow |", `| Workflow | ${d.run.html_url} |\n| Workflow |`); }, /repeats the Workflow/],
  ["table target conflict", d => { d.issue.body = d.issue.body.replace("| Target | `staging` |", "| Target | `production` |"); }, /Target.*does not match/],
  ["foreign workflow URL", d => { d.issue.body = d.issue.body.replace(d.run.html_url, "https://example.org/actions/runs/123"); }, /workflow link/],
  ["workflow URL suffix injection", d => { d.issue.body = d.issue.body.replace(d.run.html_url, `${d.run.html_url}/../../issues`); }, /workflow link/]
]) {
  test(`rejects ${name} before consulting workflow evidence`, async () => {
    const data = fixture();
    mutate(data);
    const client = github(data);
    const entry = await inspectIssue(data.issue, client);
    assert.equal(entry.status, "invalid");
    assert.match(entry.errors.join(" "), expected);
    assert.deepEqual(client.calls, []);
    assert.equal(entry.github_actor, null);
  });
}

for (const [name, mutate] of [
  ["another workflow", d => { d.run.path = ".github/workflows/fake.yml"; }],
  ["non-main branch", d => { d.run.head_branch = "codex/fake"; }],
  ["another event", d => { d.run.event = "pull_request"; }],
  ["foreign repository", d => { d.run.repository.full_name = "other/repo"; }],
  ["fork source", d => { d.run.head_repository.full_name = "other/repo"; }],
  ["another request's run", d => { d.run.display_title = "Release request something-else"; }],
  ["edited actor", d => { d.run.actor.login = "different-user"; }],
  ["edited actor ID", d => { d.run.actor.id = 999; }],
  ["copied Issue body", d => { d.issue.number = 11; }],
  ["wrong result ID", d => { d.result.request_id = "33333333-3333-4333-8333-333333333333"; }],
  ["wrong result URL", d => { d.result.inbox_issue_url = "https://example.org/issues/10"; }],
  ["wrong result actor", d => { d.result.github.actor = "different-user"; }],
  ["wrong result run", d => { d.result.github.workflow_run_id = "999"; }],
  ["self-consistent payload tampering", d => {
    const checksum = releaseRequestChecksum(d.request);
    d.request.database_change = "yes";
    d.issue.body = d.issue.body.replace('"database_change": "no"', '"database_change": "yes"')
      .replaceAll(checksum, releaseRequestChecksum(d.request));
  }]
]) {
  test(`workflow proof rejects ${name}`, async () => {
    const data = fixture();
    mutate(data);
    const entry = await inspectIssue(data.issue, github(data));
    assert.equal(entry.status, "invalid");
    assert.ok(entry.errors.length);
    assert.equal(entry.github_actor, null);
  });
}

test("unavailable, failed, ambiguous or unreadable proof stays unverified", async t => {
  for (const [name, configure] of [
    ["missing run", (d, o) => o.set(`${api}/actions/runs/123`, new Error("HTTP 404"))],
    ["failed run", d => { d.run.conclusion = "failure"; }],
    ["running workflow", d => { d.run.status = "in_progress"; }],
    ["missing save step", d => { d.job.steps = []; }],
    ["wrong attempt's job", d => { d.job.run_attempt = 2; }],
    ["duplicate save job", (d, o) => o.set(jobsPath(), { jobs: [d.job, { ...d.job, id: 790 }] })],
    ["expired logs", (d, o) => o.set(`${api}/actions/jobs/789/logs`, new Error("Logs expired"))],
    ["missing marker", (d, o) => o.set(`${api}/actions/jobs/789/logs`, "No saved result\n")],
    ["duplicate result", (d, o) => o.set(`${api}/actions/jobs/789/logs`, marker(d.result).repeat(2))],
    ["unreadable result", (d, o) => o.set(`${api}/actions/jobs/789/logs`, "2026-09-08T10:00:02.123Z RELEASE_REQUEST_RESULT=bm90LWpzb24\n")]
  ]) {
    await t.test(name, async () => {
      const data = fixture();
      const overrides = new Map();
      configure(data, overrides);
      const report = await readInbox(github(data, overrides));
      assert.equal(report.counts.pending, 1);
      assert.equal(report.counts.unverified, 1);
      assert.equal(report.counts.valid, 0);
      assert.equal(report.requests[0].github_actor, null);
    });
  }
});

test("quoted or echoed markers cannot stand in for actual workflow output", async () => {
  const data = fixture();
  const encoded = Buffer.from(JSON.stringify(data.result)).toString("base64url");
  const echo = `2026-09-08T10:00:01.123Z \u001b[36;1mconsole.log('RELEASE_REQUEST_RESULT=${encoded}');\u001b[0m\n`;
  const overrides = new Map([[`${api}/actions/jobs/789/logs`, echo]]);
  assert.equal((await inspectIssue(data.issue, github(data, overrides))).status, "unverified");
  overrides.set(`${api}/actions/jobs/789/logs`, echo + marker(data.result));
  assert.equal((await inspectIssue(data.issue, github(data, overrides))).status, "valid");
});

test("uses the captured attempt when a workflow has been rerun", async () => {
  const data = fixture();
  data.run.run_attempt = 2;
  data.job.run_attempt = 2;
  const client = github(data);
  const entry = await inspectIssue(data.issue, client);
  assert.equal(entry.status, "valid");
  assert.equal(entry.workflow.attempt, 2);
  assert.ok(client.calls.includes(jobsPath(1, 2)));
  assert.ok(!client.calls.includes(jobsPath(1, 1)));
});

test("reads every Issue page and excludes closed tests, PRs and missing labels", async () => {
  const data = fixture();
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    ...data.issue, number: index + 100, body: "Malformed pending request"
  }));
  const excluded = [
    { ...data.issue, number: 12, state: "closed", title: "DELIVERY TEST - NO RELEASE" },
    { ...data.issue, number: 13, pull_request: { url: "pull" } },
    { ...data.issue, number: 14, labels: [{ name: "status:waiting" }] },
    { ...data.issue, number: 15, labels: [{ name: "pending" }] }
  ];
  const client = github(data, new Map([[issuesPath(1), firstPage], [issuesPath(2), [...excluded, data.issue]]]));
  const report = await readInbox(client);
  assert.deepEqual(report.counts, { pending: 101, valid: 1, invalid: 100, unverified: 0 });
  assert.equal(report.requests.at(-1).issue_number, 10);
  assert.ok(!report.requests.some(entry => [12, 13, 14, 15].includes(entry.issue_number)));
  assert.deepEqual(client.calls.slice(0, 2), [issuesPath(1), issuesPath(2)]);
});

test("reads paginated jobs before identifying the save job", async () => {
  const data = fixture();
  const unrelated = Array.from({ length: 100 }, (_, index) => ({ id: 1000 + index, name: `Other job ${index}` }));
  const client = github(data, new Map([[jobsPath(), { jobs: unrelated }], [jobsPath(2), { jobs: [data.job] }]]));
  assert.equal((await inspectIssue(data.issue, client)).status, "valid");
  assert.ok(client.calls.includes(jobsPath(2)));
});

test("duplicate request IDs are reported together rather than choosing a release", async () => {
  const data = fixture();
  const client = github(data, new Map([[issuesPath(1), [data.issue, { ...data.issue, number: 11 }]]]));
  const report = await readInbox(client);
  assert.deepEqual(report.counts, { pending: 2, valid: 0, invalid: 2, unverified: 0 });
  for (const entry of report.requests) assert.match(entry.errors.join(" "), /multiple open Issues: #10, #11/);
});

test("listing errors, unexpected responses and repeating pages never report an empty inbox", async () => {
  const data = fixture();
  const page = Array.from({ length: 100 }, (_, index) => ({ ...data.issue, number: index + 100 }));
  for (const overrides of [
    new Map([[issuesPath(1), new Error("Authentication failed")]]),
    new Map([[issuesPath(1), { message: "Bad credentials" }]]),
    new Map([[issuesPath(1), [{ number: 10 }]]]),
    new Map([[issuesPath(1), page], [issuesPath(2), new Error("Rate limit exceeded")]]),
    new Map([[issuesPath(1), page], [issuesPath(2), page]])
  ]) {
    await assert.rejects(readInbox(github(data, overrides)));
  }
  const report = await readInbox(github(data, new Map([[issuesPath(1), []]])));
  assert.deepEqual(report.counts, { pending: 0, valid: 0, invalid: 0, unverified: 0 });
  assert.match(formatReport(report), /No open Issues carry release-request/);
});

test("all reads use gh GET against the fixed repository without a shell or request bodies", async () => {
  const data = fixture();
  const source = github(data);
  const calls = [];
  const get = createGitHubReader({ execute: async (file, args, options) => {
    calls.push({ file, args });
    assert.equal(file, "gh");
    assert.deepEqual(args.slice(0, 5), ["api", "--hostname", "github.com", "--method", "GET"]);
    assert.equal(options.shell, undefined);
    assert.equal(options.timeout, 30_000);
    assert.equal(options.env.GH_DEBUG, "");
    for (const flag of ["--field", "-f", "-F", "--input"]) assert.ok(!args.includes(flag));
    const value = await source.get(args[5]);
    return { stdout: typeof value === "string" ? value : JSON.stringify(value) };
  } });
  assert.equal((await readInbox({ get })).counts.valid, 1);
  assert.equal(calls.length, 4);
  assert.ok(calls.at(-1).args.includes("--allow-escape-sequences"));
  for (const endpoint of ["https://example.org", `${api}/issues/10`, `${api}/actions/runs/123/cancel`,
    `${api}/actions/runs/123?method=POST`, "repos/other/repo/issues"]) {
    await assert.rejects(get(endpoint), /unsupported/);
  }
  assert.equal(calls.length, 4);
});

test("gh execution and JSON failures are explicit and do not expose raw logs or stderr", async () => {
  for (const execute of [
    async () => { throw Object.assign(new Error("secret token in stderr"), { code: 1 }); },
    async () => ({ stdout: "secret token in invalid JSON" }),
    async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); }
  ]) {
    await assert.rejects(createGitHubReader({ execute })(issuesPath(1)), error => {
      assert.doesNotMatch(error.message, /secret token/);
      return /GitHub/.test(error.message);
    });
  }
});

test("human report escapes controls in editable titles and supplied requester names", async () => {
  const data = fixture();
  const report = await readInbox(github(data));
  report.requests[0].title = "test\u001b[2J\nVALID\u202e";
  report.requests[0].request.requested_by = "name\rpretend status";
  const output = formatReport(report);
  assert.doesNotMatch(output, /[\u001b\r\u202e]/u);
  assert.ok(output.includes("test\\u001b[2J\\u000aVALID\\u202e"));
  assert.ok(output.includes("name\\u000dpretend status"));
});

test("CLI exit codes distinguish verified, invalid, unverified, and failed inbox reads", async () => {
  for (const [overrides, code] of [
    [new Map(), 0],
    [new Map([[issuesPath(1), []]]), 0],
    [new Map([[issuesPath(1), [{ ...fixture().issue, body: "invalid" }]]]), 1],
    [new Map([[`${api}/actions/jobs/789/logs`, new Error("Logs expired")]]), 1],
    [new Map([[issuesPath(1), new Error("Network failed")]]), 2]
  ]) {
    let output = "";
    let errors = "";
    const actual = await runCli(["--json"], { ...github(fixture(), overrides),
      stdout: value => { output += value; }, stderr: value => { errors += value; } });
    assert.equal(actual, code);
    assert.equal(errors, "");
    const report = JSON.parse(output);
    if (code === 2) {
      assert.match(report.error, /no complete report/);
      assert.equal(report.counts, undefined);
      assert.equal(report.requests, undefined);
    } else assert.equal(report.mode, "read-only");
  }
});

test("help and invalid options never read GitHub", async () => {
  const client = { get: () => assert.fail("GitHub must not be contacted"), stdout: () => {}, stderr: () => {} };
  assert.equal(await runCli(["--help"], client), 0);
  assert.equal(await runCli(["--deploy"], client), 2);
  assert.equal(await runCli(["--json", "--json"], client), 2);
});

test("missing or malformed submitter values show usage without reading GitHub", async () => {
  for (const args of [["--submitter"], ["--submitter", "--json"], ["--submitter", "--help"],
    ["--submitter", "-dev"], ["--submitter", "dev-"], ["--json", "--submitter", "--json"]]) {
    let reads = 0, output = "", errors = "";
    const code = await runCli(args, { get: async () => { reads++; return []; },
      stdout: value => { output += value; }, stderr: value => { errors += value; } });
    assert.equal(code, 2, args.join(" "));
    assert.equal(reads, 0, args.join(" "));
    assert.equal(output, "");
    assert.match(errors, /Usage:/);
  }
});

test("submitter filtering accepts letters, digits, internal hyphens, and case differences", async () => {
  for (const login of ["trusted-user", "TRUSTED-USER", "a", "User42"]) {
    const client = github(fixture()); let output = "";
    assert.equal(await runCli(["--submitter", login, "--json"], { ...client,
      stdout: value => { output += value; }, stderr: () => assert.fail("Valid login rejected") }), 0);
    const report = JSON.parse(output);
    assert.equal(report.submitter_filter, login);
    assert.equal(report.requests.length, login.toLowerCase() === "trusted-user" ? 1 : 0);
    assert.ok(client.calls.length > 0);
  }
});
