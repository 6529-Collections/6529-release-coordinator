# Checks for this repository

These checks protect changes to the Release Coordinator's own code. They are
separate from processing release tickets and executing sandbox applications or
combined-ticket CI. See [progress](./progress.md) for delivery status.

## Local command

Use a current Node 22 or 24 release and Git. The development tools also support
Node 20.19+ and Node 22.13+. The published CLI's declared Node requirement is
unchanged. No GitHub login is needed to run these checks.

```sh
npm ci --ignore-scripts
npm run check
```

The install downloads locked dependencies. The check command then runs:

1. `npm run lint`: ESLint's recommended JavaScript rules across source, commands,
   scripts, and tests. This is basic JavaScript analysis, not TypeScript checking.
2. `npm run format:check`: Prettier checks JavaScript, JSON, workflow YAML and
   the checked-in review bot configuration.
   Narrative documents and historical HTML diagrams are outside this formatter.
3. `npm test`: discovers every `.test.mjs` file under `apps`, `packages`, and
   `scripts`, excluding dependencies and generated runtime records. Each root
   must contain tests. Tests use controlled inputs, simulated GitHub responses,
   and temporary real Git repositories.
4. `npm run check:workflows`: parses all workflow YAML and verifies job permissions,
   triggers, pinned actions, the required result, and publishing/intake boundaries.
   It also verifies the CodeQL analysis and fixed automatic review set below.
   Duplicate keys, aliases, merge keys, and other unsupported YAML constructs
   fail explicitly. A new workflow needs an explicit policy and tests.
5. `npm run check:package`: packs the public CLI, checks its reviewed nine-file
   allowlist, and installs that archive in a clean temporary consumer folder.
   The install uses the repository's locked production dependencies from npm's
   cache, with scripts disabled and offline mode enabled. It tests the installed
   CLI's help, version, template, schema export, and example validation.

The wrapper checks source contents before and after running. Existing local
changes are allowed; changes made by the checks themselves fail. Runtime records
and dependencies are excluded using Git's ignore rules. Temporary test and package
folders are removed when their checks finish. If the package check reports a
missing cached dependency, rerun `npm ci --ignore-scripts` before retrying.

These commands never invoke the real inbox runner, submit a request, publish an
npm version, or merge/deploy product code. Package smoke subprocesses receive a
clean environment without GitHub or npm credentials. They do not create sandbox
GitHub resources either.

Formatting fixes are deliberately separate:

```sh
npm run format:fix
```

Review the diff, then rerun `npm run check`. All checks are non-fixing; test output,
npm cache access, and temporary test files are expected.

## GitHub and merge enforcement

The `verify` job in `publish-release-request.yml` runs the same full command on
Node 20, 22, and 24 using disposable GitHub runners. It runs on every PR targeting
`main`, without path filters, and on pushes to `main`. Manual publishing also
requires these checks. Each runner uses `npm ci --ignore-scripts`.

The existing **Check package** job always evaluates the combined result. Failed,
cancelled, or skipped verification cannot produce a passing gate. Its name stays
the same so the existing required-check rule continues to match it.

The repository rules must require that result and an up-to-date branch before
merging. GitHub also checks merge conflicts. These server settings cannot be
enforced by a local command; see the dated readback in progress. New workflow
behavior only becomes live after the change is pushed and merged as appropriate.

Ordinary PR test jobs have read-only repository permissions. CodeQL alone adds
`security-events: write` to upload analysis, without content, Issue or publishing
write access. It does not install dependencies or execute project programs.
The manually dispatched intake
job alone receives Issue-writing permission and installs production dependencies
only. Publication requires manual dispatch from `main`, successful checks, the
`npm-publish` environment, and its separate short-lived publishing identity.
Workflow tests verify the checked-in configuration, not every live account,
environment, or npm setting. They are regression tests, not a sandbox for
arbitrary workflow code; changes to the policy itself still need review.

## Automatic review set

Every PR targeting `main`, including drafts, uses the same review set. There is
no size classifier, risk label or manual opt-in. Configuration is on this branch;
see [progress](./progress.md) for delivery and live activation evidence.

| Reviewer | Initial PR | Each new push |
| --- | --- | --- |
| 6529bot general | Full review | Full review |
| 6529bot security | Full review | Full review |
| 6529bot deployment/Actions | Full review | Full review |
| 6529bot GLM Swarm | Advisory review group | Advisory review group |
| 6529bot follow-up | Not needed yet | Reviews fixes and earlier comments |
| CodeRabbit | Review, including drafts | Incremental review, with no automatic pause after a commit count |

