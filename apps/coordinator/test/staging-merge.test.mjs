import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { rehearsalFixture } from "./rehearsal-fixture.mjs";
import {
  prepareStagingMerge,
  validateStagingMerge
} from "../src/staging-merge.mjs";
import { createMockReleaseGitHub } from "./release-github-mock.mjs";
import { integrationCommitInput } from "../src/release-plan.mjs";
import { runRehearsalProcess } from "../src/rehearsal-process.mjs";
import { sandboxReleaseRuntime } from "../src/release-runtime-config.mjs";
import { serviceHash } from "../src/service-contract.mjs";

async function fixture(
  t,
  {
    profile = "sandbox",
    conflict = false,
    conflictPaths = ["src/quote.test.txt"]
  } = {}
) {
  const f = await rehearsalFixture(t);
  const foundation = await f.branch("backend", "foundation", {
    "shared.txt": "first\nunchanged\nlast\n",
    ...Object.fromEntries(
      conflictPaths.map((name) => [name, "existing tests\n"])
    )
  });
  f.repositories.backend.base = foundation.commit;
  await f.git(f.repositories.backend.cwd, [
    "update-ref",
    "refs/heads/main",
    foundation.commit
  ]);
  const source = await f.branch(
    "backend",
    "source",
    conflict
      ? Object.fromEntries(
          conflictPaths.map((name) => [
            name,
            "existing tests\nexpansion test with keyboard coverage\n"
          ])
        )
      : { "shared.txt": "first\nunchanged\nsource last\n" },
    foundation.commit
  );
  const staging = await f.branch(
    "backend",
    "1a-staging",
    conflict
      ? {
          ...Object.fromEntries(
            conflictPaths.map((name) => [
              name,
              "existing tests\nindependently copied older expansion test\n"
            ])
          ),
          "docs/staging.md": "keep staging-only work\n"
        }
      : {
          "shared.txt": "staging first\nunchanged\nlast\n",
          "docs/staging.md": "keep staging-only work\n"
        },
    foundation.commit
  );
  f.profile.name = profile;
  const actor =
    profile === "real"
      ? { id: "209783236", login: "simo6529" }
      : { id: "456", login: "tester" };
  const candidate = {
    role: "backend",
    base: foundation.commit,
    commit: source.commit,
    tree: await f.git(f.repositories.backend.cwd, [
      "rev-parse",
      `${source.commit}^{tree}`
    ]),
    changed: true,
    source_prs: [source]
  };
  const record = {
    id: "22222222-2222-4222-8222-222222222222",
    release_id: "11111111-1111-4111-8111-111111111111",
    step: {
      id: "staging:integrate:backend",
      kind: "integrate",
      role: "backend",
      environment: "staging"
    },
    state: "prepared",
    created_at: "2026-10-02T12:00:00.000Z"
  };
  const server = path.join(f.directory, "server.git");
  await f.git(f.directory, [
    "clone",
    "--bare",
    f.repositories.backend.cwd,
    server
  ]);
  async function git(args, input, identity = {}) {
    return (
      await runRehearsalProcess(
        "git",
        [
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgSign=false",
          ...args
        ],
        {
          cwd: server,
          env: { ...f.env, ...identity },
          input
        }
      )
    ).stdout.trim();
  }
  const runtime = { ...sandboxReleaseRuntime, profile };
  const calls = [],
    saves = [],
    preparations = [],
    gates = [];
  let tip = staging.commit,
    owned = null,
    pr = null,
    hook = async () => {};
  let gateChange = (value) => value;
  const controller = new AbortController();
  const merge = async (value, selected, options) => {
    preparations.push(structuredClone({ candidate: selected, options }));
    return prepareStagingMerge(value, selected, {
      profile: f.profile,
      createGit: f.createGit,
      signal: controller.signal,
      ...options
    });
  };
  const response = (data, status = 200) =>
    `HTTP/2 ${status} OK\r\ncontent-type: application/json\r\n\r\n${data === undefined ? "" : JSON.stringify(data)}`;
  const client = createMockReleaseGitHub({
    profile: f.profile,
    runtime,
    signal: controller.signal,
    wait: async () => {},
    stagingMerge: merge,
    gates: {
      pullRequest: async (_role, number) => {
        if (number === source.number)
          return f.github.pullRequest("backend", number);
        const value = gateChange({
          state: "OPEN",
          isDraft: false,
          headRefName: record.branch,
          headRefOid: owned,
          baseRefName: "1a-staging",
          baseRefOid: staging.commit,
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          checks: [
            {
              __typename: "CheckRun",
              id: "fresh-staging-check",
              name: "Sandbox check",
              isRequired: false,
              status: "COMPLETED",
              conclusion: "SUCCESS"
            }
          ]
        });
        gates.push(structuredClone(value));
        return value;
      }
    },
    execute: async (args, body) => {
      const method = args[args.indexOf("--method") + 1];
      const endpoint = args[args.indexOf("--method") + 2];
      const suffix =
        endpoint === "user"
          ? "user"
          : endpoint.slice(
              `repos/${f.profile.repositories.backend.full_name}`.length
            );
      calls.push({ method, suffix, body });
      let data,
        status = 200;
      if (suffix === "user")
        data = { id: Number(actor.id), login: actor.login };
      else if (suffix === "/git/ref/heads/1a-staging")
        data = { object: { sha: tip } };
      else if (suffix === `/git/ref/heads/${record.branch}`) {
        status = owned ? 200 : 404;
        data = owned ? { object: { sha: owned } } : {};
      } else if (method === "GET" && suffix.startsWith("/git/blobs/")) {
        const oid = suffix.split("/").at(-1);
        const observed = await git(["cat-file", "--batch-check"], `${oid}\n`);
        status = observed.endsWith(" missing") ? 404 : 200;
        data = status === 200 ? { sha: oid } : {};
      } else if (method === "POST" && suffix === "/git/blobs") {
        data = {
          sha: await git(
            ["hash-object", "-w", "--stdin"],
            Buffer.from(body.content, "base64")
          )
        };
        status = 201;
      } else if (method === "POST" && suffix === "/git/trees") {
        await git(["read-tree", body.base_tree]);
        for (const file of body.tree) {
          if (file.sha === null)
            await git(["update-index", "--force-remove", "--", file.path]);
          else
            await git([
              "update-index",
              "--add",
              "--cacheinfo",
              file.mode,
              file.sha,
              file.path
            ]);
        }
        data = { sha: await git(["write-tree"]) };
        status = 201;
      } else if (method === "POST" && suffix === "/git/commits") {
        const oid = await git(
          [
            "commit-tree",
            body.tree,
            ...body.parents.flatMap((parent) => ["-p", parent]),
            "-m",
            body.message
          ],
          undefined,
          {
            GIT_AUTHOR_NAME: body.author.name,
            GIT_AUTHOR_EMAIL: body.author.email,
            GIT_AUTHOR_DATE: body.author.date,
            GIT_COMMITTER_NAME: body.committer.name,
            GIT_COMMITTER_EMAIL: body.committer.email,
            GIT_COMMITTER_DATE: body.committer.date
          }
        );
        data = {
          sha: oid,
          tree: { sha: body.tree },
          parents: body.parents.map((sha) => ({ sha }))
        };
        status = 201;
      } else if (method === "GET" && suffix.startsWith("/git/commits/")) {
        const oid = suffix.split("/").at(-1);
        data = {
          sha: oid,
          tree: { sha: await git(["rev-parse", `${oid}^{tree}`]) },
          parents: (await git(["show", "-s", "--format=%P", oid]))
            .split(" ")
            .filter(Boolean)
            .map((sha) => ({ sha }))
        };
      } else if (method === "POST" && suffix === "/git/refs") {
        owned = body.sha;
        status = 201;
        data = { object: { sha: owned } };
      } else if (suffix.startsWith("/pulls?state=open")) data = [];
      else if (suffix.startsWith("/pulls?state=all")) data = pr ? [pr] : [];
      else if (method === "POST" && suffix === "/pulls") {
        const mergeCommit = await git([
          "commit-tree",
          record.staging_preparation.tree,
          "-p",
          staging.commit,
          "-p",
          owned,
          "-m",
          "Server test merge"
        ]);
        pr = {
          number: 99,
          html_url: "https://example.invalid/pr/99",
          body: record.body,
          head: {
            repo: f.profile.repositories.backend,
            ref: record.branch,
            sha: owned
          },
          base: { repo: f.profile.repositories.backend, ref: "1a-staging" },
          user: { id: Number(actor.id) },
          state: "open",
          merged: false,
          merge_commit_sha: mergeCommit
        };
        status = 201;
        data = pr;
      } else if (method === "GET" && suffix === "/pulls/99") data = pr;
      else if (method === "PATCH" && suffix === "/pulls/99") {
        pr = { ...pr, state: "closed" };
        data = pr;
      } else if (method === "PUT" && suffix === "/pulls/99/merge") {
        assert.equal(body.sha, owned);
        tip = pr.merge_commit_sha;
        pr = { ...pr, state: "closed", merged: true };
        data = { merged: true, sha: tip };
      } else if (
        method === "DELETE" &&
        suffix === `/git/refs/heads/${record.branch}`
      ) {
        owned = null;
        status = 204;
      } else if (suffix.includes("/runs?"))
        data = { total_count: 0, workflow_runs: [] };
      else assert.fail(`Unexpected fixture request ${method} ${suffix}`);
      await hook({ method, suffix, body, data });
      return response(data, status);
    }
  });
  const input = {
    record,
    candidate,
    actor,
    expectedBase: staging.commit,
    save: async () => saves.push(structuredClone(record))
  };
  return {
    ...f,
    actor,
    candidate,
    record,
    staging,
    client,
    input,
    git,
    calls,
    saves,
    preparations,
    gates,
    controller,
    setHook: (value) => {
      hook = value;
    },
    setGate: (value) => {
      gateChange = value;
    },
    move: () => {
      tip = foundation.commit;
    }
  };
}

