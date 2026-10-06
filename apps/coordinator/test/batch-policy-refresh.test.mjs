import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./processing-fixture.mjs";
import { realProfile } from "../src/profiles.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { createJournal, inboxWorkflow } from "../src/inbox-journal.mjs";
import { readInbox } from "../src/inbox-reader.mjs";
import { generateInboxPlan, inboxMergePlan } from "../src/inbox-merge-plan.mjs";
import { coordinateInboxBatch } from "../src/inbox-batch.mjs";
import { checkBatch } from "../src/batch-checks.mjs";
import { selectBatch } from "../src/batch-selection.mjs";
import {
  batchMergePlan,
  priorRealBatchPolicy,
  realBatchPolicy,
  sessionRecoveryRealBatchPolicy,
  realServicePlan
} from "../src/batch-plan.mjs";
import { ServiceError, serviceHash } from "../src/service-contract.mjs";
import {
  buildReleaseRequestIssueBody,
  releaseRequestChecksum
} from "../../../packages/release-request/src/inbox-issue.mjs";

async function interruptedPreparation(policy = priorRealBatchPolicy) {
  const f = fixture(realProfile);
  f.request.target = "production";
  f.request.release_parts = [
    {
      id: "frontend",
      repository: "6529seize-frontend",
      depends_on: [],
      pull_requests: [
        {
          number: 4120,
          branch: "codex/long-post-expansion",
          commit: "c".repeat(40)
        }
      ]
    }
  ];
  f.result.request = structuredClone(f.request);
  f.issue.body = buildReleaseRequestIssueBody({
    request: f.request,
    checksum: releaseRequestChecksum(f.request),
    actor: f.actor.login,
    actorId: String(f.actor.id),
    workflowRunUrl: f.run.html_url,
    submittedAt: f.request.created_at
  });
  const entry = (await readInbox({ get: f.get, profile: realProfile }))
    .requests[0];
  let base = "b".repeat(40);
  const plan = (request) =>
    generateInboxPlan(request, {
      profile: realProfile,
      github: {
        destination: async (role, branch) => ({
          branch,
          commit: base,
          repository: realProfile.repositories[role]
        })
      }
    });
  const input = await plan(entry);
  const item = { number: 1, entry, input };
  const prepare = (items, policy) => {
    const merged = batchMergePlan(items, realProfile, policy);
    return {
      status: "passed",
      input_hash: merged.input_hash,
      binding: merged.batch,
      service_plan: realServicePlan(
        merged,
        { input_hash: merged.input_hash, repositories: [{ role: "frontend" }] },
        items
      ),
      publications: [
        {
          role: "frontend",
          base: items[0].input.repositories[0].destination.commit,
          tree: "d".repeat(40),
          base_tree: "e".repeat(40),
          source_prs: structuredClone(
            items[0].input.repositories[0].pull_requests
          ),
          patch: [
            { path: "docs/example.md", sha: "f".repeat(40), mode: "100644" }
          ]
        }
      ]
    };
  };
  const journal = createJournal(f.api, realProfile, {
    workflow: inboxWorkflow
  });
  const { state, run } = await journal.acquire(await f.identity(), undefined, {
    workflow: inboxWorkflow,
    close_test: false,
    selection: {
      mode: "filtered",
      issue_numbers: [1],
      actor_login: "trusted-user"
    }
  });
  run.plans = { 1: input };
  run.ticket_numbers = [1];
  state.lock.plans = structuredClone(run.plans);
  state.lock.ticket_numbers = [1];
  state.batches ??= {};
  await assert.rejects(
    selectBatch({
      items: [item],
      policy,
      prepare: async (items) => prepare(items, policy),
      check: (prepared, options) =>
        checkBatch(prepared, {
          ...options,
          profile: realProfile,
          client: {
            identity: async () => {
              throw new ServiceError(
                "batch-runtime",
                "A pinned product PR workflow changed."
              );
            }
          }
        }),
      verify: async () => true,
      guard: () => journal.guard(run),
      save: async (batch) => {
        run.batch_fingerprint = batch.fingerprint;
        state.lock.batch_fingerprint = batch.fingerprint;
        state.batches[batch.fingerprint] = structuredClone(batch);
        await journal.save(state, run, "fixture interrupted preparation");
      }
    }),
    { code: "batch-runtime" }
  );
  const old = structuredClone(f.state().batches[run.batch_fingerprint]);
  const events = [],
    budgets = [];
  let releases = 0;
  const options = {
    api: f.api,
    get: f.get,
    identity: f.identity,
    profile: realProfile,
    selectionMode: "filtered",
    resume: run.run_id,
    plan,
    observe: async () => ({
      checks: [{ id: "release_parts", status: "pass" }],
      pull_requests: [
        {
          checks: [
            "requested_code",
            "source_repository",
            "pr_state",
            "merge_conflicts",
            "github_merge_gate",
            "required_checks",
            "reviews",
            "observation_stability"
          ].map((id) => ({ id, status: "pass" }))
        }
      ]
    }),
    rehearsal: async (request, input) => {
      const merged = inboxMergePlan(input, request, realProfile);
      return {
        profile: "real",
        input_source: "verified-inbox",
        input_hash: merged.input_hash,
        inbox: merged.inbox,
        inbox_final: merged.inbox,
        run_id: "33333333-3333-4333-8333-333333333333",
        status: "pass",
        release_authorized: false,
        cleanup: { status: "removed" },
        operation_errors: [],
        checks: [{ id: "inbox_stability", status: "pass" }],
        repositories: merged.repositories.map((repo) => ({
          ...repo,
          repository: repo.identity,
          final_tree: "d".repeat(40),
          checks: [{ id: "local_merge", status: "pass" }]
        }))
      };
    },
    release: async () => {
      releases++;
      throw new Error("fixture stop before deployment");
    },
    batch: (options) =>
      coordinateInboxBatch({
        ...options,
        prepare: async (items, { policy }) => {
          events.push("prepare");
          return prepare(items, policy);
        },
        select: (options) => {
          budgets.push({ policy: options.policy, spent: options.spent });
          return selectBatch(options);
        },
        check: (prepared, options) =>
          checkBatch(prepared, {
            ...options,
            client: {
              identity: async () => {
                assert.deepEqual(options.policy, realBatchPolicy);
                events.push("identity");
                return {
                  actor: { id: "456", login: "trusted-user" },
                  workflow_id: null
                };
              },
              open: async (record, _patch, save) => {
                events.push("open");
                record.number = 2;
                record.commit = "a".repeat(40);
                await save(record);
              },
              result: async () => ({ status: "passed", role: "frontend" }),
              cleanup: async () => {
                events.push("cleanup");
              }
            }
          })
      })
  };
  return {
    f,
    options,
    entry,
    old,
    budgets,
    events,
    setBase: (value) => {
      base = value;
    },
    saveFixture: async (mutate) => {
      mutate(state, run);
      await journal.save(state, run, "fixture existing owned work");
    },
    releases: () => releases
  };
}

