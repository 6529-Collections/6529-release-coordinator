import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./processing-fixture.mjs";
import { sandboxProfile, realProfile } from "../src/profiles.mjs";
import { generateInboxPlan, inboxMergePlan } from "../src/inbox-merge-plan.mjs";

function planningFixture(profile = sandboxProfile) {
  const f = fixture(profile),
    calls = [];
  const entry = {
    status: "valid",
    issue_number: 1,
    request: f.request,
    github_actor: f.actor,
    workflow: { run_id: "123" }
  };
  const github = {
    destination: async (role, branch) => {
      calls.push({ role, branch });
      return {
        repository: profile.repositories[role],
        branch,
        commit: role === "backend" ? "b".repeat(40) : "c".repeat(40)
      };
    }
  };
  return { entry, calls, github, profile };
}

for (const profile of [sandboxProfile, realProfile]) {
  test(`${profile.name}: ticket dependencies order repositories and parts; PR order and scope remain intact`, async () => {
    const f = planningFixture(profile),
      backend = {
        ...structuredClone(f.entry.request.release_parts[0]),
        deploy_units: ["dbMigrationsLoop"]
      };
    const second = {
      ...structuredClone(backend),
      id: "backend-next",
      depends_on: ["backend"],
      deploy_units: ["api"],
      pull_requests: [
        { number: 12, branch: "feature/twelve", commit: "d".repeat(40) },
        { number: 11, branch: "feature/eleven", commit: "e".repeat(40) }
      ]
    };
    const frontend = {
      id: "frontend",
      repository: profile.repositories.frontend.full_name.split("/")[1],
      depends_on: ["backend-next"],
      pull_requests: [
        { number: 5, branch: "feature/ui", commit: "f".repeat(40) }
      ]
    };
    f.entry.request.release_parts = [frontend, second, backend];
    const before = structuredClone(f.entry);
    const input = await generateInboxPlan(f.entry, f);
    assert.deepEqual(
      input.repositories.map((repo) => repo.role),
      ["backend", "frontend"]
    );
    assert.deepEqual(
      input.repositories[0].pull_requests.map((pr) => pr.number),
      [10, 12, 11]
    );
    assert.deepEqual(input.repositories[1].destination, {
      branch: "main",
      commit: "c".repeat(40)
    });
    assert.deepEqual(f.entry, before);
    assert.equal(
      inboxMergePlan(input, f.entry, profile).input_source,
      "verified-inbox"
    );
    assert.deepEqual(await generateInboxPlan(f.entry, f), input);
  });
}

test("missing configuration and impossible dependency orders stop before reading destinations", async () => {
  for (const kind of [
    "config",
    "part-cycle",
    "repository-cycle",
    "unverified"
  ]) {
    const f = planningFixture();
    if (kind === "config")
      f.profile = { ...f.profile, rehearsal_destinations: {} };
    if (kind === "part-cycle")
      f.entry.request.release_parts[0].depends_on = ["backend"];
    if (kind === "unverified") f.entry.status = "unverified";
    if (kind === "repository-cycle") {
      const backend = f.entry.request.release_parts[0];
      f.entry.request.release_parts.push(
        {
          id: "ui",
          repository: "release-coordinator-test-frontend",
          depends_on: ["backend"],
          pull_requests: [
            { number: 1, branch: "feature/ui", commit: "c".repeat(40) }
          ]
        },
        {
          ...structuredClone(backend),
          id: "after-ui",
          depends_on: ["ui"],
          pull_requests: [
            { number: 11, branch: "feature/next", commit: "d".repeat(40) }
          ]
        }
      );
    }
    await assert.rejects(generateInboxPlan(f.entry, f));
    assert.equal(f.calls.length, 0);
  }
});

test("destination commit and repository identity must match the trusted profile", async () => {
  for (const mutate of [
    (v) => {
      v.commit = "main";
    },
    (v) => {
      v.branch = "other";
    },
    (v) => {
      v.repository.id++;
    },
    (v) => {
      v.repository.full_name = realProfile.repositories.backend.full_name;
    },
    (v) => {
      v.repository.private = true;
    }
  ]) {
    const f = planningFixture();
    f.github.destination = async () => {
      const value = {
        branch: "main",
        commit: "b".repeat(40),
        repository: structuredClone(f.profile.repositories.backend)
      };
      mutate(value);
      return value;
    };
    await assert.rejects(
      generateInboxPlan(f.entry, f),
      (error) => error.code === "destination_unverified"
    );
  }
});

test("automatic plans retain the merge engine's PR limits and reject duplicate scope", async () => {
  const f = planningFixture();
  f.entry.request.release_parts[0].pull_requests = Array.from(
    { length: 11 },
    (_, i) => ({
      number: i + 1,
      branch: `feature/${i}`,
      commit: "a".repeat(40)
    })
  );
  await assert.rejects(
    generateInboxPlan(f.entry, f),
    (error) => error.code === "invalid_manifest"
  );
  f.entry.request.release_parts[0].pull_requests = [
    f.entry.request.release_parts[0].pull_requests[0],
    f.entry.request.release_parts[0].pull_requests[0]
  ];
  f.calls.length = 0;
  await assert.rejects(
    generateInboxPlan(f.entry, f),
    (error) => error.code === "invalid_inbox_plan"
  );
  assert.equal(f.calls.length, 0);
});
