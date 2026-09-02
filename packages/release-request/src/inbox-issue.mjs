import { createHash } from "node:crypto";

const ISSUE_BODY_LIMIT = 65_536;
const REQUEST_LABEL = {
  name: "release-request",
  color: "0969da",
  description: "Accepted 6529 release request"
};
const PENDING_LABEL = {
  name: "pending",
  color: "fbca04",
  description: "Waiting for Coordinator processing"
};
const TARGET_LABELS = {
  staging: {
    name: "target:staging",
    color: "1d76db",
    description: "Release target is staging"
  },
  production: {
    name: "target:production",
    color: "d93f0b",
    description: "Release target is production"
  }
};

function canonicalRequestJson(request) {
  return JSON.stringify(request);
}

export function releaseRequestChecksum(request) {
  return createHash("sha256").update(canonicalRequestJson(request)).digest("hex");
}

export function releaseRequestIssueTitle(requestId) {
  return `Release request ${requestId}`;
}

export function buildReleaseRequestIssueBody({
  request,
  checksum,
  actor,
  actorId,
  workflowRunUrl,
  submittedAt
}) {
  const body = `<!-- 6529-release-request-id:${request.request_id} -->
<!-- 6529-release-request-checksum:${checksum} -->

# Release request

| Field | Value |
| --- | --- |
| Request ID | \`${request.request_id}\` |
| Target | \`${request.target}\` |
| Trusted GitHub actor | @${actor} |
| GitHub actor ID | \`${actorId}\` |
| Workflow | ${workflowRunUrl} |
| Submitted at | \`${submittedAt}\` |
| Checksum | \`${checksum}\` |
| Inbox result | \`accepted\` |

## Release JSON

\`\`\`json
${JSON.stringify(request, null, 2)}
\`\`\`
`;

  if (body.length > ISSUE_BODY_LIMIT) {
    throw new Error(
      `The release request is too large for a GitHub Issue (${body.length} characters).`
    );
  }

  return body;
}

function parseSavedIssue(body) {
  if (typeof body !== "string") {
    throw new Error("The existing inbox Issue has no readable body.");
  }

  const requestId = body.match(
    /<!-- 6529-release-request-id:([0-9a-f-]+) -->/u
  )?.[1];
  const checksum = body.match(
    /<!-- 6529-release-request-checksum:([0-9a-f]{64}) -->/u
  )?.[1];
  const requestText = body.match(
    /## Release JSON\n\n```json\n([\s\S]*?)\n```/u
  )?.[1];

  if (!requestId || !checksum || !requestText) {
    throw new Error("The existing inbox Issue is missing trusted request markers.");
  }

  let request;
  try {
    request = JSON.parse(requestText);
  } catch {
    throw new Error("The existing inbox Issue contains invalid release JSON.");
  }

  if (releaseRequestChecksum(request) !== checksum) {
    throw new Error("The existing inbox Issue release JSON was changed.");
  }

  return { requestId, checksum };
}

function requireResponse(response, expectedStatus, action) {
  if (response.status !== expectedStatus) {
    const message = response.data?.message || `GitHub returned status ${response.status}.`;
    throw new Error(`${action}: ${message}`);
  }
  return response.data;
}

async function findReleaseRequestIssues({ githubRequest, requestId }) {
  const title = releaseRequestIssueTitle(requestId);
  const marker = `<!-- 6529-release-request-id:${requestId} -->`;
  const matches = [];

  for (let page = 1; ; page += 1) {
    const response = await githubRequest({
      method: "GET",
      path: `/issues?state=all&per_page=100&page=${page}`
    });
    const issues = requireResponse(response, 200, "Could not search the inbox");
    if (!Array.isArray(issues)) {
      throw new Error("Could not search the inbox: GitHub returned an invalid issue list.");
    }

    matches.push(
      ...issues.filter(
        (issue) =>
          !issue.pull_request &&
          (issue.title === title ||
            (typeof issue.body === "string" && issue.body.includes(marker)))
      )
    );
    if (issues.length < 100) {
      return matches;
    }
  }
}

async function ensureLabel(githubRequest, label) {
  const encodedName = encodeURIComponent(label.name);
  const existing = await githubRequest({
    method: "GET",
    path: `/labels/${encodedName}`
  });
  if (existing.status === 200) {
    return;
  }
  if (existing.status !== 404) {
    requireResponse(existing, 200, `Could not read the ${label.name} label`);
  }

  const created = await githubRequest({
    method: "POST",
    path: "/labels",
    body: label
  });
  if (created.status === 201) {
    return;
  }

  // Another workflow may have created the shared label at the same time.
  if (created.status === 422) {
    const retried = await githubRequest({
      method: "GET",
      path: `/labels/${encodedName}`
    });
    if (retried.status === 200) {
      return;
    }
  }
  requireResponse(created, 201, `Could not create the ${label.name} label`);
}

function inboxIssueResult(issue, created) {
  if (!Number.isInteger(issue?.number) || issue.number < 1) {
    throw new Error("GitHub returned an inbox Issue without a valid number.");
  }
  if (typeof issue.html_url !== "string" || issue.html_url.length === 0) {
    throw new Error("GitHub returned an inbox Issue without a valid URL.");
  }

  return {
    number: issue.number,
    url: issue.html_url,
    created
  };
}

export async function saveReleaseRequestIssue({
  request,
  actor,
  actorId,
  workflowRunUrl,
  submittedAt,
  githubRequest
}) {
  if (typeof githubRequest !== "function") {
    throw new TypeError("githubRequest must be a function.");
  }

  const checksum = releaseRequestChecksum(request);
  const existingIssues = await findReleaseRequestIssues({
    githubRequest,
    requestId: request.request_id
  });

  if (existingIssues.length > 1) {
    throw new Error(
      `More than one inbox Issue exists for release request ${request.request_id}.`
    );
  }

  if (existingIssues.length === 1) {
    const saved = parseSavedIssue(existingIssues[0].body);
    if (saved.requestId !== request.request_id || saved.checksum !== checksum) {
      throw new Error(
        `Release request ${request.request_id} already exists with different JSON.`
      );
    }
    return {
      checksum,
      issue: inboxIssueResult(existingIssues[0], false)
    };
  }

  const targetLabel = TARGET_LABELS[request.target];
  if (!targetLabel) {
    throw new Error(`Unsupported release target: ${request.target}.`);
  }

  const body = buildReleaseRequestIssueBody({
    request,
    checksum,
    actor,
    actorId,
    workflowRunUrl,
    submittedAt
  });

  for (const label of [REQUEST_LABEL, PENDING_LABEL, targetLabel]) {
    await ensureLabel(githubRequest, label);
  }

  const response = await githubRequest({
    method: "POST",
    path: "/issues",
    body: {
      title: releaseRequestIssueTitle(request.request_id),
      body,
      labels: [REQUEST_LABEL.name, PENDING_LABEL.name, targetLabel.name]
    }
  });
  const issue = requireResponse(response, 201, "Could not create the inbox Issue");

  return {
    checksum,
    issue: inboxIssueResult(issue, true)
  };
}
