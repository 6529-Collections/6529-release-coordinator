import {
  monitoringTemplate,
  releaseBuildRoles,
  releaseBuildSourceRole,
  validateReleaseBuild,
  verifyReleaseReport
} from "./release-contract.mjs";
import { validateProfileReleaseOperation } from "./profile-release-contract.mjs";
import {
  productWorkflowAdapter,
  productWorkflowRuntimeForProfile
} from "./product-workflow-runtime-config.mjs";

export const productWorkflowReleaseAdapter = productWorkflowAdapter;
export const legacyProductWorkflowReleaseAdapter = "product-workflow-mirror-v1";

const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const sha = (value) =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
const hash = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function expectedWorkflow(role, operation, runtime) {
  if (role === "monitoring")
    return `.github/workflows/${runtime.repositories.backend.workflows.monitoring.file}`;
  if (role === "backend")
    return `.github/workflows/${runtime.repositories.backend.workflows.deploy.file}`;
  const key =
    operation.environment === "staging" ? "stagingDeploy" : "prodDeploy";
  return `.github/workflows/${runtime.repositories.frontend.workflows[key].file}`;
}

function artifactName(role, deployment) {
  if (role === "monitoring")
    return `fake-monitoring-${deployment.environment}-${deployment.run_id}`;
  if (role === "backend")
    return `fake-backend-${deployment.environment}-${deployment.unit}-${deployment.run_id}`;
  return `fake-${deployment.environment === "prod" ? "production" : "staging"}-deployment-${deployment.run_id}`;
}

function deploymentsMatch(report, operation, requiredRoles, runtime) {
  if (!object(report.deployments)) return false;
  const entries = Object.entries(report.deployments);
  if (
    entries.some(([role, deployment]) => {
      const sourceRole = releaseBuildSourceRole(role);
      const environment =
        role === "monitoring"
          ? operation.monitoring_environment
          : operation.environment;
      const common =
        requiredRoles.includes(role) &&
        object(deployment) &&
        deployment.role === role &&
        deployment.environment === environment &&
        deployment.source_commit === operation[`${sourceRole}_commit`] &&
        (role === "backend"
          ? typeof deployment.unit === "string" &&
            /^[A-Za-z][A-Za-z0-9_-]{0,119}$/u.test(deployment.unit)
          : deployment.unit === null) &&
        deployment.workflow === expectedWorkflow(role, operation, runtime) &&
        typeof deployment.repository === "string" &&
        positive(deployment.run_id);
      if (!common) return true;
      if (operation.profile === "real")
        return (
          !positive(deployment.run_attempt) ||
          Object.hasOwn(deployment, "artifact")
        );
      return !(
        object(deployment.artifact) &&
        positive(deployment.artifact.id) &&
        deployment.artifact.name === artifactName(role, deployment) &&
        hash(deployment.artifact.digest)
      );
    })
  )
    return false;
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
  if (operation.profile === "real") return !Object.hasOwn(report, "installed");
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
  validateProfileReleaseOperation(operation);
  const runtime = productWorkflowRuntimeForProfile({ name: operation.profile });
  const requiredRoles =
    operation.profile === "real" && operation.operation === "e2e"
      ? Object.keys(report?.deployments ?? {})
      : releaseBuildRoles(operation);
  const buildEntries = object(report?.builds)
    ? Object.entries(report.builds)
    : [];
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
      ? `.github/workflows/${
          runtime.repositories.frontend.workflows[
            operation.environment === "staging" ? "stagingE2e" : "prodE2e"
          ].file
        }`
      : expectedWorkflow(
          operation.operation === "monitoring" ? "monitoring" : operation.role,
          operation,
          runtime
        );
  if (
    !object(report) ||
    report.protocol !== operation.protocol ||
    report.profile !== operation.profile ||
    ![
      productWorkflowReleaseAdapter,
      ...(operation.profile === "sandbox"
        ? [legacyProductWorkflowReleaseAdapter]
        : [])
    ].includes(report.adapter) ||
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
    (operation.profile === "real" &&
      operation.operation === "e2e" &&
      (requiredRoles.some((role) => !["backend", "frontend"].includes(role)) ||
        (report.status === "passed" && !requiredRoles.includes("frontend")))) ||
    !buildsValid ||
    !deploymentsMatch(report, operation, requiredRoles, runtime) ||
    (operation.profile === "sandbox" &&
      report.status === "passed" &&
      (buildEntries.length !== requiredRoles.length ||
        requiredRoles.some((role) => !report.builds[role]))) ||
    (operation.profile === "real" && buildEntries.length !== 0) ||
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
      "Product workflow report does not match its saved operation."
    );
  return report;
}

export function verifySavedReleaseReport(report, operation) {
  if (
    [
      productWorkflowReleaseAdapter,
      legacyProductWorkflowReleaseAdapter
    ].includes(report?.adapter)
  )
    return verifyProductWorkflowReport(report, operation);
  if (
    Object.hasOwn(report ?? {}, "adapter") ||
    Object.hasOwn(report ?? {}, "deployments")
  )
    throw new Error(
      `Unknown ${operation.profile === "sandbox" ? "sandbox " : ""}release report adapter.`
    );
  return verifyReleaseReport(report, operation);
}
