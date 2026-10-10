import test from "node:test";
import assert from "node:assert/strict";
import { failedChecks } from "./check-retry-fixture.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { executeRelease } from "../src/release-execution.mjs";
import { refreshUntouchedRelease } from "../src/untouched-release-refresh.mjs";
import { untouchedBranch } from "../src/untouched-release-state.mjs";
import {
  createJournal,
  inboxWorkflow,
  validateJournal
} from "../src/inbox-journal.mjs";
import { validateReleaseExecution } from "../src/release-state.mjs";
import { readInbox } from "../src/inbox-reader.mjs";
import { realProfile } from "../src/profiles.mjs";
import { readInboxSelection } from "../src/inbox-selection.mjs";
import { serviceHash } from "../src/service-contract.mjs";
import { makeArchive, verifyArchive } from "../src/inbox-history.mjs";
import { runInboxRunCli } from "../src/inbox-run-cli.mjs";
import { createReleaseGitHub } from "../src/release-github.mjs";
import { realProductWorkflowRuntime } from "../src/product-workflow-runtime-config.mjs";
import { batchFingerprint } from "../src/batch-retry-history.mjs";

const evidence = (batch) => ({
  repository_id: realProfile.repositories.frontend.id,
  repository: realProfile.repositories.frontend.full_name,
  branch: untouchedBranch(batch.execution),
  branch_absent: true,
  prs_absent: true,
  actor: structuredClone(batch.execution.actor),
  versions: {
    staging: { backend: "8".repeat(40), frontend: "8".repeat(40) },
    prod: { backend: "9".repeat(40), frontend: "9".repeat(40) }
  },
  checked_at: "2026-10-09T14:00:00.000Z"
});

async function stopped() {
  const h = await failedChecks();
  await assert.rejects(
    processInbox({
      ...h.resume,
      retryChecks: h.attemptId,
      release: (options) =>
        executeRelease({
          ...options,
          client: {
            identity: async () => ({
              actor: { id: "456", login: "trusted-user" },
              runtime: { backend: {}, frontend: {} },
              versions: {
                staging: { backend: "b".repeat(40), frontend: "b".repeat(40) },
                prod: { backend: "b".repeat(40), frontend: "b".repeat(40) }
              }
            }),
            integrate: async () => {
              throw new Error("stop in serialization wait");
            }
          }
        })
    }),
    /serialization wait/
  );
  const state = h.f.state();
  h.original = structuredClone(state.batches[state.lock.batch_fingerprint]);
  h.releaseId = h.original.execution.plan.release_id;
  h.setBase("9".repeat(40));
  h.refresh = {
    ...h.resume,
    refreshUntouched: h.releaseId,
    verifyUntouched: evidence
  };
  return h;
}

async function admission(h) {
  const journal = createJournal(h.f.api, realProfile, {
    workflow: inboxWorkflow,
    ticketConcurrency: true
  });
  const { state, run } = await journal.acquire(
    await h.f.identity(),
    h.resume.resume
  );
  const entry = (await readInbox({ get: h.f.get, profile: realProfile }))
    .requests[0];
  return {
    ...h.resume,
    releaseId: h.releaseId,
    state,
    run,
    selection: readInboxSelection(run.scope),
    entries: new Map([[1, entry]]),
    issues: new Map([[1, h.f.issue]]),
    inspect: async () => entry,
    verifyUntouched: evidence,
    verifyTrials: h.resume.retryTrials,
    loadBatch: (hash, options) =>
      journal.loadHistory(state, run, "batches", hash, options),
    guard: () => journal.guard(run),
    save: (message) => journal.save(state, run, message)
  };
}

