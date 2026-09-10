// Developer-only source PR fixtures. Never creates a release or edits product repositories.
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  realpath
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { sampleFiles, databaseCandidate } from "./fixtures.mjs";
import { sandboxProfile } from "../src/profiles.mjs";
import { publishFixturePr } from "./fixture-pr.mjs";
if (process.argv[2] !== "--create-sample-prs" || process.argv.length !== 3)
  throw new Error(
    "Explicit --create-sample-prs required; creates only sandbox branches and PRs."
  );
const root = path.resolve(".release-coordinator/service-development");
await mkdir(root, { recursive: true });
const recordFile = path.join(root, "case-prs.json");
let record;
try {
  record = JSON.parse(await readFile(recordFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  record = {};
}
const baseline = sampleFiles(),
  upgrade = databaseCandidate();
const cases = {
  frontend: {
    role: "frontend",
    files: {
      "src/render.mjs":
        baseline.frontend["src/render.mjs"] +
        "// Sandbox integration candidate.\n"
    }
  },
  no: {
    role: "backend",
    files: {
      "src/worker.mjs":
        baseline.backend["src/worker.mjs"] +
        "// No release-specific database change.\n"
    }
  },
  yes: { role: "backend", files: upgrade.backend },
  schema: {
    role: "backend",
    files: {
      "src/entities/item.json": upgrade.backend["src/entities/item.json"],
      "src/worker.mjs": upgrade.backend["src/worker.mjs"]
    }
  },
  partial: {
    role: "backend",
    files: {
      "src/data/change.json":
        JSON.stringify(
          { id: "baseline", increment: 0, fail_after_schema: true },
          null,
          2
        ) + "\n"
    }
  },
  api: {
    role: "backend",
    files: {
      "src/api.mjs":
        "export function run({ row }) { if ('display_value' in row) throw new Error('Controlled incompatibility with schema 2'); return { id: row.id, value: row.value }; }\n"
    }
  }
};
for (const [name, value] of Object.entries(cases)) {
  if (record[name]?.url) {
    console.log(`${name}: already recorded ${record[name].url}`);
    continue;
  }
  const identity = sandboxProfile.repositories[value.role];
  const remote = JSON.parse(
    execFileSync("gh", ["api", `repos/${identity.full_name}`], {
      encoding: "utf8"
    })
  );
  if (
    remote.id !== identity.id ||
    remote.private !== false ||
    !remote.permissions?.push
  )
    throw new Error("Sandbox identity/access changed.");
  let entry = record[name];
  const branch = `codex/services-case-${name}`;
  if (
    entry &&
    (entry.role !== value.role ||
      entry.repository?.id !== identity.id ||
      entry.repository.full_name !== identity.full_name ||
      entry.branch !== branch ||
      !/^[0-9a-f]{40}$/u.test(entry.commit) ||
      typeof entry.directory !== "string" ||
      !path.resolve(entry.directory).startsWith(`${root}${path.sep}`))
  )
    throw new Error(
      "Saved fixture preparation does not match its sandbox case."
    );
  const directory =
    entry?.directory ?? (await mkdtemp(path.join(root, `case-${name}-`)));
  if (
    !(await realpath(directory)).startsWith(
      `${await realpath(root)}${path.sep}`
    )
  )
    throw new Error("Saved fixture checkout is outside its owned directory.");
  const git = (args) =>
    execFileSync(
      "git",
      ["-c", "commit.gpgSign=false", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd: directory, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  if (!entry) {
    git([
      "clone",
      "--single-branch",
      "--branch",
      "main",
      `git@github.com:${identity.full_name}.git`,
      "."
    ]);
    const base = git(["rev-parse", "HEAD"]);
    git(["checkout", "-b", branch]);
    for (const [file, text] of Object.entries(value.files))
      await writeFile(path.join(directory, file), text);
    git(["add", "--", ...Object.keys(value.files)]);
    git(["commit", "-m", `Add service acceptance fixture: ${name}`]);
    const commit = git(["rev-parse", "HEAD"]);
    entry = {
      role: value.role,
      repository: identity,
      branch,
      commit,
      base,
      directory
    };
  }
  if (
    git(["remote", "get-url", "origin"]) !==
      `git@github.com:${identity.full_name}.git` ||
    git(["rev-parse", "HEAD"]) !== entry.commit ||
    git(["branch", "--show-current"]) !== branch
  )
    throw new Error(
      "Saved fixture checkout moved; reconcile it before publishing."
    );
  const body = {
    head: branch,
    base: "main",
    title: `Service acceptance fixture: ${name}`,
    body: "Controlled sample for one-ticket service/database acceptance. Normal required application checks must pass before Coordinator execution. This PR is retained as test input; it is not a product release."
  };
  const completed = await publishFixturePr(entry, {
    save: async (value) => {
      record[name] = value;
      await writeFile(recordFile, JSON.stringify(record, null, 2) + "\n");
    },
    push: () => git(["push", "origin", branch]),
    find: () =>
      JSON.parse(
        execFileSync(
          "gh",
          [
            "api",
            `repos/${identity.full_name}/pulls?state=all&base=main&head=${encodeURIComponent(`${identity.full_name.split("/")[0]}:${branch}`)}&per_page=100`
          ],
          { encoding: "utf8" }
        )
      ),
    create: () =>
      JSON.parse(
        execFileSync(
          "gh",
          [
            "api",
            "--method",
            "POST",
            `repos/${identity.full_name}/pulls`,
            "--input",
            "-"
          ],
          { input: JSON.stringify(body), encoding: "utf8" }
        )
      )
  });
  console.log(`${name}: ${completed.url}`);
}
