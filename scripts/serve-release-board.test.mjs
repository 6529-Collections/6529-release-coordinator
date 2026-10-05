import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { Agent, request } from "node:http";
import { createReleaseBoardServer } from "./serve-release-board.mjs";

async function serverFixture(t, cleanup, options = {}) {
  const server = createReleaseBoardServer({
    ...options,
    cleanup,
    readBoard: async () => "__CLEANUP_TOKEN__"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      })
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = await (await fetch(origin)).text();
  const start = (extra = {}) =>
    fetch(`${origin}/api/cleanup`, {
      method: "POST",
      headers: { Origin: origin, "X-Release-Board-Token": token },
      ...extra
    });
  const state = async () => (await fetch(`${origin}/api/cleanup`)).json();
  return { server, origin, token, start, state };
}

test("local cleanup refuses other origins, missing tokens, arbitrary parameters and DNS rebinding hosts", async (t) => {
  let runs = 0;
  const f = await serverFixture(t, () => {
    runs++;
  });
  assert.match(f.token, /^[0-9a-f]{64}$/u);
  assert.equal(
    (await fetch(`${f.origin}/api/cleanup`, { method: "POST" })).status,
    403
  );
  assert.equal(
    (
      await f.start({
        headers: {
          Origin: "https://example.com",
          "X-Release-Board-Token": f.token
        }
      })
    ).status,
    403
  );
  assert.equal(
    (
      await f.start({
        headers: { Origin: f.origin, "X-Release-Board-Token": "wrong" }
      })
    ).status,
    403
  );
  assert.equal(
    (await f.start({ body: JSON.stringify({ command: "deploy" }) })).status,
    400
  );
  const rebound = await new Promise((resolve, reject) => {
    const req = request(
      f.origin,
      { headers: { Host: "evil.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      }
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(rebound, 403);
  assert.equal((await fetch(`${f.origin}/package.json`)).status, 404);
  assert.equal(runs, 0);
});

test("button endpoint starts only fixed real-inbox cleanup, exposes progress and rejects double clicks", async (t) => {
  let finish, options;
  const f = await serverFixture(t, async (input) => {
    options = input;
    input.progress({ message: "Checking #253…" });
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  assert.equal((await f.start()).status, 202);
  assert.equal((await f.state()).running, true);
  assert.equal((await f.state()).progress.message, "Checking #253…");
  assert.equal((await f.start()).status, 409);
  assert.equal(options.profile.name, "real");
  assert.equal(options.selectionMode, "inbox");
  assert.equal(options.resume, undefined);
  const result = {
    run_id: "test",
    counts: { closed: 2, action_needed: 3, unchanged: 1 },
    release_executed: false
  };
  finish(result);
  const state = await f.state();
  assert.equal(state.running, false);
  assert.deepEqual(state.result, result);
});

test("runtime failures offer same-run resume only after the cleanup exits", async (t) => {
  const id = "11111111-1111-4111-8111-111111111111";
  let calls = 0;
  const f = await serverFixture(t, async (options) => {
    if (++calls === 1) {
      const error = new Error("Inspect partial cleanup.");
      error.cleanupRunId = id;
      throw error;
    }
    assert.equal(options.resume, id);
    return {
      run_id: id,
      counts: { closed: 1, action_needed: 0, unchanged: 0 }
    };
  });
  await f.start();
  assert.equal((await f.state()).resume, id);
  await f.start();
  const state = await f.state();
  assert.equal(state.error, null);
  assert.equal(state.resume, null);
  assert.equal(state.result.run_id, id);
});

test("synchronous cleanup throws reset the board task and allow a later retry", async (t) => {
  let calls = 0;
  const f = await serverFixture(t, () => {
    if (++calls === 1) throw new Error("Synchronous cleanup failure.");
    return { run_id: "test", release_executed: false };
  });
  assert.equal((await f.start()).status, 202);
  let state = await f.state();
  assert.equal(state.running, false);
  assert.equal(state.error, "Synchronous cleanup failure.");
  assert.equal(state.resume, null);
  assert.equal((await f.start()).status, 202);
  state = await f.state();
  assert.equal(calls, 2);
  assert.equal(state.running, false);
  assert.equal(state.error, null);
  assert.equal(state.result.run_id, "test");
});

test("rejected POST bodies drain without blocking a subsequent request on the same socket", async (t) => {
  let calls = 0;
  const f = await serverFixture(t, () => {
    calls++;
  });
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const send = (method, headers = {}, body) =>
    new Promise((resolve, reject) => {
      const req = request(
        `${f.origin}/api/cleanup`,
        { method, agent, headers },
        (response) => {
          response.resume();
          response.once("end", () =>
            resolve({ status: response.statusCode, socket: req.socket })
          );
          response.once("error", reject);
        }
      );
      req.once("error", reject);
      req.end(body);
    });
  const body = Buffer.alloc(512 * 1024, "x");
  for (const headers of [
    { Host: "evil.example" },
    { Origin: "https://example.com" },
    { Origin: f.origin, "X-Release-Board-Token": "wrong" },
    { Origin: f.origin, "X-Release-Board-Token": f.token }
  ]) {
    const rejected = await send(
      "POST",
      { ...headers, "Content-Length": body.length },
      body
    );
    assert.equal(
      rejected.status,
      headers["X-Release-Board-Token"] === f.token ? 400 : 403
    );
    const next = await send("GET");
    assert.equal(next.status, 200);
    assert.equal(next.socket, rejected.socket);
  }
  assert.equal(calls, 0);
});

test("trusted stopped-run bootstrap shows Resume without starting cleanup or accepting a browser run ID", async (t) => {
  const id = "11111111-1111-4111-8111-111111111111";
  let calls = 0;
  const f = await serverFixture(
    t,
    async (options) => {
      calls++;
      assert.equal(options.resume, id);
      return {
        run_id: id,
        counts: { closed: 0, action_needed: 0, unchanged: 1 }
      };
    },
    { interruptedCleanup: { run_id: id, message: "Stopped. Progress saved." } }
  );
  const state = await f.state();
  assert.equal(calls, 0);
  assert.equal(state.running, false);
  assert.equal(state.error, "Stopped. Progress saved.");
  assert.equal(state.resume, id);
  assert.equal(
    (await f.start({ body: JSON.stringify({ resume: "another run" }) })).status,
    400
  );
  assert.equal(calls, 0);
  await f.start();
  assert.equal(calls, 1);
  assert.equal((await f.state()).resume, null);
  assert.throws(
    () =>
      createReleaseBoardServer({ interruptedCleanup: { run_id: "invalid" } }),
    /verified saved run/u
  );
});

test("a trusted handoff disables cleanup and refuses even a valid button request", async (t) => {
  let calls = 0;
  const reason = "Stopped. Release lane handed to the other chat.";
  const f = await serverFixture(
    t,
    async () => {
      calls++;
    },
    { cleanupDisabledReason: reason }
  );
  const state = await f.state();
  assert.equal(state.available, false);
  assert.equal(state.running, false);
  assert.equal(state.resume, null);
  assert.equal(state.error, reason);
  assert.equal((await f.start()).status, 409);
  assert.equal(calls, 0);
  assert.throws(
    () => createReleaseBoardServer({ cleanupDisabledReason: "" }),
    /requires a message/u
  );
});
