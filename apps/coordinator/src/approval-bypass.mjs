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
