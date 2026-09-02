# Release request schema

Version `0.000001` defines the first file produced by the developer-side tool.

- [JSON Schema](./packages/release-request/release-request.schema.json)
- [Valid example](./packages/release-request/release-request.example.json)

## Current boundary

The first tool is a small CLI package at `packages/release-request/` in this
repository. Its package name is `@6529-collections/release-request`. It is
implemented and published in GitHub Packages. The frontend installs published
version `0.0.2` and calls it from the existing release skill. The backend does
not use it yet. Version `0.0.3` source adds the Issue inbox and is not yet
published or installed by the frontend.

When backend integration is added, the backend will install only that package
as a development dependency. It will not install the future Coordinator
server.

The `create` command does this:

1. Creates a unique run ID.
2. Saves a local run record with status `running`.
3. Creates one release-request JSON file from the agent's input.
4. Checks the request against the local schema.
5. Updates the run record to `succeeded` or `failed`.
6. Saves a valid request to the local outbox only when validation passes.

The `submit` command performs those same steps, starts the central GitHub
workflow, waits for it, and saves the workflow result in the run record. In
version `0.0.3` source, success also requires one accepted inbox Issue and the
run record saves its number and URL. It does not start a release, merge code,
build code, or deploy code.

In the frontend release skill, `submit` is a synchronous observation step. A
normal returned success or failure is reported, saved, and followed by the
existing Release Bus process. A signal-style exit or a wait that never returns
stops the release and is raised to the Coordinator owner. The saved JSON is not
Release Bus input and does not grant deployment authority.

## Identity and CLI submission

`requested_by` records who the agent says requested the release. It is useful
context, but it is not trusted proof of identity. Anyone creating JSON could
write a different name there.

Submission keeps two records separate:

1. The release-request JSON says what should be released.
2. One trusted workflow in the Release Coordinator repository adds the GitHub
   actor, stable actor ID, and workflow run.

The agent still uses only this package. The `submit` command accepts
the same completed input JSON as `create`. It creates and validates the full
request, saves the local run, starts the central workflow, waits for the result,
and returns success or failure with a reason. The agent does not need to know the
workflow name or any GitHub command.

The version `0.0.3` workflow validates the full request again and creates one
private GitHub Issue in the Release Coordinator repository. The Issue stores the
exact validated JSON, request checksum, GitHub actor, actor ID, workflow run,
submission time, and accepted result. It starts with `release-request`,
`pending`, and target labels. The workflow reuses the Issue when the same
request is submitted again. It rejects the same request ID with different JSON.
No separate server, database, or inbox secret is needed. The CLI uses the
developer's GitHub login to start the workflow. The workflow uses GitHub's
short-lived `GITHUB_TOKEN`, limited to `issues: write`, to create the Issue.

The agent-facing command will not change. A future `status <request-id>` command
can read the matching issue after submission.

Frontend and backend do not need their own submission workflow files. The CLI
hides the one central workflow. GitHub's default permission rule allows accounts
with Write access to the Release Coordinator repository to start it. Read-only
access is not enough. The repositories, branches, and commits to release are
already recorded in the JSON; the repository where the CLI ran is not used as
permission proof. Submission does not approve or deploy the release. Package
version `0.0.2`, which the frontend release skill uses, validates and logs only.
Version `0.0.3` source adds the Issue inbox result. The backend has not been
integrated yet.

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
4. A later Coordinator combines both sources and checks that the result has no loop.
5. Units with no dependency may deploy together.

The first local-only tool does not calculate this final order yet. It only
checks that the JSON has the agreed structure.

## What the schema checks now

The JSON Schema checks required fields, allowed repository and target names,
field types, and the exact 40-character commit shape. It also requires backend
parts to contain deploy units and prevents frontend parts from containing them.

Some rules compare several fields and need normal program code. Later checks
should confirm that:

- every `id` is unique;
- every `depends_on` value points to another part;
- dependencies have no loop;
- every backend deploy unit exists in the current backend service catalog;
- every deploy dependency uses a selected backend unit.

Those later checks do not change this file shape.

## Changing the schema

Keep version `0.000001` stable. Add optional fields without changing its
meaning. Use a new `schema_version` when a required field, field meaning, or
validation rule changes in a way that can reject an old valid file.
