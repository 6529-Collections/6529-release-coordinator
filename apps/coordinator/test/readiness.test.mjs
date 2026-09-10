import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseRequestIssueBody,
  releaseRequestChecksum
} from "../../../packages/release-request/src/inbox-issue.mjs";
import {
  catalogServices,
  inspectPartGraph,
  inspectServiceGraph
} from "../src/readiness-dependencies.mjs";
import {
  catalogPath,
  createReadinessGitHub
} from "../src/readiness-github.mjs";
import {
  checkReadiness,
  formatReadiness,
  inspectReadiness
} from "../src/readiness.mjs";
import { runReadinessCli } from "../src/readiness-cli.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const blob = "c".repeat(40);
const repo = "6529seize-backend";
const fullname = `6529-Collections/${repo}`;

function fixture() {
  const request = {
    schema_version: "0.000001",
    request_id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-09-08T10:00:00.000Z",
    requested_by: "Developer",
    target: "staging",
    database_change: "no",
    release_parts: [
      {
        id: "backend",
        repository: repo,
        pull_requests: [{ number: 10, branch: "feature/test", commit: head }],
        depends_on: [],
        deploy_units: ["api", "dbMigrationsLoop"],
        deploy_dependencies: []
      }
    ]
  };
  const entry = {
    issue_number: 1,
    issue_url:
      "https://github.com/6529-Collections/6529-release-coordinator/issues/1",
    status: "valid",
    request,
    errors: []
  };
  const required = {
    __typename: "CheckRun",
    id: "build",
    name: "Build",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    isRequired: true
  };
  const pr = {
    number: 10,
    state: "OPEN",
    isDraft: false,
    headRefOid: head,
    headRefName: "feature/test",
    baseRefOid: base,
    baseRefName: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    repository: { nameWithOwner: fullname },
    headRepository: { nameWithOwner: fullname },
    checks: [required]
  };
  const catalog = {
    services: [
      {
        name: "api",
        allowed_environments: ["staging", "prod"],
        default_dependencies: ["dbMigrationsLoop"]
      },
      {
        name: "dbMigrationsLoop",
        allowed_environments: ["staging", "prod"],
        default_dependencies: []
      }
    ]
  };
  const calls = [];
  const github = {
    pullRequest: async (repository, number) => {
      calls.push(["pr", repository, number]);
      return structuredClone(pr);
    },
    catalog: async (commit) => {
      calls.push(["catalog", commit]);
      return { commit, blob_sha: blob, catalog: structuredClone(catalog) };
    }
  };
  return { entry, request, pr, required, catalog, github, calls };
}

const allChecks = (result) => [
  ...result.checks,
  ...result.pull_requests.flatMap((pr) => pr.checks)
];
const getCheck = (result, id) =>
  allChecks(result).find((item) => item.id === id);

test("passing observed checks never imply release permission or invented lifecycle history", async () => {
  const f = fixture();
  const result = await inspectReadiness(f.entry, f);
  assert.equal(result.status, "unknown");
  assert.equal(result.release_authorized, false);
  for (const id of [
    "requested_code",
    "source_repository",
    "pr_state",
    "merge_conflicts",
    "github_merge_gate",
    "required_checks",
    "reviews",
    "observation_stability",
    "backend_services"
  ]) {
    assert.equal(getCheck(result, id).status, "pass", id);
  }
  for (const id of [
    "history_completed",
    "history_cancelled",
    "history_replaced",
    "release_merge_plan"
  ]) {
    assert.equal(getCheck(result, id).status, "unknown", id);
  }
  assert.deepEqual(getCheck(result, "backend_services").evidence.order, [
    "backend/dbMigrationsLoop",
    "backend/api"
  ]);
  assert.deepEqual(f.calls, [
    ["pr", repo, 10],
    ["catalog", head],
    ["pr", repo, 10]
  ]);
  assert.equal(
    getCheck(result, "merge_conflicts").evidence.base_branch,
    "main"
  );
  assert.match(
    getCheck(result, "release_merge_plan").message,
    /combined PR merge/
  );
});

