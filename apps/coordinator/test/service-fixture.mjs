import { sampleFiles, sourceFiles } from "../sandbox/fixtures.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { inboxBinding } from "../src/inbox-merge-plan.mjs";

export function serviceFixture(
  files = sampleFiles(),
  baseline = sampleFiles()
) {
  const profile = sandboxProfile;
  const entry = {
    status: "valid",
    issue_number: 1,
    github_actor: { id: "456", login: "trusted-user" },
    workflow: { run_id: 123 },
    request: {
      profile: "sandbox",
      schema_version: "0.000001",
      request_id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-09-10T08:00:00.000Z",
      requested_by: "Fixture",
      target: "staging",
      database_change: "no",
      release_parts: [
        {
          id: "backend",
          repository: "release-coordinator-test-backend",
          depends_on: [],
          pull_requests: [
            { number: 10, branch: "codex/sample", commit: "a".repeat(40) }
          ],
          deploy_units: ["api", "worker", "dbMigrationsLoop"],
          deploy_dependencies: []
        },
        {
          id: "frontend",
          repository: "release-coordinator-test-frontend",
          depends_on: ["backend"],
          pull_requests: [
            { number: 11, branch: "codex/sample", commit: "c".repeat(40) }
          ]
        }
      ]
    }
  };
  function report() {
    const binding = inboxBinding(entry, profile);
    return {
      status: "pass",
      release_authorized: false,
      profile: "sandbox",
      input_source: "verified-inbox",
      input_hash: "e".repeat(64),
      inbox: binding,
      inbox_final: structuredClone(binding),
      cleanup: { status: "removed" },
      repositories: ["backend", "frontend"].map((role) => ({
        role,
        repository: profile.repositories[role],
        destination: { branch: "main", commit: "b".repeat(40) },
        pull_requests: entry.request.release_parts.find((p) => p.id === role)
          .pull_requests,
        final_tree: "d".repeat(40),
        service_source: {
          files: sourceFiles(files[role]),
          baseline: sourceFiles(baseline[role]),
          changed_paths: Object.keys(files[role]).filter(
            (name) => files[role][name] !== baseline[role][name]
          )
        }
      }))
    };
  }
  return {
    entry,
    profile,
    report,
    files,
    baseline,
    runtime: {
      repository: profile.repositories.backend.full_name,
      repository_id: profile.repositories.backend.id,
      workflow: "sandbox-service-check.yml",
      ref: "codex/sandbox-services-runtime-v1",
      commit: "f".repeat(40)
    }
  };
}

export function serviceAdapter({
  fail,
  status = "blocked",
  wrongVersion = false,
  baselineFails = false,
  cleanupFails = false
} = {}) {
  const calls = [];
  return {
    calls,
    prepare: async () => {
      calls.push("baseline");
      return { status: baselineFails ? "unknown" : "passed" };
    },
    run: async (step) => {
      calls.push(step.unit);
      if (step.unit === fail) {
        const { ServiceError } = await import("../src/service-contract.mjs");
        throw new ServiceError(
          "fixture-failure",
          "Controlled step failure",
          status
        );
      }
      return {
        status: "passed",
        version: wrongVersion ? "0".repeat(40) : step.version
      };
    },
    inspect: async () => ({ status: "verified", row: { id: 1, value: 20 } }),
    cleanup: async () => {
      calls.push("cleanup");
      return { status: cleanupFails ? "unknown" : "removed" };
    },
    resources: () => ["owned-fixture"]
  };
}
