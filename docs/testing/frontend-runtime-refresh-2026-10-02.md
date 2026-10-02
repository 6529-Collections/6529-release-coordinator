# Frontend release-runtime review — October 2, 2026

## Scope and authorization

The user authorized bringing the Coordinator up to date with the three changed
frontend release files and explicitly instructed **not to resume #285**.
This change updates Coordinator source and tests only. It does not change
product repositories, requests, actors, source heads, GitHub rules, workflow
inputs, required checks, journal records, package versions or policy budgets.
The #285 follow-up remains paused.

## Independently read product versions

On October 2, the frontend refs were:

- `main`: `76b5bc8c7813fdb9aeaffbb73662ca47a0982c16`.
- `1a-staging`: `d010d12afa5801ac4bbeb31c9989bca8b8b38f91`.

All three current files have identical bytes on those two branches. Complete
old/new immutable Git-blob comparisons established the following changes:

| File | Previously approved blob | Reviewed current blob |
| --- | --- | --- |
| `.github/workflows/deploy-staging.yml` on `main` | `36d10cd5f855d1510c5f2c6ffced7baf86db3987` | `c573f80b55aa46b2bb96259dee07b98c231d30b7` |
| `.github/workflows/production-build-artifact.yml`, both branches | `22bafb14740b35388d7f6e07f67af01c42486c11` | `5df8df3da1a50336a7b9f4816b79fbe639d0a3e1` |
| `.github/workflows/production-e2e.yml`, both branches | `93c6e39132308f9733eab70ba1191e8a4bd9cd15` | `29346bd8d8c9816f40388801943b006e21f3f6ef` |

The staging-branch `deploy-staging.yml` pin was already `c573f80...`; its
approval is unchanged. The configuration retains independent staging/prod
entries, now both approved at that exact blob, so a future change on one branch
cannot silently approve the other.

Sources at the immutable product `main` commit:
[staging deploy](https://github.com/6529-Collections/6529seize-frontend/blob/76b5bc8c7813fdb9aeaffbb73662ca47a0982c16/.github/workflows/deploy-staging.yml),
[production build](https://github.com/6529-Collections/6529seize-frontend/blob/76b5bc8c7813fdb9aeaffbb73662ca47a0982c16/.github/workflows/production-build-artifact.yml),
[production E2E](https://github.com/6529-Collections/6529seize-frontend/blob/76b5bc8c7813fdb9aeaffbb73662ca47a0982c16/.github/workflows/production-e2e.yml).

## Reviewed behavior

The staging deployment diff adds only
`NEXT_PUBLIC_FEATURE_MULTI_COMPETITION: "true"` to the build environment.
This same staging blob was reviewed in Coordinator PR #277; it has now reached
product `main`. The production build diff adds only that same public feature
setting. No action, credential, permission, build command, artifact identity or
workflow input changes with either diff. Configuration and fresh environment
builds remain product-owned; the Coordinator does not set this flag itself.

Production E2E adds a `github_api_get` shell helper and routes three deployment
discovery/provenance reads through it. It makes GET requests only, retries at
most three times for the listed HTTP 5xx/transport failures, and returns the
underlying nonzero exit status for terminal errors. The product's retry count
is not a new Coordinator retry limit. Successful responses still pass the same
exact workflow, repository, event, main-branch, success, attempt and source
checks, then the canonical successful deployment-job and actual live-version
checks. Test packs, checkout identities, dispatch inputs, result jobs,
permissions and required provenance remain unchanged. An invalid successful
response is not retried into acceptance. Shell helper bytes are reviewed, not
executed by this Coordinator update.

The Coordinator therefore needs a narrow file-version refresh, not a different
executor or relaxed release gates. Both environment-specific integration-check
sets and workflow serialization stay unchanged. Matching successful staging E2E
is still mandatory before production; matching production E2E is still needed
before release completion. Manual product guidance about asynchronous E2E does
not alter that agreed Coordinator behavior. Backend PR-CI drift remains
unapproved, and no backend pin is changed here.

## Stopped run and preserved evidence

Coordinator PR #291 merged at `f256b73fac62cefd71e99dee714919eacdb50813`.
The subsequent authorized resume of run
`b16e62c4-fcf9-414a-b7eb-1d6add579d9e` created
[temporary frontend PR #4148](https://github.com/6529-Collections/6529seize-frontend/pull/4148)
at `8c2bbae6df7325754d2b0080f8fdd6d32fa2e047`. Required checks passed;
the PR closed unmerged at 14:39:48 UTC on October 1 and its exact owned branch
was independently confirmed absent. Its result and cleanup remain saved on
original attempt `dea415ce-281b-4095-8601-f2754ff7dfa4`.

The process exited 2 at 14:41:39 UTC when release admission found changed
runtime files. Journal revision 584 at
`21046a9273f56f561cebd4f049ca2196684fe9cc` retains filtered issue [285],
verified `simo6529` ID `209783236`, the existing run lock, selected [285],
passed attempts and no release execution. Source PR #4120 remained open at its
pinned `bc220ad0f6c05f98259940cd295e0089709b330b` head. No staging or
production integration, deployment or E2E was started by this attempt.
Code checks and a cleaned trial are not deployment proof. This source update
does not clear the lock, retire attempts, change budgets, replay checks or
resume execution. Any later continuation needs fresh current-state inspection.

## Verification boundary

The new offline identity fixture uses independent literal reviewed blob values
and invokes the actual shared/product adapter identity code. Before the source
refresh, it reproduced `A pinned product release runtime file changed.`
Afterward it accepts both branch snapshots, records only GETs, and checks that
both identity layers read all three files at the exact environment commit.
Twelve separate cases reject each superseded/unknown file on either branch
before writes. Per-operation staging/production regressions also reject all
three superseded/unknown files before dispatch, including the previously
different branch pins that now legitimately have equal bytes.

The 82 focused shared/product runtime, adapter, recovery and generated-bundle
tests pass, including distinct-environment pin independence when the production
configuration happens to have equal branch pins. Full non-fixing `npm run check`
passed on Node 22.16.0: **753 tests passed**, with three optional Docker tests
skipped (756 total), plus lint, formatting, documentation/workflow policy and
the packed-CLI smoke test. The separate exact
locked dependency audit reported zero vulnerabilities.

A read-only `createProductWorkflowReleaseGitHub({profile: realProfile}).identity()`
using the actual default GitHub reader passed both identity layers and verified
all configured release files and workflow IDs at the current immutable branch
commits. It observed backend staging `b9c0f960ad28740932bb78c288dd82a9ffa1c18d`,
backend main `e0386950e7cd8799c6a51579cf050e2347de1e65`, and the frontend refs
above. This is only runtime-contract readback, not a candidate source/review gate,
deployment, restored-environment proof or authorization to continue #285.
The authoritative journal ref stayed
`21046a9273f56f561cebd4f049ca2196684fe9cc`, and the follow-up stayed `PAUSED`.

No real workflow was dispatched and no sandbox GitHub resources were changed. Local tests,
read-only runtime observations, remote CI/reviews, merge, npm publication and
live release acceptance are separate outcomes.
