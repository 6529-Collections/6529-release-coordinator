import test from "node:test";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { parse } from "yaml";
import {
  reviewedFrontendPrWorkflow,
  validateAdditiveBrowserWorkflow,
  verifiedWorkflowBytes
} from "../src/additive-browser-workflow.mjs";
import { blobHash } from "../src/service-contract.mjs";
import {
  browserPack,
  extendWorkflow,
  gitWorkflow,
  reviewedWorkflow
} from "./additive-browser-fixture.mjs";

test("the full reviewed workflow fixture includes current tracking coverage and matches its independent Git blob", () => {
  assert.equal(reviewedWorkflow.length, 72006);
  assert.equal(
    blobHash(reviewedWorkflow),
    "9209601a51023b4a17609fb7cdacb360a2e34977"
  );
  assert.equal(reviewedFrontendPrWorkflow, blobHash(reviewedWorkflow));
  assert.match(reviewedWorkflow.toString(), /playwright-wave-feature-usage/u);
  assert.deepEqual(
    validateAdditiveBrowserWorkflow(reviewedWorkflow, reviewedWorkflow),
    { baseline_blob: reviewedFrontendPrWorkflow, lanes: [] }
  );
});

for (const names of [
  ["future-example"],
  ["future-example", "another-example"],
  Array.from({ length: 13 }, (_, index) => `future-${index}`)
]) {
  test(`accept ${names.length} paired ordinary sandbox browser packs without another workflow pin`, () => {
    const extended = extendWorkflow(names.map(browserPack));
    assert.notEqual(blobHash(extended), reviewedFrontendPrWorkflow);
    assert.deepEqual(
      validateAdditiveBrowserWorkflow(reviewedWorkflow, extended).lanes,
      names.map((name) => `playwright-${name}`)
    );
  });
}

test("accepted additions parse as real workflow steps and valid plan Javascript without changing the job envelope", () => {
  const baseline = parse(reviewedWorkflow.toString(), { uniqueKeys: true });
  const expanded = parse(
    extendWorkflow([
      browserPack("future-example"),
      browserPack("other-example")
    ]).toString(),
    { uniqueKeys: true }
  );
  const addedSteps = expanded.jobs["core-playwright-checks"].steps.filter(
    (step) => step.name === "Run isolated example browser pack"
  );
  assert.equal(addedSteps.length, 2);
  assert.deepEqual(addedSteps[0], {
    name: "Run isolated example browser pack",
    if: "matrix.lane == 'playwright-future-example'",
    env: {
      PLAYWRIGHT_OUTPUT_DIR: "test-results/playwright/future-example",
      PLAYWRIGHT_HTML_REPORT_DIR: "playwright-report/future-example"
    },
    run: "./bin/6529 run test:e2e:future-example-sandbox"
  });
  const plan = expanded.jobs.plan.steps.find(
    (step) => step.id === "plan_outputs"
  );
  const javascript = plan.run.match(/node <<'NODE'\n([\s\S]*?)\nNODE/u)?.[1];
  assert.ok(javascript);
  assert.doesNotThrow(() => new Script(javascript));
  // Parsing and compilation only: do not execute this product workflow fixture.
  plan.run = baseline.jobs.plan.steps.find(
    (step) => step.id === "plan_outputs"
  ).run;
  expanded.jobs["core-playwright-checks"].steps = expanded.jobs[
    "core-playwright-checks"
  ].steps.filter((step) => !addedSteps.includes(step));
  assert.deepEqual(expanded, baseline);
});

const valid = extendWorkflow([browserPack("future-example")]).toString();
for (const [name, before, after] of [
  ["write permission", "contents: read", "contents: write"],
  ["workflow trigger", "pull_request:", "pull_request_target:"],
  ["runner", "runner: defaultRunner", "runner: 'self-hosted'"],
  ["action pin", "actions/checkout@", "actions/checkout@unreviewed-"],
  [
    "existing command",
    "test:e2e:wave-creation-sandbox",
    "test:e2e:no-op-sandbox"
  ],
  [
    "existing lane removed",
    'lane: "playwright-wave-creation"',
    'lane: "playwright-disabled"'
  ],
  [
    "current tracking lane removed",
    'lane: "playwright-wave-feature-usage"',
    'lane: "playwright-disabled"'
  ],
  [
    "existing condition weakened",
    "matrix.lane == 'playwright-wave-creation'",
    "false"
  ],
  ["artifact step", "Upload app check artifacts", "Removed artifact check"],
  [
    "test container",
    "mcr.microsoft.com/playwright",
    "example.invalid/playwright"
  ],
  ["existing timeout", "timeout-minutes: 20", "timeout-minutes: 1"],
  [
    "baseline matrix output",
    'write("core_playwright_required"',
    'write("unused_output"'
  ],
  ["extra job", "jobs:\n", "jobs:\n  extra-job:\n    runs-on: ubuntu-latest\n"],
  ["result aggregator", 'test "$CORE_PLAYWRIGHT_RESULT" = "success"', "true"],
  ["line endings", "\n", "\r\n"]
]) {
  test(`refuse ${name} changes even alongside valid new packs`, () => {
    assert.ok(valid.includes(before), `fixture missing ${before}`);
    assert.throws(
      () =>
        validateAdditiveBrowserWorkflow(
          reviewedWorkflow,
          Buffer.from(valid.replace(before, after))
        ),
      { code: "batch-runtime" }
    );
  });
}

