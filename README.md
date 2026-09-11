# 6529 Release Coordinator

The Coordinator is being built to handle releases across the frontend and
backend. **Request intake is live. One local command now checks a ticket,
rehearses its suitable PRs, runs supported sandbox service/database checks,
and updates that same ticket with the result.
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

Sandbox service checks require GitHub CLI 2.97.0 or later; see the
[command requirements](./apps/coordinator/README.md#run-the-ticket-workflow).

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --issue NUMBER --json
```

The local controller runs this sequence, then exits:

1. Verify the saved ticket and inspect its PRs, checks, reviews, and dependencies.
2. Retire clearly outdated or already-merged requests; give other blockers a reason.
3. For a suitable ticket, create and save its merge plan from the ticket and current configured destinations, then try its exact PRs in temporary local Git repositories.
4. For a complete supported sandbox ticket, run the database, worker, API, and frontend checks on an isolated GitHub Actions runner.
5. Save the results and update the same ticket's labels, status comment, and decision history.

A passing rehearsal adds `rehearsal:passed`. The ticket still waits for the future
release worker. Sandbox application results have their own `services:*` label; no product deployment occurs. Conflicts and missing evidence
get visible reasons and next actions. Repeating unchanged work rechecks the facts
without adding duplicate comments or decisions.

The ticket already supplies the exact PRs, services, target, and dependencies.
The Coordinator creates the rehearsal plan itself. Both profiles currently test
against each repository's current `main`; this does not change `main` or choose
a deployment policy. See the [profiled inbox guide](./docs/profiled-inbox-testing.md).
Omit `--issue` to process the inbox. Sandbox runs first check each ticket, then
test suitable whole tickets together through the bounded batch flow below.
Real runs retain individual ticket plans and Git rehearsals. These rehearsals
do not merge source PRs into `main`.

`inbox:run` replaces the old `inbox:process` and `merge:rehearse` commands; those
entry points have been removed. `inbox:read` and `readiness:check` remain read-only
diagnostics. Submission still uses the public CLI or private `request:submit`.

The command writes the selected inbox's managed ticket presentation and
`codex/inbox-state` history, where plans are saved before Git work. In sandbox it
also dispatches the fixed, pinned service-check workflow in the test backend. It also creates temporary local Git repositories and saves rehearsal
reports with requested PR versions and destinations in profile-specific local
paths before updating the ticket. An `already-merged` closure says the Coordinator will
not handle that request; it does not claim deployment. Mixed merged/open requests
remain open for a scope decision. See the
[command guide](./apps/coordinator/README.md#run-the-ticket-workflow) for permissions,
exit codes and recovery, and [ticket rules](./docs/inbox-processing.md) for labels.

The command prints live progress to stderr and saves per-run logs outside this
checkout, under `~/.6529-release-coordinator/logs/`. It reports the exact path and
preserves earlier history on explicit resume. See [run logs](./apps/coordinator/README.md#run-logs).

The developer [fixture harness](./apps/coordinator/README.md#merge-engine-and-fixture-tests)
still tests the merge engine against sample PRs, including deliberate failures.
Test manifests cannot enter the ticket workflow or either decision journal.
The public npm package and request schema are unchanged.

## Sandbox services and database

The local implementation now extends the same `inbox:run` command with one
complete sandbox ticket: temporary MySQL with fake rows, a database change when
needed, a worker, an API, and a frontend output check. Steps run in dependency
order; a failed prerequisite stops its dependents.

`no` means no release-specific database change; the application still uses a
database. `unknown`, incomplete inspection, and a false `no` hold execution.
Exact inputs and workflow attempts are saved. Retrying the same input verifies
its existing run instead of dispatching another one.

The controller runs locally; the sample programs and temporary database run in
the test backend repository's GitHub Actions job. Each run uses fake data and
removes its owned database after saving the result. A sandbox ticket's `staging`
target does not connect to the real product's staging database. The
[sandbox guide](./docs/merge-rehearsal-testing.md#service-and-database-acceptance)
owns runtime pins, tests and limits. [Progress](./docs/progress.md) distinguishes
local implementation from merged code and live acceptance. The one-ticket
acceptance cases have passed; [PR #45](https://github.com/6529-Collections/6529-release-coordinator/pull/45)
tracks source delivery, review, and CI. Real execution adapters remain absent; switching
profiles does not enable deployment.

## Test a batch of sandbox tickets

Without `--issue`, sandbox `inbox:run` now finishes cheap ticket, scope, database
and Git checks first, then runs normal PR checks on a compatible group's combined
code using temporary PRs. Combined service checks follow. `--issue NUMBER` keeps
the one-ticket service/database path. There is no extra full run per ticket by
default. Confirmed test failures can divide the group within fixed limits; the
final selected combination must itself pass. The first batch stage only supports
complete staging tickets without database changes. See progress for local versus
merged and live evidence.

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

## Agreed next direction

The future worker will find a passing batch, use existing frontend/backend
Actions to deploy it to staging, wait for successful E2E for its deployed
versions, then merge into `main` and run existing production Actions when
authorized. Product workflows keep their separate environment-specific builds.
One release stays active until completion or verified recovery.

Rollback uses new commits undoing the failed batch and ordinary deployments,
only when no database change is confirmed and restoration is safe. Database
changes or uncertain recovery need a person. These are design decisions, not
capabilities of today's `inbox:run`.

The local v5 journal keeps active work complete and archives finished batch and
service records in the same GitHub repository. Exact retries retain their old
attempts and budgets. The lifetime record caps are removed; live sandbox
migration is still pending. See [history storage](./docs/inbox-processing.md#history-storage)
and [implementation evidence](./docs/progress.md#controller-and-history-cleanup-september-11).

## Documentation map

| Need | Document |
| --- | --- |
| What has shipped, what is local, and what comes next | [Progress](./docs/progress.md) |
| Read live and saved run logs, including interruptions and cleanup | [Run logging](./docs/design.md#next-step-v01-run-logging) |
| Check changes to this repository before merging | [Repository code checks](./docs/code-checks.md) |
| Create or submit a request with the installed CLI | [CLI guide](./packages/release-request/README.md) |
| Inspect saved requests and current readiness evidence | [Local Coordinator guide](./apps/coordinator/README.md) |
| Understand the ticket workflow, labels, reasons, and migration | [Inbox processing plan](./docs/inbox-processing.md) |
| Select sandbox or real, submit a request, and run its ticket workflow | [Profiled inbox guide](./docs/profiled-inbox-testing.md) |
| Understand the sandbox merge-rehearsal test matrix and evidence | [Merge rehearsal testing plan](./docs/merge-rehearsal-testing.md) |
| Understand the implemented one-ticket service/database checks and evidence | [Service and database acceptance](./docs/merge-rehearsal-testing.md#service-and-database-acceptance) |
| Review sandbox batching, limits, and excluded-ticket handling | [Batch design](./docs/design.md#proposed-batch-testing-and-selection) |
| Understand request fields and validation limits | [Field guide](./release-request-schema.md), [JSON Schema](./packages/release-request/release-request.schema.json), [example](./packages/release-request/release-request.example.json) |
| See the implemented request and inspection path | [Intake diagram](./release-coordinator-architecture.html) |
| Review agreed release rules and remaining integration work | [Design](./docs/design.md), [process diagram](./release-coordinator-process.html) |
| Publish and adopt the next exact package version | [Publishing guide](./docs/npm-publishing.md) |
| Read completed migration/review evidence | [Migration history](./docs/history/npm-migration.md) |

The future design and process diagram reflect the September 11 decisions.
Implementation and acceptance evidence remain separate in progress.

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
