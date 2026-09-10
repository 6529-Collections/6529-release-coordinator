import assert from "node:assert/strict";
import test from "node:test";
import {
  readdir,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink
} from "node:fs/promises";
import path from "node:path";
import { rehearsalFixture, sampleCatalog } from "./rehearsal-fixture.mjs";
import {
  selectRehearsalProfile,
  sandboxMergePlan
} from "../src/rehearsal-plan.mjs";
import { createRehearsalGit } from "../src/rehearsal-git.mjs";
import { runRehearsalProcess } from "../src/rehearsal-process.mjs";
import {
  runRehearsalFixture,
  readRehearsalManifest,
  saveRehearsalReport
} from "../src/rehearsal-runner.mjs";
import {
  formatRehearsal,
  rehearsalExitCode,
  rehearseMerge
} from "../src/rehearsal.mjs";

async function single(
  t,
  role = "frontend",
  files = { "feature.txt": "new\n" }
) {
  const f = await rehearsalFixture(t);
  const pr = await f.branch(role, "feature/test", files);
  const input = f.manifest([{ role, pulls: [pr] }]);
  return { f, pr, input };
}
const checks = (report) => report.repositories.flatMap((repo) => repo.checks);

test("MR-01/MR-20: real Git clean merge, repeatable trees, unchanged source, cleanup and local report", async (t) => {
  const { f, input } = await single(t);
  const source = f.repositories.frontend.cwd;
  const before = await f.git(source, ["show-ref"]);
  const beforeStatus = await f.git(source, ["status", "--porcelain"]);
  const a = await f.run(input);
  const b = await f.run(input);
  assert.equal(a.status, "pass");
  assert.equal(rehearsalExitCode(a), 0);
  assert.equal(a.release_authorized, false);
  assert.equal(a.cleanup.status, "removed");
  assert.equal(a.repositories[0].final_tree, b.repositories[0].final_tree);
  assert.equal(await f.git(source, ["show-ref"]), before);
  assert.equal(await f.git(source, ["status", "--porcelain"]), beforeStatus);
  assert.deepEqual(
    (await readdir(f.directory)).filter((name) =>
      name.startsWith("6529-rehearsal-")
    ),
    []
  );
  const filename = await saveRehearsalReport(a, f.directory);
  assert.deepEqual(JSON.parse(await readFile(filename, "utf8")), a);
  assert.match(formatRehearsal(a), /Release authorized: false/u);
  await assert.rejects(saveRehearsalReport(a, f.directory), { code: "EEXIST" });
});

test("MR-02: two compatible PRs both appear in the combined tree", async (t) => {
  const { f, pr, input } = await single(t);
  const other = await f.branch("frontend", "feature/other", {
    "other.txt": "second\n"
  });
  input.repositories[0].pull_requests.push(other);
  let workspace;
  let lastMerge;
  const report = await f.run(input, {
    createGit: async (options) => {
      workspace = await f.createGit(options);
      const repository = workspace.repository;
      workspace.repository = async (repo) => {
        const local = await repository(repo);
        const merge = local.merge;
        local.merge = async (...args) => {
          lastMerge = await merge(...args);
          return lastMerge;
        };
        return local;
      };
      const cleanup = workspace.cleanup;
      workspace.cleanup = async () => {
        const gitdir = path.join(workspace.directory, "repository-1.git");
        assert.equal(
          await f.git(gitdir, ["show", `${lastMerge.commit}:feature.txt`]),
          "new"
        );
        assert.equal(
          await f.git(gitdir, ["show", `${lastMerge.commit}:other.txt`]),
          "second"
        );
        await cleanup();
      };
      return workspace;
    }
  });
  assert.equal(report.status, "pass");
  assert.deepEqual(
    report.repositories[0].merges.map((m) => m.head_commit),
    [pr.commit, other.commit]
  );
  assert.equal(
    report.repositories[0].merges[1].base_commit,
    report.repositories[0].merges[0].commit
  );
});

test("MR-03/MR-05: exact destination matters even when GitHub's PR base is clean", async (t) => {
  const { f, input } = await single(t, "frontend", {
    "shared.txt": "PR change\n"
  });
  const target = await f.branch("frontend", "rehearsal-target", {
    "shared.txt": "destination change\n"
  });
  input.repositories[0].destination = {
    branch: target.branch,
    commit: target.commit
  };
  const report = await f.run(input);
  assert.equal(report.status, "blocked");
  assert.deepEqual(report.repositories[0].merges[0].conflicts, ["shared.txt"]);
  assert.equal(
    checks(report).find((c) => c.id === "destination_gate").status,
    "unknown"
  );
});