test("explicit untouched refresh preserves the whole old checkpoint and retry archive, retests the same request and charges all budgets", async () => {
  const h = await stopped();
  const old = structuredClone(h.original),
    before = h.f.state();
  const archive = before.history.batches[h.parent.fingerprint];
  const archived = structuredClone(h.f.file(archive.path));
  await assert.rejects(
    processInbox(h.refresh),
    /fixture stop before deployment/
  );
  const state = h.f.state(),
    retired = state.batches[old.fingerprint];
  const next = state.batches[state.lock.batch_fingerprint];
  validateJournal(state, realProfile);
  assert.equal(state.untouched_release_refresh, "untouched-release-refresh-v1");
  const markerless = structuredClone(state);
  delete markerless.untouched_release_refresh;
  assert.throws(
    () => validateJournal(markerless, realProfile),
    /refresh.*marker/
  );
  const unknown = structuredClone(state);
  unknown.untouched_release_refresh = "unknown";
  assert.throws(() => validateJournal(unknown, realProfile), /Unsupported/);
  assert.equal(retired.execution.status, "superseded");
  assert.deepEqual(retired.execution.refresh.previous_execution, old.execution);
  assert.equal(retired.execution.refresh.previous_batch_hash, serviceHash(old));
  assert.deepEqual(retired.attempts, old.attempts);
  assert.deepEqual(retired.inputs, old.inputs);
  assert.deepEqual(retired.selected, old.selected);
  assert.deepEqual(h.f.file(archive.path), archived);
  assert.deepEqual(state.lock.reprepared_batches, [old.fingerprint]);
  assert.notEqual(next.fingerprint, old.fingerprint);
  assert.equal(
    next.inputs[0].input.repositories[0].destination.commit,
    "9".repeat(40)
  );
  assert.deepEqual(next.retry_of, old.retry_of);
  assert.deepEqual(h.budgets.at(-1), { git: 2, checks: 2 });
  assert.equal(next.attempts[1].result.status, "passed");
  assert.notEqual(next.attempts[1].id, old.attempts[1].id);
  assert.equal(h.events.filter((event) => event.startsWith("open:")).length, 3);
  assert.equal(
    next.execution,
    undefined,
    "fixture stops before any new deployment"
  );
  const attempts = structuredClone(next.attempts);
  await assert.rejects(
    processInbox(h.refresh),
    /fixture stop before deployment/
  );
  assert.deepEqual(h.f.state().batches[next.fingerprint].attempts, attempts);
  const { archive: saved, ref } = makeArchive(
    "batches",
    retired.fingerprint,
    retired,
    realProfile
  );
  assert.deepEqual(
    verifyArchive(saved, "batches", retired.fingerprint, ref, realProfile),
    retired
  );
});

test("ordinary resume does not supersede or retest an untouched release", async () => {
  const h = await stopped();
  const opens = h.events.filter((event) => event.startsWith("open:")).length;
  await assert.rejects(
    processInbox(h.resume),
    /fixture stop before deployment/
  );
  assert.deepEqual(h.f.state().batches[h.original.fingerprint], h.original);
  assert.equal(
    h.events.filter((event) => event.startsWith("open:")).length,
    opens
  );
});

test("repeating the old release ID cannot supersede a newer saved execution", async () => {
  const h = await stopped();
  await assert.rejects(
    processInbox({
      ...h.refresh,
      release: (options) =>
        executeRelease({
          ...options,
          client: {
            identity: async () => ({
              actor: structuredClone(h.original.execution.actor),
              runtime: { backend: {}, frontend: {} },
              versions: evidence(h.original).versions
            }),
            integrate: async () => {
              throw new Error("new untouched wait");
            }
          }
        })
    }),
    /new untouched wait/
  );
  const o = await admission(h),
    before = structuredClone(o.state);
  const current = o.state.batches[o.run.batch_fingerprint];
  assert.notEqual(current.execution.plan.release_id, h.releaseId);
  assert.equal(current.execution.status, "running");
  o.verifyUntouched = async () => assert.fail("no new refresh admission");
  o.save = async () => assert.fail("no new refresh save");
  await refreshUntouchedRelease(o);
  assert.deepEqual(o.state, before);
});

test("interruption after the atomic refresh save continues ordinary fresh preparation without replaying retirement", async () => {
  const h = await stopped(),
    options = await admission(h);
  const save = options.save;
  options.save = async (message) => {
    await save(message);
    throw new Error("response lost after saved refresh");
  };
  await assert.rejects(refreshUntouchedRelease(options), /response lost/);
  const saved = h.f.state();
  assert.equal(saved.lock.batch_fingerprint, undefined);
  validateJournal(saved, realProfile);
  await assert.rejects(
    processInbox(h.resume),
    /fixture stop before deployment/
  );
  const state = h.f.state(),
    next = state.batches[state.lock.batch_fingerprint];
  assert.deepEqual(state.lock.reprepared_batches, [h.original.fingerprint]);
  assert.equal(next.attempts[1].result.status, "passed");
  assert.deepEqual(h.budgets.at(-1), { git: 2, checks: 2 });
});

