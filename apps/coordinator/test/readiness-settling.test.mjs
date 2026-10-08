import assert from "node:assert/strict";
import test from "node:test";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { sourceIntegrationEvidence } from "../src/approval-bypass.mjs";
import { inspectReadiness, checkReadiness } from "../src/readiness.mjs";
import { createReadinessGitHub } from "../src/readiness-github.mjs";

function fixture(profile = realProfile) {
  const repository = profile.repositories.frontend.full_name;
  const name = repository.split("/")[1];
  const pr = {
    number: 10,
    state: "OPEN",
    isDraft: false,
    headRefOid: "a".repeat(40),
    headRefName: "feature/test",
    baseRefOid: "b".repeat(40),
    baseRefName: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    repository: { nameWithOwner: repository },
    headRepository: { nameWithOwner: repository },
    checks: [
      {
        __typename: "CheckRun",
        id: "build",
        name: "Build",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        isRequired: true
      }
    ]
  };
  const entry = {
    issue_number: 1,
    status: "valid",
    request: {
      schema_version: "0.000001",
      request_id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-10-08T10:00:00.000Z",
      requested_by: "Developer",
      target: "production",
      database_change: "no",
      ...(profile.name === "sandbox" ? { profile: "sandbox" } : {}),
      release_parts: [
        {
          id: "frontend",
          repository: name,
          pull_requests: [
            {
              number: pr.number,
              branch: pr.headRefName,
              commit: pr.headRefOid
            }
          ],
          depends_on: []
        }
      ]
    }
  };
  return { profile, pr, entry };
}

const pending = (pr) => ({
  ...structuredClone(pr),
  mergeable: "UNKNOWN",
  mergeStateStatus: "UNKNOWN"
});
const find = (report, id) =>
  report.pull_requests[0].checks.find((c) => c.id === id);
function sequence(f, values) {
  const reads = [];
  const waits = [];
  const github = {
    pullRequest: async (repository, number) => {
      assert.equal(repository, f.entry.request.release_parts[0].repository);
      assert.equal(number, f.pr.number);
      assert.ok(reads.length < values.length, "unexpected additional PR read");
      const value = values[reads.length];
      reads.push(value);
      if (value instanceof Error) throw value;
      return structuredClone(value);
    }
  };
  const wait = async (ms, options) => {
    assert.equal(ms, 10_000);
    waits.push(options);
  };
  return { ...f, github, wait, reads, waits };
}