test("MR-04: PRs that merge separately can conflict together", async (t) => {
  const { f, pr, input } = await single(t, "frontend", {
    "shared.txt": "one\n"
  });
  const other = await f.branch("frontend", "feature/conflict", {
    "shared.txt": "two\n"
  });
  assert.equal((await f.run(input)).status, "pass");
  assert.equal(
    (await f.run(f.manifest([{ role: "frontend", pulls: [other] }]))).status,
    "pass"
  );
  input.repositories[0].pull_requests = [pr, other];
  const report = await f.run(input);
  assert.equal(report.status, "blocked");
  assert.equal(rehearsalExitCode(report), 1);
  assert.equal(report.repositories[0].merges[1].status, "blocked");
  assert.deepEqual(report.repositories[0].merges[1].conflicts, ["shared.txt"]);
});

test("MR-06/MR-07: separate frontend/backend trees with whole-request outcome", async (t) => {
  const { f, pr } = await single(t);
  const backend = await f.branch("backend", "feature/backend", {
    "shared.txt": "backend one\n"
  });
  const input = f.manifest([
    { role: "backend", pulls: [backend] },
    { role: "frontend", pulls: [pr], depends_on: ["backend"] }
  ]);
  let report = await f.run(input);
  assert.equal(report.status, "pass");
  assert.equal(report.repositories.filter((r) => r.final_tree).length, 2);
  assert.deepEqual(
    checks(report).find((c) => c.id === "combined_services").evidence.order,
    ["backend/dbMigrationsLoop", "backend/api", "frontend/frontend"]
  );
  input.repositories[0].pull_requests.push(
    await f.branch("backend", "feature/backend-conflict", {
      "shared.txt": "backend two\n"
    })
  );
  report = await f.run(input);
  assert.equal(report.status, "blocked");
  assert.ok(report.repositories[1].final_tree);
});

test("MR-08: changed requested head or destination is not silently substituted", async (t) => {
  const { f, input } = await single(t);
  input.repositories[0].pull_requests[0].commit = "d".repeat(40);
  // The fake GitHub source retains its own original value.
  f.repositories.frontend.pulls.get(1).commit = await f.git(
    f.repositories.frontend.cwd,
    ["rev-parse", "HEAD"]
  );
  const original = f.github.pullRequest;
  f.github.pullRequest = async (...args) => ({
    ...(await original(...args)),
    headRefOid: "e".repeat(40)
  });
  let calls = 0;
  const report = await f.run(input, {
    createGit: async () => {
      calls++;
      throw new Error("must not run");
    }
  });
  assert.equal(report.status, "blocked");
  assert.equal(calls, 0);
  assert.equal(
    checks(report).find((c) => c.id === "requested_code").status,
    "blocked"
  );
});

for (const change of [
  "head",
  "destination",
  "checks",
  "review",
  "state",
  "unavailable"
])
  test(`MR-09/MR-10: final ${change} changes invalidate observations`, async (t) => {
    const { f, input } = await single(t);
    let reads = 0;
    const original =
      change === "destination" ? f.github.destination : f.github.pullRequest;
    const method = change === "destination" ? "destination" : "pullRequest";
    f.github[method] = async (...args) => {
      const value = await original(...args);
      if (++reads > 1) {
        if (change === "unavailable")
          throw new Error("secret token must not appear");
        if (change === "head") value.headRefOid = "e".repeat(40);
        if (change === "destination") value.commit = "e".repeat(40);
        if (change === "checks") value.checks[0].conclusion = "FAILURE";
        if (change === "review") value.reviewDecision = "CHANGES_REQUESTED";
        if (change === "state") value.state = "CLOSED";
      }
      return value;
    };
    const report = await f.run(input);
    assert.equal(report.status, change === "unavailable" ? "unknown" : "stale");
    assert.equal(report.cleanup.status, "removed");
    assert.doesNotMatch(JSON.stringify(report), /secret token/u);
  });

