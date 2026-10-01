import { inspectPull, validatePull } from "./readiness.mjs";
import { serviceAssert } from "./service-contract.mjs";

export async function assertSourcePulls({ sources, repository, pullRequest }) {
  const name = repository.full_name.split("/")[1];
  for (const source of sources) {
    const pr = await pullRequest(source.number);
    validatePull(pr, name, source.number, repository.full_name);
    const checks = inspectPull(pr, source, name, repository.full_name);
    serviceAssert(
      pr.baseRefName === "main" &&
        checks.every((check) => check.status === "pass"),
      "release-source",
      `Source PR #${source.number} changed or no longer passes its required checks and reviews. Stop before merging the owned integration PR.`
    );
  }
}

export async function mergedSourcePulls({ sources, repository, get }) {
  const result = [];
  for (const source of sources) {
    const original = await get(source.number);
    serviceAssert(
      original?.number === source.number &&
        original?.head?.repo?.id === repository.id &&
        original?.base?.repo?.id === repository.id &&
        original.head.ref === source.branch &&
        original.head.sha === source.commit &&
        original.base.ref === "main" &&
        original.merged === true,
      "release-source",
      `Original PR #${source.number} was not marked merged at its requested exact commit; reconcile the saved production merge.`
    );
    result.push({
      number: source.number,
      commit: source.commit,
      url: original.html_url
    });
  }
  return result;
}
