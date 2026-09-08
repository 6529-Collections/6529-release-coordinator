import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Override only for the documented local assessment of an already installed
// consumer package. No package is downloaded and no product source is changed.
const packageDirectory = await realpath(process.env.RELEASE_REQUEST_TEST_PACKAGE_DIR
  ? path.resolve(process.env.RELEASE_REQUEST_TEST_PACKAGE_DIR)
  : fileURLToPath(new URL("../", import.meta.url)));
const packageRequire = createRequire(path.join(packageDirectory, "package.json"));
const ajvRequire = createRequire(packageRequire.resolve("ajv/package.json"));
const uri = ajvRequire("fast-uri");
const uriVersion = ajvRequire("fast-uri/package.json").version;

// Public advisory examples and the maintainer's IDN regression case.
// See docs/security/fast-uri-assessment.md for the four source advisories.
const payloads = [
  "//127\u30020\u30020\u30021/private",
  "http://[::not-valid]/private",
  "http://[fc00::not-hex]/private",
  "http://[fe80::not-hex]/private",
  "http://%256c%256f%2563%2561%256c%2568%256f%2573%2574/",
  "%2f%2fevil.example:/pwn",
  "%u002f%u002fevil.example:/pwn",
  "http%0d%0aInjected:/path"
];

function stringPaths(value, prefix = []) {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => stringPaths(child, [...prefix, key]));
}

function replaceAt(value, keys, replacement) {
  const copy = structuredClone(value);
  let parent = copy;
  for (const key of keys.slice(0, -1)) parent = parent[key];
  parent[keys.at(-1)] = replacement;
  return copy;
}

function makeGitHubFixture() {
  const repository = "6529-Collections/6529-release-coordinator";
  const runUrl = `https://github.com/${repository}/actions/runs/1`;
  const calls = [];
  let dispatched;
  return {
    calls,
    get request() { return dispatched; },
    async runGh(args, options = {}) {
      calls.push(args);
      const step = calls.length;
      const expected = [
        ["auth", "status", "--hostname", "github.com"],
        ["workflow", "run", "submit-release-request.yml", "--repo", repository, "--ref", "main", "--json"],
        ["run", "watch", "1", "--repo", repository, "--exit-status"],
        ["run", "view", "1", "--repo", repository, "--log"]
      ];
      assert.deepEqual(args, expected[step - 1], "Request text must not change GitHub routing or arguments");
      let stdout = "";
      if (step === 2) {
        const input = JSON.parse(options.input);
        dispatched = JSON.parse(input.request_json);
        assert.equal(input.request_id, dispatched.request_id);
        stdout = runUrl;
      } else if (step === 4) {
        const result = {
          status: "submitted",
          request_id: dispatched.request_id,
          inbox_issue_number: 1,
          inbox_issue_url: `https://github.com/${repository}/issues/1`,
          request: dispatched
        };
        stdout = `RELEASE_REQUEST_RESULT=${Buffer.from(JSON.stringify(result)).toString("base64url")}\n`;
      }
      return { exitCode: 0, stdout, stderr: "" };
    }
  };
}

test("release-request input cannot reach fast-uri address normalization", async t => {
  const uriCalls = [];
  for (const [name, original] of Object.entries(uri)) {
    if (typeof original !== "function") continue;
    t.mock.method(uri, name, function (...args) {
      uriCalls.push({ name, args: structuredClone(args) });
      return Reflect.apply(original, this, args);
    });
  }

  let externalAttempts = 0;
  const forbidExternal = () => {
    externalAttempts += 1;
    throw new Error("This local assessment forbids real network calls and child processes");
  };
  t.mock.method(globalThis, "fetch", forbidExternal);
  t.mock.method(net.Socket.prototype, "connect", forbidExternal);
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    t.mock.method(childProcess, name, forbidExternal);
  }
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  // Positive controls: inspect the installed library itself, independently of
  // the CLI boundary. A vulnerable consumer version must not give a false
  // sense of safety merely because the Coordinator uses a patched version.
  const direct = payloads.map(input => {
    try {
      const output = input.startsWith("//")
        ? uri.resolve("http://trusted.example/base", input) : uri.normalize(input);
      return { input, output };
    } catch (error) {
      return { input, error: error.message };
    }
  });
  assert.equal(uriCalls.length, payloads.length, "The tracer must observe the direct probes");
  t.diagnostic(JSON.stringify({ packageDirectory, fastUriVersion: uriVersion, directProbes: direct }));
  uriCalls.length = 0;

  const api = await import(pathToFileURL(path.join(packageDirectory, "src/index.mjs")));
  const transport = await import(pathToFileURL(path.join(packageDirectory, "src/github-submission.mjs")));
  assert.ok(uriCalls.length > 0, "The tracer must observe Ajv compiling the bundled schema");
  const startupCalls = uriCalls.length;
  uriCalls.length = 0;

  const fixture = JSON.parse(await readFile(path.join(packageDirectory, "release-request.example.json"), "utf8"));
  fixture.release_parts[0].deploy_units = ["dbMigrationsLoop", "api"];
  fixture.release_parts[0].deploy_dependencies = [{ before: "dbMigrationsLoop", after: "api" }];
  assert.equal(api.validateReleaseRequest(fixture).ok, true);
  const locations = stringPaths(fixture);

  await t.test("crafted addresses remain data in every string field", () => {
    for (const input of payloads) {
      for (const location of locations) {
        const request = replaceAt(fixture, location, input);
        const before = structuredClone(request);
        const result = api.validateReleaseRequest(request);
        assert.equal(typeof result.ok, "boolean");
        assert.deepEqual(request, before, "Validation must not normalize or alter input");
        assert.equal(uriCalls.length, 0, `fast-uri reached from ${location.join("/")}`);
      }
    }
  });

  await t.test("request fields cannot install a schema or remote reference", () => {
    for (const input of payloads) {
      for (const field of ["$schema", "$id", "$ref", "loadSchema", "uriResolver"]) {
        for (const location of [[], ["release_parts", "0"], ["release_parts", "0", "pull_requests", "0"]]) {
          const request = replaceAt(fixture, [...location, field], input);
          assert.equal(api.validateReleaseRequest(request).ok, false);
          assert.equal(uriCalls.length, 0);
        }
      }
    }
  });

  await t.test("accepted free text survives local creation and simulated GitHub submission unchanged", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "6529-fast-uri-boundary-"));
    try {
      for (const input of payloads) {
        const draft = structuredClone(fixture);
        for (const key of ["schema_version", "request_id", "created_at"]) delete draft[key];
        draft.requested_by = input;
        const github = makeGitHubFixture();
        const result = await api.submitReleaseRequestRun({
          projectDirectory: directory,
          readInput: async () => JSON.stringify(draft),
          submitRequest: ({ request }) => transport.submitReleaseRequestToGitHub({ request, runGh: github.runGh })
        });
        assert.equal(result.ok, true);
        assert.equal(github.calls.length, 4);
        assert.equal(github.request.requested_by, input);
        const saved = JSON.parse(await readFile(path.join(directory, result.requestPath), "utf8"));
        assert.equal(saved.requested_by, input);
        assert.equal(api.validateReleaseRequest(saved).ok, true);
        assert.equal(uriCalls.length, 0);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  assert.equal(externalAttempts, 0);
  t.diagnostic(JSON.stringify({
    startupResolverCalls: startupCalls,
    validationCases: payloads.length * locations.length,
    schemaInjectionCases: payloads.length * 5 * 3,
    simulatedSubmissions: payloads.length,
    requestTimeResolverCalls: uriCalls.length,
    externalAttempts
  }));
});
