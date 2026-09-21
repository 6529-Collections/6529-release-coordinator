import { createProductWorkflowReleaseGitHub } from "./product-workflow-release-github.mjs";
import { createReleaseGitHub } from "./release-github.mjs";
import { serviceAssert } from "./service-contract.mjs";

export const sandboxReleaseAdapters = Object.freeze([
  "generic",
  "product-workflows"
]);

export function selectSandboxReleaseAdapter(value) {
  const selected = value || "product-workflows";
  serviceAssert(
    sandboxReleaseAdapters.includes(selected),
    "release-runtime",
    `RELEASE_COORDINATOR_SANDBOX_RELEASE_ADAPTER must be ${sandboxReleaseAdapters.join(" or ")}.`
  );
  return selected;
}

export function createSandboxReleaseGitHub({ adapter, ...options } = {}) {
  const selected = selectSandboxReleaseAdapter(adapter);
  return selected === "product-workflows"
    ? createProductWorkflowReleaseGitHub(options)
    : createReleaseGitHub(options);
}
