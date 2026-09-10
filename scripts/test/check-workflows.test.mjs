import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import {
  parseWorkflow,
  readWorkflows,
  validateWorkflows
} from "../check-workflows.mjs";

const sources = await readWorkflows();
const releaseFile = "publish-release-request.yml";
const intakeFile = "submit-release-request.yml";

test("actual repository workflows satisfy the permission and gate contract", () => {
  validateWorkflows(sources);
});

test("quoted keys and flow mappings have the same policy meaning", () => {
  const changed = {
    ...sources,
    [releaseFile]: sources[releaseFile].replace(
      "permissions:\n  contents: read",
      '"permissions": {"contents": "read"}'
    )
  };
  validateWorkflows(changed);
});

for (const [name, edit, file = releaseFile] of [
  [
    "PR job grants itself Issue writes",
    (w) => {
      w.jobs.verify.permissions = { contents: "read", issues: "write" };
    }
  ],
  [
    "PR job requests publishing identity",
    (w) => {
      w.jobs.verify.permissions = { contents: "read", "id-token": "write" };
    }
  ],
  [
    "workflow defaults grant write-all",
    (w) => {
      w.permissions = "write-all";
    }
  ],
  [
    "extra privileged job",
    (w) => {
      w.jobs.extra = w.jobs.publish;
    }
  ],
  [
    "PR job bypasses checks",
    (w) => {
      w.jobs.verify.if = "false";
    }
  ],
  [
    "a required step may fail",
    (w) => {
      w.jobs.verify.steps[3]["continue-on-error"] = true;
    }
  ],
  [
    "a required step is skipped",
    (w) => {
      w.jobs.verify.steps[3].if = "false";
    }
  ],
  [
    "only documentation PRs are checked",
    (w) => {
      w.on.pull_request.paths = ["docs/**"];
    }
  ],
  [
    "privileged PR trigger",
    (w) => {
      w.on.pull_request_target = {};
    }
  ],
  [
    "gate skips unsuccessful verification",
    (w) => {
      delete w.jobs.check.if;
    }
  ],
  [
    "gate succeeds regardless of tests",
    (w) => {
      w.jobs.check.steps[0].run = "true";
    }
  ],
  [
    "a runtime is no longer checked",
    (w) => {
      w.jobs.verify.strategy.matrix.node = [22];
    }
  ],
  [
    "installation executes scripts",
    (w) => {
      w.jobs.verify.steps[2].run = "npm ci";
    }
  ],
  [
    "checkout retains credentials",
    (w) => {
      w.jobs.verify.steps[0].with["persist-credentials"] = true;
    }
  ],
  [
    "unpinned action",
    (w) => {
      w.jobs.verify.steps[0].uses = "actions/checkout@main";
    }
  ],
  [
    "publish can run from a PR",
    (w) => {
      delete w.jobs.publish.if;
    }
  ],
  [
    "publish can skip checks",
    (w) => {
      delete w.jobs.publish.needs;
    }
  ],
  [
    "publish loses protected environment",
    (w) => {
      delete w.jobs.publish.environment;
    }
  ],
  [
    "intake loses request lock",
    (w) => {
      w.concurrency.group = "all-requests";
    },
    intakeFile
  ],
  [
    "intake cancels existing writer",
    (w) => {
      w.concurrency["cancel-in-progress"] = true;
    },
    intakeFile
  ],
  [
    "intake runs from PRs",
    (w) => {
      w.on.pull_request = {};
    },
    intakeFile
  ],
  [
    "intake uses another profile",
    (w) => {
      w.jobs["validate-and-save"].steps.at(-1).env.RELEASE_COORDINATOR_PROFILE =
        "sandbox";
    },
    intakeFile
  ]
]) {
  test(`policy rejects: ${name}`, () => {
    const workflow = parseWorkflow(sources[file]);
    edit(workflow);
    assert.throws(() =>
      validateWorkflows({ ...sources, [file]: stringify(workflow) })
    );
  });
}

test("comments and shell text cannot stand in for actual permissions", () => {
  const workflow = parseWorkflow(sources[releaseFile]);
  workflow.jobs.verify.permissions = { contents: "write" };
  workflow.jobs.verify.steps.push({
    run: 'echo "permissions: {contents: read}"'
  });
  assert.throws(
    () =>
      validateWorkflows({
        ...sources,
        [releaseFile]: `# permissions: {contents: read}\n${stringify(workflow)}`
      }),
    /effective permissions/u
  );
});

for (const yaml of [
  "permissions: {contents: read}\npermissions: write-all\n",
  "permissions: &read {contents: read}\njobs: {check: {permissions: *read}}",
  "permissions: {<<: {contents: write}, contents: read}",
  "permissions: !custom read",
  "name: test\n---\nname: another"
]) {
  test(`ambiguous or unsupported YAML is rejected: ${yaml.split("\n")[0]}`, () => {
    assert.throws(() => parseWorkflow(yaml));
  });
}

test("new workflow files require an explicit policy", () => {
  assert.throws(
    () => validateWorkflows({ ...sources, "extra.yml": sources[intakeFile] }),
    /Register every workflow/u
  );
});
