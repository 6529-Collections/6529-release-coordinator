import { serviceAssert } from "./service-contract.mjs";

// GitHub can indirectly merge a PR whenever its original head enters main.
// Preserve selected PR history, but refuse to consume another open main PR
// merely because it happens to be an ancestor of the selected code.
export async function assertSelectedSourceHistory({
  get,
  repository,
  sourcePrs,
  base,
  candidate,
  ignored = [],
  signal
}) {
  const selected = new Set(sourcePrs.map((pr) => pr.number));
  const seen = new Set();
  const comparisons = new Map();
  const ancestor = async (head, target) => {
    signal?.throwIfAborted();
    if (head === target) return true;
    const identity = `${head}...${target}`;
    if (comparisons.has(identity)) return comparisons.get(identity);
    // Only ancestry is needed; do not download the full commit/diff history.
    const comparison = await get(`/compare/${head}...${target}?per_page=1`);
    signal?.throwIfAborted();
    serviceAssert(
      comparison?.base_commit?.sha === head &&
        ["ahead", "behind", "identical", "diverged"].includes(
          comparison.status
        ) &&
        /^[0-9a-f]{40}$/u.test(comparison.merge_base_commit?.sha ?? "") &&
        (!["ahead", "identical"].includes(comparison.status) ||
          comparison.merge_base_commit.sha === head),
      "source-history",
      "Cannot verify which original PR histories would enter main."
    );
    const result = ["ahead", "identical"].includes(comparison.status);
    comparisons.set(identity, result);
    return result;
  };
  for (let page = 1; ; page++) {
    signal?.throwIfAborted();
    const pulls = await get(
      `/pulls?state=open&base=main&per_page=100&page=${page}`
    );
    signal?.throwIfAborted();
    serviceAssert(
      Array.isArray(pulls),
      "source-history",
      "Open source PR listing is incomplete."
    );
    for (const pr of pulls) {
      signal?.throwIfAborted();
      serviceAssert(
        Number.isSafeInteger(pr?.number) &&
          pr.number > 0 &&
          !seen.has(pr.number) &&
          pr.base?.repo?.id === repository.id &&
          /^[0-9a-f]{40}$/u.test(pr.head?.sha ?? ""),
        "source-history",
        "Open source PR listing moved or has an invalid identity."
      );
      seen.add(pr.number);
      if (
        pr.base.ref !== "main" ||
        selected.has(pr.number) ||
        ignored.includes(pr.number) ||
        !(await ancestor(pr.head.sha, candidate))
      )
        continue;
      serviceAssert(
        await ancestor(pr.head.sha, base),
        "source-history",
        `Unselected PR #${pr.number} would also enter main. Keep tickets self-contained or explicitly select its ticket; no shared-branch merge is authorized.`
      );
    }
    if (pulls.length < 100) return;
  }
}
