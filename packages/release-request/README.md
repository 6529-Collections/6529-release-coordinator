# @6529-collections/release-request

This package creates, validates, and submits one 6529 release request.

Its central workflow saves each accepted request as one public GitHub Issue.
It does not queue, merge, build, test, or deploy anything.

## Commands

Print the current agent-input template:

```sh
6529-release-request template
```

The agent fills this template and removes any frontend or backend part that is
not included in the release. The CLI adds `schema_version`, `request_id`, and
`created_at`; the agent must not provide them.

Create a request from standard input:

```sh
6529-release-request create --input -
```

Create a request from a file:

```sh
6529-release-request create --input release-input.json
```

The command writes local files inside the project directory where it runs:

```text
.release-coordinator/runs/<run-id>.json
.release-coordinator/outbox/<request-id>.json
```

Every `create` attempt saves a run record. Only a valid release request is
saved to the outbox.

## Submit a request

`create` remains available for local-only use. The frontend release skill now
uses `submit`, which accepts the same agent-input JSON:

```sh
6529-release-request submit --input release-input.json
```

The CLI creates and validates the full request, saves the local run, starts one
central workflow in the Release Coordinator repository, waits for it, and returns
success or failure with a reason. The agent will not run `gh`, choose a workflow,
or poll GitHub itself. Frontend and backend do not need their own submission
workflow files.

The workflow validates the request again and saves one public GitHub Issue. The
Issue title is `Release request <request-id>`. Its body contains the exact
validated request, checksum, real GitHub actor, stable actor ID, workflow run,
submission time, and accepted result. It starts with `release-request`,
`pending`, and target labels. In this version,
`submitted` means GitHub validated and saved the request. It does not mean that
anything was approved or deployed.

By default, GitHub allows accounts with Write access to the Release Coordinator
repository to start this manual workflow. The request JSON already names every
repository, branch, pull request, and exact commit to release.

The release JSON says what should be released. Its `requested_by` field is not
authentication. The GitHub submission proof says who sent it. Future delivery
must keep those two records separate.

The CLI returns the request ID and Issue link. Sending the same request again
reuses the same Issue. Reusing the same request ID with different JSON fails.
Invalid requests create no Issue.

A future command can read the issue status without exposing GitHub workflow
details to the agent:

```sh
6529-release-request status REQUEST_ID
```

Package version `0.0.3` is published and adds the GitHub Issue inbox result. The
frontend uses version `0.0.3`, so it returns and saves the Issue link. The
backend has not been integrated yet. The `status` command does not exist yet.

## Publishing

The package is published in the private GitHub Packages registry. A manual run
of the publishing workflow checks a package version without publishing it.
Pushing a new matching tag publishes that package version.

The current plan is to move future versions to public npm. Until that migration
is complete, GitHub Packages remains the active package source.