for (const [label, mutate, id, status] of [
  [
    "new PR head",
    (f) => {
      f.pr.headRefOid = "d".repeat(40);
    },
    "requested_code",
    "blocked"
  ],
  [
    "renamed source",
    (f) => {
      f.pr.headRefName = "another";
    },
    "requested_code",
    "blocked"
  ],
  [
    "fork source",
    (f) => {
      f.pr.headRepository.nameWithOwner = "outsider/fork";
    },
    "source_repository",
    "unknown"
  ],
  [
    "draft",
    (f) => {
      f.pr.isDraft = true;
    },
    "pr_state",
    "blocked"
  ],
  [
    "closed without merge",
    (f) => {
      f.pr.state = "CLOSED";
    },
    "pr_state",
    "blocked"
  ],
  [
    "merged is not deployed",
    (f) => {
      f.pr.state = "MERGED";
    },
    "pr_state",
    "unknown"
  ],
  [
    "merge conflict",
    (f) => {
      f.pr.mergeable = "CONFLICTING";
    },
    "merge_conflicts",
    "blocked"
  ],
  [
    "merge still calculating",
    (f) => {
      f.pr.mergeable = "UNKNOWN";
    },
    "merge_conflicts",
    "unknown"
  ],
  [
    "missing required result",
    (f) => {
      f.pr.checks = [];
      f.pr.mergeStateStatus = "BLOCKED";
    },
    "required_checks",
    "unknown"
  ],
  [
    "required failure",
    (f) => {
      f.required.conclusion = "FAILURE";
    },
    "required_checks",
    "blocked"
  ],
  [
    "required pending",
    (f) => {
      f.required.status = "IN_PROGRESS";
      f.required.conclusion = null;
    },
    "required_checks",
    "blocked"
  ],
  [
    "required unfamiliar conclusion",
    (f) => {
      f.required.conclusion = "NEW_STATE";
    },
    "required_checks",
    "unknown"
  ],
  [
    "required neutral",
    (f) => {
      f.required.conclusion = "NEUTRAL";
    },
    "required_checks",
    "pass"
  ],
  [
    "required skipped",
    (f) => {
      f.required.conclusion = "SKIPPED";
    },
    "required_checks",
    "pass"
  ],
  [
    "review requested",
    (f) => {
      f.pr.reviewDecision = "REVIEW_REQUIRED";
    },
    "reviews",
    "blocked"
  ],
  [
    "changes requested",
    (f) => {
      f.pr.reviewDecision = "CHANGES_REQUESTED";
    },
    "reviews",
    "blocked"
  ],
  [
    "no review decision and blocked gate",
    (f) => {
      f.pr.reviewDecision = null;
      f.pr.mergeStateStatus = "BLOCKED";
    },
    "reviews",
    "unknown"
  ],
  [
    "unknown gate with green checks",
    (f) => {
      f.pr.mergeStateStatus = "UNKNOWN";
    },
    "required_checks",
    "unknown"
  ],
  [
    "unavailable hooks",
    (f) => {
      f.pr.mergeStateStatus = "HAS_HOOKS";
    },
    "github_merge_gate",
    "unknown"
  ],
  [
    "malformed response",
    (f) => {
      delete f.pr.baseRefOid;
    },
    "github_evidence",
    "unknown"
  ],
  [
    "wrong returned repository",
    (f) => {
      f.pr.repository.nameWithOwner = "other/repo";
    },
    "github_evidence",
    "unknown"
  ]
]) {
  test(`reports ${label} without inventing completion`, async () => {
    const f = fixture();
    mutate(f);
    const result = await inspectReadiness(f.entry, f);
    assert.equal(getCheck(result, id).status, status);
    assert.equal(getCheck(result, "history_completed").status, "unknown");
    assert.equal(result.release_authorized, false);
    if (status === "blocked") assert.equal(result.status, "blocked");
  });
}

test("optional failing checks are reported separately and do not become required", async () => {
  const f = fixture();
  f.pr.mergeStateStatus = "UNSTABLE";
  f.pr.checks.push({
    __typename: "StatusContext",
    id: "e2e",
    context: "Optional E2E",
    state: "FAILURE",
    isRequired: false
  });
  const result = await inspectReadiness(f.entry, f);
  assert.equal(getCheck(result, "required_checks").status, "pass");
  assert.equal(
    getCheck(result, "required_checks").evidence.optional_check_count,
    1
  );
});

