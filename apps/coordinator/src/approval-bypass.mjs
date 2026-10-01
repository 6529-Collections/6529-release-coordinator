import { effectiveRequiredChecks } from "./github-checks.mjs";

const safeRuleTypes = new Set([
  "pull_request",
  "required_status_checks",
  "update",
  "deletion",
  "non_fast_forward"
]);
const nonBlockingReviewStates = new Set(["APPROVED", "COMMENTED", "DISMISSED"]);

function verifiedReviewStates(pr, reviewCount, reviewStates) {
  return (
    Number.isSafeInteger(reviewCount) &&
    reviewCount >= 0 &&
    Array.isArray(reviewStates) &&
    reviewStates.length === reviewCount &&
    reviewStates.every((state) =>
      pr.reviewDecision === null
        ? state === "COMMENTED"
        : nonBlockingReviewStates.has(state)
    )
  );
}

export function needsApprovalBypass(pr) {
  return (
    pr?.state === "OPEN" &&
    pr.isDraft === false &&
    pr.mergeable === "MERGEABLE" &&
    pr.mergeStateStatus === "BLOCKED" &&
    ["REVIEW_REQUIRED", null].includes(pr.reviewDecision)
  );
}

// GitHub's BLOCKED summary can include more than missing approval. A bypass
// actor must independently establish every rule this code understands before
// treating the absent approval as the sole permitted exception.
export function approvalBypassEvidence({
  pr,
  rules,
  ruleset,
  branchProtection,
  unresolvedThreads,
  reviewCount,
  reviewStates,
  baseIsAncestor,
  auditedBaseCommit,
  rulesetId,
  expectedChecks
}) {
  if (!needsApprovalBypass(pr)) return null;
  if (
    !Number.isSafeInteger(rulesetId) ||
    rulesetId <= 0 ||
    !Array.isArray(rules) ||
    rules.some((rule) => !safeRuleTypes.has(rule.type)) ||
    ruleset?.id !== rulesetId ||
    ruleset.enforcement !== "active" ||
    ruleset.current_user_can_bypass !== "pull_requests_only" ||
    !Number.isSafeInteger(unresolvedThreads) ||
    unresolvedThreads !== 0 ||
    !verifiedReviewStates(pr, reviewCount, reviewStates)
  )
    return null;
  const approvalRules = rules.filter((rule) => rule.type === "pull_request");
  if (
    approvalRules.length !== 1 ||
    approvalRules[0].ruleset_id !== rulesetId ||
    !Number.isSafeInteger(
      approvalRules[0].parameters?.required_approving_review_count
    ) ||
    approvalRules[0].parameters.required_approving_review_count < 1 ||
    !approvalRules[0].parameters?.allowed_merge_methods?.includes("merge")
  )
    return null;
  if (
    branchProtection &&
    (branchProtection.requiredApprovingReviewCount !== 0 ||
      branchProtection.requiresCodeOwnerReviews !== false)
  )
    return null;
  const required = effectiveRequiredChecks(pr.checks, pr.headRefOid);
  const names = required.map((item) => item.name ?? item.context);
  const statusRules = rules.filter(
    (rule) => rule.type === "required_status_checks"
  );
  if (
    !Array.isArray(expectedChecks) ||
    expectedChecks.length === 0 ||
    required.length === 0 ||
    !expectedChecks.every((name) => names.includes(name)) ||
    required.some((item) =>
      item.__typename === "CheckRun"
        ? item.status !== "COMPLETED" || item.conclusion !== "SUCCESS"
        : item.__typename !== "StatusContext" || item.state !== "SUCCESS"
    ) ||
    statusRules.some(
      (rule) =>
        !Array.isArray(rule.parameters?.required_status_checks) ||
        rule.parameters.required_status_checks.some(
          (check) => !names.includes(check.context)
        ) ||
        (rule.parameters.strict_required_status_checks_policy === true &&
          baseIsAncestor !== true)
    ) ||
    (branchProtection?.requiresStrictStatusChecks === true &&
      baseIsAncestor !== true)
  )
    return null;
  return {
    status: "eligible",
    ruleset_id: rulesetId,
    head_commit: pr.headRefOid,
    base_commit: pr.baseRefOid,
    ...(auditedBaseCommit ? { audited_base_commit: auditedBaseCommit } : {}),
    required_checks: names,
    review_count: reviewCount,
    review_states: [...reviewStates],
    unresolved_review_threads: 0
  };
}

export function hasApprovalBypass(pr) {
  return (
    needsApprovalBypass(pr) &&
    pr.approvalBypass?.status === "eligible" &&
    pr.approvalBypass.head_commit === pr.headRefOid &&
    pr.approvalBypass.base_commit === pr.baseRefOid &&
    verifiedReviewStates(
      pr,
      pr.approvalBypass.review_count,
      pr.approvalBypass.review_states
    ) &&
    Number.isSafeInteger(pr.approvalBypass.ruleset_id) &&
    pr.approvalBypass.ruleset_id > 0
  );
}