for (const condition of [
  "failed",
  "pending",
  "missing",
  "review",
  "draft",
  "closed",
  "merged"
])
  test(`MR-11/MR-12/MR-13: ${condition} never passes`, async (t) => {
    const { f, input } = await single(t);
    const original = f.github.pullRequest;
    f.github.pullRequest = async (...args) => {
      const value = await original(...args);
      if (condition === "failed") value.checks[0].conclusion = "FAILURE";
      if (condition === "pending") value.checks[0].status = "IN_PROGRESS";
      if (condition === "missing") {
        value.checks = [];
        value.mergeStateStatus = "BLOCKED";
      }
      if (condition === "review") value.reviewDecision = "CHANGES_REQUESTED";
      if (condition === "draft") value.isDraft = true;
      if (condition === "closed") value.state = "CLOSED";
      if (condition === "merged") value.state = "MERGED";
      return value;
    };
    const report = await f.run(input);
    assert.notEqual(report.status, "pass");
    if (["failed", "pending", "missing", "review"].includes(condition))
      assert.ok(report.repositories[0].final_tree);
    else assert.equal(report.repositories[0].merges.length, 0);
  });

test("MR-14/MR-21: manifest/profile validation rejects unsafe or mixed inputs before tools", async (t) => {
  const { f, input } = await single(t);
  for (const mutate of [
    (v) => {
      v.profile = "real";
    },
    (v) => {
      v.source = "inbox";
    },
    (v) => {
      v.repositories[0].repository = "6529seize-frontend";
    },
    (v) => {
      v.repositories[0].destination.commit = "short";
    },
    (v) => {
      delete v.repositories[0].destination;
    },
    (v) => {
      v.repositories[0].pull_requests[0].branch = "--upload-pack=bad";
    },
    (v) => {
      v.repositories[0].pull_requests.push(v.repositories[0].pull_requests[0]);
    },
    (v) => {
      v.repositories[0].depends_on = ["backend"];
    },
    (v) => {
      v.repositories[0].role = "other";
    },
    (v) => {
      v.repositories[0].destination.branch = "a/../b";
    },
    (v) => {
      v.repositories[0].destination.branch = "a.lock";
    }
  ]) {
    const bad = structuredClone(input);
    mutate(bad);
    assert.throws(() => sandboxMergePlan(bad, f.profile), {
      code: "invalid_manifest"
    });
  }
  for (const value of [undefined, "", "Sandbox", "production"])
    assert.throws(() => selectRehearsalProfile(value));
  let accessed = false;
  const output = [];
  const exit = await runRehearsalFixture(
    ["--manifest", "fake.json", "--json"],
    {
      env: { RELEASE_COORDINATOR_PROFILE: "real" },
      load: async () => {
        accessed = true;
      },
      stdout: (s) => output.push(s)
    }
  );
  assert.equal(exit, 2);
  assert.equal(accessed, false);
  assert.match(output.join(""), /sandbox_manifest_only/u);
  assert.equal(
    await runRehearsalFixture(["--help"], {
      stdout: () => {},
      load: async () => {
        throw new Error("must not read");
      }
    }),
    0
  );
});

test("MR-15: unavailable objects remain unknown and preserve cleanup", async (t) => {
  const { f, input } = await single(t);
  const missing = "a".repeat(40);
  input.repositories[0].pull_requests[0].commit = missing;
  const original = f.github.pullRequest;
  f.github.pullRequest = async (...args) => ({
    ...(await original(...args)),
    headRefOid: missing
  });
  const report = await f.run(input);
  assert.equal(report.status, "unknown");
  assert.equal(report.cleanup.status, "removed");
  assert.equal(report.repositories[0].merges.length, 0);
});

test("MR-16: service validation uses the exact combined catalog", async (t) => {
  const f = await rehearsalFixture(t);
  const a = sampleCatalog();
  a.services[0].name = "api-v2";
  const b = sampleCatalog();
  b.services[1].allowed_environments.push("prod");
  const prs = [
    await f.branch("backend", "feature/catalog-a", {
      "src/config/deploy-services.json": `${JSON.stringify(a, null, 2)}\n`
    }),
    await f.branch("backend", "feature/catalog-b", {
      "src/config/deploy-services.json": `${JSON.stringify(b, null, 2)}\n`
    })
  ];
  const report = await f.run(
    f.manifest([
      {
        role: "backend",
        pulls: prs,
        deploy_units: ["api-v2", "dbMigrationsLoop"]
      }
    ])
  );
  assert.equal(report.status, "pass");
  const catalog = report.repositories[0].catalog;
  for (const pr of prs)
    assert.notEqual(
      catalog.blob_sha,
      await f.git(f.repositories.backend.cwd, [
        "rev-parse",
        `${pr.commit}:src/config/deploy-services.json`
      ])
    );
});

