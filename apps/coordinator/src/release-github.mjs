import { executeGitHub } from "./coordinator-github.mjs";
import { createRehearsalGitHub } from "./rehearsal-github.mjs";
import { readServiceLogs } from "./service-github.mjs";
import { sandboxProfile } from "./profiles.mjs";
import { sandboxReleaseRuntime } from "./release-runtime-config.mjs";
import {
  releaseHash,
  validateReleaseOperation,
  verifyReleaseReport
} from "./release-contract.mjs";
import { serviceAssert, ServiceError } from "./service-contract.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value ?? ""
  );
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const runtimePaths = Object.freeze([
  ".github/workflows/sandbox-release.yml",
  "coordinator/src/release-contract.mjs",
  "coordinator/sandbox/release-run.mjs"
]);
const branch = (record) =>
  `codex/release-${record.release_id}-${record.step.environment}-${record.step.role}`;
const target = (runtime, environment) => runtime.branches[environment];

export function createReleaseGitHub({
  profile,
  runtime = sandboxReleaseRuntime,
  execute = executeGitHub,
  logs = readServiceLogs,
  gates = createRehearsalGitHub(sandboxProfile),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  polls = 60,
  pollMs = 10_000
} = {}) {
  serviceAssert(
    profile === sandboxProfile &&
      runtime.workflow === "sandbox-release.yml" &&
      runtime.branches?.staging === "1a-staging" &&
      runtime.branches?.prod === "main" &&
      ["backend", "frontend"].every((role) => {
        const files = runtime.repositories?.[role]?.files;
        return (
          files &&
          Object.keys(files).length === runtimePaths.length &&
          runtimePaths.every((path) => /^[0-9a-f]{40}$/u.test(files[path]))
        );
      }),
    "release-runtime",
    "The pinned sandbox release runtime is unavailable; real repositories are never a fallback."
  );
  async function call(role, method, suffix, body, allowed = [200]) {
    serviceAssert(
      ["backend", "frontend"].includes(role),
      "release-github",
      "Invalid sandbox release repository role."
    );
    const prefix = `repos/${profile.repositories[role].full_name}`;
    const args = [
      "api",
      "--hostname",
      "github.com",
      "--method",
      method,
      suffix === "user" ? "user" : `${prefix}${suffix}`,
      "--include",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2022-11-28"
    ];
    if (body !== undefined) args.push("--input", "-");
    const output = await execute(args, body);
    const match = output.match(
      /^HTTP\/\S+ (\d{3})[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/u
    );
    serviceAssert(
      match,
      "release-github",
      "GitHub returned no readable release response."
    );
    let data = null;
    try {
      if (match[2].trim()) data = JSON.parse(match[2]);
    } catch {
      throw new ServiceError(
        "release-github",
        "GitHub release response is unreadable."
      );
    }
    const status = Number(match[1]);
    serviceAssert(
      allowed.includes(status),
      "release-github",
      `Sandbox release GitHub operation returned HTTP ${status}.`
    );
    return { status, data };
  }
  async function ref(role, name, allowed = [200]) {
    return call(role, "GET", `/git/ref/heads/${name}`, undefined, allowed);
  }
  async function verifyRuntime(role, commit) {
    serviceAssert(
      sha(commit),
      "release-runtime",
      "The sandbox release runtime commit is invalid."
    );
    for (const path of runtimePaths) {
      const file = (await call(role, "GET", `/contents/${path}?ref=${commit}`))
        .data;
      serviceAssert(
        file?.type === "file" &&
          file.path === path &&
          file.sha === runtime.repositories[role].files[path],
        "release-runtime",
        "A pinned sandbox release runtime file changed."
      );
    }
  }
  async function deleteOwnedBranch(role, name, commit) {
    const current = await ref(role, name, [200, 404]);
    if (current.status === 200) {
      serviceAssert(
        current.data?.object?.sha === commit,
        "release-ownership",
        "The saved sandbox release branch moved; it was not deleted."
      );
      await call(role, "DELETE", `/git/refs/heads/${name}`, undefined, [204]);
    }
    let consecutiveMissing = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const observed = await ref(role, name, [200, 404]);
      if (observed.status === 404) {
        consecutiveMissing++;
        if (consecutiveMissing === 2) return;
      } else {
        consecutiveMissing = 0;
        serviceAssert(
          observed.data?.object?.sha === commit,
          "release-ownership",
          "The owned sandbox release branch changed during cleanup."
        );
      }
      if (attempt < 3) await wait(1000);
    }
    throw new ServiceError(
      "release-cleanup",
      "Sandbox release branch cleanup could not be verified twice."
    );
  }
  function verifyPull(pr, record, candidate, { allowMerged = false } = {}) {
    const repo = profile.repositories[record.step.role];
    serviceAssert(
      positive(pr?.number) &&
        (!record.number || pr.number === record.number) &&
        pr.head?.repo?.id === repo.id &&
        pr.base?.repo?.id === repo.id &&
        pr.head.ref === record.branch &&
        pr.head.sha === candidate.commit &&
        pr.base.ref === record.target_branch &&
        String(pr.user?.id) === record.actor.id &&
        pr.body === record.body &&
        (allowMerged
          ? pr.merged === true
          : pr.state === "open" && pr.merged === false),
      "release-ownership",
      "Sandbox integration PR identity or exact code changed."
    );
    return pr;
  }
  async function findPull(role, record) {
    const head = encodeURIComponent(`6529-Collections:${record.branch}`);
    const list = (
      await call(role, "GET", `/pulls?state=all&head=${head}&per_page=100`)
    ).data;
    serviceAssert(
      Array.isArray(list) && list.length <= 1,
      "release-ownership",
      "Sandbox integration PR identity is ambiguous."
    );
    return list[0] ?? null;
  }
  async function waitForPull(role, record, candidate) {
    for (let poll = 0; poll < polls; poll++) {
      const observed = await gates.pullRequest(role, record.number);
      serviceAssert(
        observed.headRefOid === candidate.commit &&
          observed.headRefName === record.branch &&
          observed.baseRefOid === record.base &&
          observed.baseRefName === record.target_branch &&
          observed.state === "OPEN",
        "release-ownership",
        "Sandbox integration PR changed while checks ran."
      );
      const required = observed.checks.filter((check) => check.isRequired);
      serviceAssert(
        required.some((check) => check.name === "Sandbox check"),
        "release-checks",
        "The protected sandbox branch no longer requires Sandbox check."
      );
      const pending = required.some((check) =>
        check.__typename === "CheckRun"
          ? check.status !== "COMPLETED"
          : check.state === "PENDING"
      );
      if (!pending) {
        const passed =
          observed.mergeable === "MERGEABLE" &&
          required.every((check) =>
            check.__typename === "CheckRun"
              ? check.conclusion === "SUCCESS"
              : check.state === "SUCCESS"
          );
        return { passed, observed };
      }
      if (poll + 1 < polls) await wait(pollMs);
    }
    throw new ServiceError(
      "release-checks-pending",
      "Sandbox integration checks are still pending; resume the saved release."
    );
  }
  const runTitle = (id) => `Sandbox release ${id}`;
  function verifyRun(run, record, workflowId) {
    const operation = validateReleaseOperation(record.operation);
    const role = operation.operation === "e2e" ? "backend" : operation.role;
    const expectedCommit = operation[`${role}_commit`];
    const repo = profile.repositories[role];
    serviceAssert(
      positive(run?.id) &&
        run.repository?.id === repo.id &&
        run.head_repository?.id === repo.id &&
        run.head_sha === expectedCommit &&
        run.head_branch === target(runtime, operation.environment) &&
        run.event === "workflow_dispatch" &&
        positive(run.run_attempt) &&
        run.path === `.github/workflows/${runtime.workflow}` &&
        run.display_title === runTitle(record.id) &&
        String(run.actor?.id) === record.actor.id &&
        run.workflow_id === workflowId,
      "release-workflow",
      "Sandbox release workflow identity, exact commit or actor does not match."
    );
    return { role, run };
  }
  async function findRun(role, record, workflowId) {
    const created = new Date(Date.parse(record.created_at) - 5 * 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/u, "Z");
    const operation = record.operation;
    const filters = new URLSearchParams({
      event: "workflow_dispatch",
      branch: target(runtime, operation.environment),
      created: `>=${created}`,
      per_page: "100"
    });
    const list = (
      await call(
        role,
        "GET",
        `/actions/workflows/${runtime.workflow}/runs?${filters}&page=1`
      )
    ).data;
    serviceAssert(
      Number.isSafeInteger(list.total_count) &&
        list.total_count <= 100 &&
        list.workflow_runs?.length === list.total_count,
      "release-workflow",
      "Sandbox release workflow history is incomplete."
    );
    const matches = list.workflow_runs.filter(
      (run) =>
        run.display_title === runTitle(record.id) &&
        String(run.actor?.id) === record.actor.id
    );
    serviceAssert(
      matches.length <= 1,
      "release-workflow",
      "More than one workflow claims the saved release operation."
    );
    if (!matches.length) return null;
    return verifyRun(matches[0], record, workflowId).run;
  }
  return {
    async identity() {
      const actor = (await call("backend", "GET", "user")).data;
      serviceAssert(
        positive(actor?.id) && /^[A-Za-z0-9-]+(?:\[bot\])?$/u.test(actor.login),
        "release-runtime",
        "The sandbox release actor is invalid."
      );
      const workflows = {};
      const versions = { staging: {}, prod: {} };
      for (const role of ["backend", "frontend"]) {
        const expected = profile.repositories[role];
        const repo = (await call(role, "GET", "")).data;
        const workflow = (
          await call(role, "GET", `/actions/workflows/${runtime.workflow}`)
        ).data;
        serviceAssert(
          repo.id === expected.id &&
            repo.full_name === expected.full_name &&
            repo.private === false &&
            repo.permissions?.push === true &&
            workflow.path === `.github/workflows/${runtime.workflow}` &&
            workflow.state === "active" &&
            positive(workflow.id),
          "release-runtime",
          "Sandbox release repository, access or pinned workflow changed."
        );
        workflows[role] = { workflow_id: workflow.id };
        for (const environment of ["staging", "prod"]) {
          const commit = (await ref(role, target(runtime, environment))).data
            .object.sha;
          versions[environment][role] = commit;
          await verifyRuntime(role, commit);
        }
      }
      return {
        actor: { id: String(actor.id), login: actor.login },
        runtime: workflows,
        versions
      };
    },
    async integrate({ record, candidate, actor, expectedBase, save }) {
      const role = record.step.role;
      serviceAssert(
        record.step.kind === "integrate" &&
          candidate.role === role &&
          sha(candidate.commit) &&
          sha(candidate.tree) &&
          sha(expectedBase) &&
          uuid(record.release_id) &&
          actor?.id,
        "release-input",
        "Invalid sandbox integration input."
      );
      const targetBranch = target(runtime, record.step.environment);
      if (!candidate.changed) {
        const current = await ref(role, targetBranch);
        serviceAssert(
          current.data?.object?.sha === expectedBase,
          "release-stale",
          `Sandbox ${record.step.environment} changed after the release started.`
        );
        return {
          status: "passed",
          kind: "unchanged",
          commit: current.data.object.sha,
          url: null
        };
      }
      record.actor ??= actor;
      record.target_branch ??= targetBranch;
      record.branch ??= branch(record);
      record.body ??= `Sandbox release ${record.release_id}\n\nBatch: ${candidate.tree}`;
      if (!record.base) {
        record.base = (await ref(role, targetBranch)).data.object.sha;
        serviceAssert(
          record.base === expectedBase &&
            (record.step.environment !== "prod" ||
              record.base === candidate.base),
          "release-stale",
          `Sandbox ${record.step.environment} changed after this release captured its starting version.`
        );
        record.state = "branch-prepared";
        await save();
      } else if (!["merging", "merged"].includes(record.state)) {
        serviceAssert(
          (await ref(role, targetBranch)).data.object.sha === record.base,
          "release-stale",
          `Sandbox ${record.step.environment} changed before integration.`
        );
      }
      let current = await ref(role, record.branch, [200, 404]);
      if (current.status === 404) {
        await call(
          role,
          "POST",
          "/git/refs",
          { ref: `refs/heads/${record.branch}`, sha: candidate.commit },
          [201, 422]
        );
        current = await ref(role, record.branch);
      }
      serviceAssert(
        current.data?.object?.sha === candidate.commit,
        "release-ownership",
        "Sandbox release branch does not name the exact selected candidate."
      );
      let pr;
      if (record.number)
        pr = (await call(role, "GET", `/pulls/${record.number}`)).data;
      else {
        const existing = await findPull(role, record);
        if (existing)
          pr = (await call(role, "GET", `/pulls/${existing.number}`)).data;
        else {
          serviceAssert(
            record.state !== "creating-pr",
            "release-pr-uncertain",
            "A prior integration PR creation has no confirmed result."
          );
          record.state = "creating-pr";
          await save();
          pr = (
            await call(
              role,
              "POST",
              "/pulls",
              {
                title: `Sandbox ${record.step.environment} release ${record.release_id}`,
                head: record.branch,
                base: targetBranch,
                body: record.body
              },
              [201]
            )
          ).data;
        }
        record.number = pr.number;
        record.url = pr.html_url;
        record.state = "checking";
        await save();
      }
      if (pr.merged) {
        verifyPull(pr, record, candidate, { allowMerged: true });
      } else {
        verifyPull(pr, record, candidate);
        const checked = await waitForPull(role, record, candidate);
        if (!checked.passed) {
          await call(role, "PATCH", `/pulls/${record.number}`, {
            state: "closed"
          });
          await deleteOwnedBranch(role, record.branch, candidate.commit);
          record.cleanup = "removed";
          return {
            status: "failed",
            kind: "checks",
            commit: null,
            url: record.url,
            message: "The sandbox integration PR checks failed."
          };
        }
        pr = (await call(role, "GET", `/pulls/${record.number}`)).data;
        verifyPull(pr, record, candidate);
        serviceAssert(
          sha(pr.merge_commit_sha),
          "release-checks",
          "GitHub did not expose the exact checked integration commit."
        );
        const testMerge = (
          await call(role, "GET", `/git/commits/${pr.merge_commit_sha}`)
        ).data;
        serviceAssert(
          sha(testMerge.tree?.sha),
          "release-checks",
          "The exact checked integration tree is unavailable."
        );
        record.checked_tree = testMerge.tree.sha;
        record.state = "merging";
        await save();
        await call(
          role,
          "PUT",
          `/pulls/${record.number}/merge`,
          {
            commit_title: `Sandbox ${record.step.environment} release ${record.release_id}`,
            commit_message: `Exact selected candidate ${candidate.commit}`,
            sha: candidate.commit,
            merge_method: "merge"
          },
          [200, 405, 409]
        );
        pr = (await call(role, "GET", `/pulls/${record.number}`)).data;
        verifyPull(pr, record, candidate, { allowMerged: true });
      }
      const merged = (
        await call(role, "GET", `/git/commits/${pr.merge_commit_sha}`)
      ).data;
      const destination = await ref(role, targetBranch);
      serviceAssert(
        destination.data?.object?.sha === pr.merge_commit_sha &&
          merged.tree?.sha === record.checked_tree &&
          merged.parents?.some((parent) => parent.sha === record.base) &&
          merged.parents?.some((parent) => parent.sha === candidate.commit),
        "release-merge",
        "The sandbox environment does not contain the exact checked merge."
      );
      record.state = "merged";
      await save();
      await deleteOwnedBranch(role, record.branch, candidate.commit);
      record.cleanup = "removed";
      await save();
      return {
        status: "passed",
        kind: "merge",
        commit: pr.merge_commit_sha,
        tree: merged.tree.sha,
        url: record.url
      };
    },
    async run({ record, actor, save }) {
      const operation = validateReleaseOperation(record.operation);
      const role = operation.operation === "e2e" ? "backend" : operation.role;
      const workflowId = record.workflow_id ?? record.runtime?.workflow_id;
      serviceAssert(
        record.actor?.id === actor.id && positive(workflowId),
        "release-state",
        "Release operation lacks saved actor or workflow identity."
      );
      await verifyRuntime(role, operation[`${role}_commit`]);
      let run = record.workflow_run_id
        ? (await call(role, "GET", `/actions/runs/${record.workflow_run_id}`))
            .data
        : await findRun(role, record, workflowId);
      if (!run && record.state !== "running") {
        serviceAssert(
          record.state !== "dispatching",
          "release-dispatch-uncertain",
          "A prior release dispatch has no confirmed workflow run."
        );
        record.state = "dispatching";
        await save();
        await call(
          role,
          "POST",
          `/actions/workflows/${runtime.workflow}/dispatches`,
          {
            ref: target(runtime, operation.environment),
            inputs: {
              operation_id: operation.operation_id,
              operation_json: JSON.stringify(operation)
            }
          },
          [204]
        );
        record.state = "running";
        await save();
      }
      for (let poll = 0; poll < polls; poll++) {
        run ??= await findRun(role, record, workflowId);
        if (run) {
          verifyRun(run, record, workflowId);
          record.workflow_run_id = run.id;
          record.workflow_id = workflowId;
          if (record.state !== "running") {
            record.state = "running";
            await save();
          }
          if (run.status === "completed") break;
        }
        if (poll + 1 < polls) await wait(pollMs);
        if (record.workflow_run_id)
          run = (
            await call(role, "GET", `/actions/runs/${record.workflow_run_id}`)
          ).data;
      }
      serviceAssert(
        run?.status === "completed" &&
          ["success", "failure"].includes(run.conclusion),
        "release-workflow",
        "Sandbox release workflow is pending or ended without usable evidence."
      );
      const jobs = (
        await call(
          role,
          "GET",
          `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
        )
      ).data;
      serviceAssert(
        jobs.total_count === 1 && jobs.jobs?.length === 1,
        "release-workflow",
        "Sandbox release job set is incomplete."
      );
      const job = jobs.jobs[0];
      const step = job.steps?.find((value) => value.name === runtime.step);
      serviceAssert(
        job.name === runtime.job &&
          job.run_id === run.id &&
          job.head_sha === run.head_sha &&
          job.status === "completed" &&
          step?.status === "completed" &&
          ["success", "failure"].includes(step.conclusion),
        "release-workflow",
        "The trusted sandbox release step did not run."
      );
      const output = await logs(
        `repos/${profile.repositories[role].full_name}/actions/jobs/${job.id}/logs`
      );
      const reports = output.split("\n").flatMap((line) => {
        const marker = "COORDINATOR_RELEASE_RESULT:";
        const start = line.indexOf(marker);
        if (start < 0) return [];
        try {
          return [
            JSON.parse(
              Buffer.from(
                line.slice(start + marker.length).trim(),
                "base64url"
              ).toString("utf8")
            )
          ];
        } catch {
          return [];
        }
      });
      serviceAssert(
        reports.length === 1,
        "release-workflow",
        "Sandbox release produced no unique result."
      );
      const report = verifyReleaseReport(reports[0], operation);
      serviceAssert(
        report.runner.repository === profile.repositories[role].full_name &&
          Number(report.runner.run_id) === run.id &&
          report.runner.attempt === run.run_attempt &&
          report.runner.commit === run.head_sha &&
          ((report.status === "passed" &&
            run.conclusion === "success" &&
            job.conclusion === "success" &&
            step.conclusion === "success") ||
            (report.status === "failed" &&
              run.conclusion === "failure" &&
              step.conclusion === "failure")),
        "release-workflow",
        "Sandbox release conclusion contradicts its exact report."
      );
      return {
        status: report.status,
        report_hash: releaseHash(report),
        report,
        workflow: { id: run.id, url: run.html_url }
      };
    }
  };
}
