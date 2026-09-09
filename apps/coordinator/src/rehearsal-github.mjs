import { githubEnvironment, runRehearsalProcess } from "./rehearsal-process.mjs";
import { isBranch, isSha, RehearsalError } from "./rehearsal-plan.mjs";

const query = `query RehearsalPull($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    number state isDraft headRefOid headRefName baseRefOid baseRefName
    mergeable mergeStateStatus reviewDecision
    repository { databaseId nameWithOwner isPrivate }
    headRepository { databaseId nameWithOwner isPrivate }
    commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { __typename
        ... on CheckRun { id name status conclusion isRequired(pullRequestNumber: $number) }
        ... on StatusContext { id context state isRequired(pullRequestNumber: $number) }
      }
    } } } } }
  } }
}`;
const destinationQuery = `query RehearsalDestination($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) { databaseId nameWithOwner isPrivate
    ref(qualifiedName: $ref) { name target { ... on Commit { oid } } }
  }
}`;

export function createRehearsalGitHub(profile, { execute = runRehearsalProcess, signal } = {}) {
  function identity(role) {
    const repo = profile?.repositories?.[role];
    if (!["sandbox", "real"].includes(profile?.name) || !["frontend", "backend"].includes(role)
      || !Number.isSafeInteger(repo?.id) || repo.id <= 0
      || typeof repo.private !== "boolean" || repo.full_name !== `6529-Collections/${profile.name === "sandbox" ? "release-coordinator-test" : "6529seize"}-${role}`) {
      throw new RehearsalError("unbound_repository", "Sandbox repository identity has not been provisioned and pinned.");
    }
    return repo;
  }
  function verify(value, repo) {
    if (value?.databaseId !== repo.id || value.nameWithOwner !== repo.full_name || value.isPrivate !== repo.private) {
      throw new RehearsalError("repository_identity", "GitHub repository identity or visibility differs from the selected profile.");
    }
  }
  async function graphql(repo, body, fields) {
    const [owner, name] = repo.full_name.split("/");
    const result = await execute("gh", ["api", "--hostname", "github.com", "--method", "POST", "graphql",
      "-f", `query=${body}`, "-f", `owner=${owner}`, "-f", `name=${name}`, ...fields], { env: githubEnvironment(), signal });
    let response;
    try { response = JSON.parse(result.stdout); } catch { /* Handled below. */ }
    if (!response?.data?.repository || response.errors) throw new RehearsalError("github_evidence", "GitHub returned incomplete rehearsal evidence.");
    return response.data.repository;
  }
  return {
    async destination(role, branch) {
      const repo = identity(role);
      if (!isBranch(branch)) throw new RehearsalError("invalid_branch", "Invalid destination branch.");
      const result = await graphql(repo, destinationQuery, ["-f", `ref=refs/heads/${branch}`]);
      verify(result, repo);
      if (result.ref?.name !== branch || !isSha(result.ref?.target?.oid)) throw new RehearsalError("destination_unavailable", "Destination branch commit could not be verified.");
      return { repository: { ...repo }, branch, commit: result.ref.target.oid };
    },
    async pullRequest(role, number) {
      const repo = identity(role);
      if (!Number.isSafeInteger(number) || number <= 0) throw new RehearsalError("invalid_pr", "Invalid PR number.");
      let snapshot;
      let cursor;
      const cursors = new Set();
      const ids = new Set();
      const checks = [];
      for (let page = 0; page < 100; page += 1) {
        const result = await graphql(repo, query, ["-F", `number=${number}`, ...(cursor ? ["-f", `cursor=${cursor}`] : [])]);
        const pr = result.pullRequest;
        verify(pr?.repository, repo); verify(pr?.headRepository, repo);
        const commits = pr?.commits?.nodes;
        if (!Array.isArray(commits) || commits.length !== 1 || !isSha(pr.headRefOid) || commits[0]?.commit?.oid !== pr.headRefOid) {
          throw new RehearsalError("github_evidence", "GitHub checks are not bound to the exact PR head.");
        }
        const { commits: ignored, ...metadata } = pr;
        if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(metadata)) throw new RehearsalError("moving_pages", "PR state changed across check pages.");
        snapshot = metadata;
        const rollup = commits[0].commit.statusCheckRollup;
        if (rollup === null && !cursor) return { ...snapshot, checks };
        const connection = rollup?.contexts;
        if (!Array.isArray(connection?.nodes) || connection.nodes.length > 100 || typeof connection.pageInfo?.hasNextPage !== "boolean") {
          throw new RehearsalError("github_pagination", "GitHub check pages are incomplete.");
        }
        for (const check of connection.nodes) {
          if (!check || typeof check.id !== "string" || !check.id || ids.has(check.id) || typeof check.isRequired !== "boolean"
            || !["CheckRun", "StatusContext"].includes(check.__typename)) throw new RehearsalError("github_pagination", "GitHub checks are missing, repeated, or unsupported.");
          ids.add(check.id); checks.push(check);
        }
        if (!connection.pageInfo.hasNextPage) return { ...snapshot, checks };
        cursor = connection.pageInfo.endCursor;
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw new RehearsalError("github_pagination", "GitHub check cursor is missing or repeated.");
        cursors.add(cursor);
      }
      throw new RehearsalError("github_pagination", "GitHub check pagination exceeded the bounded limit.");
    },
    async gitAuthentication() {
      const result = await execute("gh", ["auth", "token", "--hostname", "github.com"], { env: githubEnvironment(), signal, maxOutput: 16_384 });
      const token = result.stdout.trim();
      if (!token || /\s/u.test(token)) throw new RehearsalError("git_authentication", "GitHub authentication could not be obtained for object reads.");
      return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    }
  };
}
