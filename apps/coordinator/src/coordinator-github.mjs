import { execFile } from "node:child_process";
import { realProfile } from "./profiles.mjs";
import { managedLabels } from "./ticket-presentation.mjs";

export const stateBranch = "codex/inbox-state";
export const stateFile = "inbox-state.json";

const sha = value => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
const keys = (body, allowed) => body && Object.keys(body).every(key => allowed.includes(key));

function allowed(method, path, body) {
  if (method === "GET" && body === undefined) return path === "" || /^\/issues\/[1-9][0-9]*$/u.test(path)
    || /^\/issues\/[1-9][0-9]*\/comments\?per_page=100&page=[1-9][0-9]*$/u.test(path)
    || /^\/assignees\?per_page=100&page=[1-9][0-9]*$/u.test(path)
    || /^\/labels\/[^/?]+$/u.test(path)
    || path === `/git/ref/heads/${stateBranch}`
    || /^\/git\/commits\/[0-9a-f]{40}$/u.test(path)
    || new RegExp(`^/contents/${stateFile.replace(".", "\\.")}\\?ref=[0-9a-f]{40}$`, "u").test(path);
  if (method === "POST" && path === "/labels") return keys(body, ["name", "color"]) && managedLabels.has(body.name) && /^[0-9a-f]{6}$/u.test(body.color);
  if (method === "POST" && /^\/issues\/[1-9][0-9]*\/labels$/u.test(path)) return keys(body, ["labels"])
    && Array.isArray(body.labels) && body.labels.every(label => managedLabels.has(label));
  if (method === "DELETE" && /^\/issues\/[1-9][0-9]*\/labels\/[^/?]+$/u.test(path)) return body === undefined
    && managedLabels.has(decodeURIComponent(path.split("/").at(-1)));
  if (method === "PATCH" && /^\/issues\/[1-9][0-9]*$/u.test(path)) return keys(body, ["title", "labels", "state", "state_reason"])
    && (body.title === undefined || typeof body.title === "string" && body.title.length <= 240)
    && (body.labels === undefined || Array.isArray(body.labels) && body.labels.every(label => typeof label === "string"))
    && (body.state === undefined || ["open", "closed"].includes(body.state))
    && (body.state_reason === undefined || ["completed", "not_planned", "reopened"].includes(body.state_reason));
  if ((method === "POST" && /^\/issues\/[1-9][0-9]*\/comments$/u.test(path))
    || (method === "PATCH" && /^\/issues\/comments\/[1-9][0-9]*$/u.test(path))) return keys(body, ["body"]) && typeof body.body === "string" && body.body.length <= 60_000;
  if (method === "POST" && /^\/issues\/[1-9][0-9]*\/assignees$/u.test(path)) return keys(body, ["assignees"])
    && Array.isArray(body.assignees) && body.assignees.length === 1 && /^[a-zA-Z0-9-]+$/u.test(body.assignees[0]);
  if (method === "POST" && path === "/git/blobs") return keys(body, ["content", "encoding"]) && body.encoding === "utf-8" && typeof body.content === "string";
  if (method === "POST" && path === "/git/trees") return keys(body, ["tree"]) && body.tree?.length === 1
    && body.tree[0].path === stateFile && body.tree[0].mode === "100644" && body.tree[0].type === "blob" && sha(body.tree[0].sha);
  if (method === "POST" && path === "/git/commits") return keys(body, ["message", "tree", "parents"]) && sha(body.tree)
    && typeof body.message === "string" && body.message.startsWith("Inbox journal: ")
    && Array.isArray(body.parents) && body.parents.length <= 1 && body.parents.every(sha);
  if (method === "POST" && path === "/git/refs") return keys(body, ["ref", "sha"]) && body.ref === `refs/heads/${stateBranch}` && sha(body.sha);
  return method === "PATCH" && path === `/git/refs/heads/${stateBranch}` && keys(body, ["sha", "force"]) && sha(body.sha) && body.force === false;
}

export function executeGitHub(args, body) {
  return new Promise((resolve, reject) => {
    const child = execFile("gh", args, { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_DEBUG: "", NO_COLOR: "1" } },
    (error, stdout) => {
      // --include preserves HTTP errors as structured status without exposing
      // raw stderr, credentials, runner logs, or API error bodies.
      if (stdout?.startsWith("HTTP/")) resolve(stdout);
      else if (error) reject(new Error("GitHub request failed before a readable HTTP response; outcome may be unknown."));
      else reject(new Error("GitHub returned no HTTP status."));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export function createCoordinatorGitHub({ execute = executeGitHub, profile = realProfile } = {}) {
  const prefix = `repos/${profile.inbox.full_name}`;
  const call = async (method, path, body) => {
    const args = ["api", "--hostname", "github.com", "--method", method, path, "--include",
      "--header", "Accept: application/vnd.github+json", "--header", "X-GitHub-Api-Version: 2022-11-28"];
    if (body !== undefined) args.push("--input", "-");
    const output = await execute(args, body);
    const match = output.match(/^HTTP\/\S+ (\d{3})[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*)$/u);
    if (!match) throw new Error("GitHub returned an unreadable HTTP response.");
    let data = null;
    try { if (match[2].trim()) data = JSON.parse(match[2]); } catch { throw new Error("GitHub returned unreadable JSON."); }
    return { status: Number(match[1]), data };
  };
  return {
    request: async ({ method, path, body }) => {
      if (!allowed(method, path, body)) throw new Error("Coordinator refused an unsupported GitHub operation.");
      return call(method, `${prefix}${path}`, body);
    },
    identity: async () => {
      const user = await call("GET", "user");
      const repo = await call("GET", prefix);
      if (user.status !== 200 || !Number.isSafeInteger(user.data?.id) || !/^[a-zA-Z0-9-]+$/u.test(user.data?.login)
        || repo.status !== 200 || repo.data?.full_name !== profile.inbox.full_name || repo.data?.id !== profile.inbox.id || repo.data?.private !== profile.inbox.private || repo.data?.permissions?.push !== true) {
        throw new Error("Processing requires an authenticated repository writer with Issue and contents write access.");
      }
      return { login: user.data.login, id: String(user.data.id) };
    }
  };
}
