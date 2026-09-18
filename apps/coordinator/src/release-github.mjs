import { setTimeout as delay } from "node:timers/promises";
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
import { effectiveRequiredChecks } from "./github-checks.mjs";
import { integrationCommitInput } from "./release-plan.mjs";
import { activeWorkflowRunStatuses } from "./release-state.mjs";
import { runEvent } from "./run-log.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value ?? ""
  );
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const runtimePaths = Object.freeze([
  ".github/workflows/sandbox-release.yml",
  "coordinator/src/release-contract.mjs",
  "coordinator/sandbox/application-build.mjs",
  "coordinator/sandbox/release-run.mjs"
]);
const branch = (record) =>
  `codex/release-${record.release_id}-${record.step.environment}-${record.step.role}${record.step.recovery ? "-restore" : ""}`;
const target = (runtime, environment) => runtime.branches[environment];

export function createReleaseGitHub({
  profile,
  runtime = sandboxReleaseRuntime,
  execute = executeGitHub,
  logs = readServiceLogs,
  gates = createRehearsalGitHub(sandboxProfile),
  signal,
  wait = (ms, options) => delay(ms, undefined, options),
  now = () => new Date(),
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
      if (attempt < 3) await wait(1000, { signal });
    }
    throw new ServiceError(
      "release-cleanup",
      "Sandbox release branch cleanup could not be verified twice."
    );
  }
  function verifyPull(
    pr,
    record,
    candidate,
    { allowClosed = false, allowMerged = false } = {}
  ) {
    const repo = profile.repositories[record.step.role];
    const codeRabbitStart =
      "\n\n<!-- This is an auto-generated comment: release notes by coderabbit.ai -->\n\n";
    const codeRabbitEnd =
      "\n\n<!-- end of auto-generated comment: release notes by coderabbit.ai -->";
    const bodyMatches =
      pr?.body === record.body ||
      (pr?.body?.startsWith(`${record.body}${codeRabbitStart}`) &&
        pr.body.endsWith(codeRabbitEnd));
    serviceAssert(
      positive(pr?.number) &&
        (!record.number || pr.number === record.number) &&
        pr.head?.repo?.id === repo.id &&
        pr.base?.repo?.id === repo.id &&
        pr.head.ref === record.branch &&
        pr.head.sha === (record.integration_commit ?? candidate.commit) &&
        pr.base.ref === record.target_branch &&
        String(pr.user?.id) === record.actor.id &&
        bodyMatches &&
        (allowMerged
          ? pr.merged === true
          : ["open", ...(allowClosed ? ["closed"] : [])].includes(pr.state) &&
            pr.merged === false),
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
        observed.headRefOid ===
          (record.integration_commit ?? candidate.commit) &&
          observed.headRefName === record.branch &&
          observed.baseRefOid === record.base &&
          observed.baseRefName === record.target_branch &&
          observed.state === "OPEN",
        "release-ownership",
        "Sandbox integration PR changed while checks ran."
      );
      const required = effectiveRequiredChecks(
        observed.checks,
        record.integration_commit ?? candidate.commit
      );
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
      if (poll + 1 < polls) await wait(pollMs, { signal });
    }
    throw new ServiceError(
      "release-checks-pending",
      "Sandbox integration checks are still pending; resume the saved release."
    );
  }
  async function cleanupFailedPull(role, record, candidate, save) {
    serviceAssert(
      record.state === "cleaning" && positive(record.number),
      "release-state",
      "Failed integration cleanup has no saved PR identity."
    );
    let pr = (await call(role, "GET", `/pulls/${record.number}`)).data;
    verifyPull(pr, record, candidate, { allowClosed: true });
    if (pr.state === "open") {
      pr = (
        await call(role, "PATCH", `/pulls/${record.number}`, {
          state: "closed"
        })
      ).data;
      verifyPull(pr, record, candidate, { allowClosed: true });
    }
    serviceAssert(
      pr.state === "closed" && pr.merged === false,
      "release-cleanup",
      "The failed sandbox integration PR is not closed."
    );
    await deleteOwnedBranch(
      role,
      record.branch,
      record.integration_commit ?? candidate.commit
    );
    record.cleanup = "removed";
    await save();
    return {
      status: "failed",
      kind: "checks",
      commit: null,
      url: record.url,
      message: "The sandbox integration PR checks failed."
    };
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
    const perPage = 100;
    const maxPages = 10;
    const created = new Date(Date.parse(record.created_at) - 5 * 60_000)
      .toISOString()
      .replace(/\.\d{3}Z$/u, "Z");
    const observedThrough = new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    const operation = record.operation;
    const filters = new URLSearchParams({
      event: "workflow_dispatch",
      branch: target(runtime, operation.environment),
      created: `${created}..${observedThrough}`,
      per_page: String(perPage)
    });
    const runs = [];
    let total;
    for (let page = 1; page <= maxPages; page++) {
      const list = (
        await call(
          role,
          "GET",
          `/actions/workflows/${runtime.workflow}/runs?${filters}&page=${page}`
        )
      ).data;
      serviceAssert(
        Number.isSafeInteger(list.total_count) &&
          list.total_count >= 0 &&
          Array.isArray(list.workflow_runs) &&
          list.workflow_runs.length <= perPage &&
          (total === undefined || list.total_count === total),
        "release-workflow",
        "Sandbox release workflow history changed or is unreadable."
      );
      total ??= list.total_count;
      runs.push(...list.workflow_runs);
      if (runs.length >= total) break;
    }
    serviceAssert(
      total <= perPage * maxPages &&
        runs.length === total &&
        new Set(runs.map(({ id }) => id)).size === runs.length,
      "release-workflow",
      "Sandbox release workflow history exceeds the bounded search or is incomplete."
    );
    const matches = runs.filter(
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
  async function activeWorkflowRuns(role) {
    const active = new Map();
    for (const status of activeWorkflowRunStatuses) {
      const list = (
        await call(
          role,
          "GET",
          `/actions/workflows/${runtime.workflow}/runs?status=${status}&per_page=100`
        )
      ).data;
      serviceAssert(
        Number.isSafeInteger(list?.total_count) &&
          list.total_count >= 0 &&
          Array.isArray(list.workflow_runs) &&
          list.workflow_runs.length <= list.total_count,
        "release-workflow",
        "Active sandbox release workflow runs are unreadable."
      );
      for (const run of list.workflow_runs)
        if (positive(run?.id) && run.status !== "completed")
          active.set(run.id, {
            id: run.id,
            url: run.html_url,
            status: run.status,
            actor: run.actor?.login ?? null
          });
    }
    return [...active.values()];
  }
  // GitHub keeps one running and one waiting run per concurrency group and
  // cancels the waiting run when a third arrives, so a Coordinator run must
  // never queue behind someone else's deploy. Before each merge and dispatch,
  // wait until the pinned release workflow has no active run in the repository
  // about to change, then continue. There is deliberately no time limit: the
  // operator chose to wait as long as it takes (2026-09-18, docs/design.md).
  // Every check is logged; the blocking runs are saved on the step record when
  // first seen, and Ctrl-C stops the wait before anything is pressed.
  async function waitForQuietWorkflow(role, record, save, purpose) {
    for (let checks = 1; ; checks++) {
      signal?.throwIfAborted();
      const active = await activeWorkflowRuns(role);
      if (!active.length) {
        if (record.waited_for) {
          record.waited_for.checks = checks;
          record.waited_for.quiet_at = now().toISOString();
        }
        return;
      }
      const known = new Set(
        (record.waited_for?.runs ?? []).map((run) => run.id)
      );
      const fresh = active.filter((run) => !known.has(run.id));
      if (!record.waited_for) {
        record.waited_for = {
          purpose,
          first_seen_at: now().toISOString(),
          runs: fresh
        };
        await save();
      } else if (fresh.length) {
        record.waited_for.runs.push(...fresh);
        await save();
      }
      const [first] = active;
      runEvent({
        step: "release.wait",
        outcome: "waiting",
        role,
        url: first.url,
        workflow_run_id: first.id,
        workflow_run_status: first.status,
        checks,
        message: `Waiting for ${active.length} active ${runtime.workflow} run${active.length === 1 ? "" : "s"} before ${purpose}; run ${first.id} by ${first.actor ?? "an unknown actor"} is ${first.status}.`
      });
      await wait(pollMs, { signal });
    }
  }
  const digestOf = (value) => String(value ?? "").replace(/^sha256:/u, "");
  // Independent readback of the sample "installed" monitoring: GitHub's own
  // artifact record for the run must hold the exact template build the
  // verified report says it installed. The real adapter needs the equivalent
  // read of the deployed monitoring target.
  async function verifyInstalledMonitoring(role, run, report) {
    const expected = report.builds.monitoring.artifact;
    const list = (
      await call(role, "GET", `/actions/runs/${run.id}/artifacts?per_page=100`)
    ).data;
    serviceAssert(
      Number.isSafeInteger(list?.total_count) &&
        list.total_count <= 100 &&
        Array.isArray(list.artifacts) &&
        list.artifacts.length === list.total_count,
      "release-monitoring",
      "The sample monitoring artifact list is unreadable or incomplete."
    );
    const matches = list.artifacts.filter(
      (artifact) => artifact?.name === expected.name
    );
    serviceAssert(
      matches.length === 1,
      "release-monitoring",
      "GitHub holds no unique artifact for the installed sample monitoring."
    );
    const [artifact] = matches;
    serviceAssert(
      positive(artifact.id) &&
        artifact.expired === false &&
        artifact.workflow_run?.id === run.id &&
        /^[0-9a-f]{64}$/u.test(digestOf(artifact.digest)) &&
        digestOf(artifact.digest) === digestOf(expected.digest),
      "release-monitoring",
      "The installed sample monitoring artifact does not match the verified report."
    );
    return {
      ...report.installed,
      artifact: {
        id: artifact.id,
        name: artifact.name,
        digest: digestOf(artifact.digest)
      }
    };
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
      const startingState = record.state;
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
      record.body ??= record.step.recovery
        ? `Sandbox restoration for failed release ${record.release_id}\n\nRestore ${record.step.environment} tree ${candidate.tree}`
        : `Sandbox release ${record.release_id}\n\nBatch: ${candidate.tree}`;
      if (!record.base) {
        record.base = (await ref(role, targetBranch)).data.object.sha;
        serviceAssert(
          record.base === expectedBase &&
            (record.step.environment !== "prod" ||
              record.base === candidate.base),
          "release-stale",
          `Sandbox ${record.step.environment} changed after this release captured its starting version.`
        );
        await save();
      } else if (!["cleaning", "merging", "merged"].includes(record.state)) {
        serviceAssert(
          (await ref(role, targetBranch)).data.object.sha === record.base,
          "release-stale",
          `Sandbox ${record.step.environment} changed before integration.`
        );
      }
      if (record.state === "cleaning")
        return cleanupFailedPull(role, record, candidate, save);
      const legacyIntegration =
        !record.integration_version &&
        [
          "branch-prepared",
          "creating-pr",
          "checking",
          "merging",
          "merged"
        ].includes(startingState);
      serviceAssert(
        !legacyIntegration,
        "release-recovery",
        "This unfinished release predates unique integration commits and needs manual recovery."
      );
      const commitInput = integrationCommitInput(record, candidate);
      if (!record.integration_version) {
        record.integration_version = 1;
        record.integration_input = commitInput;
        record.state = "commit-prepared";
        await save();
      }
      serviceAssert(
        record.integration_version === 1 &&
          JSON.stringify(record.integration_input) ===
            JSON.stringify(commitInput),
        "release-state",
        "Sandbox integration commit input changed."
      );
      const created = (
        await call(
          role,
          "POST",
          "/git/commits",
          record.integration_input,
          [201]
        )
      ).data;
      serviceAssert(
        sha(created?.sha) &&
          created.tree?.sha === candidate.tree &&
          created.parents?.length === 1 &&
          created.parents[0].sha === candidate.commit,
        "release-ownership",
        "GitHub did not create the exact sandbox integration commit."
      );
      if (record.integration_commit)
        serviceAssert(
          record.integration_commit === created.sha,
          "release-ownership",
          "Sandbox integration commit changed across retries."
        );
      else {
        record.integration_commit = created.sha;
        record.state = "branch-prepared";
        await save();
      }
      const observedCommit = (
        await call(role, "GET", `/git/commits/${record.integration_commit}`)
      ).data;
      serviceAssert(
        observedCommit?.sha === record.integration_commit &&
          observedCommit.tree?.sha === candidate.tree &&
          observedCommit.parents?.length === 1 &&
          observedCommit.parents[0].sha === candidate.commit,
        "release-ownership",
        "Sandbox integration commit no longer contains the exact candidate tree."
      );
      const integrationCommit = record.integration_commit;
      const resumedMerged = record.state === "merged";
      if (resumedMerged)
        await deleteOwnedBranch(role, record.branch, integrationCommit);
      else {
        let current = await ref(role, record.branch, [200, 404]);
        if (current.status === 404) {
          await call(
            role,
            "POST",
            "/git/refs",
            { ref: `refs/heads/${record.branch}`, sha: integrationCommit },
            [201, 422]
          );
          current = await ref(role, record.branch);
        }
        serviceAssert(
          current.data?.object?.sha === integrationCommit,
          "release-ownership",
          "Sandbox release branch does not name the exact integration commit."
        );
      }
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
                title: record.step.recovery
                  ? `Restore sandbox ${record.step.environment} after ${record.release_id}`
                  : `Sandbox ${record.step.environment} release ${record.release_id}`,
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
          record.state = "cleaning";
          await save();
          return cleanupFailedPull(role, record, candidate, save);
        }
        await waitForQuietWorkflow(role, record, save, "merge");
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
            commit_title: record.step.recovery
              ? `Restore sandbox ${record.step.environment} after ${record.release_id}`
              : `Sandbox ${record.step.environment} release ${record.release_id}`,
            commit_message: record.step.recovery
              ? `Restore ${record.step.environment} tree ${candidate.tree}`
              : `Exact selected candidate ${candidate.commit}`,
            sha: integrationCommit,
            merge_method: "merge"
          },
          [200, 405, 409]
        );
        pr = (await call(role, "GET", `/pulls/${record.number}`)).data;
        verifyPull(pr, record, candidate, { allowMerged: true });
      }
      serviceAssert(
        sha(pr.merge_commit_sha),
        "release-checks",
        "GitHub did not expose the exact checked integration commit."
      );
      const merged = (
        await call(role, "GET", `/git/commits/${pr.merge_commit_sha}`)
      ).data;
      const destination = await ref(role, targetBranch);
      serviceAssert(
        destination.data?.object?.sha === pr.merge_commit_sha &&
          merged.tree?.sha === record.checked_tree &&
          merged.parents?.some((parent) => parent.sha === record.base) &&
          merged.parents?.some((parent) => parent.sha === integrationCommit),
        "release-merge",
        "The sandbox environment does not contain the exact checked merge."
      );
      record.state = "merged";
      await save();
      if (!resumedMerged)
        await deleteOwnedBranch(role, record.branch, integrationCommit);
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
    async restore({ record, restoreTo, expectedBase, actor, save }) {
      serviceAssert(
        record.step.recovery === true &&
          record.step.kind === "integrate" &&
          ["staging", "prod"].includes(record.step.environment) &&
          sha(restoreTo) &&
          sha(expectedBase),
        "release-recovery",
        "Invalid sandbox restoration target."
      );
      const role = record.step.role;
      const environment = record.step.environment;
      serviceAssert(
        (!record.branch || record.branch === branch(record)) &&
          (!record.target_branch ||
            record.target_branch === target(runtime, environment)),
        "release-ownership",
        "Restoration branch or destination changed."
      );
      await verifyRuntime(role, restoreTo);
      const old = (await call(role, "GET", `/git/commits/${restoreTo}`)).data;
      serviceAssert(
        old?.sha === restoreTo && sha(old.tree?.sha),
        "release-recovery",
        "The saved restoration source cannot be verified."
      );
      serviceAssert(
        (!record.restore_to || record.restore_to === restoreTo) &&
          (!record.restore_tree || record.restore_tree === old.tree.sha),
        "release-recovery",
        "The saved restoration target changed."
      );
      if (!record.restore_to || !record.restore_tree) {
        record.restore_to = restoreTo;
        record.restore_tree = old.tree.sha;
        await save();
      }
      const result = await this.integrate({
        record,
        candidate: {
          role,
          base: expectedBase,
          commit: expectedBase,
          tree: record.restore_tree,
          changed: true
        },
        actor,
        expectedBase,
        save
      });
      serviceAssert(
        result.status !== "passed" || result.tree === record.restore_tree,
        "release-recovery",
        "Restored sandbox branch does not match its saved source tree."
      );
      return result;
    },
    async verifyRestoredEnvironments({ versions, trees }) {
      const observed = {
        prod: {},
        staging: {},
        trees: { prod: {}, staging: {} }
      };
      for (const role of ["backend", "frontend"])
        for (const environment of ["prod", "staging"]) {
          const expected = versions?.[environment]?.[role];
          const expectedTree = trees?.[environment]?.[role];
          serviceAssert(
            sha(expected) && (!expectedTree || sha(expectedTree)),
            "release-recovery",
            "Restoration verification lacks exact environment versions."
          );
          observed[environment][role] = (
            await ref(role, target(runtime, environment))
          ).data.object.sha;
          serviceAssert(
            observed[environment][role] === expected,
            "release-recovery-moved",
            "Sandbox environment moved before restoration was confirmed."
          );
          const commit = (await call(role, "GET", `/git/commits/${expected}`))
            .data;
          serviceAssert(
            commit?.sha === expected &&
              sha(commit.tree?.sha) &&
              (!expectedTree || commit.tree.sha === expectedTree),
            "release-recovery-moved",
            "Restored sandbox tree differs from the saved source."
          );
          observed.trees[environment][role] = commit.tree.sha;
        }
      return observed;
    },
    async verifyRestoredStaging({ versions, trees, prodVersions }) {
      const observed = { staging: {}, prod: {}, trees: {} };
      for (const role of ["backend", "frontend"]) {
        serviceAssert(
          sha(versions?.[role]) &&
            sha(prodVersions?.[role]) &&
            (!trees?.[role] || sha(trees[role])),
          "release-recovery",
          "Restoration verification lacks exact source versions."
        );
        observed.staging[role] = (
          await ref(role, target(runtime, "staging"))
        ).data.object.sha;
        observed.prod[role] = (
          await ref(role, target(runtime, "prod"))
        ).data.object.sha;
        serviceAssert(
          observed.staging[role] === versions[role] &&
            observed.prod[role] === prodVersions[role],
          "release-recovery-moved",
          "Sandbox staging or test main moved before restoration was confirmed."
        );
        const commit = (
          await call(role, "GET", `/git/commits/${versions[role]}`)
        ).data;
        serviceAssert(
          commit?.sha === versions[role] &&
            sha(commit.tree?.sha) &&
            (!trees?.[role] || commit.tree.sha === trees[role]),
          "release-recovery-moved",
          "Restored staging tree differs from the saved source."
        );
        observed.trees[role] = commit.tree.sha;
      }
      return observed;
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
      const verifyPinnedRefs = async (stage) => {
        for (const sourceRole of ["backend", "frontend"]) {
          const current = (
            await ref(sourceRole, target(runtime, operation.environment))
          ).data.object.sha;
          serviceAssert(
            current === operation[`${sourceRole}_commit`],
            "release-stale",
            `Sandbox ${operation.environment} changed before workflow ${stage}.`
          );
        }
      };
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
        await waitForQuietWorkflow(role, record, save, "dispatch");
        await verifyPinnedRefs("dispatch");
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
          const identityChanged =
            record.workflow_run_id !== run.id ||
            record.workflow_id !== workflowId;
          record.workflow_run_id = run.id;
          record.workflow_id = workflowId;
          const stateChanged = record.state !== "running";
          if (record.state !== "running") {
            record.state = "running";
          }
          if (identityChanged || stateChanged) await save();
          if (run.status === "completed") break;
        }
        if (poll + 1 < polls) await wait(pollMs, { signal });
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
      await verifyPinnedRefs("result acceptance");
      const installed =
        operation.operation === "monitoring" && report.status === "passed"
          ? await verifyInstalledMonitoring(role, run, report)
          : null;
      return {
        status: report.status,
        report_hash: releaseHash(report),
        report,
        workflow: { id: run.id, url: run.html_url },
        ...(installed ? { installed } : {})
      };
    }
  };
}
