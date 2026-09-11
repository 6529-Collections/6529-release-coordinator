import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  readFile,
  rm,
  readdir,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createRunLog,
  bindRunLog,
  loggedStep,
  runEvent
} from "../src/run-log.mjs";
import { runInboxRunCli } from "../src/inbox-run-cli.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { sandboxProfile, realProfile } from "../src/profiles.mjs";
import { assertDestination } from "../src/input-stability.mjs";
import { runServiceAttempt } from "../src/inbox-services.mjs";
import { buildServicePlan } from "../src/service-plan.mjs";
import { executeServiceSteps } from "../src/service-contract.mjs";
import { serviceFixture, serviceAdapter } from "./service-fixture.mjs";
import { harness } from "./inbox-batch-harness.mjs";
import { batchFixture } from "./batch-fixture.mjs";
import { checkHarness } from "./checks-harness.mjs";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
async function rootFor(t) {
  const root = await mkdtemp(path.join(tmpdir(), "coordinator-run-logs-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function logger(t, options = {}) {
  let terminal = "";
  const root = await rootFor(t);
  const log = createRunLog({
    root,
    profile: sandboxProfile,
    stderr: (text) => {
      terminal += text;
    },
    ...options
  });
  t.after(() => log.close());
  return {
    log,
    root,
    terminal: () => terminal,
    events: async () =>
      (await readFile(log.snapshot().file, "utf8"))
        .trim()
        .split("\n")
        .map(JSON.parse)
  };
}
async function cli(h, root, options = {}) {
  let output = "",
    terminal = "";
  const code = await runInboxRunCli(options.args ?? ["--json"], {
    env: { RELEASE_COORDINATOR_PROFILE: "sandbox" },
    logRoot: root,
    get: h.f.get,
    client: { identity: h.f.identity, request: h.f.api },
    github: h.f.github,
    run: (args) =>
      processInbox({ ...h.options, resume: args.resume, signal: args.signal }),
    stdout: (text) => {
      output += text;
    },
    stderr: (text) => {
      terminal += text;
    },
    ...options
  });
  return { code, report: JSON.parse(output), output, terminal };
}

test("live start is saved before work finishes; uncertain exceptions cannot become success or leak raw data", async (t) => {
  const secret = "a-private-test-credential";
  const f = await logger(t, { env: { GH_TOKEN: secret } });
  let finish;
  const pending = f.log.run(() => {
    bindRunLog(runId);
    return loggedStep(
      {
        step: "trial.open",
        attempt_id: runId,
        message: "Create the saved trial."
      },
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  });
  let events = await f.events();
  assert.equal(events.at(-1).outcome, "started");
  assert.match(f.terminal(), /Create the saved trial/);
  finish({});
  await pending;
  await assert.rejects(
    f.log.run(() =>
      loggedStep(
        { step: "trial.cleanup", message: "Remove the trial." },
        async () => {
          throw Object.assign(new Error(`raw request body ${secret}`), {
            code: "ECONNRESET"
          });
        }
      )
    )
  );
  f.log.run(() =>
    runEvent({
      step: "example",
      outcome: "unknown",
      message: `Authorization Bearer ${secret} ghp_sensitiveExample \u001b[31merror`,
      request_body: "private body",
      raw_logs: "private logs",
      token: secret
    })
  );
  events = await f.events();
  assert.deepEqual(
    events.filter((e) => e.step === "trial.cleanup").map((e) => e.outcome),
    ["started", "unknown"]
  );
  assert.equal(events.find((e) => e.error_code)?.error_code, "ECONNRESET");
  const output = JSON.stringify(events) + f.terminal();
  for (const value of [
    secret,
    "ghp_sensitiveExample",
    "raw request body",
    "private body",
    "private logs",
    "\u001b"
  ])
    assert.ok(!output.includes(value), value);
  assert.ok(
    events.find((e) => e.step === "trial.open" && e.outcome === "succeeded")
      .duration_ms >= 0
  );
  assert.equal((await stat(f.log.snapshot().file)).mode & 0o077, 0);
});

test("the full CLI leaves JSON stdout parseable and logs cheap work before expensive checks", async (t) => {
  const root = await rootFor(t),
    h = harness();
  const result = await cli(h, root);
  assert.equal(result.code, 0);
  assert.deepEqual(result.report.batch.selected, [1, 2]);
  assert.equal(result.report.logging.complete, true);
  assert.equal(
    path.basename(result.report.logging.file),
    `${result.report.run_id}.jsonl`
  );
  const events = (await readFile(result.report.logging.file, "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const first = (step) =>
    events.findIndex((e) => e.step === step && e.outcome === "started");
  assert.ok(first("inbox.scan") < first("ticket.plan"));
  assert.ok(first("ticket.git") < first("batch.filter"));
  assert.ok(first("batch.git") < first("batch.checks"));
  assert.ok(first("batch.checks") < first("ticket.update"));
  assert.ok(first("ticket.update") < first("journal.release"));
  assert.equal(events.at(-1).step, "run.finish");
  assert.equal(events.at(-1).outcome, "succeeded");
  assert.ok(events.some((e) => e.issue_number === 2 && e.request_id));
  assert.match(result.terminal, /Run log:/);
  assert.deepEqual(await readdir(path.dirname(result.report.logging.file)), [
    `${result.report.run_id}.jsonl`
  ]);
  assert.equal(h.f.state().lock, null);
});

test("interrupted ticket updates retain run history; explicit resume appends and does not rerun services", async (t) => {
  const root = await rootFor(t),
    h = harness();
  const original = h.options.api;
  const controller = new AbortController();
  let stopped = false;
  h.options.api = async (call) => {
    const result = await original(call);
    if (!stopped && call.method === "POST" && call.path.endsWith("/comments")) {
      stopped = true;
      controller.abort();
    }
    return result;
  };
  const first = await cli(h, root, { signal: controller.signal });
  assert.equal(first.code, 2);
  const id = h.f.state().lock.run_id;
  assert.equal(first.report.logging.run_id, id);
  const file = first.report.logging.file;
  const before = await readFile(file, "utf8");
  assert.match(before, /"outcome":"interrupted"/);
  const attempts = h.f.state().batches;
  const second = await cli(h, root, { args: ["--resume", id, "--json"] });
  assert.equal(second.code, 0);
  assert.equal(second.report.logging.file, file);
  const after = await readFile(file, "utf8");
  assert.ok(after.startsWith(before));
  const events = after.trim().split("\n").map(JSON.parse);
  assert.equal(events.filter((e) => e.step === "run.resume").length, 1);
  assert.equal(new Set(events.map((e) => e.invocation_id)).size, 2);
  assert.deepEqual(h.f.state().batches, {});
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(h.f.state().history.batches).map(([identity, ref]) => [
        identity,
        h.f.file(ref.path).record
      ])
    ),
    attempts
  );
  assert.equal(h.dispatches(), 1);
  assert.equal(h.f.state().lock, null);
});

test("lost workflow dispatch is unknown first, then reconciled to verified step and cleanup outcomes", async (t) => {
  const f = await logger(t),
    sample = serviceFixture();
  const plan = buildServicePlan(
    sample.entry,
    sample.report(),
    sample.profile,
    sample.runtime
  );
  let result,
    saved,
    dispatches = 0;
  const options = {
    client: {
      identity: async () => ({
        actor: { id: "456", login: "tester" },
        workflow_id: 12
      }),
      dispatch: async (attempt) => {
        dispatches++;
        result = {
          report: await executeServiceSteps(plan, serviceAdapter(), {
            attemptId: attempt.id
          }),
          workflow: {
            id: 99,
            url: `https://github.com/${plan.runtime.repository}/actions/runs/99`
          }
        };
        throw new Error("lost response with raw private payload");
      },
      find: async () => ({ id: 99 }),
      result: async () => result
    },
    guard: async () => {},
    save: async (attempt) => {
      saved = structuredClone(attempt);
    },
    maxPolls: 1
  };
  await f.log.run(async () => {
    bindRunLog(runId);
    await runServiceAttempt(plan, options);
    await runServiceAttempt(plan, { ...options, previous: saved });
  });
  assert.equal(dispatches, 1);
  const events = await f.events();
  assert.deepEqual(
    events.filter((e) => e.step === "services.dispatch").map((e) => e.outcome),
    ["started", "unknown"]
  );
  assert.ok(
    events
      .filter((e) => e.step === "services.dispatch")
      .every((e) => !Object.hasOwn(e, "workflow_id"))
  );
  assert.ok(
    events.some((e) => e.step === "services.found" && e.workflow_id === 99)
  );
  assert.deepEqual(
    new Set(
      events.filter((e) => e.step === "services.step").map((e) => e.unit)
    ),
    new Set(result.report.steps.map((step) => step.unit))
  );
  for (const step of result.report.steps)
    assert.ok(f.terminal().includes(`service ${step.unit}`));
  assert.ok(
    events.some(
      (e) => e.step === "services.cleanup" && e.cleanup_status === "removed"
    )
  );
  assert.ok(!JSON.stringify(events).includes("raw private payload"));
});

test("real Git candidate plus main movement reports exact repository/commits and verified trial cleanup", async (t) => {
  const logs = await logger(t),
    f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  const h = checkHarness(prepared);
  let changed = false;
  h.client.result = async (record) => {
    changed = true;
    return {
      status: "passed",
      role: record.role,
      workflow_id: 123,
      workflow: `https://github.com/${sandboxProfile.repositories[record.role].full_name}/actions/runs/123`
    };
  };
  const expected = prepared.publications.find((p) => p.role === "backend").base;
  const result = await logs.log.run(async () => {
    bindRunLog(runId);
    return h.run({
      verify: async () => {
        assertDestination({
          role: "backend",
          repository: sandboxProfile.repositories.backend.full_name,
          expected,
          observed: changed ? "f".repeat(40) : expected
        });
      }
    });
  });
  assert.equal(result.status, "stale");
  assert.match(result.message, /backend main changed/);
  assert.ok(result.message.includes(expected));
  assert.ok(result.message.includes("f".repeat(40)));
  assert.equal(h.state().cleanup, "removed");
  assert.ok(!h.events.includes("services"));
  const events = await logs.events();
  const ci = events.filter((event) => event.step === "trial.result");
  assert.equal(ci.length, 2);
  for (const event of ci) {
    assert.equal(event.workflow_id, 123);
    assert.equal(
      event.url,
      `https://github.com/${event.repository}/actions/runs/123`
    );
  }
  const movement = events.find((e) => e.step === "inputs.destination");
  assert.equal(movement.expected_commit, expected);
  assert.equal(movement.observed_commit, "f".repeat(40));
  assert.equal(
    movement.repository,
    sandboxProfile.repositories.backend.full_name
  );
  assert.equal(
    events.filter(
      (e) => e.step === "trial.cleanup" && e.outcome === "succeeded"
    ).length,
    2
  );
});

test("the real inbox verification carries backend movement and cleanup truth to both tickets", async (t) => {
  const root = await rootFor(t),
    h = harness(),
    plan = h.options.plan;
  h.options.plan = async (entry) => {
    const result = await plan(entry);
    if (h.dispatches())
      result.repositories.find(
        (repo) => repo.role === "backend"
      ).destination.commit = "f".repeat(40);
    return result;
  };
  const result = await cli(h, root);
  assert.equal(result.code, 3);
  assert.deepEqual(result.report.batch.selected, []);
  assert.match(result.report.batch.stop.message, /backend main changed/);
  assert.match(
    result.report.batch.stop.message,
    /All recorded temporary trial PRs and branches were verified removed/
  );
  for (const issue of h.f.state().tickets
    ? Object.values(h.f.state().tickets)
    : []) {
    const reason = issue.transitions
      .at(-1)
      .decision.reasons.find((reason) =>
        reason.message.includes("backend main changed")
      );
    assert.ok(reason);
    assert.ok(reason.message.includes("b".repeat(40)));
    assert.ok(reason.message.includes("f".repeat(40)));
  }
});

test("partial PR cleanup never logs all resources removed", async (t) => {
  const logs = await logger(t),
    f = await batchFixture(t),
    prepared = await f.prepare([await f.ticket()]);
  const h = checkHarness(prepared);
  h.client.cleanup = async (record) => {
    if (record.role === "frontend") throw new Error("Lost delete response");
  };
  await assert.rejects(logs.log.run(() => h.run()));
  const events = await logs.events();
  assert.equal(
    events.filter(
      (e) => e.step === "trial.cleanup" && e.outcome === "succeeded"
    ).length,
    1
  );
  assert.ok(
    events.some(
      (e) =>
        e.step === "trial.cleanup" &&
        e.role === "frontend" &&
        e.outcome === "unknown"
    )
  );
  assert.equal(h.state().cleanup, "pending");
  assert.equal(
    h.state().prs.find((p) => p.role === "frontend").cleanup,
    "pending"
  );
});

test("storage is separate for profiles/inboxes and refuses symlinks without overwriting history", async (t) => {
  const root = await rootFor(t),
    paths = [];
  for (const profile of [
    sandboxProfile,
    realProfile,
    { ...sandboxProfile, inbox: { ...sandboxProfile.inbox, id: 123 } }
  ]) {
    const log = createRunLog({ root, profile, stderr: () => {} });
    log.run(() => bindRunLog(runId));
    paths.push(log.snapshot().file);
    log.close();
  }
  assert.equal(new Set(paths).size, 3);
  const victim = path.join(root, "do-not-touch");
  await writeFile(victim, "original");
  const resume = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await symlink(victim, path.join(path.dirname(paths[0]), `${resume}.jsonl`));
  assert.throws(() =>
    createRunLog({ root, profile: sandboxProfile, resume, stderr: () => {} })
  );
  assert.equal(await readFile(victim, "utf8"), "original");
});

test("resume preserves a crash-truncated line and keeps new events separate", async (t) => {
  const f = await logger(t);
  f.log.run(() => bindRunLog(runId));
  f.log.close();
  const filename = f.log.snapshot().file;
  const prior = await readFile(filename, "utf8");
  const truncated = prior + '{"step":"services.dispatch","outcome":"sta';
  await writeFile(filename, truncated);
  const resumed = createRunLog({
    root: f.root,
    profile: sandboxProfile,
    resume: runId,
    stderr: () => {}
  });
  resumed.run(() => bindRunLog(runId, true));
  resumed.finish({ exitCode: 2 });
  resumed.close();
  const contents = await readFile(filename, "utf8");
  assert.ok(contents.startsWith(truncated + "\n"));
  const added = contents
    .slice(truncated.length + 1)
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(
    added.some((e) => e.step === "log.previous-tail" && e.outcome === "unknown")
  );
  assert.equal(resumed.snapshot().previous_tail_incomplete, true);
  assert.equal(added.at(-1).step, "run.finish");
});

test("an unavailable log stops before inbox work; a mid-run disk failure preserves journal cleanup and reports incomplete logging", async (t) => {
  const root = await rootFor(t),
    h = harness(),
    filename = path.join(root, "file");
  await writeFile(filename, "not a directory");
  const stopped = await cli(h, filename, {
    run: async () => assert.fail("must stop before inbox work")
  });
  assert.equal(stopped.code, 2);
  const result = await cli(h, root, {
    createLog: (options) =>
      createRunLog({
        ...options,
        append: (fd, bytes) => {
          // A deterministic disk failure after ownership and saved batch work.
          if (bytes.toString().includes('"step":"ticket.update"'))
            throw new Error("disk full");
          // Use a real file for every successful write.
          return defaultAppend(fd, bytes);
        }
      })
  });
  assert.equal(result.code, 2);
  assert.equal(result.report.logging.complete, false);
  assert.match(result.terminal, /could not be saved completely/);
  assert.deepEqual(result.report.batch.selected, [1, 2]);
  assert.equal(h.f.state().lock, null);
  assert.equal(h.f.comments.length, 2);
});

// Kept below the cases so tests inject only a storage fault, not an alternate
// logger or orchestration path.
import { writeSync, fsyncSync } from "node:fs";
function defaultAppend(fd, bytes) {
  assert.equal(writeSync(fd, bytes), bytes.length);
  fsyncSync(fd);
}
