import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFile, access, mkdtemp, rm } from "node:fs/promises";
import { fixture } from "./processing-fixture.mjs";
import { rehearsalFixture } from "./rehearsal-fixture.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { runInboxRunCli } from "../src/inbox-run-cli.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { rehearseInboxTicket } from "../src/rehearsal-runner.mjs";
import { rehearseMerge } from "../src/rehearsal.mjs";
import {
  inboxBinding,
  inboxMergePlan,
  generateInboxPlan
} from "../src/inbox-merge-plan.mjs";
import { readInbox } from "../src/inbox-reader.mjs";
import { RehearsalError } from "../src/rehearsal-plan.mjs";
import { coordinateServices } from "../src/inbox-services.mjs";
import { executeServiceSteps } from "../src/service-contract.mjs";
import { serviceFixture, serviceAdapter } from "./service-fixture.mjs";
import { sourceFiles } from "../sandbox/fixtures.mjs";
import {
  createJournal,
  validateJournal,
  inboxWorkflow
} from "../src/inbox-journal.mjs";
import {
  buildReleaseRequestIssueBody,
  releaseRequestChecksum
} from "../../../packages/release-request/src/inbox-issue.mjs";

const sync = (f) => {
  f.result.request = structuredClone(f.request);
  f.issue.body = buildReleaseRequestIssueBody({
    request: f.request,
    checksum: releaseRequestChecksum(f.request),
    actor: f.actor.login,
    actorId: String(f.actor.id),
    workflowRunUrl: f.run.html_url,
    submittedAt: f.request.created_at
  });
};
async function inputPlan(f) {
  const entry = (await readInbox({ get: f.get, profile: f.profile }))
    .requests[0];
  const binding = inboxBinding(entry, f.profile);
  return {
    schema_version: "1",
    profile: f.profile.name,
    source: "inbox-plan",
    inbox: Object.fromEntries(
      ["repository_id", "issue_number", "request_id", "checksum"].map((key) => [
        key,
        binding[key]
      ])
    ),
    repositories: [
      {
        role: "backend",
        destination: { branch: "main", commit: f.pr.baseRefOid },
        pull_requests: f.request.release_parts[0].pull_requests
      }
    ]
  };
}
const issueWrites = (f) =>
  f.calls.filter(
    (call) => call.method !== "GET" && !call.path.startsWith("/git/")
  );