for (const profile of ["sandbox", "real"]) {
  test(`${profile}: staging merge preserves staging-only work, exact source ancestry and fresh check binding`, async (t) => {
    const f = await fixture(t, { profile });
    const pinned = serviceHash(f.candidate);
    const result = await f.client.integrate(f.input);
    assert.equal(result.status, "passed");
    assert.equal(f.record.integration_version, 2);
    assert.notEqual(result.tree, f.candidate.tree);
    assert.equal(result.tree, f.record.staging_preparation.tree);
    assert.equal(f.record.checked_tree, result.tree);
    assert.deepEqual(f.record.integration_input.parents, [
      f.staging.commit,
      f.candidate.commit
    ]);
    assert.equal(
      await f.git(["show", `${result.commit}:docs/staging.md`]),
      "keep staging-only work"
    );
    assert.equal(
      await f.git(["show", `${result.commit}:shared.txt`]),
      "staging first\nunchanged\nsource last"
    );
    await f.git([
      "merge-base",
      "--is-ancestor",
      f.candidate.commit,
      result.commit
    ]);
    assert.ok(f.gates.length >= 2);
    assert.ok(
      f.gates.every(
        (gate) =>
          gate.headRefOid === f.record.integration_commit &&
          gate.headRefOid !== f.candidate.commit
      )
    );
    assert.equal(serviceHash(f.candidate), pinned);
    assert.equal(
      f.calls.filter(
        (call) => call.method === "POST" && call.suffix === "/git/blobs"
      ).length,
      1
    );
    assert.equal(
      (await readdir(f.directory)).some((name) =>
        name.startsWith("6529-rehearsal-")
      ),
      false
    );
  });
  test(`${profile}: real text conflicts stop before any GitHub object, PR or shared-branch write`, async (t) => {
    const f = await fixture(t, { profile, conflict: true });
    const result = await f.client.integrate(f.input);
    assert.equal(result.status, "failed");
    assert.equal(result.kind, "merge-conflict");
    assert.deepEqual(result.conflicts, ["src/quote.test.txt"]);
    assert.match(result.message, /conflicts.*src\/quote.test.txt/u);
    assert.doesNotMatch(result.message, /checks failed/u);
    assert.equal(
      f.calls.every((call) => call.method === "GET"),
      true
    );
    assert.equal(f.record.branch, undefined);
    assert.equal(await f.git(["rev-parse", "1a-staging"]), f.staging.commit);
  });
}

