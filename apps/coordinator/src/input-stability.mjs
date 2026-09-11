import { ServiceError } from "./service-contract.mjs";
import { runEvent } from "./run-log.mjs";

export function assertDestination({
  role,
  repository,
  branch = "main",
  expected,
  observed
}) {
  if (expected === observed) return;
  const known = /^[0-9a-f]{40}$/u.test(observed ?? "");
  const message = known
    ? `${role} ${branch} changed in ${repository}. Expected ${expected}; observed ${observed}. These results belong to the previous version; a fresh run is needed.`
    : `${role} ${branch} in ${repository} could not be verified. Expected ${expected}; the current commit is unknown.`;
  runEvent({
    step: "inputs.destination",
    outcome: known ? "failed" : "unknown",
    message,
    role,
    repository,
    branch,
    expected_commit: expected,
    observed_commit: known ? observed : null,
    result_status: known ? "stale" : "unknown"
  });
  throw new ServiceError(
    known ? "inputs-stale" : "destination-unverified",
    message,
    known ? "stale" : "unknown"
  );
}

export function assertPinnedDestinations(expected, observed, profile) {
  for (const saved of expected?.repositories ?? []) {
    const current = observed?.repositories?.find(
      (repo) => repo.role === saved.role
    );
    if (!current) continue; // Other plan changes keep their existing scope check.
    assertDestination({
      role: saved.role,
      repository: profile.repositories[saved.role].full_name,
      branch: saved.destination.branch,
      expected: saved.destination.commit,
      observed: current.destination.commit
    });
  }
}