for (const condition of ["unknown", "omitted", "cycle"])
  test(`MR-17: ${condition} service prerequisites`, async (t) => {
    const { f, input } = await single(t, "backend");
    const repo = input.repositories[0];
    if (condition === "unknown") repo.deploy_units = ["unknown"];
    if (condition === "omitted") repo.deploy_units = ["api"];
    if (condition === "cycle")
      repo.deploy_dependencies = [{ before: "api", after: "dbMigrationsLoop" }];
    const report = await f.run(input);
    assert.equal(
      report.status,
      condition === "omitted" ? "unknown" : "blocked"
    );
  });

test("MR-18: cleanup failure reports the owned directory and prevents success", async (t) => {
  const { f, input } = await single(t);
  const report = await f.run(input, {
    createGit: (options) =>
      createRehearsalGit({
        ...options,
        temporaryRoot: f.directory,
        fixtureRemotes: { frontend: f.repositories.frontend.cwd },
        remove: async () => {
          throw new Error("denied");
        }
      })
  });
  assert.equal(report.status, "unknown");
  assert.equal(report.cleanup.status, "failed");
  assert.ok(report.cleanup.owned_path.startsWith(f.directory));
  await rm(report.cleanup.owned_path, { recursive: true });
});

test("MR-18: failed report writes happen after cleanup and are operational errors", async (t) => {
  const { f, input } = await single(t);
  let saved;
  let output = "";
  const exit = await runRehearsalFixture(["--manifest", "fixture", "--json"], {
    env: { RELEASE_COORDINATOR_PROFILE: "sandbox" },
    load: async () => input,
    githubFactory: () => f.github,
    revision: async () => ({ commit: "fixture", dirty: false }),
    run: async () => f.run(input),
    save: async (report) => {
      saved = report;
      throw new Error("private token");
    },
    stdout: (s) => {
      output += s;
    }
  });
  assert.equal(exit, 2);
  assert.equal(saved.cleanup.status, "removed");
  assert.doesNotMatch(output, /private token/u);
});

test("MR-18/MR-19: timeout, interrupt, output limits and credential-safe errors", async () => {
  await assert.rejects(
    runRehearsalProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { timeout: 25 }
    ),
    { code: "timeout" }
  );
  const controller = new AbortController();
  const promise = runRehearsalProcess(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    { signal: controller.signal }
  );
  controller.abort();
  await assert.rejects(promise, { code: "interrupted" });
  await assert.rejects(
    runRehearsalProcess(
      process.execPath,
      ["-e", "process.stdout.write('x'.repeat(10000))"],
      { maxOutput: 100 }
    ),
    { code: "output_limit" }
  );
  await assert.rejects(
    runRehearsalProcess(process.execPath, [
      "-e",
      "process.stderr.write('SECRET_TOKEN'); process.exit(1)"
    ]),
    (error) =>
      error.code === "tool_failed" && !String(error).includes("SECRET_TOKEN")
  );
});

test("MR-19: inherited Git hooks/config cannot run, attribute rules are explicit unsupported evidence", async (t) => {
  const { f, input } = await single(t, "frontend", {
    ".gitattributes": "* merge=evil filter=evil\n"
  });
  const marker = path.join(f.directory, "executed");
  const config = path.join(f.directory, "evil-config");
  await writeFile(
    config,
    `[merge "evil"]\n driver = touch ${marker}\n[filter "evil"]\n smudge = touch ${marker}\n`
  );
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  try {
    const report = await f.run(input);
    assert.equal(report.status, "unknown");
    assert.equal(report.operation_errors[0].code, "unsupported_attributes");
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
  }
});

test("MR-19: bounded file reads and report symlink refusal", async (t) => {
  const { f } = await single(t);
  const filename = path.join(f.directory, "large.json");
  await writeFile(filename, "x".repeat(65537));
  await assert.rejects(readRehearsalManifest(filename), {
    code: "invalid_manifest"
  });
  const destination = path.join(f.directory, "elsewhere");
  await mkdir(destination);
  await symlink(destination, path.join(f.directory, ".release-coordinator"));
  await assert.rejects(
    saveRehearsalReport(
      { profile: "sandbox", run_id: "11111111-1111-4111-8111-111111111111" },
      f.directory
    ),
    { code: "unsafe_report_path" }
  );
});

