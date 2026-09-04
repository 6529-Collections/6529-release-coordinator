# Public npm publication and frontend migration

This is the working checklist for moving
`@6529-collections/release-request` from GitHub Packages to public npm.

## Goals

1. Publish the CLI on public npm without storing an npm publishing token.
2. Let the frontend install the CLI from public npm without a package token.
3. Keep the current frontend release flow unchanged.
4. Add second-person approval later, after the first few npm releases.

## Boundaries

This work does not:

- integrate the CLI into the backend;
- change what the frontend release skill does;
- build the future Coordinator worker;
- merge or deploy a product release;
- make the CLI control a release.

The Release Coordinator repository is public. Its Issues and Actions logs are
public. Release requests must never contain secrets.

## Current state — verified 2026-09-04

- [x] The Release Coordinator repository is public.
- [x] CLI version `0.0.3` is published in GitHub Packages.
- [x] Frontend installs exact version `0.0.3` from GitHub Packages.
- [x] Frontend's release skill calls the CLI as an observation step.
- [x] Backend does not install the CLI.
- [x] The npm organization `6529-collections` exists.
- [x] The npm organization requires 2FA for its members.
- [x] The npm organization has two human owners.
- [x] `Check package` runs for pull requests into `main`.
- [x] Pull request #4 proved that the package check passes without publishing.
- [ ] `main` requires a pull request and a successful package check.
- [ ] The CLI exists on public npm.
- [ ] npm Trusted Publishing is configured.
- [ ] Frontend installs the CLI from public npm without a package token.

The current tag workflow still publishes to GitHub Packages. No npm release has
been made yet.

## Phase 1: Protect `main` without human approval

The first few npm releases are a bootstrap period. A second person does not need
to approve every change yet.

- [x] Run `Check package` on every pull request into `main`.
- [x] Install dependencies from the lockfile.
- [x] Run all release-request CLI tests.
- [x] Inspect package contents with `npm pack --dry-run`.
- [x] Confirm that a valid pull request passes without publishing.
- [ ] Create a lightweight branch ruleset for `main`.
- [ ] Require changes to use a pull request.
- [ ] Require `Check package` to pass.
- [ ] Block force pushes.
- [ ] Block deletion of `main`.
- [ ] Require open review conversations to be resolved.
- [ ] Keep required approvals at zero during bootstrap.
- [ ] Confirm that a failing package check blocks merging.
- [ ] Confirm that `simo6529` can merge a passing pull request without asking
  another person for approval.

Do not add `CODEOWNERS` or a required human approval yet. Add them in Phase 7.

## Phase 2: Prepare the public package

- [ ] Choose an approved open-source license.
- [ ] Add the license to the repository and published package.
- [ ] Keep a strict allowlist of published files.
- [ ] Confirm the package contains no credentials or private configuration.
- [ ] Confirm the package has no install-time scripts.
- [ ] Confirm the archive contains only the CLI, source, schema, example,
  package README, and license.
- [ ] Change the publishing registry to `https://registry.npmjs.org`.
- [ ] Set package publication access to `public`.
- [ ] Update package documentation from GitHub Packages to public npm.
- [ ] Inspect the exact package archive before publishing.

Do not reuse version `0.0.3` on npm. Use a new version so one version number
always identifies one exact package archive.

## Phase 3: Create the package on npm once

The package must exist on npm before its trusted publisher can be configured.
Create it with one manual prerelease.

- [ ] Change the package version to `0.0.4-bootstrap.0` in a pull request.
- [ ] Wait for `Check package` to pass.
- [ ] Merge the pull request.
- [ ] Start from a clean `main` checkout.
- [ ] Sign in to npm as an owner with 2FA.
- [ ] Run the package tests.
- [ ] Inspect the package archive.
- [ ] Publish `0.0.4-bootstrap.0` publicly under the non-default `bootstrap`
  tag.
- [ ] Complete the npm 2FA prompt.
- [ ] Confirm the package exists on npm.
- [ ] Confirm the prerelease is not the default `latest` version.

This is the only manual npm publication. It needs the owner's own npm 2FA, but
it does not need approval from a second person.

## Phase 4: Add token-free npm publishing

Create one GitHub environment named `npm-publish`. Use the environment from the
start, but do not add required reviewers during bootstrap. Later, Phase 7 can add
reviewers without changing the workflow identity.

Configure npm Trusted Publishing with:

| Setting | Value |
| --- | --- |
| GitHub organization | `6529-Collections` |
| Repository | `6529-release-coordinator` |
| Workflow | `publish-release-request.yml` |
| Environment | `npm-publish` |
| Allow direct `npm publish` during bootstrap | Yes |

Update the GitHub workflow so the npm publish job:

1. Runs only for a `release-request-v*` tag.
2. Uses Node 24 and npm 11.5.1 or newer.
3. Uses `contents: read` and `id-token: write`.
4. Uses the `npm-publish` environment.
5. Installs from the lockfile without a package cache.
6. Runs the package tests.
7. Confirms the tag matches the package version.
8. Confirms the tagged commit is already in `main`.
9. Inspects the package archive.
10. Publishes the public package with `npm publish`.

Security checks:

- [ ] Pin third-party GitHub Actions to full commit hashes.
- [ ] Use `https://registry.npmjs.org`.
- [ ] Remove the GitHub Packages `packages: write` permission.
- [ ] Do not pass `NODE_AUTH_TOKEN` to npm publication.
- [ ] Confirm npm receives GitHub OIDC proof through `id-token: write`.
- [ ] Confirm npm records package provenance.
- [ ] Set package access to require 2FA and disallow traditional tokens.
- [ ] Revoke unused npm write tokens.
- [ ] Merge the workflow without creating a release tag.

Trusted Publishing uses short-lived GitHub identity instead of a stored npm
token. During bootstrap it publishes immediately after all workflow checks pass;
it does not wait for a second person.

## Phase 5: Publish the first stable npm versions

For each bootstrap release:

1. Change the package version in a pull request.
2. Wait for `Check package` to pass.
3. Merge the pull request.
4. Create the matching `release-request-v<version>` tag from `main`.
5. Wait for the trusted npm workflow.
6. Confirm the expected version became available on npm.
7. Confirm npm shows GitHub provenance.
8. Install it in a clean temporary project.
9. Test `template`, `create`, and `submit` without deploying anything.

The first stable version is planned as `0.0.4`. Later bootstrap releases use new
version numbers. npm versions are never reused.

## Phase 6: Move frontend installation to npm

Use one separate frontend pull request after choosing a proven stable npm
version.

### Wait for the package-age rule

Frontend requires normal public packages to be at least seven days old.

- [ ] Wait until the chosen npm version is seven days old.
- [ ] Confirm no security problem was reported during that period.
- [ ] Do not add an age exception unless a separate review accepts that risk.

### Replace the package source

- [ ] Keep `@6529-collections/release-request` as an exact development
  dependency.
- [ ] Change it to the chosen public npm version.
- [ ] Update `pnpm-lock.yaml`.
- [ ] Confirm the lockfile uses `registry.npmjs.org` and the expected integrity.
- [ ] Remove the `@6529-collections` GitHub Packages rule from `.npmrc`.
- [ ] Remove GitHub Packages authentication used only for this package.
- [ ] Remove the old private-package age exception.
- [ ] Remove the old private-package Dependabot exception.

### Remove only obsolete authentication code

- [ ] Remove the package-token path from the frontend install wrapper.
- [ ] Remove unused Keychain and Credential Manager package-token handling.
- [ ] Remove unused `NODE_AUTH_TOKEN` requirements.
- [ ] Remove GitHub Packages read permission used only for this package.
- [ ] Remove obsolete token handling from worktree and staging setup.
- [ ] Update related tests and documentation.
- [ ] Keep the normal `6529` package-command boundary.
- [ ] Keep Socket Firewall checks for public packages.

### Prove frontend still works

- [ ] A developer can install dependencies without a package token.
- [ ] Clean CI and fork pull requests can install dependencies.
- [ ] Frontend worktree and staging setup can install dependencies.
- [ ] The lockfile pins the exact version and integrity.
- [ ] Frontend tests and build pass.
- [ ] The CLI returns the expected template.
- [ ] `create` saves valid and failed local runs correctly.
- [ ] `submit` reaches the current Coordinator workflow.
- [ ] The controlled submission returns its request ID and public Issue link.
- [ ] The test stops before merge or deployment.
- [ ] The existing frontend release flow remains unchanged.

Keep GitHub Packages version `0.0.3` available until the npm installation is
proven. Stop publishing new GitHub Packages versions after the npm path is
stable.

## Phase 7: Add human approval later

Start this phase only after the first few npm releases are proven and the owner
decides bootstrap is over.

- [ ] Add `simo6529` and a second trusted person or team to `.github/CODEOWNERS`.
- [ ] Protect the CLI package, schema, workflow, and `CODEOWNERS` file.
- [ ] Require at least one approval for pull requests into `main`.
- [ ] Require Code Owner review for protected files.
- [ ] Dismiss approval after new changes are pushed.
- [ ] Add trusted reviewers to the `npm-publish` environment.
- [ ] Prevent the person who started publication from approving it alone.
- [ ] Delete the bootstrap Trusted Publisher connection and recreate it without
  direct `npm publish` permission. Staging remains allowed.
- [ ] Change the workflow from `npm publish` to `npm stage publish`.
- [ ] Use npm 11.15.0 or newer for staged publishing.
- [ ] Require a maintainer to inspect and approve each staged package with 2FA.
- [ ] Protect release tags from unauthorized creation, updates, and deletion.
- [ ] Test that unreviewed code and unapproved packages cannot go live.

Staged publishing is intentionally deferred because it always adds a human
approval before the package becomes public.

## Completion condition

The migration is complete when:

- public npm contains a stable CLI version with GitHub provenance;
- npm publishing uses GitHub OIDC and no stored npm publishing token;
- frontend installs an exact public npm version without a package token;
- frontend's existing install protections and release flow still work;
- GitHub Packages is no longer needed for new CLI versions.

Human approval and staged publishing are a later hardening milestone, not a
requirement for the bootstrap releases.

## References

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [npm staged publishing](https://docs.npmjs.com/staged-publishing/)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
