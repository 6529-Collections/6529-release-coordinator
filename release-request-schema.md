# Release request schema

Version `0.000001` defines the first file produced by the developer-side tool.

- [JSON Schema](./packages/release-request/release-request.schema.json)
- [Valid example](./packages/release-request/release-request.example.json)

## Current boundary

The JSON Schema is the source of truth for the saved request's shape. The CLI
at `packages/release-request/` creates and validates that request; its `submit`
command also saves it through the central GitHub workflow. Product repositories
install only the CLI package. The private local reader at `apps/coordinator/`
reuses the schema and checks saved inbox records against their workflow proof.
Its separate `readiness:check` command validates cross-field dependencies and
reads current PR/catalog evidence without changing the public request format.

For commands and submission behavior, use the [CLI guide](./packages/release-request/README.md).
For consumer versions, merged integrations, and delivery evidence, use
[progress](./docs/progress.md). For the reader's exact checks and limitations,
use the [reader guide](./apps/coordinator/README.md).

`create` saves local records only. `submit` creates and validates the same request,
then waits for the central workflow and saves the returned Issue result. Saving
or verifying a request does not authorize or perform a release. The product
repositories' release skills own their current recording and deployment rules.

## Identity and submission proof

`requested_by` is supplied context, not authentication. The request JSON says
what code is requested. GitHub separately records the real actor, stable actor
ID, and workflow run. The public inbox Issue stores the request, checksum, and
that submission metadata. Editable Issue text is not sufficient proof: the
reader compares it with the expected successful workflow's result.

The central workflow validates the request and creates one Issue. The inbox
processing implementation adds readable titles, verified submitter assignment,
`release-request`, `status:received`, target, and component labels. Repeating the
same request ID and JSON reuses that Issue, including a closed Issue; different
JSON under the same ID is rejected. No additional CLI input is required.

Older workflow revisions use `pending`. Both local readers now select every open
`release-request` ticket, and explicit processing can migrate older presentation.
See [ticket rules](./docs/inbox-processing.md) and [rollout evidence](./docs/progress.md)
for the distinction between local implementation and the live workflow revision.

Ticket status, reason codes, next action/owner, decision history, and replacement
or completion evidence belong to Coordinator state. They are not additions to
the public request JSON. Preserve the original JSON, checksum, actor, and
workflow receipt. Keep `0.000001` unchanged for this stage; mutable status belongs
in a separate managed comment and history record. Reusing a request must not
reset or reopen its existing ticket.

The CLI generates `schema_version`, `request_id`, and `created_at`. The agent
must not include those fields in its input template. A combined frontend/backend
release is one request with both parts, not two separate requests.

## Local files

Every `create` and `submit` attempt has a run record:

```text
.release-coordinator/runs/<run-id>.json
```

The run record contains the run ID, start and finish times, status, received
input, errors, and the saved request ID and path when successful. A submit run
also contains the workflow run, GitHub actor when available, and submission
result. A run that stops unexpectedly may remain `running`, which shows that it
did not finish cleanly.

Only a valid release request is saved here:

```text
.release-coordinator/outbox/<request-id>.json
```

This separation prevents a failed attempt from looking like a usable release
request. It also keeps the reason for every failed attempt.

`release-request.schema.json` validates the outbox request. It does not validate
the run record. The run record is the CLI's history of what it tried.

If the CLI cannot save the run record at all, it stops and does not create an
accepted request.

Both folders are created inside the product repository where the command runs.
The `.release-coordinator/` folder should be ignored by Git. A combined frontend
and backend release is still one CLI run and one request containing both parts.

## Why the file uses `release_parts`

A release needs two kinds of facts:

- **Which code?** Repository, pull request, branch, and exact commit.
- **What must run?** The frontend app or selected backend deploy units.

These facts stay together inside each `release_part`. This avoids two separate
lists that can disagree.

The frontend is one deployed app, so its part has no `deploy_units`.
The backend has many separately deployed units, so its part must list them.

## Fields

| Field | Meaning | Why it exists |
|---|---|---|
| `schema_version` | File format version. | Lets future tools read old files safely. |
| `request_id` | Unique ID for this request. | Gives the file a stable identity. |
| `created_at` | Time the file was created. | Shows when the saved facts were collected. |
| `requested_by` | Name recorded by the agent. | Gives human context. It is not trusted identity proof. |
| `target` | `staging` or `production`. | Says where the work is intended to go. |
| `database_change` | `yes`, `no`, or `unknown`. | Recovery rules differ when the database changes. |
| `release_parts` | The code groups included in the release. | Supports frontend-only, backend-only, and combined releases. |
| `release_parts[].id` | Short name used by dependencies. | Lets one part point to another. |
| `release_parts[].repository` | Frontend or backend repository. | Says where the code lives. |
| `pull_requests` | PR number, branch, and exact 40-character commit. | Pins the exact code instead of only naming a moving branch. |
| `depends_on` | Other release-part IDs that must finish first. | Describes cross-repository order, such as backend before frontend. |
| `deploy_units` | Backend units selected for deployment. | The backend is not deployed as one app. |
| `deploy_dependencies` | Extra `before` and `after` rules for this release. | Handles a dependency that is special to this release. |

## How backend order works

The release file does not copy the whole backend service catalog.

1. `deploy_units` says which backend units this release needs.
2. The backend service catalog owns normal service dependencies.
3. `deploy_dependencies` adds only rules that are special to this release.
4. The local readiness checker combines both sources with release-part order
   and checks that the result has no loop.
5. A later execution plan will decide how to run units with no dependency.

The CLI and `inbox:read` do not calculate this order. `readiness:check` reads the
catalog at the exact requested backend commits, validates selected units and
target environments, and reports an order only when the graph is complete and
valid. A missing prerequisite requires deployment evidence; it is not silently
added. Conflicting catalog definitions require the exact combined merge result.
Schema validation itself checks structure, not catalog membership or graph safety.

## What the schema checks now

The JSON Schema checks required fields, allowed repository and target names,
field types, and the exact 40-character commit shape. It also requires backend
parts to contain deploy units and prevents frontend parts from containing them.

Some rules compare several fields and need normal program code. The private
readiness checker now confirms that:

- every `id` is unique;
- every `depends_on` value points to another part;
- dependencies have no loop;
- every backend deploy unit exists in the catalog at the requested code;
- every deploy dependency uses a selected backend unit.

These checks do not change this file shape or make intake verification a release
approval. See the [readiness guide](./apps/coordinator/README.md#readiness-checks)
for missing history, merge-proof limits, and result meanings.

## Changing the schema

Keep version `0.000001` stable. Add optional fields without changing its
meaning. Use a new `schema_version` when a required field, field meaning, or
validation rule changes in a way that can reject an old valid file.
