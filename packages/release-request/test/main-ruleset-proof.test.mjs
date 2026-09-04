import test from "node:test";
import assert from "node:assert/strict";

test("temporary proof that a failing package check blocks merging", () => {
  assert.fail("Intentional temporary failure for the main ruleset proof");
});
