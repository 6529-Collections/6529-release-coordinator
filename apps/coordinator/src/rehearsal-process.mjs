import { spawn } from "node:child_process";
import { RehearsalError } from "./rehearsal-plan.mjs";

// Only trusted adapters supply executable/argument arrays. Never expose stderr
// or spawn errors: Git/GitHub errors can contain credentials and input content.
export function runRehearsalProcess(file, args, {
  cwd, env, input, signal, timeout = 30_000, maxOutput = 16 * 1024 * 1024,
  allowedCodes = [0], watch
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new RehearsalError("interrupted", "Rehearsal was interrupted.")); return; }
    const child = spawn(file, args, { cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let failure;
    let finished = false;
    let size = 0;
    const chunks = [];
    let forceTimer;
    function kill(sig) {
      try { if (process.platform === "win32") child.kill(sig); else process.kill(-child.pid, sig); } catch { /* Already exited. */ }
    }
    function stop(code, message) {
      if (failure || finished) return;
      failure = new RehearsalError(code, message);
      kill("SIGTERM"); forceTimer = setTimeout(() => kill("SIGKILL"), 200);
    }
    const timer = setTimeout(() => stop("timeout", "Rehearsal operation timed out."), timeout);
    const abort = () => stop("interrupted", "Rehearsal was interrupted.");
    signal?.addEventListener("abort", abort, { once: true });
    let watching = false;
    const watchTimer = watch ? setInterval(() => {
      if (watching || failure) return;
      watching = true;
      void Promise.resolve().then(watch).catch(() => stop("resource_limit", "Temporary repository exceeded its storage limit.")).finally(() => { watching = false; });
    }, 250) : null;
    child.stdout.on("data", chunk => { size += chunk.length; if (size > maxOutput) stop("output_limit", "Rehearsal operation exceeded its output limit."); else chunks.push(chunk); });
    child.stderr.on("data", chunk => { size += chunk.length; if (size > maxOutput) stop("output_limit", "Rehearsal operation exceeded its output limit."); });
    child.stdin.on("error", () => { /* A stopped subprocess can close stdin early. */ });
    child.on("error", () => { failure ??= new RehearsalError("tool_unavailable", "A required rehearsal tool could not start."); });
    child.on("close", code => {
      finished = true;
      if (failure) kill("SIGKILL");
      clearTimeout(timer); clearTimeout(forceTimer); clearInterval(watchTimer);
      signal?.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (!allowedCodes.includes(code)) reject(new RehearsalError("tool_failed", "A rehearsal operation failed; check repository access and the requested objects."));
      else resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") });
    });
    child.stdin.end(input);
  });
}

export function githubEnvironment(base = process.env) {
  const env = { PATH: base.PATH, HOME: base.HOME, LANG: "C", GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_DEBUG: "", NO_COLOR: "1" };
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GH_CONFIG_DIR", "XDG_CONFIG_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    if (base[name]) env[name] = base[name];
  }
  return env;
}
