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

## Publishing

The package is prepared for the private GitHub Packages registry. A manual run
of the publishing workflow checks the package without publishing it. Pushing a
tag such as `release-request-v0.0.1` publishes the matching package version.
