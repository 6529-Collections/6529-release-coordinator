import { serviceAssert } from "./service-contract.mjs";

export const releaseRequestTargets = Object.freeze(["staging", "production"]);

export const isReleaseRequestTarget = (target) =>
  releaseRequestTargets.includes(target);

export function releaseEnvironmentsForTarget(target) {
  serviceAssert(
    isReleaseRequestTarget(target),
    "release-input",
    "A release target must be staging or production."
  );
  return target === "production" ? ["staging", "prod"] : ["staging"];
}
