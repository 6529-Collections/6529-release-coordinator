import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoordinatorGitHub,
  executeGitHub
} from "../src/coordinator-github.mjs";

const args = ["api", "--method", "GET", "example", "--include"];
const http = (status, body) =>
  `HTTP/2.0 ${status}\r\nContent-Type: application/json\r\n\r\n${body}`;

function command(error, stdout) {
  const calls = [];
  const execute = (file, argv, options, callback) => {
    const call = { file, args: argv, options };
    calls.push(call);
    queueMicrotask(() => callback(error, stdout));
    return {
      stdin: {
        on: () => {},
        end: (input) => {
          call.input = input;
        }
      }
    };
  };
  return { execute, calls };
}

test("GitHub transport accepts a completed response and keeps fixed command settings", async () => {
  const raw = http("200 OK", '{"ok":true}');
  const f = command(null, raw);
  const body = { title: "Literal $(no shell) `text`" };
  assert.equal(await executeGitHub(args, body, f.execute), raw);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].file, "gh");
  assert.deepEqual(f.calls[0].args, args);
  assert.equal(f.calls[0].input, JSON.stringify(body));
  assert.equal(f.calls[0].options.timeout, 30_000);
  assert.equal(f.calls[0].options.maxBuffer, 16 * 1024 * 1024);
  assert.equal(f.calls[0].options.env.GH_HOST, "github.com");
});

test("ordinary gh HTTP failures retain structured status for callers", async () => {
  for (const status of [404, 422, 500]) {
    const raw = http(`${status} Error`, '{"message":"unavailable"}');
    const f = command({ code: 1 }, raw);
    const client = createCoordinatorGitHub({
      execute: (argv, body) => executeGitHub(argv, body, f.execute)
    });
    assert.deepEqual(
      await client.request({ method: "GET", path: "/issues/41" }),
      { status, data: { message: "unavailable" } }
    );
    assert.equal(f.calls.length, 1);
  }
});

test("interrupted commands reject even when stdout already contains HTTP headers or valid JSON", async () => {
  for (const error of [
    { code: null, killed: true, signal: "SIGTERM" },
    { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
    { code: "ECONNRESET" },
    { code: 1 },
    { code: 2 }
  ]) {
    for (const body of ['{"secret":"private', '{"secret":"private"}']) {
      const f = command(error, http("200 OK", body));
      const client = createCoordinatorGitHub({
        execute: (argv, input) => executeGitHub(argv, input, f.execute)
      });
      await assert.rejects(
        client.request({ method: "GET", path: "/issues/41" }),
        (failure) => {
          assert.match(
            failure.message,
            /did not complete for GET \/issues\/41/u
          );
          assert.match(failure.message, /outcome may be unknown/u);
          assert.doesNotMatch(failure.message, /private|unreadable JSON/u);
          return true;
        }
      );
      assert.equal(
        f.calls.length,
        1,
        "No automatic retry of an uncertain request"
      );
    }
  }
});

test("a killed HTTP error is also an incomplete response", async () => {
  const f = command(
    { code: 1, killed: true, signal: "SIGTERM" },
    http("503 Unavailable", '{"message":"private"}')
  );
  await assert.rejects(
    executeGitHub(args, undefined, f.execute),
    /did not complete/u
  );
});

test("non-JSON HTTP failures identify status and safe operation without exposing the response body", async () => {
  const client = createCoordinatorGitHub({
    execute: async () =>
      http("502 Bad Gateway", "<html>private response</html>")
  });
  await assert.rejects(
    client.request({ method: "GET", path: "/issues/41" }),
    (error) => {
      assert.match(
        error.message,
        /non-JSON HTTP 502 response for GET \/issues\/41/u
      );
      assert.doesNotMatch(error.message, /private|html/u);
      return true;
    }
  );
});

test("missing HTTP status does not expose command or response content", async () => {
  const f = command(
    { code: "ENOENT", message: "private stderr" },
    "private body"
  );
  await assert.rejects(executeGitHub(args, undefined, f.execute), (error) => {
    assert.match(error.message, /did not complete/u);
    assert.doesNotMatch(error.message, /private/u);
    return true;
  });
  const empty = command(null, "private body");
  await assert.rejects(
    executeGitHub(args, undefined, empty.execute),
    /no HTTP status/u
  );
});
