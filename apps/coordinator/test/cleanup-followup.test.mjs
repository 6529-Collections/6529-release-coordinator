import assert from "node:assert/strict";
import test from "node:test";
import { inspectCleanupFollowup } from "../src/cleanup-followup.mjs";
import { createCleanupFollowupGitHub } from "../src/cleanup-followup-github.mjs";
import { productWorkflowRuntimeForProfile } from "../src/product-workflow-runtime-config.mjs";
import { expectedJobs } from "../src/product-workflow-release-github.mjs";
import { activeWorkflowRunStatuses } from "../src/release-state.mjs";
import { realProfile, sandboxProfile } from "../src/profiles.mjs";
import { releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";

const clone = structuredClone,
  hash = (value) => value.repeat(40);
function fixture(profile = realProfile) {
  const runtime = productWorkflowRuntimeForProfile(profile),
    repository = (role) => profile.repositories[role];
  const request = {
    schema_version: "0.000002",
    ...(profile.name === "sandbox" ? { profile: "sandbox" } : {}),
    request_id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-09-28T00:00:00Z",
    requested_by: "simo6529",
    target: "production",
    database_change: "no",
    release_parts: [
      {
        id: "frontend",
        repository: repository("frontend").full_name.split("/")[1],
        pull_requests: [
          { number: 5, commit: hash("f"), branch: "feature/test" }
        ],
        depends_on: []
      }
    ]
  };
  const entry = {
    issue_number: 253,
    issue_url: `https://github.com/${profile.inbox.full_name}/issues/253`,
    status: "valid",
    request
  };
  const runMap = new Map(),
    lists = new Map(),
    prs = new Map();
  const actor = { id: 7, login: "human" };
  for (const environment of ["staging", "prod"]) {
    const stage = environment === "staging",
      prefix = stage ? "staging" : "prod",
      label = stage ? "Staging" : "Production",
      id = stage ? 30 : 40;
    const run = (role, key, number, changes = {}) => {
      const configured = runtime.repositories[role].workflows[key];
      const value = {
        id: number,
        workflow_id: number + 100,
        name: configured.name,
        path: `.github/workflows/${configured.file}`,
        head_sha:
          role === "backend"
            ? stage
              ? hash("c")
              : hash("d")
            : stage
              ? hash("a")
              : hash("b"),
        head_branch: runtime.branches[environment],
        actor,
        repository: repository(role),
        head_repository: repository(role),
        html_url: `https://github.com/${repository(role).full_name}/actions/runs/${number}`,
        event: "workflow_dispatch",
        run_attempt: 1,
        status: "completed",
        conclusion: "success",
        created_at: "2026-09-29T01:00:00Z",
        updated_at: "2026-09-29T01:10:00Z",
        ...changes
      };
      runMap.set(`${role}:${number}`, value);
      const listKey = `${role}:${key}`;
      lists.set(listKey, [...(lists.get(listKey) ?? []), value]);
      return value;
    };
    run("backend", "deploy", stage ? 10 : 20, {
      created_at: "2026-09-29T00:00:00Z",
      updated_at: "2026-09-29T00:10:00Z"
    });
    run("frontend", `${prefix}Deploy`, id);
    run("frontend", `${prefix}Dispatch`, id + 1, {
      event: "workflow_run",
      head_branch: "main",
      head_sha: hash("b"),
      display_title: `${label} E2E dispatch [${id}]`,
      created_at: "2026-09-29T01:10:01Z"
    });
    run("frontend", `${prefix}E2e`, id + 2, {
      head_branch: "main",
      head_sha: hash("b"),
      actor: runtime.githubActionsActor,
      display_title: `${label} E2E automatic ${id}`,
      created_at: "2026-09-29T01:10:02Z"
    });
  }
  const merged = {
    number: 5,
    state: "closed",
    merged: true,
    head: { sha: hash("f"), ref: "feature/test", repo: repository("frontend") },
    base: { ref: "main", repo: repository("frontend") },
    merge_commit_sha: hash("9"),
    html_url: `https://github.com/${repository("frontend").full_name}/pull/5`
  };
  prs.set(5, merged);
  const branch = "codex/batch-trial-11111111-1111-4111-8111-111111111111";
  prs.set(9, {
    number: 9,
    state: "closed",
    merged: false,
    head: { sha: hash("8"), ref: branch, repo: repository("frontend") },
    user: actor
  });
  prs.set(11, {
    number: 11,
    state: "closed",
    merged: true,
    base: { ref: "1a-staging", repo: repository("frontend") },
    merge_commit_sha: hash("e")
  });
  const batch = {
    fingerprint: "1".repeat(64),
    selected: [253],
    inputs: [
      {
        number: 253,
        database_change: "no",
        input: {
          inbox: {
            request_id: request.request_id,
            checksum: releaseRequestChecksum(request),
            repository_id: profile.inbox.id
          }
        }
      }
    ],
    attempts: [
      {
        progress: {
          cleanup: "removed",
          prs: [
            {
              cleanup: "removed",
              role: "frontend",
              number: 9,
              branch,
              commit: hash("8"),
              actor
            }
          ]
        }
      }
    ],
    execution: {
      status: "needs-human",
      started_at: "2026-09-28T01:00:00Z",
      completed_at: "2026-09-29T00:00:00Z",
      plan: {
        profile: profile.name,
        steps: [{ role: "frontend" }, { role: null }]
      },
      manual_stop: { reason: "release-stale" },
      operations: {
        integrate: {
          state: "completed",
          step: { kind: "integrate", environment: "staging", role: "frontend" },
          result: {
            status: "passed",
            url: `https://github.com/${repository("frontend").full_name}/pull/11`,
            commit: hash("e")
          }
        },
        e2e: {
          state: "completed",
          step: { kind: "e2e", environment: "staging" },
          result: { status: "stopped", reason: "release-stale" }
        }
      }
    }
  };
  const f = { entry, batch, runMap, lists, prs, refs: 0, calls: [] };
  const github = {
    identity: async (role) => clone(repository(role)),
    activity: async () => true,
    ref: async (role, name) => {
      f.refs++;
      return name.startsWith("codex/")
        ? null
        : {
            object: {
              sha:
                role === "frontend"
                  ? name === "main"
                    ? hash("b")
                    : hash("a")
                  : name === "main"
                    ? hash("d")
                    : hash("c")
            }
          };
    },
    runs: async (role, key) => clone(lists.get(`${role}:${key}`) ?? []),
    run: async (role, id) => clone(runMap.get(`${role}:${id}`)),
    workflow: async (role, key) => {
      const run = (lists.get(`${role}:${key}`) ?? [])[0];
      return { id: run.workflow_id, path: run.path, name: run.name };
    },
    file: async (role, path) => {
      const expected = runtime.repositories[role].files[path];
      return {
        type: "file",
        path,
        sha: typeof expected === "string" ? expected : expected.staging
      };
    },
    jobs: async (role, run) => {
      const stage = run.id < 40,
        environment = stage ? "staging" : "prod";
      const descriptor = {
        kind:
          run.id % 10 === 0
            ? "frontend"
            : run.id % 10 === 1
              ? "dispatch"
              : "e2e",
        environment
      };
      return expectedJobs(descriptor, runtime).required.map((name) => ({
        name,
        run_id: run.id,
        head_sha: run.head_sha,
        status: "completed",
        conclusion: "success"
      }));
    },
    pull: async (_role, number) => clone(prs.get(number)),
    compare: async (_role, base, head) => ({
      status: base === head ? "identical" : "ahead",
      base_commit: { sha: base }
    })
  };
  f.github = github;
  f.inspect = () =>
    inspectCleanupFollowup(entry, { records: [batch], github, profile });
  return f;
}

for (const profile of [realProfile, sandboxProfile])
  test(`${profile.name}: later matching delivery and settled staging account for a stopped frontend attempt`, async () => {
    const f = fixture(profile),
      original = clone(f.batch);
    const result = await f.inspect();
    assert.equal(result.status, "passed", JSON.stringify(result.checks));
    assert.equal(result.evidence.profile, profile.name);
    assert.equal(result.evidence.delivery.deployment.id, 40);
    assert.equal(result.evidence.delivery.e2e.id, 42);
    assert.deepEqual(f.batch, original);
  });

test("multiple stopped attempts share later delivery only after every original effect is accounted for", async () => {
  for (const scenario of [
    "settled",
    "active",
    "branch remains",
    "integration replaced"
  ]) {
    const f = fixture(),
      second = clone(f.batch);
    second.fingerprint = "2".repeat(64);
    second.execution.started_at = "2026-09-27T01:00:00Z";
    second.execution.operations.integrate.result.url = `https://github.com/${realProfile.repositories.frontend.full_name}/pull/12`;
    second.execution.operations.integrate.result.commit = hash("7");
    f.prs.set(12, {
      ...clone(f.prs.get(11)),
      number: 12,
      merge_commit_sha: hash("7")
    });
    const trial = second.attempts[0].progress.prs[0];
    Object.assign(trial, {
      number: 13,
      branch: "codex/batch-trial-22222222-2222-4222-8222-222222222222",
      commit: hash("6")
    });
    const trialPr = clone(f.prs.get(9));
    Object.assign(trialPr, { number: 13 });
    Object.assign(trialPr.head, { ref: trial.branch, sha: trial.commit });
    f.prs.set(13, trialPr);
    const dates = [],
      comparisons = [],
      runs = f.github.runs,
      compare = f.github.compare,
      ref = f.github.ref;
    f.github.runs = async (role, key, since) => {
      dates.push(since);
      return runs(role, key, since);
    };
    f.github.compare = async (role, base, head) => {
      comparisons.push([base, head]);
      return scenario === "integration replaced" && base === hash("7")
        ? { status: "diverged", base_commit: { sha: base } }
        : compare(role, base, head);
    };
    if (scenario === "active") second.execution.status = "running";
    if (scenario === "branch remains")
      f.github.ref = (role, name) =>
        name === trial.branch
          ? Promise.resolve({ object: { sha: trial.commit } })
          : ref(role, name);
    const result = await inspectCleanupFollowup(f.entry, {
      records: [f.batch, second],
      github: f.github,
      profile: realProfile
    });
    assert.equal(
      result.status,
      scenario === "settled" ? "passed" : "unknown",
      scenario
    );
    assert.deepEqual(result.evidence.attempts, [
      f.batch.fingerprint,
      second.fingerprint
    ]);
    if (scenario === "settled") {
      assert.ok(
        dates.length &&
          dates.every((date) => date === "2026-09-27T01:00:00.000Z")
      );
      for (const commit of [hash("e"), hash("7")])
        assert.ok(
          comparisons.some(
            ([base, head]) => base === commit && head === hash("a")
          )
        );
    } else
      assert.equal(
        result.checks.find(
          (check) =>
            check.id ===
            (scenario === "active" ? "stopped_attempts" : "owned_resources")
        ).status,
        "unknown"
      );
  }
});

for (const [name, change, check] of [
  [
    "database effects",
    (f) => {
      f.entry.request.database_change = "yes";
    },
    "stopped_attempts"
  ],
  [
    "active release",
    (f) => {
      f.batch.execution.status = "running";
    },
    "stopped_attempts"
  ],
  [
    "recovery",
    (f) => {
      f.batch.execution.recovery = { status: "running" };
    },
    "stopped_attempts"
  ],
  [
    "unknown operation",
    (f) => {
      f.batch.execution.operations.e2e.state = "running";
    },
    "stopped_attempts"
  ],
  [
    "other failure",
    (f) => {
      f.batch.execution.manual_stop.reason = "deployment-failed";
    },
    "stopped_attempts"
  ],
  [
    "unfinished temporary cleanup",
    (f) => {
      f.batch.attempts[0].progress.cleanup = "pending";
    },
    "stopped_attempts"
  ],
  [
    "receipt mismatch",
    (f) => {
      f.batch.inputs[0].input.inbox.checksum = "0".repeat(64);
    },
    "stopped_attempts"
  ],
  [
    "active workflow",
    (f) => {
      f.lists.get("frontend:prodDeploy")[0].status = "in_progress";
    },
    "workflow_activity"
  ],
  [
    "failed deployment",
    (f) => {
      f.runMap.get("frontend:40").conclusion = "failure";
    },
    "production_delivery"
  ],
  [
    "wrong version",
    (f) => {
      f.runMap.get("frontend:40").head_sha = hash("0");
    },
    "production_delivery"
  ],
  [
    "wrong repo",
    (f) => {
      f.runMap.get("frontend:42").head_repository = { id: 1 };
    },
    "production_delivery"
  ],
  [
    "wrong actor",
    (f) => {
      f.runMap.get("frontend:42").actor = { id: 1, login: "other" };
    },
    "production_delivery"
  ],
  [
    "missing test",
    (f) => {
      f.lists.set("frontend:prodE2e", []);
    },
    "production_delivery"
  ],
  [
    "ambiguous test",
    (f) => {
      f.lists.get("frontend:prodE2e").push(clone(f.runMap.get("frontend:42")));
    },
    "production_delivery"
  ],
  [
    "late backend deployment",
    (f) => {
      f.runMap.get("backend:10").updated_at = "2026-09-29T02:00:00Z";
    },
    "staging_followup"
  ],
  [
    "unmerged source",
    (f) => {
      f.prs.get(5).merged = false;
    },
    "requested_changes"
  ],
  [
    "open trial",
    (f) => {
      f.prs.get(9).state = "open";
    },
    "owned_resources"
  ],
  [
    "changed integration",
    (f) => {
      f.prs.get(11).merge_commit_sha = hash("0");
    },
    "owned_resources"
  ]
])
  test(`${name} keeps the ticket actionable with a named missing check`, async () => {
    const f = fixture();
    change(f);
    const result = await f.inspect();
    assert.equal(result.status, "unknown");
    assert.equal(
      result.checks.find((value) => value.id === check)?.status,
      "unknown",
      JSON.stringify(result.checks)
    );
  });

test("changed workflow pins, skipped jobs, missing ancestry and late environment movement refuse closure", async () => {
  for (const scenario of ["pin", "job", "ancestry", "branch"]) {
    const f = fixture();
    if (scenario === "pin")
      f.github.file = async (_role, path) => ({
        type: "file",
        path,
        sha: hash("0")
      });
    if (scenario === "job") f.github.jobs = async () => [];
    if (scenario === "ancestry")
      f.github.compare = async () => ({ status: "diverged" });
    if (scenario === "branch") {
      const ref = f.github.ref;
      f.github.ref = async (...args) => {
        const value = await ref(...args);
        if (value && f.refs > 4) value.object.sha = hash("0");
        return value;
      };
    }
    assert.equal((await f.inspect()).status, "unknown", scenario);
  }
});

test("missing saved history yields a concrete handoff rather than inferred closure", async () => {
  const f = fixture();
  const result = await inspectCleanupFollowup(f.entry, {
    ticket: {
      transitions: [
        {
          policy_version: "inbox-run-old",
          decision: {
            batch: {
              fingerprint: f.batch.fingerprint,
              release: { status: "needs-human" }
            }
          }
        }
      ]
    },
    records: [],
    github: f.github,
    profile: realProfile
  });
  assert.equal(result.status, "unknown");
  assert.match(result.checks[0].message, /Full verified release history/u);
});

test("rerun and trigger identity changes after listing invalidate the candidate evidence", async () => {
  for (const [id, field, value] of [
    [40, "run_attempt", 2],
    [40, "head_sha", hash("0")],
    [42, "display_title", "Unrelated tests"],
    [42, "head_branch", "feature/other"]
  ]) {
    const f = fixture(),
      read = f.github.run;
    f.github.run = async (role, number) => {
      const run = await read(role, number);
      return role === "frontend" && number === id
        ? { ...run, [field]: value }
        : run;
    };
    const result = await f.inspect();
    assert.equal(result.status, "unknown", field);
    assert.equal(
      result.checks.find((check) => check.id === "production_delivery").status,
      "unknown"
    );
  }
});

test("active runs created before the attempt prevent follow-up both initially and on the final reread", async () => {
  for (const timing of ["initial", "final"])
    for (const status of activeWorkflowRunStatuses) {
      const f = fixture(),
        read = f.github.runs;
      let observations = 0;
      const old = { id: 100, status, created_at: "2026-09-27T00:00:00Z" };
      f.github.runs = async (role, key, since) =>
        (await read(role, key)).filter(
          (run) => Date.parse(run.created_at) >= Date.parse(since)
        );
      f.github.activity = async (role, key) => {
        if (role !== "backend" || key !== "deploy") return true;
        observations++;
        return timing === "final" && observations === 1;
      };
      f.lists.get("backend:deploy").push(old);
      const result = await f.inspect();
      assert.equal(result.status, "unknown", `${timing}: ${status}`);
      assert.equal(
        result.checks.find(
          (check) =>
            check.id ===
            (timing === "initial"
              ? "workflow_activity"
              : "environment_stability")
        ).status,
        "unknown"
      );
    }
});

test("activity reads omit date cutoffs, detect lagging positive counts, and require complete quiet status evidence", async () => {
  for (const mode of [
    "quiet",
    "recent",
    ...activeWorkflowRunStatuses,
    "unreadable"
  ]) {
    const calls = [];
    const client = createCleanupFollowupGitHub({
      execute: async (args) => {
        const endpoint = new URL(`https://github.com/${args[5]}`);
        calls.push(endpoint);
        const status = endpoint.searchParams.get("status");
        const body = status
          ? { total_count: status === mode ? 1 : 0, workflow_runs: [] }
          : {
              total_count: 3500,
              workflow_runs: Array.from(
                { length: mode === "unreadable" ? 0 : 100 },
                (_, index) => ({
                  id: index + 1,
                  status:
                    mode === "recent" && index === 99 ? "pending" : "completed"
                })
              )
            };
        return `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`;
      }
    });
    if (mode === "unreadable")
      await assert.rejects(
        client.activity("frontend", "prodDeploy"),
        /Unsupported/u
      );
    else
      assert.equal(
        await client.activity("frontend", "prodDeploy"),
        mode === "quiet",
        mode
      );
    assert.ok(
      calls.every(
        (url) =>
          !url.searchParams.has("created") && !url.searchParams.has("page")
      )
    );
    if (mode === "quiet")
      assert.deepEqual(
        calls.slice(1).map((url) => url.searchParams.get("status")),
        activeWorkflowRunStatuses
      );
  }
});

test("a deployment workflow starting after inspection prevents follow-up acceptance even without a ref change", async () => {
  const f = fixture(),
    reads = new Map(),
    read = f.github.runs;
  f.github.runs = async (role, key, since) => {
    const id = `${role}:${key}`,
      count = (reads.get(id) ?? 0) + 1;
    reads.set(id, count);
    const runs = await read(role, key, since);
    if (id === "frontend:stagingDeploy" && count > 1)
      runs.push({ id: 100, status: "in_progress" });
    return runs;
  };
  const result = await f.inspect();
  assert.equal(result.status, "unknown");
  assert.equal(
    result.checks.find((check) => check.id === "environment_stability").status,
    "unknown"
  );
});

test("incomplete or moving API pagination and unreadable evidence never supply complete proof", async () => {
  for (const mode of ["incomplete", "moving", "json"]) {
    let calls = 0;
    const client = createCleanupFollowupGitHub({
      execute: async () => {
        calls++;
        const body =
          mode === "json"
            ? "invalid"
            : JSON.stringify({
                total_count: mode === "moving" && calls > 1 ? 102 : 101,
                workflow_runs:
                  mode === "moving" && calls === 1
                    ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
                    : [{ id: 101 }]
              });
        return `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${body}`;
      }
    });
    await assert.rejects(
      client.runs("frontend", "prodDeploy", "2026-09-29T00:00:00Z"),
      /Unsupported|unreadable/u,
      mode
    );
  }
});

test("capped or imprecise workflow-run searches report unavailable complete evidence", async () => {
  for (const total of [1001, 2501, "2,500+"]) {
    let calls = 0;
    const client = createCleanupFollowupGitHub({
      execute: async () => {
        calls++;
        return `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(
          {
            total_count: total,
            workflow_runs: Array.from({ length: 100 }, (_, i) => ({
              id: i + 1
            }))
          }
        )}`;
      }
    });
    await assert.rejects(
      client.runs("frontend", "prodDeploy", "2026-09-29T00:00:00Z"),
      /GitHub workflow-run search.*complete follow-up evidence/u
    );
    assert.equal(calls, 1);
  }
});

test("complete workflow evidence at GitHub's search boundary and longer job lists remain readable", async () => {
  for (const [field, total] of [
    ["workflow_runs", 1000],
    ["jobs", 1001]
  ]) {
    const pages = [];
    const client = createCleanupFollowupGitHub({
      execute: async (args) => {
        const page = Number(
          new URL(`https://github.com/${args[5]}`).searchParams.get("page")
        );
        pages.push(page);
        const offset = (page - 1) * 100;
        return `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(
          {
            total_count: total,
            [field]: Array.from(
              { length: Math.min(100, total - offset) },
              (_, i) => ({ id: offset + i + 1 })
            )
          }
        )}`;
      }
    });
    const values =
      field === "workflow_runs"
        ? await client.runs("frontend", "prodDeploy", "2026-09-29T00:00:00Z")
        : await client.jobs("frontend", { id: 40, run_attempt: 1 });
    assert.equal(values.length, total);
    assert.deepEqual(
      pages,
      Array.from({ length: Math.ceil(total / 100) }, (_, i) => i + 1)
    );
    assert.equal(values.at(-1).id, total);
  }
});

test("large saved release histories do not overflow before reporting unavailable repository evidence", async () => {
  const f = fixture();
  f.github.identity = async () => {
    throw new Error("Repository evidence unavailable");
  };
  const result = await inspectCleanupFollowup(f.entry, {
    records: Array(200_000).fill(f.batch),
    github: f.github,
    profile: realProfile
  });
  assert.equal(result.status, "unknown");
  assert.equal(
    result.checks.find((check) => check.id === "repository_identity").message,
    "Repository evidence unavailable"
  );
});

test("follow-up reader exposes only fixed GET operations and paginates complete evidence", async () => {
  const calls = [];
  const client = createCleanupFollowupGitHub({
    execute: async (args) => {
      calls.push(args);
      const endpoint = args[5];
      const data = endpoint.endsWith("&page=1")
        ? {
            total_count: 101,
            workflow_runs: Array.from({ length: 100 }, (_, i) => ({
              id: i + 1
            }))
          }
        : { total_count: 101, workflow_runs: [{ id: 101 }] };
      return `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(data)}`;
    }
  });
  assert.equal(
    (await client.runs("frontend", "prodDeploy", "2026-09-29T00:00:00Z"))
      .length,
    101
  );
  assert.ok(
    calls.every(
      (args) =>
        args[4] === "GET" &&
        args[5].startsWith(
          "repos/6529-Collections/6529seize-frontend/actions/workflows/build-upload-deploy-prod.yml/runs?"
        )
    )
  );
  for (const invoke of [
    () => client.pull("frontend", "1;deploy"),
    () => client.ref("frontend", "other"),
    () => client.file("frontend", "secret", "a".repeat(40)),
    () => client.runs("frontend", "unknown", "2026-09-29"),
    () => client.run("frontend", -1)
  ])
    assert.throws(invoke, /Unsupported/u);
  assert.equal(calls.length, 2);
});
