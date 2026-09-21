import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { verifyApplicationBuild } from "../sandbox/application-build.mjs";
import { executeGitHub } from "./coordinator-github.mjs";
import {
  monitoringTemplate,
  releaseHash,
  validateReleaseOperation
} from "./release-contract.mjs";
import { createReleaseGitHub } from "./release-github.mjs";
import {
  productWorkflowAdapter,
  productWorkflowRuntime
} from "./product-workflow-runtime-config.mjs";
import {
  productWorkflowReleaseAdapter,
  verifyProductWorkflowReport
} from "./product-workflow-contract.mjs";
import {
  githubEnvironment,
  runRehearsalProcess
} from "./rehearsal-process.mjs";
import { activeWorkflowRunStatuses } from "./release-state.mjs";
import { runEvent } from "./run-log.mjs";
import { sandboxProfile } from "./profiles.mjs";
import { serviceAssert, ServiceError } from "./service-contract.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const digestOf = (value) => String(value ?? "").replace(/^sha256:/u, "");
const branch = (runtime, environment) => runtime.branches[environment];

async function downloadProductArtifact(
  { repository, runId, name, role, sourceCommit, evidence },
  process = runRehearsalProcess
) {
  const root = await mkdtemp(path.join(tmpdir(), "6529-product-workflow-"));
  try {
    await process(
      "gh",
      [
        "run",
        "download",
        String(runId),
        "--repo",
        repository,
        "--name",
        name,
        "--dir",
        root
      ],
      {
        env: githubEnvironment(),
        timeout: 60_000,
        maxOutput: 1024 * 1024
      }
    );
    serviceAssert(
      (await readdir(root)).sort().join("\0") ===
        ["deployment-evidence.json", "dist"].join("\0"),
      "release-evidence",
      "The product-shaped deployment artifact has unexpected files."
    );
    // Hash the same immutable downloaded file whose parsed contents are
    // validated by verifyApplicationBuild below.
    const manifestText = await readFile(
      path.join(root, "dist", "build-manifest.json")
    );
    const manifest = await verifyApplicationBuild(root, role, sourceCommit);
    const observed = JSON.parse(
      await readFile(path.join(root, "deployment-evidence.json"), "utf8")
    );
    const expected = {
      contract: "fake-deployment-evidence-v1",
      ...evidence,
      build_manifest_sha256: createHash("sha256")
        .update(manifestText)
        .digest("hex")
    };
    serviceAssert(
      isDeepStrictEqual(observed, expected),
      "release-evidence",
      "The product-shaped deployment evidence does not match its exact run."
    );
    return { manifest, evidence: observed };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function expectedJobs(descriptor) {
  if (descriptor.kind === "dispatch")
    return [
      `Dispatch successful ${descriptor.environment === "staging" ? "staging" : "production"} deployment`
    ];
  if (descriptor.kind === "backend")
    return [`Build and deploy ${descriptor.unit} to ${descriptor.environment}`];
  if (descriptor.kind === "monitoring") return ["monitoring"];
  if (descriptor.kind === "frontend" && descriptor.environment === "staging")
    return ["Build exact staging artifact", "Deploy exact staging artifact"];
  if (descriptor.kind === "frontend")
    return [
      "Verify expected source commit",
      "Build exact production artifact",
      "Deploy verified production artifact"
    ];
  if (descriptor.kind === "e2e" && descriptor.environment === "staging")
    return ["Staging E2E packs"];
  return ["Production read-only E2E packs"];
}

function artifactName(descriptor, runId) {
  if (descriptor.kind === "backend")
    return `fake-backend-${descriptor.environment}-${descriptor.unit}-${runId}`;
  if (descriptor.kind === "monitoring")
    return `fake-monitoring-${descriptor.environment}-${runId}`;
  return `fake-${descriptor.environment === "prod" ? "production" : "staging"}-deployment-${runId}`;
}

function directDescriptor(operation, sourceChanged, runtime) {
  if (operation.operation === "monitoring")
    return {
      kind: "monitoring",
      role: "backend",
      buildRole: "monitoring",
      environment: operation.monitoring_environment,
      sourceEnvironment: "prod",
      sourceCommit: operation.backend_commit,
      workflowKey: "monitoring",
      workflow: "deploy-operational-monitoring.yml",
      event: "workflow_dispatch",
      title: "Deploy operational monitoring",
      ref: "main",
      unit: null,
      inputs: {
        environment: operation.monitoring_environment,
        commit_sha: operation.backend_commit
      }
    };
  if (operation.role === "backend")
    return {
      kind: "backend",
      role: "backend",
      buildRole: "backend",
      environment: operation.environment,
      sourceEnvironment: operation.environment,
      sourceCommit: operation.backend_commit,
      workflowKey: "deploy",
      workflow: "deploy.yml",
      event: "workflow_dispatch",
      title: `Deploy ${runtime.repositories.backend.deployUnits[operation.unit]} to ${operation.environment}`,
      ref: operation.environment === "staging" ? "1a-staging" : "main",
      unit: runtime.repositories.backend.deployUnits[operation.unit],
      inputs: {
        environment: operation.environment,
        service: runtime.repositories.backend.deployUnits[operation.unit],
        expected_source_sha: operation.backend_commit
      }
    };
  const staging = operation.environment === "staging";
  return {
    kind: "frontend",
    role: "frontend",
    buildRole: "frontend",
    environment: operation.environment,
    sourceEnvironment: operation.environment,
    sourceCommit: operation.frontend_commit,
    workflowKey: staging ? "stagingDeploy" : "prodDeploy",
    workflow: staging ? "deploy-staging.yml" : "build-upload-deploy-prod.yml",
    event: staging && sourceChanged ? "push" : "workflow_dispatch",
    title: staging ? null : `Production deploy ${operation.frontend_commit}`,
    ref: staging ? "1a-staging" : "main",
    unit: null,
    inputs: staging
      ? {}
      : {
          expected_source_sha: operation.frontend_commit,
          release_note_opt_out: false
        }
  };
}

function integrationChanged(record, operations) {
  const id = `${record.step.id.startsWith("restore:") ? "restore:" : ""}${record.step.environment}:integrate:frontend`;
  const integration = operations?.[id];
  serviceAssert(
    integration?.result?.status === "passed" &&
      ["merge", "unchanged"].includes(integration.result.kind),
    "release-state",
    "The frontend workflow lacks its saved integration result."
  );
  return integration.result.kind === "merge";
}

function deploymentDependencies(record, operations, steps) {
  const index = steps.findIndex((step) => step.id === record.step.id);
  serviceAssert(
    index >= 0,
    "release-state",
    "The E2E step is not in its plan."
  );
  const prior = steps.slice(0, index).flatMap((step) => {
    const saved = operations?.[step.id];
    return saved?.result?.status === "passed" ? [{ step, saved }] : [];
  });
  const frontend = prior
    .filter(
      ({ step }) =>
        step.kind === "deploy" &&
        step.role === "frontend" &&
        step.environment === record.step.environment
    )
    .at(-1)?.saved;
  const backend = prior
    .filter(
      ({ step }) =>
        step.kind === "deploy" &&
        step.role === "backend" &&
        step.environment === record.step.environment
    )
    .at(-1)?.saved;
  serviceAssert(
    frontend?.result?.report && backend?.result?.report,
    "release-state",
    "Matching backend and frontend deployments are required before E2E."
  );
  for (const saved of [backend, frontend])
    verifyProductWorkflowReport(saved.result.report, saved.operation);
  return { backend, frontend };
}

export function createProductWorkflowReleaseGitHub({
  profile,
  runtime = productWorkflowRuntime,
  execute = executeGitHub,
  base,
  process = runRehearsalProcess,
  download = (input) => downloadProductArtifact(input, process),
  signal,
  wait = (ms, options) => delay(ms, undefined, options),
  now = () => new Date(),
  polls = 60,
  pollMs = 10_000
} = {}) {
  serviceAssert(
    profile === sandboxProfile &&
      runtime.adapter === productWorkflowAdapter &&
      runtime.adapter === productWorkflowReleaseAdapter &&
      runtime.branches?.staging === "1a-staging" &&
      runtime.branches?.prod === "main" &&
      ["dbMigrationsLoop", "worker", "api"].every((unit) =>
        /^[A-Za-z][A-Za-z0-9]{0,80}$/u.test(
          runtime.repositories?.backend?.deployUnits?.[unit] ?? ""
        )
      ) &&
      ["backend", "frontend"].every((role) => {
        const repository = runtime.repositories?.[role];
        return (
          repository?.files &&
          Object.values(repository.files).every(sha) &&
          repository.workflows &&
          Object.values(repository.workflows).every(
            (workflow) =>
              /^[a-z0-9-]+\.yml$/u.test(workflow.file) &&
              typeof workflow.name === "string"
          )
        );
      }),
    "release-runtime",
    "The product-shaped sandbox runtime is unavailable; real repositories are never a fallback."
  );
  base ??= createReleaseGitHub({
    profile,
    execute,
    signal,
    wait,
    now,
    polls,
    pollMs
  });

  async function call(role, method, suffix, body, allowed = [200]) {
    serviceAssert(
      ["backend", "frontend"].includes(role),
      "release-github",
      "Invalid product-shaped sandbox repository role."
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
      "GitHub returned no readable product-shaped release response."
    );
    let data = null;
    try {
      if (match[2].trim()) data = JSON.parse(match[2]);
    } catch {
      throw new ServiceError(
        "release-github",
        "GitHub product-shaped release response is unreadable."
      );
    }
    const status = Number(match[1]);
    serviceAssert(
      allowed.includes(status),
      "release-github",
      `Product-shaped sandbox GitHub operation returned HTTP ${status}.`
    );
    return { status, data };
  }

  const ref = async (role, name) =>
    (await call(role, "GET", `/git/ref/heads/${name}`)).data.object.sha;

  async function verifyFiles(role, commit) {
    serviceAssert(sha(commit), "release-runtime", "Invalid runtime commit.");
    for (const [file, expected] of Object.entries(
      runtime.repositories[role].files
    )) {
      const observed = (
        await call(role, "GET", `/contents/${file}?ref=${commit}`)
      ).data;
      serviceAssert(
        observed?.type === "file" &&
          observed.path === file &&
          observed.sha === expected,
        "release-runtime",
        "A pinned product-shaped sandbox workflow or evidence file changed."
      );
    }
  }

  const workflow = (role, key, savedRuntime) => {
    const configured = runtime.repositories[role].workflows[key];
    const workflowId = savedRuntime?.[role]?.workflows?.[key]?.workflow_id;
    serviceAssert(
      configured && positive(workflowId),
      "release-state",
      "The product-shaped workflow identity is missing from the journal."
    );
    return { ...configured, id: workflowId };
  };

  const runSummary = (run) => ({
    id: run.id,
    url: run.html_url,
    status: run.status,
    actor: run.actor?.login ?? null
  });

  async function activeRuns(role, files) {
    const active = new Map();
    let counted = 0;
    for (const file of files) {
      const recent = (
        await call(role, "GET", `/actions/workflows/${file}/runs?per_page=100`)
      ).data;
      serviceAssert(
        Number.isSafeInteger(recent?.total_count) &&
          recent.total_count >= 0 &&
          Array.isArray(recent.workflow_runs),
        "release-workflow",
        "Product-shaped workflow runs are unreadable."
      );
      for (const run of recent.workflow_runs)
        if (positive(run?.id) && run.status !== "completed")
          active.set(run.id, runSummary(run));
      for (const status of activeWorkflowRunStatuses) {
        const list = (
          await call(
            role,
            "GET",
            `/actions/workflows/${file}/runs?status=${status}&per_page=100`
          )
        ).data;
        serviceAssert(
          Number.isSafeInteger(list?.total_count) &&
            list.total_count >= 0 &&
            Array.isArray(list.workflow_runs),
          "release-workflow",
          "Active product-shaped workflow runs are unreadable."
        );
        counted += list.total_count;
        for (const run of list.workflow_runs)
          if (positive(run?.id) && run.status !== "completed")
            active.set(run.id, runSummary(run));
      }
    }
    const runs = [...active.values()];
    return { runs, unlisted: Math.max(0, counted - runs.length) };
  }

  async function waitForQuiet(role, files, record, save, purpose) {
    for (let checks = 1; ; checks++) {
      signal?.throwIfAborted();
      const { runs, unlisted } = await activeRuns(role, files);
      if (!runs.length && !unlisted) {
        if (record.waited_for) {
          record.waited_for.checks = checks;
          record.waited_for.quiet_at = now().toISOString();
        }
        return;
      }
      const known = new Map(
        (record.waited_for?.runs ?? []).map((run) => [run.id, run])
      );
      const fresh = runs.filter((run) => !known.has(run.id));
      for (const run of runs)
        if (known.has(run.id)) known.get(run.id).status = run.status;
      if (!record.waited_for) {
        record.waited_for = {
          purpose,
          first_seen_at: now().toISOString(),
          runs: fresh,
          unlisted
        };
        await save();
      } else {
        const highest = Math.max(record.waited_for.unlisted ?? 0, unlisted);
        const raised = highest !== (record.waited_for.unlisted ?? 0);
        record.waited_for.unlisted = highest;
        if (fresh.length) record.waited_for.runs.push(...fresh);
        if (fresh.length || raised) await save();
      }
      const [first] = runs;
      runEvent({
        step: "release.wait",
        outcome: "waiting",
        role,
        ...(first
          ? {
              url: first.url,
              workflow_run_id: first.id,
              workflow_run_status: first.status
            }
          : {}),
        checks,
        message: first
          ? `Waiting for ${runs.length} active product-shaped workflow run${runs.length === 1 ? "" : "s"} before ${purpose}; run ${first.id} is ${first.status}.`
          : `Waiting before ${purpose}: GitHub counts ${unlisted} active product-shaped workflow run${unlisted === 1 ? "" : "s"} that its listing does not show yet.`
      });
      await wait(pollMs, { signal });
    }
  }

  async function listRuns(role, file, query = {}) {
    const filters = new URLSearchParams({ ...query, per_page: "100" });
    const runs = [];
    let total;
    for (let page = 1; page <= 10; page++) {
      const list = (
        await call(
          role,
          "GET",
          `/actions/workflows/${file}/runs?${filters}&page=${page}`
        )
      ).data;
      serviceAssert(
        Number.isSafeInteger(list?.total_count) &&
          list.total_count >= 0 &&
          list.total_count <= 1000 &&
          Array.isArray(list.workflow_runs) &&
          (total === undefined || total === list.total_count),
        "release-workflow",
        "Product-shaped workflow history is incomplete or unreadable."
      );
      total ??= list.total_count;
      runs.push(...list.workflow_runs);
      if (runs.length >= total) break;
    }
    serviceAssert(
      runs.length === total &&
        new Set(runs.map(({ id }) => id)).size === runs.length,
      "release-workflow",
      "Product-shaped workflow history exceeds the bounded search or changed while it was read."
    );
    return runs;
  }

  async function verifyEnvironment(operation, stage) {
    for (const role of ["backend", "frontend"])
      serviceAssert(
        (await ref(role, branch(runtime, operation.environment))) ===
          operation[`${role}_commit`],
        "release-stale",
        `Sandbox ${operation.environment} changed before product-shaped workflow ${stage}.`
      );
  }

  function verifyDirectRun(run, descriptor, workflowIdentity, actor, record) {
    const repository = profile.repositories[descriptor.role];
    serviceAssert(
      positive(run?.id) &&
        run.repository?.id === repository.id &&
        run.head_repository?.id === repository.id &&
        run.head_sha === descriptor.sourceCommit &&
        run.head_branch === descriptor.ref &&
        run.event === descriptor.event &&
        positive(run.run_attempt) &&
        run.path === `.github/workflows/${descriptor.workflow}` &&
        (descriptor.event === "push" ||
          Date.parse(run.created_at) >= Date.parse(record.created_at)) &&
        (!descriptor.title || run.display_title === descriptor.title) &&
        String(run.actor?.id) === actor.id &&
        run.workflow_id === workflowIdentity.id &&
        (!record.dispatch_after_run_id ||
          run.id > record.dispatch_after_run_id),
      "release-workflow",
      "Product-shaped workflow identity, source, actor or dispatch boundary does not match."
    );
    return run;
  }

  async function findDirectRun(descriptor, workflowIdentity, actor, record) {
    const runs = await listRuns(descriptor.role, descriptor.workflow, {
      event: descriptor.event,
      branch: descriptor.ref
    });
    const matches = runs.filter(
      (run) =>
        run.head_sha === descriptor.sourceCommit &&
        (descriptor.event === "push" ||
          Date.parse(run.created_at) >= Date.parse(record.created_at)) &&
        (!descriptor.title || run.display_title === descriptor.title) &&
        String(run.actor?.id) === actor.id &&
        (!record.dispatch_after_run_id || run.id > record.dispatch_after_run_id)
    );
    serviceAssert(
      matches.length <= 1,
      "release-workflow",
      "More than one workflow claims the saved product-shaped release operation."
    );
    return matches.length
      ? verifyDirectRun(matches[0], descriptor, workflowIdentity, actor, record)
      : null;
  }

  async function jobsFor(role, run, descriptor) {
    const list = (
      await call(
        role,
        "GET",
        `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
      )
    ).data;
    const expected = expectedJobs(descriptor);
    serviceAssert(
      list.total_count === expected.length &&
        list.jobs?.length === expected.length &&
        list.jobs.every(
          (job) =>
            expected.includes(job.name) &&
            job.run_id === run.id &&
            job.head_sha === run.head_sha &&
            job.status === "completed"
        ) &&
        new Set(list.jobs.map((job) => job.name)).size === expected.length,
      "release-workflow",
      "The product-shaped workflow job set is incomplete or changed."
    );
    return list.jobs;
  }

  async function readDeploymentArtifact(run, descriptor) {
    const name = artifactName(descriptor, run.id);
    const list = (
      await call(
        descriptor.role,
        "GET",
        `/actions/runs/${run.id}/artifacts?per_page=100`
      )
    ).data;
    serviceAssert(
      Number.isSafeInteger(list?.total_count) &&
        list.total_count <= 100 &&
        Array.isArray(list.artifacts) &&
        list.artifacts.length === list.total_count,
      "release-evidence",
      "The product-shaped deployment artifact list is unreadable."
    );
    const matches = list.artifacts.filter(
      (artifact) => artifact?.name === name
    );
    serviceAssert(
      matches.length === 1,
      "release-evidence",
      "GitHub holds no unique product-shaped deployment artifact."
    );
    const [artifact] = matches;
    const digest = digestOf(artifact.digest);
    serviceAssert(
      positive(artifact.id) &&
        artifact.expired === false &&
        artifact.workflow_run?.id === run.id &&
        /^[0-9a-f]{64}$/u.test(digest),
      "release-evidence",
      "The product-shaped deployment artifact identity is invalid."
    );
    const repository = profile.repositories[descriptor.role].full_name;
    const evidence = {
      role: descriptor.buildRole,
      environment: descriptor.environment,
      source_sha: descriptor.sourceCommit,
      workflow_run_id: String(run.id),
      workflow_path: `.github/workflows/${descriptor.workflow}`,
      unit: descriptor.unit
    };
    const value = await download({
      repository,
      runId: run.id,
      name,
      role: descriptor.buildRole,
      sourceCommit: descriptor.sourceCommit,
      evidence
    });
    return {
      build: {
        manifest: value.manifest,
        artifact: { id: artifact.id, name, digest }
      },
      deployment: {
        role: descriptor.buildRole,
        environment: descriptor.environment,
        source_commit: descriptor.sourceCommit,
        unit: descriptor.unit,
        workflow: `.github/workflows/${descriptor.workflow}`,
        repository,
        run_id: run.id,
        artifact: { id: artifact.id, name, digest }
      }
    };
  }

  function reportFor({
    operation,
    run,
    status,
    builds = {},
    deployments = {}
  }) {
    return {
      protocol: operation.protocol,
      profile: "sandbox",
      adapter: productWorkflowReleaseAdapter,
      release_id: operation.release_id,
      operation_id: operation.operation_id,
      operation_hash: operation.fingerprint,
      operation: operation.operation,
      environment: operation.environment,
      role: operation.role,
      unit: operation.unit,
      status,
      checks: [
        {
          name: "product-shaped-workflow",
          status
        }
      ],
      builds,
      deployments,
      versions: {
        backend: operation.backend_commit,
        frontend: operation.frontend_commit
      },
      runner: {
        repository: run.repository.full_name,
        run_id: run.id,
        attempt: run.run_attempt,
        commit: run.head_sha,
        workflow: run.path
      },
      completed_at: run.updated_at
    };
  }

  async function runDirect({
    record,
    operation,
    actor,
    savedRuntime,
    operations,
    save
  }) {
    const sourceChanged =
      operation.role === "frontend" && operation.environment === "staging"
        ? integrationChanged(record, operations)
        : false;
    const descriptor = directDescriptor(operation, sourceChanged, runtime);
    const workflowIdentity = workflow(
      descriptor.role,
      descriptor.workflowKey,
      savedRuntime
    );
    if (
      descriptor.event === "workflow_dispatch" &&
      ["dispatching", "running"].includes(record.state)
    )
      serviceAssert(
        Number.isSafeInteger(record.dispatch_after_run_id) &&
          record.dispatch_after_run_id >= 0,
        "release-dispatch-uncertain",
        "A resumed product-shaped dispatch lacks its saved workflow boundary."
      );
    await verifyFiles(descriptor.role, descriptor.sourceCommit);
    let run = record.workflow_run_id
      ? (
          await call(
            descriptor.role,
            "GET",
            `/actions/runs/${record.workflow_run_id}`
          )
        ).data
      : ["dispatching", "running"].includes(record.state)
        ? await findDirectRun(descriptor, workflowIdentity, actor, record)
        : null;
    if (
      run &&
      descriptor.event === "workflow_dispatch" &&
      Date.parse(run.created_at) < Date.parse(record.created_at)
    ) {
      delete record.workflow_run_id;
      delete record.workflow_id;
      record.state = "prepared";
      await save();
      run = null;
    }
    const automaticPush = descriptor.event === "push";
    if (!run && !automaticPush && record.state !== "running") {
      serviceAssert(
        record.state !== "dispatching",
        "release-dispatch-uncertain",
        "A prior product-shaped dispatch has no confirmed workflow run."
      );
      await waitForQuiet(
        descriptor.role,
        [descriptor.workflow],
        record,
        save,
        "dispatch"
      );
      await verifyEnvironment(operation, "dispatch");
      const recent = await listRuns(descriptor.role, descriptor.workflow);
      record.dispatch_after_run_id = Math.max(0, ...recent.map(({ id }) => id));
      record.state = "dispatching";
      await save();
      await call(
        descriptor.role,
        "POST",
        `/actions/workflows/${descriptor.workflow}/dispatches`,
        { ref: descriptor.ref, inputs: descriptor.inputs },
        [204]
      );
      record.state = "running";
      await save();
    }
    for (let poll = 0; poll < polls; poll++) {
      run ??= await findDirectRun(descriptor, workflowIdentity, actor, record);
      if (run) {
        verifyDirectRun(run, descriptor, workflowIdentity, actor, record);
        const changed =
          record.workflow_run_id !== run.id ||
          record.workflow_id !== workflowIdentity.id ||
          record.state !== "running";
        record.workflow_run_id = run.id;
        record.workflow_id = workflowIdentity.id;
        record.state = "running";
        if (changed) await save();
        if (run.status === "completed") break;
      }
      if (poll + 1 < polls) await wait(pollMs, { signal });
      if (record.workflow_run_id)
        run = (
          await call(
            descriptor.role,
            "GET",
            `/actions/runs/${record.workflow_run_id}`
          )
        ).data;
    }
    serviceAssert(
      run?.status === "completed" &&
        ["success", "failure"].includes(run.conclusion),
      "release-workflow",
      "The product-shaped workflow is pending or ended without usable evidence."
    );
    verifyDirectRun(run, descriptor, workflowIdentity, actor, record);
    const jobs = await jobsFor(descriptor.role, run, descriptor);
    const passed = run.conclusion === "success";
    serviceAssert(
      passed
        ? jobs.every((job) => job.conclusion === "success")
        : jobs.some((job) => job.conclusion === "failure"),
      "release-workflow",
      "The product-shaped run conclusion contradicts its jobs."
    );
    await verifyEnvironment(operation, "result acceptance");
    let builds = {},
      deployments = {},
      installed;
    if (passed) {
      const evidence = await readDeploymentArtifact(run, descriptor);
      builds = { [descriptor.buildRole]: evidence.build };
      deployments = { [descriptor.buildRole]: evidence.deployment };
      if (descriptor.kind === "monitoring") {
        const template = monitoringTemplate(descriptor.environment);
        const templateFile = evidence.build.manifest.files.find(
          (file) => file.path === template
        );
        serviceAssert(
          templateFile,
          "release-evidence",
          "The product-shaped monitoring build is missing its installed template."
        );
        installed = {
          environment: descriptor.environment,
          source_commit: operation.backend_commit,
          template,
          sha256: templateFile.sha256
        };
      }
    }
    const report = reportFor({
      operation,
      run,
      status: passed ? "passed" : "failed",
      builds,
      deployments
    });
    if (installed) report.installed = installed;
    verifyProductWorkflowReport(report, operation);
    return {
      status: report.status,
      report_hash: releaseHash(report),
      report,
      workflow: { id: run.id, url: run.html_url },
      ...(installed
        ? {
            installed: {
              ...installed,
              artifact: deployments.monitoring.artifact
            }
          }
        : {})
    };
  }

  async function findAutomaticRun(role, workflowIdentity, title, event) {
    const runs = await listRuns(role, workflowIdentity.file, { event });
    const matches = runs.filter(
      (run) =>
        run.display_title === title && run.workflow_id === workflowIdentity.id
    );
    serviceAssert(
      matches.length <= 1,
      "release-workflow",
      "Automatic product-shaped workflow identity is ambiguous."
    );
    return matches[0] ?? null;
  }

  async function runE2e({
    record,
    operation,
    actor,
    savedRuntime,
    operations,
    steps,
    save
  }) {
    const dependencies = deploymentDependencies(record, operations, steps);
    const deployRunId = dependencies.frontend.result.workflow?.id;
    serviceAssert(
      positive(deployRunId),
      "release-state",
      "The matching frontend deployment run is missing before E2E."
    );
    const staging = operation.environment === "staging";
    const dispatch = workflow(
      "frontend",
      staging ? "stagingDispatch" : "prodDispatch",
      savedRuntime
    );
    const e2e = workflow(
      "frontend",
      staging ? "stagingE2e" : "prodE2e",
      savedRuntime
    );
    const dispatchTitle = `${staging ? "Staging" : "Production"} E2E dispatch [${deployRunId}]`;
    const e2eTitle = `${staging ? "Staging" : "Production"} E2E automatic ${deployRunId}`;
    let e2eRun = record.workflow_run_id
      ? (
          await call(
            "frontend",
            "GET",
            `/actions/runs/${record.workflow_run_id}`
          )
        ).data
      : null;
    let dispatchRun;
    for (let poll = 0; poll < polls; poll++) {
      dispatchRun ??= await findAutomaticRun(
        "frontend",
        dispatch,
        dispatchTitle,
        "workflow_run"
      );
      if (dispatchRun?.status === "completed") {
        serviceAssert(
          dispatchRun.conclusion === "success",
          "release-workflow",
          "The automatic E2E dispatch wrapper did not pass."
        );
        e2eRun ??= await findAutomaticRun(
          "frontend",
          e2e,
          e2eTitle,
          "workflow_dispatch"
        );
        if (e2eRun) {
          const changed =
            record.workflow_run_id !== e2eRun.id ||
            record.workflow_id !== e2e.id ||
            record.state !== "running";
          record.workflow_run_id = e2eRun.id;
          record.workflow_id = e2e.id;
          record.dispatch_workflow_run_id = dispatchRun.id;
          record.deployment_workflow_run_id = deployRunId;
          record.state = "running";
          if (changed) await save();
          if (e2eRun.status === "completed") break;
        }
      }
      if (poll + 1 < polls) await wait(pollMs, { signal });
      if (record.workflow_run_id)
        e2eRun = (
          await call(
            "frontend",
            "GET",
            `/actions/runs/${record.workflow_run_id}`
          )
        ).data;
    }
    const repository = profile.repositories.frontend;
    for (const [run, identity, title, event, expectedActor] of [
      [dispatchRun, dispatch, dispatchTitle, "workflow_run", actor],
      [e2eRun, e2e, e2eTitle, "workflow_dispatch", runtime.githubActionsActor]
    ])
      serviceAssert(
        positive(run?.id) &&
          run.repository?.id === repository.id &&
          run.head_repository?.id === repository.id &&
          run.head_branch === "main" &&
          run.event === event &&
          positive(run.run_attempt) &&
          run.path === `.github/workflows/${identity.file}` &&
          run.display_title === title &&
          String(run.actor?.id) === expectedActor.id &&
          run.actor?.login === expectedActor.login &&
          run.workflow_id === identity.id &&
          run.status === "completed",
        "release-workflow",
        "The automatic E2E workflow chain does not match the selected deployment."
      );
    serviceAssert(
      ["success", "failure"].includes(e2eRun.conclusion),
      "release-workflow",
      "The matching E2E run ended without usable evidence."
    );
    await verifyFiles("frontend", dispatchRun.head_sha);
    await verifyFiles("frontend", e2eRun.head_sha);
    const dispatchJobs = await jobsFor("frontend", dispatchRun, {
      kind: "dispatch",
      environment: operation.environment
    });
    const expectedDispatchJob = `Dispatch successful ${operation.environment === "staging" ? "staging" : "production"} deployment`;
    serviceAssert(
      dispatchJobs.length === 1 &&
        dispatchJobs[0].name === expectedDispatchJob &&
        dispatchJobs[0].conclusion === "success",
      "release-workflow",
      "The automatic E2E dispatch job did not pass."
    );
    const e2eJobs = await jobsFor("frontend", e2eRun, {
      kind: "e2e",
      environment: operation.environment
    });
    const passed = e2eRun.conclusion === "success";
    serviceAssert(
      passed
        ? e2eJobs.every((job) => job.conclusion === "success")
        : e2eJobs.some((job) => job.conclusion === "failure"),
      "release-workflow",
      "The matching E2E conclusion contradicts its jobs."
    );
    await verifyEnvironment(operation, "E2E result acceptance");
    const builds = passed
      ? {
          backend: dependencies.backend.result.report.builds.backend,
          frontend: dependencies.frontend.result.report.builds.frontend
        }
      : {};
    const deployments = passed
      ? {
          backend: dependencies.backend.result.report.deployments.backend,
          frontend: dependencies.frontend.result.report.deployments.frontend
        }
      : {};
    const report = reportFor({
      operation,
      run: e2eRun,
      status: passed ? "passed" : "failed",
      builds,
      deployments
    });
    verifyProductWorkflowReport(report, operation);
    return {
      status: report.status,
      report_hash: releaseHash(report),
      report,
      workflow: { id: e2eRun.id, url: e2eRun.html_url },
      dispatch_workflow: {
        id: dispatchRun.id,
        url: dispatchRun.html_url
      },
      deployment_workflow: dependencies.frontend.result.workflow
    };
  }

  const allFiles = (role) =>
    Object.values(runtime.repositories[role].workflows).map(
      (value) => value.file
    );
  const client = {
    async identity() {
      const generic = await base.identity();
      const saved = { backend: { workflows: {} }, frontend: { workflows: {} } };
      for (const role of ["backend", "frontend"]) {
        const expected = profile.repositories[role];
        const repo = (await call(role, "GET", "")).data;
        serviceAssert(
          repo.id === expected.id &&
            repo.full_name === expected.full_name &&
            repo.private === false &&
            repo.permissions?.push === true,
          "release-runtime",
          "Product-shaped sandbox repository identity or access changed."
        );
        for (const [key, configured] of Object.entries(
          runtime.repositories[role].workflows
        )) {
          const observed = (
            await call(role, "GET", `/actions/workflows/${configured.file}`)
          ).data;
          serviceAssert(
            observed.path === `.github/workflows/${configured.file}` &&
              observed.name === configured.name &&
              observed.state === "active" &&
              positive(observed.id),
            "release-runtime",
            "A required product-shaped sandbox workflow changed or is inactive."
          );
          saved[role].workflows[key] = { workflow_id: observed.id };
        }
        for (const environment of ["staging", "prod"])
          await verifyFiles(role, generic.versions[environment][role]);
      }
      return {
        actor: generic.actor,
        runtime: saved,
        versions: generic.versions
      };
    },
    async integrate(args) {
      await waitForQuiet(
        args.record.step.role,
        allFiles(args.record.step.role),
        args.record,
        args.save,
        "merge"
      );
      return base.integrate(args);
    },
    async restore(args) {
      return base.restore.call(client, args);
    },
    verifyRestoredEnvironments: (args) => base.verifyRestoredEnvironments(args),
    verifyRestoredStaging: (args) => base.verifyRestoredStaging(args),
    async run({
      record,
      actor,
      save,
      runtime: savedRuntime,
      operations,
      steps
    }) {
      const operation = validateReleaseOperation(record.operation);
      serviceAssert(
        record.actor?.id === actor.id && savedRuntime,
        "release-state",
        "Product-shaped release operation lacks its saved actor or runtime."
      );
      return operation.operation === "e2e"
        ? runE2e({
            record,
            operation,
            actor,
            savedRuntime,
            operations,
            steps,
            save
          })
        : runDirect({
            record,
            operation,
            actor,
            savedRuntime,
            operations,
            save
          });
    }
  };
  return client;
}
