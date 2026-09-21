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
    () => selectSandboxReleaseAdapter(""),
    /must be generic or product-workflows/u
  );
  assert.throws(
    () => selectSandboxReleaseAdapter("real"),
    /must be generic or product-workflows/u
  );
});

test("construction preserves the selected sandbox adapter identity", () => {
  const productClient = createSandboxReleaseGitHub({
    profile: sandboxProfile,
    base: {}
  });
  const genericClient = createSandboxReleaseGitHub({
    adapter: "generic",
    profile: sandboxProfile
  });
  assert.equal(productClient.releaseAdapter, "product-workflows");
  assert.equal(genericClient.releaseAdapter, "generic");
  for (const client of [productClient, genericClient]) {
    assert.equal(typeof client.identity, "function");
    assert.equal(typeof client.integrate, "function");
    assert.equal(typeof client.run, "function");
  }
});
