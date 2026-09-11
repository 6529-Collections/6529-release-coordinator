import assert from "node:assert/strict";
import test from "node:test";
import { stringify } from "yaml";
import {
  parseWorkflow,
  readReviewConfiguration,
  readWorkflows,
  validateReviewConfiguration,
  validateWorkflows
} from "../check-workflows.mjs";

const sources = await readWorkflows();
const releaseFile = "publish-release-request.yml";
const intakeFile = "submit-release-request.yml";
const codeqlFile = "codeql.yml";

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

for (const [name, edit, file = releaseFile, expected] of [
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
      w.jobs.extra = structuredClone(w.jobs.publish);
    },
    releaseFile,
    /Unexpected or missing workflow jobs/u
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
    "dependency audit is missing",
    (w) => {
      w.jobs.verify.steps.pop();
    }
  ],
  [
    "dependency audit excludes workspace packages",
    (w) => {
      w.jobs.verify.steps[4].run = "npm audit --workspaces=false";
    }
  ],
  [
    "dependency audit omits development tools",
    (w) => {
      w.jobs.verify.steps[4].run = w.jobs.verify.steps[4].run.replace(
        "--include=dev",
        "--omit=dev"
      );
    }
  ],
  [
    "dependency audit ignores medium findings",
    (w) => {
      w.jobs.verify.steps[4].run = w.jobs.verify.steps[4].run.replace(
        "--audit-level=low",
        "--audit-level=high"
      );
    }
  ],
  [
    "dependency audit failures are ignored",
    (w) => {
      w.jobs.verify.steps[4]["continue-on-error"] = true;
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
  ],
  [
    "CodeQL can write repository contents",
    (w) => {
      w.jobs.analyze.permissions.contents = "write";
    },
    codeqlFile
  ],
  [
    "CodeQL can obtain publication credentials",
    (w) => {
      w.jobs.analyze.permissions["id-token"] = "write";
    },
    codeqlFile
  ],
  [
    "CodeQL receives a repository secret",
    (w) => {
      w.jobs.analyze.steps[1].with.token = "${{ secrets.PAT }}";
    },
    codeqlFile
  ],
  [
    "CodeQL skips drafts",
    (w) => {
      w.jobs.analyze.if = "!github.event.pull_request.draft";
    },
    codeqlFile
  ],
  [
    "CodeQL filters out documentation or workflow PRs",
    (w) => {
      w.on.pull_request.paths = ["apps/**"];
    },
    codeqlFile
  ],
  [
    "CodeQL uses a privileged PR trigger",
    (w) => {
      w.on.pull_request_target = w.on.pull_request;
      delete w.on.pull_request;
    },
    codeqlFile
  ],
  [
    "CodeQL omits Actions analysis",
    (w) => {
      w.jobs.analyze.strategy.matrix.language = ["javascript-typescript"];
    },
    codeqlFile
  ],
  [
    "CodeQL executes repository commands",
    (w) => {
      w.jobs.analyze.steps.push({ run: "npm ci && npm test" });
    },
    codeqlFile
  ],
  [
    "CodeQL ignores analysis failures",
    (w) => {
      w.jobs.analyze.steps[2]["continue-on-error"] = true;
    },
    codeqlFile
  ],
  [
    "CodeQL stops uploading findings",
    (w) => {
      w.jobs.analyze.steps[2].with.upload = "never";
    },
    codeqlFile
  ],
  [
    "CodeQL reports against unrelated code",
    (w) => {
      w.jobs.analyze.steps[2].with.ref = "refs/heads/main";
      w.jobs.analyze.steps[2].with.sha = "a".repeat(40);
    },
    codeqlFile
  ],
  [
    "CodeQL downgrades queries",
    (w) => {
      w.jobs.analyze.steps[1].with.queries = "default";
    },
    codeqlFile
  ],
  [
    "CodeQL stops waiting for result processing",
    (w) => {
      w.jobs.analyze.steps[2].with["wait-for-processing"] = false;
    },
    codeqlFile
  ],
  [
    "CodeQL uses an unpinned action",
    (w) => {
      w.jobs.analyze.steps[1].uses = "github/codeql-action/init@v4";
    },
    codeqlFile
  ],
  [
    "an action has an extra ref suffix",
    (w) => {
      w.jobs.verify.steps[0].uses += "@other";
    }
  ],
  [
    "a CodeQL action is added to the publishing job",
    (w) => {
      w.jobs.publish.steps.push({
        uses: "github/codeql-action/init@" + "a".repeat(40)
      });
    }
  ]
]) {
  test(`policy rejects: ${name}`, () => {
    const workflow = parseWorkflow(sources[file]);
    edit(workflow);
    assert.throws(
      () => validateWorkflows({ ...sources, [file]: stringify(workflow) }),
      expected
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

const reviewSources = await readReviewConfiguration();
test("the full review set covers new PRs, drafts and updated PRs", () => {
  validateReviewConfiguration(reviewSources);
});

for (const [name, file, edit] of [
  [
    "bot reviews disabled",
    ".github/6529bot.yml",
    (c) => {
      c.enabled = false;
    }
  ],
  [
    "initial review omits GLM",
    ".github/6529bot.yml",
    (c) => {
      c.reviewKinds.initial.pop();
    }
  ],
  [
    "push runs only follow-up",
    ".github/6529bot.yml",
    (c) => {
      c.reviewKinds.followup = ["followup"];
    }
  ],
  [
    "draft bot reviews skipped",
    ".github/6529bot.yml",
    (c) => {
      c.admission.draftPrMode = "skip";
    }
  ],
  [
    "untrusted public PRs can spend",
    ".github/6529bot.yml",
    (c) => {
      c.admission.publicRepoMode = "open";
    }
  ],
  [
    "review fanout exceeds job budget",
    ".github/6529bot.yml",
    (c) => {
      c.limits.maxJobsPerDelivery = 4;
    }
  ],
  [
    "spending enforcement removed",
    ".github/6529bot.yml",
    (c) => {
      c.budget.mode = "off";
    }
  ],
  [
    "CodeRabbit skips drafts",
    ".coderabbit.yaml",
    (c) => {
      c.reviews.auto_review.drafts = false;
    }
  ],
  [
    "CodeRabbit skips pushes",
    ".coderabbit.yaml",
    (c) => {
      c.reviews.auto_review.auto_incremental_review = false;
    }
  ],
  [
    "CodeRabbit pauses after five commits",
    ".coderabbit.yaml",
    (c) => {
      c.reviews.auto_review.auto_pause_after_reviewed_commits = 5;
    }
  ],
  [
    "CodeRabbit requires a label",
    ".coderabbit.yaml",
    (c) => {
      c.reviews.auto_review.labels = ["review-me"];
    }
  ],
  [
    "CodeRabbit ignores workflow files",
    ".coderabbit.yaml",
    (c) => {
      c.reviews.path_filters = ["!.github/**"];
    }
  ],
  [
    "CodeRabbit hides review failures",
    ".coderabbit.yaml",
    (c) => {
      c.reviews.fail_commit_status = false;
    }
  ]
]) {
  test(`review policy rejects: ${name}`, () => {
    const config = parseWorkflow(reviewSources[file]);
    edit(config);
    assert.throws(() =>
      validateReviewConfiguration({
        ...reviewSources,
        [file]: stringify(config)
      })
    );
  });
}
