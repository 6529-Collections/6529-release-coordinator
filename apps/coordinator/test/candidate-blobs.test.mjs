import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./batch-github-fixture.mjs";
import { realProfile } from "../src/profiles.mjs";
import {
  blobHash,
  ServiceError,
  serviceHash
} from "../src/service-contract.mjs";
import { readCandidateBlobs } from "../src/candidate-blobs.mjs";
import { rehearsalFixture } from "./rehearsal-fixture.mjs";
import { readdir } from "node:fs/promises";
import { checkBatch } from "../src/batch-checks.mjs";
import { realBatchPolicy } from "../src/batch-plan.mjs";
import { runRehearsalProcess } from "../src/rehearsal-process.mjs";

const bytes = Buffer.from("main change\nunchanged\nPR change\n");
const sha = blobHash(bytes);
const blob = { sha, content: bytes.toString("base64"), encoding: "base64" };

test("real trial uploads a missing merged blob before publishing the exact saved tree", async () => {
  let reconstructed = 0;
  const f = fixture({
    profile: realProfile,
    missingBlobs: new Set([sha]),
    candidateBlobs: async (record, patch, missing) => {
      reconstructed++;
      assert.equal(record.tree, f.record.tree);
      assert.deepEqual(patch, f.patch);
      assert.deepEqual(missing, [sha]);
      return [blob];
    }
  });
  f.record.source_prs = [
    { number: 1, branch: "codex/a", commit: "1".repeat(40) }
  ];
  f.patch[0].sha = sha;
  await f.client.open(f.record, f.patch, f.save);
  assert.equal(reconstructed, 1);
  const upload = f.calls.findIndex((call) => call.path === "/git/blobs");
  const tree = f.calls.findIndex((call) => call.path === "/git/trees");
  assert.ok(upload >= 0 && upload < tree);
  assert.deepEqual(f.calls[upload].body, {
    content: blob.content,
    encoding: "base64"
  });
  assert.deepEqual(f.calls[tree].body.tree, f.patch);
  assert.equal(f.record.tree, "b".repeat(40));
  assert.deepEqual(
    f.tested.parents.map((parent) => parent.sha),
    [f.record.base, "1".repeat(40)]
  );
});

test("existing blobs, duplicate SHAs and deletions need no reconstruction or upload", async () => {
  const f = fixture({
    profile: realProfile,
    existingBlobs: new Set(["e".repeat(40)]),
    candidateBlobs: () => assert.fail("No missing blobs")
  });
  f.patch.push({ ...f.patch[0], path: "other.txt", mode: "100755" });
  f.patch.push({
    path: "deleted.txt",
    mode: "100644",
    type: "blob",
    sha: null
  });
  await f.client.open(f.record, f.patch, f.save);
  assert.equal(
    f.calls.filter((call) => call.path.startsWith("/git/blobs/")).length,
    1
  );
  assert.equal(
    f.calls.some((call) => call.path === "/git/blobs"),
    false
  );
  assert.deepEqual(
    f.calls.find((call) => call.path === "/git/trees").body.tree,
    f.patch
  );
});

