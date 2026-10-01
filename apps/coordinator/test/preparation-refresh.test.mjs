import test from "node:test";
import assert from "node:assert/strict";
import { refreshedPreparationPlans } from "../src/preparation-refresh.mjs";

const item = () => ({
  number: 1,
  issue: { id: 1, number: 1, state: "open", body: "same receipt" },
  entry: {
    status: "valid",
    request: { release_parts: [{ pull_requests: [{ number: 1 }] }] },
    workflow: { id: 1 },
    github_actor: { id: "1", login: "tester" }
  },
  input: {
    repositories: [
      {
        role: "frontend",
        destination: { branch: "main", commit: "a".repeat(40) },
        pull_requests: [{ number: 1, commit: "b".repeat(40) }]
      }
    ]
  }
});
function options(original, change = () => {}) {
  const fresh = structuredClone(original);
  fresh.input.repositories[0].destination.commit = "c".repeat(40);
  change(fresh);
  return {
    api: async () => ({ status: 200, data: fresh.issue }),
    inspect: async () => fresh.entry,
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
    plan: async () => fresh.input
  };
}

test("refresh changes only main and retains the same receipt, actor and pinned PR", async () => {
  const original = item();
  const refreshed = await refreshedPreparationPlans(
    [original],
    options(original)
  );
  assert.equal(refreshed[1].repositories[0].destination.commit, "c".repeat(40));
  assert.equal(
    original.input.repositories[0].destination.commit,
    "a".repeat(40)
  );
  for (const change of [
    (fresh) => {
      fresh.issue.body = "edited receipt";
    },
    (fresh) => {
      fresh.issue.state = "closed";
    },
    (fresh) => {
      fresh.entry.github_actor.id = "2";
    },
    (fresh) => {
      fresh.entry.request.database_change = "yes";
    },
    (fresh) => {
      fresh.input.repositories[0].pull_requests[0].commit = "d".repeat(40);
    },
    (fresh) => {
      fresh.input.repositories[0].destination.branch = "other";
    },
    (fresh) => {
      fresh.input = structuredClone(original.input);
    }
  ])
    assert.equal(
      await refreshedPreparationPlans([original], options(original, change)),
      null
    );
  const failedGate = options(original);
  failedGate.observe = async () => ({
    checks: [{ id: "release_parts", status: "fail" }],
    pull_requests: []
  });
  assert.equal(await refreshedPreparationPlans([original], failedGate), null);
});

test("refresh refuses a previously attempted base snapshot without spending another budget", async () => {
  const original = item();
  const current = await options(original).plan();
  assert.equal(
    await refreshedPreparationPlans([original], {
      ...options(original),
      priorInputs: [[{ number: original.number, input: current }]]
    }),
    null
  );
  assert.ok(
    await refreshedPreparationPlans([original], {
      ...options(original),
      priorInputs: [[{ number: original.number, input: original.input }]]
    })
  );
});

test("cancellation prevents refreshed preparation before reads and after planning", async () => {
  for (const phase of ["before", "planned"]) {
    const original = item(),
      controller = new AbortController();
    const configured = options(original);
    let reads = 0;
    const api = configured.api,
      plan = configured.plan;
    if (phase === "before") controller.abort(new Error("cancel refresh"));
    await assert.rejects(
      refreshedPreparationPlans([original], {
        ...configured,
        signal: controller.signal,
        api: async (...args) => {
          reads++;
          return api(...args);
        },
        plan: async (...args) => {
          const result = await plan(...args);
          controller.abort(new Error("cancel refresh"));
          return result;
        }
      }),
      /cancel refresh/
    );
    assert.equal(reads, phase === "before" ? 0 : 1);
  }
});
