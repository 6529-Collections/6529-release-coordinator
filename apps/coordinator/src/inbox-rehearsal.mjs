import { digest } from "./inbox-journal.mjs";
import { inboxMergePlan } from "./inbox-merge-plan.mjs";
import { decideTicket } from "./inbox-policy.mjs";
import { terminal } from "./ticket-presentation.mjs";
import { safeRehearsalError } from "./rehearsal.mjs";

export const runPolicyVersion = "2026-09-10.2";
const check = (checks, id) => checks.find((value) => value.id === id);
const pullChecks = [
  "requested_code",
  "source_repository",
  "pr_state",
  "merge_conflicts",
  "github_merge_gate",
  "required_checks",
  "reviews",
  "observation_stability"
];

// Missing execution history is a release blocker, not a reason to skip a local
// rehearsal. Different per-PR service catalogs can be resolved by the combined
// catalog; missing PR identity, checks, or review evidence cannot be skipped.
export function canRehearse(entry, observation, decision) {
  return (
    entry.status === "valid" &&
    !terminal(decision) &&
    !decision.reasons.some((reason) =>
      ["already-merged", "overlapping-requests"].includes(reason.code)
    ) &&
    check(observation.checks, "release_parts")?.status === "pass" &&
    check(observation.checks, "backend_services")?.status !== "blocked" &&
    observation.pull_requests.length ===
      entry.request.release_parts.reduce(
        (sum, part) => sum + part.pull_requests.length,
        0
      ) &&
    observation.pull_requests.every((pr) =>
      pullChecks.every((id) => check(pr.checks, id)?.status === "pass")
    )
  );
}

function withReason(decision, code, message, action, status = "waiting") {
  const next = structuredClone(decision);
  next.reasons.push({
    code,
    message,
    action,
    owner: "Coordinator maintainers"
  });
  if (next.status !== "action-needed") next.status = status;
  next.action_owner = [
    ...new Set(next.reasons.map((reason) => reason.owner))
  ].join("; ");
  next.next_action = [
    ...new Set(next.reasons.map((reason) => reason.action))
  ].join(" ");
  return next;
}

function summary(report, plan) {
  if (
    report.profile !== plan.profile ||
    report.input_source !== "verified-inbox" ||
    report.input_hash !== plan.input_hash ||
    digest(report.inbox) !== digest(plan.inbox) ||
    report.release_authorized !== false ||
    !["pass", "blocked", "unknown", "stale"].includes(report.status)
  )
    throw new Error("Rehearsal report does not match this ticket and plan.");
  const findings = [
    ...report.checks.map((item) => ({ ...item, role: null })),
    ...report.repositories.flatMap((repo) =>
      repo.checks.map((item) => ({ ...item, role: repo.role }))
    )
  ]
    .filter((item) => item.status !== "pass")
    .map((item) => ({
      role: item.role,
      pr_number: item.pr_number ?? item.evidence?.pr_number ?? null,
      check: item.id,
      status: item.status,
      message: item.message,
      ...(item.evidence ? { evidence: item.evidence } : {})
    }));
  if (
    report.status === "pass" &&
    (findings.length ||
      report.operation_errors.length ||
      report.cleanup.status !== "removed" ||
      check(report.checks, "inbox_stability")?.status !== "pass" ||
      digest(report.inbox_final) !== digest(plan.inbox))
  ) {
    throw new Error("Rehearsal pass has incomplete or contradictory evidence.");
  }
  return {
    status: report.status === "pass" ? "passed" : report.status,
    message:
      report.status === "pass"
        ? "The ticket's exact PRs combine in the recorded order, and the observed checks passed. Builds and deployment have not run."
        : report.status === "blocked"
          ? "The rehearsal found a blocker; see the recorded findings."
          : report.status === "stale"
            ? "Inputs changed during the rehearsal; its result cannot be used."
            : "The rehearsal could not establish a complete result.",
    plan_hash: digest(plan),
    findings,
    repositories: report.repositories.map((repo) => ({
      role: repo.role,
      repository: repo.repository.full_name,
      destination: repo.destination,
      pull_requests: repo.pull_requests,
      final_tree: repo.final_tree
    }))
  };
}

