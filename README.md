# 6529 Release Coordinator

The Coordinator is being built to handle releases across the frontend and
backend. **Request intake is live; local inspection, explicit inbox processing,
and sandbox merge rehearsals are implemented. Automatic release execution is
not built yet.**

The public CLI creates a request, validates it, saves local records, and submits
it to a central GitHub workflow. The workflow saves one public Issue and returns
its link. The local reader checks open request Issues against their workflow
results. The readiness command also inspects current PRs and backend dependency
order. These commands do not approve or perform a release.

Frontend and backend release-recording integrations are merged. Current
versions, exact PR/commit evidence, local-versus-remote state, tests, and remaining
work are tracked in [Progress and next steps](./docs/progress.md).

## Read the inbox locally

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
known blockers from missing evidence. It deliberately reports release history
and an exact execution merge plan as unknown; these are not implemented yet.
See [readiness checks](./apps/coordinator/README.md#readiness-checks) for details.

## Organize the tickets

The separate command below writes managed labels, readable titles, verified
submitter assignment, one status comment, and durable decisions. It retires
clearly outdated requests and requests whose PRs are all already merged. It keeps
other missing evidence visible with an action owner:

```sh
npm run inbox:process
```

Use `-- --issue NUMBER` to limit changes to one ticket. Both `inbox:read` and
`readiness:check` stay read-only. No command changes remote branches, builds,
or deploys; sandbox rehearsals merge only inside temporary local repositories.
An `already-merged` closure means the Coordinator will not handle that request;
it does not claim a successful deployment. A verified merged PR plus an open or
unverified companion keeps the request open for a scope decision. Missing
evidence alone can remain waiting. Any remaining deployment uses the existing authorized
release process; submitting the same merged PR again will not make it eligible.
[The command guide](./apps/coordinator/README.md#organize-tickets-explicitly)
explains permissions, retries, and the separate GitHub state branch.
[Ticket rules](./docs/inbox-processing.md) own status/reason meanings.

Current merge status, dated test results, and rollout evidence are tracked in
[progress](./docs/progress.md). CLI input, schema, and the installed public npm
package stay unchanged. Update local readers together with the intake workflow,
so removing legacy `pending` cannot hide waiting tickets.

## Rehearse sandbox merges locally

The private rehearsal command tries exact PR commits against explicit
destination commits in temporary local repositories. It shares one engine
across sandbox and real profiles. Live acceptance so far uses the sandbox.

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run merge:rehearse -- --manifest PATH_TO_TEST_MANIFEST --json
```

For the verified ticket path and the shared sandbox/real switch, see the
[profiled inbox guide](./docs/profiled-inbox-testing.md).

Use the [command guide](./apps/coordinator/README.md#sandbox-merge-rehearsal)
for the manifest shape, report paths, and limits. Real mode requires a verified inbox ticket and an explicit destination plan; test manifests remain sandbox-only.
The [merge rehearsal testing plan](./docs/merge-rehearsal-testing.md) defines
the separate sandbox inputs, implementation steps, test cases, and finish line.
Local tests and live GitHub acceptance are separate milestones recorded in
[progress](./docs/progress.md). This command produces local evidence; it does
not update tickets or perform a release.

## Documentation map

| Need | Document |
| --- | --- |
| What has shipped, what is local, and what comes next | [Progress](./docs/progress.md) |
| Create or submit a request with the installed CLI | [CLI guide](./packages/release-request/README.md) |
| Inspect saved requests and current readiness evidence | [Local Coordinator guide](./apps/coordinator/README.md) |
| Understand the ticket workflow, labels, reasons, and migration | [Inbox processing plan](./docs/inbox-processing.md) |
| Build and test the next local merge rehearsal in isolated test repositories | [Merge rehearsal testing plan](./docs/merge-rehearsal-testing.md) |
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
- `apps/coordinator/`: private local inbox inspection and processing. They are not published with the CLI.
- `.github/workflows/submit-release-request.yml`: validates and saves inbox Issues.
- `.github/workflows/publish-release-request.yml`: checks the workspaces and
  publishes the CLI through the protected manual publication path.

The schema and code define current behavior. Progress is a dated evidence
record. Design documents describe future work; history preserves past evidence.
Product repositories retain their own authorized merge and deployment procedures.
Release requests and workflow logs are public and must never contain secrets.

Run the existing local test suites with `npm test`. This does not submit a
request or deploy anything.
