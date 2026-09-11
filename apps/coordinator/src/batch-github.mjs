import { executeGitHub } from "./coordinator-github.mjs";
import { createRehearsalGitHub } from "./rehearsal-github.mjs";
import { readServiceLogs } from "./service-github.mjs";
import { sandboxProfile } from "./profiles.mjs";
import { assertDestination } from "./input-stability.mjs";
import { batchPolicy } from "./batch-plan.mjs";
import { serviceAssert, ServiceError } from "./service-contract.mjs";
import { serviceFiles } from "./service-contract.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const branchName = (value) =>
  /^codex\/batch-trial-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(
    value ?? ""
  );
const positive = (value) => Number.isSafeInteger(value) && value > 0;

// This writer has no merge endpoint and cannot write to product repositories,
// source branches, main, or workflows. Only saved temporary trial identities.
export function createBatchGitHub({
  profile,
  execute = executeGitHub,
  logs = readServiceLogs,
  gates = createRehearsalGitHub(sandboxProfile),
  guard = async () => {}
} = {}) {
  serviceAssert(
    profile === sandboxProfile,
    "batch-profile",
    "Temporary batch PRs require the sandbox profile."
  );
  async function call(role, method, suffix, body, allowed = [200]) {
    serviceAssert(
      ["frontend", "backend"].includes(role),
      "batch-profile",
      "Invalid batch repository role."
    );
    if (method !== "GET") await guard();
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
      "batch-github",
      "GitHub returned no readable batch response."
    );
    let data;
    try {
      data = match[2].trim() ? JSON.parse(match[2]) : null;
    } catch {
      throw new ServiceError(
        "batch-github",
        "GitHub batch response is unreadable."
      );
    }
    const status = Number(match[1]);
    serviceAssert(
      allowed.includes(status),
      "batch-github",
      `Batch GitHub operation returned HTTP ${status}.`
    );
    return { status, data };
  }
  function validate(record) {
    const repo = profile.repositories[record.role];
    serviceAssert(
      repo &&
        branchName(record.branch) &&
        sha(record.base) &&
        sha(record.tree) &&
        (!record.commit || sha(record.commit)) &&
        positive(Number(record.actor?.id)),
      "batch-ownership",
      "The saved temporary PR identity is invalid."
    );
  }
  function validatePull(pr, record, { closed = false } = {}) {
    validate(record);
    const repo = profile.repositories[record.role];
    serviceAssert(
      positive(pr?.number) &&
        (!record.number || pr.number === record.number) &&
        pr.head?.repo?.id === repo.id &&
        pr.head.repo.full_name === repo.full_name &&
        pr.base?.repo?.id === repo.id &&
        pr.base.repo.full_name === repo.full_name &&
        pr.head.ref === record.branch &&
        pr.head.sha === record.commit &&
        pr.base.ref === "main" &&
        pr.base.sha === record.base &&
        String(pr.user?.id) === record.actor.id &&
        // Review bots may append summaries. Only the original Coordinator block
        // establishes identity; appended prose is never an input or instruction.
        (pr.body === record.body || pr.body?.startsWith(`${record.body}\n`)) &&
        pr.merged === false &&
        (pr.state === "open" || (closed && pr.state === "closed")),
      "batch-ownership",
      "Temporary PR ownership, exact code or destination changed; stop and reconcile."
    );
    return pr;
  }
  async function unchanged(record) {
    const ref = await call(record.role, "GET", "/git/ref/heads/main");
    assertDestination({
      role: record.role,
      repository: profile.repositories[record.role].full_name,
      expected: record.base,
      observed: ref.data?.object?.sha
    });
  }
  return {
    async identity(role, base) {
      serviceAssert(
        sha(base),
        "batch-input",
        "Batch base must be an exact commit."
      );
      const repo = (await call(role, "GET", "")).data;
      const actor = (await call(role, "GET", "user")).data;
      const workflow = (
        await call(
          role,
          "GET",
          `/contents/.github/workflows/${batchPolicy.required_workflow}?ref=${base}`
        )
      ).data;
      const active = (
        await call(
          role,
          "GET",
          `/actions/workflows/${batchPolicy.required_workflow}`
        )
      ).data;
      serviceAssert(
        repo.id === profile.repositories[role].id &&
          repo.full_name === profile.repositories[role].full_name &&
          repo.private === false &&
          repo.permissions?.push === true &&
          positive(actor.id) &&
          workflow.type === "file" &&
          workflow.sha === batchPolicy.workflow_blob &&
          active.path ===
            `.github/workflows/${batchPolicy.required_workflow}` &&
          active.state === "active" &&
          positive(active.id),
        "batch-runtime",
        "Sample repository access or required workflow differs from trusted configuration."
      );
      return {
        actor: { id: String(actor.id), login: actor.login },
        workflow_id: active.id
      };
    },
    async open(record, patch, save) {
      validate(record);
      await unchanged(record);
      serviceAssert(
        Array.isArray(patch) &&
          patch.length > 0 &&
          patch.length <= 40 &&
          patch.every(
            (file) =>
              /^(?:src\/[a-zA-Z0-9_./-]+|docs\/[a-zA-Z0-9_./-]+\.md|README\.md|shared\.txt)$/u.test(
                file.path ?? ""
              ) &&
              !file.path.includes("..") &&
              (serviceFiles[record.role].includes(file.path) ||
                file.path === "README.md" ||
                file.path === "shared.txt" ||
                file.path.startsWith("docs/")) &&
              ["100644", "100755"].includes(file.mode) &&
              file.type === "blob" &&
              (file.sha === null ||
                (typeof file.content === "string" &&
                  Buffer.byteLength(file.content) <= 12_000))
          ),
        "batch-patch",
        "Only the supported sample patch can enter a temporary PR."
      );
      if (!record.commit) {
        const base = (
          await call(record.role, "GET", `/git/commits/${record.base}`)
        ).data;
        serviceAssert(
          sha(base.tree?.sha),
          "batch-tree",
          "The saved base tree is unavailable."
        );
        const tree = (
          await call(
            record.role,
            "POST",
            "/git/trees",
            { base_tree: base.tree.sha, tree: patch },
            [201]
          )
        ).data;
        serviceAssert(
          tree.sha === record.tree,
          "batch-tree",
          "Published tree differs from the locally checked combination."
        );
        const author = {
          name: "6529 Coordinator batch trial",
          email: "coordinator@example.invalid",
          date: record.created_at
        };
        const commit = (
          await call(
            record.role,
            "POST",
            "/git/commits",
            {
              tree: tree.sha,
              parents: [record.base],
              message: `Temporary batch trial ${record.branch}`,
              author,
              committer: author
            },
            [201]
          )
        ).data;
        serviceAssert(
          sha(commit.sha) &&
            commit.tree?.sha === record.tree &&
            commit.parents?.length === 1 &&
            commit.parents[0].sha === record.base,
          "batch-tree",
          "Temporary commit identity is invalid."
        );
        record.commit = commit.sha;
        await save(record); // Exact head is durable before branch creation.
      }
      let ref = await call(
        record.role,
        "GET",
        `/git/ref/heads/${record.branch}`,
        undefined,
        [200, 404]
      );
      if (ref.status === 404) {
        serviceAssert(
          !record.number,
          "batch-ownership",
          "A known temporary branch disappeared."
        );
        try {
          await call(
            record.role,
            "POST",
            "/git/refs",
            { ref: `refs/heads/${record.branch}`, sha: record.commit },
            [201, 422]
          );
        } catch {
          /* Recover by the unique saved ref; no alternative branch. */
        }
        ref = await call(record.role, "GET", `/git/ref/heads/${record.branch}`);
      }
      serviceAssert(
        ref.data?.object?.sha === record.commit,
        "batch-ownership",
        "Temporary branch moved or could not be verified."
      );
      if (record.number)
        return validatePull(
          (await call(record.role, "GET", `/pulls/${record.number}`)).data,
          record
        );
      const head = encodeURIComponent(`6529-Collections:${record.branch}`);
      const list = (
        await call(
          record.role,
          "GET",
          `/pulls?state=all&head=${head}&per_page=100`
        )
      ).data;
      serviceAssert(
        Array.isArray(list) && list.length <= 1,
        "batch-ownership",
        "Temporary PR identity is ambiguous."
      );
      let pr;
      if (list.length)
        pr = (await call(record.role, "GET", `/pulls/${list[0].number}`)).data;
      else {
        serviceAssert(
          record.pr_state !== "creating",
          "batch-pr-uncertain",
          "A prior PR creation has no confirmed result. Reconcile it; do not create another."
        );
        record.pr_state = "creating";
        await save(record);
        pr = (
          await call(
            record.role,
            "POST",
            "/pulls",
            {
              title: `Batch trial ${record.branch.slice(-36)}`,
              head: record.branch,
              base: "main",
              body: record.body
            },
            [201]
          )
        ).data;
      }
      validatePull(pr, record);
      record.number = pr.number;
      record.url = pr.html_url;
      record.pr_state = "open";
      await save(record);
      return pr;
    },
    async result(record, { closed = false } = {}) {
      validate(record);
      await unchanged(record);
      const pr = validatePull(
        (await call(record.role, "GET", `/pulls/${record.number}`)).data,
        record,
        { closed }
      );
      if (!closed && !sha(pr.merge_commit_sha)) return null;
      const list = (
        await call(
          record.role,
          "GET",
          `/actions/workflows/${record.workflow_id}/runs?event=pull_request&head_sha=${record.commit}&per_page=100`
        )
      ).data;
      serviceAssert(
        Number.isSafeInteger(list.total_count) &&
          list.total_count <= 100 &&
          list.workflow_runs?.length === list.total_count,
        "batch-checks",
        "Required workflow history is incomplete."
      );
      const runs = list.workflow_runs.filter(
        (run) => run.head_sha === record.commit
      );
      serviceAssert(
        runs.length <= 1,
        "batch-checks",
        "Multiple runs claim the same temporary candidate; reconcile their identity."
      );
      if (!runs.length) return null;
      const run = runs[0],
        repo = profile.repositories[record.role];
      serviceAssert(
        run.repository?.id === repo.id &&
          run.head_repository?.id === repo.id &&
          run.path === `.github/workflows/${batchPolicy.required_workflow}` &&
          run.workflow_id === record.workflow_id &&
          run.head_branch === record.branch &&
          run.event === "pull_request" &&
          run.run_attempt === 1 &&
          String(run.actor?.id) === record.actor.id,
        "batch-checks",
        "Required workflow repository, actor, source or attempt does not match."
      );
      if (run.status !== "completed") return null;
      serviceAssert(
        ["success", "failure"].includes(run.conclusion),
        "batch-checks",
        "Required workflow was skipped, cancelled or timed out."
      );
      const jobs = (
        await call(
          record.role,
          "GET",
          `/actions/runs/${run.id}/attempts/1/jobs?per_page=100`
        )
      ).data;
      serviceAssert(
        jobs.total_count === 1 && jobs.jobs?.length === 1,
        "batch-checks",
        "Required job set is incomplete."
      );
      const job = jobs.jobs[0],
        executeStep = job.steps?.find(
          (step) => step.name === "Run node scripts/check.mjs"
        );
      serviceAssert(
        job.name === batchPolicy.required_job &&
          job.run_id === run.id &&
          job.head_sha === record.commit &&
          job.status === "completed" &&
          executeStep?.status === "completed" &&
          ["success", "failure"].includes(executeStep.conclusion),
        "batch-checks",
        "The required sample test step did not run against the exact temporary commit."
      );
      const output = await logs(
        `repos/${repo.full_name}/actions/jobs/${job.id}/logs`
      );
      // Checkout's own output precedes candidate execution. Actions head_sha
      // identifies the PR head, not the synthetic merge actually checked out.
      const beforeExecution = output.split(
        "##[group]Run node scripts/check.mjs"
      );
      const checkedOut = [
        ...beforeExecution[0].matchAll(
          /\[command\]\/usr\/bin\/git log -1 --format=%H\r?\n\S+ ([0-9a-f]{40})\r?\n/gu
        )
      ];
      serviceAssert(
        beforeExecution.length === 2 && checkedOut.length === 1,
        "batch-check-inputs",
        "The trusted checkout did not identify one actual tested commit."
      );
      const merge = (
        await call(record.role, "GET", `/git/commits/${checkedOut[0][1]}`)
      ).data;
      serviceAssert(
        merge.tree?.sha === record.tree &&
          merge.parents?.length === 2 &&
          merge.parents.some((p) => p.sha === record.base) &&
          merge.parents.some((p) => p.sha === record.commit),
        "batch-check-inputs",
        "The actual checkout does not contain the saved exact combination."
      );
      const observed = await gates.pullRequest(record.role, record.number);
      serviceAssert(
        observed.headRefOid === record.commit &&
          observed.baseRefOid === record.base &&
          observed.headRefName === record.branch &&
          observed.state === (closed ? "CLOSED" : "OPEN"),
        "batch-stale",
        "Temporary PR changed during result verification.",
        "stale"
      );
      const required = observed.checks.filter((check) => check.isRequired);
      serviceAssert(
        required.some((check) => check.name === batchPolicy.required_job),
        "batch-checks",
        "The expected PR check is no longer required."
      );
      if (
        required.some((check) =>
          check.__typename === "CheckRun"
            ? check.status !== "COMPLETED"
            : check.state === "PENDING"
        )
      )
        return null;
      let status = "unknown",
        kind = "evidence";
      if (
        run.conclusion === "success" &&
        job.conclusion === "success" &&
        job.steps.every((step) => step.conclusion === "success") &&
        required.every((check) =>
          check.__typename === "CheckRun"
            ? check.conclusion === "SUCCESS"
            : check.state === "SUCCESS"
        )
      ) {
        status = "passed";
        kind = "checks";
      } else if (
        run.conclusion === "failure" &&
        executeStep.conclusion === "failure"
      ) {
        // The pinned wrapper emits this summary, outside the isolated candidate.
        const summaries = output.split("\n").flatMap((line) => {
          const start = line.indexOf('{"status":');
          if (start < 0) return [];
          try {
            return [JSON.parse(line.slice(start).trim())];
          } catch {
            return [];
          }
        });
        if (
          summaries.length === 1 &&
          summaries[0].status === "blocked" &&
          summaries[0].cleanup?.status === "removed" &&
          summaries[0].steps?.some((step) => step.status === "blocked") &&
          summaries[0].errors?.length > 0
        ) {
          status = "blocked";
          kind = "code";
        }
      }
      await unchanged(record);
      return {
        status,
        kind,
        role: record.role,
        pr: record.url,
        workflow: run.html_url,
        commit: record.commit,
        tree: record.tree,
        base: record.base,
        workflow_id: run.id,
        message:
          status === "passed"
            ? "Exact combined PR checks passed."
            : status === "blocked"
              ? "The combined sample test failed."
              : "The required checks did not provide attributable code-failure evidence."
      };
    },
    async cleanup(record) {
      validate(record);
      if (!record.number && record.pr_state === "creating") {
        const head = encodeURIComponent(`6529-Collections:${record.branch}`);
        const list = (
          await call(
            record.role,
            "GET",
            `/pulls?state=all&head=${head}&per_page=100`
          )
        ).data;
        serviceAssert(
          Array.isArray(list) && list.length === 1 && positive(list[0].number),
          "batch-cleanup",
          "An uncertain PR creation has no unique identity for cleanup; reconcile it."
        );
        const pr = (await call(record.role, "GET", `/pulls/${list[0].number}`))
          .data;
        validatePull(pr, { ...record, base: pr.base?.sha }, { closed: true });
        record.number = pr.number;
        record.url = pr.html_url;
      }
      if (record.number) {
        // A moving main invalidates proof, but does not erase ownership of an
        // unchanged trial PR. Check its recorded base ref and source identity.
        const pr = (await call(record.role, "GET", `/pulls/${record.number}`))
          .data;
        const base = record.base;
        validatePull(pr, { ...record, base: pr.base?.sha }, { closed: true });
        if (pr.state === "open")
          await call(record.role, "PATCH", `/pulls/${record.number}`, {
            state: "closed"
          });
        const final = (
          await call(record.role, "GET", `/pulls/${record.number}`)
        ).data;
        serviceAssert(
          final.state === "closed" &&
            final.merged === false &&
            final.head.sha === record.commit &&
            final.head.ref === record.branch &&
            final.base.ref === "main",
          "batch-cleanup",
          "Temporary PR closure could not be verified."
        );
        record.base = base;
      } else if (record.pr_state === "creating") {
        throw new ServiceError(
          "batch-cleanup",
          "An uncertain PR creation must be reconciled before cleanup."
        );
      }
      if (record.commit) {
        const ref = await call(
          record.role,
          "GET",
          `/git/ref/heads/${record.branch}`,
          undefined,
          [200, 404]
        );
        if (ref.status === 200) {
          serviceAssert(
            ref.data?.object?.sha === record.commit,
            "batch-cleanup",
            "Temporary ref changed; it cannot be removed automatically."
          );
          await call(
            record.role,
            "DELETE",
            `/git/refs/heads/${record.branch}`,
            undefined,
            [204]
          );
        }
        const after = await call(
          record.role,
          "GET",
          `/git/ref/heads/${record.branch}`,
          undefined,
          [200, 404]
        );
        serviceAssert(
          after.status === 404,
          "batch-cleanup",
          "Temporary ref cleanup could not be verified."
        );
      }
      return { status: "removed" };
    }
  };
}