test("required commit status failure blocks just like a required check run", async () => {
  const f = fixture();
  f.pr.checks = [
    {
      __typename: "StatusContext",
      id: "security",
      context: "Security",
      state: "ERROR",
      isRequired: true
    }
  ];
  assert.equal(
    getCheck(await inspectReadiness(f.entry, f), "required_checks").status,
    "blocked"
  );
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
  ]
]) {
  test(`catches ${label} moving during the scan`, async () => {
    const f = fixture();
    let calls = 0;
    f.github.pullRequest = async () => {
      const pr = structuredClone(f.pr);
      if (++calls === 2) mutate(pr);
      return pr;
    };
    const result = await inspectReadiness(f.entry, f);
    assert.equal(getCheck(result, "observation_stability").status, "unknown");
    if (label === "head")
      assert.equal(getCheck(result, "requested_code").status, "blocked");
  });
}

test("a failed final recheck cannot reuse earlier passing evidence as stable", async () => {
  const f = fixture();
  let calls = 0;
  f.github.pullRequest = async () => {
    if (++calls === 2) throw new Error("Unavailable");
    return structuredClone(f.pr);
  };
  assert.equal(
    getCheck(await inspectReadiness(f.entry, f), "observation_stability")
      .status,
    "unknown"
  );
});

for (const state of ["invalid", "unverified"]) {
  test(`does not read product repositories for ${state} intake proof`, async () => {
    const f = fixture();
    f.entry.status = state;
    await inspectReadiness(f.entry, f);
    assert.deepEqual(f.calls, []);
  });
}

test("valid proof cannot bypass schema validation", async () => {
  const f = fixture();
  f.request.release_parts[0].repository = "evil/repo";
  await inspectReadiness(f.entry, f);
  assert.deepEqual(f.calls, []);
});

for (const [label, mutate, pattern] of [
  [
    "duplicate IDs",
    (r) => {
      r.release_parts.push(structuredClone(r.release_parts[0]));
    },
    /unique/
  ],
  [
    "missing part",
    (r) => {
      r.release_parts[0].depends_on = ["missing"];
    },
    /missing/
  ],
  [
    "self cycle",
    (r) => {
      r.release_parts[0].depends_on = ["backend"];
    },
    /cycle/
  ],
  [
    "duplicate PR",
    (r) => {
      r.release_parts[0].pull_requests.push({
        number: 10,
        branch: "other",
        commit: base
      });
    },
    /more than once/
  ]
]) {
  test(`rejects ${label}`, () => {
    const f = fixture();
    mutate(f.request);
    const graph = inspectPartGraph(f.request);
    assert.equal(graph.status, "blocked");
    assert.match(graph.errors.join(" "), pattern);
  });
}

for (const [label, mutate, status, pattern] of [
  [
    "unknown service",
    (f) => {
      f.request.release_parts[0].deploy_units.push("typo");
    },
    "blocked",
    /Unknown backend service/
  ],
  [
    "production-only service in staging",
    (f) => {
      f.catalog.services[0].allowed_environments = ["prod"];
    },
    "blocked",
    /not allowed/
  ],
  [
    "unselected extra endpoint",
    (f) => {
      f.request.release_parts[0].deploy_dependencies = [
        { before: "missing", after: "api" }
      ];
    },
    "blocked",
    /selected/
  ],
  [
    "extra edge opposing catalog",
    (f) => {
      f.request.release_parts[0].deploy_dependencies = [
        { before: "api", after: "dbMigrationsLoop" }
      ];
    },
    "blocked",
    /cycle/
  ],
  [
    "unselected prerequisite",
    (f) => {
      f.request.release_parts[0].deploy_units = ["api"];
    },
    "unknown",
    /prerequisites/
  ]
]) {
  test(`handles ${label} conservatively`, async () => {
    const f = fixture();
    mutate(f);
    const result = getCheck(
      await inspectReadiness(f.entry, f),
      "backend_services"
    );
    assert.equal(result.status, status);
    assert.match(result.message, pattern);
    assert.equal(result.evidence.order, null);
    if (status === "unknown")
      assert.deepEqual(result.evidence.missing_prerequisites, [
        { service: "api", prerequisite: "dbMigrationsLoop", target: "staging" }
      ]);
  });
}

test("maps production to prod and combines cross-part and service dependencies", () => {
  const f = fixture();
  f.request.target = "production";
  f.request.release_parts[0].deploy_units = ["api"];
  f.request.release_parts.push({
    id: "db",
    repository: repo,
    deploy_units: ["dbMigrationsLoop"],
    deploy_dependencies: [],
    depends_on: []
  });
  let result = inspectServiceGraph(f.request, catalogServices(f.catalog));
  assert.equal(result.status, "pass");
  assert.deepEqual(result.order, ["db/dbMigrationsLoop", "backend/api"]);
  f.request.release_parts[1].depends_on = ["backend"];
  result = inspectServiceGraph(f.request, catalogServices(f.catalog));
  assert.equal(result.status, "blocked");
  assert.match(result.errors[0], /cycle/);
});

