import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";
import { Script } from "node:vm";
import { blobHash } from "../src/service-contract.mjs";
import {
  validateAdditiveBrowserWorkflow,
  fixedPositionBrowserContract
} from "../src/additive-browser-workflow.mjs";
import {
  browserPack,
  extendWorkflow,
  pdfWorkflow,
  reviewedWorkflow
} from "./additive-browser-fixture.mjs";

test("the exact inspected PDF workflow passes v2 in its original locations, but never inherits v2 under saved v1", () => {
  const actual = pdfWorkflow();
  assert.equal(blobHash(actual), "fa0bd0934b26148d3ca37d76b4f9d926e5052a3a");
  assert.deepEqual(
    validateAdditiveBrowserWorkflow(reviewedWorkflow, actual).lanes,
    ["playwright-pdf-attachments"]
  );
  assert.throws(
    () =>
      validateAdditiveBrowserWorkflow(
        reviewedWorkflow,
        actual,
        fixedPositionBrowserContract
      ),
    { code: "batch-runtime" }
  );
  assert.deepEqual(
    validateAdditiveBrowserWorkflow(
      reviewedWorkflow,
      extendWorkflow([browserPack("future-example")]),
      fixedPositionBrowserContract
    ).lanes,
    ["playwright-future-example"]
  );
  assert.throws(
    () => validateAdditiveBrowserWorkflow(reviewedWorkflow, actual, "unknown"),
    { code: "batch-runtime" }
  );
});

const registrationBoundaries = [
  "          if (plan.checks.build.required)",
  "          if (plan.checks.playwright_smoke.required",
  "          if (plan.checks.playwright_native_competition?.required)",
  "          if (plan.checks.playwright_wave_feature_usage?.required)",
  "          const waveCreationBrowserRequired =",
  "          if (waveCreationBrowserRequired)",
  "          if (plan.checks.playwright_critical_shell.required)",
  "          if (plan.checks.playwright_museum.required)",
  '          write("app_check_matrix",'
];
const stepBoundaries = [
  "Run small Playwright smoke pack",
  "Run Collect public browser pack",
  "Run artwork documentation browser regression pack",
  "Run native competition browser regression pack",
  "Run isolated Wave feature tracking browser pack",
  "Run wave creation browser regression pack",
  "Run critical route-shell Playwright pack",
  "Run session recovery browser regression pack",
  "Upload app check artifacts"
];
for (const registrationBefore of registrationBoundaries) {
  test(`safe registration boundary: ${registrationBefore.trim()}`, () => {
    for (const step of stepBoundaries) {
      const actual = extendWorkflow([browserPack("future-example")], {
        registrationBefore,
        stepBefore: `      - name: ${step}\n`
      });
      assert.deepEqual(
        validateAdditiveBrowserWorkflow(reviewedWorkflow, actual).lanes,
        ["playwright-future-example"]
      );
      const workflow = parse(actual.toString(), { uniqueKeys: true });
      const plan = workflow.jobs.plan.steps.find(
        (step) => step.id === "plan_outputs"
      );
      const javascript = plan.run.match(
        /node <<'NODE'\n([\s\S]*?)\nNODE/u
      )?.[1];
      assert.ok(javascript);
      assert.doesNotThrow(() => new Script(javascript));
      assert.equal(
        workflow.jobs["core-playwright-checks"].steps.filter(
          (step) => step.if === "matrix.lane == 'playwright-future-example'"
        ).length,
        1
      );
    }
  });
}

test("multiple paired packs can occupy different safe boundaries without changing any reviewed byte", () => {
  const first = browserPack("first-example"),
    second = browserPack("second-example");
  let actual = extendWorkflow([first], {
    registrationBefore: registrationBoundaries[2],
    stepBefore: `      - name: ${stepBoundaries[3]}\n`
  }).toString();
  actual = actual.replace(
    registrationBoundaries[6],
    second.registration + registrationBoundaries[6]
  );
  actual = actual.replace(
    `      - name: ${stepBoundaries[7]}\n`,
    second.step + `      - name: ${stepBoundaries[7]}\n`
  );
  assert.deepEqual(
    validateAdditiveBrowserWorkflow(reviewedWorkflow, Buffer.from(actual))
      .lanes,
    ["playwright-first-example", "playwright-second-example"]
  );
  assert.equal(
    actual
      .replace(first.registration, "")
      .replace(first.step, "")
      .replace(second.registration, "")
      .replace(second.step, ""),
    reviewedWorkflow.toString()
  );
});

for (const registrationBefore of [
  "          const corePlaywrightLanes = [];",
  '            corePlaywrightLanes.push({ lane: "playwright-smoke"',
  "          const collectBrowserRequired =",
  '          write("core_playwright_matrix",',
  "            /^(?:app\\/collect\\/"
]) {
  test(`refuse registration outside a safe statement boundary: ${registrationBefore.trim()}`, () => {
    assert.ok(reviewedWorkflow.toString().includes(registrationBefore));
    assert.throws(
      () =>
        validateAdditiveBrowserWorkflow(
          reviewedWorkflow,
          extendWorkflow([browserPack("future-example")], {
            registrationBefore
          })
        ),
      { code: "batch-runtime" }
    );
  });
}
for (const stepBefore of [
  "      - name: Checkout code\n",
  "      - name: Install dependencies\n",
  "        if: matrix.lane == 'playwright-native-competition'",
  "          name: app-pr-ci-results-${{ matrix.lane }}",
  "  app-checks:\n"
]) {
  test(`refuse steps before setup, inside steps/artifacts or outside the browser job: ${stepBefore.trim()}`, () => {
    assert.ok(reviewedWorkflow.toString().includes(stepBefore));
    assert.throws(
      () =>
        validateAdditiveBrowserWorkflow(
          reviewedWorkflow,
          extendWorkflow([browserPack("future-example")], { stepBefore })
        ),
      { code: "batch-runtime" }
    );
  });
}

test("moving or deleting existing baseline tests, or duplicating a new lane across slots, remains forbidden", () => {
  const pack = browserPack("future-example");
  const valid = extendWorkflow([pack]);
  const existingStart = reviewedWorkflow
    .toString()
    .indexOf("      - name: Run isolated Wave feature tracking browser pack\n");
  const existingEnd = reviewedWorkflow
    .toString()
    .indexOf("      - name: Run wave creation browser regression pack\n");
  assert.ok(existingStart >= 0 && existingEnd > existingStart);
  const existingStep = reviewedWorkflow
    .toString()
    .slice(existingStart, existingEnd);
  for (const actual of [
    valid.toString().replace(existingStep, ""),
    valid
      .toString()
      .replace(existingStep, "")
      .replace(
        "      - name: Run native competition browser regression pack\n",
        existingStep +
          "      - name: Run native competition browser regression pack\n"
      ),
    valid
      .toString()
      .replace(
        "Run isolated Wave feature tracking browser pack",
        "Changed tracking pack"
      ),
    valid
      .toString()
      .replace(
        "          if (plan.checks.playwright_wave_feature_usage?.required)",
        "          if (false)"
      ),
    valid
      .toString()
      .replace(
        registrationBoundaries[2],
        pack.registration + registrationBoundaries[2]
      ),
    valid
      .toString()
      .replace(
        `      - name: ${stepBoundaries[3]}\n`,
        pack.step + `      - name: ${stepBoundaries[3]}\n`
      )
  ])
    assert.throws(
      () =>
        validateAdditiveBrowserWorkflow(reviewedWorkflow, Buffer.from(actual)),
      { code: "batch-runtime" }
    );
});