for (const lost of ["/git/blobs", "/git/trees", "/pulls", "/pulls/99/merge"]) {
  test(`staging reconciliation after a lost ${lost} response retains exact inputs and does not duplicate shared writes`, async (t) => {
    const f = await fixture(t);
    let once = false;
    f.setHook(async ({ method, suffix }) => {
      if (!once && suffix === lost && method !== "GET") {
        once = true;
        throw Error("Lost response");
      }
    });
    await assert.rejects(f.client.integrate(f.input), /Lost response/u);
    const pinned = serviceHash(f.record.staging_preparation);
    const originalInput = serviceHash(f.record.integration_input);
    const result = await f.client.integrate(f.input);
    assert.equal(result.status, "passed");
    assert.equal(serviceHash(f.record.staging_preparation), pinned);
    assert.equal(serviceHash(f.record.integration_input), originalInput);
    assert.equal(
      f.calls.filter(
        (call) => call.suffix === "/pulls" && call.method === "POST"
      ).length,
      1
    );
    assert.equal(
      f.calls.filter(
        (call) => call.suffix === "/pulls/99/merge" && call.method === "PUT"
      ).length,
      1
    );
    assert.equal(
      f.calls.filter(
        (call) => call.suffix === "/git/blobs" && call.method === "POST"
      ).length,
      1
    );
  });
}