for (const profile of [realProfile, sandboxProfile]) {
  for (const field of ["both", "mergeable", "mergeStateStatus"]) {
    test(`${profile.name}: pending ${field} settles before two complete audited reads`, async () => {
      const f = fixture(profile);
      const incomplete = structuredClone(f.pr);
      if (field === "both" || field === "mergeable")
        incomplete.mergeable = "UNKNOWN";
      if (field === "both" || field === "mergeStateStatus")
        incomplete.mergeStateStatus = "UNKNOWN";
      const complete = { ...f.pr, mergeStateStatus: "BEHIND" };
      complete.sourceIntegration = sourceIntegrationEvidence({
        pr: complete,
        rules: [],
        branchProtection: null,
        unresolvedThreads: 0,
        reviewCount: 0,
        reviewStates: [],
        expectedChecks: ["Build"],
        auditedBaseCommit: "c".repeat(40)
      });
      const client = sequence(f, [incomplete, incomplete, complete, complete]);
      const report = await inspectReadiness(f.entry, client);
      assert.equal(client.reads.length, 4);
      assert.equal(client.waits.length, 2);
      assert.ok(
        report.pull_requests[0].checks.every((c) => c.status === "pass")
      );
      assert.equal(report.release_authorized, false);
      assert.equal(report.status, "unknown");
    });
  }

  test(`${profile.name}: a completed first read needs only its fresh final comparison`, async () => {
    const f = fixture(profile);
    const client = sequence(f, [f.pr, f.pr]);
    const report = await inspectReadiness(f.entry, client);
    assert.equal(client.reads.length, 2);
    assert.equal(client.waits.length, 0);
    assert.equal(find(report, "observation_stability").status, "pass");
  });

  test(`${profile.name}: a pending final recheck cannot replace the completed first snapshot`, async () => {
    const f = fixture(profile);
    const client = sequence(f, [f.pr, pending(f.pr), f.pr]);
    const report = await inspectReadiness(f.entry, client);
    assert.equal(client.reads.length, 3);
    assert.equal(client.waits.length, 1);
    assert.equal(find(report, "observation_stability").status, "pass");
  });

  for (const [label, mutate] of [
    [
      "head",
      (pr) => {
        pr.headRefOid = "d".repeat(40);
      }
    ],
    [
      "base",
      (pr) => {
        pr.baseRefOid = "d".repeat(40);
      }
    ],
    [
      "checks",
      (pr) => {
        pr.checks[0].conclusion = "FAILURE";
      }
    ],
    [
      "reviews",
      (pr) => {
        pr.reviewDecision = "CHANGES_REQUESTED";
      }
    ],
    [
      "PR state",
      (pr) => {
        pr.state = "CLOSED";
      }
    ]
  ]) {
    for (const phase of ["waiting", "completed comparison", "final wait"]) {
      test(`${profile.name}: ${label} changing during ${phase} still stops`, async () => {
        const f = fixture(profile);
        const changed = structuredClone(f.pr);
        mutate(changed);
        const values =
          phase === "waiting"
            ? [pending(f.pr), changed]
            : phase === "final wait"
              ? [f.pr, pending(f.pr), changed]
              : [pending(f.pr), f.pr, changed];
        const client = sequence(f, values);
        const report = await inspectReadiness(f.entry, client);
        const obstacle = find(
          report,
          phase === "waiting" ? "github_evidence" : "observation_stability"
        );
        assert.equal(obstacle.status, "unknown");
        assert.match(obstacle.message, /changed/);
        assert.equal(client.reads.length, values.length);
        assert.equal(report.release_authorized, false);
      });
    }
  }

  for (const [label, mutate, id] of [
    [
      "conflict",
      (pr) => {
        pr.mergeable = "CONFLICTING";
        pr.mergeStateStatus = "DIRTY";
      },
      "merge_conflicts"
    ],
    [
      "failed check",
      (pr) => {
        pr.checks[0].conclusion = "FAILURE";
      },
      "required_checks"
    ],
    [
      "review rejection",
      (pr) => {
        pr.reviewDecision = "CHANGES_REQUESTED";
      },
      "reviews"
    ]
  ]) {
    test(`${profile.name}: completion reporting a ${label} is not success`, async () => {
      const f = fixture(profile);
      mutate(f.pr);
      const client = sequence(f, [pending(f.pr), f.pr, f.pr]);
      const report = await inspectReadiness(f.entry, client);
      assert.equal(find(report, id).status, "blocked");
      assert.equal(report.status, "blocked");
      assert.equal(report.release_authorized, false);
    });
  }

  test(`${profile.name}: settling does not invent missing behind-source admission proof`, async () => {
    const f = fixture(profile);
    f.pr.mergeStateStatus = "BEHIND";
    const client = sequence(f, [pending(f.pr), f.pr, f.pr]);
    const report = await inspectReadiness(f.entry, client);
    assert.equal(find(report, "github_merge_gate").status, "blocked");
  });

  test(`${profile.name}: differing completed admission audits still stop the scan`, async () => {
    const f = fixture(profile);
    f.pr.mergeStateStatus = "BEHIND";
    f.pr.sourceIntegration = sourceIntegrationEvidence({
      pr: f.pr,
      rules: [],
      branchProtection: null,
      unresolvedThreads: 0,
      reviewCount: 0,
      reviewStates: [],
      expectedChecks: ["Build"],
      auditedBaseCommit: "c".repeat(40)
    });
    const changed = structuredClone(f.pr);
    changed.sourceIntegration.audited_base_commit = "d".repeat(40);
    const incomplete = pending(f.pr);
    delete incomplete.sourceIntegration;
    const client = sequence(f, [incomplete, f.pr, changed]);
    const report = await inspectReadiness(f.entry, client);
    assert.equal(find(report, "observation_stability").status, "unknown");
  });

  for (const phase of ["initial", "final"]) {
    for (const failure of [new Error("Unavailable"), null, { number: 10 }]) {
      test(`${profile.name}: ${phase} waiting read failure never reuses passing proof (${String(failure)})`, async () => {
        const f = fixture(profile);
        const values =
          phase === "initial"
            ? [pending(f.pr), failure]
            : [f.pr, pending(f.pr), failure];
        const client = sequence(f, values);
        const report = await inspectReadiness(f.entry, client);
        assert.equal(
          find(
            report,
            phase === "initial" ? "github_evidence" : "observation_stability"
          ).status,
          "unknown"
        );
        assert.equal(client.reads.length, values.length);
        assert.equal(client.waits.length, 1);
        assert.equal(report.release_authorized, false);
      });
    }
  }
}