for (const policy of [priorRealBatchPolicy, sessionRecoveryRealBatchPolicy]) {
  for (const mainMoves of [false, true]) {
    test(`resume an unpublished ${policy.workflow_blobs.frontend[".github/workflows/app-pr-ci.yml"]} attempt rechecks the same filtered ticket with fresh CI (${mainMoves ? "moved" : "unchanged"} main)`, async () => {
      const h = await interruptedPreparation(policy);
      if (mainMoves) h.setBase("9".repeat(40));
      await assert.rejects(
        processInbox(h.options),
        /fixture stop before deployment/
      );
      const state = h.f.state();
      assert.deepEqual(state.lock.scope.selection, {
        mode: "filtered",
        issue_numbers: [1],
        actor_login: "trusted-user"
      });
      assert.deepEqual(state.lock.reprepared_batches, [h.old.fingerprint]);
      const retired = state.batches[h.old.fingerprint];
      assert.equal(retired.stop.status, "stale");
      assert.deepEqual(retired.policy, h.old.policy);
      assert.deepEqual(retired.attempts[0], h.old.attempts[0]);
      assert.equal(retired.attempts[1].id, h.old.attempts[1].id);
      assert.equal(retired.attempts[1].progress.cleanup, "removed");
      assert.equal(retired.attempts[1].result.status, "stale");
      const fresh = state.batches[state.lock.batch_fingerprint];
      assert.deepEqual(fresh.policy, realBatchPolicy);
      assert.notEqual(fresh.fingerprint, retired.fingerprint);
      assert.notEqual(
        serviceHash(fresh.attempts[0].result),
        serviceHash(retired.attempts[0].result)
      );
      assert.deepEqual(
        fresh.inputs[0].input.repositories[0].pull_requests,
        h.old.inputs[0].input.repositories[0].pull_requests
      );
      assert.equal(
        fresh.inputs[0].input.repositories[0].destination.commit,
        (mainMoves ? "9" : "b").repeat(40)
      );
      assert.deepEqual(h.budgets.at(-1).spent, { git: 1, checks: 1 });
      assert.deepEqual(h.events, ["prepare", "identity", "open", "cleanup"]);
      assert.equal(h.releases(), 1);
      const attempts = structuredClone(fresh.attempts);
      await assert.rejects(
        processInbox(h.options),
        /fixture stop before deployment/
      );
      assert.deepEqual(
        h.f.state().batches[fresh.fingerprint].attempts,
        attempts
      );
      assert.deepEqual(h.events, ["prepare", "identity", "open", "cleanup"]);
    });
  }

  test(`changed source code or failing gates prevent ${policy.workflow_blobs.frontend[".github/workflows/app-pr-ci.yml"]} refresh from starting checks or release`, async () => {
    for (const changed of ["head", "checks"]) {
      const h = await interruptedPreparation(policy);
      if (changed === "head") {
        const plan = h.options.plan;
        h.options.plan = async (entry) => {
          const input = await plan(entry);
          input.repositories[0].pull_requests[0].commit = "8".repeat(40);
          return input;
        };
      } else {
        const observe = h.options.observe;
        h.options.observe = async (...args) => {
          const result = await observe(...args);
          result.pull_requests[0].checks.find(
            (check) => check.id === "required_checks"
          ).status = "fail";
          return result;
        };
      }
      const result = await processInbox(h.options);
      assert.equal(result.batch.stop.status, "stale");
      assert.deepEqual(h.events, []);
      assert.equal(h.releases(), 0);
      assert.equal(h.f.state().lock, null);
      const archive = h.f.state().history.batches[h.old.fingerprint];
      const saved =
        h.f.state().batches[h.old.fingerprint] ?? h.f.file(archive.path).record;
      assert.deepEqual(saved.attempts[0], h.old.attempts[0]);
      assert.deepEqual(saved.policy, h.old.policy);
    }
  });

  test(`resume with a recorded trial keeps ${policy.workflow_blobs.frontend[".github/workflows/app-pr-ci.yml"]} and its original attempt, without fresh publication`, async () => {
    const h = await interruptedPreparation(policy);
    await h.saveFixture((state) => {
      const attempt = state.batches[h.old.fingerprint].attempts[1];
      attempt.progress.prs.push({
        role: "frontend",
        branch: `codex/batch-trial-${attempt.id}`,
        base: "b".repeat(40),
        tree: "d".repeat(40),
        cleanup: "pending"
      });
    });
    h.options.batch = (options) =>
      coordinateInboxBatch({
        ...options,
        prepare: async () =>
          assert.fail("no fresh preparation of published work"),
        check: async (_prepared, { id, previous, policy }) => {
          assert.equal(id, h.old.attempts[1].id);
          assert.equal(previous.prs.length, 1);
          assert.deepEqual(policy, h.old.policy);
          throw new ServiceError(
            "batch-runtime",
            "old workflow remains changed"
          );
        }
      });
    await assert.rejects(
      processInbox(h.options),
      /old workflow remains changed/
    );
    assert.equal(h.f.state().lock.batch_fingerprint, h.old.fingerprint);
    assert.equal(h.f.state().lock.reprepared_batches, undefined);
    assert.deepEqual(h.events, []);
    assert.equal(h.releases(), 0);
  });

  test(`interruption after retiring ${policy.workflow_blobs.frontend[".github/workflows/app-pr-ci.yml"]} resumes the same ticket and preserves spent budgets`, async () => {
    const h = await interruptedPreparation(policy);
    const batch = h.options.batch;
    let calls = 0;
    await assert.rejects(
      processInbox({
        ...h.options,
        batch: (options) => {
          if (++calls === 2)
            throw new Error("fixture interruption after policy retirement");
          return batch(options);
        }
      }),
      /fixture interruption after policy retirement/
    );
    assert.equal(h.f.state().lock.batch_fingerprint, undefined);
    assert.deepEqual(h.f.state().lock.reprepared_batches, [h.old.fingerprint]);
    assert.deepEqual(h.events, []);
    await assert.rejects(
      processInbox(h.options),
      /fixture stop before deployment/
    );
    assert.deepEqual(h.budgets.at(-1).spent, { git: 1, checks: 1 });
    assert.deepEqual(h.events, ["prepare", "identity", "open", "cleanup"]);
    assert.equal(h.releases(), 1);
  });
}
