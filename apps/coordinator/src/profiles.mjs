import { validateReleaseRequest } from "../../../packages/release-request/src/index.mjs";

const repository = (full_name, id, required_checks = []) => Object.freeze({ full_name, id, private: false, required_checks: Object.freeze(required_checks) });
const profile = (name, inbox, repositories) => Object.freeze({ name, inbox, workflow: "submit-release-request.yml", branch: "main", repositories: Object.freeze(repositories) });
export const realProfile = profile("real", repository("6529-Collections/6529-release-coordinator", 1346244762), {
  frontend: repository("6529-Collections/6529seize-frontend", 579004979),
  backend: repository("6529-Collections/6529seize-backend", 579003578)
});
export const sandboxProfile = profile("sandbox", repository("6529-Collections/release-coordinator-test-inbox", 1362580376), {
  frontend: repository("6529-Collections/release-coordinator-test-frontend", 1362504370, ["Sandbox check"]),
  backend: repository("6529-Collections/release-coordinator-test-backend", 1362505082, ["Sandbox check"])
});

// Only named, code-owned profiles. No request/env override of hosts, IDs, paths, or permissions.
export function selectProfile(value, { defaultReal = false } = {}) {
  if (value === undefined && defaultReal) return realProfile;
  if (value === "real") return realProfile;
  if (value === "sandbox") return sandboxProfile;
  throw new Error("Set RELEASE_COORDINATOR_PROFILE to sandbox or real. Unknown profiles never fall back.");
}

export function repositoryRole(name, selected = realProfile) {
  const role = Object.keys(selected.repositories).find(key => selected.repositories[key].full_name === `6529-Collections/${name}`);
  if (!role) throw new Error("Request repository is outside the selected profile.");
  return role;
}

// Sandbox receipts use actual sample repo names and an explicit marker. They
// cannot validate as public release requests. Both profiles share the public
// schema's field/type rules after this strictly bounded internal adaptation.
export function canonicalRequest(request, selected = realProfile) {
  const value = structuredClone(request);
  if (selected.name === "sandbox") {
    if (value?.profile !== "sandbox") throw new Error("Sandbox requests require profile: sandbox.");
    delete value.profile;
  }
  if (!Array.isArray(value?.release_parts)) throw new Error("Request must contain release parts.");
  for (const part of value.release_parts) {
    const role = repositoryRole(part?.repository, selected);
    part.repository = `6529seize-${role}`;
  }
  return value;
}

export function validateProfileRequest(request, selected = realProfile) {
  try { return validateReleaseRequest(canonicalRequest(request, selected)); }
  catch (error) { return { ok: false, errors: [{ code: "profile_request", location: "$", message: error.message }] }; }
}