test("refresh refuses ownership/scope changes, uncertain integration fields, other steps, database/backend work and unclean trials before remote admission", async () => {
  const h = await stopped();
  for (const mutate of [
    (o) => {
      o.releaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    },
    (o) => {
      o.run.actor.id = "999";
    },
    (o) => {
      o.selection.mode = "inbox";
    },
    (o) => {
      o.run.scope.close_test = true;
    },
    (o, b) => {
      b.execution.versions.staging.frontend = "unknown";
    },
    (o, b) => {
      b.execution.operations["staging:integrate:frontend"].profile = "sandbox";
    },
    (o, b) => {
      b.execution.operations["staging:integrate:frontend"].actor = {
        id: "999",
        login: "other"
      };
    },
    (o, b) => {
      b.execution.operations["staging:integrate:frontend"].branch =
        "unexpected";
    },
    (o, b) => {
      b.execution.operations["staging:integrate:frontend"].integration_commit =
        "a".repeat(40);
    },
    (o, b) => {
      b.execution.operations["staging:integrate:frontend"].unknown_intent =
        true;
    },
    (o, b) => {
      b.execution.step_index = 1;
    },
    (o, b) => {
      b.execution.operations["prod:e2e"] = {};
    },
    (o, b) => {
      b.inputs[0].database_change = "yes";
    },
    (o, b) => {
      b.inputs[0].input.repositories[0].role = "backend";
    },
    (o, b) => {
      b.attempts[1].progress.cleanup = "pending";
    },
    (o) => {
      o.entries.get(1).request.requested_by = "edited";
    }
  ]) {
    const o = await admission(h),
      b = o.state.batches[o.run.batch_fingerprint];
    let calls = 0;
    o.verifyUntouched = async () => {
      calls++;
      return evidence(b);
    };
    mutate(o, b);
    await assert.rejects(refreshUntouchedRelease(o));
    assert.equal(calls, 0);
  }
});

test("absence, branch stability, cleanup, source gates and a never-attempted changed main are required before any refresh save", async () => {
  const h = await stopped();
  for (const change of [
    (o) => {
      o.verifyUntouched = async (b) => ({
        ...evidence(b),
        branch_absent: false
      });
    },
    (o) => {
      o.verifyUntouched = async (b) => ({ ...evidence(b), prs_absent: false });
    },
    (o) => {
      o.verifyTrials = async () => {
        throw new Error("workflow still active");
      };
    },
    (o) => {
      o.observe = async () => ({
        checks: [{ status: "fail" }],
        pull_requests: []
      });
    },
    (o) => {
      o.plan = async () => o.run.plans[1];
    },
    (o) => {
      let reads = 0;
      o.verifyUntouched = async (b) => {
        const proof = evidence(b);
        if (++reads === 2) proof.versions.staging.frontend = "7".repeat(40);
        return proof;
      };
    },
    (o) => {
      o.verifyUntouched = async () => {
        throw new Error("GitHub read unavailable");
      };
    },
    (o) => {
      o.plan = async (entry) => {
        const plan = await h.resume.plan(entry);
        plan.repositories[0].pull_requests[0].commit = "7".repeat(40);
        return plan;
      };
    }
  ]) {
    const o = await admission(h),
      before = structuredClone(o.state.batches);
    let saves = 0;
    o.save = async () => {
      saves++;
    };
    change(o);
    await assert.rejects(refreshUntouchedRelease(o));
    assert.equal(saves, 0);
    assert.deepEqual(o.state.batches, before);
  }
});

test("a supersession cannot forge successful release proof, alter old operations/attempts, or resume the old candidate", async () => {
  const h = await stopped(),
    o = await admission(h);
  await refreshUntouchedRelease(o);
  const retired = o.state.batches[h.original.fingerprint];
  for (const mutate of [
    (b) => {
      b.execution.operations["staging:integrate:frontend"].result = {
        status: "passed"
      };
    },
    (b) => {
      b.attempts[0].id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    },
    (b) => {
      b.execution.refresh.evidence.prs_absent = false;
    },
    (b) => {
      b.execution.refresh.plans[1].repositories[0].pull_requests[0].commit =
        "7".repeat(40);
    },
    (b) => {
      b.execution.refresh.previous_execution.operations[
        "staging:integrate:frontend"
      ].branch = "created";
    },
    (b) => {
      b.execution.status = "running";
    }
  ]) {
    const forged = structuredClone(retired);
    mutate(forged);
    assert.throws(() => validateReleaseExecution(forged.execution, forged));
  }
  await assert.rejects(
    executeRelease({ batch: retired, client: {} }),
    /stale batch/
  );
});

test("failed fresh candidate CI cannot reuse the superseded pass or start a release", async () => {
  const h = await stopped();
  h.setPass(false);
  const report = await processInbox(h.refresh);
  assert.deepEqual(report.batch.selected, []);
  assert.equal(report.release_executed, false);
  assert.equal(h.events.includes("release"), false);
  const state = h.f.state();
  const retired =
    state.batches[h.original.fingerprint] ??
    h.f.file(state.history.batches[h.original.fingerprint].path).record;
  assert.equal(retired.execution.status, "superseded");
  assert.deepEqual(retired.attempts, h.original.attempts);
});

