import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalBypassEvidence,
  hasApprovalBypass
} from "../src/approval-bypass.mjs";
import { createRehearsalGitHub } from "../src/rehearsal-github.mjs";
import { createReadinessGitHub } from "../src/readiness-github.mjs";
import { inspectPull } from "../src/readiness.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";

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
    reviewStates: [],
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

test("GitHub's null decision permits only verified comment-only reviews", () => {
  const input = evidence();
  input.pr.reviewDecision = null;
  const bypass = approvalBypassEvidence(input);
  assert.equal(bypass.status, "eligible");
  input.pr.approvalBypass = bypass;
  assert.equal(hasApprovalBypass(input.pr), true);
  input.reviewCount = 1;
  assert.equal(approvalBypassEvidence(input), null);
  input.reviewStates = ["COMMENTED"];
  input.pr.approvalBypass = approvalBypassEvidence(input);
  assert.equal(hasApprovalBypass(input.pr), true);
  const checks = inspectPull(
    input.pr,
    { branch: input.pr.headRefName, commit: head },
    "release-coordinator-test-frontend",
    repo.full_name
  );
  for (const id of ["github_merge_gate", "required_checks", "reviews"])
    assert.equal(checks.find((item) => item.id === id).status, "pass", id);
  for (const state of [
    "CHANGES_REQUESTED",
    "PENDING",
    "APPROVED",
    "DISMISSED",
    "UNKNOWN"
  ]) {
    input.reviewStates = [state];
    assert.equal(approvalBypassEvidence(input), null, state);
  }
  input.pr.approvalBypass.review_states = ["CHANGES_REQUESTED"];
  assert.equal(hasApprovalBypass(input.pr), false);
  input.reviewStates = ["COMMENTED"];
  input.unresolvedThreads = 1;
  assert.equal(approvalBypassEvidence(input), null);
});

test("a reported review requirement never bypasses requested changes", () => {
  const input = evidence();
  input.reviewCount = 1;
  input.reviewStates = ["CHANGES_REQUESTED"];
  assert.equal(approvalBypassEvidence(input), null);
  input.reviewStates = ["COMMENTED"];
  assert.equal(approvalBypassEvidence(input).status, "eligible");
});

