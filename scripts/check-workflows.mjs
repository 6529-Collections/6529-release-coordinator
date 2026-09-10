import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, visit, isAlias } from "yaml";

const readOnly = { contents: "read" };
const publishCondition =
  "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'";

// Parse configuration, never search comments or shell strings for permission text.
// Keep unsupported YAML features explicit rather than guessing their meaning.
export function parseWorkflow(text) {
  const doc = parseDocument(text, {
    version: "1.2",
    uniqueKeys: true,
    stringKeys: true
  });
  assert.equal(
    doc.errors.length + doc.warnings.length,
    0,
    "Workflow YAML must parse without errors or warnings"
  );
  assert.equal(
    doc.directives.yaml.version,
    "1.2",
    "Workflow YAML must use version 1.2"
  );
  visit(doc, (_key, node) => {
    assert.ok(
      !isAlias(node) && !node?.anchor && !node?.tag,
      "Workflow aliases, anchors and explicit tags are unsupported"
    );
    assert.notEqual(
      node?.key?.value,
      "<<",
      "Workflow merge keys are unsupported"
    );
  });
  const workflow = doc.toJS({ maxAliasCount: 0 });
  assert.ok(
    workflow && typeof workflow === "object" && !Array.isArray(workflow),
    "Workflow must be a mapping"
  );
  return workflow;
}

function keys(value, expected, message) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    message
  );
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), message);
}

function common(workflow, permissionsByJob) {
  assert.deepEqual(
    workflow.permissions,
    readOnly,
    "Workflow defaults must be read-only"
  );
  assert.equal(
    workflow.env,
    undefined,
    "Workflow-wide environment requires policy review"
  );
  assert.equal(
    workflow.defaults,
    undefined,
    "Workflow-wide command defaults require policy review"
  );
  keys(
    workflow.jobs,
    Object.keys(permissionsByJob),
    "Unexpected or missing workflow jobs"
  );
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.deepEqual(
      Object.hasOwn(job, "permissions")
        ? job.permissions
        : workflow.permissions,
      permissionsByJob[name],
      `${name}: incorrect effective permissions`
    );
    assert.equal(
      job["runs-on"],
      "ubuntu-latest",
      `${name}: use a disposable GitHub runner`
    );
    for (const field of [
      "continue-on-error",
      "uses",
      "secrets",
      "container",
      "services",
      "defaults"
    ]) {
      assert.equal(
        job[field],
        undefined,
        `${name}: ${field} requires policy review`
      );
    }
    assert.ok(
      Array.isArray(job.steps) && job.steps.length > 0,
      `${name}: steps are required`
    );
    for (const step of job.steps) {
      assert.equal(
        step["continue-on-error"],
        undefined,
        `${name}: mandatory steps must fail the job`
      );
      if (step.uses) {
        assert.match(
          step.uses,
          /^actions\/(?:checkout|setup-node)@[a-f0-9]{40}$/u,
          `${name}: actions must be explicitly allowed and pinned`
        );
        if (step.uses.startsWith("actions/checkout@")) {
          assert.equal(
            step.with?.["persist-credentials"],
            false,
            `${name}: checkout must not persist credentials`
          );
        }
      }
    }
  }
}

