import { realProfile } from "./profiles.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

const shaPattern = /^[0-9a-f]{40}$/u;
export const catalogPath = "src/config/deploy-services.json";

// Fixed read query, with values passed as variables. Never accept arbitrary
// GraphQL, REST paths, hosts, commands, or mutations from an inbox record.
const pullQuery = `query ReadinessPull($repository: String!, $number: Int!, $cursor: String) {
  repository(owner: "6529-Collections", name: $repository) {
    pullRequest(number: $number) {
      number state isDraft headRefOid headRefName baseRefOid baseRefName
      mergeable mergeStateStatus reviewDecision
      repository { nameWithOwner }
      headRepository { nameWithOwner }
      commits(last: 1) { nodes { commit {
        oid
        statusCheckRollup { contexts(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            __typename
            ... on CheckRun { id name status conclusion isRequired(pullRequestNumber: $number) }
            ... on StatusContext { id context state isRequired(pullRequestNumber: $number) }
          }
        } }
      } } }
    }
  }
}`;

export function createReadinessGitHub({ execute = executeFile, profile = realProfile } = {}) {
  const repositories = new Set(Object.values(profile.repositories).map(repo => repo.full_name.split("/")[1]));
  async function api(method, endpoint, fields = []) {
    let stdout;
    try {
      ({ stdout } = await execute("gh", [
        "api", "--hostname", "github.com", "--method", method, endpoint,
        "--header", "Accept: application/vnd.github+json",
        "--header", "X-GitHub-Api-Version: 2022-11-28", ...fields
      ], {
        encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_DEBUG: "", NO_COLOR: "1" }
      }));
    } catch {
      // Do not expose raw CLI stderr, credentials, or response bodies.
      throw new Error("GitHub readiness read failed. Check gh authentication, repository read access, and network availability.");
    }
    let result;
    try { result = JSON.parse(stdout); } catch {
      throw new Error("GitHub returned unreadable readiness data.");
    }
    if (!result || result.errors) throw new Error("GitHub could not return complete readiness evidence.");
    return result;
  }

  return {
    async pullRequest(repository, number) {
      if (!repositories.has(repository) || !Number.isSafeInteger(number) || number < 1) {
        throw new Error("Unsupported readiness repository or PR number.");
      }
      let snapshot;
      let cursor;
      const cursors = new Set();
      const ids = new Set();
      const checks = [];
      for (;;) {
        const fields = ["-f", `query=${pullQuery}`, "-f", `repository=${repository}`, "-F", `number=${number}`];
        if (cursor) fields.push("-f", `cursor=${cursor}`);
        // GitHub GraphQL uses POST for queries. This fixed operation only reads.
        const response = await api("POST", "graphql", fields);
        const pr = response.data?.repository?.pullRequest;
        const commits = pr?.commits?.nodes;
        if (!pr || !Array.isArray(commits) || commits.length !== 1
          || commits[0]?.commit?.oid !== pr.headRefOid) {
          throw new Error("GitHub did not return checks for the PR's exact head.");
        }
        const { commits: ignored, ...metadata } = pr;
        if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(metadata)) {
          throw new Error("PR state changed while reading check pages. Run the scan again.");
        }
        snapshot = metadata;
        const rollup = commits[0].commit.statusCheckRollup;
        if (rollup === null && !cursor) return { ...snapshot, checks };
        const connection = rollup?.contexts;
        if (!Array.isArray(connection?.nodes) || connection.nodes.length > 100
          || typeof connection.pageInfo?.hasNextPage !== "boolean") {
          throw new Error("GitHub returned incomplete PR check pages.");
        }
        for (const check of connection.nodes) {
          if (!check || typeof check.id !== "string" || !check.id || ids.has(check.id)
            || typeof check.isRequired !== "boolean"
            || !["CheckRun", "StatusContext"].includes(check.__typename)) {
            throw new Error("GitHub returned missing, repeated, or unknown PR checks.");
          }
          ids.add(check.id);
          checks.push(check);
        }
        if (!connection.pageInfo.hasNextPage) return { ...snapshot, checks };
        cursor = connection.pageInfo.endCursor;
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) {
          throw new Error("GitHub returned a missing or repeated check-page cursor.");
        }
        cursors.add(cursor);
      }
    },

    async catalog(commit) {
      if (typeof commit !== "string" || !shaPattern.test(commit)) {
        throw new Error("The backend catalog requires an exact commit.");
      }
      const file = await api("GET", `repos/${profile.repositories.backend.full_name}/contents/${catalogPath}?ref=${commit}`);
      if (file.type !== "file" || file.path !== catalogPath || file.encoding !== "base64"
        || typeof file.content !== "string" || !shaPattern.test(file.sha)) {
        throw new Error("GitHub did not return the backend catalog file at the requested commit.");
      }
      let catalog;
      try { catalog = JSON.parse(Buffer.from(file.content, "base64").toString("utf8")); } catch {
        throw new Error("The backend catalog is not readable JSON.");
      }
      return { commit, blob_sha: file.sha, catalog };
    }
  };
}
