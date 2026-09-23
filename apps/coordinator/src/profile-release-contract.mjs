import {
  makeReleaseOperation as makeSandboxReleaseOperation,
  releaseEnvironments,
  releaseHash,
  releaseMonitoringEnvironments,
  releaseMonitoringUnit,
  releaseOperations,
  releaseProtocol,
  validateReleaseOperation as validateSandboxReleaseOperation
} from "./release-contract.mjs";

const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const sha = (value) =>
  typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(value);
const hash = (value) =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

export function makeProfileReleaseOperation(value) {
  if (value.profile !== "real") return makeSandboxReleaseOperation(value);
  const contents = {
    protocol: releaseProtocol,
    profile: "real",
    release_id: value.release_id,
    operation_id: value.operation_id,
    operation: value.operation,
    environment: value.environment,
    role: value.role ?? null,
    unit: value.unit ?? null,
    backend_commit: value.backend_commit,
    frontend_commit: value.frontend_commit,
    ...(value.operation === "monitoring"
      ? { monitoring_environment: value.monitoring_environment }
      : {})
  };
  const operation = { ...contents, fingerprint: releaseHash(contents) };
  validateProfileReleaseOperation(operation);
  return operation;
}

export function validateProfileReleaseOperation(value) {
  if (value?.profile !== "real") return validateSandboxReleaseOperation(value);
  const { fingerprint, ...contents } = value ?? {};
  if (
    !object(value) ||
    value.protocol !== releaseProtocol ||
    !uuid(value.release_id) ||
    !uuid(value.operation_id) ||
    !releaseOperations.includes(value.operation) ||
    !releaseEnvironments.includes(value.environment) ||
    !sha(value.backend_commit) ||
    !sha(value.frontend_commit) ||
    !hash(fingerprint) ||
    releaseHash(contents) !== fingerprint ||
    (value.operation === "e2e" &&
      (value.role !== null || value.unit !== null)) ||
    (value.operation === "deploy" &&
      !(
        ["backend", "frontend"].includes(value.role) &&
        typeof value.unit === "string" &&
        (value.role === "frontend"
          ? value.unit === "frontend"
          : /^[A-Za-z][A-Za-z0-9_-]{0,119}$/u.test(value.unit))
      )) ||
    (value.operation === "monitoring"
      ? !(
          value.role === "backend" &&
          value.unit === releaseMonitoringUnit &&
          (value.environment === value.monitoring_environment ||
            // Existing v1 release journals put staging monitoring in prod.
            (value.environment === "prod" &&
              value.monitoring_environment === "staging")) &&
          releaseMonitoringEnvironments.includes(value.monitoring_environment)
        )
      : Object.hasOwn(value, "monitoring_environment"))
  )
    throw new Error("Invalid product release operation.");
  return value;
}
