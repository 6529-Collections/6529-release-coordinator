import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function sourceSnapshot(cwd) {
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd, encoding: "utf8" }
  );
  return [...new Set(files.split("\0").filter(Boolean))].sort().map((file) => {
    try {
      const stat = lstatSync(path.join(cwd, file));
      assert.ok(stat.isFile(), `Expected a regular source file: ${file}`);
      return [
        file,
        stat.mode,
        createHash("sha256")
          .update(readFileSync(path.join(cwd, file)))
          .digest("hex")
      ];
    } catch (error) {
      if (error.code === "ENOENT") return [file, "missing"];
      throw error;
    }
  });
}

export function checkWithoutSourceChanges(cwd, check) {
  const before = sourceSnapshot(cwd);
  try {
    check();
  } finally {
    assert.deepEqual(
      sourceSnapshot(cwd),
      before,
      "Checks changed source files. Use separate fix commands and review the changes."
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  assert.ok(
    process.env.npm_execpath,
    "Run this command through npm run check."
  );
  checkWithoutSourceChanges(root, () => {
    for (const script of [
      "lint",
      "format:check",
      "test",
      "check:workflows",
      "check:package"
    ]) {
      execFileSync(
        process.execPath,
        [process.env.npm_execpath, "run", "--ignore-scripts", script],
        {
          cwd: root,
          stdio: "inherit",
          timeout: 10 * 60 * 1000
        }
      );
    }
  });
  console.log("All repository checks passed; source files are unchanged.");
}