for (const [name, mutate] of [
  ["registration without step", (pack) => ({ ...pack, step: "" })],
  ["step without registration", (pack) => ({ ...pack, registration: "" })],
  ["duplicate packs", (pack) => [pack, pack]],
  ["baseline lane collision", () => browserPack("wave-creation")],
  ["baseline tracking collision", () => browserPack("wave-feature-usage")],
  [
    "unpaired check",
    (pack) => ({
      ...pack,
      registration: pack.registration.replace(
        "playwright_future_example",
        "playwright_other_example"
      )
    })
  ],
  [
    "conditional bypass",
    (pack) => ({
      ...pack,
      registration: pack.registration.replace(
        "?.required",
        "?.required || true"
      )
    })
  ],
  [
    "injected Javascript",
    (pack) => ({
      ...pack,
      registration: pack.registration + "          process.exit(0);\n"
    })
  ],
  [
    "label expression",
    (pack) => ({
      ...pack,
      registration: pack.registration.replace(
        "Example desktop and mobile",
        "${{ secrets.TEST }}"
      )
    })
  ],
  [
    "false step condition",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "matrix.lane == 'playwright-future-example'",
        "false"
      )
    })
  ],
  [
    "continue-on-error",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "        env:",
        "        continue-on-error: true\n        env:"
      )
    })
  ],
  [
    "secret environment",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "        env:\n",
        "        env:\n          TOKEN: ${{ secrets.TOKEN }}\n"
      )
    })
  ],
  [
    "arbitrary action",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "        run:",
        "        uses: example/untrusted@main\n        run:"
      )
    })
  ],
  [
    "arbitrary shell",
    (pack) => ({
      ...pack,
      step: pack.step.replace("-sandbox\n", "-sandbox; echo bypass\n")
    })
  ],
  [
    "non-sandbox command",
    (pack) => ({
      ...pack,
      step: pack.step.replace("future-example-sandbox", "future-example-live")
    })
  ],
  [
    "mismatched command",
    (pack) => ({
      ...pack,
      step: pack.step.replace("future-example-sandbox", "other-example-sandbox")
    })
  ],
  [
    "output traversal",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "test-results/playwright/future-example",
        "test-results/playwright/../secret"
      )
    })
  ],
  [
    "mismatched report",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "playwright-report/future-example",
        "playwright-report/other-example"
      )
    })
  ],
  [
    "YAML expression",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "Run isolated example browser pack",
        "${{ secrets.TEST }}"
      )
    })
  ],
  [
    "YAML tag",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "Run isolated example browser pack",
        "!unsafe example"
      )
    })
  ],
  [
    "YAML anchor",
    (pack) => ({
      ...pack,
      step: pack.step.replace(
        "Run isolated example browser pack",
        "&unsafe example"
      )
    })
  ],
  [
    "unpaired order",
    (pack) => [
      { ...pack, step: browserPack("other-example").step },
      { ...browserPack("other-example"), step: pack.step }
    ]
  ]
]) {
  test(`refuse a browser addition with ${name}`, () => {
    const changed = mutate(browserPack("future-example"));
    assert.throws(
      () =>
        validateAdditiveBrowserWorkflow(
          reviewedWorkflow,
          extendWorkflow(Array.isArray(changed) ? changed : [changed])
        ),
      { code: "batch-runtime" }
    );
  });
}

test("do not accept protected-byte deletion, ambiguous placement, truncation or an untrusted baseline", () => {
  for (const actual of [
    reviewedWorkflow.subarray(1),
    reviewedWorkflow.subarray(0, -1),
    Buffer.from(valid + "# unrelated edit\n"),
    Buffer.from(browserPack("future-example").step + valid),
    Buffer.concat([reviewedWorkflow, Buffer.from([255])])
  ]) {
    assert.throws(
      () => validateAdditiveBrowserWorkflow(reviewedWorkflow, actual),
      { code: "batch-runtime" }
    );
  }
  assert.throws(
    () =>
      validateAdditiveBrowserWorkflow(
        Buffer.from("unreviewed baseline\n"),
        reviewedWorkflow
      ),
    { code: "batch-runtime" }
  );
});

test("decode complete base64 bytes only after an independent Git blob check", () => {
  const file = gitWorkflow(reviewedWorkflow);
  const multiline = {
    ...file,
    content: file.content.match(/.{1,60}/gu).join("\n") + "\n"
  };
  assert.deepEqual(
    verifiedWorkflowBytes(multiline, file.sha),
    reviewedWorkflow
  );
  for (const changed of [
    { ...file, sha: "f".repeat(40) },
    { ...file, encoding: "utf8" },
    { ...file, content: file.content.slice(0, -4) },
    { ...file, content: file.content + "!" },
    { ...file, content: Buffer.from("wrong bytes").toString("base64") },
    { sha: file.sha, encoding: "base64" }
  ]) {
    assert.throws(() => verifiedWorkflowBytes(changed, file.sha), {
      code: "batch-runtime"
    });
  }
});
