import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkWithoutSourceChanges } from "../check.mjs";
import { validatePackageContents } from "../check-package.mjs";

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "coordinator-check-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", directory]);
  writeFileSync(
    path.join(directory, "source.mjs"),
    "export const value = 1;\n"
  );
  execFileSync("git", ["add", "source.mjs"], { cwd: directory });
  return directory;
}

test("check accepts pre-existing local changes and preserves check failures", (t) => {
  const directory = fixture(t);
  writeFileSync(
    path.join(directory, "source.mjs"),
    "export const value = 2;\n"
  );
  checkWithoutSourceChanges(directory, () => {});
  assert.throws(
    () =>
      checkWithoutSourceChanges(directory, () => {
        throw new Error("lint failed");
      }),
    /lint failed/u
  );
});

test("check rejects modified source and unexpected new source files", (t) => {
  const directory = fixture(t);
  assert.throws(
    () =>
      checkWithoutSourceChanges(directory, () =>
        writeFileSync(path.join(directory, "source.mjs"), "changed")
      ),
    /Checks changed source/u
  );
  assert.throws(
    () =>
      checkWithoutSourceChanges(directory, () =>
        writeFileSync(path.join(directory, "new.mjs"), "new")
      ),
    /Checks changed source/u
  );
});

const archive = {
  name: "@6529-collections/release-request",
  version: "0.0.4",
  filename: "6529-collections-release-request-0.0.4.tgz",
  integrity: "sha512-Zml4dHVyZQ==",
  files: [
    "LICENSE",
    "README.md",
    "package.json",
    "bin/6529-release-request.mjs",
    "release-request.example.json",
    "release-request.schema.json",
    "src/github-submission.mjs",
    "src/inbox-issue.mjs",
    "src/index.mjs"
  ].map((path) => ({ path }))
};
test("package contract rejects a missing schema, a leaked file, and wrong version", () => {
  validatePackageContents(archive, { version: "0.0.4" });
  assert.throws(() =>
    validatePackageContents(
      {
        ...archive,
        files: archive.files.filter((f) => !f.path.endsWith("schema.json"))
      },
      { version: "0.0.4" }
    )
  );
  assert.throws(() =>
    validatePackageContents(
      { ...archive, files: [...archive.files, { path: ".env" }] },
      { version: "0.0.4" }
    )
  );
  assert.throws(() => validatePackageContents(archive, { version: "0.0.5" }));
});
