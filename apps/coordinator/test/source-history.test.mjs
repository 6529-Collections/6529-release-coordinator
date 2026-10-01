import test from "node:test";
import assert from "node:assert/strict";
import { assertSelectedSourceHistory } from "../src/source-history.mjs";

const repository = { id: 1 };
const base = "a".repeat(40),
  candidate = "b".repeat(40);
const pull = (number) => ({
  number,
  base: { ref: "main", repo: repository },
  head: { sha: String(number).repeat(40) }
});
const comparison = (head, status) => ({
  base_commit: { sha: head },
  merge_base_commit: {
    sha: ["ahead", "identical"].includes(status) ? head : base
  },
  status
});
const options = (get) => ({
  get,
  repository,
  base,
  candidate,
  sourcePrs: [pull(1)],
  ignored: [5]
});

test("unselected inherited PR is refused while selected, unrelated and already-main PRs are allowed", async () => {
  const get = async (path) => {
    if (path.startsWith("/pulls?"))
      return [pull(1), pull(2), pull(3), pull(4), pull(5)];
    const [, head, target] = path.match(
      /compare\/([a-f0-9]+)\.\.\.([a-f0-9]+)/u
    );
    return comparison(
      head,
      head === "2".repeat(40) ||
        (head === "4".repeat(40) && target === candidate)
        ? "ahead"
        : "diverged"
    );
  };
  await assert.rejects(
    assertSelectedSourceHistory(options(get)),
    /Unselected PR #4/
  );
  await assertSelectedSourceHistory(
    options(async (path) =>
      path.startsWith("/pulls?")
        ? [pull(1), pull(2), pull(3), pull(5)]
        : get(path)
    )
  );
});

test("missing or repeated pages and unverifiable ancestry stop instead of hiding other PRs", async () => {
  for (const response of [
    null,
    [pull(2), pull(2)],
    [{ ...pull(2), base: { ref: "main", repo: { id: 2 } } }]
  ])
    await assert.rejects(
      assertSelectedSourceHistory(
        options(async (path) =>
          path.startsWith("/pulls?")
            ? response
            : comparison("2".repeat(40), "diverged")
        )
      ),
      /listing/
    );
  await assert.rejects(
    assertSelectedSourceHistory(
      options(async (path) =>
        path.startsWith("/pulls?") ? [pull(2)] : { status: "ahead" }
      )
    ),
    /Cannot verify/
  );
});

test("scans only main PRs and reuses immutable comparisons for duplicate heads", async () => {
  const calls = [];
  await assertSelectedSourceHistory(
    options(async (path) => {
      calls.push(path);
      if (path.startsWith("/pulls?")) {
        assert.match(path, /state=open&base=main&per_page=100/u);
        return [pull(2), { ...pull(3), head: pull(2).head }];
      }
      return comparison(pull(2).head.sha, "diverged");
    })
  );
  assert.equal(calls.filter((path) => path.startsWith("/compare/")).length, 1);
});

test("cancellation interrupts source scans before reads and after page or comparison responses", async () => {
  for (const phase of ["before", "page", "comparison"]) {
    const controller = new AbortController();
    let reads = 0;
    if (phase === "before") controller.abort(new Error("cancel source scan"));
    await assert.rejects(
      assertSelectedSourceHistory({
        ...options(async (path) => {
          reads++;
          if (phase === "page" || path.startsWith("/compare/"))
            controller.abort(new Error("cancel source scan"));
          return path.startsWith("/pulls?")
            ? [pull(2)]
            : comparison(pull(2).head.sha, "diverged");
        }),
        signal: controller.signal
      }),
      /cancel source scan/
    );
    assert.equal(reads, phase === "before" ? 0 : phase === "page" ? 1 : 2);
  }
});