test("prior refreshed and retry rounds exhaust the original budget without any new allocation", async () => {
  const h = await stopped(),
    o = await admission(h);
  const history = new Map();
  // One failed ancestor + the selected parent + ten earlier rounds spend all
  // twelve check attempts. These remain separate snapshots, not a new budget.
  for (let i = 0; i < 10; i++) {
    const record = structuredClone(h.original);
    delete record.execution;
    record.selected = [];
    record.stop = { status: "stale" };
    record.inputs[0].input.repositories[0].destination.commit =
      String(i).repeat(40);
    record.fingerprint = batchFingerprint(record);
    history.set(record.fingerprint, record);
  }
  o.run.reprepared_batches = [...history.keys()];
  const load = o.loadBatch;
  o.loadBatch = (hash, options) => history.get(hash) ?? load(hash, options);
  o.verifyUntouched = async () => {
    throw new Error("must not read resources");
  };
  let saves = 0;
  o.save = async () => {
    saves++;
  };
  await assert.rejects(refreshUntouchedRelease(o), /budget is exhausted/);
  assert.equal(saves, 0);
});

test("cancellation or ownership loss before the refresh save changes no batch or plan", async () => {
  const h = await stopped();
  for (const failure of ["cancel", "ownership"]) {
    const o = await admission(h),
      before = structuredClone(o.state);
    let reads = 0;
    if (failure === "cancel") {
      const controller = new AbortController();
      o.signal = controller.signal;
      o.verifyUntouched = async (batch) => {
        if (++reads === 2) controller.abort(new Error("cancel refresh"));
        return evidence(batch);
      };
    } else {
      let guards = 0;
      o.guard = async () => {
        if (++guards > 1) throw new Error("ownership changed");
      };
    }
    await assert.rejects(
      refreshUntouchedRelease(o),
      /cancel refresh|ownership changed/
    );
    assert.deepEqual(o.state, before);
  }
});

test("a previously attempted current main is not a reason to allocate another fresh round", async () => {
  const h = await stopped(),
    o = await admission(h);
  const previous = structuredClone(h.original);
  delete previous.execution;
  previous.selected = [];
  previous.stop = { status: "stale" };
  previous.inputs[0].input.repositories[0].destination.commit = "9".repeat(40);
  previous.fingerprint = batchFingerprint(previous);
  o.run.reprepared_batches = [previous.fingerprint];
  const load = o.loadBatch;
  o.loadBatch = (hash, options) =>
    hash === previous.fingerprint ? previous : load(hash, options);
  let saves = 0;
  o.save = async () => {
    saves++;
  };
  await assert.rejects(
    refreshUntouchedRelease(o),
    /not previously attempted main/
  );
  assert.equal(saves, 0);
});

test("owned integration absence admission is GET-only and rejects existing/ambiguous resources and failed reads", async () => {
  const h = await stopped();
  for (const scenario of [
    "absent",
    "branch",
    "pr",
    "bad-list",
    "transport",
    "actor"
  ]) {
    const calls = [];
    const client = createReleaseGitHub({
      profile: realProfile,
      runtime: realProductWorkflowRuntime,
      execute: async (args) => {
        const method = args[args.indexOf("--method") + 1];
        const endpoint = args[args.indexOf("--method") + 2];
        assert.equal(method, "GET");
        calls.push(endpoint);
        if (scenario === "transport") throw new Error("read unavailable");
        let status = 200,
          data;
        if (endpoint === "user")
          data = {
            id: scenario === "actor" ? 999 : 456,
            login: "trusted-user"
          };
        else if (endpoint.endsWith("6529seize-frontend"))
          data = {
            ...realProfile.repositories.frontend,
            permissions: { push: true }
          };
        else if (endpoint.includes("/pulls?"))
          data =
            scenario === "pr"
              ? [{ number: 123 }]
              : scenario === "bad-list"
                ? {}
                : [];
        else if (endpoint.includes("/git/ref/heads/codex/release-")) {
          status = scenario === "branch" ? 200 : 404;
          data = {};
        } else data = { object: { sha: "9".repeat(40) } };
        return (
          "HTTP/2 " +
          status +
          " OK\nContent-Type: application/json\n\n" +
          JSON.stringify(data)
        );
      }
    });
    if (scenario === "absent") {
      const proof = await client.verifyUntouchedRelease({ batch: h.original });
      assert.equal(proof.branch_absent, true);
      assert.equal(proof.prs_absent, true);
      assert.equal(calls.length, 8);
    } else
      await assert.rejects(
        client.verifyUntouchedRelease({ batch: h.original })
      );
  }
});

