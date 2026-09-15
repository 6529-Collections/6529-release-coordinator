const positive = (value) => Number.isSafeInteger(value) && value > 0;
const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");

function checkRunAttempt(check, expectedCommit) {
  const suite = check.checkSuite;
  const run = suite?.workflowRun;
  const app = suite?.app?.databaseId;
  const workflow = run?.workflow?.databaseId;
  if (
    suite?.commit?.oid !== expectedCommit ||
    !positive(app) ||
    !positive(workflow) ||
    !positive(run?.runNumber) ||
    !positive(run?.runAttempt) ||
    typeof check.name !== "string" ||
    !check.name
  )
    return null;
  return {
    identity: `run:${app}:${workflow}:${check.name}`,
    runNumber: run.runNumber,
    runAttempt: run.runAttempt
  };
}

function startedAt(check) {
  const value =
    check.__typename === "CheckRun" ? check.startedAt : check.createdAt;
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

// The caller supplies the exact commit whose rollup it read. GitHub can retain
// several runs of one workflow/check on that commit. Workflow run/attempt
// numbers identify those retries without grouping a same-named check from a
// different workflow. Missing or ambiguous identity retains every result.
export function effectiveRequiredChecks(checks, expectedCommit) {
  if (!sha(expectedCommit))
    throw new TypeError("Required checks need one exact commit.");
  const groups = new Map();
  for (const [index, check] of checks
    .filter((value) => value.isRequired === true)
    .entries()) {
    const attempt =
      check.__typename === "CheckRun"
        ? checkRunAttempt(check, expectedCommit)
        : null;
    const key =
      attempt?.identity ??
      (check.__typename === "StatusContext" && check.context
        ? `status:${check.context}`
        : `unique:${check.id ?? index}`);
    groups.set(key, [...(groups.get(key) ?? []), { check, attempt }]);
  }
  return [...groups.values()].flatMap((group) => {
    if (group.length === 1) return [group[0].check];
    if (group.every(({ attempt }) => attempt)) {
      const runNumber = Math.max(
        ...group.map(({ attempt }) => attempt.runNumber)
      );
      const runAttempt = Math.max(
        ...group
          .filter(({ attempt }) => attempt.runNumber === runNumber)
          .map(({ attempt }) => attempt.runAttempt)
      );
      const latest = group.filter(
        ({ attempt }) =>
          attempt.runNumber === runNumber && attempt.runAttempt === runAttempt
      );
      return latest.length === 1
        ? [latest[0].check]
        : group.map(({ check }) => check);
    }
    const dated = group.map(({ check }) => ({ check, time: startedAt(check) }));
    if (dated.some(({ time }) => time === null))
      return group.map(({ check }) => check);
    const newest = Math.max(...dated.map(({ time }) => time));
    const latest = dated.filter(({ time }) => time === newest);
    return latest.length === 1
      ? [latest[0].check]
      : group.map(({ check }) => check);
  });
}