test("staging movement during preparation or publication stops without a shared merge", async (t) => {
  const f = await fixture(t);
  f.setHook(async ({ suffix, method }) => {
    if (suffix === "/git/blobs" && method === "POST") f.move();
  });
  await assert.rejects(f.client.integrate(f.input), /Staging changed/u);
  assert.equal(
    f.calls.some(
      (call) => call.method === "PUT" || call.suffix === "/git/refs"
    ),
    false
  );
});

test("older long-post tests copied into staging stop with both #285 conflict paths, not a guessed resolution", async (t) => {
  const conflictPaths = [
    "__tests__/components/waves/drops/WaveDropQuote.test.tsx",
    "tests/social/waves-composer-sandbox.spec.ts"
  ];
  const f = await fixture(t, {
    profile: "real",
    conflict: true,
    conflictPaths
  });
  const result = await f.client.integrate(f.input);
  assert.equal(result.kind, "merge-conflict");
  assert.deepEqual(result.conflicts.sort(), conflictPaths.sort());
  assert.equal(
    f.calls.every((call) => call.method === "GET"),
    true
  );
});

test("wrong test-merge parents cannot authorize the prepared staging tree", async (t) => {
  const f = await fixture(t);
  f.setHook(async ({ suffix, data }) => {
    if (
      suffix.startsWith("/git/commits/") &&
      !suffix.endsWith(f.record.integration_commit) &&
      f.record.number
    )
      data.parents = [{ sha: f.candidate.commit }];
  });
  await assert.rejects(
    f.client.integrate(f.input),
    /exact checked integration tree/u
  );
  assert.equal(
    f.calls.some((call) => call.method === "PUT"),
    false
  );
});

test("abort during the final blob lookup prevents every publication request", async (t) => {
  const f = await fixture(t);
  f.setHook(async ({ suffix }) => {
    if (suffix.startsWith("/git/blobs/")) f.controller.abort();
  });
  await assert.rejects(f.client.integrate(f.input), { name: "AbortError" });
  assert.equal(
    f.calls.every((call) => call.method === "GET"),
    true
  );
});

test("a wrong checked tree stops before merging the staging PR", async (t) => {
  const f = await fixture(t);
  f.setHook(async ({ suffix, data }) => {
    if (
      suffix.startsWith("/git/commits/") &&
      suffix.endsWith(f.record.integration_commit) === false &&
      f.record.number
    )
      data.tree.sha = f.candidate.tree;
  });
  await assert.rejects(
    f.client.integrate(f.input),
    /exact checked integration tree/u
  );
  assert.equal(
    f.calls.some((call) => call.method === "PUT"),
    false
  );
});

test("a stale check head cannot authorize the fresh staging merge", async (t) => {
  const f = await fixture(t);
  f.setGate((gate) => ({ ...gate, headRefOid: f.candidate.commit }));
  await assert.rejects(
    f.client.integrate(f.input),
    /changed while checks ran/u
  );
  assert.equal(
    f.calls.some((call) => call.method === "PUT"),
    false
  );
});

test("a genuine CI failure still stops and cleans only its owned branch", async (t) => {
  const f = await fixture(t);
  f.setGate((gate) => ({
    ...gate,
    checks: gate.checks.map((check) => ({ ...check, conclusion: "FAILURE" }))
  }));
  const result = await f.client.integrate(f.input);
  assert.equal(result.kind, "checks");
  assert.equal(f.record.cleanup, "removed");
  assert.equal(
    f.calls.some((call) => call.method === "PUT"),
    false
  );
});

test("GitHub merge conflicts are reported accurately, including across interrupted cleanup", async (t) => {
  const f = await fixture(t);
  f.setGate((gate) => ({
    ...gate,
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY"
  }));
  let once = false;
  f.setHook(async ({ method, suffix }) => {
    if (!once && method === "PATCH" && suffix === "/pulls/99") {
      once = true;
      throw Error("Lost close");
    }
  });
  await assert.rejects(f.client.integrate(f.input), /Lost close/u);
  assert.equal(f.record.failure_kind, "merge-conflict");
  const result = await f.client.integrate(f.input);
  assert.equal(result.kind, "merge-conflict");
  assert.match(result.message, /merge conflict/u);
  assert.doesNotMatch(result.message, /checks failed/u);
  assert.equal(
    f.calls.some((call) => call.method === "PUT"),
    false
  );
});

