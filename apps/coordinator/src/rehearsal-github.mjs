import {
  githubEnvironment,
  runRehearsalProcess
} from "./rehearsal-process.mjs";
import { isBranch, isSha, RehearsalError } from "./rehearsal-plan.mjs";
import {
  approvalBypassEvidence,
  needsApprovalBypass
} from "./approval-bypass.mjs";

const query = `query RehearsalPull($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    number state isDraft headRefOid headRefName baseRefOid baseRefName
    mergeable mergeStateStatus reviewDecision
    repository { databaseId nameWithOwner isPrivate }
    headRepository { databaseId nameWithOwner isPrivate }
    commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { __typename
        ... on CheckRun {
          id name status conclusion startedAt completedAt
          checkSuite {
            commit { oid }
            app { databaseId }
            workflowRun {
              runNumber runAttempt
              workflow { databaseId }
            }
          }
          isRequired(pullRequestNumber: $number)
        }
        ... on StatusContext { id context state createdAt isRequired(pullRequestNumber: $number) }
      }
    } } } } }
  } }
}`;
const destinationQuery = `query RehearsalDestination($owner: String!, $name: String!, $ref: String!) {
  repository(owner: $owner, name: $name) { databaseId nameWithOwner isPrivate
    ref(qualifiedName: $ref) { name target { ... on Commit { oid } } }
  }
}`;
const approvalQuery = `query ApprovalBypass($owner: String!, $name: String!, $number: Int!, $ref: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    databaseId nameWithOwner isPrivate
    ref(qualifiedName: $ref) {
      name target { ... on Commit { oid } }
      branchProtectionRule {
        requiredApprovingReviewCount requiresCodeOwnerReviews
        requiresConversationResolution requiresStatusChecks
        requiresStrictStatusChecks
      }
    }
    pullRequest(number: $number) {
      number headRefOid baseRefOid
      reviews(first: 1) { totalCount }
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { isResolved }
      }
    }
  }
}`;
const approvalReviewsQuery = `query ApprovalBypassReviews($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    databaseId nameWithOwner isPrivate
    pullRequest(number: $number) {
      number headRefOid baseRefOid reviewDecision
      reviews(first: 100, after: $cursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { id state }
      }
    }
  }
}`;