export function needsSourceIntegration(pr) {
  return (
    pr?.state === "OPEN" &&
    pr.isDraft === false &&
    pr.mergeable === "MERGEABLE" &&
    pr.mergeStateStatus === "BEHIND"
  );
}

// Admission to a fresh candidate is NOT permission to merge this source PR.
// Only base freshness is deferred; reviews, threads, rules and exact-head CI
// are independently inspected. The owned integration still uses normal gates.
export function sourceIntegrationEvidence(input) {
  const {
    pr,
    rules,
    branchProtection,
    unresolvedThreads,
    reviewCount,
    reviewStates,
    expectedChecks,
    auditedBaseCommit
  } = input;
  if (
    !needsSourceIntegration(pr) ||
    !Array.isArray(rules) ||
    rules.some((rule) => !safeRuleTypes.has(rule.type)) ||
    unresolvedThreads !== 0 ||
    !verifiedReviewStates(pr, reviewCount, reviewStates)
  )
    return null;
  const required = effectiveRequiredChecks(pr.checks, pr.headRefOid);
  const names = required.map((item) => item.name ?? item.context);
  if (
    rules.some(
      (rule) =>
        rule.type === "pull_request" &&
        (!Number.isSafeInteger(
          rule.parameters?.required_approving_review_count
        ) ||
          rule.parameters.required_approving_review_count < 0 ||
          !Array.isArray(rule.parameters.allowed_merge_methods) ||
          !rule.parameters.allowed_merge_methods.includes("merge"))
    )
  )
    return null;
  if (
    !required.length ||
    !Array.isArray(expectedChecks) ||
    !expectedChecks.every((name) => names.includes(name)) ||
    required.some((item) =>
      item.__typename === "CheckRun"
        ? item.status !== "COMPLETED" || item.conclusion !== "SUCCESS"
        : item.__typename !== "StatusContext" || item.state !== "SUCCESS"
    ) ||
    rules.some(
      (rule) =>
        rule.type === "required_status_checks" &&
        (!Array.isArray(rule.parameters?.required_status_checks) ||
          rule.parameters.required_status_checks.some(
            (item) => !names.includes(item.context)
          ))
    )
  )
    return null;
  const approvalRequired =
    rules.some(
      (rule) =>
        rule.type === "pull_request" &&
        (rule.parameters?.required_approving_review_count > 0 ||
          rule.parameters?.require_code_owner_review === true)
    ) ||
    branchProtection?.requiredApprovingReviewCount > 0 ||
    branchProtection?.requiresCodeOwnerReviews === true;
  let bypass = null;
  if (pr.reviewDecision !== "APPROVED") {
    if (
      pr.reviewDecision === "CHANGES_REQUESTED" ||
      ![null, "REVIEW_REQUIRED"].includes(pr.reviewDecision)
    )
      return null;
    if (approvalRequired || pr.reviewDecision === "REVIEW_REQUIRED") {
      // Defer only strict base freshness for candidate admission. The existing
      // missing-approval audit still requires the same exact head/base, trusted
      // bypass actor, known rules, successful checks and resolved review threads.
      // Its result is nested here, never granted to the owned integration PR.
      bypass = approvalBypassEvidence({
        ...input,
        pr: { ...pr, mergeStateStatus: "BLOCKED" },
        rules: rules.map((rule) =>
          rule.type === "required_status_checks"
            ? {
                ...rule,
                parameters: {
                  ...rule.parameters,
                  strict_required_status_checks_policy: false
                }
              }
            : rule
        ),
        branchProtection: branchProtection
          ? { ...branchProtection, requiresStrictStatusChecks: false }
          : null
      });
      if (!bypass) return null;
    }
  }
  return {
    status: "eligible",
    purpose: "source-integration-only",
    head_commit: pr.headRefOid,
    base_commit: pr.baseRefOid,
    ...(auditedBaseCommit ? { audited_base_commit: auditedBaseCommit } : {}),
    review_decision: pr.reviewDecision,
    required_checks: names,
    review_count: reviewCount,
    review_states: [...reviewStates],
    unresolved_review_threads: 0,
    approval_bypass: bypass
  };
}

export function hasSourceIntegration(pr) {
  const proof = pr.sourceIntegration;
  return (
    needsSourceIntegration(pr) &&
    proof?.status === "eligible" &&
    proof.purpose === "source-integration-only" &&
    proof.head_commit === pr.headRefOid &&
    proof.base_commit === pr.baseRefOid &&
    proof.review_decision === pr.reviewDecision &&
    verifiedReviewStates(pr, proof.review_count, proof.review_states) &&
    proof.unresolved_review_threads === 0
  );
}
