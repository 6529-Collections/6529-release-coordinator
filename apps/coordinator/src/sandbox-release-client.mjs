import { createProductWorkflowReleaseGitHub } from "./product-workflow-release-github.mjs";
import { createReleaseGitHub } from "./release-github.mjs";
import { serviceAssert } from "./service-contract.mjs";

export const sandboxReleaseAdapters = Object.freeze([
  "generic",
  "product-workflows"
]);

export function selectSandboxReleaseAdapter(value) {
  const selected = value === undefined ? "product-workflows" : value;
  serviceAssert(
    sandboxReleaseAdapters.includes(selected),
    "release-runtime",
    `RELEASE_COORDINATOR_SANDBOX_RELEASE_ADAPTER must be ${sandboxReleaseAdapters.join(" or ")}.`
  );
  return selected;
}

export function createSandboxReleaseGitHub({ adapter, ...options } = {}) {
  const selected = selectSandboxReleaseAdapter(adapter);
  const client =
    selected === "product-workflows"
      ? createProductWorkflowReleaseGitHub(options)
      : createReleaseGitHub(options);
  client.releaseAdapter = selected;
  return client;
}

export function selectReleaseAdapter(profile, value) {
  if (profile?.name === "real") return "product-workflows";
  return selectSandboxReleaseAdapter(value);
}

export function createProfileReleaseGitHub({
  adapter,
  profile,
  ...options
} = {}) {
  const selected = selectReleaseAdapter(profile, adapter);
  const client =
    selected === "product-workflows"
      ? createProductWorkflowReleaseGitHub({ ...options, profile })
      : createReleaseGitHub({ ...options, profile });
  client.releaseAdapter = selected;
  return client;
}
