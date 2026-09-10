import assert from "node:assert/strict";
import {
  buildReleaseRequestIssueBody,
  releaseRequestChecksum
} from "../../../packages/release-request/src/inbox-issue.mjs";
import { stateBranch, stateFile } from "../src/coordinator-github.mjs";
import { realProfile } from "../src/profiles.mjs";

export function fixture(profile = realProfile) {
  const repository = profile.inbox.full_name,
    web = `https://github.com/${repository}`;
  const actor = { login: "trusted-user", id: 456 };
  const request = {
    schema_version: "0.000001",
    ...(profile.name === "sandbox" ? { profile: "sandbox" } : {}),
    request_id: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-09-09T07:00:00.000Z",
    requested_by: "Not the trusted identity",
    target: "staging",
    database_change: "no",
    release_parts: [
      {
        id: "backend",
        repository: profile.repositories.backend.full_name.split("/")[1],
        pull_requests: [
          { number: 10, branch: "feature/test", commit: "a".repeat(40) }
        ],
        depends_on: [],
        deploy_units: ["api", "dbMigrationsLoop"],
        deploy_dependencies: []
      }
    ]
  };
  const issue = {
    id: 1001,
    number: 1,
    title: `Release request ${request.request_id}`,
    state: "open",
    labels: ["release-request", "pending", "target:staging", "user-note"],
    assignees: [],
    user: actor,
    html_url: `${web}/issues/1`,
    body: buildReleaseRequestIssueBody({
      request,
      checksum: releaseRequestChecksum(request),
      actor: actor.login,
      actorId: String(actor.id),
      workflowRunUrl: `${web}/actions/runs/123`,
      submittedAt: request.created_at
    })
  };
  const required = {
    __typename: "CheckRun",
    id: "build",
    name: "Build",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    isRequired: true
  };
  const pr = {
    number: 10,
    state: "OPEN",
    isDraft: false,
    headRefOid: "a".repeat(40),
    headRefName: "feature/test",
    baseRefOid: "b".repeat(40),
    baseRefName: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    repository: { nameWithOwner: profile.repositories.backend.full_name },
    headRepository: { nameWithOwner: profile.repositories.backend.full_name },
    checks: [required]
  };
  const result = {
    status: "submitted",
    ...(profile.name === "sandbox" ? { profile: "sandbox" } : {}),
    request_id: request.request_id,
    request: structuredClone(request),
    inbox_issue_number: 1,
    inbox_issue_url: issue.html_url,
    github: {
      actor: actor.login,
      actor_id: String(actor.id),
      workflow_run_id: "123",
      workflow_run_url: `${web}/actions/runs/123`
    }
  };
  const run = {
    id: 123,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    path: ".github/workflows/submit-release-request.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: "c".repeat(40),
    html_url: `${web}/actions/runs/123`,
    display_title: `Release request ${request.request_id}`,
    status: "completed",
    conclusion: "success",
    actor,
    run_attempt: 1
  };
  const f = {
    profile,
    actor,
    request,
    issue,
    required,
    pr,
    result,
    run,
    issues: [issue],
    calls: [],
    productCalls: [],
    comments: [],
    labels: new Set(issue.labels),
    eligible: [actor],
    head: null,
    objects: new Map(),
    nextId: 2000,
    before: async () => {},
    after: async () => {}
  };
  const clone = structuredClone;
  f.get = async (path) => {
    if (
      path ===
      `repos/${repository}/issues?state=open&labels=release-request&sort=created&direction=asc&per_page=100&page=1`
    ) {
      return clone(
        f.issues.filter(
          (value) =>
            value.state === "open" && value.labels.includes("release-request")
        )
      );
    }
    if (path === `repos/${repository}/actions/runs/123`) return clone(run);
    if (
      path ===
      `repos/${repository}/actions/runs/123/attempts/1/jobs?per_page=100&page=1`
    )
      return {
        jobs: [
          {
            id: 789,
            run_id: 123,
            run_attempt: 1,
            name: "Validate and save request",
            status: "completed",
            conclusion: "success",
            steps: [
              {
                name: "Validate and save the release request",
                status: "completed",
                conclusion: "success"
              }
            ]
          }
        ]
      };
    if (path === `repos/${repository}/actions/jobs/789/logs`)
      return `2026-09-09T07:00:01.000Z RELEASE_REQUEST_RESULT=${Buffer.from(JSON.stringify(result)).toString("base64url")}\n`;
    assert.fail(`Unexpected read ${path}`);
  };
  f.github = {
    pullRequest: async () => {
      f.productCalls.push("pr");
      return clone(pr);
    },
    catalog: async (commit) => ({
      commit,
      blob_sha: "d".repeat(40),
      catalog: {
        services: [
          {
            name: "api",
            allowed_environments: ["staging", "prod"],
            default_dependencies: ["dbMigrationsLoop"]
          },
          {
            name: "dbMigrationsLoop",
            allowed_environments: ["staging", "prod"],
            default_dependencies: []
          }
        ]
      }
    })
  };
  const object = (value) => {
    const sha = (++f.nextId).toString(16).padStart(40, "0");
    f.objects.set(sha, clone(value));
    return sha;
  };
  const route = ({ method, path, body }) => {
    if (method === "GET" && path.startsWith("/labels/"))
      return {
        status: f.labels.has(decodeURIComponent(path.slice(8))) ? 200 : 404
      };
    if (method === "POST" && path === "/labels") {
      f.labels.add(body.name);
      return { status: 201, data: body };
    }
    if (method === "GET" && path === "/assignees?per_page=100&page=1")
      return { status: 200, data: f.eligible };
    if (method === "GET" && path.startsWith("/issues?state=all"))
      return { status: 200, data: f.issues };
    if (method === "POST" && path === "/issues") {
      const created = {
        ...clone(body),
        id: ++f.nextId,
        number: f.issues.length + 1,
        state: "open",
        assignees: [],
        user: actor,
        html_url: `${web}/issues/${f.issues.length + 1}`
      };
      f.issues.push(created);
      return { status: 201, data: created };
    }
    const match = path.match(/^\/issues\/(\d+)(.*)$/u);
    if (match) {
      const issue = f.issues.find((value) => value.number === Number(match[1])),
        tail = match[2];
      assert.ok(issue, `Missing fixture Issue ${match[1]}`);
      if (method === "GET" && !tail) return { status: 200, data: issue };
      if (method === "PATCH" && !tail) {
        assert.equal(body.body, undefined, "Receipt must never be edited");
        Object.assign(issue, clone(body));
        return { status: 200, data: issue };
      }
      if (method === "POST" && tail === "/labels") {
        issue.labels = [...new Set([...issue.labels, ...body.labels])];
        return { status: 200, data: issue.labels };
      }
      if (method === "DELETE" && tail.startsWith("/labels/")) {
        issue.labels = issue.labels.filter(
          (value) => value !== decodeURIComponent(tail.slice(8))
        );
        return { status: 200, data: issue.labels };
      }
      if (method === "POST" && tail === "/assignees") {
        issue.assignees = f.eligible.filter((value) =>
          body.assignees.includes(value.login)
        );
        return { status: 201, data: issue };
      }
      if (method === "GET" && tail === "/comments?per_page=100&page=1")
        return {
          status: 200,
          data: f.comments.filter(
            (value) => value.issue_number === issue.number
          )
        };
      if (method === "POST" && tail === "/comments") {
        const comment = {
          ...body,
          id: ++f.nextId,
          issue_number: issue.number,
          user: actor
        };
        f.comments.push(comment);
        return { status: 201, data: comment };
      }
    }
    if (method === "PATCH" && path.startsWith("/issues/comments/")) {
      const comment = f.comments.find(
        (value) => value.id === Number(path.split("/").at(-1))
      );
      assert.ok(comment);
      Object.assign(comment, body);
      return { status: 200, data: comment };
    }
    if (method === "GET" && path === `/git/ref/heads/${stateBranch}`)
      return { status: f.head ? 200 : 404, data: { object: { sha: f.head } } };
    if (method === "GET" && path.startsWith("/git/commits/")) {
      const commit = f.objects.get(path.split("/").at(-1));
      return {
        status: 200,
        data: { ...commit, parents: commit.parents.map((sha) => ({ sha })) }
      };
    }
    if (method === "GET" && path.startsWith(`/contents/${stateFile}?ref=`)) {
      const commit = f.objects.get(path.split("=").at(-1)),
        tree = f.objects.get(commit.tree),
        blob = f.objects.get(tree.tree[0].sha);
      return {
        status: 200,
        data: {
          type: "file",
          path: stateFile,
          encoding: "base64",
          content: Buffer.from(blob.content).toString("base64")
        }
      };
    }
    if (
      method === "POST" &&
      ["/git/blobs", "/git/trees", "/git/commits"].includes(path)
    )
      return { status: 201, data: { sha: object(body) } };
    if (method === "POST" && path === "/git/refs") {
      if (f.head) return { status: 422 };
      f.head = body.sha;
      return { status: 201, data: { object: { sha: f.head } } };
    }
    if (method === "PATCH" && path === `/git/refs/heads/${stateBranch}`) {
      assert.equal(body.force, false);
      const commit = f.objects.get(body.sha);
      if (commit.parents[0] !== f.head) return { status: 422 };
      f.head = body.sha;
      return { status: 200, data: { object: { sha: f.head } } };
    }
    assert.fail(`Unexpected fixture API ${method} ${path}`);
  };
  f.api = async (call) => {
    f.calls.push(clone(call));
    await f.before(call);
    const result = clone(route(call));
    await f.after(call);
    return result;
  };
  f.identity = async () => ({ login: actor.login, id: String(actor.id) });
  f.state = () => {
    const commit = f.objects.get(f.head),
      tree = f.objects.get(commit.tree),
      blob = f.objects.get(tree.tree[0].sha);
    return JSON.parse(blob.content);
  };
  f.now = () => new Date("2026-09-09T07:00:02.000Z");
  return f;
}
