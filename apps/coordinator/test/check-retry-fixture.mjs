import { fixture } from "./processing-fixture.mjs";
import { realProfile } from "../src/profiles.mjs";
import { processInbox } from "../src/inbox-processor.mjs";
import { generateInboxPlan, inboxMergePlan } from "../src/inbox-merge-plan.mjs";
import { coordinateInboxBatch } from "../src/inbox-batch.mjs";
import { checkBatch } from "../src/batch-checks.mjs";
import { selectBatch } from "../src/batch-selection.mjs";
import { batchMergePlan, realServicePlan } from "../src/batch-plan.mjs";
import { serviceHash } from "../src/service-contract.mjs";
import {
  buildReleaseRequestIssueBody,
  releaseRequestChecksum
} from "../../../packages/release-request/src/inbox-issue.mjs";

export async function failedChecks() {
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
  let base = "b".repeat(40),
    pass = false,
    gatesPass = true;
  const events = [],
    budgets = [];
  const options = {
    api: f.api,
    get: f.get,
    identity: f.identity,
    profile: realProfile,
    selectionMode: "filtered",
    issueNumbers: [1],
    actorLogin: "trusted-user",
    releaseAdapter: "product-workflows",
    plan: (entry) =>
      generateInboxPlan(entry, {
        profile: realProfile,
        github: {
          destination: async (role, branch) => ({
            branch,
            commit: base,
            repository: realProfile.repositories[role]
          })
        }
      }),
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
          ].map((id) => ({
            id,
            status: id === "required_checks" && !gatesPass ? "fail" : "pass"
          }))
        }
      ]
    }),
    rehearsal: async (entry, input) => {
      const plan = inboxMergePlan(input, entry, realProfile);
      return {
        profile: "real",
        input_source: "verified-inbox",
        input_hash: plan.input_hash,
        inbox: plan.inbox,
        inbox_final: plan.inbox,
        run_id: "33333333-3333-4333-8333-333333333333",
        status: "pass",
        release_authorized: false,
        cleanup: { status: "removed" },
        operation_errors: [],
        checks: [{ id: "inbox_stability", status: "pass" }],
        repositories: plan.repositories.map((repo) => ({
          ...repo,
          repository: repo.identity,
          final_tree: "d".repeat(40),
          checks: [{ id: "local_merge", status: "pass" }]
        }))
      };
    },
    retryTrials: async (batch) => {
      events.push("verify-removed");
      if (
        batch.attempts.some(
          (attempt) => attempt.progress?.cleanup === "pending"
        )
      )
        throw new Error("uncertain cleanup");
    },
    release: async () => {
      events.push("release");
      throw new Error("fixture stop before deployment");
    },
    batch: (options) =>
      coordinateInboxBatch({
        ...options,
        verify: async (inputs) =>
          gatesPass &&
          inputs.every(
            (input) => input.input.repositories[0].destination.commit === base
          ),
        select: (options) => {
          budgets.push(options.spent);
          return selectBatch(options);
        },
        revalidate: async () => {
          events.push("reverify-old");
          throw new Error("saved trial evidence changed");
        },
        prepare: async (items, { policy }) => {
          events.push("prepare");
          const plan = batchMergePlan(items, realProfile, policy);
          return {
            status: "passed",
            input_hash: plan.input_hash,
            binding: plan.batch,
            service_plan: realServicePlan(
              plan,
              {
                input_hash: plan.input_hash,
                repositories: [{ role: "frontend" }]
              },
              items
            ),
            publications: [
              {
                role: "frontend",
                repository: realProfile.repositories.frontend,
                base: items[0].input.repositories[0].destination.commit,
                tree: "d".repeat(40),
                base_tree: "e".repeat(40),
                source_prs: structuredClone(
                  items[0].input.repositories[0].pull_requests
                ),
                patch: [
                  {
                    path: "docs/example.md",
                    sha: "f".repeat(40),
                    mode: "100644"
                  }
                ]
              }
            ]
          };
        },
        check: (prepared, options) =>
          checkBatch(prepared, {
            ...options,
            client: {
              identity: async () => ({
                actor: { id: "456", login: "trusted-user" },
                workflow_id: null
              }),
              open: async (record, _patch, save) => {
                events.push(`open:${record.branch}`);
                record.number = 2;
                record.commit = serviceHash(record.branch).slice(0, 40);
                await save(record);
              },
              result: async () => ({
                status: pass ? "passed" : "unknown",
                kind: pass ? "checks" : "evidence",
                role: "frontend",
                checks: [
                  {
                    name: "Installed app checks",
                    status: "COMPLETED",
                    conclusion: pass ? "SUCCESS" : "FAILURE"
                  }
                ]
              }),
              cleanup: async () => {
                events.push("cleanup");
                return { status: "removed" };
              }
            }
          })
      })
  };
  await processInbox(options);
  pass = true; // A separate diagnostic changed GitHub; it is not new release proof.
  try {
    await processInbox(options);
  } catch (error) {
    if (!error.message.includes("saved trial evidence changed")) throw error;
  }
  const state = f.state(),
    parent = structuredClone(state.batches[state.lock.batch_fingerprint]);
  const resume = {
    ...options,
    resume: state.lock.run_id,
    issueNumbers: [],
    actorLogin: undefined
  };
  const attemptId = parent.attempts.find(
    (attempt) => attempt.phase === "checks"
  ).id;
  return {
    f,
    parent,
    resume,
    attemptId,
    events,
    budgets,
    setBase: (value) => {
      base = value;
    },
    setPass: (value) => {
      pass = value;
    },
    setGates: (value) => {
      gatesPass = value;
    }
  };
}