test("partial multi-blob publication resumes only remaining bytes and creates one tree", async () => {
  const secondBytes = Buffer.from("second merged file\n");
  const second = {
    sha: blobHash(secondBytes),
    content: secondBytes.toString("base64"),
    encoding: "base64"
  };
  const payloads = new Map([
    [sha, blob],
    [second.sha, second]
  ]);
  const existingBlobs = new Set();
  const reconstructed = [];
  let interrupted = false;
  const f = fixture({
    profile: realProfile,
    existingBlobs,
    candidateBlobs: async (_record, _patch, missing) => {
      reconstructed.push([...missing]);
      // Upload order is deliberately different from the patch order.
      return missing.map((oid) => payloads.get(oid)).reverse();
    },
    after: ({ method, path }) => {
      if (method === "POST" && path === "/git/blobs" && !interrupted) {
        interrupted = true;
        throw Error("Interrupted between uploads");
      }
    }
  });
  f.patch[0].sha = sha;
  f.patch.push({ ...f.patch[0], path: "second.txt", sha: second.sha });
  f.record.source_prs = [
    { number: 1, branch: "codex/a", commit: "1".repeat(40) }
  ];
  const before = serviceHash({
    patch: f.patch,
    source_prs: f.record.source_prs
  });
  await assert.rejects(
    f.client.open(f.record, f.patch, f.save),
    /Interrupted between uploads/
  );
  assert.deepEqual([...existingBlobs], [second.sha]);
  assert.equal(
    f.calls.some((call) => call.path === "/git/trees"),
    false
  );
  assert.equal(f.record.commit, undefined);
  await f.client.open(f.record, f.patch, f.save);
  assert.deepEqual(reconstructed, [[sha, second.sha], [sha]]);
  assert.deepEqual(
    f.calls
      .filter((call) => call.method === "POST" && call.path === "/git/blobs")
      .map((call) => blobHash(Buffer.from(call.body.content, "base64"))),
    [second.sha, sha]
  );
  for (const path of ["/git/trees", "/git/commits", "/git/refs", "/pulls"])
    assert.equal(
      f.calls.filter((call) => call.method === "POST" && call.path === path)
        .length,
      1
    );
  assert.equal(
    serviceHash({ patch: f.patch, source_prs: f.record.source_prs }),
    before
  );
});

test("subprocess text and raw-byte contracts are explicit and unsupported encodings fail before spawning", async () => {
  const expected = Buffer.from([0, 255, 128, 13, 10]);
  const args = ["-e", "process.stdout.write(Buffer.from([0,255,128,13,10]));"];
  for (const encoding of [null, undefined, "utf8"]) {
    const result = await runRehearsalProcess(process.execPath, args, {
      encoding
    });
    if (encoding === null) {
      assert.equal(Buffer.isBuffer(result.stdout), true);
      assert.deepEqual(result.stdout, expected);
    } else {
      assert.equal(typeof result.stdout, "string");
      assert.equal(result.stdout, expected.toString("utf8"));
    }
  }
  await assert.rejects(
    runRehearsalProcess("not-a-tool", [], { encoding: "invalid" }),
    { code: "invalid_encoding" }
  );
});

test("an upload's lost response resumes the same saved check attempt without repeating it", async () => {
  let lose = true;
  const missingBlobs = new Set([sha]);
  const f = fixture({
    profile: realProfile,
    missingBlobs,
    candidateBlobs: async () => [blob],
    after: ({ method, path }) => {
      if (method === "POST" && path === "/git/blobs" && lose) {
        lose = false;
        throw Error("Lost blob response");
      }
    }
  });
  f.patch[0].sha = sha;
  f.record.source_prs = [
    { number: 1, branch: "codex/a", commit: "1".repeat(40) }
  ];
  const prepared = {
    status: "passed",
    input_hash: "d".repeat(64),
    binding: { tickets: [{ issue_number: 285 }] },
    publications: [
      {
        role: f.record.role,
        base: f.record.base,
        tree: f.record.tree,
        source_prs: f.record.source_prs,
        patch: f.patch
      }
    ]
  };
  const before = serviceHash(prepared);
  let progress;
  const options = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    profile: realProfile,
    policy: realBatchPolicy,
    client: f.client,
    guard: async () => {},
    verify: async () => {},
    now: () => Date.parse(f.record.created_at),
    save: async (saved) => {
      progress = structuredClone(saved);
    }
  };
  await assert.rejects(checkBatch(prepared, options), /Lost blob response/);
  assert.equal(progress.prs.length, 1);
  assert.equal(progress.result, undefined);
  assert.equal(progress.prs[0].commit, undefined);
  assert.equal(
    f.calls.some((call) => call.path === "/git/trees"),
    false
  );
  assert.equal(missingBlobs.size, 0);
  const saved = structuredClone(progress);
  const result = await checkBatch(prepared, { ...options, previous: saved });
  assert.equal(result.status, "passed");
  assert.equal(progress.id, saved.id);
  assert.equal(progress.prepared_hash, saved.prepared_hash);
  assert.equal(progress.cleanup, "removed");
  assert.equal(
    f.calls.filter(
      (call) => call.method === "POST" && call.path === "/git/blobs"
    ).length,
    1
  );
  assert.equal(
    f.calls.filter((call) => call.method === "POST" && call.path === "/pulls")
      .length,
    1
  );
  assert.equal(serviceHash(prepared), before);
});

