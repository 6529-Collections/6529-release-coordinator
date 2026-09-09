import { selectProfile, validateProfileRequest } from "./profiles.mjs";
import { saveOrganizedReleaseRequestIssue } from "./ticket-presentation.mjs";

// Both inbox workflows execute this same implementation. GitHub supplies the
// repository/actor identity; neither is accepted from the submitted request.
export async function runIntake({ env = process.env, fetcher = fetch, save = saveOrganizedReleaseRequestIssue,
  stdout = text => process.stdout.write(text) } = {}) {
  const requestId = env.REQUEST_ID ?? "";
  const runUrl = `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  const github = { actor: env.GITHUB_ACTOR, actor_id: env.GITHUB_ACTOR_ID,
    workflow_run_id: env.GITHUB_RUN_ID, workflow_run_url: runUrl };
  const emit = result => stdout(`RELEASE_REQUEST_RESULT=${Buffer.from(JSON.stringify(result)).toString("base64url")}\n`);
  try {
    const profile = selectProfile(env.RELEASE_COORDINATOR_PROFILE);
    if (env.GITHUB_REPOSITORY !== profile.inbox.full_name || String(env.GITHUB_REPOSITORY_ID) !== String(profile.inbox.id)
      || env.GITHUB_SERVER_URL !== "https://github.com" || env.GITHUB_REF !== "refs/heads/main"
      || !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? "") || !/^[1-9][0-9]*$/u.test(env.GITHUB_ACTOR_ID ?? "")
      || !/^[a-zA-Z0-9-]+$/u.test(env.GITHUB_ACTOR ?? "") || !env.GH_TOKEN) throw new Error("Workflow repository, ref, actor, or authentication does not match the selected inbox.");
    if (typeof env.REQUEST_JSON !== "string" || Buffer.byteLength(env.REQUEST_JSON) > 64 * 1024) throw new Error("Request must be JSON of at most 64 KiB.");
    let request;
    try { request = JSON.parse(env.REQUEST_JSON); } catch { throw new Error("Request is not valid JSON."); }
    const validation = validateProfileRequest(request, profile);
    if (!validation.ok || request.request_id !== requestId) throw new Error("Request does not match the selected profile's schema or request ID.");
    const githubRequest = async ({ method, path, body }) => {
      if (!/^\/(issues|labels|assignees)(?:[/?]|$)/u.test(path) || path.includes("..") || path.includes("#")) throw new Error("Unsupported inbox presentation endpoint.");
      const result = await fetcher(`https://api.github.com/repos/${profile.inbox.full_name}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${env.GH_TOKEN}`,
          "content-type": "application/json", "x-github-api-version": "2022-11-28" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      let data;
      try { data = await result.json(); } catch { data = null; }
      return { status: result.status, data };
    };
    const inbox = await save({ request, actor: env.GITHUB_ACTOR, actorId: env.GITHUB_ACTOR_ID,
      workflowRunUrl: runUrl, submittedAt: new Date().toISOString(), githubRequest });
    emit({ status: "submitted", profile: profile.name, request_id: request.request_id,
      inbox_issue_number: inbox.issue.number, inbox_issue_url: inbox.issue.url,
      inbox_presentation: inbox.presentation ?? null, github, request });
    return 0;
  } catch (error) {
    emit({ status: "failed", request_id: requestId, reason: error.message,
      inbox_issue_number: null, inbox_issue_url: null, github });
    return 1;
  }
}
