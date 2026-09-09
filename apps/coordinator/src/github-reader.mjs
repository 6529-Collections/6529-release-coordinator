import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realProfile } from "./profiles.mjs";

const executeFile = promisify(execFile);


// No caller-supplied host, repository, command, or HTTP method reaches gh.
// Keep this allowlist limited to the reader's Issue and workflow evidence.
function allowedPath(path, prefix) {
  if (!path.startsWith(`${prefix}/`)) return false;
  const relative = path.slice(prefix.length);
  return /^\/issues\?state=(?:open|all)&labels=release-request&sort=created&direction=asc&per_page=100&page=[1-9][0-9]*$/u.test(relative)
    || /^\/actions\/runs\/[1-9][0-9]*$/u.test(relative)
    || /^\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*\/jobs\?per_page=100&page=[1-9][0-9]*$/u.test(relative)
    || /^\/actions\/jobs\/[1-9][0-9]*\/logs$/u.test(relative);
}

export function createGitHubReader({ execute = executeFile, profile = realProfile } = {}) {
  const prefix = `repos/${profile.inbox.full_name}`;
  async function read(path) {
    const isLog = path.endsWith("/logs");
    const args = [
      "api", "--hostname", "github.com", "--method", "GET", path,
      "--header", "Accept: application/vnd.github+json",
      "--header", "X-GitHub-Api-Version: 2022-11-28"
    ];
    // Runner logs contain ANSI sequences in echoed commands. Read them only
    // into memory; neither raw logs nor GitHub stderr are printed to the user.
    if (isLog) args.push("--allow-escape-sequences");
    let stdout;
    try {
      ({ stdout } = await execute("gh", args, {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          GH_HOST: "github.com",
          GH_PROMPT_DISABLED: "1",
          GH_DEBUG: "",
          NO_COLOR: "1"
        }
      }));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("GitHub CLI (gh) is missing. Install it and authenticate to github.com.");
      }
      throw new Error(
        `GitHub GET failed for ${path}. Check gh auth status, network access, repository/Actions read access, and log availability. A current gh version is required.`,
        { cause: error }
      );
    }
    if (isLog) return stdout;
    try {
      return JSON.parse(stdout);
    } catch {
      throw new Error(`GitHub returned unreadable JSON for ${path}.`);
    }
  }
  const get = async path => {
    if (!allowedPath(path, prefix)) throw new Error("The inbox reader refused an unsupported GitHub endpoint.");
    return read(path);
  };
  get.identity = async () => {
    const repo = await read(prefix);
    if (repo.id !== profile.inbox.id || repo.full_name !== profile.inbox.full_name || repo.private !== profile.inbox.private) {
      throw new Error("Inbox repository identity or visibility does not match the selected profile.");
    }
    return repo;
  };
  return get;
}
