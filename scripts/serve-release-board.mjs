import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { cleanupInbox } from "../apps/coordinator/src/inbox-cleanup.mjs";
import { realProfile } from "../apps/coordinator/src/profiles.mjs";

const page = new URL("../release-board.html", import.meta.url);

export function createReleaseBoardServer({
  cleanup = cleanupInbox,
  readBoard = () => readFile(page, "utf8"),
  interruptedCleanup = null,
  cleanupDisabledReason = null
} = {}) {
  // A trusted local operator may restore a stopped task's presentation after
  // verifying its journal and that the prior process/in-flight calls stopped.
  // No browser input can seed a run, and this never starts cleanup by itself.
  if (
    interruptedCleanup &&
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(
      interruptedCleanup.run_id ?? ""
    )
  )
    throw new Error("Interrupted cleanup must name its verified saved run.");
  if (
    cleanupDisabledReason !== null &&
    (typeof cleanupDisabledReason !== "string" ||
      !cleanupDisabledReason ||
      interruptedCleanup)
  )
    throw new Error(
      "Disabled cleanup requires a message and no resumable run."
    );
  const token = randomBytes(32).toString("hex");
  const task = {
    running: false,
    progress: null,
    result: null,
    error:
      cleanupDisabledReason ??
      (interruptedCleanup
        ? (interruptedCleanup.message ?? "Stopped. Progress saved.")
        : null),
    resume: interruptedCleanup?.run_id ?? null
  };
  const json = (response, status, value) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(value));
  };
  const server = createServer((request, response) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.host !== new URL(origin).host) {
      json(response, 403, { error: "Unexpected board host." });
      return;
    }
    const path = new URL(request.url, origin).pathname;
    if (path === "/api/cleanup" && request.method === "GET") {
      json(response, 200, {
        available: cleanupDisabledReason === null,
        ...task
      });
      return;
    }
    if (path === "/api/cleanup" && request.method === "POST") {
      if (
        request.headers.origin !== origin ||
        request.headers["x-release-board-token"] !== token
      ) {
        json(response, 403, { error: "Run cleanup from this board's button." });
        return;
      }
      if (
        request.headers["transfer-encoding"] ||
        Number(request.headers["content-length"] ?? 0) !== 0
      ) {
        request.resume();
        json(response, 400, {
          error: "Cleanup accepts no request parameters."
        });
        return;
      }
      if (cleanupDisabledReason !== null) {
        json(response, 409, { available: false, ...task });
        return;
      }
      if (task.running) {
        json(response, 409, { error: "Cleanup is already running.", ...task });
        return;
      }
      task.running = true;
      task.error = null;
      task.result = null;
      task.progress = { message: "Starting cleanup…" };
      // This endpoint always uses the real inbox. Browser input cannot select
      // a command, repository, profile, scope or release action.
      void Promise.resolve()
        .then(() =>
          cleanup({
            profile: realProfile,
            selectionMode: "inbox",
            resume: task.resume ?? undefined,
            progress: (progress) => {
              task.progress = progress;
            }
          })
        )
        .then(
          (result) => {
            task.result = result;
            task.resume = null;
            task.progress = null;
            task.running = false;
          },
          (error) => {
            task.error = error.message;
            // Resume is offered only after this server observed its own task exit.
            task.resume = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(
              error.cleanupRunId ?? ""
            )
              ? error.cleanupRunId
              : null;
            task.progress = null;
            task.running = false;
          }
        );
      json(response, 202, { available: true, ...task });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, {
        Allow: path === "/api/cleanup" ? "GET, POST" : "GET, HEAD"
      });
      response.end();
      return;
    }
    if (!["/", "/release-board.html"].includes(path)) {
      response.writeHead(404);
      response.end();
      return;
    }
    void readBoard().then(
      (html) => {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY"
        });
        response.end(
          request.method === "HEAD"
            ? undefined
            : html.replace("__CLEANUP_TOKEN__", token)
        );
      },
      () => {
        response.writeHead(500);
        response.end("The release board could not be read.");
      }
    );
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const port = args.length ? Number(args[1]) : 0;
  if (
    args.length &&
    (args.length !== 2 ||
      args[0] !== "--port" ||
      !/^[1-9][0-9]*$/u.test(args[1]) ||
      port > 65535)
  ) {
    console.error("Usage: node scripts/serve-release-board.mjs [--port PORT]");
    process.exitCode = 2;
  } else {
    const server = createReleaseBoardServer();
    server.listen(port, "127.0.0.1", () => {
      console.log(`Release board: http://127.0.0.1:${server.address().port}/`);
    });
  }
}