async function invoke(
  f,
  { args = ["--issue", "1", "--json"], ...options } = {}
) {
  let output = "";
  const logRoot = await mkdtemp(path.join(tmpdir(), "coordinator-log-test-"));
  try {
    const code = await runInboxRunCli(args, {
      logRoot,
      stderr: () => {},
      env: { RELEASE_COORDINATOR_PROFILE: f.profile.name },
      client: { identity: f.identity, request: f.api },
      get: f.get,
      github: f.github,
      plan: (entry, options) =>
        generateInboxPlan(entry, {
          ...options,
          github: {
            destination: async (role, branch) => ({
              repository: f.profile.repositories[role],
              branch,
              commit: f.pr.baseRefOid
            })
          }
        }),
      stdout: (text) => {
        output += text;
      },
      // This suite isolates the existing Git/ticket stage. Service integration
      // has its own complete application fixtures and workflow-adapter tests.
      services: null,
      ...options
    });
    return { code, report: JSON.parse(output) };
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
}
function fakeReport(entry, input, profile, status = "pass") {
  const plan = inboxMergePlan(input, entry, profile);
  return {
    profile: profile.name,
    input_source: "verified-inbox",
    input_hash: plan.input_hash,
    inbox: plan.inbox,
    inbox_final: structuredClone(plan.inbox),
    run_id: "33333333-3333-4333-8333-333333333333",
    started_at: "2026-09-09T12:00:00.000Z",
    finished_at: "2026-09-09T12:00:01.000Z",
    revision: { commit: "c".repeat(40), dirty: false },
    status,
    release_authorized: false,
    cleanup: { status: "removed" },
    operation_errors: [],
    checks: [
      { id: "inbox_stability", status: "pass", message: "Receipt stable" }
    ],
    repositories: plan.repositories.map((repo) => ({
      role: repo.role,
      repository: repo.identity,
      destination: repo.destination,
      pull_requests: repo.pull_requests,
      final_tree: status === "pass" ? "d".repeat(40) : null,
      checks: [
        {
          id: "local_merge",
          status,
          message: status === "pass" ? "Combined" : "Conflict in shared.txt"
        }
      ]
    })),
    report_file: "fixture-report.json"
  };
}

test("one inbox command saves a service attempt before dispatch, presents its result and reuses it on retry", async () => {
  const f = fixture(sandboxProfile),
    sample = serviceFixture();
  f.request.release_parts = structuredClone(sample.entry.request.release_parts);
  sync(f);
  f.github.pullRequest = async (repository, number) => {
    const part = f.request.release_parts.find(
      (p) => p.pull_requests[0].number === number
    );
    const pull = part.pull_requests[0];
    const role = part.id;
    return {
      ...structuredClone(f.pr),
      number,
      headRefOid: pull.commit,
      headRefName: pull.branch,
      repository: { nameWithOwner: f.profile.repositories[role].full_name },
      headRepository: { nameWithOwner: f.profile.repositories[role].full_name }
    };
  };
  f.github.catalog = async (commit) => ({
    commit,
    blob_sha: "d".repeat(40),
    catalog: JSON.parse(sample.files.backend["src/config/deploy-services.json"])
  });
  let dispatched = 0,
    completed;
  const client = {
    identity: async () => ({
      actor: { id: "456", login: "trusted-user" },
      workflow_id: 12
    }),
    dispatch: async (attempt) => {
      assert.equal(
        f.state().service_attempts[attempt.plan_hash].state,
        "dispatching"
      );
      dispatched++;
      completed = {
        report: await executeServiceSteps(attempt.plan, serviceAdapter(), {
          attemptId: attempt.id
        }),
        workflow: {
          id: 99,
          url: "https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/99"
        }
      };
      return { workflow_run_id: 99 };
    },
    result: async () => completed
  };
  const options = {
    rehearse: async (entry, input, { profile }) => {
      const report = fakeReport(entry, input, profile);
      for (const repo of report.repositories)
        repo.service_source = {
          files: sourceFiles(sample.files[repo.role]),
          baseline: sourceFiles(sample.baseline[repo.role]),
          changed_paths: []
        };
      return report;
    },
    services: (args) =>
      coordinateServices({
        ...args,
        runtime: sample.runtime,
        client,
        saveReport: async () => "service-fixture.json"
      })
  };
  const first = await invoke(f, options);
  assert.equal(first.code, 0, JSON.stringify(first.report));
  assert.equal(first.report.requests[0].services.status, "passed");
  assert.equal(first.report.requests[0].status, "waiting");
  assert.ok(f.issue.labels.includes("services:passed"));
  assert.equal(f.state().workflow, inboxWorkflow);
  assert.deepEqual(f.state().service_attempts, {});
  const archive = Object.values(f.state().history.services)[0];
  assert.equal(f.file(archive.path).record.state, "completed");
  const second = await invoke(f, options);
  assert.equal(second.code, 0, JSON.stringify(second.report));
  assert.equal(dispatched, 1);
  assert.equal(f.comments.length, 1);
  assert.equal(f.state().tickets[1].transitions.length, 1);
  assert.equal(f.state().lock, null);
});

for (const profile of [sandboxProfile, realProfile]) {
  test(`${profile.name}: one command verifies, merges with real Git, saves evidence, and updates one ticket; repeat is stable`, async (t) => {
    const f = fixture(profile),
      git = await rehearsalFixture(t);
    Object.assign(git.profile, {
      name: profile.name,
      inbox: profile.inbox,
      repositories: profile.repositories
    });
    const pulls = [
      await git.branch("backend", "feature/one", { "one.txt": "one\n" }),
      await git.branch("backend", "feature/two", { "two.txt": "two\n" })
    ];
    f.request.release_parts[0].pull_requests = pulls;
    f.pr.baseRefOid = git.repositories.backend.base;
    sync(f);
    f.github.pullRequest = async (_repo, number) =>
      git.github.pullRequest("backend", number);
    const input = await inputPlan(f),
      receipt = f.issue.body;
    let calls = 0;
    const rehearse = (entry, plan, options) => {
      calls++;
      assert.equal(f.state().lock.scope.workflow, inboxWorkflow);
      assert.deepEqual(f.state().lock.plans[1], input);
      return rehearseInboxTicket(entry, plan, {
        ...options,
        githubFactory: () => git.github,
        run: (normalized, opts) =>
          rehearseMerge(normalized, { ...opts, createGit: git.createGit }),
        revision: async () => ({ commit: "c".repeat(40), dirty: false }),
        save: async (report) => {
          assert.equal(report.cleanup.status, "removed");
          return "fixture-report.json";
        }
      });
    };
    const first = await invoke(f, { rehearse });
    assert.equal(first.code, 0);
    assert.equal(first.report.requests[0].rehearsal.status, "passed");
    assert.equal(first.report.requests[0].status, "waiting");
    assert.equal(first.report.release_authorized, false);
    assert.ok(f.issue.labels.includes("rehearsal:passed"));
    assert.ok(!f.issue.labels.includes("status:eligible"));
    assert.match(f.comments[0].body, /Merge rehearsal:\*\* passed/);
    assert.equal(f.issue.body, receipt);
    assert.equal(f.state().repository, profile.inbox.full_name);
    assert.equal(f.state().lock, null);
    const decision = f.state().tickets[1].transitions[0];
    assert.equal(decision.observation.rehearsal.result.status, "passed");
    assert.equal(decision.observation.rehearsal.report_hash.length, 64);
    const writes = issueWrites(f).length;
    const second = await invoke(f, { rehearse });
    assert.equal(second.code, 0);
    assert.equal(calls, 2);
    assert.equal(f.comments.length, 1);
    assert.equal(issueWrites(f).length, writes);
    assert.equal(f.state().tickets[1].transitions.length, 1);
  });
}

test("obvious outdated, merged, failing-check, draft, and unverified requests skip rehearsal", async () => {
  for (const change of [
    (f) => {
      f.pr.headRefOid = "e".repeat(40);
    },
    (f) => {
      f.pr.state = "MERGED";
    },
    (f) => {
      f.required.conclusion = "FAILURE";
    },
    (f) => {
      f.pr.isDraft = true;
    },
    (f) => {
      f.result.status = "failed";
    }
  ]) {
    const f = fixture();
    change(f);
    const { report } = await invoke(f, {
      plan: async () => assert.fail("must not plan"),
      rehearse: async () => assert.fail("must skip")
    });
    assert.equal(report.requests[0].rehearsal.status, "not-run");
    assert.equal(report.release_authorized, false);
    assert.equal(f.state().lock, null);
  }
});

test("two individually mergeable PRs conflict together and the same ticket records the real Git finding", async (t) => {
  const f = fixture(sandboxProfile),
    git = await rehearsalFixture(t);
  Object.assign(git.profile, {
    name: f.profile.name,
    inbox: f.profile.inbox,
    repositories: f.profile.repositories
  });
  f.request.release_parts[0].pull_requests = [
    await git.branch("backend", "feature/left", { "shared.txt": "left\n" }),
    await git.branch("backend", "feature/right", { "shared.txt": "right\n" })
  ];
  f.pr.baseRefOid = git.repositories.backend.base;
  sync(f);
  f.github.pullRequest = async (_repo, number) =>
    git.github.pullRequest("backend", number);
  const result = await invoke(f, {
    rehearse: (entry, plan, options) =>
      rehearseInboxTicket(entry, plan, {
        ...options,
        githubFactory: () => git.github,
        run: (normalized, opts) =>
          rehearseMerge(normalized, { ...opts, createGit: git.createGit }),
        revision: async () => ({ commit: "c".repeat(40), dirty: false }),
        save: async () => "fixture-report.json"
      })
  });
  assert.equal(result.code, 1);
  assert.equal(result.report.requests[0].rehearsal.status, "blocked");
  assert.ok(f.issue.labels.includes("reason:rehearsal-blocked"));
  assert.equal(f.issue.state, "open");
  assert.match(f.comments[0].body, /conflict/iu);
  assert.match(f.comments[0].body, /backend PR #2/);
  assert.match(f.comments[0].body, /shared\.txt/);
  assert.equal(
    f.state().tickets[1].transitions[0].observation.rehearsal.cleanup.status,
    "removed"
  );
  assert.equal(
    await git.git(git.repositories.backend.cwd, ["rev-parse", "main"]),
    git.repositories.backend.base
  );
});

test("changed ticket or lost journal ownership during rehearsal cannot publish passing evidence", async () => {
  for (const kind of ["receipt", "state", "ownership"]) {
    const f = fixture();
    const result = await invoke(f, {
      rehearse: async (entry, plan) => {
        const report = fakeReport(entry, plan, f.profile);
        if (kind === "receipt") f.issue.body += "\nChanged while rehearsing";
        else if (kind === "state") f.issue.state = "closed";
        else
          await createJournal(f.api, f.profile, {
            workflow: inboxWorkflow
          }).acquire(await f.identity(), f.state().lock.run_id);
        return report;
      }
    });
    assert.equal(result.code, 2);
    assert.equal(issueWrites(f).length, 0);
    assert.equal(f.comments.length, 0);
    assert.ok(f.state().lock);
  }
});

test("workflow marker upgrades legacy history and rejects an incompatible writer before mutations", async () => {
  const f = fixture();
  const legacy = createJournal(f.api, f.profile),
    { state, run } = await legacy.acquire(await f.identity(), undefined, {
      issue_number: 1,
      close_test: false
    });
  await legacy.release(state, run);
  assert.equal(f.state().workflow, undefined);
  await invoke(f, {
    rehearse: async (entry, plan) => fakeReport(entry, plan, f.profile)
  });
  assert.equal(f.state().workflow, inboxWorkflow);
  const before = f.calls.filter((call) => call.method !== "GET").length;
  await assert.rejects(
    createJournal(f.api, f.profile).acquire(await f.identity()),
    /requires the combined/
  );
  await assert.rejects(
    createJournal(f.api, f.profile, { workflow: "inbox-run-v1" }).acquire(
      await f.identity()
    ),
    /requires the combined/
  );
  assert.equal(f.calls.filter((call) => call.method !== "GET").length, before);
  const unknown = structuredClone(f.state());
  unknown.workflow = "future-executor";
  assert.throws(() => validateJournal(unknown, f.profile), /Unsupported/);
  assert.ok(f.state().tickets[1].transitions[0].decision.rehearsal);
});

test("unavailable destination and invalid generated scope leave reasons without running Git", async () => {
  const f = fixture();
  const first = await invoke(f, {
    plan: async () => {
      throw new RehearsalError(
        "destination_configuration",
        "Destination is missing."
      );
    },
    rehearse: async () => assert.fail("must skip")
  });
  assert.equal(first.code, 2);
  assert.ok(f.issue.labels.includes("reason:merge-plan-unavailable"));
  const input = await inputPlan(f);
  input.repositories[0].pull_requests = [];
  const second = await invoke(f, {
    plan: async () => input,
    rehearse: async () => assert.fail("must skip")
  });
  assert.equal(second.code, 1);
  assert.ok(f.issue.labels.includes("reason:merge-plan-invalid"));
  assert.ok(!f.issue.labels.includes("reason:merge-plan-unavailable"));
  assert.equal(f.comments.length, 1);
});

test("conflict -> passed updates the existing comment, resolves labels, and preserves both decisions", async () => {
  const f = fixture();
  const blocked = await invoke(f, {
    rehearse: async (e, p) => fakeReport(e, p, f.profile, "blocked")
  });
  assert.equal(blocked.code, 1);
  assert.equal(blocked.report.requests[0].status, "action-needed");
  assert.ok(f.issue.labels.includes("rehearsal:blocked"));
  assert.ok(f.issue.labels.includes("reason:rehearsal-blocked"));
  assert.match(f.comments[0].body, /Conflict in shared.txt/);
  const passed = await invoke(f, {
    rehearse: async (e, p) => fakeReport(e, p, f.profile)
  });
  assert.equal(passed.code, 0);
  assert.ok(f.issue.labels.includes("rehearsal:passed"));
  assert.ok(!f.issue.labels.includes("rehearsal:blocked"));
  assert.ok(!f.issue.labels.includes("reason:rehearsal-blocked"));
  assert.equal(f.comments.length, 1);
  assert.equal(f.state().tickets[1].transitions.length, 2);
});

test("stale, unknown, forged-pass, and failed report saves never publish a passed label", async () => {
  for (const kind of ["stale", "unknown", "forged", "save-failed"]) {
    const f = fixture();
    const result = await invoke(f, {
      rehearse: async (entry, plan) => {
        if (kind === "save-failed") throw Error("private token must not leak");
        const report = fakeReport(
          entry,
          plan,
          f.profile,
          kind === "forged" ? "pass" : kind
        );
        if (kind === "forged") report.input_hash = "wrong";
        return report;
      }
    });
    assert.equal(result.code, kind === "stale" ? 3 : 2);
    assert.equal(f.issue.state, "open");
    assert.ok(!f.issue.labels.includes("rehearsal:passed"));
    assert.doesNotMatch(JSON.stringify(result), /private token/);
    assert.equal(f.state().lock, null);
  }
});

test("interrupted run retains generated destinations; resume rechecks them and a new run captures current destinations", async () => {
  const f = fixture(),
    input = await inputPlan(f),
    controller = new AbortController();
  const first = await invoke(f, {
    signal: controller.signal,
    rehearse: async (entry, plan) => {
      controller.abort();
      return fakeReport(entry, plan, f.profile);
    }
  });
  assert.equal(first.code, 2);
  assert.equal(f.comments.length, 0);
  assert.equal(issueWrites(f).length, 0);
  const run = f.state().lock;
  assert.deepEqual(run.plans[1], input);
  f.pr.baseRefOid = "e".repeat(40);
  let calls = 0;
  const resumed = await invoke(f, {
    args: ["--resume", run.run_id, "--json"],
    plan: async () => assert.fail("resume must retain its saved plan"),
    rehearse: async (entry, plan) => {
      calls++;
      assert.deepEqual(plan, input);
      return fakeReport(entry, plan, f.profile, "blocked");
    }
  });
  assert.equal(resumed.code, 1);
  assert.equal(calls, 1);
  assert.equal(f.state().lock, null);
  assert.ok(f.issue.labels.includes("rehearsal:blocked"));
  assert.equal(f.comments.length, 1);
  const next = await invoke(f, {
    rehearse: async (entry, generated) => {
      assert.equal(
        generated.repositories[0].destination.commit,
        f.pr.baseRefOid
      );
      assert.notEqual(
        generated.repositories[0].destination.commit,
        input.repositories[0].destination.commit
      );
      return fakeReport(entry, generated, f.profile);
    }
  });
  assert.equal(next.code, 0);
});

test("partial presentation failure resumes with fresh rehearsal; no duplicate comment", async () => {
  const f = fixture();
  let failed = false;
  f.after = async (call) => {
    if (
      !failed &&
      call.method === "POST" &&
      call.path === "/issues/1/comments"
    ) {
      failed = true;
      throw Error("lost response");
    }
  };
  const options = {
    rehearse: async (entry, plan) => fakeReport(entry, plan, f.profile)
  };
  const first = await invoke(f, options);
  assert.equal(first.code, 2);
  assert.equal(f.comments.length, 1);
  assert.ok(f.state().lock);
  const resumed = await invoke(f, {
    ...options,
    args: ["--resume", f.state().lock.run_id, "--json"]
  });
  assert.equal(resumed.code, 0);
  assert.equal(f.comments.length, 1);
  assert.equal(f.state().lock, null);
  assert.equal(f.state().tickets[1].transitions.length, 1);
});

test("profile, scope, report-file and old-command validation fails before reads or writes", async () => {
  const never = async () => assert.fail("must not access GitHub");
  const f = fixture();
  for (const value of [undefined, "", "Real", "typo"]) {
    const result = await invoke(f, {
      env: { RELEASE_COORDINATOR_PROFILE: value },
      get: never,
      run: never
    });
    assert.equal(result.code, 2);
  }
  for (const args of [
    ["--issue", "1", "--plan", "x"],
    ["--manifest", "x"],
    ["--report", "x"],
    ["--plan", "x"],
    ["--resume", "33333333-3333-4333-8333-333333333333", "--issue", "1"]
  ]) {
    assert.equal(
      await runInboxRunCli(args, {
        run: never,
        stdout: () => {},
        stderr: () => {}
      }),
      2
    );
  }
  for (const filename of ["package.json", "apps/coordinator/package.json"]) {
    const { scripts } = JSON.parse(
      await readFile(new URL(`../../../${filename}`, import.meta.url))
    );
    assert.ok(scripts["inbox:run"]);
    assert.equal(scripts["inbox:process"], undefined);
    assert.equal(scripts["merge:rehearse"], undefined);
  }
  for (const filename of ["process-inbox.mjs", "rehearse-merge.mjs"])
    await assert.rejects(
      access(new URL(`../bin/${filename}`, import.meta.url)),
      { code: "ENOENT" }
    );
});

test("a lost generated-plan save response is confirmed before Git continues", async () => {
  const f = fixture();
  let failed = false;
  f.after = async (call) => {
    if (
      !failed &&
      call.method === "PATCH" &&
      call.path.includes("/git/refs/") &&
      f.state().lock?.plans?.[1]
    ) {
      failed = true;
      throw Error("Lost plan-save response");
    }
  };
  let usedPlan;
  const result = await invoke(f, {
    rehearse: async (entry, plan) => {
      usedPlan = structuredClone(plan);
      return fakeReport(entry, plan, f.profile);
    }
  });
  assert.equal(result.code, 0);
  assert.equal(failed, true);
  assert.ok(usedPlan);
  assert.equal(f.comments.length, 1);
  assert.equal(f.state().lock, null);
});

test("resuming a legacy interrupted run preserves its recorded plan while upgrading the writer marker", async () => {
  const f = fixture(),
    input = await inputPlan(f);
  const legacy = createJournal(f.api, f.profile, { workflow: "inbox-run-v1" });
  const { run } = await legacy.acquire(await f.identity(), undefined, {
    workflow: "inbox-run-v1",
    issue_number: 1,
    close_test: false,
    merge_plan: input
  });
  const result = await invoke(f, {
    args: ["--resume", run.run_id, "--json"],
    plan: async () => assert.fail("must preserve the legacy run scope"),
    rehearse: async (entry, plan) => {
      assert.deepEqual(plan, input);
      return fakeReport(entry, plan, f.profile);
    }
  });
  assert.equal(result.code, 0);
  assert.equal(f.state().workflow, inboxWorkflow);
  assert.equal(f.state().lock, null);
});

test("legacy service verification uses its saved plan and still detects destination movement", async () => {
  const f = fixture();
  const input = await inputPlan(f);
  const current = structuredClone(input);
  const legacy = createJournal(f.api, f.profile, { workflow: "inbox-run-v1" });
  const { run } = await legacy.acquire(await f.identity(), undefined, {
    workflow: "inbox-run-v1",
    issue_number: 1,
    close_test: false,
    merge_plan: input
  });
  let verified = false;
  const result = await invoke(f, {
    args: ["--resume", run.run_id, "--json"],
    plan: async () => structuredClone(current),
    rehearse: async (entry, saved) => {
      assert.deepEqual(saved, input);
      return fakeReport(entry, saved, f.profile);
    },
    services: async ({ decision, verifyInputs }) => {
      assert.equal(await verifyInputs(), true);
      current.repositories[0].destination.commit = "f".repeat(40);
      await assert.rejects(verifyInputs(), (error) => {
        assert.equal(error.status, "stale");
        assert.match(error.message, /backend main changed/);
        assert.ok(
          error.message.includes(input.repositories[0].destination.commit)
        );
        assert.ok(error.message.includes("f".repeat(40)));
        return true;
      });
      verified = true;
      return {
        decision,
        result: { status: "not-run", message: "Verification fixture" }
      };
    }
  });
  assert.equal(result.code, 0);
  assert.equal(verified, true);
  assert.equal(f.state().workflow, inboxWorkflow);
  assert.equal(f.state().lock, null);
});

test("one inbox scan generates a separate saved plan for each suitable ticket", async () => {
  const f = fixture();
  const first = (await readInbox({ get: f.get, profile: f.profile }))
    .requests[0];
  const second = structuredClone(first);
  second.issue_number = 2;
  second.request.request_id = "44444444-4444-4444-8444-444444444444";
  second.request.release_parts[0].pull_requests[0].number = 11;
  f.issues.push({
    ...structuredClone(f.issue),
    id: 1002,
    number: 2,
    body: buildReleaseRequestIssueBody({
      request: second.request,
      checksum: releaseRequestChecksum(second.request),
      actor: f.actor.login,
      actorId: String(f.actor.id),
      workflowRunUrl: f.run.html_url,
      submittedAt: second.request.created_at
    })
  });
  f.github.pullRequest = async (_repository, number) => ({
    ...structuredClone(f.pr),
    number
  });
  const rehearsed = [];
  const result = await invoke(f, {
    args: ["--json"],
    run: (options) =>
      processInbox({
        ...options,
        loadInbox: async () => ({ requests: [first, second] }),
        inspect: async (issue) =>
          structuredClone(issue.number === 1 ? first : second)
      }),
    rehearse: async (entry, plan) => {
      assert.equal(plan.inbox.issue_number, entry.issue_number);
      assert.deepEqual(f.state().lock.plans[entry.issue_number], plan);
      assert.equal(plan.repositories[0].pull_requests.length, 1);
      rehearsed.push(plan.repositories[0].pull_requests[0].number);
      return fakeReport(entry, plan, f.profile);
    }
  });
  assert.equal(result.code, 0);
  assert.deepEqual(rehearsed, [10, 11]);
  assert.equal(f.comments.length, 2);
  assert.deepEqual(Object.keys(f.state().tickets), ["1", "2"]);
});
