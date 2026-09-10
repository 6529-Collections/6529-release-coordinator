# Checks for this repository

These checks protect changes to the Release Coordinator's own code. They are
separate from checking or processing release tickets and from the planned tests
of combined frontend/backend PRs. See [progress](./progress.md) for delivery status.

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
2. `npm run format:check`: Prettier checks JavaScript, JSON, and workflow YAML.
   Narrative documents and historical HTML diagrams are outside this formatter.
3. `npm test`: discovers every `.test.mjs` file under `apps`, `packages`, and
   `scripts`, excluding dependencies and generated runtime records. Each root
   must contain tests. Tests use controlled inputs, simulated GitHub responses,
   and temporary real Git repositories.
4. `npm run check:workflows`: parses all workflow YAML and verifies job permissions,
   triggers, pinned actions, the required result, and publishing/intake boundaries.
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

PR jobs have read-only repository permissions. The manually dispatched intake
job alone receives Issue-writing permission and installs production dependencies
only. Publication requires manual dispatch from `main`, successful checks, the
`npm-publish` environment, and its separate short-lived publishing identity.
Workflow tests verify the checked-in configuration, not every live account,
environment, or npm setting. They are regression tests, not a sandbox for
arbitrary workflow code; changes to the policy itself still need review.

## What to extend later

Keep general checking tools separate from Coordinator behavior tests. Add tests
for batch membership, dependency order, retries, and exact combined results with
the batch implementation. A new test runner, product builds, browser tests, and
the frontend's large test-selection system are not needed for this gate.
