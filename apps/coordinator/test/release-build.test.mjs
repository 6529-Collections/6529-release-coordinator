import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildApplication,
  verifyApplicationBuild
} from "../sandbox/application-build.mjs";
import { sampleFiles } from "../sandbox/fixtures.mjs";
import {
  closeServers,
  runSandboxReleaseOperation
} from "../sandbox/release-run.mjs";
import { makeReleaseOperation } from "../src/release-contract.mjs";
import { sandboxProfile } from "../src/profiles.mjs";

async function candidate(root, role, commit) {
  const directory = path.join(root, "candidates", role);
  await mkdir(directory, { recursive: true });
  for (const [name, value] of Object.entries(sampleFiles()[role])) {
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

const operation = (kind = "e2e") =>
  makeReleaseOperation({
    release_id: "11111111-1111-4111-8111-111111111111",
    operation_id: "22222222-2222-4222-8222-222222222222",
    operation: kind,
    environment: "staging",
    role: kind === "e2e" ? null : "backend",
    unit: kind === "e2e" ? null : "worker",
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