test("unverified, duplicate or unexpected upload payloads stop before any GitHub write", async () => {
  for (const payload of [
    [{ ...blob, content: Buffer.from("wrong").toString("base64") }],
    [{ ...blob, content: `${blob.content}\n` }],
    [{ ...blob, encoding: "utf-8" }],
    [{ ...blob, sha: "f".repeat(40) }],
    [blob, blob],
    []
  ]) {
    const f = fixture({
      profile: realProfile,
      missingBlobs: new Set([sha]),
      candidateBlobs: async () => payload
    });
    f.patch[0].sha = sha;
    await assert.rejects(f.client.open(f.record, f.patch, f.save), {
      code: "batch-blob-content"
    });
    assert.equal(
      f.calls.some((call) => call.method !== "GET"),
      false
    );
  }
});

test("wrong GitHub blob identities or failed uploads never create a candidate tree or branch", async () => {
  for (const cause of ["read", "upload", "failure"]) {
    const f = fixture({
      profile: realProfile,
      missingBlobs: new Set(cause === "read" ? [] : [sha]),
      candidateBlobs: async () => [blob],
      after: ({ method, path, response }) => {
        if (cause === "read" && path.startsWith("/git/blobs/"))
          response.sha = "f".repeat(40);
        if (method === "POST" && path === "/git/blobs") {
          if (cause === "upload") response.sha = "f".repeat(40);
          else throw Error("Blob upload failed");
        }
      }
    });
    f.patch[0].sha = sha;
    await assert.rejects(f.client.open(f.record, f.patch, f.save));
    assert.equal(
      f.calls.some((call) =>
        ["/git/trees", "/git/commits", "/git/refs", "/pulls"].includes(
          call.path
        )
      ),
      false
    );
    assert.equal(f.record.commit, undefined);
  }
});

test("moved main or lost journal authority prevents uploading a missing blob", async () => {
  for (const cause of ["main", "guard", "abort"]) {
    const controller = new AbortController();
    let stop = false;
    const f = fixture({
      profile: realProfile,
      missingBlobs: new Set([sha]),
      signal: controller.signal,
      guard: async () => {
        if (stop && cause === "guard") throw Error("Lost authority");
      },
      candidateBlobs: async (record) => {
        stop = true;
        assert.equal(record.base, f.record.base);
        if (cause === "main") f.moveMain();
        if (cause === "abort") controller.abort();
        return [blob];
      }
    });
    f.patch[0].sha = sha;
    await assert.rejects(f.client.open(f.record, f.patch, f.save));
    assert.equal(
      f.calls.some((call) => call.method !== "GET"),
      false
    );
  }
});