test("saved staging identity, SHA-only patch and integration parents cannot change on resume", async (t) => {
  const f = await fixture(t);
  f.record.base = f.staging.commit;
  f.record.profile = "sandbox";
  const result = await prepareStagingMerge(f.record, f.candidate, {
    profile: f.profile,
    createGit: f.createGit
  });
  f.record.staging_preparation = result.preparation;
  f.record.integration_version = 2;
  assert.doesNotThrow(() => validateStagingMerge(f.record, f.candidate));
  for (const field of [
    "base",
    "candidate_commit",
    "candidate_tree",
    "profile",
    "role"
  ]) {
    const bad = structuredClone(f.record);
    bad.staging_preparation[field] = "0".repeat(40);
    assert.throws(
      () => integrationCommitInput(bad, f.candidate),
      /Staging preparation/u
    );
  }
  const bad = structuredClone(result.preparation);
  bad.patch[0].sha = "0".repeat(40);
  await assert.rejects(
    prepareStagingMerge(f.record, f.candidate, {
      profile: f.profile,
      createGit: f.createGit,
      expected: bad
    }),
    /differs from its saved preparation/u
  );
  f.record.staging_preparation.patch[0].content = "must not enter journal";
  assert.throws(
    () => validateStagingMerge(f.record, f.candidate),
    /Staging preparation/u
  );
});

test("a prepared staging PR can wait for review and cancel without recreating or merging it", async (t) => {
  const f = await fixture(t);
  f.setGate((gate) => ({ ...gate, mergeStateStatus: "BLOCKED" }));
  const paused = await f.client.integrate(f.input);
  assert.equal(paused.status, "waiting-review");
  assert.equal(f.record.integration_version, 2);
  f.record.cleanup_reason = "review-stop";
  const before = f.calls.length;
  const stopped = await f.client.cancelIntegration(f.input);
  assert.equal(stopped.kind, "review-stop");
  assert.equal(f.record.cleanup, "removed");
  assert.equal(
    f.calls
      .slice(before)
      .some((call) => call.method === "POST" || call.method === "PUT"),
    false
  );
});

for (const profile of ["sandbox", "real"]) {
  test(`${profile}: review-stop cleans the exact paused staging PR after staging moves`, async (t) => {
    const f = await fixture(t, { profile });
    f.setGate((gate) => ({ ...gate, mergeStateStatus: "BLOCKED" }));
    const paused = await f.client.integrate(f.input);
    assert.equal(paused.status, "waiting-review");
    assert.equal(f.record.state, "checking");
    assert.equal(f.record.integration_version, 2);
    const preparation = serviceHash(f.record.staging_preparation);
    const integration = serviceHash(f.record.integration_input);
    f.move();
    await assert.rejects(
      f.client.integrate(f.input),
      /changed before integration/u
    );
    const before = f.calls.length;
    let once = false;
    const stopInput = {
      ...f.input,
      reviewStop: true,
      save: async () => {
        await f.input.save();
        if (!once && f.record.state === "cleaning") {
          once = true;
          throw Error("Lost review-stop save");
        }
      }
    };
    await assert.rejects(
      f.client.integrate(stopInput),
      /Lost review-stop save/u
    );
    assert.equal(f.record.cleanup_reason, "review-stop");
    const stopped = await f.client.integrate(f.input);
    assert.equal(stopped.kind, "review-stop");
    assert.equal(f.record.cleanup, "removed");
    assert.equal(serviceHash(f.record.staging_preparation), preparation);
    assert.equal(serviceHash(f.record.integration_input), integration);
    const writes = f.calls
      .slice(before)
      .filter((call) => call.method !== "GET");
    assert.ok(writes.some((call) => call.method === "PATCH"));
    assert.ok(writes.some((call) => call.method === "DELETE"));
    assert.ok(
      writes.every(
        (call) =>
          (call.method === "POST" && call.suffix === "/git/commits") ||
          (call.method === "PATCH" && call.suffix === "/pulls/99") ||
          (call.method === "DELETE" &&
            call.suffix === `/git/refs/heads/${f.record.branch}`)
      )
    );
  });
}

test("owned workspace cleanup failure cannot return a reusable staging preparation", async (t) => {
  const f = await fixture(t);
  f.record.base = f.staging.commit;
  await assert.rejects(
    prepareStagingMerge(f.record, f.candidate, {
      profile: f.profile,
      createGit: async (options) => {
        const session = await f.createGit(options);
        return {
          ...session,
          cleanup: async () => {
            await session.cleanup();
            throw Error("Cleanup uncertain");
          }
        };
      }
    }),
    (error) =>
      error.code === "cleanup_failed" && typeof error.owned_path === "string"
  );
});