test("CLI binds untouched refresh to an exact release UUID and forbids scope changes and competing actions before client creation", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  for (const args of [
    ["--refresh-untouched-release", releaseId],
    ["--resume", runId, "--refresh-untouched-release", "bad"],
    ...[
      "--review-stop",
      "--cancel-keep-current",
      "--retry-checks",
      "--staging-change"
    ].map((flag) => [
      "--resume",
      runId,
      "--refresh-untouched-release",
      releaseId,
      flag,
      ...(flag === "--retry-checks"
        ? [releaseId]
        : flag === "--staging-change"
          ? ["retest"]
          : [])
    ])
  ])
    assert.equal(
      await runInboxRunCli(args, {
        stdout: () => {},
        stderr: () => {},
        createLog: () => {
          throw new Error("must not initialize");
        }
      }),
      2
    );
  for (const env of [
    {
      RELEASE_COORDINATOR_PROFILE: "sandbox",
      RELEASE_COORDINATOR_SCOPE: "filtered"
    },
    { RELEASE_COORDINATOR_PROFILE: "real", RELEASE_COORDINATOR_SCOPE: "inbox" }
  ])
    assert.equal(
      await runInboxRunCli(
        ["--resume", runId, "--refresh-untouched-release", releaseId],
        {
          env,
          stdout: () => {},
          stderr: () => {},
          createLog: () => {
            throw new Error("must not initialize");
          }
        }
      ),
      2
    );
});

test("valid CLI refresh forwards the exact saved identity and only creates a read-only admission client on demand", async () => {
  const runId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const log = {
    snapshot: () => ({ complete: true }),
    run: (fn) => fn(),
    finish: () => ({}),
    close: () => {}
  };
  const batch = { fixture: true };
  let clients = 0;
  assert.equal(
    await runInboxRunCli(
      ["--resume", runId, "--refresh-untouched-release", releaseId, "--json"],
      {
        env: {
          RELEASE_COORDINATOR_PROFILE: "real",
          RELEASE_COORDINATOR_SCOPE: "filtered"
        },
        createLog: () => log,
        client: {
          request: async () => assert.fail("no CLI writes"),
          identity: async () => ({})
        },
        get: { identity: async () => {} },
        github: {},
        stdout: () => {},
        stderr: () => {},
        createReleaseClient: ({ profile, adapter }) => {
          clients++;
          assert.equal(profile.name, "real");
          assert.equal(adapter, "product-workflows");
          return {
            verifyUntouchedRelease: async (args) => {
              assert.deepEqual(args, { batch });
              return "proof";
            }
          };
        },
        run: async (options) => {
          assert.equal(clients, 0);
          assert.equal(options.resume, runId);
          assert.equal(options.refreshUntouched, releaseId);
          assert.equal(options.selectionMode, "filtered");
          assert.deepEqual(options.issueNumbers, []);
          assert.equal(options.actorLogin, undefined);
          assert.equal(await options.verifyUntouched(batch), "proof");
          assert.equal(await options.verifyUntouched(batch), "proof");
          return { requests: [], release_executed: false };
        }
      }
    ),
    0
  );
  assert.equal(clients, 1);
});

test("refresh preserves unrelated ticket and batch records and cannot remove its durable writer marker", async () => {
  const h = await stopped(),
    o = await admission(h);
  const unrelated = structuredClone(o.state.tickets[1]);
  unrelated.issue_id = 999;
  o.state.tickets[999] = unrelated;
  // The fake guard/save below isolates the helper's changes; live journal
  // ownership and same-key concurrent edits are separately enforced by save.
  const beforeTickets = structuredClone(o.state.tickets);
  const beforeBatches = structuredClone(o.state.batches);
  o.guard = async () => {};
  o.save = async () => {};
  await refreshUntouchedRelease(o);
  assert.deepEqual(o.state.tickets, beforeTickets);
  for (const [hash, batch] of Object.entries(beforeBatches))
    if (hash !== h.original.fingerprint)
      assert.deepEqual(o.state.batches[hash], batch);
  const saved = await admission(h);
  await refreshUntouchedRelease(saved);
  delete saved.state.untouched_release_refresh;
  await assert.rejects(
    saved.save("must preserve refresh marker"),
    /refresh.*marker.*preserved/
  );
});