test("reports unavailable and malformed catalogs as unknown, never empty valid catalogs", async () => {
  for (const catalog of [null, {}, { services: [] }, { services: [null] }]) {
    const f = fixture();
    f.github.catalog = async (commit) => ({ commit, blob_sha: blob, catalog });
    assert.equal(
      getCheck(await inspectReadiness(f.entry, f), "backend_services").status,
      "unknown"
    );
  }
  const f = fixture();
  f.github.catalog = async () => {
    throw new Error("Unavailable");
  };
  assert.equal(
    getCheck(await inspectReadiness(f.entry, f), "backend_services").status,
    "unknown"
  );
});

test("catalog defects cannot quietly erase normal dependency protections", () => {
  for (const mutate of [
    (c) => c.services.push(structuredClone(c.services[0])),
    (c) => {
      c.services[0].default_dependencies = ["missing"];
    },
    (c) => {
      c.services[1].default_dependencies = ["api"];
    },
    (c) => {
      delete c.services[0].default_dependencies;
    }
  ]) {
    const f = fixture();
    mutate(f.catalog);
    assert.throws(() => catalogServices(f.catalog));
  }
});

test("a combined frontend/backend request keeps backend prerequisites before frontend", async () => {
  const f = fixture();
  f.request.release_parts.push({
    id: "frontend",
    repository: "6529seize-frontend",
    depends_on: ["backend"],
    pull_requests: [{ number: 11, branch: "feature/front", commit: base }]
  });
  f.github.pullRequest = async (repository, number) =>
    repository === repo
      ? structuredClone(f.pr)
      : {
          ...structuredClone(f.pr),
          number,
          headRefOid: base,
          headRefName: "feature/front",
          repository: { nameWithOwner: `6529-Collections/${repository}` },
          headRepository: { nameWithOwner: `6529-Collections/${repository}` }
        };
  const result = await inspectReadiness(f.entry, f);
  assert.deepEqual(getCheck(result, "backend_services").evidence.order, [
    "backend/dbMigrationsLoop",
    "backend/api",
    "frontend/frontend"
  ]);
  assert.ok(
    result.pull_requests.every(
      (pr) =>
        pr.checks.find((item) => item.id === "requested_code").status === "pass"
    )
  );
});

test("a service selected under multiple code owners is ambiguous", () => {
  const f = fixture();
  const duplicate = structuredClone(f.request.release_parts[0]);
  duplicate.id = "another";
  f.request.release_parts.push(duplicate);
  const result = inspectServiceGraph(f.request, catalogServices(f.catalog));
  assert.equal(result.status, "blocked");
  assert.equal(result.order, null);
  assert.match(result.errors.join(" "), /code ownership is ambiguous/);
});

test("does not pick a catalog when requested backend commits disagree", async () => {
  const f = fixture();
  f.request.release_parts[0].pull_requests.push({
    number: 11,
    branch: "second",
    commit: base
  });
  f.github.catalog = async (commit) => {
    const catalog = structuredClone(f.catalog);
    if (commit === base) catalog.services[0].default_dependencies = [];
    return { commit, blob_sha: blob, catalog };
  };
  const result = getCheck(
    await inspectReadiness(f.entry, f),
    "backend_services"
  );
  assert.equal(result.status, "unknown");
  assert.match(result.message, /different service definitions/);
});

test("overlapping requests are observed, never selected, cancelled, or replaced", async () => {
  const f = fixture();
  const other = structuredClone(f.entry);
  other.issue_number = 2;
  other.request.request_id = "33333333-3333-4333-8333-333333333333";
  other.request.release_parts[0].pull_requests[0].commit = base;
  const report = await checkReadiness({
    ...f,
    loadInbox: async () => ({
      repository: "test",
      requests: [f.entry, other],
      checked_at: "earlier"
    })
  });
  assert.deepEqual(report.counts, { pending: 2, blocked: 1, unknown: 1 });
  for (const item of report.requests) {
    assert.equal(getCheck(item, "overlapping_requests").status, "unknown");
    assert.equal(getCheck(item, "history_replaced").status, "unknown");
  }
});

