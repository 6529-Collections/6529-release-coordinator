import test from "node:test";
import assert from "node:assert/strict";
import { harness as selectionHarness } from "./selection-harness.mjs";
import { batchTicketResult } from "../src/batch-selection.mjs";
import { batchFixture } from "./batch-fixture.mjs";
import { generateInboxPlan } from "../src/inbox-merge-plan.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { rehearsalFixture } from "./rehearsal-fixture.mjs";
import { checkHarness } from "./checks-harness.mjs";
import { ServiceError } from "../src/service-contract.mjs";
import { harness as inboxHarness } from "./inbox-batch-harness.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { fixture as processingFixture } from "./processing-fixture.mjs";
import { createJournal } from "../src/inbox-journal.mjs";
import { fixture as githubFixture } from "./batch-github-fixture.mjs";
import { runServiceAttempt } from "../src/inbox-services.mjs";
import { executeServiceSteps } from "../src/service-contract.mjs";
import { fixtureServicePlan } from "../sandbox/fixtures.mjs";
import { serviceAdapter } from "./service-fixture.mjs";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { serviceHash, verifyServiceReport } from "../src/service-contract.mjs";
import { createServiceGitHub } from "../src/service-github.mjs";
import { runDockerServicePlan } from "../src/service-runtime.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import { realProfile, validateProfileRequest } from "../src/profiles.mjs";
import { validateJournal } from "../src/inbox-journal.mjs";
import { checkBatch, verifySavedBatch } from "../src/batch-checks.mjs";
import { createBatchGitHub } from "../src/batch-github.mjs";
import { serviceFixture } from "./service-fixture.mjs";
import { buildServicePlan } from "../src/service-plan.mjs";
import { databaseCandidate } from "../sandbox/fixtures.mjs";
import { batchPolicy } from "../src/batch-plan.mjs";
import { openIssues } from "../src/inbox-reader.mjs";
import { createReadinessGitHub } from "../src/readiness-github.mjs";
import { inspectPull } from "../src/readiness.mjs";

const dockerOptions = {
  skip:
    process.env.COORDINATOR_CT_DOCKER !== "1"
      ? "Requires explicit local Docker acceptance run"
      : false
};
async function saveEvidence(name, report) {
  if (!process.env.COORDINATOR_CT_EVIDENCE) return;
  await mkdir(process.env.COORDINATOR_CT_EVIDENCE, { recursive: true });
  await writeFile(
    path.join(process.env.COORDINATOR_CT_EVIDENCE, name + ".json"),
    JSON.stringify(report, null, 2) + "\n"
  );
}

test("CT-01: only the three-ticket combination fails", async (t) => {
  const works = (group) => group.length < 3;
  for (const group of [[1], [2], [3], [1, 2], [1, 3], [2, 3]])
    assert.equal(works(group), true);
  const h = selectionHarness({ count: 3, checks: works });
  const result = await h.run();
  assert.deepEqual(result.selected, [1, 2]);
  const checked = h.events
    .filter((e) => e.phase === "checks")
    .map((e) => e.numbers);
  assert.deepEqual(checked, [[1, 2, 3], [1, 2], [3]]);
  assert.ok(checked.some((group) => group.join() === result.selected.join()));
  for (const number of [3]) {
    assert.equal(batchTicketResult(result, number).status, "waiting");
    assert.equal(batchTicketResult(result, number).code, "batch-incompatible");
  }
  t.diagnostic(JSON.stringify({ checked, selected: result.selected }));
});

test("CT-02: a third ticket heals a failing pair", async (t) => {
  const works = (group) =>
    !(group.includes(1) && group.includes(2)) || group.includes(3);
  assert.equal(works([1, 2]), false);
  const h = selectionHarness({ count: 3, checks: works });
  const result = await h.run();
  assert.deepEqual(result.selected, [1, 2, 3]);
  assert.deepEqual(h.events, [
    { phase: "git", numbers: [1, 2, 3] },
    { phase: "checks", numbers: [1, 2, 3] }
  ]);
  t.diagnostic("ABC selected after one combined check; no split.");
});

