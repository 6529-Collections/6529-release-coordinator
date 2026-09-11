import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  constants,
  mkdirSync,
  lstatSync,
  openSync,
  fstatSync,
  readSync,
  writeSync,
  fsyncSync,
  closeSync,
  linkSync,
  unlinkSync
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// Diagnostics only. This context never participates in journal ownership or
// supplies evidence to a decision. Direct library callers need not enable it.
const context = new AsyncLocalStorage();
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const fields = new Set([
  "step",
  "outcome",
  "message",
  "issue_number",
  "request_id",
  "tickets",
  "attempt_id",
  "candidate",
  "repository",
  "role",
  "pr_number",
  "branch",
  "workflow_id",
  "url",
  "expected_commit",
  "head_commit",
  "observed_commit",
  "duration_ms",
  "result_status",
  "cleanup_status",
  "error_code",
  "unit",
  "source_started_at",
  "source_finished_at",
  "exit_code",
  "remaining",
  "recovery",
  "report_file"
]);

export function createRunLog({
  profile,
  resume,
  root = path.join(homedir(), ".6529-release-coordinator", "logs"),
  stderr = (text) => process.stderr.write(text),
  env = process.env,
  now = () => new Date(),
  append = (fd, bytes) => {
    if (writeSync(fd, bytes) !== bytes.length)
      throw new Error("Short log write");
    fsyncSync(fd);
  }
}) {
  if (
    !/^(sandbox|real)$/u.test(profile.name) ||
    !Number.isSafeInteger(profile.inbox.id) ||
    profile.inbox.id <= 0 ||
    (resume && !uuid.test(resume))
  )
    throw new Error("Invalid run log identity.");
  const invocation = randomUUID();
  const directory = path.join(root, profile.name, String(profile.inbox.id));
  // These directories contain private diagnostics, not request-controlled paths.
  for (const dir of [root, path.join(root, profile.name), directory]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.getuid && stat.uid !== process.getuid()) ||
      (process.platform !== "win32" && stat.mode & 0o077)
    )
      throw new Error("Run logs require private, owned local directories.");
  }
  let filename = path.join(
    directory,
    `${resume ?? `startup-${invocation}`}.jsonl`
  );
  const fd = openSync(
    filename,
    constants.O_RDWR |
      constants.O_APPEND |
      constants.O_CREAT |
      (constants.O_NOFOLLOW ?? 0) |
      (resume ? 0 : constants.O_EXCL),
    0o600
  );
  const stat = fstatSync(fd);
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (process.getuid && stat.uid !== process.getuid()) ||
    (process.platform !== "win32" && stat.mode & 0o077)
  ) {
    closeSync(fd);
    throw new Error("Run log must be a private, owned regular file.");
  }
  let incompleteTail = false;
  if (resume && stat.size) {
    try {
      const last = Buffer.alloc(1);
      readSync(fd, last, 0, 1, stat.size - 1);
      incompleteTail = last[0] !== 10;
      // Preserve a crash-truncated record verbatim, but never join a new event
      // onto it. The old partial line remains explicitly untrusted diagnostics.
      if (incompleteTail) append(fd, Buffer.from("\n"));
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        /token|secret|password|credential|(?:api|private)_?key|authorization|cookie/iu.test(
          key
        ) &&
        typeof value === "string" &&
        value.length >= 8
    )
    .map(([, value]) => value);
  const redact = (value) => {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    return (
      text
        .replace(
          /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/gu,
          "[redacted]"
        )
        .replace(/(?:Bearer|Basic)\s+[^\s,;]+/giu, "[redacted authorization]")
        // eslint-disable-next-line no-control-regex -- Explicitly strip terminal escape sequences from diagnostics.
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
        .replace(/\p{Cc}/gu, " ")
        .slice(0, 2000)
    );
  };
  const clean = (value) =>
    typeof value === "string"
      ? redact(value)
      : typeof value === "number" && Number.isFinite(value)
        ? value
        : Array.isArray(value)
          ? value.slice(0, 100).map(clean)
          : null;
  let runId = null,
    complete = true,
    closed = false;
  const started = now().getTime();
  const say = (text) => {
    try {
      stderr(text);
    } catch {
      /* A closed terminal cannot stop journal reconciliation. */
    }
  };
  const failed = () => {
    if (complete)
      say(
        `Run log could not be saved completely: ${filename}. GitHub journal records are preserved.\n`
      );
    complete = false;
  };
  const log = {
    redact,
    run: (fn) => context.run(log, fn),
    event(event) {
      const data = {
        timestamp: now().toISOString(),
        invocation_id: invocation,
        run_id: runId,
        profile: profile.name,
        inbox: profile.inbox.full_name,
        ...Object.fromEntries(
          Object.entries(event)
            .filter(([key]) => fields.has(key))
            .map(([key, value]) => [key, clean(value)])
        )
      };
      const details = [
        data.issue_number && `ticket #${data.issue_number}`,
        data.tickets?.length && `tickets ${data.tickets.join(",")}`,
        data.attempt_id && `attempt ${data.attempt_id}`,
        data.repository,
        data.pr_number && `PR #${data.pr_number}`,
        data.url,
        data.duration_ms !== undefined && `${data.duration_ms}ms`,
        data.result_status,
        data.error_code,
        data.recovery,
        data.remaining?.length && `remaining: ${data.remaining.join(", ")}`
      ]
        .filter(Boolean)
        .join("; ");
      say(
        `${data.timestamp} [${data.outcome}] ${data.step}: ${data.message ?? ""}${details ? ` (${details})` : ""}\n`
      );
      if (complete && !closed) {
        try {
          append(fd, Buffer.from(`${JSON.stringify(data)}\n`));
        } catch {
          failed();
        }
      }
    },
    bind(id, resumed = false) {
      if (!uuid.test(id) || (resume && id !== resume)) {
        failed();
        return;
      }
      runId = id;
      if (!resume && complete) {
        const destination = path.join(directory, `${id}.jsonl`);
        try {
          // A fresh run never replaces any existing history, including symlinks.
          linkSync(filename, destination);
          unlinkSync(filename);
          filename = destination;
        } catch {
          failed();
        }
      }
      say(`Run ${id}; log: ${filename}\n`);
      log.event({
        step: resumed ? "run.resume" : "run.start",
        outcome: "started",
        message: resumed
          ? "Resuming the saved run after explicit operator recovery."
          : "Inbox ownership acquired; starting the saved run."
      });
    },
    snapshot() {
      return {
        file: filename,
        complete,
        invocation_id: invocation,
        run_id: runId,
        previous_tail_incomplete: incompleteTail
      };
    },
    finish({ exitCode, interrupted = false, remaining = [], recovery }) {
      log.event({
        step: "run.finish",
        outcome: interrupted
          ? "interrupted"
          : exitCode === 0
            ? "succeeded"
            : exitCode === 2
              ? "unknown"
              : "failed",
        message:
          exitCode === 0
            ? "Run finished with verified results; no release is authorized."
            : "Run stopped or left unresolved work; no release is authorized.",
        exit_code: exitCode,
        duration_ms: Math.max(0, now().getTime() - started),
        remaining,
        recovery
      });
      say(`Run log: ${filename}${complete ? "" : " (incomplete)"}\n`);
      return log.snapshot();
    },
    close() {
      if (!closed) {
        try {
          closeSync(fd);
        } catch {
          failed();
        }
        closed = true;
      }
    }
  };
  say(`Starting inbox command; log: ${filename}\n`);
  log.event({
    step: "command.start",
    outcome: "started",
    message: resume
      ? `Requested manual resume of run ${resume}.`
      : "Starting inbox inspection."
  });
  if (incompleteTail)
    log.event({
      step: "log.previous-tail",
      outcome: "unknown",
      message:
        "The earlier log ended in an incomplete line. Its bytes were preserved; this does not prove whether the old operation finished."
    });
  return log;
}

