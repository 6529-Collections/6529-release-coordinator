import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildApplication,
  verifyApplicationBuild
} from "../sandbox/application-build.mjs";
import { databaseCandidate, sampleFiles } from "../sandbox/fixtures.mjs";
import {
  closeServers,
  runSandboxReleaseOperation
} from "../sandbox/release-run.mjs";
import {
  makeReleaseBuild,
  makeReleaseOperation,
  releaseBuildFiles
} from "../src/release-contract.mjs";
import { sandboxProfile } from "../src/profiles.mjs";

async function candidate(root, role, commit, files = sampleFiles()) {
  const directory = path.join(root, "candidates", role);
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries(files[role])) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), value);
  }
  return {
    directory,
    manifest: await buildApplication(role, {
      root: directory,
      sourceCommit: commit
    })
  };
}

const operation = (kind = "e2e", role = "backend", unit = "worker") =>
  makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: kind,
    environment: "staging",
    role: kind === "e2e" ? null : role,
    unit: kind === "e2e" ? null : unit,
    backend_commit: "b".repeat(40),
    frontend_commit: "f".repeat(40)
  });

const runner = {
  repository: sandboxProfile.repositories.backend.full_name,
  run_id: 123,
  attempt: 1,
  commit: "b".repeat(40)
};
const successfulOutcomes = {
  backend: {
    build: "success",
    artifact: "success",
    digest: "a".repeat(64)
  },
  frontend: {
    build: "success",
    artifact: "success",
    digest: "c".repeat(64)
  }
};

test("locked sandbox builds produce exact role manifests", async () => {
  const manifestFiles = releaseBuildFiles.backend.map((file) => ({
    path: file,
    sha256: "a".repeat(64),
    bytes: 1
  }));
  const manifest = (bytes) =>
    makeReleaseBuild({
      role: "backend",
      source_commit: "b".repeat(40),
      files: manifestFiles.map((file, index) => ({
        ...file,
        bytes: index === 0 ? bytes : file.bytes
      }))
    });
  for (const bytes of [1, 99_999, 100_000])
    assert.equal(manifest(bytes).files[0].bytes, bytes);
  for (const bytes of [0, 100_001, Number.NaN, "1"])
    assert.throws(() => manifest(bytes), /Invalid sandbox application build/u);

  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    for (const [role, commit] of [
      ["backend", "b".repeat(40)],
      ["frontend", "f".repeat(40)]
    ]) {
      const built = await candidate(root, role, commit);
      assert.equal(built.manifest.role, role);
      assert.equal(
        (await verifyApplicationBuild(built.directory, role, commit))
          .fingerprint,
        built.manifest.fingerprint
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a changed build output cannot keep its saved manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    const built = await candidate(root, "backend", "b".repeat(40));
    await writeFile(path.join(built.directory, "dist", "worker.mjs"), "bad");
    await assert.rejects(
      verifyApplicationBuild(built.directory, "backend", "b".repeat(40)),
      /differs from its manifest/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a non-file build output names the invalid output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    const built = await candidate(root, "backend", "b".repeat(40));
    const output = path.join(built.directory, "dist", "worker.mjs");
    await rm(output);
    await mkdir(output);
    await assert.rejects(
      verifyApplicationBuild(built.directory, "backend", "b".repeat(40)),
      /not a file: worker\.mjs/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("E2E runs through the built backend and frontend HTTP boundary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    await candidate(root, "backend", "b".repeat(40));
    await candidate(root, "frontend", "f".repeat(40));
    const report = await runSandboxReleaseOperation(operation(), {
      root,
      runner,
      outcomes: successfulOutcomes,
      now: () => "2026-09-15T12:00:00.000Z"
    });
    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.checks.map(({ name, status }) => [name, status]),
      [
        ["build:backend", "passed"],
        ["artifact:backend", "passed"],
        ["build:frontend", "passed"],
        ["artifact:frontend", "passed"],
        ["matching-built-version-e2e", "passed"]
      ]
    );
    assert.equal(
      JSON.parse(
        await readFile(
          path.join(root, "candidates", "backend", "dist", "item.json")
        )
      ).version,
      1
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("database-changing candidate reaches the built-output E2E with its changed value", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    await candidate(root, "backend", "b".repeat(40), databaseCandidate());
    await candidate(root, "frontend", "f".repeat(40));
    const report = await runSandboxReleaseOperation(operation(), {
      root,
      runner,
      outcomes: successfulOutcomes,
      now: () => "2026-09-16T12:00:00.000Z"
    });
    assert.equal(report.status, "passed");
    assert.equal(report.checks.at(-1).name, "matching-built-version-e2e");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("database-changing API smoke uses the built worker output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    await candidate(root, "backend", "b".repeat(40), databaseCandidate());
    const report = await runSandboxReleaseOperation(
      operation("deploy", "backend", "api"),
      { root, runner, outcomes: successfulOutcomes }
    );
    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.checks.map(({ name, status }) => [name, status]),
      [
        ["build:backend", "passed"],
        ["artifact:backend", "passed"],
        ["backend:api", "passed"]
      ]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a frontend-only deployment check does not need a backend build", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    await candidate(root, "frontend", "f".repeat(40));
    const report = await runSandboxReleaseOperation(
      operation("deploy", "frontend", "frontend"),
      {
        root,
        runner: {
          ...runner,
          repository: sandboxProfile.repositories.frontend.full_name,
          commit: "f".repeat(40)
        },
        outcomes: successfulOutcomes
      }
    );
    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.checks.map((check) => check.name),
      ["build:frontend", "artifact:frontend", "frontend:frontend"]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built database values outside the supported fixture are rejected", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sandbox-build-"));
  try {
    const files = databaseCandidate();
    files.backend["src/data/change.json"] = JSON.stringify({
      id: "too-large",
      increment: 999,
      fail_after_schema: false
    });
    await candidate(root, "backend", "b".repeat(40), files);
    await candidate(root, "frontend", "f".repeat(40));
    const report = await runSandboxReleaseOperation(operation(), {
      root,
      runner,
      outcomes: successfulOutcomes
    });
    assert.equal(report.status, "failed");
    assert.match(report.checks.at(-1).message, /verified sample row/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a failed npm build produces a failed release result before E2E", async () => {
  const report = await runSandboxReleaseOperation(operation("deploy"), {
    runner,
    outcomes: { backend: { build: "failure" } },
    now: () => "2026-09-15T12:00:00.000Z"
  });
  assert.equal(report.status, "failed");
  assert.deepEqual(report.builds, {});
  assert.deepEqual(report.checks, [
    {
      name: "build:backend",
      status: "failed",
      message: "backend npm build failed."
    }
  ]);
});

test("required skipped and missing builds have distinct reports", async () => {
  const report = await runSandboxReleaseOperation(operation(), {
    runner,
    outcomes: {
      backend: { build: "skipped" },
      frontend: {}
    },
    now: () => "2026-09-15T12:00:00.000Z"
  });
  assert.equal(report.status, "failed");
  assert.deepEqual(report.checks, [
    {
      name: "build:backend",
      status: "failed",
      message: "backend npm build was skipped."
    },
    {
      name: "build:frontend",
      status: "failed",
      message: "frontend npm build has no reported outcome."
    }
  ]);
});

test("backend cleanup still runs when frontend cleanup fails", async () => {
  let backendClosed = false;
  await assert.rejects(
    closeServers(
      {
        close: async () => {
          throw new Error("frontend cleanup failed");
        }
      },
      {
        close: async () => {
          backendClosed = true;
        }
      }
    ),
    /frontend cleanup failed/u
  );
  assert.equal(backendClosed, true);
});
