import { createHash } from "node:crypto";

export const sandboxRepositories = Object.freeze({
  frontend: Object.freeze({ full_name: "6529-Collections/release-coordinator-test-frontend", id: 1362504370, private: true, required_checks: Object.freeze(["Sandbox check"]) }),
  backend: Object.freeze({ full_name: "6529-Collections/release-coordinator-test-backend", id: 1362505082, private: true, required_checks: Object.freeze(["Sandbox check"]) })
});
export const maxManifestBytes = 64 * 1024;
export const isSha = value => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
export const isBranch = value => typeof value === "string" && value.length <= 200
  && /^[A-Za-z0-9][A-Za-z0-9_./-]*$/u.test(value)
  && !value.includes("..") && !value.includes("//")
  && value.split("/").every(part => part && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock"));

export class RehearsalError extends Error {
  constructor(code, message) { super(message); this.name = "RehearsalError"; this.code = code; }
}

export function selectRehearsalProfile(value) {
  if (value === "real") throw new RehearsalError("real_not_enabled", "Real mode is disabled until verified inbox integration is implemented and tested.");
  if (value !== "sandbox") throw new RehearsalError("invalid_profile", "Set RELEASE_COORDINATOR_PROFILE explicitly to sandbox. There is no default profile.");
  return { name: "sandbox", repositories: sandboxRepositories };
}

function requireValue(ok, message) { if (!ok) throw new RehearsalError("invalid_manifest", message); }
function object(value, keys, required = keys) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), "Manifest field must be an object.");
  requireValue(Object.keys(value).every(key => keys.includes(key)) && required.every(key => Object.hasOwn(value, key)), "Manifest contains missing or unsupported fields.");
}
function list(value, min, max) { requireValue(Array.isArray(value) && value.length >= min && value.length <= max, "Manifest list has an invalid size."); }
const unitName = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/u.test(value);

// Private manifests never become public release requests or trusted inbox receipts.
// A future verified-input adapter will produce this same internal plan structure.
export function sandboxMergePlan(manifest, profile) {
  requireValue(profile?.name === "sandbox", "Test manifests require the sandbox profile.");
  requireValue(Buffer.byteLength(JSON.stringify(manifest) ?? "") <= maxManifestBytes, "Manifest exceeds 64 KiB.");
  object(manifest, ["schema_version", "source", "profile", "case_id", "target", "repositories"]);
  requireValue(manifest.schema_version === "1" && manifest.source === "test-manifest" && manifest.profile === profile.name, "Manifest version, source, or profile does not match sandbox input.");
  requireValue(typeof manifest.case_id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(manifest.case_id), "Invalid test case ID.");
  requireValue(["staging", "production"].includes(manifest.target), "A rehearsal requires an explicit deployment target for dependency observations.");
  list(manifest.repositories, 1, 2);
  const roles = new Set();
  const repositories = manifest.repositories.map(repo => {
    const backend = repo?.role === "backend";
    object(repo, ["role", "destination", "pull_requests", "depends_on", ...(backend ? ["deploy_units", "deploy_dependencies"] : [])]);
    requireValue(["frontend", "backend"].includes(repo.role) && !roles.has(repo.role), "Repository roles must be supported and unique.");
    list(repo.depends_on, 0, 1);
    requireValue(repo.depends_on.every(role => roles.has(role)), "Repository order must include each dependency before its dependent; missing dependencies and cycles are invalid.");
    roles.add(repo.role);
    object(repo.destination, ["branch", "commit"]);
    requireValue(isBranch(repo.destination.branch) && isSha(repo.destination.commit), "Destination needs a valid explicit branch and full commit.");
    list(repo.pull_requests, 1, 10);
    const numbers = new Set();
    for (const pr of repo.pull_requests) {
      object(pr, ["number", "branch", "commit"]);
      requireValue(Number.isSafeInteger(pr.number) && pr.number > 0 && !numbers.has(pr.number), "PR numbers must be positive and unique within a repository.");
      numbers.add(pr.number);
      requireValue(isBranch(pr.branch) && isSha(pr.commit), "PRs need valid source branches and full commits.");
    }
    if (backend) {
      list(repo.deploy_units, 1, 64); list(repo.deploy_dependencies, 0, 128);
      requireValue(repo.deploy_units.every(unitName) && new Set(repo.deploy_units).size === repo.deploy_units.length, "Backend services must have unique valid names.");
      for (const edge of repo.deploy_dependencies) {
        object(edge, ["before", "after"]);
        requireValue(repo.deploy_units.includes(edge.before) && repo.deploy_units.includes(edge.after) && edge.before !== edge.after, "Service dependencies must name distinct selected units.");
      }
    }
    return { ...structuredClone(repo), identity: { ...profile.repositories[repo.role] } };
  });
  return {
    version: 1, profile: profile.name, input_source: "test-manifest", case_id: manifest.case_id,
    input_hash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    target: manifest.target, repositories,
    // Adapt sandbox roles for the existing pure dependency inspector. A future
    // verified-input adapter can preserve multiple real release parts per repo.
    // These internal graph fields carry no inbox proof or execution permission.
    dependency_request: { target: manifest.target, release_parts: repositories.map(repo => ({
      id: repo.role, repository: `6529seize-${repo.role}`, depends_on: repo.depends_on,
      deploy_units: repo.deploy_units ?? [], deploy_dependencies: repo.deploy_dependencies ?? []
    })) }
  };
}
