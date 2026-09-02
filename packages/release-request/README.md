# @6529-collections/release-request

This package creates, validates, and submits one 6529 release request.

It does not call a Coordinator inbox, merge, build, test, or deploy.

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

`create` remains a local command so the current frontend preflight keeps working.
`submit` accepts the same agent-input JSON:

```sh
6529-release-request submit --input release-input.json
```

The CLI creates and validates the full request, saves the local run, starts one
central workflow in the Release Coordinator repository, waits for it, and returns
success or failure with a reason. The agent will not run `gh`, choose a workflow,
or poll GitHub itself. Frontend and backend do not need their own submission
workflow files.

The workflow validates the request again and logs the request, real GitHub actor,
stable actor ID, workflow run, and result. It does not yet create an inbox issue,
merge, build, or deploy anything. In this version, `submitted` means only that
GitHub received and validated the request.

By default, GitHub allows accounts with Write access to the Release Coordinator
repository to start this manual workflow. The request JSON already names every
repository, branch, pull request, and exact commit to release.

The release JSON says what should be released. Its `requested_by` field is not
authentication. The GitHub submission proof says who sent it. Future delivery
must keep those two records separate.

The next inbox version will keep the same `submit` command. The central workflow
will create one private GitHub Issue in the Release Coordinator repository for
each accepted request. The issue will store the exact JSON, its checksum, the
trusted GitHub sender, and the workflow run. The CLI will return the request ID
and issue link. Sending the same request again will reuse the same issue.

A future command can read the issue status without exposing GitHub workflow
details to the agent:

```sh
6529-release-request status REQUEST_ID
```

Package version `0.0.2` contains the `submit` command. The frontend has not
upgraded to this version yet. Inbox issue creation and the `status` command do
not exist yet.

## Publishing

The package is published in the private GitHub Packages registry. A manual run
of the publishing workflow checks a package version without publishing it.
Pushing a new matching tag publishes that package version.
