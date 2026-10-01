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