test("MR-18: interrupted merge removes its already-created workspace", async (t) => {
  const { f, input } = await single(t);
  const controller = new AbortController();
  const report = await f.run(input, {
    signal: controller.signal,
    createGit: async (options) => {
      const session = await f.createGit(options);
      const repository = session.repository;
      session.repository = async (repo) => {
        const workspace = await repository(repo);
        const merge = workspace.merge;
        workspace.merge = async (...args) => {
          controller.abort();
          return merge(...args);
        };
        return workspace;
      };
      return session;
    }
  });
  assert.equal(report.status, "unknown");
  assert.equal(report.cleanup.status, "removed");
  assert.equal(report.operation_errors[0].code, "interrupted");
});

test("MR-18: storage limits also clean up setup failures", async (t) => {
  const { f, input } = await single(t);
  const report = await f.run(input, {
    createGit: (options) =>
      createRehearsalGit({
        ...options,
        temporaryRoot: f.directory,
        maxStorageBytes: 1
      })
  });
  assert.equal(report.status, "unknown");
  assert.equal(report.operation_errors[0].code, "resource_limit");
  assert.deepEqual(
    (await readdir(f.directory)).filter((name) =>
      name.startsWith("6529-rehearsal-")
    ),
    []
  );
});

test("MR-18: failed initialization plus failed cleanup still records the owned leftover", async (t) => {
  const { f, input } = await single(t);
  const backend = await f.branch("backend", "feature/cleanup", {
    "feature.txt": "backend\n"
  });
  input.repositories.push(
    f.manifest([{ role: "backend", pulls: [backend] }]).repositories[0]
  );
  let attempts = 0;
  const report = await f.run(input, {
    createGit: (options) => {
      attempts++;
      return createRehearsalGit({
        ...options,
        temporaryRoot: f.directory,
        maxStorageBytes: 1,
        remove: async () => {
          throw new Error("denied");
        }
      });
    }
  });
  assert.equal(report.status, "unknown");
  assert.equal(report.cleanup.status, "failed");
  assert.equal(attempts, 1);
  assert.ok(report.cleanup.owned_path.startsWith(f.directory));
  await rm(report.cleanup.owned_path, { recursive: true });
});

test("MR-12: an optional sample check cannot replace the profile's required GitHub enforcement", async (t) => {
  const { f, input } = await single(t);
  const original = f.github.pullRequest;
  f.github.pullRequest = async (...args) => {
    const pr = await original(...args);
    pr.checks[0].isRequired = false;
    return pr;
  };
  const report = await f.run(input);
  assert.ok(report.repositories[0].final_tree);
  assert.equal(report.status, "unknown");
  assert.equal(
    checks(report).find((c) => c.id === "configured_required_check").status,
    "unknown"
  );
});

test("MR-21: the shared engine preserves an adapter's multiple service parts per repository", async (t) => {
  const { f, pr } = await single(t);
  const backend = await f.branch("backend", "feature/multi-part", {
    "feature.txt": "backend\n"
  });
  const plan = sandboxMergePlan(
    f.manifest([
      { role: "backend", pulls: [backend] },
      { role: "frontend", pulls: [pr] }
    ]),
    f.profile
  );
  plan.dependency_request.release_parts = [
    {
      id: "migrations",
      repository: "6529seize-backend",
      depends_on: [],
      deploy_units: ["dbMigrationsLoop"],
      deploy_dependencies: []
    },
    {
      id: "api",
      repository: "6529seize-backend",
      depends_on: ["migrations"],
      deploy_units: ["api"],
      deploy_dependencies: []
    },
    { id: "web", repository: "6529seize-frontend", depends_on: ["api"] }
  ];
  const report = await rehearseMerge(plan, {
    github: f.github,
    createGit: f.createGit
  });
  assert.equal(report.status, "pass");
  assert.deepEqual(
    checks(report).find((c) => c.id === "combined_services").evidence.order,
    ["migrations/dbMigrationsLoop", "api/api", "web/frontend"]
  );
});
