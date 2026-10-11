# Product release-runtime review — October 11, 2026

## Scope

The user authorized resolving frontend PR #4120's conflicts and reviewing the
Coordinator's workflow pins, with checks and review feedback. Deployment, both
scheduled watches and request #334 remain stopped. This change does not process
the inbox, refresh a saved release, dispatch product workflows, alter requests or
journal records, publish a package, restart a runtime, or change rules or budgets.
The separate frontend conflict-resolution commit is not a Coordinator release.

## Reviewed versions and behavior

The complete read-only audit captured these branch commits:

| Repository | `1a-staging` | `main` |
| --- | --- | --- |
| Backend | `2ff2fb6be468bc23fe7c64dafbb1db34aff055bf` | `c7328747def840cd13368509dddb5f3a283c8160` |
| Frontend | `51993791b69e60026d1972f3187761638e0c50fa` | `f76d73bead771a9569f7d6c33c7284d7b5b05c0d` |

Only two of the 24 configured file/environment approvals need updating. Both
changes are on frontend staging, introduced by commit
`405492c37606cf372ab6f82f4ad25a3217cda199` through
[frontend PR #4222](https://github.com/6529-Collections/6529seize-frontend/pull/4222).
Full immutable workflow comparisons show only the `museum-network-ia` alias
added to the allowed selection list and the loop excluding unselected Museum
packs. Staging's manual pack choices also include the alias. The staging pack
manifest registers it for both environments. No existing test is removed or
made optional; unselected Museum packs keep the existing affected-page behavior.

| Frontend file | Staging approval | Production approval retained |
| --- | --- | --- |
| `.github/workflows/staging-e2e.yml` | `5c7131791245b522db0230eee51b9c5449aadd63` | `6afa8ced671b00394b87e6c47dac498b137c17af` |
| `.github/workflows/production-e2e.yml` | `6c5f4e85d3d5cf19a6331cea40d22a76a234721a` | `31f8ad4fb58cc3cab99419d96547fe52da6f7a10` |

Sources: [staging E2E](https://github.com/6529-Collections/6529seize-frontend/blob/51993791b69e60026d1972f3187761638e0c50fa/.github/workflows/staging-e2e.yml),
[production E2E file on staging](https://github.com/6529-Collections/6529seize-frontend/blob/51993791b69e60026d1972f3187761638e0c50fa/.github/workflows/production-e2e.yml),
[staging pack manifest](https://github.com/6529-Collections/6529seize-frontend/blob/51993791b69e60026d1972f3187761638e0c50fa/tests/packs.manifest.cjs).

Production main still has the previous workflow files. Independent environment
pins approve the new blobs only on staging, not ahead of their arrival on main.
Automatic dispatch wrappers and E2E runners execute from main even for a staging
deployment; their runner-file verification must continue using production/main
pins. The executor already enforces that distinction and is unchanged.

Triggers, permissions, pinned actions, concurrency, browser installation and
fatal verification, browser commands, existing retries, exact deployment
run/attempt and source/live-version checks, selection digest and evidence
handling are unchanged. Every other workflow pin, candidate policy, required
check and count budget is unchanged. Matching saved staging deployment and
browser E2E still gate production; matching saved production deployment and
browser E2E still gate completion.

## Verification and stopped state

Independent reviewed literals in the identity fixture cover both branches.
Regressions reject superseded, unknown and wrong-environment blobs without
writes. Per-operation tests reject cross-environment pins before dispatch.
Automatic staging E2E tests model main-runner files independently from the
deployed staging source and reject staging-only blobs on that main runner.
The read-only cleanup-follow-up fixture also selects files by the runner's
exact commit and refuses staging-only approval for a main-runner check, without
altering its saved batch. All 170 focused runtime, adapter, shared-release and
recovery tests and all 34 cleanup-follow-up tests pass offline. Full non-fixing
Node 22.16.0 gates passed with all 54 test files run serially: **1214 passed**,
three optional Docker skips (1217 total), plus lint, formatting, docs/workflow
policy and isolated offline packed-CLI checks. Source contents stayed unchanged
during verification. The separate exact-lock dependency audit found zero
vulnerabilities. The final evidence-only documentation update was checked
separately. Hosted checks/reviews and merge remain pending at authoring.

At 09:56:12 UTC the actual complete product identity passed 65 guarded GET-only
requests through both admission layers. A separate exact-commit audit matched
all 24 configured file/environment approvals. All four shared refs and the
authoritative journal were reread unchanged. Fixed workflow IDs remain
unchanged. This recognizes the reviewed workflow contract; it does not provide
fresh candidate CI or either environment's deployment/browser evidence.

The authoritative real journal remains revision 840 at
`3758870ec3e28e96a8ff1083f2f4768fc950366a`, with blob
`fe7c59befacb1bed06e85f8746f3948001e10694`. Its original request, held run,
untouched step-zero checkpoint, attempts, history and spent budgets are not
edited. Updating PR #4120's development branch changes its head; the immutable
request #334 remains bound to its original source commit. No automatic adoption
of the new head is authorized or implemented by this pin change.

This record distinguishes configuration recognition and offline checks from
hosted review, protected merge, candidate CI and live deployment acceptance.
