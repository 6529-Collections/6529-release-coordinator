# Product release-runtime review — October 9, 2026

## Scope and stopped preflight

The user approved reviewing changed product workflows and updating only the
Coordinator's approved versions, retaining every safety check. This work does
not restart ticket #334, edit either product repository, dispatch tests or
deployments, invoke migrations, publish npm, or modify requests, journal state,
locks, attempt history, count budgets, rules or automations.

The preflight on merged Coordinator main
`fdaea0cbe71c9ab3a3c3e03ba3392da4a9f0719a` stopped at the read-only complete
product identity check with `A pinned product release runtime file changed.`
No inbox runner started and no retry intent was saved. The separate explicit
fresh-check path from PR #349 is already merged; this is not another test failure
and does not alter that implementation.

## Exact reviewed versions

At 06:15:13 UTC, all 24 configured release files were independently read at
immutable branch commits, with all four shared refs reread unchanged afterward:

| Repository | `1a-staging` | `main` |
| --- | --- | --- |
| Backend | `f073fb1cbe3e39a1d6986d5d85129a46446981b1` | `4b72547b5503ec38936d9d70177e01d11730f526` |
| Frontend | `97cbbe4b6b1a0ae106bcd24f7eab8d8b991da78b` | `a79911270ec8f88b750ccd416f87a9ee3079d514` |

Only these four configured blob values change (the two frontend blobs occur on
both branches):

| File / environment | Previously approved blob | Reviewed blob |
| --- | --- | --- |
| Backend `deploy.yml`, staging | `55f2db38999869b7b231c476f849ae330abef1da` | `39250777ed9eca0ade44ccfc5eb3776d7a047929` |
| Backend `deploy.yml`, production | `eff687cc84a14df7f15134af1068039c5b875bda` | `938ccac897092972c64de444001c48133291abed` |
| Frontend `staging-e2e.yml`, both branches | `63ace61b4d7b8f38605838435649ba47cec0ad25` | `6afa8ced671b00394b87e6c47dac498b137c17af` |
| Frontend `production-e2e.yml`, both branches | `56b8c0e73121bcb1ac937775fbe3e80dd2f3bce5` | `31f8ad4fb58cc3cab99419d96547fe52da6f7a10` |

The frontend workflow files come from
[product PR #4201](https://github.com/6529-Collections/6529seize-frontend/pull/4201),
merged October 9 at 05:46:54 UTC. The backend service addition comes from
[product PR #2132](https://github.com/6529-Collections/6529seize-backend/pull/2132),
merged October 9 at 04:30:31 UTC, and its staging counterpart. Commit author dates
are not merge dates. Sources at the exact audited refs:
[backend staging workflow](https://github.com/6529-Collections/6529seize-backend/blob/f073fb1cbe3e39a1d6986d5d85129a46446981b1/.github/workflows/deploy.yml),
[backend main workflow](https://github.com/6529-Collections/6529seize-backend/blob/4b72547b5503ec38936d9d70177e01d11730f526/.github/workflows/deploy.yml),
[frontend staging E2E](https://github.com/6529-Collections/6529seize-frontend/blob/a79911270ec8f88b750ccd416f87a9ee3079d514/.github/workflows/staging-e2e.yml),
[frontend production E2E](https://github.com/6529-Collections/6529seize-frontend/blob/a79911270ec8f88b750ccd416f87a9ee3079d514/.github/workflows/production-e2e.yml).

## Behavioral review

Complete old/new immutable blob comparisons show the same narrow frontend
change in both E2E workflows. Playwright system-dependency installation changes
from three to ten minutes, its existing fallback from three to fifteen minutes.
The fallback waits up to 300 seconds for package-manager locks before running
the installer; it does not delete locks or kill package-manager processes.
`set -euo pipefail` retains timeout/installer failure. The existing unconditional
verification step still fails if neither installation succeeded. Browser tests
remain required, not `continue-on-error`; dependency fallback is not browser-test
success. These are product-owned setup timings, not new Coordinator limits.

Permissions, pinned actions, triggers, concurrency, exact successful deployment
run/attempt and canonical job checks, live-version checks, source checkout,
post-deploy/canary selection, browser commands and result/evidence handling are
unchanged. The separately changed PR-readiness work in that product PR is not
part of these release-workflow diffs and does not replace fresh candidate CI.

Backend differences on each branch add only `competitionMigrationLoop` to the
service choice, three existing service validation expressions, and the immutable
Lambda verification-target map. The default remains `api`. There is no new
automatic invocation or trigger; the existing invocation step remains restricted
to explicitly selected `dbMigrationsLoop`. The pre-existing staging-only
`websocketOutboundHandler` difference remains independently pinned, not approved
on production. Exact-source, branch, credentials, code-digest, API health,
release-note and environment-serialization checks are unchanged. Recognizing
this workflow does not authorize selecting, deploying or invoking the migration
service, nor add backend work to frontend-only ticket #334.

Only Coordinator configuration literals change at runtime. Other release pins,
candidate PR-CI pins and the narrow additive-browser contract are untouched.
No broad drift exception, new executor, retry, limit or gate waiver is added.
Matching saved staging deployment **and** browser E2E remain mandatory before
production, and matching saved production deployment **and** E2E remain mandatory
before completion.

## Verification and preserved state

The actual shared/product identity fixture uses independent reviewed literals,
not active configuration values, for both repositories. It verifies exact
environment commits and both admission layers with GET-only requests. Historical
frontend refusal cases remain. New cases reject the newly superseded and unknown
blobs on each branch and reject the backend's approved other-environment blob.
Per-operation regressions also refuse drift before workflow dispatch.

All 163 focused runtime/adapter/shared-release tests passed offline. Full
non-fixing repository gates passed on Node 22.16.0 with all 52 test files run
serially: **1155 passed**, three optional Docker skips (1158 total), plus lint,
formatting, documentation/workflow policy and isolated offline packed-CLI checks.
The source snapshot remained unchanged during the gates. The separate exact
locked dependency audit found zero vulnerabilities. Hosted checks, configured
reviews and merge are pending at authoring.

The 24-file current-ref audit matches the new configuration. At 06:16:08 UTC the
actual complete product identity passed 65 guarded GET-only requests through
both admission layers, returning the audited four branch commits and unchanged
fixed workflow IDs. The authoritative journal ref was reread unchanged after
this inspection. This is read-only contract recognition, not candidate CI or
deployment proof.

Authoritative real journal revision 811 remains at
`43d194e1ad3b28311a561a25129cd5b54b9932f1`; the held run, exact ticket #334
request/head, original failed attempt/archive and completed cleanup are preserved.
The watcher remains paused. Ticket retry, staging and production have not started
in this work. Any later execution requires separate authorization and fresh
source, rules, current-main candidate and environment evidence.
