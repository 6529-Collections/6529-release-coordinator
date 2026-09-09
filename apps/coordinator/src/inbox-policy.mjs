export const policyVersion = "2026-09-09.1";
const find = (checks, id) => checks.find(item => item.id === id);
const needsMaintainers = "Coordinator maintainers";

export function decideTicket(entry, observation, { overlaps = [], closeTest = false } = {}) {
  const reasons = [];
  const add = (code, message, action, owner = needsMaintainers, evidence) => reasons.push({ code, message, action, owner, ...(evidence ? { evidence } : {}) });
  if (entry.status !== "valid") {
    add("request-unverified", entry.errors.join(" ") || "The saved request proof is unavailable.",
      "Verify the original submission receipt and workflow evidence; then run processing again.");
    return finish(entry.status === "invalid" ? "action-needed" : "waiting", reasons);
  }
  if (closeTest) {
    add("test", "The verified submitter explicitly identified this request as a completed inbox test.", "No release was performed.", "None");
    return finish("closed", reasons);
  }
  // A mismatch is terminal only with stable, same-repository observations.
  const outdated = observation.pull_requests.filter(pr => find(pr.checks, "requested_code")?.status === "blocked"
    && find(pr.checks, "source_repository")?.status === "pass"
    && find(pr.checks, "observation_stability")?.status === "pass");
  if (outdated.length) {
    for (const pr of outdated) add("outdated-commit", `${pr.repository} PR #${pr.number} no longer names the requested branch and commit.`,
      "Submit a new request for the intended current code if a release is still wanted.", "Submitter", find(pr.checks, "requested_code").evidence);
    return finish("closed", reasons);
  }
  for (const item of observation.checks) {
    if (item.status === "pass") continue;
    if (["release_parts", "backend_services"].includes(item.id)) {
      const missing = item.evidence?.missing_prerequisites?.length;
      add(item.status === "blocked" ? "invalid-dependencies" : missing ? "prerequisite-unverified" : "coordinator-incomplete",
        item.message, item.status === "blocked" ? "Submit a corrected request with valid scope and dependency order."
          : "Obtain the missing catalog or prerequisite deployment evidence, then recheck.",
        item.status === "blocked" ? "Submitter" : needsMaintainers, item.evidence);
    }
  }
  for (const pr of observation.pull_requests) {
    const scope = `${pr.repository} PR #${pr.number}: `;
    const state = find(pr.checks, "pr_state");
    if (state?.evidence?.state === "MERGED") add("deployment-unverified", `${scope}the PR is merged, but the requested release to ${entry.request.target} is unproven.`,
      "Obtain evidence for the exact code, scope, and target.", needsMaintainers, { url: pr.url });
    else if (state?.status === "blocked") add("review-required", scope + state.message,
      "Resolve the draft/closed PR state or submit a corrected request.", "Submitter", state.evidence);
    for (const item of pr.checks) {
      if (item.status === "pass" || item.id === "pr_state") continue;
      if (state?.evidence?.state === "MERGED" && ["merge_conflicts", "github_merge_gate", "reviews"].includes(item.id)) continue;
      if (item.id === "required_checks" && item.evidence?.required?.some(check => check.status === "blocked")) {
        for (const check of item.evidence.required.filter(value => value.status === "blocked")) {
          const pending = ["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED", "EXPECTED"].includes(check.state);
          add(pending ? "checks-pending" : "checks-failed", `${scope}${check.name} is ${check.state}${check.conclusion ? ` / ${check.conclusion}` : ""}.`,
            pending ? "Wait for this required check; the next run will recheck it." : "Fix the failed check; request new code if the commit changes.",
            pending ? "Coordinator" : "Submitter", { url: pr.url, ...check });
        }
      } else if (item.id === "merge_conflicts" && item.status === "blocked") add("merge-conflict", scope + item.message,
        "Resolve the conflict and submit a request for the resulting commit.", "Submitter", item.evidence);
      else if (item.id === "reviews" && item.status === "blocked") add("review-required", scope + item.message,
        "Obtain the required review or address requested changes.", "Submitter", { url: pr.url });
      else add("coordinator-incomplete", scope + item.message,
        "Resolve the missing or unstable observation, then run processing again.", needsMaintainers, item.evidence);
    }
  }
  if (overlaps.length) add("overlapping-requests", "Other open requests name the same PR and target. None was chosen or replaced.",
    "Decide which requests should proceed; record any cancellation or replacement explicitly.", needsMaintainers, { issue_numbers: overlaps });
  // Initial disposition history is not a release execution ledger. Do not claim
  // candidacy while earlier completion/cancellation/ownership is unproven.
  add("coordinator-incomplete", "Prior release outcome and active execution ownership are not independently verified.",
    "Establish the release-history source before allowing this request to progress.");
  return finish(reasons.some(reason => reason.owner === "Submitter" || reason.code === "overlapping-requests") ? "action-needed" : "waiting", reasons);
}

function finish(status, reasons) {
  const owners = [...new Set(reasons.map(reason => reason.owner))];
  const submitter = reasons.filter(reason => reason.owner === "Submitter");
  return { status, reasons, action_owner: owners.join("; "),
    next_action: [...new Set(reasons.map(reason => reason.action))].join(" "),
    submitter_action: submitter.length ? [...new Set(submitter.map(reason => reason.action))].join(" ") : "None currently required." };
}
