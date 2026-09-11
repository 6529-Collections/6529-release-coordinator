import {
  serviceHash,
  serviceAssert,
  validateServicePlan,
  verifyServiceReport
} from "./service-contract.mjs";

const hash = (value) => /^[0-9a-f]{64}$/u.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value ?? "");
const statuses = ["passed", "blocked", "unknown", "stale"];
export function validateBatchHistory(batches, profile) {
  serviceAssert(
    profile.name === "sandbox" &&
      batches &&
      typeof batches === "object" &&
      !Array.isArray(batches),
    "batch-state",
    "Invalid batch history."
  );
  for (const [key, batch] of Object.entries(batches)) {
    serviceAssert(
      hash(key) &&
        key === batch?.fingerprint &&
        batch.version === 1 &&
        Array.isArray(batch.inputs) &&
        batch.inputs.length > 0 &&
        batch.inputs.length <= 10 &&
        batch.policy?.version === "sandbox-batch-v1" &&
        key === serviceHash({ inputs: batch.inputs, policy: batch.policy }) &&
        Number.isFinite(Date.parse(batch.created_at)) &&
        batch.deadline ===
          Date.parse(batch.created_at) + batch.policy.max_elapsed_ms &&
        ["searching", "finished"].includes(batch.status) &&
        Array.isArray(batch.attempts) &&
        batch.attempts.length <=
          batch.policy.max_git_attempts + batch.policy.max_check_attempts &&
        Array.isArray(batch.selected),
      "batch-state",
      "Invalid batch inputs, budget or history."
    );
    const numbers = batch.inputs.map((value) => value.number);
    serviceAssert(
      new Set(numbers).size === numbers.length &&
        numbers.every(
          (number, i) =>
            Number.isSafeInteger(number) &&
            number > 0 &&
            (!i || number > numbers[i - 1]) &&
            batch.inputs[i].input?.profile === "sandbox" &&
            batch.inputs[i].input.inbox?.issue_number === number &&
            batch.inputs[i].input.inbox.repository_id === profile.inbox.id
        ),
      "batch-state",
      "Batch ticket scope changed."
    );
    const attempts = new Set(),
      identities = new Set();
    serviceAssert(
      batch.attempts.filter((attempt) => attempt.phase === "git").length <=
        batch.policy.max_git_attempts &&
        batch.attempts.filter((attempt) => attempt.phase === "checks").length <=
          batch.policy.max_check_attempts,
      "batch-state",
      "Batch history exceeded its saved limits."
    );
    for (const attempt of batch.attempts) {
      const key = `${attempt.phase}:${attempt.members?.join(",")}`;
      serviceAssert(
        uuid(attempt.id) &&
          !identities.has(attempt.id) &&
          !attempts.has(key) &&
          ["git", "checks"].includes(attempt.phase) &&
          Array.isArray(attempt.members) &&
          attempt.members.length > 0 &&
          new Set(attempt.members).size === attempt.members.length &&
          attempt.members.every((number) => numbers.includes(number)) &&
          (!attempt.result || statuses.includes(attempt.result.status)),
        "batch-state",
        "Invalid or repeated batch attempt."
      );
      identities.add(attempt.id);
      attempts.add(key);
      if (attempt.result?.service_plan)
        validateServicePlan(attempt.result.service_plan);
      if (attempt.progress) {
        const progress = attempt.progress;
        const prepared = batch.attempts.find(
          (value) =>
            value.phase === "git" &&
            value.members.join(",") === attempt.members.join(",")
        )?.result;
        serviceAssert(
          attempt.phase === "checks" &&
            progress.id === attempt.id &&
            hash(progress.prepared_hash) &&
            Array.isArray(progress.prs) &&
            progress.prs.length <= 2 &&
            progress.service_attempts &&
            prepared?.status === "passed" &&
            progress.prepared_hash === serviceHash(prepared) &&
            ["pending", "removed"].includes(progress.cleanup),
          "batch-state",
          "Invalid saved check progress."
        );
        for (const pr of progress.prs)
          serviceAssert(
            ["backend", "frontend"].includes(pr.role) &&
              pr.branch === `codex/batch-trial-${attempt.id}` &&
              /^[0-9a-f]{40}$/u.test(pr.base) &&
              /^[0-9a-f]{40}$/u.test(pr.tree),
            "batch-state",
            "Invalid temporary PR ownership."
          );
        for (const [kind, service] of Object.entries(
          progress.service_attempts
        )) {
          serviceAssert(
            ["candidate", "baseline"].includes(kind) &&
              uuid(service.id) &&
              service.plan_hash === service.plan?.fingerprint &&
              service.plan.binding?.repository === profile.inbox.full_name,
            "batch-state",
            "Invalid saved batch service attempt."
          );
          validateServicePlan(service.plan);
          if (service.result)
            verifyServiceReport(
              service.result.report,
              service.plan,
              service.id
            );
        }
        if (attempt.result)
          serviceAssert(
            progress.result &&
              serviceHash(progress.result) === serviceHash(attempt.result),
            "batch-state",
            "Completed batch result differs from its saved check progress."
          );
        if (attempt.result?.status === "blocked")
          serviceAssert(
            attempt.result.kind === "code" &&
              progress.cleanup === "removed" &&
              progress.service_attempts.baseline?.result?.report?.status ===
                "passed" &&
              (progress.prs.some(
                (pr) =>
                  pr.result?.status === "blocked" && pr.result.kind === "code"
              ) ||
                progress.service_attempts.candidate?.result?.report?.status ===
                  "blocked"),
            "batch-state",
            "Code failure lacks a failed check and passing baseline proof."
          );
        if (attempt.result?.status === "passed") {
          serviceAssert(
            progress.cleanup === "removed" &&
              progress.prs.length > 0 &&
              progress.result &&
              serviceHash(progress.result) === serviceHash(attempt.result) &&
              progress.service_attempts.candidate?.result?.report?.status ===
                "passed" &&
              progress.service_attempts.candidate.plan_hash ===
                prepared.service_plan?.fingerprint &&
              progress.prs.length ===
                prepared.publications.filter((repo) => repo.patch.length)
                  .length &&
              progress.prs.every(
                (pr) =>
                  pr.cleanup === "removed" && pr.result?.status === "passed"
              ),
            "batch-state",
            "Passing batch lacks exact CI, service or cleanup proof."
          );
        }
      }
    }
    serviceAssert(
      batch.selected.every((number) => numbers.includes(number)) &&
        new Set(batch.selected).size === batch.selected.length &&
        (!batch.selected.length ||
          batch.attempts.some(
            (attempt) =>
              attempt.phase === "checks" &&
              serviceHash(attempt.members) === serviceHash(batch.selected) &&
              attempt.result?.status === "passed" &&
              attempt.progress?.cleanup === "removed"
          )),
      "batch-state",
      "Selected candidate has no exact completed check evidence."
    );
  }
}
