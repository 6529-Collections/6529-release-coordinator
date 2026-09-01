# @6529-collections/release-request

This package creates and validates one local 6529 release request.

It does not call an API, merge, build, test, or deploy.

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

## Future delivery

`create` remains a local command. The planned next command sends an already
valid outbox request through one central workflow in the Release Coordinator
repository. Frontend and backend do not need their own submission workflow
files. The workflow adds the real GitHub actor, stable actor ID, and workflow
run before it sends the request to the future Coordinator inbox.

By default, GitHub allows accounts with Write access to the Release Coordinator
repository to start this manual workflow. The request JSON already names every
repository, branch, pull request, and exact commit to release.

The release JSON says what should be released. Its `requested_by` field is not
authentication. The GitHub submission proof says who sent it. Future delivery
must keep those two records separate.

The workflow and inbox do not exist yet. This package still sends nothing.

## Publishing

The package is published in the private GitHub Packages registry. A manual run
of the publishing workflow checks a package version without publishing it.
Pushing a new matching tag publishes that package version.