export function createRehearsalGitHub(
  profile,
  { execute = runRehearsalProcess, signal } = {}
) {
  function identity(role) {
    const repo = profile?.repositories?.[role];
    if (
      !["sandbox", "real"].includes(profile?.name) ||
      !["frontend", "backend"].includes(role) ||
      !Number.isSafeInteger(repo?.id) ||
      repo.id <= 0 ||
      typeof repo.private !== "boolean" ||
      repo.full_name !==
        `6529-Collections/${profile.name === "sandbox" ? "release-coordinator-test" : "6529seize"}-${role}`
    ) {
      throw new RehearsalError(
        "unbound_repository",
        "Sandbox repository identity has not been provisioned and pinned."
      );
    }
    return repo;
  }
  function verify(value, repo) {
    if (
      value?.databaseId !== repo.id ||
      value.nameWithOwner !== repo.full_name ||
      value.isPrivate !== repo.private
    ) {
      throw new RehearsalError(
        "repository_identity",
        "GitHub repository identity or visibility differs from the selected profile."
      );
    }
  }
  async function graphql(repo, body, fields) {
    const [owner, name] = repo.full_name.split("/");
    const result = await execute(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "POST",
        "graphql",
        "-f",
        `query=${body}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        ...fields
      ],
      { env: githubEnvironment(), signal }
    );
    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch {
      /* Handled below. */
    }
    if (!response?.data?.repository || response.errors)
      throw new RehearsalError(
        "github_evidence",
        "GitHub returned incomplete rehearsal evidence."
      );
    return response.data.repository;
  }
  async function rest(repo, suffix) {
    const result = await execute(
      "gh",
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "GET",
        `repos/${repo.full_name}${suffix}`
      ],
      { env: githubEnvironment(), signal }
    );
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new RehearsalError(
        "github_evidence",
        "GitHub returned unreadable approval-bypass evidence."
      );
    }
  }
  async function approvalBypass(role, pr) {
    const repo = identity(role);
    if (!repo.approval_bypass_ruleset_id || !needsApprovalBypass(pr))
      return null;
    if (!isBranch(pr.baseRefName) || !isSha(pr.headRefOid))
      throw new RehearsalError(
        "github_evidence",
        "Approval-bypass PR identity is incomplete."
      );
    const cursors = new Set();
    let cursor;
    let protection;
    let reviewCount;
    let unresolvedThreads = 0;
    for (;;) {
      const result = await graphql(repo, approvalQuery, [
        "-F",
        `number=${pr.number}`,
        "-f",
        `ref=refs/heads/${pr.baseRefName}`,
        ...(cursor ? ["-f", `cursor=${cursor}`] : [])
      ]);
      verify(result, repo);
      if (
        result.ref?.name !== pr.baseRefName ||
        result.ref.target?.oid !== pr.baseRefOid ||
        result.pullRequest?.number !== pr.number ||
        result.pullRequest.headRefOid !== pr.headRefOid ||
        result.pullRequest.baseRefOid !== pr.baseRefOid
      )
        throw new RehearsalError(
          "moving_pages",
          "PR or destination moved during approval-bypass verification."
        );
      const nextProtection = result.ref.branchProtectionRule;
      if (
        protection !== undefined &&
        JSON.stringify(protection) !== JSON.stringify(nextProtection)
      )
        throw new RehearsalError(
          "moving_pages",
          "Branch protection changed during approval-bypass verification."
        );
      protection = nextProtection;
      const nextReviewCount = result.pullRequest.reviews?.totalCount;
      if (
        !Number.isSafeInteger(nextReviewCount) ||
        nextReviewCount < 0 ||
        (reviewCount !== undefined && reviewCount !== nextReviewCount)
      )
        throw new RehearsalError(
          "moving_pages",
          "PR review count changed during approval-bypass verification."
        );
      reviewCount = nextReviewCount;
      const threads = result.pullRequest.reviewThreads;
      if (
        !Array.isArray(threads?.nodes) ||
        typeof threads.pageInfo?.hasNextPage !== "boolean" ||
        threads.nodes.some((thread) => typeof thread?.isResolved !== "boolean")
      )
        throw new RehearsalError(
          "github_evidence",
          "GitHub returned incomplete review-thread evidence."
        );
      unresolvedThreads += threads.nodes.filter(
        (thread) => !thread.isResolved
      ).length;
      if (!threads.pageInfo.hasNextPage) break;
      cursor = threads.pageInfo.endCursor;
      if (typeof cursor !== "string" || !cursor || cursors.has(cursor))
        throw new RehearsalError(
          "github_evidence",
          "GitHub returned a missing or repeated review-thread cursor."
        );
      cursors.add(cursor);
    }
    const reviewStates = [];
    if (reviewCount > 0) {
      const reviewIds = new Set();
      const reviewCursors = new Set();
      let reviewCursor;
      for (;;) {
        const result = await graphql(repo, approvalReviewsQuery, [
          "-F",
          `number=${pr.number}`,
          ...(reviewCursor ? ["-f", `cursor=${reviewCursor}`] : [])
        ]);
        verify(result, repo);
        const observed = result.pullRequest;
        const reviews = observed?.reviews;
        if (
          observed?.number !== pr.number ||
          observed.headRefOid !== pr.headRefOid ||
          observed.baseRefOid !== pr.baseRefOid ||
          observed.reviewDecision !== pr.reviewDecision ||
          reviews?.totalCount !== reviewCount
        )
          throw new RehearsalError(
            "moving_pages",
            "PR or review count changed during approval-bypass verification."
          );
        if (
          !Array.isArray(reviews.nodes) ||
          typeof reviews.pageInfo?.hasNextPage !== "boolean" ||
          reviews.nodes.some(
            (review) =>
              typeof review?.id !== "string" ||
              !review.id ||
              typeof review.state !== "string" ||
              reviewIds.has(review.id)
          )
        )
          throw new RehearsalError(
            "github_evidence",
            "GitHub returned incomplete or repeated review evidence."
          );
        for (const review of reviews.nodes) {
          reviewIds.add(review.id);
          reviewStates.push(review.state);
        }
        if (reviewStates.length > reviewCount)
          throw new RehearsalError(
            "moving_pages",
            "PR review count changed during approval-bypass verification."
          );
        if (!reviews.pageInfo.hasNextPage) break;
        reviewCursor = reviews.pageInfo.endCursor;
        if (
          typeof reviewCursor !== "string" ||
          !reviewCursor ||
          reviewCursors.has(reviewCursor)
        )
          throw new RehearsalError(
            "github_evidence",
            "GitHub returned a missing or repeated review cursor."
          );
        reviewCursors.add(reviewCursor);
      }
      if (reviewStates.length !== reviewCount)
        throw new RehearsalError(
          "github_evidence",
          "GitHub returned an incomplete set of PR reviews."
        );
    }
    const rules = await rest(
      repo,
      `/rules/branches/${encodeURIComponent(pr.baseRefName)}`
    );
    const ruleset = await rest(
      repo,
      `/rulesets/${repo.approval_bypass_ruleset_id}`
    );
    let baseIsAncestor = false;
    if (
      rules.some(
        (rule) =>
          rule.type === "required_status_checks" &&
          rule.parameters?.strict_required_status_checks_policy === true
      ) ||
      protection?.requiresStrictStatusChecks === true
    ) {
      const compare = await rest(
        repo,
        `/compare/${pr.baseRefOid}...${pr.headRefOid}?per_page=1`
      );
      // Behind/diverged are valid API shapes, but cannot prove ancestry below.
      if (
        !isSha(compare?.base_commit?.sha) ||
        !isSha(compare?.merge_base_commit?.sha) ||
        !Number.isSafeInteger(compare?.behind_by) ||
        !["ahead", "identical", "behind", "diverged"].includes(compare?.status)
      )
        throw new RehearsalError(
          "github_evidence",
          "GitHub returned incomplete branch-ancestry evidence."
        );
      baseIsAncestor =
        compare.base_commit?.sha === pr.baseRefOid &&
        compare.merge_base_commit?.sha === pr.baseRefOid &&
        compare.behind_by === 0 &&
        ["ahead", "identical"].includes(compare.status);
    }
    return approvalBypassEvidence({
      pr,
      rules,
      ruleset,
      branchProtection: protection,
      unresolvedThreads,
      reviewCount,
      reviewStates,
      baseIsAncestor,
      rulesetId: repo.approval_bypass_ruleset_id,
      expectedChecks: repo.required_checks
    });
  }
  async function withApprovalBypass(role, pr) {
    if (!needsApprovalBypass(pr)) return pr;
    return { ...pr, approvalBypass: await approvalBypass(role, pr) };
  }
  return {
    approvalBypass,
    async destination(role, branch) {
      const repo = identity(role);
      if (!isBranch(branch))
        throw new RehearsalError(
          "invalid_branch",
          "Invalid destination branch."
        );
      const result = await graphql(repo, destinationQuery, [
        "-f",
        `ref=refs/heads/${branch}`
      ]);
      verify(result, repo);
      if (result.ref?.name !== branch || !isSha(result.ref?.target?.oid))
        throw new RehearsalError(
          "destination_unavailable",
          "Destination branch commit could not be verified."
        );
      return { repository: { ...repo }, branch, commit: result.ref.target.oid };
    },
    async pullRequest(role, number) {
      const repo = identity(role);
      if (!Number.isSafeInteger(number) || number <= 0)
        throw new RehearsalError("invalid_pr", "Invalid PR number.");
      let snapshot;
      let cursor;
      const cursors = new Set();
      const ids = new Set();
      const checks = [];
      for (let page = 0; page < 100; page += 1) {
        const result = await graphql(repo, query, [
          "-F",
          `number=${number}`,
          ...(cursor ? ["-f", `cursor=${cursor}`] : [])
        ]);
        const pr = result.pullRequest;
        verify(pr?.repository, repo);
        verify(pr?.headRepository, repo);
        const commits = pr?.commits?.nodes;
        if (
          !Array.isArray(commits) ||
          commits.length !== 1 ||
          !isSha(pr.headRefOid) ||
          commits[0]?.commit?.oid !== pr.headRefOid
        ) {
          throw new RehearsalError(
            "github_evidence",
            "GitHub checks are not bound to the exact PR head."
          );
        }
        const { commits: ignored, ...metadata } = pr;
        if (snapshot && JSON.stringify(snapshot) !== JSON.stringify(metadata))
          throw new RehearsalError(
            "moving_pages",
            "PR state changed across check pages."
          );
        snapshot = metadata;
        const rollup = commits[0].commit.statusCheckRollup;
        if (rollup === null && !cursor)
          return withApprovalBypass(role, { ...snapshot, checks });
        const connection = rollup?.contexts;
        if (
          !Array.isArray(connection?.nodes) ||
          connection.nodes.length > 100 ||
          typeof connection.pageInfo?.hasNextPage !== "boolean"
        ) {
          throw new RehearsalError(
            "github_pagination",
            "GitHub check pages are incomplete."
          );
        }
        for (const check of connection.nodes) {
          if (
            !check ||
            typeof check.id !== "string" ||
            !check.id ||
            ids.has(check.id) ||
            typeof check.isRequired !== "boolean" ||
            !["CheckRun", "StatusContext"].includes(check.__typename)
          )
            throw new RehearsalError(
              "github_pagination",
              "GitHub checks are missing, repeated, or unsupported."
            );
          ids.add(check.id);
          checks.push(check);
        }
        if (!connection.pageInfo.hasNextPage)
          return withApprovalBypass(role, { ...snapshot, checks });
        cursor = connection.pageInfo.endCursor;
        if (typeof cursor !== "string" || !cursor || cursors.has(cursor))
          throw new RehearsalError(
            "github_pagination",
            "GitHub check cursor is missing or repeated."
          );
        cursors.add(cursor);
      }
      throw new RehearsalError(
        "github_pagination",
        "GitHub check pagination exceeded the bounded limit."
      );
    },
    async gitAuthentication() {
      const result = await execute(
        "gh",
        ["auth", "token", "--hostname", "github.com"],
        { env: githubEnvironment(), signal, maxOutput: 16_384 }
      );
      const token = result.stdout.trim();
      if (!token || /\s/u.test(token))
        throw new RehearsalError(
          "git_authentication",
          "GitHub authentication could not be obtained for object reads."
        );
      return `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    }
  };
}