function apiResponse(pr, nodes = pr.checks, more = false, cursor = "cursor1") {
  const { checks, ...metadata } = pr;
  return {
    data: {
      repository: {
        pullRequest: {
          ...metadata,
          commits: {
            nodes: [
              {
                commit: {
                  oid: pr.headRefOid,
                  statusCheckRollup: {
                    contexts: {
                      nodes,
                      pageInfo: { hasNextPage: more, endCursor: cursor }
                    }
                  }
                }
              }
            ]
          }
        }
      }
    }
  };
}

test("adapter reads all check pages with a fixed GraphQL query and fixed catalog GET", async () => {
  const f = fixture();
  const calls = [];
  const client = createReadinessGitHub({
    execute: async (command, args, options) => {
      calls.push(args);
      assert.equal(command, "gh");
      assert.equal(options.shell, undefined);
      assert.equal(options.env.GH_PROMPT_DISABLED, "1");
      assert.equal(options.timeout, 30_000);
      assert.deepEqual(args.slice(0, 3), ["api", "--hostname", "github.com"]);
      if (args[5] === "graphql") {
        assert.equal(args[4], "POST");
        const query = args.find((value) => value.startsWith("query="));
        assert.match(query, /^query=query ReadinessPull/);
        assert.doesNotMatch(query, /\bmutation\b/);
        assert.ok(args.includes(`repository=${repo}`));
        assert.ok(args.includes("number=10"));
        return {
          stdout: JSON.stringify(
            calls.length === 1
              ? apiResponse(f.pr, [f.required], true)
              : apiResponse(f.pr, [
                  {
                    __typename: "StatusContext",
                    id: "second",
                    context: "Lint",
                    state: "SUCCESS",
                    isRequired: true
                  }
                ])
          )
        };
      }
      assert.equal(args[4], "GET");
      assert.equal(
        args[5],
        `repos/${fullname}/contents/${catalogPath}?ref=${head}`
      );
      return {
        stdout: JSON.stringify({
          type: "file",
          path: catalogPath,
          sha: blob,
          encoding: "base64",
          content: Buffer.from(JSON.stringify(f.catalog)).toString("base64")
        })
      };
    }
  });
  assert.equal((await client.pullRequest(repo, 10)).checks.length, 2);
  assert.ok(calls[1].includes("cursor=cursor1"));
  assert.deepEqual((await client.catalog(head)).catalog, f.catalog);
});

test("adapter refuses caller-controlled hosts, paths, refs, and PR injection before executing", async () => {
  const client = createReadinessGitHub({
    execute: async () => assert.fail("must not execute")
  });
  for (const repository of [
    "evil/repo",
    "6529seize-backend/../../issues",
    "--hostname=evil",
    null
  ]) {
    await assert.rejects(client.pullRequest(repository, 10));
  }
  for (const number of ["10", -1, 0, Infinity, "10; echo injected"])
    await assert.rejects(client.pullRequest(repo, number));
  for (const commit of ["main", `${head}&ref=evil`, "../main", null])
    await assert.rejects(client.catalog(commit));
});

test("adapter rejects partial GraphQL errors, wrong head, duplicates, and incomplete pagination", async () => {
  const f = fixture();
  for (const mutate of [
    (response) => {
      response.errors = [{ message: "partial" }];
    },
    (response) => {
      response.data.repository.pullRequest.commits.nodes[0].commit.oid = base;
    },
    (response) => {
      response.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.nodes.push(
        f.required
      );
    },
    (response) => {
      response.data.repository.pullRequest.commits.nodes[0].commit.statusCheckRollup.contexts.pageInfo =
        { hasNextPage: true, endCursor: null };
    }
  ]) {
    const response = apiResponse(f.pr, [structuredClone(f.required)]);
    mutate(response);
    const client = createReadinessGitHub({
      execute: async () => ({ stdout: JSON.stringify(response) })
    });
    await assert.rejects(client.pullRequest(repo, 10));
  }
});

test("adapter fails on state changes, later-page failures, and repeated cursors", async () => {
  for (const scenario of ["moving", "failure", "cursor"]) {
    const f = fixture();
    let calls = 0;
    const client = createReadinessGitHub({
      execute: async () => {
        calls += 1;
        if (calls > 1 && scenario === "failure")
          throw new Error("token=SECRET");
        const pr = structuredClone(f.pr);
        if (calls > 1 && scenario === "moving") pr.baseRefOid = head;
        return {
          stdout: JSON.stringify(
            apiResponse(pr, [{ ...f.required, id: `id${calls}` }], true)
          )
        };
      }
    });
    await assert.rejects(
      client.pullRequest(repo, 10),
      (error) => !error.message.includes("SECRET")
    );
  }
});

