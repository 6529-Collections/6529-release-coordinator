import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sandboxReleaseRuntime } from "../src/release-runtime-config.mjs";
import { releaseWorkflow } from "../sandbox/release-workflow.mjs";

// The sandbox repositories receive these files verbatim from this checkout, so
// each pinned bundle blob must equal the git blob of the local source. A stale
// pin would otherwise stop every sandbox release with a runtime mismatch.
const bundleSources = {
  "coordinator/src/release-contract.mjs": new URL(
    "../src/release-contract.mjs",
    import.meta.url
  ),
  "coordinator/sandbox/application-build.mjs": new URL(
    "../sandbox/application-build.mjs",
    import.meta.url
  ),
  "coordinator/sandbox/release-run.mjs": new URL(
    "../sandbox/release-run.mjs",
    import.meta.url
  )
};
const gitBlob = (bytes) =>
  createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");

test("pinned bundle blobs equal the local source files for both roles", async () => {
  for (const role of ["backend", "frontend"]) {
    const files = sandboxReleaseRuntime.repositories[role].files;
    assert.deepEqual(
      Object.keys(files).sort(),
      [
        ".github/workflows/sandbox-release.yml",
        ...Object.keys(bundleSources)
      ].sort()
    );
    for (const [path, url] of Object.entries(bundleSources))
      assert.equal(
        files[path],
        gitBlob(await readFile(url)),
        `${role} ${path}`
      );
    // The workflow is generated text, so its pin must equal the git blob of the
    // template the provisioning tool publishes.
    assert.equal(
      files[".github/workflows/sandbox-release.yml"],
      gitBlob(Buffer.from(releaseWorkflow, "utf8")),
      `${role} .github/workflows/sandbox-release.yml`
    );
  }
});