/** Build a genuine local-only merge blob, then remove its preparation workspace before testing resume. */
async function mergedFixture(t) {
  const git = await rehearsalFixture(t);
  const ancestor = await git.branch("frontend", "fixture/ancestor", {
    "ops/help/help-index.json":
      '{\n  "main": 0,\n  "spacer": 0,\n  "pr": 0\n}\n'
  });
  const main = await git.branch(
    "frontend",
    "fixture/main",
    {
      "ops/help/help-index.json":
        '{\n  "main": 1,\n  "spacer": 0,\n  "pr": 0\n}\n'
    },
    ancestor.commit
  );
  const source = await git.branch(
    "frontend",
    "fixture/pr",
    {
      "ops/help/help-index.json":
        '{\n  "main": 0,\n  "spacer": 0,\n  "pr": 1\n}\n',
      "binary.dat": Buffer.from([0, 255, 13, 10, 128]),
      "run.sh": "#!/bin/sh\ntrue\n"
    },
    ancestor.commit
  );
  await git.git(git.repositories.frontend.cwd, [
    "update-index",
    "--chmod=+x",
    "run.sh"
  ]);
  await git.git(git.repositories.frontend.cwd, [
    "commit",
    "-m",
    "Executable fixture"
  ]);
  source.commit = await git.git(git.repositories.frontend.cwd, [
    "rev-parse",
    "HEAD"
  ]);
  const repo = {
    role: "frontend",
    identity: realProfile.repositories.frontend,
    destination: { commit: main.commit },
    pull_requests: [source]
  };
  const createGit = (options) =>
    git.createGit({ ...options, candidatePatchMode: "real" });
  const session = await createGit();
  let patch, tree;
  try {
    const workspace = await session.repository(repo);
    const merged = await workspace.merge(main.commit, source.commit);
    assert.equal(merged.status, "pass");
    tree = merged.tree;
    patch = await workspace.patch(
      main.commit,
      merged.commit,
      await workspace.changedPaths(main.commit, merged.commit)
    );
  } finally {
    await session.cleanup();
  }
  const record = {
    role: "frontend",
    base: main.commit,
    tree,
    source_prs: [source]
  };
  const options = { profile: realProfile, createGit };
  return { git, patch, record, options };
}

test("actual Git recreates a missing combined help index after cleanup and publishes byte-exact files", async (t) => {
  const { git, patch, record, options } = await mergedFixture(t);
  const combined = patch.find(
    (file) => file.path === "ops/help/help-index.json"
  );
  for (const commit of [record.base, record.source_prs[0].commit]) {
    assert.notEqual(
      await git.git(git.repositories.frontend.cwd, [
        "rev-parse",
        `${commit}:${combined.path}`
      ]),
      combined.sha
    );
  }
  await assert.rejects(
    git.git(git.repositories.frontend.cwd, ["cat-file", "-e", combined.sha])
  );
  const snapshot = serviceHash({ record, patch });
  const missing = patch.map((file) => file.sha);
  const binary = patch.find((file) => file.path === "binary.dat");
  const cwd = git.repositories.frontend.cwd;
  const refsBefore = await git.git(cwd, ["show-ref"]);
  const statusBefore = await git.git(cwd, ["status", "--porcelain"]);
  const baseTree = await git.git(cwd, ["rev-parse", `${record.base}^{tree}`]);
  const f = fixture({
    profile: realProfile,
    role: "frontend",
    missingBlobs: new Set(missing),
    baseTree,
    candidateBlobs: (...args) => readCandidateBlobs(...args, options),
    after: async ({ method, path, body, response }) => {
      if (method === "POST" && path === "/git/blobs") {
        const uploaded = await runRehearsalProcess(
          "git",
          ["hash-object", "--stdin"],
          { cwd, env: git.env, input: Buffer.from(body.content, "base64") }
        );
        assert.equal(uploaded.stdout.trim(), response.sha);
      }
      if (method === "POST" && path === "/git/trees") {
        // Independently compute GitHub's tree semantics from the uploaded
        // objects in a bare fixture. Do not trust the fixture's returned SHA.
        const server = await options.createGit();
        try {
          await server.repository({
            role: "frontend",
            identity: realProfile.repositories.frontend,
            destination: { commit: record.base },
            pull_requests: record.source_prs
          });
          const serverCwd = `${server.directory}/repository-1.git`;
          for (const file of body.tree) {
            const content = f.calls.find(
              (call) =>
                call.path === "/git/blobs" &&
                blobHash(Buffer.from(call.body.content, "base64")) === file.sha
            ).body.content;
            await runRehearsalProcess("git", ["hash-object", "-w", "--stdin"], {
              cwd: serverCwd,
              env: git.env,
              input: Buffer.from(content, "base64")
            });
          }
          await git.git(serverCwd, ["read-tree", body.base_tree]);
          for (const file of body.tree)
            await git.git(serverCwd, [
              "update-index",
              "--add",
              "--cacheinfo",
              file.mode,
              file.sha,
              file.path
            ]);
          assert.equal(await git.git(serverCwd, ["write-tree"]), record.tree);
        } finally {
          await server.cleanup();
        }
      }
    }
  });
  Object.assign(f.record, record);
  await f.client.open(f.record, patch, f.save);
  const uploads = f.calls.filter((call) => call.path === "/git/blobs");
  assert.equal(uploads.length, 3);
  const uploadedBinary = uploads.find(
    (call) => blobHash(Buffer.from(call.body.content, "base64")) === binary.sha
  );
  assert.deepEqual(
    Buffer.from(uploadedBinary.body.content, "base64"),
    Buffer.from([0, 255, 13, 10, 128])
  );
  assert.equal(patch.find((file) => file.path === "run.sh").mode, "100755");
  assert.equal(
    f.calls.find((call) => call.path === "/git/trees").body.base_tree,
    baseTree
  );
  assert.equal(f.record.tree, record.tree);
  assert.equal(serviceHash({ record, patch }), snapshot);
  assert.equal(await git.git(cwd, ["show-ref"]), refsBefore);
  assert.equal(await git.git(cwd, ["status", "--porcelain"]), statusBefore);
  assert.deepEqual(
    (await readdir(git.directory)).filter((name) =>
      name.startsWith("6529-rehearsal-")
    ),
    []
  );
});