// Only a freshly executed in-process report can enter this policy. Operators
// select tickets; plans are generated internally and reports cannot be imported.
// Run IDs/times are evidence, not meaningful decision fields, so unchanged
// retries do not create duplicate transitions.
export async function coordinateTicket({
  entry,
  observation,
  decision,
  preparePlan,
  savePlan,
  profile,
  rehearse
}) {
  if (terminal(decision))
    return {
      decision,
      result: {
        status: "not-run",
        message: "Ticket has a terminal intake decision."
      }
    };
  let result,
    evidence,
    next = decision;
  if (!canRehearse(entry, observation, decision)) {
    result = {
      status: "not-run",
      message:
        "Resolve the initial request, PR, dependency, or overlap findings before rehearsal."
    };
  } else {
    let input, plan;
    try {
      input = await preparePlan();
      plan = inboxMergePlan(input, entry, profile);
    } catch (error) {
      const invalid = ["invalid_inbox_plan", "invalid_manifest"].includes(
        error.code
      );
      const problem = safeRehearsalError(error);
      result = {
        status: invalid ? "not-run" : "unknown",
        message: invalid
          ? `The Coordinator could not form a valid merge plan. ${problem.message}`
          : `The Coordinator could not prepare the rehearsal. ${problem.message}`,
        error: problem
      };
      next = withReason(
        next,
        invalid ? "merge-plan-invalid" : "merge-plan-unavailable",
        result.message,
        "Resolve the recorded request, destination configuration, or missing GitHub evidence and rerun inbox:run.",
        invalid ? "action-needed" : "waiting"
      );
    }
    if (plan) {
      // Journal failure must escape and retain the lock. Never start Git or
      // publish a ticket result when saving the pinned inputs was uncertain.
      await savePlan(input);
      try {
        const report = await rehearse(entry, input);
        result = summary(report, plan);
        const { report_file, ...durableReport } = report;
        evidence = {
          run_id: report.run_id,
          report_hash: digest(durableReport),
          revision: report.revision,
          started_at: report.started_at,
          finished_at: report.finished_at,
          input: input,
          binding: report.inbox,
          final_binding: report.inbox_final,
          cleanup: report.cleanup,
          operation_errors: report.operation_errors,
          result
        };
        // A verified combined catalog resolves the earlier uncertainty from
        // individual catalogs, without claiming missing runtime prerequisites.
        const combined = report.repositories
          .find((repo) => repo.role === "backend")
          ?.checks.find((item) => item.id === "combined_services");
        if (
          combined?.status === "pass" &&
          ["pass", "blocked"].includes(report.status)
        ) {
          next = decideTicket(entry, {
            ...observation,
            checks: observation.checks.map((item) =>
              item.id === "backend_services"
                ? { ...combined, id: "backend_services" }
                : item
            )
          });
        }
        if (result.status !== "passed")
          next = withReason(
            next,
            `rehearsal-${result.status === "unknown" ? "unverified" : result.status}`,
            result.message,
            result.status === "blocked"
              ? "Resolve the recorded blocker, correct the request or configured destination when needed, and rerun inbox:run."
              : "Inspect the changed or missing evidence, and start a new inbox:run to capture current destinations.",
            result.status === "blocked" ? "action-needed" : "waiting"
          );
        return {
          decision: { ...next, rehearsal: result },
          report,
          evidence,
          result: {
            ...result,
            report_id: report.run_id,
            report_file,
            report_hash: evidence.report_hash
          }
        };
      } catch (error) {
        result = {
          status: "unknown",
          message:
            "Rehearsal or report saving failed; no passing evidence is available.",
          error: safeRehearsalError(error)
        };
        next = withReason(
          next,
          "rehearsal-unverified",
          result.message,
          "Resolve the missing evidence or local report-storage problem and rerun inbox:run."
        );
      }
    }
  }
  return { decision: { ...next, rehearsal: result }, evidence, result };
}