export const runEvent = (event) => context.getStore()?.event(event);
export const bindRunLog = (runId, resumed) =>
  context.getStore()?.bind(runId, resumed);
export const logOutcome = (status) =>
  ["pass", "passed", "removed"].includes(status)
    ? "succeeded"
    : ["blocked", "failed", "stale"].includes(status)
      ? "failed"
      : "unknown";

export async function loggedStep(event, operation, summarize = () => ({})) {
  if (!context.getStore()) return operation();
  const started = performance.now();
  runEvent({ ...event, outcome: "started" });
  try {
    const result = await operation();
    runEvent({
      ...event,
      outcome: "succeeded",
      ...summarize(result),
      duration_ms: Math.round(performance.now() - started)
    });
    return result;
  } catch (error) {
    // Never serialize exceptions, raw HTTP bodies or workflow logs. The fixed
    // step and a bounded error code explain where verification stopped.
    runEvent({
      ...event,
      outcome:
        error.name === "AbortError" ? "interrupted" : logOutcome(error.status),
      message: "This step did not produce a verified result.",
      error_code: /^[a-zA-Z0-9_-]{1,80}$/u.test(error.code ?? "")
        ? error.code
        : "unverified",
      duration_ms: Math.round(performance.now() - started)
    });
    throw error;
  }
}
