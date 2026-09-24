import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalBypassEvidence,
  hasApprovalBypass
} from "../src/approval-bypass.mjs";
import { createRehearsalGitHub } from "../src/rehearsal-github.mjs";
import { inspectPull } from "../src/readiness.mjs";
import { sandboxProfile } from "../src/profiles.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const repo = sandboxProfile.repositories.frontend;
const rulesetId = repo.approval_bypass_ruleset_id;
const pr = () => ({
  number: 42,
  state: "OPEN",
  isDraft: false,
  headRefOid: head,
  headRefName: "codex/test-review-bypass",
  baseRefOid: base,
  baseRefName: "main",
  mergeable: "MERGEABLE",
  mergeStateStatus: "BLOCKED",
  reviewDecision: "REVIEW_REQUIRED",
  repository: { nameWithOwner: repo.full_name },
  headRepository: { nameWithOwner: repo.full_name },
  checks: [
    {
      __typename: "CheckRun",
      id: "sandbox-check",
      name: "Sandbox check",
      isRequired: true,
      status: "COMPLETED",
      conclusion: "SUCCESS"
    }
  ]
});

function evidence(value = pr()) {
  return {
    pr: value,
    rules: [
      {
        type: "pull_request",
        ruleset_id: rulesetId,
        parameters: {
          required_approving_review_count: 1,
          allowed_merge_methods: ["merge", "squash", "rebase"]
        }
      }
    ],
    ruleset: {
      id: rulesetId,
      enforcement: "active",
      current_user_can_bypass: "pull_requests_only"
    },
    branchProtection: {
      requiredApprovingReviewCount: 0,
      requiresCodeOwnerReviews: false,
      requiresStrictStatusChecks: false
    },
    unresolvedThreads: 0,
    reviewCount: 0,
    baseIsAncestor: false,
    rulesetId,
    expectedChecks: ["Sandbox check"]
  };
}

test("only a verified missing approval passes readiness", () => {
  const value = pr();
  value.approvalBypass = approvalBypassEvidence(evidence(value));
  assert.equal(hasApprovalBypass(value), true);
  const checks = inspectPull(
    value,
    { branch: value.headRefName, commit: head },
    "release-coordinator-test-frontend",
    repo.full_name
  );
  for (const id of ["github_merge_gate", "required_checks", "reviews"])
    assert.equal(checks.find((item) => item.id === id).status, "pass", id);
  assert.equal(
    checks.find((item) => item.id === "reviews").evidence.ruleset_id,
    rulesetId
  );
});

test("unknown GitHub rule, wrong actor, missing check or open thread denies bypass", () => {
  const cases = [
    (input) => input.rules.push({ type: "required_deployments" }),
    (input) => {
      input.ruleset.current_user_can_bypass = "never";
    },
    (input) => {
      input.ruleset.current_user_can_bypass = "always";
    },
    (input) => {
      input.ruleset.id++;
    },
    (input) => {
      input.rules[0].ruleset_id++;
    },
    (input) => {
      input.pr.checks[0].isRequired = false;
    },
    (input) => {
      input.pr.checks[0].conclusion = "FAILURE";
    },
    (input) => {
      input.pr.checks[0].status = "IN_PROGRESS";
      input.pr.checks[0].conclusion = null;
    },
    (input) => {
      input.unresolvedThreads = 1;
    },
    (input) => {
      input.branchProtection.requiredApprovingReviewCount = 1;
    },
    (input) => {
      input.branchProtection.requiresCodeOwnerReviews = true;
    },
    (input) => {
      input.rules[0].parameters.required_approving_review_count = 0;
    },
    (input) => {
      input.rules[0].parameters.allowed_merge_methods = ["squash"];
    },
    (input) => {
      input.pr.reviewDecision = "CHANGES_REQUESTED";
    },
    (input) => {
      input.pr.mergeable = "CONFLICTING";
    },
    (input) => {
      input.pr.mergeStateStatus = "BEHIND";
    }
  ];
  for (const [index, change] of cases.entries()) {
    const input = evidence();
    change(input);
    assert.equal(approvalBypassEvidence(input), null, `case ${index}`);
  }
});

test("GitHub's null decision can mean an unreviewed team-required PR", () => {
  const input = evidence();
  input.pr.reviewDecision = null;
  const bypass = approvalBypassEvidence(input);
  assert.equal(bypass.status, "eligible");
  input.pr.approvalBypass = bypass;
  assert.equal(hasApprovalBypass(input.pr), true);
  input.reviewCount = 1;
  assert.equal(approvalBypassEvidence(input), null);
  input.pr.approvalBypass.review_count = 1;
  assert.equal(hasApprovalBypass(input.pr), false);
});

test("all ruleset checks and strict up-to-date requirements remain enforced", () => {
  const input = evidence();
  input.rules.push({
    type: "required_status_checks",
    ruleset_id: rulesetId,
    parameters: {
      required_status_checks: [{ context: "Sandbox check" }],
      strict_required_status_checks_policy: true
    }
  });
  assert.equal(approvalBypassEvidence(input), null);
  input.baseIsAncestor = true;
  assert.equal(approvalBypassEvidence(input).status, "eligible");
  input.rules[1].parameters.required_status_checks[0].context = "Unknown check";
  assert.equal(approvalBypassEvidence(input), null);
});

test("saved bypass is bound to the same head and base", () => {
  const value = pr();
  value.approvalBypass = approvalBypassEvidence(evidence(value));
  value.headRefOid = "c".repeat(40);
  assert.equal(hasApprovalBypass(value), false);
  value.headRefOid = head;
  value.baseRefOid = "d".repeat(40);
  assert.equal(hasApprovalBypass(value), false);
});

test("GitHub adapter binds rules, token eligibility and review threads to one PR", async () => {
  const value = pr();
  const calls = [];
  const github = createRehearsalGitHub(sandboxProfile, {
    execute: async (_file, args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      calls.push(endpoint);
      if (endpoint === "graphql")
        return {
          stdout: JSON.stringify({
            data: {
              repository: {
                databaseId: repo.id,
                nameWithOwner: repo.full_name,
                isPrivate: repo.private,
                ref: {
                  name: "main",
                  target: { oid: base },
                  branchProtectionRule: evidence().branchProtection
                },
                pullRequest: {
                  number: value.number,
                  headRefOid: head,
                  baseRefOid: base,
                  reviews: { totalCount: 0 },
                  reviewThreads: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [{ isResolved: true }]
                  }
                }
              }
            }
          })
        };
      if (endpoint.endsWith("/rules/branches/main"))
        return { stdout: JSON.stringify(evidence().rules) };
      if (endpoint.endsWith(`/rulesets/${rulesetId}`))
        return { stdout: JSON.stringify(evidence().ruleset) };
      assert.fail(endpoint);
    }
  });
  const result = await github.approvalBypass("frontend", value);
  assert.equal(result.status, "eligible");
  assert.deepEqual(calls, [
    "graphql",
    `repos/${repo.full_name}/rules/branches/main`,
    `repos/${repo.full_name}/rulesets/${rulesetId}`
  ]);
});
