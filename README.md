# 6529 Release Coordinator

The Coordinator is being built to handle releases across the frontend and
backend. **Request intake is live; the read-only inbox reader is implemented
locally. Automatic release execution is not built yet.**

The public CLI creates a request, validates it, saves local records, and submits
it to a central GitHub workflow. The workflow saves one public Issue and returns
its link. The local reader checks pending Issues against their workflow
results. Neither step approves or performs a release.

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
It reads open Issues with both `release-request` and `pending`, validates their
saved JSON, and checks the matching successful workflow evidence. Missing proof
is reported as unverified; a listing failure is an error rather than an empty
inbox. **Valid means the saved record is verified, not that the PR is ready to
release.** See the [reader guide](./apps/coordinator/README.md) for the exact
checks, exit codes, and limits.

## Documentation map

| Need | Document |
| --- | --- |
| What has shipped, what is local, and what comes next | [Progress](./docs/progress.md) |
| Create or submit a request with the installed CLI | [CLI guide](./packages/release-request/README.md) |
| Read the inbox locally | [Reader guide](./apps/coordinator/README.md) |
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
- `apps/coordinator/`: the private local reader. It is not published with the CLI.
- `.github/workflows/submit-release-request.yml`: validates and saves inbox Issues.
- `.github/workflows/publish-release-request.yml`: checks the workspaces and
  publishes the CLI through the protected manual publication path.

The schema and code define current behavior. Progress is a dated evidence
record. Design documents describe future work; history preserves past evidence.
Product repositories retain their own authorized merge and deployment procedures.
Release requests and workflow logs are public and must never contain secrets.

Run the existing local test suites with `npm test`. This does not submit a
request or deploy anything.
