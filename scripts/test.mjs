import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", ".release-coordinator"].includes(entry.name))
      continue;
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(location)));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs"))
      files.push(location);
  }
  return files;
}
const files = [];
for (const directory of ["apps", "packages", "scripts"]) {
  const tests = await collect(path.join(root, directory));
  assert.ok(tests.length > 0, `No tests found in ${directory}`);
  files.push(...tests);
}
console.log(
  `Running all ${files.length} test files across apps, packages and scripts.`
);
execFileSync(process.execPath, ["--test", ...files.sort()], {
  cwd: root,
  stdio: "inherit",
  timeout: 10 * 60 * 1000
});
