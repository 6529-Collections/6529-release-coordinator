# 6529 Release Coordinator

The Coordinator is being built to handle releases across the frontend and
backend. **Request intake is live. One local command now checks a ticket,
rehearses its suitable PRs, and updates that same ticket with the result.
Sandbox and real profiles share the same code. Automatic release execution
is not built yet.**

The public CLI creates a request, validates it, saves local records, and submits
it to a central GitHub workflow. The workflow saves one public Issue and returns
its link. The local reader checks open request Issues against their workflow
results. The readiness command also inspects current PRs and backend dependency
order. These commands do not approve or perform a release.

Frontend and backend release-recording integrations are merged. Current
versions, exact PR/commit evidence, local-versus-remote state, tests, and remaining
work are tracked in [Progress and next steps](./docs/progress.md).

## Run the ticket workflow

Use one command with an explicit profile and ticket:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --issue NUMBER --json
```

It runs this sequence on your machine and exits:

1. Verify the saved ticket and inspect its PRs, checks, reviews, and dependencies.
2. Retire clearly outdated or already-merged requests; give other blockers a reason.
3. For a suitable ticket, create and save its merge plan from the ticket and current configured destinations, then try its exact PRs in temporary local Git repositories.
4. Save the result and update the same ticket's labels, status comment, and decision history.

A passing rehearsal adds `rehearsal:passed`. The ticket still waits for the future
release worker; nothing has been built or deployed. Conflicts and missing evidence
get visible reasons and next actions. Repeating unchanged work rechecks the facts
without adding duplicate comments or decisions.

The ticket already supplies the exact PRs, services, target, and dependencies.
The Coordinator creates the rehearsal plan itself. Both profiles currently test
against each repository's current `main`; this does not change `main` or choose
a deployment policy. See the [profiled inbox guide](./docs/profiled-inbox-testing.md).
Omit `--issue` to process the inbox, giving each suitable ticket its own plan and
rehearsal. Different tickets are not merged together.

`inbox:run` replaces the old `inbox:process` and `merge:rehearse` commands; those
entry points have been removed. `inbox:read` and `readiness:check` remain read-only
diagnostics. Submission still uses the public CLI or private `request:submit`.

The command's GitHub writes are limited to the selected inbox's managed ticket
presentation and `codex/inbox-state` history, where plans are saved before Git
work. It also creates temporary local Git repositories and saves rehearsal
reports with requested PR versions and destinations in profile-specific local
paths before updating the ticket. An `already-merged` closure says the Coordinator will
not handle that request; it does not claim deployment. Mixed merged/open requests
remain open for a scope decision. See the
[command guide](./apps/coordinator/README.md#run-the-ticket-workflow) for permissions,
exit codes and recovery, and [ticket rules](./docs/inbox-processing.md) for labels.

The developer [fixture harness](./apps/coordinator/README.md#merge-engine-and-fixture-tests)
still tests the merge engine against sample PRs, including deliberate failures.
Test manifests cannot enter the ticket workflow or either decision journal.
The public npm package and request schema are unchanged.

## Planned next stage: test a batch of tickets

**Not implemented:** keep the existing checks for each ticket, select complete
compatible requests, and run normal PR checks on their combined code. Avoid
another full build/test run per ticket by default. If a batch fails, try smaller
groups within time/attempt limits, preserving dependencies. Test the final
selected combination; do not assume separately passing groups work together.

Excluded tickets stay visible with a reason and next action. If A and B pass
alone but fail together, use a saved priority order to select one independent
candidate and defer the other. After A reaches `main`, B may need a correction
to work with that new base. A failed group is not proof every ticket is broken.
See the [batch design](./docs/design.md#proposed-batch-testing-and-selection),
[ticket outcomes](./docs/inbox-processing.md#proposed-batch-ticket-outcomes), and
[sandbox acceptance plan](./docs/merge-rehearsal-testing.md#planned-batch-acceptance).

## Read-only diagnostics

From this repository, use Node.js 20+ and an authenticated, current GitHub CLI
(`gh`). Install dependencies if needed, then run one scan:

```sh
npm ci --ignore-scripts
npm run inbox:read
```

For JSON without npm's script banner:

```sh
npm run --silent inbox:read -- --json
```

The command runs on your machine, reads GitHub, prints a report, and exits.
It reads all open `release-request` Issues, including waiting tickets, validates their
saved JSON, and checks the matching successful workflow evidence. Missing proof
is reported as unverified; a listing failure is an error rather than an empty
inbox. **Valid means the saved record is verified, not that the PR is ready to
release.** See the [reader guide](./apps/coordinator/README.md) for the exact
checks, exit codes, and limits.

To also inspect current PR commits, GitHub merge/check/review evidence, and
backend service dependencies:

```sh
npm run readiness:check
```

Use `npm run --silent readiness:check -- --json` for JSON. The report separates
known blockers from missing evidence. It reports release history and execution
merge proof as unknown: it has no verified release-outcome source and does not
consume the separate merge-rehearsal reports.
See [readiness checks](./apps/coordinator/README.md#readiness-checks) for details.

## Documentation map

| Need | Document |
| --- | --- |
| What has shipped, what is local, and what comes next | [Progress](./docs/progress.md) |
| Check changes to this repository before merging | [Repository code checks](./docs/code-checks.md) |
| Create or submit a request with the installed CLI | [CLI guide](./packages/release-request/README.md) |
| Inspect saved requests and current readiness evidence | [Local Coordinator guide](./apps/coordinator/README.md) |
| Understand the ticket workflow, labels, reasons, and migration | [Inbox processing plan](./docs/inbox-processing.md) |
| Select sandbox or real, submit a request, and run its ticket workflow | [Profiled inbox guide](./docs/profiled-inbox-testing.md) |
| Understand the sandbox merge-rehearsal test matrix and evidence | [Merge rehearsal testing plan](./docs/merge-rehearsal-testing.md) |
| Review proposed batching, limited retries, and excluded-ticket handling | [Batch design](./docs/design.md#proposed-batch-testing-and-selection) |
| Understand request fields and validation limits | [Field guide](./release-request-schema.md), [JSON Schema](./packages/release-request/release-request.schema.json), [example](./packages/release-request/release-request.example.json) |
| See the implemented request and inspection path | [Intake diagram](./release-coordinator-architecture.html) |
| Review the future release design and unsettled choices | [Design](./docs/design.md), [process diagram](./release-coordinator-process.html) |
| Publish and adopt the next exact package version | [Publishing guide](./docs/npm-publishing.md) |
| Read completed migration/review evidence | [Migration history](./docs/history/npm-migration.md) |

The future design and process diagram still differ on release ownership, when
`main` changes, and production builds. Those differences are recorded together
in the design document and must be settled before release execution is built.

## Code and ownership

- `packages/release-request/`: the small published CLI. Product repositories
  install this package only. Its own README and license are part of the npm
  archive and must remain with it.
- `apps/coordinator/`: private profiled submission, read-only diagnostics, and the combined
  ticket workflow. These are not published with the CLI.
- `.github/workflows/submit-release-request.yml`: validates and saves inbox Issues.
- `.github/workflows/publish-release-request.yml`: checks the workspaces and
  publishes the CLI through the protected manual publication path.

The schema and code define current behavior. Progress is a dated evidence
record. Design documents describe future work; history preserves past evidence.
Product repositories retain their own authorized merge and deployment procedures.
Release requests and workflow logs are public and must never contain secrets.

## Check changes to this repository

After `npm ci --ignore-scripts`, run `npm run check`. It checks JavaScript,
formatting, all automated tests, workflow permissions, and the packed public
CLI. GitHub runs the same command on PRs into `main` and pushes to `main`.
The existing required `Check package` result requires every configured Node
version to pass. See [code checks](./docs/code-checks.md) for setup and boundaries
and [progress](./docs/progress.md) for local versus merged/CI evidence.

This checks Coordinator code using controlled inputs and temporary repositories;
it does not process real inbox tickets. `inbox:run` is the separate ticket command.
`npm test` still runs just the automated tests. Fix formatting separately with
`npm run format:fix`, then review the diff and rerun the checks.
