import { executeGitHub } from "./coordinator-github.mjs";
import { realProfile } from "./profiles.mjs";
import { productWorkflowRuntimeForProfile } from "./product-workflow-runtime-config.mjs";

const positive = (value) => Number.isSafeInteger(value) && value > 0;
const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");
const requireValue = (condition) => {
  if (!condition) throw new Error("Unsupported cleanup follow-up read.");
};

// Separate read-only product client. No arbitrary endpoint, method, host or
// command is accepted, and none of the release executor's mutations are exposed.
export function createCleanupFollowupGitHub({
  profile = realProfile,
  execute = executeGitHub
} = {}) {
  const runtime = productWorkflowRuntimeForProfile(profile);
  const read = async (role, path, { missing = false } = {}) => {
    const repository = profile.repositories[role];
    requireValue(repository);
    const output = await execute([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "GET",
      `repos/${repository.full_name}${path}`,
      "--include",
      "--header",
      "Accept: application/vnd.github+json",
      "--header",
      "X-GitHub-Api-Version: 2022-11-28"
    ]);
    const match = output.match(
      /^HTTP\/\S+ (\d{3})[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/u
    );
    if (missing && match?.[1] === "404") return null;
    if (match?.[1] !== "200")
      throw new Error(
        `Follow-up evidence unavailable in ${repository.full_name}.`
      );
    try {
      return JSON.parse(match[2]);
    } catch {
      throw new Error("GitHub returned unreadable follow-up evidence.");
    }
  };
  const workflow = (role, key) => {
    const value = runtime.repositories[role]?.workflows[key];
    requireValue(value);
    return value;
  };
  const pages = async (role, path, field) => {
    const values = [];
    let total;
    for (let page = 1; ; page++) {
      const value = await read(role, `${path}&page=${page}`);
      // GitHub caps created-filtered workflow searches at 1000 results and can
      // return imprecise large counts. Neither supplies complete closure proof.
      // https://docs.github.com/en/rest/actions/workflow-runs
      if (
        field === "workflow_runs" &&
        (!Number.isSafeInteger(value.total_count) || value.total_count > 1000)
      )
        throw new Error(
          "GitHub workflow-run search exceeds its 1000-result cap or has an imprecise count; complete follow-up evidence is unavailable. A maintainer must reconcile narrower dated evidence."
        );
      requireValue(
        Array.isArray(value[field]) &&
          Number.isSafeInteger(value.total_count) &&
          value.total_count >= 0
      );
      total ??= value.total_count;
      requireValue(total === value.total_count);
      values.push(...value[field]);
      if (values.length === total) return values;
      requireValue(value[field].length === 100 && values.length < total);
    }
  };
  return {
    runtime,
    identity: (role) => read(role, ""),
    pull: (role, number) => {
      requireValue(positive(number));
      return read(role, `/pulls/${number}`);
    },
    compare: (role, base, head) => {
      requireValue(sha(base) && sha(head));
      return read(role, `/compare/${base}...${head}`);
    },
    ref: (role, name) => {
      requireValue(
        ["main", "1a-staging"].includes(name) ||
          /^codex\/batch-trial-[0-9a-f-]{36}$/u.test(name)
      );
      return read(role, `/git/ref/heads/${name}`, {
        missing: name.startsWith("codex/")
      });
    },
    workflow: (role, key) =>
      read(role, `/actions/workflows/${workflow(role, key).file}`),
    runs: (role, key, since) => {
      requireValue(
        typeof since === "string" && Number.isFinite(Date.parse(since))
      );
      return pages(
        role,
        `/actions/workflows/${workflow(role, key).file}/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=100`,
        "workflow_runs"
      );
    },
    run: (role, id) => {
      requireValue(positive(id));
      return read(role, `/actions/runs/${id}`);
    },
    jobs: (role, run) => {
      requireValue(positive(run.id) && positive(run.run_attempt));
      return pages(
        role,
        `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
        "jobs"
      );
    },
    file: (role, path, commit) => {
      requireValue(
        sha(commit) &&
          Object.hasOwn(runtime.repositories[role]?.files ?? {}, path)
      );
      return read(role, `/contents/${path}?ref=${commit}`);
    }
  };
}