for (const [label, mutate] of [
  [
    "closed",
    (pr) => {
      pr.state = "CLOSED";
    }
  ],
  [
    "merged",
    (pr) => {
      pr.state = "MERGED";
    }
  ],
  [
    "draft",
    (pr) => {
      pr.isDraft = true;
    }
  ],
  [
    "outdated head",
    (pr) => {
      pr.headRefOid = "d".repeat(40);
    }
  ],
  [
    "renamed branch",
    (pr) => {
      pr.headRefName = "another";
    }
  ],
  [
    "fork",
    (pr) => {
      pr.headRepository.nameWithOwner = "other/repo";
    }
  ],
  [
    "conflicting",
    (pr) => {
      pr.mergeable = "CONFLICTING";
    }
  ]
]) {
  test(`does not wait on an already ${label} source with unknown merge metadata`, async () => {
    const f = fixture();
    const pr = pending(f.pr);
    mutate(pr);
    const client = sequence(f, [pr, pr]);
    const report = await inspectReadiness(f.entry, client);
    assert.equal(client.waits.length, 0);
    assert.ok(report.pull_requests[0].checks.some((c) => c.status !== "pass"));
    assert.equal(report.release_authorized, false);
  });
}

test("pending calculation has no new poll-count ceiling", async () => {
  const f = fixture();
  const client = sequence(f, [
    ...Array.from({ length: 125 }, () => pending(f.pr)),
    f.pr,
    f.pr
  ]);
  const report = await inspectReadiness(f.entry, client);
  assert.equal(client.waits.length, 125);
  assert.equal(find(report, "observation_stability").status, "pass");
});

test("cancellation interrupts the real wait before another GitHub read", async () => {
  const f = fixture();
  const controller = new AbortController();
  let reads = 0;
  await assert.rejects(
    inspectReadiness(f.entry, {
      signal: controller.signal,
      github: {
        pullRequest: async () => {
          reads++;
          setImmediate(() => controller.abort());
          return pending(f.pr);
        }
      }
    }),
    { name: "AbortError" }
  );
  assert.equal(reads, 1);
});

test("read-only inbox checking forwards the settling wait and cancellation signal", async () => {
  const f = fixture();
  const client = sequence(f, [pending(f.pr), f.pr, f.pr]);
  const controller = new AbortController();
  const report = await checkReadiness({
    ...client,
    signal: controller.signal,
    loadInbox: async () => ({
      repository: "test",
      requests: [f.entry],
      checked_at: "earlier"
    })
  });
  assert.equal(client.waits[0].signal, controller.signal);
  assert.equal(
    find(report.requests[0], "observation_stability").status,
    "pass"
  );
  assert.equal(report.release_authorized, false);
});

test("the actual fixed-query adapter audits each completed behind-source snapshot afresh", async () => {
  const f = fixture();
  const complete = { ...f.pr, mergeStateStatus: "BEHIND" };
  const snapshots = [pending(f.pr), complete, complete];
  let reads = 0;
  let audits = 0;
  const github = createReadinessGitHub({
    execute: async (command, args) => {
      assert.equal(command, "gh");
      assert.equal(args[4], "POST");
      assert.equal(args[5], "graphql");
      assert.match(
        args.find((arg) => arg.startsWith("query=")),
        /^query=query ReadinessPull/
      );
      assert.doesNotMatch(
        args.find((arg) => arg.startsWith("query=")),
        /\bmutation\b/
      );
      assert.ok(reads < snapshots.length);
      const { checks, ...pr } = snapshots[reads++];
      return {
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                ...pr,
                commits: {
                  nodes: [
                    {
                      commit: {
                        oid: pr.headRefOid,
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
      };
    },
    approvalGitHub: {
      sourceIntegration: async (_role, pr) => {
        audits++;
        return sourceIntegrationEvidence({
          pr,
          rules: [],
          branchProtection: null,
          unresolvedThreads: 0,
          reviewCount: 0,
          reviewStates: [],
          expectedChecks: ["Build"],
          auditedBaseCommit: "c".repeat(40)
        });
      }
    }
  });
  let waits = 0;
  const report = await inspectReadiness(f.entry, {
    github,
    wait: async () => {
      waits++;
    }
  });
  assert.equal(reads, 3);
  assert.equal(waits, 1);
  assert.equal(audits, 2);
  assert.ok(report.pull_requests[0].checks.every((c) => c.status === "pass"));
});
