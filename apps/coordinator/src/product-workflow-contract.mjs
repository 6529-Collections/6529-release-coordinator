import {
  monitoringTemplate,
  releaseBuildRoles,
  releaseBuildSourceRole,
  validateReleaseBuild,
  validateReleaseOperation,
  verifyReleaseReport
} from "./release-contract.mjs";

export const productWorkflowReleaseAdapter = "product-workflow-mirror-v1";

const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const sha = (value) =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
const hash = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function expectedWorkflow(role, operation) {
  if (role === "monitoring")
    return ".github/workflows/deploy-operational-monitoring.yml";
  if (role === "backend") return ".github/workflows/deploy.yml";
  return operation.environment === "staging"
    ? ".github/workflows/deploy-staging.yml"
    : ".github/workflows/build-upload-deploy-prod.yml";
}

function artifactName(role, deployment) {
  if (role === "monitoring")
    return `fake-monitoring-${deployment.environment}-${deployment.run_id}`;
  if (role === "backend")
    return `fake-backend-${deployment.environment}-${deployment.unit}-${deployment.run_id}`;
  return `fake-${deployment.environment === "prod" ? "production" : "staging"}-deployment-${deployment.run_id}`;
}

function deploymentsMatch(report, operation, requiredRoles) {
  if (!object(report.deployments)) return false;
  const entries = Object.entries(report.deployments);
  if (
    entries.some(([role, deployment]) => {
      const sourceRole = releaseBuildSourceRole(role);
      const environment =
        role === "monitoring"
          ? operation.monitoring_environment
          : operation.environment;
      return !(
        requiredRoles.includes(role) &&
        object(deployment) &&
        deployment.role === role &&
        deployment.environment === environment &&
        deployment.source_commit === operation[`${sourceRole}_commit`] &&
        (role === "backend"
          ? typeof deployment.unit === "string" &&
            /^[A-Za-z][A-Za-z0-9]{0,80}$/u.test(deployment.unit)
          : deployment.unit === null) &&
        deployment.workflow === expectedWorkflow(role, operation) &&
        typeof deployment.repository === "string" &&
        positive(deployment.run_id) &&
        object(deployment.artifact) &&
        positive(deployment.artifact.id) &&
        deployment.artifact.name === artifactName(role, deployment) &&
        hash(deployment.artifact.digest)
      );
    })
  )
    return false;
  // A failed workflow can stop before it creates an artifact. Validate every
  // deployment it did report, but require the complete role set only on pass.
  return (
    report.status !== "passed" ||
    (entries.length === requiredRoles.length &&
      requiredRoles.every((role) => report.deployments[role]))
  );
}

function installedMatches(report, operation) {
  if (operation.operation !== "monitoring")
    return !Object.hasOwn(report, "installed");
  if (report.status !== "passed")
    return report.installed === null || report.installed === undefined;
  const template = monitoringTemplate(operation.monitoring_environment);
  const file = report.builds?.monitoring?.manifest?.files?.find(
    (value) => value.path === template
  );
  return (
    object(report.installed) &&
    Object.keys(report.installed).length === 4 &&
    report.installed.environment === operation.monitoring_environment &&
    report.installed.source_commit === operation.backend_commit &&
    report.installed.template === template &&
    hash(report.installed.sha256) &&
    report.installed.sha256 === file?.sha256
  );
}

export function verifyProductWorkflowReport(report, operation) {
  validateReleaseOperation(operation);
  const requiredRoles = releaseBuildRoles(operation);
  const buildEntries = object(report?.builds)
    ? Object.entries(report.builds)
    : [];
  // Like deployments, failed workflows may legitimately have no build yet.
  // Every supplied build is still validated and bound to supplied deployment.
  const buildsValid = buildEntries.every(([role, build]) => {
    try {
      const deployment = report.deployments?.[role];
      return (
        requiredRoles.includes(role) &&
        object(build) &&
        validateReleaseBuild(build.manifest)?.role === role &&
        build.manifest.source_commit ===
          operation[`${releaseBuildSourceRole(role)}_commit`] &&
        object(build.artifact) &&
        positive(build.artifact.id) &&
        build.artifact.id === deployment?.artifact?.id &&
        build.artifact.name === deployment?.artifact?.name &&
        String(build.artifact.digest).replace(/^sha256:/u, "") ===
          deployment?.artifact?.digest &&
        /^(?:sha256:)?[0-9a-f]{64}$/u.test(build.artifact.digest ?? "")
      );
    } catch {
      return false;
    }
  });
  const runnerWorkflow =
    operation.operation === "e2e"
      ? `.github/workflows/${operation.environment === "staging" ? "staging-e2e.yml" : "production-e2e.yml"}`
      : expectedWorkflow(
          operation.operation === "monitoring" ? "monitoring" : operation.role,
          operation
        );
  if (
    !object(report) ||
    report.protocol !== operation.protocol ||
    report.profile !== "sandbox" ||
    report.adapter !== productWorkflowReleaseAdapter ||
    report.release_id !== operation.release_id ||
    report.operation_id !== operation.operation_id ||
    report.operation_hash !== operation.fingerprint ||
    report.operation !== operation.operation ||
    report.environment !== operation.environment ||
    report.role !== operation.role ||
    report.unit !== operation.unit ||
    !["passed", "failed"].includes(report.status) ||
    !Array.isArray(report.checks) ||
    !report.checks.length ||
    report.checks.some(
      (check) =>
        !object(check) ||
        typeof check.name !== "string" ||
        !["passed", "failed"].includes(check.status)
    ) ||
    !object(report.builds) ||
    !buildsValid ||
    !deploymentsMatch(report, operation, requiredRoles) ||
    (report.status === "passed" &&
      (buildEntries.length !== requiredRoles.length ||
        requiredRoles.some((role) => !report.builds[role]))) ||
    !installedMatches(report, operation) ||
    !object(report.versions) ||
    report.versions.backend !== operation.backend_commit ||
    report.versions.frontend !== operation.frontend_commit ||
    !object(report.runner) ||
    !positive(report.runner.run_id) ||
    !positive(report.runner.attempt) ||
    !sha(report.runner.commit) ||
    typeof report.runner.repository !== "string" ||
    report.runner.workflow !== runnerWorkflow ||
    !Number.isFinite(Date.parse(report.completed_at)) ||
    (report.status === "passed" &&
      report.checks.some((check) => check.status !== "passed")) ||
    (report.status === "failed" &&
      !report.checks.some((check) => check.status === "failed"))
  )
    throw new Error(
      "Product-shaped sandbox report does not match its saved operation."
    );
  return report;
}

export function verifySavedReleaseReport(report, operation) {
  if (report?.adapter === productWorkflowReleaseAdapter)
    return verifyProductWorkflowReport(report, operation);
  if (
    Object.hasOwn(report ?? {}, "adapter") ||
    Object.hasOwn(report ?? {}, "deployments")
  )
    throw new Error("Unknown sandbox release report adapter.");
  return verifyReleaseReport(report, operation);
}
