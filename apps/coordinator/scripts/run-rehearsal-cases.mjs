// Live acceptance runner. Reads the pinned sandbox PRs; writes local evidence only.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runRehearsalCli } from "../src/rehearsal-cli.mjs";
import { sandboxRepositories, isSha, isBranch } from "../src/rehearsal-plan.mjs";

if (process.argv.length !== 4 || process.argv[2] !== "--seed") throw new Error("Usage: node apps/coordinator/scripts/run-rehearsal-cases.mjs --seed SEED_JSON");
const root = fileURLToPath(new URL("../../../", import.meta.url));
let seed;
try {
  seed = JSON.parse(await readFile(process.argv[3], "utf8"));
  assert.equal(seed.version, 1);
  for (const [role, identity] of Object.entries(sandboxRepositories)) {
    const repo = seed.repositories?.[role];
    assert.equal(repo?.id, identity.id); assert.equal(repo?.full_name, identity.full_name);
    assert.equal(repo?.private, identity.private);
    assert.ok(isSha(repo.base) && isSha(repo.target));
    const names = role === "frontend"
      ? ["clean-a", "clean-b", "conflict-a", "conflict-b", "ci-failure", "draft", "closed", "outdated"]
      : ["catalog-a", "catalog-b", "conflict-a", "conflict-b"];
    for (const name of names) {
      const pull = repo.pulls?.[name];
      assert.ok(Number.isSafeInteger(pull?.number) && pull.number > 0);
      assert.ok(isBranch(pull.branch) && isSha(pull.commit));
      assert.ok(pull.current_commit === undefined || isSha(pull.current_commit));
    }
  }
} catch {
  process.stderr.write("Invalid or incomplete sandbox seed. Verify or resume the recorded setup before running live acceptance.\n");
  process.exit(2);
}
const directory = path.join(root, ".release-coordinator", "live-rehearsal", new Date().toISOString().replace(/[:.]/gu, "-"));
await mkdir(directory, { recursive: true });
const exec = promisify(execFile);
async function snapshot() {
  const result = {};
  for (const [role, identity] of Object.entries(sandboxRepositories)) {
    assert.equal(seed.repositories[role].id, identity.id);
    assert.equal(seed.repositories[role].full_name, identity.full_name);
    const args = endpoint => ["api", "--hostname", "github.com", "--method", "GET", endpoint];
    const repo = JSON.parse((await exec("gh", args(`repos/${identity.full_name}`))).stdout);
    assert.equal(repo.id, identity.id); assert.equal(repo.private, identity.private);
    // Two fixture repositories have fewer than 100 refs/PRs. Refuse overflow.
    const branches = JSON.parse((await exec("gh", args(`repos/${identity.full_name}/branches?per_page=100`))).stdout);
    const pulls = JSON.parse((await exec("gh", args(`repos/${identity.full_name}/pulls?state=all&per_page=100`))).stdout);
    assert.ok(branches.length < 100 && pulls.length < 100);
    const protection = {};
    for (const branch of ["main", "rehearsal-target"]) {
      const rule = JSON.parse((await exec("gh", args(`repos/${identity.full_name}/branches/${branch}/protection`))).stdout);
      assert.equal(rule.enforce_admins?.enabled, true);
      assert.equal(rule.allow_force_pushes?.enabled, false); assert.equal(rule.allow_deletions?.enabled, false);
      assert.equal(rule.required_conversation_resolution?.enabled, true);
      assert.equal(rule.required_pull_request_reviews?.required_approving_review_count, 0);
      assert.deepEqual(rule.required_status_checks?.checks, [{ context: "Sandbox check", app_id: 15368 }]);
      protection[branch] = rule;
    }
    result[role] = {
      id: repo.id, private: repo.private, protection,
      branches: branches.map(b => ({ name: b.name, commit: b.commit.sha })).sort((a, b) => a.name.localeCompare(b.name)),
      pulls: pulls.map(p => ({ number: p.number, state: p.state, draft: p.draft, head: p.head.sha, base: p.base.sha,
        title: p.title, body: p.body, comments: p.comments, merged_at: p.merged_at })).sort((a, b) => a.number - b.number)
    };
  }
  return result;
}
const input = (caseId, parts) => ({ schema_version: "1", source: "test-manifest", profile: "sandbox", case_id: caseId, target: "staging",
  repositories: parts.map(({ role, names, alternate, ...rest }) => ({
    role, destination: { branch: alternate ? "rehearsal-target" : "main", commit: alternate ? seed.repositories[role].target : seed.repositories[role].base },
    pull_requests: names.map(name => { const { number, branch, commit } = seed.repositories[role].pulls[name]; return { number, branch, commit }; }),
    depends_on: [], ...(role === "backend" ? { deploy_units: ["api", "dbMigrationsLoop"], deploy_dependencies: [] } : {}), ...rest
  })) });