test("reconstruction refuses a different saved tree or patch and still cleans its temporary Git", async (t) => {
  const { git, patch, record, options } = await mergedFixture(t);
  const missing = [patch[0].sha];
  await assert.rejects(
    readCandidateBlobs(
      { ...record, tree: "f".repeat(40) },
      patch,
      missing,
      options
    ),
    { code: "batch-blob-tree" }
  );
  await assert.rejects(
    readCandidateBlobs(record, patch.slice(0, 1), missing, options),
    { code: "batch-blob-patch" }
  );
  await assert.rejects(
    readCandidateBlobs(record, [...patch].reverse(), missing, options),
    { code: "batch-blob-patch" }
  );
  assert.deepEqual(
    (await readdir(git.directory)).filter((name) =>
      name.startsWith("6529-rehearsal-")
    ),
    []
  );
});

test("missing original heads or an unrelated blob cannot start reconstruction", async () => {
  const options = {
    profile: realProfile,
    createGit: () => assert.fail("Must validate before creating Git")
  };
  const record = {
    role: "frontend",
    base: "a".repeat(40),
    tree: "b".repeat(40)
  };
  const patch = [{ path: "file.txt", sha }];
  await assert.rejects(readCandidateBlobs(record, patch, [sha], options), {
    code: "batch-blob-input"
  });
  record.source_prs = [
    { number: 1, branch: "codex/a", commit: "1".repeat(40) }
  ];
  await assert.rejects(
    readCandidateBlobs(record, patch, ["f".repeat(40)], options),
    { code: "batch-blob-input" }
  );
});

test("failed owned reconstruction cleanup blocks returning any upload bytes", async () => {
  const options = {
    profile: realProfile,
    createGit: async () => ({
      directory: "/fixture/owned",
      repository: async () => {
        throw Error("unreadable merge");
      },
      cleanup: async () => {
        throw Error("cleanup failed");
      }
    })
  };
  const record = {
    role: "frontend",
    base: "a".repeat(40),
    tree: "b".repeat(40),
    source_prs: [{ number: 1, branch: "codex/a", commit: "1".repeat(40) }]
  };
  await assert.rejects(
    readCandidateBlobs(record, [{ sha }], [sha], options),
    (error) =>
      error instanceof ServiceError &&
      error.code === "cleanup_failed" &&
      error.message ===
        "Failed to remove owned candidate directory: /fixture/owned" &&
      error.owned_path === "/fixture/owned"
  );
});