test("real frontend pins its current ruleset and every enforced check", () => {
  const realRepo = realProfile.repositories.frontend;
  assert.equal(realRepo.approval_bypass_ruleset_id, 18018081);
  assert.equal(
    realProfile.repositories.backend.approval_bypass_ruleset_id,
    null
  );
  assert.deepEqual(realRepo.required_checks, [
    "DCO",
    "security/snyk (6529)",
    "Plan risk and security checks",
    "Installed app checks",
    "Debt ratchet"
  ]);
  const value = {
    ...pr(),
    headRefName: "codex/double-image",
    reviewDecision: null,
    repository: { nameWithOwner: realRepo.full_name },
    headRepository: { nameWithOwner: realRepo.full_name },
    checks: realRepo.required_checks.map((name, index) => ({
      __typename: "CheckRun",
      id: `real-check-${index}`,
      name,
      isRequired: true,
      status: "COMPLETED",
      conclusion: "SUCCESS"
    }))
  };
  const input = {
    ...evidence(value),
    rulesetId: realRepo.approval_bypass_ruleset_id,
    expectedChecks: realRepo.required_checks,
    ruleset: {
      id: realRepo.approval_bypass_ruleset_id,
      enforcement: "active",
      current_user_can_bypass: "pull_requests_only"
    },
    rules: [
      {
        type: "pull_request",
        ruleset_id: realRepo.approval_bypass_ruleset_id,
        parameters: {
          required_approving_review_count: 1,
          allowed_merge_methods: ["merge", "squash", "rebase"]
        }
      },
      {
        type: "required_status_checks",
        ruleset_id: realRepo.approval_bypass_ruleset_id,
        parameters: {
          required_status_checks: realRepo.required_checks.map((context) => ({
            context
          })),
          strict_required_status_checks_policy: true
        }
      },
      { type: "update", ruleset_id: realRepo.approval_bypass_ruleset_id },
      { type: "deletion", ruleset_id: realRepo.approval_bypass_ruleset_id },
      {
        type: "non_fast_forward",
        ruleset_id: realRepo.approval_bypass_ruleset_id
      }
    ],
    branchProtection: null,
    baseIsAncestor: true
  };
  value.approvalBypass = approvalBypassEvidence(input);
  assert.equal(hasApprovalBypass(value), true);
  const results = inspectPull(
    value,
    { branch: value.headRefName, commit: head },
    "6529seize-frontend",
    realRepo.full_name
  );
  for (const id of ["github_merge_gate", "required_checks", "reviews"])
    assert.equal(results.find((item) => item.id === id).status, "pass", id);
  const staleTicket = inspectPull(
    value,
    { branch: value.headRefName, commit: "c".repeat(40) },
    "6529seize-frontend",
    realRepo.full_name
  );
  assert.equal(
    staleTicket.find((item) => item.id === "requested_code").status,
    "blocked"
  );

  for (const index of realRepo.required_checks.keys()) {
    const pending = structuredClone(input);
    pending.pr.checks[index].status = "IN_PROGRESS";
    pending.pr.checks[index].conclusion = null;
    assert.equal(approvalBypassEvidence(pending), null);
    const missing = structuredClone(input);
    missing.pr.checks.splice(index, 1);
    assert.equal(approvalBypassEvidence(missing), null);
  }
  const behind = structuredClone(input);
  behind.pr.mergeStateStatus = "BEHIND";
  assert.equal(approvalBypassEvidence(behind), null);
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

test("GitHub adapter verifies every comment-only review page before bypass", async () => {
  const value = { ...pr(), reviewDecision: null };
  const calls = [];
  const github = createRehearsalGitHub(sandboxProfile, {
    execute: async (_file, args) => {
      const endpoint = args[args.indexOf("--method") + 2];
      if (endpoint === "graphql") {
        const reviewsQuery = args.some((arg) =>
          arg.startsWith("query=query ApprovalBypassReviews")
        );
        const secondPage = args.includes("cursor=next");
        calls.push(reviewsQuery ? `reviews:${secondPage}` : "threads");
        return {
          stdout: JSON.stringify({
            data: {
              repository: {
                databaseId: repo.id,
                nameWithOwner: repo.full_name,
                isPrivate: repo.private,
                ...(!reviewsQuery
                  ? {
                      ref: {
                        name: "main",
                        target: { oid: base },
                        branchProtectionRule: evidence().branchProtection
                      }
                    }
                  : {}),
                pullRequest: {
                  number: value.number,
                  headRefOid: head,
                  baseRefOid: base,
                  reviewDecision: null,
                  reviews: reviewsQuery
                    ? {
                        totalCount: 2,
                        pageInfo: {
                          hasNextPage: !secondPage,
                          endCursor: secondPage ? null : "next"
                        },
                        nodes: [
                          {
                            id: secondPage ? "review-2" : "review-1",
                            state: "COMMENTED"
                          }
                        ]
                      }
                    : { totalCount: 2 },
                  ...(!reviewsQuery
                    ? {
                        reviewThreads: {
                          pageInfo: {
                            hasNextPage: false,
                            endCursor: null
                          },
                          nodes: [{ isResolved: true }]
                        }
                      }
                    : {})
                }
              }
            }
          })
        };
      }
      if (endpoint.endsWith("/rules/branches/main"))
        return { stdout: JSON.stringify(evidence().rules) };
      if (endpoint.endsWith(`/rulesets/${rulesetId}`))
        return { stdout: JSON.stringify(evidence().ruleset) };
      assert.fail(endpoint);
    }
  });
  const bypass = await github.approvalBypass("frontend", value);
  assert.deepEqual(bypass.review_states, ["COMMENTED", "COMMENTED"]);
  value.approvalBypass = bypass;
  assert.equal(hasApprovalBypass(value), true);
  assert.deepEqual(calls, ["threads", "reviews:false", "reviews:true"]);
});

test("GitHub adapter rejects changed or incomplete review pages", async () => {
  const value = { ...pr(), reviewDecision: null };
  for (const badReviews of [
    {
      totalCount: 2,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{ id: "review-1", state: "COMMENTED" }]
    },
    {
      totalCount: 1,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{ id: "review-1", state: "COMMENTED" }]
    },
    {
      totalCount: 2,
      pageInfo: { hasNextPage: true, endCursor: null },
      nodes: [{ id: "review-1", state: "COMMENTED" }]
    }
  ]) {
    const github = createRehearsalGitHub(sandboxProfile, {
      execute: async (_file, args) => {
        const reviewsQuery = args.some((arg) =>
          arg.startsWith("query=query ApprovalBypassReviews")
        );
        assert.equal(args[args.indexOf("--method") + 2], "graphql");
        return {
          stdout: JSON.stringify({
            data: {
              repository: {
                databaseId: repo.id,
                nameWithOwner: repo.full_name,
                isPrivate: repo.private,
                ...(!reviewsQuery
                  ? { ref: { name: "main", target: { oid: base } } }
                  : {}),
                pullRequest: {
                  number: value.number,
                  headRefOid: head,
                  baseRefOid: base,
                  reviewDecision: null,
                  reviews: reviewsQuery ? badReviews : { totalCount: 2 },
                  ...(!reviewsQuery
                    ? {
                        reviewThreads: {
                          pageInfo: {
                            hasNextPage: false,
                            endCursor: null
                          },
                          nodes: []
                        }
                      }
                    : {})
                }
              }
            }
          })
        };
      }
    });
    await assert.rejects(github.approvalBypass("frontend", value));
  }
});

