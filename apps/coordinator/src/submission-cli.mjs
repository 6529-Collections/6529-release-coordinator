import { randomUUID } from "node:crypto";
import { selectProfile, validateProfileRequest } from "./profiles.mjs";
import { createGitHubReader } from "./github-reader.mjs";
import { readInbox } from "./inbox-reader.mjs";
import { executeGitHub } from "./coordinator-github.mjs";
import { releaseRequestChecksum } from "../../../packages/release-request/src/inbox-issue.mjs";
import { readRehearsalManifest } from "./rehearsal-cli.mjs";
import { saveProfileRecord } from "./profile-records.mjs";

const help = `Submit a complete request JSON to one explicitly selected inbox.
RELEASE_COORDINATOR_PROFILE=sandbox|real npm run request:submit -- --input FILE [--json]
Sandbox requests require profile: sandbox and the exact test repository names.
Real requests use the existing public request schema. This dispatches intake,
saves local submission records, and waits up to five minutes for verified receipt.
Exit 0 = receipt verified; 2 = invalid input or uncertain/failed submission.
Never retry blindly after uncertainty: inspect the saved record and inbox first.
--help performs no reads or writes. No merge, rehearsal, or deployment is started.
`;

export async function dispatchRequest(request, profile, { execute = executeGitHub } = {}) {
  const endpoint = `repos/${profile.inbox.full_name}/actions/workflows/${profile.workflow}/dispatches`;
  const output = await execute(["api", "--hostname", "github.com", "--method", "POST", endpoint,
    "--include", "--input", "-"], { ref: profile.branch, inputs: { request_id: request.request_id, request_json: JSON.stringify(request) } });
  if (!/^HTTP\/\S+ 204\b/u.test(output)) throw new Error("Intake dispatch did not return a confirmed acceptance; inspect the inbox before retrying.");
}

export async function submitProfileRequest(request, { profile, get = createGitHubReader({ profile }), dispatch = dispatchRequest,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now, timeout = 300_000 } = {}) {
  if (!validateProfileRequest(request, profile).ok) throw new Error("Request does not match the selected profile's schema.");
  await get.identity?.();
  const checksum = releaseRequestChecksum(request);
  const inspect = async () => {
    const report = await readInbox({ get, profile, includeClosed: true });
    const matches = report.requests.filter(entry => entry.request?.request_id === request.request_id);
    if (matches.length > 1 || matches.some(entry => releaseRequestChecksum(entry.request) !== checksum)) throw new Error("Request identity already exists with different or duplicated data; no dispatch is safe.");
    return matches[0];
  };
  let entry = await inspect();
  const reused = !!entry;
  if (!entry) await dispatch(request, profile);
  const deadline = now() + timeout;
  for (;;) {
    if (entry?.status === "valid") return { status: "submitted", profile: profile.name, repository: profile.inbox.full_name,
      request_id: request.request_id, checksum, reused, issue_number: entry.issue_number, issue_url: entry.issue_url,
      issue_state: entry.issue_state, github_actor: entry.github_actor, workflow: entry.workflow, release_authorized: false };
    if (entry?.status === "invalid") throw new Error("The matching ticket failed receipt verification; inspect the inbox before retrying.");
    if (now() >= deadline) throw new Error("Receipt is not yet verified; intake may still be running. Inspect the saved request and inbox before retrying.");
    await pause(3000);
    entry = await inspect();
  }
}

export async function runSubmissionCli(args, { env = process.env, load = readRehearsalManifest, submit = submitProfileRequest,
  save = saveProfileRecord, root = process.cwd(), stdout = value => process.stdout.write(value), stderr = value => process.stderr.write(value) } = {}) {
  if (args.length === 1 && args[0] === "--help") { stdout(help); return 0; }
  const json = args.includes("--json");
  let profile, attempt, prepared;
  try {
    if (![2, 3].includes(args.length) || args[0] !== "--input" || !args[1] || args[1].startsWith("--") || args.length === 3 && args[2] !== "--json") throw new Error(help);
    profile = selectProfile(env.RELEASE_COORDINATOR_PROFILE);
    const request = await load(args[1]);
    if (!validateProfileRequest(request, profile).ok) throw new Error("Request does not match the selected profile's schema.");
    attempt = randomUUID();
    prepared = await save(profile, `${attempt}.prepared.json`, { profile: profile.name, repository: profile.inbox.full_name,
      attempt_id: attempt, status: "prepared", request, checksum: releaseRequestChecksum(request), created_at: new Date().toISOString() }, root);
    const result = await submit(request, { profile });
    const record = await save(profile, `${attempt}.result.json`, result, root);
    stdout(json ? `${JSON.stringify({ ...result, record_file: record }, null, 2)}\n` : `Verified ${profile.name} receipt: ${result.issue_url}\nRecord: ${record}\n`);
    return 0;
  } catch (error) {
    const failure = { status: "unknown", profile: profile?.name, release_authorized: false, error: error.message, prepared_record: prepared };
    if (prepared) {
      try { await save(profile, `${attempt}.result.json`, failure, root); }
      catch (recordError) { failure.result_record_error = recordError.message; }
    }
    if (json) stdout(`${JSON.stringify(failure, null, 2)}\n`); else stderr(`${failure.error}\n`);
    return 2;
  }
}