test("CT-03: a four-PR ticket cannot be partially selected", async (t) => {
  const f = await batchFixture(t);
  const small = await f.ticket({ frontend: { "docs/shared.md": "small\n" } });
  const large = await f.ticket();
  for (const role of ["backend", "frontend"]) {
    const part = large.entry.request.release_parts.find((p) => p.id === role);
    part.pull_requests.push(
      await f.git.branch(role, "fixture/large-second", {
        [role === "frontend" ? "docs/shared.md" : "docs/large-second.md"]:
          "large\n"
      })
    );
  }
  large.input = await generateInboxPlan(large.entry, {
    profile: sandboxProfile,
    github: f.git.github
  });
  assert.equal((await f.prepare([large])).status, "passed");
  const h = selectionHarness({ count: 2 });
  const checked = [];
  const result = await h.run({
    items: [small, large],
    prepare: f.prepare,
    check: async (prepared) => {
      checked.push(prepared);
      return { status: "passed" };
    }
  });
  assert.deepEqual(result.selected, [small.number]);
  assert.equal(
    batchTicketResult(result, large.number).code,
    "batch-incompatible"
  );
  assert.equal(checked.length, 1);
  for (const repo of checked[0].publications) {
    assert.ok(!repo.patch.some((p) => /ticket-2|large-second/.test(p.path)));
  }
  assert.equal(
    large.input.repositories.flatMap((r) => r.pull_requests).length,
    4
  );
  t.diagnostic(
    "Real Git: the last frontend PR conflicted; all four PRs of ticket 2 were excluded before CI."
  );
});

test("CT-04: three individually valid service graphs form a cycle", async (t) => {
  const f = await rehearsalFixture(t);
  const pr = await f.branch("backend", "fixture/catalog", {
    "src/config/deploy-services.json": JSON.stringify({
      services: ["X", "Y", "Z"].map((name) => ({
        name,
        allowed_environments: ["staging"],
        default_dependencies: []
      }))
    })
  });
  const edges = [
    { before: "X", after: "Y" },
    { before: "Y", after: "Z" },
    { before: "Z", after: "X" }
  ];
  const run = (dependencies) =>
    f.run(
      f.manifest([
        {
          role: "backend",
          pulls: [pr],
          deploy_units: ["X", "Y", "Z"],
          deploy_dependencies: dependencies
        }
      ])
    );
  for (const edge of edges) assert.equal((await run([edge])).status, "pass");
  const combined = await run(edges);
  assert.equal(combined.status, "blocked");
  assert.match(JSON.stringify(combined), /cycle/i);
  t.diagnostic(
    JSON.stringify(
      combined.repositories.map((r) => r.service_graph ?? r.checks)
    )
  );
});

test("CT-05: backend base moves after frontend CI passes", async (t) => {
  const f = await batchFixture(t),
    item = await f.ticket();
  const prepared = await f.prepare([item]),
    h = checkHarness(prepared);
  let backend = f.git.repositories.backend.base;
  const frontend = f.git.repositories.frontend.base;
  h.client.result = async (record) => {
    if (record.role === "frontend") backend = "f".repeat(40);
    return { status: "passed", role: record.role };
  };
  const result = await h.run({
    verify: async () => {
      if (
        prepared.publications.some(
          (repo) => repo.base !== (repo.role === "backend" ? backend : frontend)
        )
      )
        throw new ServiceError("batch-stale", "Backend main changed", "stale");
    }
  });
  assert.equal(result.status, "stale");
  assert.equal(h.state().cleanup, "removed");
  assert.ok(!h.events.includes("services"));
  assert.deepEqual(
    h.events.filter((e) => e.startsWith("cleanup:")),
    ["cleanup:backend", "cleanup:frontend"]
  );
  t.diagnostic(
    "Both trial checks passed; backend-only movement prevented service dispatch and cleaned both trials. Base-change detection is injected here; run-log.test.mjs separately verifies the real inbox detector and detailed ticket reasons."
  );
});