export function validateWorkflows(sources) {
  keys(
    sources,
    ["publish-release-request.yml", "submit-release-request.yml"],
    "Register every workflow in the permission policy"
  );
  const release = parseWorkflow(sources["publish-release-request.yml"]);
  const intake = parseWorkflow(sources["submit-release-request.yml"]);
  common(release, {
    verify: readOnly,
    check: readOnly,
    publish: { contents: "read", "id-token": "write" }
  });
  keys(
    release.on,
    ["pull_request", "push", "workflow_dispatch"],
    "Unexpected release workflow triggers"
  );
  assert.deepEqual(
    release.on.pull_request,
    { branches: ["main"] },
    "All main PRs must run checks, without path filters"
  );
  assert.deepEqual(release.on.push, { branches: ["main"] });
  const { verify, check, publish } = release.jobs;
  assert.doesNotMatch(
    JSON.stringify({ verify, check }),
    /secrets\s*[.[]|github\.token/iu,
    "PR checks must not receive secrets or explicit write tokens"
  );
  assert.equal(verify.if, undefined, "Verification cannot be skipped");
  assert.equal(
    verify.needs,
    undefined,
    "Verification cannot depend on a skippable job"
  );
  assert.equal(
    verify.environment,
    undefined,
    "PR checks must not access protected environments"
  );
  assert.equal(
    verify.env,
    undefined,
    "PR job environment requires policy review"
  );
  assert.deepEqual(verify.strategy, {
    "fail-fast": false,
    matrix: { node: [20, 22, 24] }
  });
  assert.equal(
    verify.steps.length,
    4,
    "Review changes to mandatory verification steps"
  );
  assert.ok(verify.steps[0].uses?.startsWith("actions/checkout@"));
  assert.deepEqual(
    verify.steps[0].with,
    { "persist-credentials": false },
    "Check the actual PR checkout without retained credentials"
  );
  assert.ok(verify.steps[1].uses?.startsWith("actions/setup-node@"));
  assert.equal(verify.steps[1].with?.["node-version"], "${{ matrix.node }}");
  assert.equal(verify.steps[2].run, "npm ci --ignore-scripts");
  assert.equal(verify.steps[3].run, "npm run check");
  for (const step of verify.steps) {
    assert.equal(
      step.if,
      undefined,
      "Mandatory verification steps cannot be skipped"
    );
    assert.equal(
      step.env,
      undefined,
      "PR step environment requires policy review"
    );
  }
  assert.equal(
    check.name,
    "Check package",
    "Keep the existing required status name"
  );
  assert.equal(
    check.if,
    "always()",
    "Required gate must run after failures and skips"
  );
  assert.equal(check.needs, "verify");
  assert.equal(check.environment, undefined);
  assert.equal(check.env, undefined);
  assert.equal(check.strategy, undefined);
  assert.equal(check.steps.length, 1);
  assert.equal(check.steps[0].if, undefined);
  assert.deepEqual(check.steps[0].env, {
    CHECK_RESULT: "${{ needs.verify.result }}"
  });
  assert.equal(
    check.steps[0].run,
    'test "$CHECK_RESULT" = success',
    "Gate must reject failed, cancelled and skipped verification"
  );

  assert.equal(
    publish.if,
    publishCondition,
    "Publishing must be manual and limited to main"
  );
  assert.equal(
    publish.needs,
    "check",
    "Publishing requires the successful gate"
  );
  assert.equal(
    publish.environment,
    "npm-publish",
    "Publishing requires the protected environment"
  );
  assert.ok(
    !JSON.stringify(publish).includes("NODE_AUTH_TOKEN"),
    "Use short-lived publishing identity"
  );
  const publishStep = publish.steps.find(
    (step) => step.name === "Publish the inspected archive"
  );
  assert.ok(publishStep);
  assert.match(
    publishStep.run,
    /^npm publish "\.\/\$\{PACKAGE_FILE\}" --access public --ignore-scripts --provenance$/mu
  );
  assert.deepEqual(publishStep.env, {
    PACKAGE_FILE: "${{ steps.archive.outputs.package-file }}",
    PACKAGE_SHA256: "${{ steps.archive.outputs.sha256 }}"
  });

  common(intake, {
    "validate-and-save": { contents: "read", issues: "write" }
  });
  keys(
    intake.on,
    ["workflow_dispatch"],
    "Intake may only be manually dispatched"
  );
  assert.deepEqual(
    intake.concurrency,
    {
      group: "release-request-inbox-${{ inputs.request_id }}",
      "cancel-in-progress": false
    },
    "Intake retries must share the request lock"
  );
  const saveSteps = intake.jobs["validate-and-save"].steps.filter(
    (step) => step.run === "node apps/coordinator/bin/save-inbox-request.mjs"
  );
  assert.equal(saveSteps.length, 1, "Intake must use the Coordinator writer");
  assert.deepEqual(saveSteps[0].env, {
    RELEASE_COORDINATOR_PROFILE: "real",
    GH_TOKEN: "${{ github.token }}",
    REQUEST_ID: "${{ inputs.request_id }}",
    REQUEST_JSON: "${{ inputs.request_json }}"
  });
}

export async function readWorkflows(
  directory = new URL("../.github/workflows/", import.meta.url)
) {
  const files = (await readdir(directory)).filter((file) =>
    /\.ya?ml$/u.test(file)
  );
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        await readFile(new URL(file, directory), "utf8")
      ])
    )
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateWorkflows(await readWorkflows());
  console.log(
    "Workflow triggers, job permissions and required check gate passed."
  );
}
