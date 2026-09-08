# Publishing and adopting the release-request package

This guide covers the existing bootstrap publication procedure and adopting a
new exact version. See [progress](./progress.md) for what has shipped and
[migration history](./history/npm-migration.md) for the completed setup/review.

## Current boundary

Only `packages/release-request/` is published. The private
`apps/coordinator/` reader and repository design documents are not included.
The package allowlist includes its own README and license; keep those files
even though the repository also has a README and license.

The package manifest uses public npm. The publication workflow uses GitHub's
short-lived identity rather than a stored npm publishing token. The
`npm-publish` environment restricts publication to `main`; this external rule
must be checked when changing publishing configuration. The branch/version
checks inside the workflow are additional checks.

These controls are in [publish-release-request.yml](../.github/workflows/publish-release-request.yml).
PRs run checks without publishing. The local reader change also makes that
check run both workspace test suites. Package creation/publication is still
scoped explicitly to the release-request workspace.

## Publish a new version

1. Choose a new exact version. Never reuse an already published version.
2. Prepare the package changes and version/lockfile update in a PR. Run the
   tests and inspect the published file list. Documentation changes inside the
   package also change its archive; they cannot replace an existing version.
3. Wait for required checks and merge the PR using the repository's rules.
4. Start the `Release request CLI` workflow manually from `main`, supplying
   that exact version.
5. Confirm the check and publish jobs both succeed. Verify the registry
   version, archive integrity, and GitHub provenance/source commit.
6. Install the exact public version in a clean test project and exercise its
   local commands. Record a live `submit` result only during an authorized
   release or controlled delivery test: it creates a public inbox Issue.

Local checks from this Coordinator repository:

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run --ignore-scripts --workspace=@6529-collections/release-request
```

The publish job checks the requested version, creates and inspects one archive,
checks that archive's checksum again, and publishes it with scripts disabled.
Do not substitute a manual token-based publication for this workflow.

## Adopt a version in a product repository

Publishing and installing can be one coordinated task, but installation must
wait until the exact new version is available from the registry.

Use the product repository's `6529` wrapper and its current package policy.
In one consumer PR:

- Pin the exact CLI version and update the lockfile with its expected public
  registry source and integrity.
- Update any exact-version package-age exception and corresponding policy
  constants/tests together. Keep the exception limited to the reviewed
  package/version; normal package-age rules remain in force.
- Retain Socket Firewall, the package-command boundary, approved build-script
  rules, and source/lockfile validation. Do not restore package credentials or
  the old GitHub Packages registry route.
- Run the relevant secure install and package/CLI checks. Preserve the existing
  release-recording instructions and their ordinary-failure/interrupt handling.

The owner has chosen to keep narrow age exceptions while this project is under
active development and immediate testing. There is no automatic seven-day
cleanup task. Removing or widening an exception is a separate policy change.

Frontend and backend each own their install policy and release instructions.
A combined release submits one shared request from the frontend context;
backend-only work submits from the backend. Do not create a second request on
continuation, promotion, or retry just to test recording again.

## Controlled delivery evidence

Capture the installed package version, request ID, Issue number/link, workflow
run/link, and local run/request paths. Keep exact PR/commit and backend-unit
metadata in the request. Separate delivery proof from merge or deployment proof.

Test requests must be clearly identified as tests and excluded before a future
release worker can consume them. Closing/removing `pending` from a test Issue
is an external write that belongs in the authorized test scope, not in the
read-only reader.

The inbox and workflow logs are public. Never include secrets, cookies,
environment values, production data, signed URLs, or private context.

## Later approval milestone

The owner has not ended bootstrap. Do not activate these changes as part of
documentation cleanup:

- Require a second reviewer and protect the package/schema/workflow through
  reviewed ownership and branch rules.
- Add publication reviewers and prevent self-approval where supported.
- Reassess npm staged publishing, the trusted publisher configuration, and
  release-tag protection.
- Test both permitted publication and rejection of unapproved publication.

Recheck the current [npm trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/)
and [staged-publishing documentation](https://docs.npmjs.com/staged-publishing/)
when this milestone is authorized. Version-specific commands from the archived
bootstrap plan are historical notes, not instructions to apply blindly.