test("CT-06: changed approval and required checks invalidate green code", async (t) => {
  for (const gate of ["reviews", "required_checks"]) {
    const h = inboxHarness();
    const observe = h.options.observe;
    h.options.observe = async (entry) => {
      const result = await observe(entry);
      if (h.dispatches())
        result.pull_requests[0].checks.find((c) => c.id === gate).status =
          "unknown";
      return result;
    };
    const result = await processInbox(h.options);
    assert.deepEqual(result.batch.selected, []);
    assert.equal(result.batch.stop.status, "stale");
    assert.equal(h.dispatches(), 1);
    assert.ok(
      h.f.issues.every((issue) => !issue.labels.includes("batch:passed"))
    );
    assert.equal(h.f.state().lock, null);
  }
  t.diagnostic(
    "Approval withdrawn and new pending required check each invalidate the completed combined test."
  );
});

test("CT-07: withdrawal cannot silently substitute a replacement ticket", async (t) => {
  const h = inboxHarness();
  const observe = h.options.observe;
  let withdrawn = false;
  h.options.observe = async (entry) => {
    if (h.dispatches() && !withdrawn) {
      withdrawn = true;
      h.f.issues[0].state = "closed";
      h.f.issues.push({
        ...structuredClone(h.f.issues[0]),
        id: 1003,
        number: 3,
        state: "open",
        body: "A new request with its own receipt",
        labels: ["release-request"]
      });
    }
    return observe(entry);
  };
  await assert.rejects(processInbox(h.options), /Issue #1 changed/);
  const batch = Object.values(h.f.state().batches)[0];
  assert.deepEqual(batch.selected, []);
  assert.equal(batch.stop.status, "stale");
  assert.ok(!batch.inputs.some((input) => input.number === 3));
  assert.equal(h.f.state().tickets[3], undefined);
  assert.deepEqual(h.f.issues[2].labels, ["release-request"]);
  assert.equal(h.f.issues[0].state, "closed");
  t.diagnostic(
    "Withdrawal invalidated the batch; command retained an explicit interrupted lock for recovery. New ticket 3 was untouched."
  );
});

test("CT-08: overlapping request graph holds A B C but allows D", async (t) => {
  const h = inboxHarness(4);
  const [a, b, c] = h.samples.map((s) => s.entry.request);
  b.release_parts[0].pull_requests = structuredClone(
    a.release_parts[0].pull_requests
  );
  c.release_parts[1].pull_requests = structuredClone(
    a.release_parts[1].pull_requests
  );
  const result = await processInbox(h.options);
  assert.deepEqual(result.batch.selected, [4]);
  for (const issue of h.f.issues.slice(0, 3)) {
    assert.ok(issue.labels.includes("reason:overlapping-requests"));
    assert.ok(!issue.labels.includes("batch:passed"));
  }
  assert.equal(h.dispatches(), 1);
  assert.deepEqual(
    h.events.filter((e) => e.startsWith("git:")),
    ["git:4"]
  );
  t.diagnostic(
    "A overlaps B on backend and C on frontend. A/B/C held; D alone reached the combined check."
  );
});

test("CT-09: stale owners stop at guards but an in-flight write is not fenced", async (t) => {
  const f = processingFixture(),
    a = createJournal(f.api),
    b = createJournal(f.api);
  const actor = await f.identity(),
    scope = { issue_number: 1, close_test: false };
  const results = await Promise.allSettled([
    a.acquire(actor, undefined, scope),
    b.acquire(actor, undefined, scope)
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const original = results[0].status === "fulfilled" ? a : b;
  const old = results.find((r) => r.status === "fulfilled").value;
  const recovery = createJournal(f.api);
  let writes = 0,
    replacement;
  const trial = githubFixture({
    guard: async () => {
      await original.guard(old.run);
      // Pause after the final guard immediately before PR creation. Recovery
      // takes ownership while the already authorized HTTP call is in flight.
      if (++writes === 4)
        replacement = await recovery.acquire(actor, old.run.run_id);
    }
  });
  await trial.client.open(trial.record, trial.patch, trial.save);
  assert.ok(replacement);
  await assert.rejects(original.guard(old.run), /lock changed/);
  await assert.rejects(original.release(old.state, old.run), /lock changed/);
  await assert.rejects(trial.client.cleanup(trial.record), /lock changed/);
  assert.equal(trial.pr().state, "open");
  assert.equal(f.state().lock.token, replacement.run.token);
  // This assertion documents the reproduced gap, not a safety pass.
  assert.equal(
    trial.calls.filter((c) => c.method === "POST" && c.path === "/pulls")
      .length,
    1
  );
  t.diagnostic(
    "GAP: one PR POST completed after recovery took ownership between the old guard and HTTP write. Recovery requires the old process to be stopped; the token cannot fence an already in-flight GitHub request."
  );
});

test("CT-10: lost PR dispatch and cleanup responses reuse original operations", async (t) => {
  let loseDelete = true;
  const f = githubFixture({
    after: async ({ method }) => {
      if (method === "DELETE" && loseDelete) {
        loseDelete = false;
        throw Error("cleanup response lost");
      }
    }
  });
  f.lose();
  await assert.rejects(
    f.client.open(f.record, f.patch, f.save),
    /Lost PR response/
  );
  await f.client.open(f.record, f.patch, f.save);
  const plan = fixtureServicePlan();
  let saved,
    result,
    dispatches = 0,
    failSave = true;
  const options = {
    client: {
      identity: async () => ({ actor: { id: "456" }, workflow_id: 12 }),
      dispatch: async (attempt) => {
        dispatches++;
        result = {
          report: await executeServiceSteps(plan, serviceAdapter(), {
            attemptId: attempt.id
          }),
          workflow: { id: 99 }
        };
        return { workflow_run_id: 99 };
      },
      find: async () => ({ id: 99 }),
      result: async () => result
    },
    guard: async () => {},
    maxPolls: 1,
    save: async (value) => {
      if (value.workflow_run_id && failSave) {
        failSave = false;
        throw Error("run ID save lost");
      }
      saved = structuredClone(value);
    }
  };
  await assert.rejects(runServiceAttempt(plan, options), /run ID save lost/);
  assert.equal(saved.state, "dispatching");
  assert.equal(saved.workflow_run_id, null);
  await runServiceAttempt(plan, { ...options, previous: saved });
  await assert.rejects(f.client.cleanup(f.record), /cleanup response lost/);
  await f.client.cleanup(f.record);
  assert.equal(dispatches, 1);
  assert.equal(
    f.calls.filter((c) => c.method === "POST" && c.path === "/pulls").length,
    1
  );
  assert.equal(
    f.calls.filter((c) => c.method === "PATCH" && c.path === "/pulls/25")
      .length,
    1
  );
  assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 1);
  t.diagnostic(
    "One PR creation, one workflow dispatch, one PR closure and one ref deletion across three injected failures."
  );
});

test("CT-11: half-applied presentation preserves human additions", async (t) => {
  const f = processingFixture();
  await processInbox({ ...f, issueNumber: 1 });
  const managed = f.comments[0].id;
  f.required.status = "IN_PROGRESS";
  f.required.conclusion = null;
  let fail = true;
  f.before = async (call) => {
    if (
      fail &&
      call.method === "PATCH" &&
      call.path === `/issues/comments/${managed}`
    ) {
      fail = false;
      throw Error("comment update unavailable");
    }
  };
  await assert.rejects(
    processInbox({ ...f, issueNumber: 1 }),
    /comment update unavailable/
  );
  assert.ok(f.issue.labels.includes("reason:checks-pending"));
  const count = f.state().tickets[1].transitions.length;
  f.issue.labels.push("human-triage");
  const human = {
    id: 90001,
    issue_number: 1,
    body: "Human note",
    user: { id: 999, login: "human" }
  };
  f.comments.push(human);
  await processInbox({ ...f, resume: f.state().lock.run_id });
  assert.equal(f.state().tickets[1].transitions.length, count);
  assert.equal(f.state().tickets[1].comment.id, managed);
  assert.equal(f.comments.length, 2);
  assert.deepEqual(
    f.comments.find((c) => c.id === human.id),
    human
  );
  assert.ok(f.issue.labels.includes("human-triage"));
  assert.match(f.comments.find((c) => c.id === managed).body, /checks-pending/);
  assert.equal(f.state().lock, null);
  t.diagnostic(
    "Resume completed the original managed comment and decision; human label and separate comment were preserved."
  );
});

test("CT-12: a genuine passing report cannot certify another combination", async (t) => {
  let plan, report, id;
  if (process.env.COORDINATOR_CT_LIVE_JOURNAL) {
    const state = JSON.parse(
      await readFile(process.env.COORDINATOR_CT_LIVE_JOURNAL, "utf8")
    );
    const attempt = Object.values(state.batches)
      .flatMap((b) => b.attempts)
      .find(
        (a) =>
          a.phase === "checks" &&
          a.members.length === 2 &&
          a.result?.status === "passed"
      ).progress.service_attempts.candidate;
    const client = createServiceGitHub({
      profile: sandboxProfile,
      runtime: attempt.plan.runtime
    });
    const fresh = await client.result(attempt);
    assert.equal(fresh.report.status, "passed");
    ({ plan, id } = attempt);
    report = fresh.report;
    await saveEvidence("CT-12-live", fresh);
    t.diagnostic(
      `Re-read actual GitHub workflow ${attempt.workflow_run_id}; no workflow dispatched.`
    );
  } else {
    plan = fixtureServicePlan();
    id = randomUUID();
    report = await executeServiceSteps(plan, serviceAdapter(), {
      attemptId: id
    });
  }
  verifyServiceReport(report, plan, id);
  const changed = structuredClone(plan);
  changed.binding = {
    ...changed.binding,
    tickets: [{ issue_number: 1 }, { issue_number: 999 }]
  };
  const { fingerprint: _old, ...contents } = changed;
  changed.fingerprint = serviceHash(contents);
  assert.throws(() => verifyServiceReport(report, changed, id), {
    code: "result-unverified"
  });
  assert.throws(() => verifyServiceReport(report, plan, randomUUID()), {
    code: "result-unverified"
  });
  const f = githubFixture();
  await f.client.open(f.record, f.patch, f.save);
  assert.equal((await f.client.result(f.record)).status, "passed");
  f.merge.tree.sha = "f".repeat(40);
  await assert.rejects(f.client.result(f.record), /actual checkout/);
  t.diagnostic(
    "Rejected changed ticket binding, changed attempt UUID, and wrong actual checkout tree despite green workflow metadata."
  );
});

test("CT-13: candidate and unchanged baseline fail without ticket blame", async (t) => {
  const f = await batchFixture(t),
    items = [await f.ticket(), await f.ticket(), await f.ticket()];
  const prepared = await f.prepare(items),
    checks = checkHarness(prepared, { codeFailure: true, baselineFails: true });
  const h = selectionHarness({ count: 3 });
  let calls = 0;
  const result = await h.run({
    items,
    prepare: async () => prepared,
    check: async () => {
      calls++;
      return checks.run();
    }
  });
  assert.deepEqual(result.selected, []);
  assert.equal(result.stop.kind, "baseline");
  assert.equal(calls, 1);
  assert.equal(checks.state().cleanup, "removed");
  for (const number of [1, 2, 3])
    assert.equal(batchTicketResult(result, number).status, "waiting");
  t.diagnostic(
    "Candidate failure plus failed baseline: one check round, no splitting, all three tickets waiting."
  );
});

test(
  "CT-14: real containers catch wrong worker API and frontend data",
  dockerOptions,
  async (t) => {
    for (const [unit, role, filename, source] of [
      [
        "worker",
        "backend",
        "src/worker.mjs",
        "export function run({row}) { return {id:row.id,value:999}; }"
      ],
      [
        "api",
        "backend",
        "src/api.mjs",
        "export function run({row}) { return {id:row.id,value:10}; }"
      ],
      [
        "frontend",
        "frontend",
        "src/render.mjs",
        "export function run() { return 'Value: 999'; }"
      ]
    ]) {
      const files = sampleFiles();
      files[role][filename] = source;
      const plan = fixtureServicePlan(files),
        id = randomUUID();
      const report = await runDockerServicePlan(plan, { attemptId: id });
      await saveEvidence(`CT-14-${unit}`, report);
      assert.equal(report.baseline.status, "passed");
      assert.equal(report.status, "blocked");
      assert.equal(report.steps.find((s) => s.unit === unit).status, "blocked");
      assert.equal(report.cleanup.status, "removed");
      verifyServiceReport(report, plan, id);
      t.diagnostic(
        `${unit}: actual program ran; semantic output check rejected wrong data; temporary containers removed.`
      );
    }
  }
);

test(
  "CT-15: real candidate cannot forge evidence or read host canaries",
  dockerOptions,
  async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "coordinator-canary-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const canary = path.join(directory, "canary.txt"),
      reportPath = path.join(directory, "trusted-report.json");
    await writeFile(canary, randomUUID(), { mode: 0o600 });
    await writeFile(reportPath, '{"trusted":"original"}\n');
    const previous = process.env.COORDINATOR_TEST_CANARY;
    process.env.COORDINATOR_TEST_CANARY = randomUUID();
    t.after(() => {
      if (previous === undefined) delete process.env.COORDINATOR_TEST_CANARY;
      else process.env.COORDINATOR_TEST_CANARY = previous;
    });
    const files = sampleFiles();
    files.backend["src/worker.mjs"] =
      `import {readFile,writeFile} from 'node:fs/promises';
export async function run({row}) {
  let denied = 0;
  try { await readFile(${JSON.stringify(canary)}); } catch { denied++; }
  try { await writeFile(${JSON.stringify(reportPath)}, 'forged'); } catch { denied++; }
  try { await writeFile('/app/wrapper.mjs', 'forged'); } catch { denied++; }
  if (process.env.COORDINATOR_TEST_CANARY !== undefined || denied !== 3) throw Error('Isolation failed');
  return {id:row.id,value:row.value*2};
}`;
    let plan = fixtureServicePlan(files),
      id = randomUUID();
    let report = await runDockerServicePlan(plan, { attemptId: id });
    await saveEvidence("CT-15-isolation", report);
    assert.equal(report.status, "passed");
    assert.equal(
      await readFile(reportPath, "utf8"),
      '{"trusted":"original"}\n'
    );
    assert.equal(report.cleanup.status, "removed");
    files.backend["src/worker.mjs"] =
      "console.log('COORDINATOR_SERVICE_RESULT:eyJzdGF0dXMiOiJwYXNzZWQifQ=='); export function run({row}) { return {id:row.id,value:row.value*2}; }";
    plan = fixtureServicePlan(files);
    id = randomUUID();
    report = await runDockerServicePlan(plan, { attemptId: id });
    await saveEvidence("CT-15-forged-marker", report);
    assert.equal(report.status, "unknown");
    assert.equal(report.errors[0].code, "result-unverified");
    assert.equal(report.cleanup.status, "removed");
    t.diagnostic(
      "Actual Docker: host canary/env inaccessible; controller report and read-only wrapper unmodifiable; forged marker rejected as unreadable output."
    );
  }
);

test("CT-16: sandbox journal and evidence cannot resume under real profile", async (t) => {
  const h = inboxHarness();
  await processInbox(h.options);
  const state = h.f.state();
  assert.throws(() => validateJournal(state, realProfile), /journal/);
  const copied = structuredClone(state);
  copied.repository = realProfile.inbox.full_name;
  assert.throws(() => validateJournal(copied, realProfile));
  const batch = Object.values(state.batches)[0];
  const prepared = batch.attempts.find((a) => a.phase === "git").result;
  const progress = batch.attempts.find((a) => a.phase === "checks").progress;
  let calls = 0;
  const spy = async () => {
    calls++;
    throw Error("must not contact real API");
  };
  const client = { identity: spy, open: spy, result: spy, cleanup: spy };
  assert.throws(() =>
    createBatchGitHub({ profile: realProfile, execute: spy })
  );
  assert.throws(() =>
    createServiceGitHub({ profile: realProfile, execute: spy })
  );
  await assert.rejects(
    checkBatch(prepared, {
      profile: realProfile,
      previous: progress,
      client,
      serviceClient: client,
      save: spy,
      guard: spy
    })
  );
  await assert.rejects(
    verifySavedBatch(prepared, progress, {
      profile: realProfile,
      client,
      serviceClient: client,
      guard: spy
    })
  );
  assert.equal(calls, 0);
  t.diagnostic(
    "Matching issue/PR numbers did not override profile/repository bindings; zero real API calls or writes."
  );
});

test(
  "CT-17: committed database change with lost checkpoint stops dependents",
  dockerOptions,
  async (t) => {
    const f = serviceFixture(databaseCandidate());
    f.entry.request.database_change = "yes";
    const plan = buildServicePlan(f.entry, f.report(), f.profile, f.runtime);
    let saved,
      report,
      lost = false,
      reads = 0,
      dispatches = 0;
    const options = {
      guard: async () => {},
      maxPolls: 1,
      save: async (attempt) => {
        saved = structuredClone(attempt);
      },
      client: {
        identity: async () => ({ actor: { id: "456" }, workflow_id: 12 }),
        dispatch: async (attempt) => {
          dispatches++;
          report = await runDockerServicePlan(plan, {
            attemptId: attempt.id,
            save: async (value) => {
              if (!lost && value.steps[0].status === "passed") {
                lost = true;
                throw Error("checkpoint unavailable after COMMIT");
              }
            }
          });
          await saveEvidence("CT-17-database", report);
          return { workflow_run_id: 99 };
        },
        result: async () =>
          ++reads === 1 ? null : { report, workflow: { id: 99 } },
        find: async () => ({ id: 99 })
      }
    };
    await assert.rejects(runServiceAttempt(plan, options), {
      code: "workflow-pending"
    });
    assert.equal(lost, true);
    assert.equal(report.status, "unknown");
    assert.equal(report.database_state.row.value, 15);
    assert.equal(report.database_state.row.display_value, null);
    assert.ok(
      report.database_state.applied_changes.includes("add-display-value")
    );
    assert.ok(report.steps.slice(1).every((step) => step.status === "not-run"));
    assert.equal(report.cleanup.status, "removed");
    const resumed = await runServiceAttempt(plan, {
      ...options,
      previous: saved
    });
    assert.equal(dispatches, 1);
    assert.equal(resumed.result.report.status, "unknown");
    t.diagnostic(
      "Actual MySQL committed schema/data (value 15, change ID present). Failed checkpoint stopped worker/API/frontend; resume read the same attempt once, without rerunning the database change or claiming rollback."
    );
  }
);

test("CT-18: expiry resumes the same partial trial and preserves prior proof", async (t) => {
  const f = await batchFixture(t),
    a = await f.ticket(),
    b = await f.ticket();
  const preparedB = await f.prepare([b]),
    checks = checkHarness(preparedB);
  const h = selectionHarness({
    count: 2,
    policy: { ...batchPolicy, max_check_attempts: 3 }
  });
  let clock = 1000,
    interrupted = false;
  const open = checks.client.open;
  checks.client.open = async (record, patch, save) => {
    if (record.role === "frontend" && !interrupted) {
      interrupted = true;
      clock += batchPolicy.max_elapsed_ms + 1;
      throw Error("stopped before frontend PR");
    }
    // Reconcile an existing remote PR without recreating it.
    if (record.number) return;
    return open(record, patch, save);
  };
  const options = {
    items: [a, b],
    now: () => clock,
    prepare: async (group) =>
      group.length === 1 && group[0].number === 2
        ? preparedB
        : { status: "passed", numbers: group.map((i) => i.number) },
    check: async (prepared, options) => {
      if (prepared.numbers?.length === 2)
        return {
          status: "blocked",
          kind: "code",
          baseline: { status: "passed" }
        };
      if (prepared.numbers?.[0] === 1) return { status: "passed" };
      return checks.run(options);
    }
  };
  await assert.rejects(h.run(options), /stopped before frontend/);
  const previous = h.writes.at(-1);
  const pending = previous.attempts.find(
    (a) => a.phase === "checks" && a.members.join() === "2"
  );
  assert.equal(pending.progress.prs[0].role, "backend");
  assert.ok(pending.progress.prs[0].number);
  assert.equal(pending.progress.prs[1].number, undefined);
  assert.equal(previous.attempts.filter((a) => a.phase === "checks").length, 3);
  const result = await h.run({ ...options, previous });
  assert.equal(result.deadline, previous.deadline);
  assert.deepEqual(result.selected, [1]);
  assert.equal(result.attempts.filter((a) => a.phase === "checks").length, 3);
  assert.equal(
    result.attempts.find((a) => a.id === pending.id).progress.cleanup,
    "removed"
  );
  assert.equal(checks.events.filter((e) => e === "open:backend").length, 1);
  assert.equal(checks.events.filter((e) => e === "open:frontend").length, 1);
  assert.equal(batchTicketResult(result, 2).status, "waiting");
  t.diagnostic(
    "Three-round budget and original deadline survived resume; partial backend/frontend trial finished and cleaned, prior A pass retained, no fourth round."
  );
});

test("CT-19: later pages and an unlabeled journaled ticket cannot disappear", async (t) => {
  const history = Array.from({ length: 350 }, (_, i) => ({
    number: i + 2,
    state: "closed",
    labels: ["release-request"]
  }));
  let pageReads = 0;
  const get = async (endpoint) => {
    pageReads++;
    const page = Number(
      new URL(`https://example.invalid/${endpoint}`).searchParams.get("page")
    );
    return history.slice((page - 1) * 100, page * 100);
  };
  assert.equal((await openIssues(get, realProfile, true)).length, 350);
  assert.equal(pageReads, 4);
  await assert.rejects(
    openIssues(
      async (endpoint) => {
        if (endpoint.endsWith("page=3")) throw Error("page unavailable");
        return get(endpoint);
      },
      realProfile,
      true
    ),
    /page unavailable/
  );
  const f = processingFixture();
  await processInbox({ ...f, issueNumber: 1 });
  f.issue.labels = ["user-note"];
  const again = await processInbox(f);
  assert.equal(again.requests[0].issue_number, 1);
  assert.ok(f.issue.labels.includes("status:waiting"));
  let reads = 0,
    failPage = false;
  const github = createReadinessGitHub({
    execute: async (_file, args) => {
      const page = args.includes("cursor=second")
        ? 2
        : args.includes("cursor=third")
          ? 3
          : 1;
      reads++;
      if (failPage && page === 3) throw Error("unavailable");
      const nodes =
        page === 3
          ? [{ ...f.required, id: "failed-late", conclusion: "FAILURE" }]
          : Array.from({ length: 100 }, (_, i) => ({
              ...f.required,
              id: `page-${page}-${i}`
            }));
      const pr = {
        ...f.pr,
        commits: {
          nodes: [
            {
              commit: {
                oid: f.pr.headRefOid,
                statusCheckRollup: {
                  contexts: {
                    nodes,
                    pageInfo: {
                      hasNextPage: page < 3,
                      endCursor: page === 1 ? "second" : "third"
                    }
                  }
                }
              }
            }
          ]
        }
      };
      delete pr.checks;
      return {
        stdout: JSON.stringify({ data: { repository: { pullRequest: pr } } })
      };
    }
  });
  const pr = await github.pullRequest("6529seize-backend", 10);
  assert.equal(reads, 3);
  assert.equal(pr.checks.length, 201);
  const checks = inspectPull(
    pr,
    f.request.release_parts[0].pull_requests[0],
    "6529seize-backend"
  );
  assert.ok(
    checks.some((c) => c.id === "required_checks" && c.status === "blocked")
  );
  failPage = true;
  await assert.rejects(
    github.pullRequest("6529seize-backend", 10),
    /readiness read failed/
  );
  t.diagnostic(
    "350 historical issues across four pages; journal recovered unlabeled open issue; failed required check #201 blocked readiness; missing pages threw explicit errors."
  );
});

test("CT-20: unsupported cross-ticket declarations are rejected at intake", async (t) => {
  const entries = Array.from({ length: 4 }, () => serviceFixture().entry);
  const prerequisites = [[], [1], [1], [2, 3]];
  for (const [index, entry] of entries.entries()) {
    const request = structuredClone(entry.request);
    request.depends_on_requests = prerequisites[index];
    request.inseparable_group = "A-B-C-D";
    const validation = validateProfileRequest(request, sandboxProfile);
    assert.equal(validation.ok, false);
    assert.match(
      JSON.stringify(validation.errors),
      /unknown|unexpected|additional|allowed|unrecognized/i
    );
  }
  t.diagnostic(
    "Current intake refused unsupported cross-ticket fields. Future dependency-aware splitting, cycles and inseparable groups remain unimplemented and were not executed."
  );
});