[`.github/6529bot.yml`](../.github/6529bot.yml) keeps one Anthropic lane for the
ordinary reviews. GLM Swarm uses the bot's fixed OpenRouter lane. Opening a PR
creates four bot jobs; pushing creates five, including follow-up. The per-delivery
limit is five. Central permission, provider availability and enforced spending
caps remain authoritative; this configuration cannot raise them. Public requests
must come from a trusted maintainer. No provider credentials belong in this repo.

The central bot reads config from the **PR base**, so these settings become
effective after merging them into `main`. A feature-branch config alone does not
prove the new jobs ran. The existing central draft policy already permitted the
four default reviews on PR #66; this file preserves draft admission and changes
the selected review kinds.

[`.coderabbit.yaml`](../.coderabbit.yaml) enables draft and incremental reviews,
shows incomplete/failed review status, and leaves automatic approval disabled.
CodeRabbit reads the feature-branch file, subject to organization overrides.
Its behavior must still be verified on the latest PR commit.

Bot comments are advice, not release permission or passing tests. Before merging,
inspect current reviews and check that every expected job completed. Investigate
valid findings; a skipped, failed or context-truncated review is not complete
coverage. GLM may report degraded reviewer threads; an advisory summary alone
does not prove every reviewer completed. These reviews do not currently produce
one required GitHub status that enforces the whole bot set.

## CodeQL and dependency security

[`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml) runs on every
PR into `main`, every push to `main`, and manual dispatch. It scans JavaScript
and GitHub Actions separately with `security-extended` queries. Both actions are
pinned to the same reviewed CodeQL commit. Analysis uploads the results for the
actual checked-out revision and waits for GitHub to process them.

The workflow deliberately has no draft/path filters, skipped failure steps,
repository secrets, dependency installation or application execution. CodeQL's
scoped built-in token is used only by the analysis actions. Use this checked-in
advanced setup; enabling a separate default setup would duplicate/conflict with it.

A green analysis job means the scan completed, not that it found zero problems.
GitHub code-scanning merge protection must separately require CodeQL and reject
new high/critical security findings or error-level findings. Keep `Check package`
required and the branch up to date. Live enforcement is an external repository
setting; do not describe it as active until it has been read back.

Snyk dependency checks use the existing **6529 Snyk organization and GitHub
integration**, as in the product repositories. This avoids exposing a Snyk token
to untrusted PR code. Snyk setup requires an authenticated organization account;
there is no repository credential to use as a fallback.

Import this repository's supported manifests/lockfile into that integration,
enable automatic dependency PR checks and check that root and workspace
dependencies are represented. Use checks for newly introduced vulnerabilities,
including ones without a fix; do not silently exempt dependencies or dismiss
existing findings to obtain a pass. Verify an actual check on a draft and after
a new push, and then require the observed Snyk status on `main`. Some Snyk
settings live in the service rather than a repository file. Until import and
live checks are verified, Snyk remains pending rather than a passing empty job.

Sources: [6529bot configuration](https://github.com/6529-Collections/6529reviewbot/blob/main/docs/repository-config.md),
[CodeRabbit configuration](https://docs.coderabbit.ai/reference/configuration),
[CodeQL workflows](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options),
[Snyk PR checks](https://docs.snyk.io/scan-with-snyk/pull-requests/pull-request-checks/configure-pull-request-checks).

## Behavior tests and sandbox execution

The service extension's contract, workflow-result verification, durable attempts
and complete ticket integration run as offline tests in `npm run check`.
Sequencing, database answers, stop/retry rules and evidence matching are covered.
These tests do not contact GitHub, change inbox tickets or require Docker/product
credentials.

The explicit `apps/coordinator/sandbox/test-runtime.mjs --run-owned-containers`
runner is separate: it uses local Docker and temporary MySQL. The generated
sample repositories run equivalent application assertions in their own PR CI.
The live `inbox:run` command dispatches GitHub Actions, so it does not require
Docker on the operator's machine. See the
[service acceptance record](./testing/service-database-2026-09-10.md).

Batch membership, bounded splitting, exact-combination and recovery tests now
run in the offline suite. The [complex corner-case campaign](./testing/complex-corner-cases.md)
also includes three explicit Docker cases (CT-14/15/17), skipped unless
`COORDINATOR_CT_DOCKER=1` is supplied. Optional live evidence readback in CT-12
requires `COORDINATOR_CT_LIVE_JOURNAL`; the normal gate stays offline. CT-09
characterizes the known takeover race, so its passing assertion is not a claim
that recovery can safely take over a still-running process.

Run logging tests exercise the real CLI and journal with controlled GitHub
responses, plus actual temporary Git candidates. They cover live-before-result
output, JSON stdout, interrupted/resumed history, lost responses, exact changed
main reasons, partial cleanup, private/profile-separated paths, redaction and
storage failures. Test logs use disposable temporary directories; they do not
populate the operator's persistent log directory. See the [logging contract](./design.md#next-step-v01-run-logging).
