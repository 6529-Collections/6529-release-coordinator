import assert from "node:assert/strict";
import test from "node:test";
import {
  createSandboxReleaseGitHub,
  selectSandboxReleaseAdapter
} from "../src/sandbox-release-client.mjs";
import { sandboxProfile } from "../src/profiles.mjs";

test("the product-workflow adapter is the sandbox default and generic remains an explicit fallback", () => {
  assert.equal(selectSandboxReleaseAdapter(undefined), "product-workflows");
  assert.equal(selectSandboxReleaseAdapter("generic"), "generic");
  assert.equal(
    selectSandboxReleaseAdapter("product-workflows"),
    "product-workflows"
  );
  assert.throws(
    () => selectSandboxReleaseAdapter("real"),
    /must be generic or product-workflows/u
  );
});

test("the product-workflow selection creates only a sandbox client", () => {
  const client = createSandboxReleaseGitHub({
    adapter: "product-workflows",
    profile: sandboxProfile,
    base: {}
  });
  assert.equal(typeof client.identity, "function");
  assert.equal(typeof client.integrate, "function");
  assert.equal(typeof client.run, "function");
});