const frontend = names => ({ role: "frontend", names });
const backend = (names, units = ["api", "dbMigrationsLoop"]) => ({ role: "backend", names, deploy_units: units });
const cases = [
  ["MR-01", [frontend(["clean-a"])], "clean"],
  ["MR-02", [frontend(["clean-a", "clean-b"])], "clean"],
  ["MR-03", [{ ...frontend(["conflict-a"]), alternate: true }], "conflict"],
  ["MR-04-alone-a", [frontend(["conflict-a"])], "clean"],
  ["MR-04-alone-b", [frontend(["conflict-b"])], "clean"],
  ["MR-04", [frontend(["conflict-a", "conflict-b"])], "conflict"],
  ["MR-05", [{ ...frontend(["conflict-b"]), alternate: true }], "conflict"],
  ["MR-06", [backend(["catalog-a", "catalog-b"], ["api-v2", "dbMigrationsLoop"]), { ...frontend(["clean-a"]), depends_on: ["backend"] }], "clean"],
  ["MR-07", [backend(["conflict-a", "conflict-b"]), { ...frontend(["clean-a"]), depends_on: ["backend"] }], "conflict"],
  ["MR-11", [frontend(["ci-failure"])], "ci-failure"],
  ["MR-13-draft", [frontend(["draft"])], "inactive"],
  ["MR-13-closed", [frontend(["closed"])], "inactive"],
  ["MR-16", [backend(["catalog-a", "catalog-b"], ["api-v2", "dbMigrationsLoop"])], "clean"],
  ["MR-20", [frontend(["clean-a"])], "clean"]
];
if (seed.repositories.frontend.pulls.outdated.current_commit) cases.push(["MR-08", [frontend(["outdated"])], "outdated"]);
const evidence = { started_at: new Date().toISOString(), directory, cases: [], before: await snapshot() };
await writeFile(path.join(directory, "before.json"), JSON.stringify(evidence.before, null, 2));
for (const [caseId, parts, expected] of cases) {
  const filename = path.join(directory, `${caseId}.manifest.json`);
  await writeFile(filename, JSON.stringify(input(caseId, parts), null, 2));
  let output = "";
  const code = await runRehearsalCli(["--manifest", filename, "--json"], { env: { RELEASE_COORDINATOR_PROFILE: "sandbox" }, stdout: value => { output += value; } });
  const report = JSON.parse(output);
  await writeFile(path.join(directory, `${caseId}.result.json`), output);
  assert.equal(report.release_authorized, false);
  assert.ok(report.repositories, JSON.stringify(report.error));
  assert.deepEqual(report.operation_errors, [], `${caseId}: unexpected operational failure`);
  assert.ok(report.repositories.every(repo => repo.stability === "pass"), `${caseId}: observation changed; rerun only after facts settle`);
  const checks = report.repositories.flatMap(repo => repo.checks);
  const enforcementMissing = checks.some(c => c.id === "configured_required_check" && c.status !== "pass");
  if (expected === "clean") {
    assert.ok(report.repositories.every(repo => repo.final_tree), `${caseId}: expected every local merge to succeed`);
    assert.equal(enforcementMissing, false, `${caseId}: required check must be observable after public setup`);
    assert.equal(report.status, "pass");
  } else if (expected === "conflict") {
    assert.ok(report.repositories.some(repo => repo.merges.some(m => m.status === "blocked" && m.conflicts.length)));
    assert.equal(report.status, "blocked");
  } else if (expected === "inactive") {
    assert.ok(report.repositories.every(repo => repo.merges.length === 0)); assert.equal(report.status, "blocked");
  } else if (expected === "outdated") {
    assert.equal(checks.find(c => c.id === "requested_code").status, "blocked"); assert.equal(report.status, "blocked");
  } else {
    assert.ok(report.repositories[0].initial.pulls[0].checks.some(c => c.name === "Sandbox check" && c.conclusion === "FAILURE"));
    assert.equal(enforcementMissing, false, `${caseId}: failed check must be required by GitHub`);
    assert.equal(checks.find(c => c.id === "required_checks").status, "blocked");
    assert.equal(report.status, "blocked");
  }
  if (caseId === "MR-20") {
    const first = JSON.parse(await readFile(path.join(directory, "MR-01.result.json"), "utf8"));
    assert.equal(report.repositories[0].final_tree, first.repositories[0].final_tree);
    assert.equal(report.status, first.status);
  }
  const result = { case_id: caseId, expected, observed: report.status, exit_code: code,
    local_expectation: "pass", required_gate_coverage: enforcementMissing ? "not-observable-for-input" : "verified",
    run_id: report.run_id, revision: report.revision, report_file: report.report_file,
    trees: report.repositories.map(r => ({ role: r.role, tree: r.final_tree })) };
  evidence.cases.push(result);
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(evidence, null, 2));
  process.stdout.write(`${caseId}: ${report.status}; expectation passed${enforcementMissing ? "; required check not observable for this input" : ""}\n`);
}
evidence.after = await snapshot();
assert.deepEqual(evidence.after, evidence.before, "Rehearsal must leave sandbox branches and PR state unchanged.");
evidence.source_state_unchanged = true;
evidence.finished_at = new Date().toISOString();
await writeFile(path.join(directory, "summary.json"), JSON.stringify(evidence, null, 2));
process.stdout.write(`Evidence: ${path.join(directory, "summary.json")}\n`);
