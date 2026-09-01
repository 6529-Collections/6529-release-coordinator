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
stable actor ID, workflow run, and result. It does not call an inbox,
merge, build, or deploy anything. In this version, `submitted` means only that
GitHub received and validated the request.

By default, GitHub allows accounts with Write access to the Release Coordinator
repository to start this manual workflow. The request JSON already names every
repository, branch, pull request, and exact commit to release.

The release JSON says what should be released. Its `requested_by` field is not
authentication. The GitHub submission proof says who sent it. Future delivery
must keep those two records separate.

Later, the same `submit` command will let the workflow send the request to the
Coordinator inbox. A future command can read its saved status without exposing
Coordinator or workflow details to the agent:

```sh
6529-release-request status REQUEST_ID
```

The `submit` command and central logging workflow are implemented and tested in
this repository. They are not published in a new package version or used by the
frontend yet. The inbox and `status` command do not exist.

## Publishing

The package is published in the private GitHub Packages registry. A manual run
of the publishing workflow checks a package version without publishing it.
Pushing a new matching tag publishes that package version.
