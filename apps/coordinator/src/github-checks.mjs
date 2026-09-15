function identity(check) {
  if (check.__typename === "CheckRun") {
    const app = check.checkSuite?.app?.databaseId;
    return `run:${Number.isSafeInteger(app) && app > 0 ? app : "unknown"}:${check.name ?? "unknown"}`;
  }
  return `status:${check.context ?? "unknown"}`;
}

function startedAt(check) {
  const value =
    check.__typename === "CheckRun" ? check.startedAt : check.createdAt;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

// GitHub can retain several attempts for one required check on the same commit.
// A newer retry replaces an older attempt. If their order cannot be proven,
// retain every result so the caller fails closed instead of guessing.
export function effectiveRequiredChecks(checks) {
  const groups = new Map();
  for (const check of checks.filter((value) => value.isRequired === true)) {
    const key = identity(check);
    groups.set(key, [...(groups.get(key) ?? []), check]);
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length === 1) return group;
    const dated = group.map((check) => ({ check, time: startedAt(check) }));
    if (dated.some(({ time }) => time === null)) return group;
    const newest = Math.max(...dated.map(({ time }) => time));
    const latest = dated.filter(({ time }) => time === newest);
    return latest.length === 1 ? [latest[0].check] : group;
  });
}