test("readiness keeps a review block when bypass evidence is absent or unreadable", async () => {
  for (const outcome of [null, new Error("token=SECRET")]) {
    const value = pr();
    const { checks, ...metadata } = value;
    const roles = [];
    const client = createReadinessGitHub({
      profile: sandboxProfile,
      execute: async () => ({
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                ...metadata,
                commits: {
                  nodes: [
                    {
                      commit: {
                        oid: head,
                        statusCheckRollup: {
                          contexts: {
                            nodes: checks,
                            pageInfo: { hasNextPage: false, endCursor: null }
                          }
                        }
                      }
                    }
                  ]
                }
              }
            }
          }
        })
      }),
      approvalGitHub: {
        approvalBypass: async (role) => {
          roles.push(role);
          if (outcome instanceof Error) throw outcome;
          return outcome;
        }
      }
    });
    const observed = await client.pullRequest(
      repo.full_name.split("/")[1],
      value.number
    );
    assert.deepEqual(roles, ["frontend"]);
    assert.equal(observed.approvalBypass, null);
    const results = inspectPull(
      observed,
      { branch: observed.headRefName, commit: head },
      repo.full_name.split("/")[1],
      repo.full_name
    );
    assert.equal(
      results.find((item) => item.id === "reviews").status,
      "blocked"
    );
  }
});

test("strict bypass rejects incomplete branch-ancestry evidence", async () => {
  const value = pr();
  const github = createRehearsalGitHub(sandboxProfile, {
    execute: async (_file, args) => {
      const endpoint = args[args.indexOf("--method") + 2];
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
                    nodes: []
                  }
                }
              }
            }
          })
        };
      if (endpoint.endsWith("/rules/branches/main"))
        return {
          stdout: JSON.stringify([
            ...evidence().rules,
            {
              type: "required_status_checks",
              parameters: { strict_required_status_checks_policy: true }
            }
          ])
        };
      if (endpoint.endsWith(`/rulesets/${rulesetId}`))
        return { stdout: JSON.stringify(evidence().ruleset) };
      if (endpoint.includes("/compare/"))
        return { stdout: JSON.stringify({ message: "Not Found" }) };
      assert.fail(endpoint);
    }
  });
  await assert.rejects(
    github.approvalBypass("frontend", value),
    /incomplete branch-ancestry evidence/
  );
});