test("output escapes untrusted controls and directional text", async () => {
  const f = fixture();
  f.required.name = "Build\u001b[2J\nPASS\u202e";
  const report = await checkReadiness({
    ...f,
    loadInbox: async () => ({
      repository: "test",
      requests: [f.entry],
      checked_at: "earlier"
    })
  });
  const output = formatReadiness(report);
  assert.ok(!output.includes("\u001b"));
  assert.ok(!output.includes("\u202e"));
  assert.ok(output.includes("never permission to release"));
});

test("CLI help and invalid arguments perform no reads; failures are not empty success", async () => {
  const options = {
    get: async () => assert.fail("must not read"),
    stdout: () => {},
    stderr: () => {}
  };
  assert.equal(await runReadinessCli(["--help"], options), 0);
  assert.equal(await runReadinessCli(["--deploy"], options), 2);
  const lines = [];
  assert.equal(
    await runReadinessCli(["--json"], {
      get: async () => {
        throw new Error("SECRET");
      },
      stdout: (value) => lines.push(value)
    }),
    2
  );
  assert.equal(JSON.parse(lines.join("")).release_authorized, false);
  assert.ok(!lines.join("").includes("SECRET"));
  assert.equal(
    await runReadinessCli([], { ...options, get: async () => [] }),
    0
  );
});

test("CLI verifies intake before readiness and returns JSON with exit 1 for unresolved evidence", async () => {
  const f = fixture();
  const coordinator = "6529-Collections/6529-release-coordinator";
  const url = `https://github.com/${coordinator}`;
  const workflowUrl = `${url}/actions/runs/123`;
  const issue = {
    number: 1,
    title: "Request",
    state: "open",
    labels: [{ name: "release-request" }, { name: "pending" }],
    body: buildReleaseRequestIssueBody({
      request: f.request,
      checksum: releaseRequestChecksum(f.request),
      actor: "dev",
      actorId: "456",
      workflowRunUrl: workflowUrl,
      submittedAt: "2026-09-08T10:00:01.000Z"
    })
  };
  const run = {
    id: 123,
    repository: { full_name: coordinator },
    head_repository: { full_name: coordinator },
    path: ".github/workflows/submit-release-request.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: head,
    html_url: workflowUrl,
    display_title: `Release request ${f.request.request_id}`,
    status: "completed",
    conclusion: "success",
    actor: { login: "dev", id: 456 },
    run_attempt: 1
  };
  const result = {
    status: "submitted",
    request_id: f.request.request_id,
    request: f.request,
    inbox_issue_number: 1,
    inbox_issue_url: `${url}/issues/1`,
    github: {
      actor: "dev",
      actor_id: "456",
      workflow_run_id: "123",
      workflow_run_url: workflowUrl
    }
  };
  const reads = new Map([
    [
      `repos/${coordinator}/issues?state=open&labels=release-request&sort=created&direction=asc&per_page=100&page=1`,
      [issue]
    ],
    [`repos/${coordinator}/actions/runs/123`, run],
    [
      `repos/${coordinator}/actions/runs/123/attempts/1/jobs?per_page=100&page=1`,
      {
        jobs: [
          {
            id: 789,
            name: "Validate and save request",
            run_id: 123,
            run_attempt: 1,
            status: "completed",
            conclusion: "success",
            steps: [
              {
                name: "Validate and save the release request",
                status: "completed",
                conclusion: "success"
              }
            ]
          }
        ]
      }
    ],
    [
      `repos/${coordinator}/actions/jobs/789/logs`,
      `2026-09-08T10:00:02.123Z RELEASE_REQUEST_RESULT=${Buffer.from(JSON.stringify(result)).toString("base64url")}\n`
    ]
  ]);
  const output = [];
  const code = await runReadinessCli(["--json"], {
    github: f.github,
    get: async (path) => {
      assert.ok(reads.has(path));
      return reads.get(path);
    },
    stdout: (value) => output.push(value)
  });
  assert.equal(code, 1);
  const report = JSON.parse(output.join(""));
  assert.equal(report.requests[0].request_id, f.request.request_id);
  assert.equal(getCheck(report.requests[0], "saved_record").status, "pass");
  assert.equal(getCheck(report.requests[0], "backend_services").status, "pass");
  assert.equal(report.release_authorized, false);
});
