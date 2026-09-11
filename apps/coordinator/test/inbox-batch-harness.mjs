import assert from "node:assert/strict";
import { fixture } from "./processing-fixture.mjs";
import { serviceFixture, serviceAdapter } from "./service-fixture.mjs";
import { coordinateInboxBatch } from "../src/inbox-batch.mjs";
import { batchMergePlan, batchPolicy } from "../src/batch-plan.mjs";
import { checkBatch } from "../src/batch-checks.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { generateInboxPlan, inboxMergePlan } from "../src/inbox-merge-plan.mjs";
import { executeServiceSteps } from "../src/service-contract.mjs";
import { servicePlanFromSources } from "../src/service-plan.mjs";

export function harness(count = 2) {
  const f = fixture(sandboxProfile),
    events = [];
  const samples = Array.from({ length: count }, () => serviceFixture());
  samples.forEach((sample, i) => {
    sample.entry.issue_number = i + 1;
    sample.entry.request.request_id = `${String(i + 1).padStart(8, "0")}-2222-4222-8222-222222222222`;
    for (const part of sample.entry.request.release_parts)
      part.pull_requests[0].number += i * 10;
  });
  f.issues = samples.map((sample, i) => ({
    ...structuredClone(f.issue),
    number: i + 1,
    id: 1001 + i,
    body: JSON.stringify(sample.entry.request)
  }));
  const getPlan = (entry) =>
    generateInboxPlan(entry, {
      profile: sandboxProfile,
      github: {
        destination: async (role, branch) => ({
          branch,
          commit: "b".repeat(40),
          repository: sandboxProfile.repositories[role]
        })
      }
    });
  const observation = (entry) => ({
    checks: ["release_parts", "backend_services"].map((id) => ({
      id,
      status: "pass"
    })),
    pull_requests: entry.request.release_parts.flatMap((part) =>
      part.pull_requests.map((pr) => ({
        part: part.id,
        repository: part.repository,
        number: pr.number,
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
      }))
    )
  });
  let dispatches = 0;
  const options = {
    api: f.api,
    identity: f.identity,
    profile: sandboxProfile,
    get: f.get,
    github: f.github,
    loadInbox: async () => ({
      requests: samples.map((sample) => sample.entry)
    }),
    inspect: async (issue) => structuredClone(samples[issue.number - 1].entry),
    observe: async (entry) => observation(entry),
    plan: getPlan,
    rehearsal: async (entry, input) => {
      events.push(`git:${entry.issue_number}`);
      const report = samples[entry.issue_number - 1].report();
      return {
        ...report,
        run_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        input_hash: inboxMergePlan(input, entry, sandboxProfile).input_hash,
        checks: [{ id: "inbox_stability", status: "pass" }],
        operation_errors: [],
        repositories: report.repositories.map((repo) => ({
          ...repo,
          checks: [{ id: "local_merge", status: "pass" }]
        }))
      };
    },
    services: async () =>
      assert.fail("individual service checks must not run in batch mode"),
    batch: (opts) =>
      coordinateInboxBatch({
        ...opts,
        revalidate: async () => {
          events.push("reverify-evidence");
        },
        prepare: async (items) => {
          events.push("combined-git");
          assert.ok(
            items.every((item) => events.includes(`git:${item.number}`))
          );
          const plan = batchMergePlan(items);
          const report = samples[0].report();
          report.input_hash = plan.input_hash;
          for (const repo of report.repositories)
            repo.service_source.base_tree = "c".repeat(40);
          return {
            status: "passed",
            input_hash: plan.input_hash,
            binding: plan.batch,
            publications: [],
            service_plan: servicePlanFromSources({
              request: { ...plan.dependency_request, database_change: "no" },
              binding: plan.batch,
              report,
              runtime: batchPolicy.runtime
            })
          };
        },
        check: (prepared, options) =>
          checkBatch(prepared, {
            ...options,
            client: {},
            serviceClient: {},
            executeServices: async (plan, run) => {
              dispatches++;
              const attempt = {
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                plan_hash: plan.fingerprint,
                plan
              };
              await run.save(attempt);
              events.push("combined-services");
              const report = await executeServiceSteps(plan, serviceAdapter(), {
                attemptId: attempt.id
              });
              attempt.result = {
                report,
                workflow: { id: 101, url: "https://example.invalid/run/101" }
              };
              await run.save(attempt);
              return attempt;
            }
          })
      })
  };
  return { f, options, events, samples, dispatches: () => dispatches };
}
