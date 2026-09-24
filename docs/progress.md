# Progress and next steps

Last reviewed: **2026-09-24**, against merged Coordinator `main` source
`5dd9c81` ([PR #227](https://github.com/6529-Collections/6529-release-coordinator/pull/227))
plus this real-frontend ruleset configuration.
Frontend, backend, package and sandbox observations below retain their recorded
dates unless a newer check is stated. This page separates local implementation,
PR/CI delivery and live environment proof.

## Current state

| Area                                | What is available                                                                                                                                                                                                                                   | Evidence boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request submission                  | Public npm CLI `0.0.5` with schema `0.000002`; old `0.000001` requests remain readable                                                                                                                                                              | Published from protected Coordinator `main` with provenance, then pinned and merged in frontend and backend; see [September 15 evidence](#cli-005-publication-and-consumer-adoption-september-15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Operational monitoring intake       | Monitoring requests can enter the shared sandbox/real release sequence without pretending monitoring is an application service.                                                                                                                     | PR #218 merged the real workflow pin but its dispatch contract was incompatible with the product backend. Merged Coordinator [PR #219](https://github.com/6529-Collections/6529-release-coordinator/pull/219) fixed it; offline and GitHub checks passed. The corrected sandbox success path and both failure/recovery paths passed [September 23 acceptance](./testing/monitoring-branch-contract-2026-09-23.md). No real monitoring deployment has run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Ticket workflow                     | One manual `inbox:run` command reads requests, checks exact PRs and updates the same tickets                                                                                                                                                        | Unified workflow and subsequent sandbox work are merged; [command guide](../apps/coordinator/README.md#run-the-ticket-workflow).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Guarded inbox selection             | `RELEASE_COORDINATOR_SCOPE=filtered` exposes only repeated `--issue` values whose verified submitter matches `--actor`; `inbox` exposes the full selected-profile inbox. The resulting visible set then uses the normal Coordinator policy.         | Implemented in [PR #218](https://github.com/6529-Collections/6529-release-coordinator/pull/218) with multi-ticket, actor-mismatch, database-isolation, CLI validation and resume coverage. The v7 journal saves the canonical filter so resume cannot widen it. The [September 22 sandbox acceptance](./testing/profile-scope-sandbox-2026-09-22.md) proved one-ticket selection, a three-ticket visible set whose database-changing member was deferred from the two-ticket batch, the database ticket alone, and explicit same-run resume. PR #218 is merged and has not selected or changed a real-product ticket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sandbox service/database checks     | One-ticket checks run sample services and temporary MySQL in GitHub Actions                                                                                                                                                                         | Local and live acceptance passed; see [source delivery](#sandbox-source-delivery-september-10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Sandbox batching                    | Runs filter cheap blockers before combined PR/service checks, keep tickets whole and record exclusions                                                                                                                                              | Complete-inbox and guarded Issue/actor scope feed the same normal batch policy. Compatible, repeated and incompatible groups have [September 10 evidence](./testing/batch-2026-09-10.md). A fresh [September 15 v3 run](./testing/batch-v3-2026-09-15.md) proved A+B failing while A and B pass alone, selected A, completed fake staging and matching E2E, and waited through long GitHub queues without an elapsed-time cutoff. The exact earlier v2 policy found in the live journal is now readable. At the time of that run, this fix existed only on the working branch; it is now merged through PR #149.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Run logs                            | Live step updates and private local logs, including explicit resume                                                                                                                                                                                 | Local tests and [live logging acceptance](./testing/run-logging-2026-09-11.md) passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| v6 history                          | Finished batch/service/release records archive in the same journal branch; active work and original attempts remain available                                                                                                                       | v5 storage merged in [PR #66](https://github.com/6529-Collections/6529-release-coordinator/pull/66). PR #72 merged the v6 writer with exact sandbox release operations; [live staging-to-production acceptance passed](./testing/release-sequence-2026-09-11.md). The real inbox was not migrated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PR reviews/security                 | Fixed bot reviews, CodeRabbit drafts, CodeQL and a complete lockfile audit configured                                                                                                                                                               | PR #178's final head passed Node 20/22/24, package, CodeQL and Snyk checks. The exact-head 6529bot general, security, deployment/Actions and follow-up lanes completed without required changes; the advisory GLM lane ran on every head, and no review thread was opened. Required merge rules remain active. Snyk's six-library workspace limitation remains below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sandbox release sequence            | One selected no-database-change batch moves through PR-based test staging with a Coordinator-gated check, locked builds and artifacts, matching built-output E2E, then protected test `main` for production requests                                | [PR #149](https://github.com/6529-Collections/6529-release-coordinator/pull/149) is merged into `main` at `2b6cc35`. The successful 14-operation path passed live before source review; see [September 15 acceptance](./testing/github-build-e2e-2026-09-15.md). Review fixes were republished through protected PRs and checked on both sandbox branches. [September 16 failure acceptance](./testing/staging-e2e-failure-2026-09-16.md) then proved a real staging E2E failure stops before production, records the failure, and cleans owned branches. No real repository is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sandbox staging restoration         | Confirmed no-database-change staging failure creates checked undo PRs for exact changed test branches, then reruns ordered build checks and matching E2E                                                                                            | Merged through [PR #168](https://github.com/6529-Collections/6529-release-coordinator/pull/168). The [September 16 live test](./testing/staging-restoration-2026-09-16.md) passed protected restoration, ordered checks and restored E2E. A final source-ref/tree readback guard passed offline tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Solo sandbox database release       | One verified database-changing ticket can enter the fake release sequence alone after its temporary MySQL check; changed sample data is checked through the built-output E2E, and a failed release stops for a person without restoration           | Merged through [PR #168](https://github.com/6529-Collections/6529-release-coordinator/pull/168). The corrected runtime was published to both protected test-repository branches. [September 16 live acceptance](./testing/solo-database-release-2026-09-16.md) passed the full 14-operation protected path and closed ticket #26; a prior failed check left ticket #24 open and required manual staging repair. Multi-ticket database batches remain unsupported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sandbox fake-production restoration | After a confirmed no-database-change production failure, restore affected test `main` and staging branches with Coordinator-checked staging undo PRs and protected main undo PRs, then rerun their normal builds and E2E; keep the original failure | Merged through [PR #172](https://github.com/6529-Collections/6529-release-coordinator/pull/172); see [delivery](#pr-172-delivery-september-17). The [September 16 controlled live test](./testing/fake-production-restoration-2026-09-16.md) passed production and staging restoration, matching builds/E2E, final ref/tree readback, and ticket projection from the then-uncommitted implementation. Offline recovery, resume, moved-ref and adapter tests pass. Review hardening also checks both environment refs before each workflow dispatch and before accepting its result; that guard has offline proof only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Sandbox monitoring deployment       | A production ticket selecting `operational_deployments: ["monitoring"]` runs staging monitoring from test `1a-staging` before staging applications, then production monitoring from test `main` before production applications.                     | The earlier both-from-main behavior passed [September 17 acceptance](./testing/sandbox-monitoring-2026-09-17.md). Test runtime updates merged through backend PRs #139/#140 and frontend PRs #127/#128. The corrected 16-operation success path and both controlled monitoring-failure restorations passed [September 23 acceptance](./testing/monitoring-branch-contract-2026-09-23.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Waiting for other workflow runs     | Before each shared-branch merge and each workflow dispatch, the sandbox adapter waits without a time limit until the pinned release workflow has no active run in the target repository, logs each check and saves the blocking runs                | Merged through [PR #181](https://github.com/6529-Collections/6529-release-coordinator/pull/181) with offline coverage for the dispatch and merge paths, every active status, interruption, resume and state validation; see the [acceptance case](./merge-rehearsal-testing.md#release-sequence-acceptance). The pinned sandbox workflow holds one lock per environment, republished through [PR #182](https://github.com/6529-Collections/6529-release-coordinator/pull/182) to both test repositories' `main` and `1a-staging` (backend [PR #94](https://github.com/6529-Collections/release-coordinator-test-backend/pull/94), frontend [PR #86](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/86)). The [September 18 live acceptance](./testing/sandbox-inflight-wait-2026-09-18.md) found that GitHub's status-filtered run listing lags and can report a false quiet. The correction, reading the newest unfiltered page as well, is delivered together with that record rather than by PR #181; run from that corrected source, the resumed run waited 27 minutes before its first dispatch, stopped cleanly on Ctrl-C during a wait, resumed and dispatched once, waited before a frontend merge, and completed all fourteen operations for ticket #34. |
| Frontend production source guard    | The real `Web Deploy - PROD` workflow accepts an optional `expected_source_sha` and refuses before building when it does not match the `main` commit fixed for the run                                                                              | Frontend [PR #4072](https://github.com/6529-Collections/6529seize-frontend/pull/4072) merged at `7471ac1`; the exact [workflow source](https://github.com/6529-Collections/6529seize-frontend/blob/7471ac113cb2535940b19f036bf38f47f4d44eb6/.github/workflows/build-upload-deploy-prod.yml) was read back from frontend `main`. Manual dispatches may still omit the input under existing human authorization. The PR #218 adapter always supplies the exact approved frontend commit, verifies the pinned workflow source and matching run, and never uses the empty compatibility path. That enforcement has offline coverage only; it has not dispatched the real workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Product-shaped test workflow mirror | Merged test workflows build sample code and publish fake deployment evidence while mirroring the existing product workflow interfaces, including branch-aligned monitoring and linked deploy-to-E2E runs.                                           | Original mirror: frontend PR #92 and backend PR #100, with [September 21 acceptance](./testing/product-shaped-workflow-mirror-2026-09-21.md). Branch-contract correction: backend PRs #139/#140 and frontend PRs #127/#128, with [September 23 success and recovery acceptance](./testing/monitoring-branch-contract-2026-09-23.md). These are test repositories only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Product-workflow sandbox adapter    | Sandbox release operations use the separate product-shaped backend, monitoring, frontend and E2E workflow mirrors by default; the generic `sandbox-release.yml` client remains an explicit fallback                                                 | The [adapter-selection implementation](../apps/coordinator/src/sandbox-release-client.mjs), including the explicit `RELEASE_COORDINATOR_SANDBOX_RELEASE_ADAPTER=generic` fallback, ships in the same change as this status row. Offline contract and recovery suites cover branch sources, exact runs/artifacts, operation persistence, failures and recovery. The independent [success-path acceptance](./testing/adapter-success-path-2026-09-21.md) completed staging and production, and the independent [controlled-recovery acceptance](./testing/adapter-recovery-2026-09-21.md) stopped on monitoring failure, restored production then staging, reran matching deploys/E2E, and resumed the same journal without duplicate dispatch. The [September 22 profile/scope acceptance](./testing/profile-scope-sandbox-2026-09-22.md) additionally passed fresh one-ticket, two-ticket, solo-database and staging-E2E-failure recovery cases; it exposed and fixed causal-time and running-wrapper reconciliation gaps before same-run recovery completed. All used only test repositories. Delivered to protected Coordinator `main` in PR #218.                                                                                                                                          |
| Real-profile release adapter        | PR #218 selects product repositories under `RELEASE_COORDINATOR_PROFILE=real` and uses the shared release engine with existing product workflows.                                                                                                   | PR #219 merged the monitoring dispatch correction after offline tests and sandbox success/recovery acceptance, but there is no product execution proof. No product PR, merge, deploy, rollback, or live E2E was performed. Database-changing failures never enter automatic recovery; manual release remains the proven path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

The [September 24 approval-bypass acceptance](./testing/approval-bypass-2026-09-24.md)
added PR-only review-bypass rules to both test `main` branches without removing
their required `Sandbox check`. The shared Coordinator code accepts a missing
approval only when the pinned ruleset says the acting account can bypass,
the exact PR/base and all required checks pass, and review threads and other
known gates are clear. A filtered sandbox production ticket (#50) completed
both unapproved protected-main integration merges, all fake deployments and
matching E2E; the journal recorded each bypass and released its lock. One
mid-run journal-lock interruption occurred after staging integration and before
the protected-main bypass merges; an inspected manual resume continued the
same run without re-merging completed staging PRs. This run did not exercise
rollback. PR #227 merged the shared code. This follow-up pins only the real
frontend's existing `main` bypass ruleset and required checks; the real
backend remains unpinned. The configuration does not execute a release, and no
real-product bypass, merge, deployment, E2E, or rollback has been tested. See
the [read-only product-rule audit](./testing/real-frontend-approval-bypass-config-2026-09-24.md).

The [September 23 staging check alignment](./testing/staging-check-alignment-2026-09-23.md)
removed protection from only the two test `1a-staging` branches, matching the
real product staging setting. Local Coordinator code now gates the exact
staging PR on its configured reported checks without requiring GitHub to mark
them mandatory; product `main` and test `main` still require GitHub-enforced
checks. GitHub readback confirms optional `Sandbox check` on both test staging
PRs and retained required checks on both test `main` branches. All offline
checks pass. A fresh filtered end-to-end sandbox staging release completed
[Issue #45](./testing/staging-check-alignment-2026-09-23.md#fresh-live-sandbox-staging-acceptance):
both integration PRs passed `Sandbox check` while GitHub reported it optional,
backend and frontend staging deployments passed, matching staging E2E passed,
and the journal lock was released. Real-product release and failure/recovery
under the new staging settings remain unproved. The table's earlier protected
staging acceptance links describe the prior rules, not this new setting.

The manual command runs once and exits. Profile selection chooses repositories,
staging and main check gates, workflow pins and evidence rules; it does not copy a second
Coordinator engine. Sandbox completion remains evidence only for the pinned test
repositories. The real profile must collect fresh product evidence.

A ticket is one request and stays whole, even when it contains both frontend and
backend PRs. A filtered run exposes one or more Issues from one verified actor;
complete-inbox scope exposes all available tickets. Either scope can combine
several independent visible tickets into one tested batch after removing tickets
with cheap, clear blockers. Merged PR #218 implements that policy for
both profiles. Only the sandbox version has live acceptance; the real version has
not changed a product repository.

After the PR #218 review fixes, `npm run check` passed locally on September 23:
604 tests ran, 601 passed and the three explicitly Docker-only cases were
skipped. Lint, formatting, documentation, workflow policy and package checks
also passed. GitHub CI and live product acceptance are separate evidence.

## Next steps

PR #227 delivered the shared approval-bypass gate. This follow-up configures
only the real frontend after read-only verification of its existing ruleset
and five required checks. Existing staging Issue #224 pins frontend PR #4093
at commit `d635b5f`, but GitHub reported that PR `BEHIND` on September 24;
the bypass must not override it. If its branch is updated, that commit changes,
so Issue #224 cannot be reused: submit a new verified ticket pinned to the new
head, then filter a real run to only that Issue and actor `simo6529`. Stop on
uncertain evidence and inspect the saved journal. A production ticket is
separate and follows staging acceptance. The sandbox
journal-lock interruption recovered by resume; investigate if it recurs, and
do not describe that run as uninterrupted proof.

Merged Coordinator [PR #219](https://github.com/6529-Collections/6529-release-coordinator/pull/219)
dispatches staging monitoring from `1a-staging` and production monitoring from `main`,
sends only the existing `environment` input, checks the intended branch commit
before dispatch, and verifies the resulting run's branch/commit afterward.
Local `npm run check` passed on its latest code head: 608 tests passed, three
optional Docker tests skipped, plus lint, formatting, documentation, workflow
policy and package checks. GitHub Node 20/22/24, package, CodeQL and Snyk
checks passed; 6529bot found no blocking issue. PR #219 merged into protected
`main` at `9996fdd`.
The Docker-backed `Sandbox check` passed on test-backend
[PR #139](https://github.com/6529-Collections/release-coordinator-test-backend/pull/139)
and test-frontend
[PR #127](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/127).
Both merged into test `main`; backend [#140](https://github.com/6529-Collections/release-coordinator-test-backend/pull/140)
and frontend [#128](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/128)
published that history to test `1a-staging`. The
[fresh sandbox acceptance](./testing/monitoring-branch-contract-2026-09-23.md)
completed all sixteen success operations on Issue #46, including staging and
production monitoring from the correct branches at exact merged commits and
matching E2E. Issue #47 intentionally failed staging monitoring and restored
the saved staging tree. Issue #48 intentionally failed production monitoring
and restored the saved production and staging trees, but exposed an early
automatic frontend E2E that could not prove the final restored combination.
PR #219 now dispatches a fresh frontend staging deploy after backend recovery
and checks that E2E's causal time. Fresh Issue #49 repeated the controlled
production failure, passed restored production checks, then proved the new
frontend deploy and linked E2E occurred after restored backend API completed.
All affected test branch trees match their saved pre-test trees, failed tickets
retain `action-needed`, and the journal lock was released. GitHub job records
lagged completed workflow runs by minutes during this retest; the adapter now
waits for the exact job set without redispatching.
The real backend workflow is unchanged; no real-product release occurred.

The September 23 [accepted branch-tip risk](./design.md#operational-monitoring)
remains: a branch move between the pre-dispatch check and GitHub's dispatch can
still deploy a different commit. The local adapter detects a mismatching run
and stops rather than reporting success; it cannot prevent that deployment.
If two same-actor monitoring runs appear after dispatch, it also stops rather
than guessing which one belongs to the release when GitHub supplies no direct
run ID. PR #219 now requests that direct ID and verifies the exact returned run;
the old ambiguous-run stop remains for empty dispatch responses. This API
opt-in has offline tests plus a direct test-backend
[API probe](./testing/monitoring-branch-contract-2026-09-23.md#direct-dispatch-id-api-probe)
returning HTTP 200 and a passing exact run. The dated full Coordinator sandbox
release preceded the opt-in; a direct probe does not promote it into
real-product proof.

PRs #218 and #219 are merged. Next, perform one deliberately filtered real
acceptance with explicitly
chosen Issue numbers and the verified submitter actor. Start with a small
no-database-change staging ticket, verify every saved product workflow/E2E
identity, and only then expand to a production ticket. Record live evidence
separately; the offline suite is not proof that a product environment changed
correctly.

Package publication and product adoption are complete. The GitHub-only sandbox
build/E2E stage, staging restoration, solo database-changing release and
fake-production restoration are merged into `main`; their dated live results are
linked above, as is sample operational-monitoring deployment in the sandbox
release sequence with its live acceptance. The branch-aligned monitoring
correction is merged through Coordinator PR #219. The environment-ref guard
around workflow dispatch from PR #172 was
exercised live by every September 17 monitoring operation.
The wait for other active workflow runs before each merge and dispatch is
merged (PR #181) with the per-environment sandbox lock that models the real
deploy locks (PR #182); the two-source quiet check that the live acceptance
required is delivered with the acceptance record. The current real adapter
applies the same two-source wait to the real workflow groups and does not rely on
GitHub's status-filtered run listing alone. That path still needs live acceptance.
The frontend production workflow's exact-source guard is now merged through
frontend PR #4072. The current real frontend adapter passes the exact verified
`main` commit as `expected_source_sha`; ordinary authorized manual dispatches
remain backward compatible when the input is empty.
The product-shaped test workflows are merged through frontend test PR #92 and
backend test PR #100, and their protected staging/production success path has
[live acceptance](./testing/product-shaped-workflow-mirror-2026-09-21.md). The
separate-workflow sandbox adapter now satisfies the
[retirement gate](./merge-rehearsal-testing.md#separate-workflow-adapter-retirement-gate):
the dated success and recovery records are linked in the current-state table,
and independent contract/recovery suites cover the branch-source distinction.
The sandbox default is therefore the product-shaped adapter. The old generic
adapter remains available only as the explicit
`RELEASE_COORDINATOR_SANDBOX_RELEASE_ADAPTER=generic` fallback. The canonical
evidence patterns remain `adapter-success-path-YYYY-MM-DD.md` and
`adapter-recovery-YYYY-MM-DD.md`; repository checks enforce their location and
links.
The product execution adapter is merged through PR #218 with offline tests. A
deliberately filtered live acceptance is still needed before treating its
merge, deployment, monitoring, E2E or recovery results as proven in product
environments. AWS-side monitoring target health is not independently verified
by this adapter.
Database-changing multi-ticket batches, linked tickets, heartbeat/takeover and
parallel releases remain later work.

The controlled September 16 test left ticket #22 open with
`reason:release-failed`, the journal unlocked, and both test `main` refs unchanged.
The failed candidate reached test staging before E2E failed. Protected manual
revert PRs restored both staging file trees to match test `main`; this does not
implement automatic rollback or turn the failed release into a success. See the
[failure acceptance record](./testing/staging-e2e-failure-2026-09-16.md).

## Frontend production exact-source guard, September 21

Frontend [PR #4072](https://github.com/6529-Collections/6529seize-frontend/pull/4072)
merged at `7471ac113cb2535940b19f036bf38f47f4d44eb6` (final head
`c6df6d0f493104f4878f97039bb315ac846205f2`). Readback of the exact
[`Web Deploy - PROD` workflow](https://github.com/6529-Collections/6529seize-frontend/blob/7471ac113cb2535940b19f036bf38f47f4d44eb6/.github/workflows/build-upload-deploy-prod.yml)
from frontend `main` confirmed the optional `expected_source_sha`, its full
lowercase commit check, the equality check against GitHub's fixed `github.sha`,
and the dependency that stops the production build when the guard fails. Leaving
the input empty keeps ordinary production dispatches compatible under the
repository's existing human authorization; it is not the Coordinator path.

Immediately before dispatch, the future Coordinator frontend production adapter
must first finish any conflicting-run wait, then make the final GitHub read of
frontend `main`, verify that it still represents the approved production
composition, and provide that exact commit. It must not reuse an earlier staging
read, and it must repeat the quiet check and final ref read before every dispatch.
Any mismatch ends the attempt. Save it as
[`status:action-needed`](./inbox-processing.md#status-labels) with
[`reason:release-failed`](./inbox-processing.md#reason-and-scope-labels), keep the
lane for a person, and require explicit
authorization plus fresh matching evidence for a new attempt; never reuse the
newer SHA. The guard stops before a build, so this state requires revalidation,
not an automatic source revert. This closes the check-to-dispatch source gap
inside the product workflow. It does not create the adapter, authorize a real
release, or prove that a deployment occurred.

## Product-shaped test workflow mirror, September 21

Frontend test [PR #92](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/92)
merged at `42a2a5f19710c8fa853d14d65f3c6803066714d8` and adds
`Web Deploy - STAGING`, `Web Deploy - PROD`, their automatic E2E dispatch
wrappers and their E2E workflows. Backend test
[PR #100](https://github.com/6529-Collections/release-coordinator-test-backend/pull/100)
merged at `75658981146704d71f7e0179526b8f3acf7a8f40` and adds
`Deploy a service` with the real service and specialist input set, plus
`Deploy operational monitoring`. The workflow names, dispatch fields, branch
entry rules, concurrency groups and deploy job names match the product-facing
contracts the future adapter needs. The E2E wrappers pass the exact successful
deploy run ID, and E2E independently reads that run and its canonical deploy job.

The implementation behind those interfaces remains fake. It builds the small
sample packages, records the exact source/workflow/run identity in a
`fake-deployment-evidence-v1` artifact, reads the artifact from the selected run,
and executes the built sample frontend. It has no AWS credentials, product URL,
product database, product monitoring account or product E2E suite. The production
daily canary schedule is intentionally excluded because it is not a Coordinator
dispatch or completion dependency. The old `sandbox-release.yml` is unchanged.

Both final heads passed their normal sandbox PR checks and follow-up reviews
reported no new findings. Local workflow parsing, exact dispatch-input
comparison against the current product workflows, sample builds and fake evidence
creation/readback also passed. The existing container-backed full sample test was
not available locally, but the same test passed in both PR checks.

Protected main-to-staging PRs [frontend #93](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/93)
and [backend #101](https://github.com/6529-Collections/release-coordinator-test-backend/pull/101)
then published the same merged histories to `1a-staging`. The
[September 21 live acceptance](./testing/product-shaped-workflow-mirror-2026-09-21.md)
passed staging frontend deploy -> automatic exact-run E2E, staging backend API,
monitoring staging and prod from backend `main`, production backend API, and
production frontend deploy -> automatic exact-run E2E. Independent artifact
readback matched every role, environment, source SHA, workflow path and run ID.
This proves the separate test interfaces' success path; no Coordinator code
consumes them yet, and adapter journal, stop and recovery behavior remains next.

## PR #181, #182 and #187 delivery, September 18

[PR #181](https://github.com/6529-Collections/6529-release-coordinator/pull/181)
merged at `2d7b2d2ea1e46162a8271cbdbb82463c7e1423ab` (final head
`8eb1bc1f08283ec7f0fd5586e79ae88bd058679a`),
[PR #182](https://github.com/6529-Collections/6529-release-coordinator/pull/182)
at `30b61ceb2d788511276499fe21489792f7753ba4` (final head
`79c09b01ce38f14ece8bdb4f368cdbc88edfbefb`) and
[PR #187](https://github.com/6529-Collections/6529-release-coordinator/pull/187)
at `dc6f85974f32e0e65288c9e70071423497563735` (final head
`206a74c4c41c5498ee60f6c36b6e965546fa93ea`). Each final head passed Node
20/22/24, package, both CodeQL jobs and Snyk. The 6529bot general lane asked
for changes on the first head of each PR and reported "good to merge" on every
final head; the security and deployment/Actions lanes found nothing on any
head, and the follow-up lanes found no new findings. CodeRabbit opened one
thread on PR #182 (hash the generated workflow template against its pin) and
three on PR #187 (save a rising lag indicator at once, separate merged
behaviour from the pending correction, reconcile the wait count); each was
fixed in a follow-up commit and resolved. Three general-lane suggestions were
declined with stated reasons: excluding the Coordinator's own run from the
active listing (the wait never runs while the step's own run exists), keying
the sandbox lock on a declared input (another runtime republish for no
Coordinator change), and paging the whole workflow history on every check
(hundreds of calls per hour, and a created-time horizon would be a new bound).

The merge commits' repository checks and CodeQL also passed:
[#181 checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35320419923)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35320420025),
[#182 checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35322727232)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35322727250),
[#187 checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35332796182)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35332796166).
A local `npm run check` on `dc6f859` passed all repository gates: 566 tests
ran, 563 passed and 3 were intentionally skipped; lint, formatting, workflow
policy and packed-package checks also passed.

This delivers the wait for other active workflow runs before each protected
merge and each workflow dispatch (no time limit, one logged line per check,
`waited_for` on the step record, an abortable sleep and resume that rechecks),
the per-environment sandbox release lock republished to both test repositories
with new workflow and build-helper pins and the offline pin-equals-source
tests, the two-source quiet check that the live acceptance required, the
fixture tool's wait case, and the
[September 18 acceptance record](./testing/sandbox-inflight-wait-2026-09-18.md).
The acceptance ran from the then-unmerged PR #187 branch and remains the
runtime acceptance for that sandbox change. PR #187 itself did not enable real
product releases; the current real adapter is the separate local work described
in the current-state table.

## PR #178 delivery, September 17

[PR #178](https://github.com/6529-Collections/6529-release-coordinator/pull/178)
merged at `3c01a5fec3bb14e8a916eec330388bdc90cb6c81`. Its tree matches the
reviewed final head `1e8b61ba53947d2f47597e0079ef13d5dfd41842`. The final PR
head passed Node 20/22/24, package, both CodeQL jobs and Snyk. The exact-head
6529bot general, security, deployment/Actions and follow-up lanes found no
required changes; the advisory GLM lane ran on all three heads. CodeRabbit
passed on the first head and posted no status or review on the final head; no
review thread was opened. The two follow-up commits took the general lane's
nice-to-haves (an explicit prod-stage assertion for monitoring steps, restored
monitoring operations validated in the failure test, an operational-only
evidence strip with a test, and a layout comment) and the advisory lane's asks
for explicit empty-list, missing-ref and failed-build coverage.

The merge commit's
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35224971371)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35224971350)
also passed. A local `npm run check` on `3c01a5f` passed all repository gates:
552 tests ran, 549 passed and 3 were intentionally skipped; lint, formatting,
workflow policy and packed-package checks also passed. This delivers the
`monitoring` release operation, batch policy v6, the sample monitoring runtime
and fixtures, the Git-workspace allowlist fix, and the documentation and dated
record to `main`. The
[September 17 live acceptance](./testing/sandbox-monitoring-2026-09-17.md) ran
from the then-unmerged branch and remains the runtime acceptance. This does not
enable real product releases, monitoring deployment or rollback.

## PR #172 delivery, September 17

[PR #172](https://github.com/6529-Collections/6529-release-coordinator/pull/172)
merged at `3fd1423a82e1030a652712a9fc1bb29203d8953f`. Its tree matches the
reviewed final head `9aa51ca738448d357152a26a5033db68390c6b2d`. The final PR
head passed Node 20/22/24, package, both CodeQL jobs, Snyk and CodeRabbit. The
exact-head 6529bot general, security, deployment/Actions and follow-up lanes found
no required changes; the advisory GLM lane last ran on the prior head `25621fd`.
The first head's general lane had required the journal blob fallback to reject
an unverifiable large file; `25621fd` delivered that fix with content-SHA
binding. No review thread was opened.

The merge commit's
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35190904892)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35190904932)
also passed. A local `npm run check` on `3fd1423` passed all repository gates:
534 tests ran, 531 passed and 3 were intentionally skipped; lint, formatting,
workflow policy and packed-package checks also passed. This delivers
fake-production restoration, the pinned Git blob fallback for journal files
above 1 MiB, and the environment-ref guard around workflow dispatch and result
acceptance to `main`. The
[September 16 live test](./testing/fake-production-restoration-2026-09-16.md)
ran from the then-uncommitted implementation and remains the runtime acceptance;
the environment-ref guard has offline proof only. This does not enable real product
releases or rollback.

## GitHub-only build and E2E acceptance, September 15

Production-target sandbox ticket
[#21](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/21)
passed cheap filtering, exact combined PR checks, the temporary database/service
run, protected staging integration, locked builds and artifact uploads, matching
built-output staging E2E, protected test-`main` integration, another complete
build sequence and matching production E2E. All 14 release operations passed;
the ticket is completed, owned branches are absent, the batch is archived and
the journal lock is clear.

Acceptance exposed and fixed four narrow gaps before completion: independent
runtime commits had made staging and main histories diverge; old cancelled check
attempts could mask a successful retry; one commit could reuse checks across
different release PRs; and CodeRabbit's generated PR-body block was treated as
an ownership change. Release PRs now have their own commit IDs, the new
integration checkpoint is validated for recovery, and all fixes have focused
regressions. The latest local `npm run check` passed all repository gates:
503 tests ran, 500 passed and 3 were intentionally skipped; lint, formatting,
workflow policy and packed-package checks also passed. Full links, commit IDs,
artifact digests and boundary proof are in the
[dated acceptance record](./testing/github-build-e2e-2026-09-15.md).

Source review then tightened required-check retry identity, stopped incomplete
legacy release records for manual recovery, made build-file reads stable, and
made missing build evidence explicit. A final recovery guard requires every
active integration checkpoint to retain the exact prepared input and, once
created, its unique integration commit. It keeps old terminal history readable
but stops unfinished legacy work for a person. Required checks with no workflow
run identity also remain separate and blocking instead of being collapsed.
Focused review regressions cover incomplete run identities, tied retries,
partial integration proof, mismatched fixture bases and the intentional
100,000-byte sandbox file boundary. That size boundary does not apply to future
product builds.
The generated runtime changes passed
protected backend PRs [#47](https://github.com/6529-Collections/release-coordinator-test-backend/pull/47)
and [#49](https://github.com/6529-Collections/release-coordinator-test-backend/pull/49),
frontend PRs [#44](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/44)
and [#46](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/46),
then protected main-to-staging PRs
[#50](https://github.com/6529-Collections/release-coordinator-test-backend/pull/50)
and [#47](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/47).
Final readback found the same four pinned runtime blobs on `main` and
`1a-staging` in both repositories. This refresh proves reviewed runtime delivery;
the earlier 14-operation run remains the end-to-end acceptance.

## CLI 0.0.5 publication and consumer adoption, September 15

Protected workflow run
[`34848251003`](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34848251003)
published `@6529-collections/release-request@0.0.5` from Coordinator `main`
commit `502c429f617c0c31ea2aadb03f392a96d5be8a98`. Independent registry
readback matched the workflow's SHA-1, SHA-256 and SHA-512 values, the expected
11-file archive, and SLSA provenance for that repository, workflow and commit.

Frontend [PR #4023](https://github.com/6529-Collections/6529seize-frontend/pull/4023)
merged at `d3a438d0dff68b4583c71bb1431cf9ee7e5b4a6c`. Backend
[PR #2064](https://github.com/6529-Collections/6529seize-backend/pull/2064)
merged at `b397c745499891de98605d5fe87a0a7aa86129e3`. Both current
`main` manifests were read back with the exact `0.0.5` pin. Their refreshed PR
checks and reviews passed; the frontend's additional post-merge full Jest and
coverage run
[`34937545223`](https://github.com/6529-Collections/6529seize-frontend/actions/runs/34937545223)
also passed on its merge commit. These merges enable product repositories to
create the new request shape. They do not enable Coordinator execution against
real staging or production and do not prove a product deployment.

## PR #72 delivery, September 14

[PR #72](https://github.com/6529-Collections/6529-release-coordinator/pull/72)
merged at `ebb0edb54d90ed04e136a317f4be87d31302f631`. Its tree matches the
reviewed final head `2f9391a01f2c66de6c3770888f1e5b8e1325b5b5`. The final PR
head passed Node 20/22/24, package, both CodeQL jobs, Snyk and CodeRabbit. The
exact-head 6529bot general, security, deployment/Actions and follow-up lanes found
no required changes; the GLM lane was advisory. No review thread remained.

The merge commit's
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34846523680)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34846523747)
also passed. This delivers the sandbox release sequence, v6 release evidence,
recovery hardening and recording-only monitoring intake to `main`. It does not
publish CLI `0.0.5`, migrate the real inbox, or enable real product releases.

## Sandbox release sequence acceptance, September 11

The local branch installed a pinned sandbox release check workflow in both public
test repositories and protected each `1a-staging` branch with required `Sandbox
check`. That workflow only inspects the candidate. The authorized Coordinator run
still writes its journal and ticket, integrates through temporary sandbox branches
and PRs, and cleans those temporary resources. Production-target ticket
[#15](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/15)
then passed cheap filtering, exact combined PR checks, combined service checks,
protected backend/frontend staging integration, ordered staging checks, matching
staging E2E, protected backend/frontend test-`main` integration, ordered production
checks, and matching production E2E. The ticket is closed as completed and the
journal lock is clear.

Two live interruptions improved the implementation rather than weakening proof:
the first rejected a changed pinned check workflow before creating a trial PR;
the second exposed a delayed GitHub journal confirmation after the exact commit
had been saved. The latter now retries read-only confirmation and accepts only
the exact expected commit/state and lock token. A resume-projection bug was also fixed so a
completed release can finish its ticket without rerunning release operations.
Focused regressions cover both recovery cases. A final code review also added a
zero-write guard when sandbox staging moves after the release captures its start;
that failure path passed offline and was not needed by the stable live run. Full
links, commits and evidence are in the
[dated acceptance record](./testing/release-sequence-2026-09-11.md).

PR review hardening now uses one validated `production` to `staging, prod`
mapping, prevents stale batches from closing tickets, asserts that only an
unscoped run may adopt unfinished release work, and pins the workflow, contract,
and runner files at every exact fake environment commit. Focused regressions pass;
a read-only live identity check confirmed the three runtime blobs in both test
repositories and environment branches. Cleanup now requires two consecutive
missing-ref reads before an owned branch is recorded as removed, and an unchanged
release role requires its explicit saved base tree.

The September 14 review follow-up prevents an empty resumed batch from starting
a release, requires every completed release step to retain its exact operation
and report, rejects array-shaped saved versions, and turns a malformed saved run
scope into a controlled error. The lost-plan-response regression now proves that
the exact saved plan is reused. These changes do not alter the pinned sandbox
workflow bundle, so the earlier live sequence remains the runtime acceptance.

A second review pass makes failed integration cleanup resumable: the Coordinator
saves `cleaning` before closing the owned PR, then a retry verifies that exact
open or closed PR and completes branch cleanup. Terminal `needs-human` releases
are not adopted by later unscoped runs. Test reports now use the actual frontend
or backend runner identity, and the adapter test rejects mismatched frontend
provenance.

The final review guard also requires every step behind the saved release position
to contain a passing result. A merely present failed result cannot be projected
as completed release evidence. Workflow reports also require numeric GitHub run
and attempt IDs; string-shaped lookalikes are rejected. The v6 migration test now
covers both v4 and v5 saved runs, and ticket-summary regressions retain the exact
selected group and reject leftover execution on an empty batch.

The last recovery gap is also closed: an interrupted v1 batch reconciles and
cleans only already-started exact work under the trusted v1 policy. It starts no
new v1 trial; its evidence is preserved and its selection is retired as stale, so
it cannot enter the v2 release sequence. The reason guide now documents
target-deferred tickets, and the runner-path regression works from any current
directory.

The developer-only sandbox release provisioning helper now saves its exact
branch and commit before pushing, reconciles only that branch and one matching
open PR on retry, and stops on missing, changed, closed, ambiguous or unsaved
resources. Its Git operations have a 60-second timeout. Its local checkpoint uses
a unique, exclusively created temporary file before atomic replacement, so an
interrupted or simultaneous write cannot corrupt the prior checkpoint. This is
local setup hardening; the live sandbox was not reprovisioned.

The final resume guard preserves tickets that already reached `closed` or
`completed`. Reopening the same saved batch can still project results onto its
active tickets, but it cannot replace a terminal ticket's saved decision. The
focused release regression keeps both behaviors in one resumed-batch case. A
separate stale-batch guard stops release execution before identity or integration
work, even when malformed saved state still contains a selected candidate.
Workflow polling now saves a newly discovered run identity even when the operation
was already marked running. A merged integration also reconciles its owned branch
cleanup before any missing branch could be recreated after a lost final save, and
validates the saved merge commit identity before using it in a GitHub API path.
Repeated projection of the same resumed batch replaces its prior reason instead
of accumulating duplicate deferred or failed explanations.
If a later observation makes a batch stale, its validated terminal release
evidence remains readable while the stale guard still prevents any release resume.
Workflow-run recovery reads up to ten stable 100-run pages for the exact saved
operation, instead of becoming permanently stuck when the first page is full.

The final local `npm run check` passed **482 tests** on Node 25.6.1, with the
three explicitly optional Docker cases skipped. Lint, formatting, workflow
policy, packed-CLI installation/behavior, and source-preservation checks also
passed. Node 20/22/24 and external review results remain PR evidence, not local proof.

## PR #66 delivery and live history acceptance, September 11

Final documentation commit `2c801fc` was pushed, PR #66 was marked ready, and
all required checks passed: Node 20/22/24, `Check package`, both CodeQL scans and
Snyk. CodeRabbit completed its review of this head with no actionable comments;
there were no unresolved GitHub review threads. The ready-triggered 6529bot
general review repeated the save/readback and linked-history concerns. They were
checked against the existing focused regressions and completion guards below;
no new defect was demonstrated. The disposition is recorded in the PR description.

[PR #66](https://github.com/6529-Collections/6529-release-coordinator/pull/66)
merged at `f68294c729be00dd967c364c039983678907390c` on September 11, 12:40 UTC.
Its merge tree matches reviewed `2c801fc`. Main's
[repository CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34600113234)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34600113188)
also passed.

The subsequent documentation [PR #70](https://github.com/6529-Collections/6529-release-coordinator/pull/70)
proved base-branch activation on opening head `5e8549d`: general, security,
deployment/Actions and GLM Swarm all published reviews without actionable
findings. Its Node 20/22/24, package, CodeQL and Snyk checks passed. The five-job
push configuration also has the offline policy/parser coverage below; later
head-specific review outcomes remain visible on the PR. CodeRabbit's first
attempt on that documentation head was rate-limited despite its green status,
so that status alone is not counted as a completed review.

The [live acceptance record](./testing/history-2026-09-11.md) proves v4-to-v5
sandbox migration from that clean merged source, preservation of all 13 older
tickets and seven older batch/service records, a fresh passing candidate, and
an exact repeat with zero duplicate PRs, workflows or ticket writes. All eight
archives passed content verification; completed details left active state, and
the run lock was released. Existing held ticket #1 explains exit 2 in both runs.
The temporary ticket #14 was then retired with exit 0, preserved history and
verified cleanup; only #1 remains open. This completes the storage proof step
without migrating the real inbox or executing a product release.

## Documentation and code cleanup, September 11

The cleanup shortened this page and preserved the previous narrative in
[the historical progress record](./history/progress-through-2026-09-11.md).
The guides now identify implemented batch behavior and the v5 writer correctly;
dated reports keep their original evidence and version names.

The CLI's final failure log now matches the processor: stop the old process,
inspect the journal, and resume only if that run still holds the lock. A new
full-CLI regression reproduces archive readback failing after the release commit
already cleared the lock. The duplicate stale-status condition was removed
without changing batch outcomes. No new commands or recovery machinery were added.

Validation on Node 22.16.0 passed **396 tests**, with three optional Docker cases
skipped, plus lint, formatting, workflow policy, packed CLI checks and source
preservation. The new CLI test failed against the old wording and passed after
the fix; all 23 focused logging/batch-selection tests passed. All 243 checked local
file/section references resolve. The historical snapshot preserves all 991
previous lines exactly, apart from relative link paths adjusted for its new home.
The cleanup was subsequently committed as `5e30e32` and pushed with `e6537ab` and
`bbc644d` to PR #66. Node 20/22/24 and `Check package` passed on that head. No
inbox mutation, publication or product deployment was performed.

## Fixed PR reviews and security checks, September 11

Implemented on `codex/coordinator-history-cleanup`: 6529bot general, security,
deployment/Actions and GLM Swarm on opening and every push, plus follow-up after
pushes; CodeRabbit includes drafts and has no automatic commit-count pause.
CodeQL scans JavaScript and Actions with extended security queries, pinned
actions and only the permissions needed to upload its results. Offline policy
tests reject dropped reviews/scans, bypasses and privilege expansion.

Local validation passed **426 tests**, with three optional Docker cases skipped,
plus lint, formatting, workflow/review policy and packed-CLI checks. The 61 policy
tests cover the actual files and rejected regressions; all 248 checked local
documentation links resolve. The bot's own parser/job builder at source
`e882f798239ff8a393bc1c60461023a0d4d4419f` confirmed four opening jobs and five push
jobs. CodeRabbit configuration passed its current official JSON Schema.

Commit `14cbb3c` was pushed while PR #66 was a draft. Its
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34594520569)
passed on Node 20/22/24, including `Check package`. Both
[CodeQL scans](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34594520650)
completed successfully. GitHub recorded zero results and no analysis errors for
JavaScript and Actions on PR merge revision `980d4e083b2cb53b0daede61e836e07268dcdf28`.
This is scanning evidence, not a claim that the code has no security defects.

The active `Protect main` ruleset (`22272421`) was updated and read back:
`Check package` and both CodeQL language jobs are required, with the existing
up-to-date branch and review-thread rules preserved. Its native code-scanning
rule requires CodeQL and blocks new high/critical security alerts or error-level
alerts in the PR diff. No bypass actors were added. GitHub's separate default
CodeQL setup remains off to avoid duplicating the checked-in workflow.

CodeRabbit confirmed it loaded `.coderabbit.yaml` and completed its review of
`14cbb3c` while the PR remained a draft, with a successful status and no actionable
comments. Its supplemental ESLint runner failed to install dependencies; the
repository's own ESLint check passed in CI. Its docstring-coverage warning is not
a repository merge requirement. These results do not claim that every optional
CodeRabbit tool completed. At that point the central 6529bot still read the old
configuration from `main`, so its ordinary follow-up used the existing
base-branch defaults. The later merge is recorded above.

The user completed GitHub authorization for the existing 6529 Snyk integration.
The initial root import saw zero dependencies; the targeted import and coverage
correction are recorded below. No token-bearing PR workflow was added.
[Code checks](./code-checks.md) owns the configuration and activation steps.

## Dependency coverage and bot concern verification, September 11

Snyk's targeted import of `packages/release-request/package.json` created
[the CLI dependency project](https://app.snyk.io/org/6529/project/cd173965-5342-4bf7-bd07-8641c4b40764).
Its main-branch scan sees six libraries and reports zero issues. The original
root project has zero production dependencies; it does not cover development
tools. Snyk's nested-manifest scan uses no shared lockfile: it resolved
`fast-uri@3.1.7`, while the checked-in lockfile uses `3.1.6`. This is a real
coverage distinction, not a reason to change application dependencies.

The added CI npm audit reads the actual shared lockfile for all workspaces and
development tools, fails at low severity or higher, and performs no install or
fix. The local audit reported zero known vulnerabilities. Two disposable fixtures
with a deliberately vulnerable dependency proved that the same command fails
for both a workspace runtime dependency and a root development dependency,
without installing packages or changing either lockfile. The fixtures were removed.
The CLI project's Snyk dependency PR check is enabled for newly introduced issues
of every severity, including issues without a fix. Automatic fix and upgrade PRs
are disabled for this project. These settings were saved and verified in Snyk;
the pushed `7c3c398` received a passing
[Snyk PR result](https://app.snyk.io/org/6529/pr-checks/63ea8730-a65c-4a66-a482-1c7f7e9b0d0c)
including this package. Its "No manifest changes detected" result reuses the
six-library baseline; it is not a fresh exact-lock scan. The observed
`security/snyk (6529)` status is now required by active `Protect main` ruleset
`22272421`, with existing status, up-to-date branch and CodeQL alert rules
preserved and read back after the update.
The organization's separate Snyk Code import reported three low findings on
main. They were subsequently reviewed as false positives; see
[the source-scan triage below](#snyk-code-triage-september-11).

Seven new offline history regressions passed against the existing implementation;
the history code changes only add comments explaining its existing guarantees.
All 23 focused history tests and 66 workflow/review policy tests passed.

| Bot concern                                                       | Verified outcome                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost save confirmation followed by a failed journal read          | Stops with inspect-the-journal guidance. Durable history remains available; a later exact repeat keeps attempts/budgets and does not dispatch again or duplicate ticket updates.                      |
| Lost confirmation followed by corrupt archive readback            | The archive verification still runs and rejects the result; it cannot report success based only on the saved branch head.                                                                             |
| Transport error, HTTP 403 or HTTP 422 before the ref update lands | Active records and lock remain; explicit resume preserves the original attempts and completes without duplicate dispatch.                                                                             |
| Missing archive for an unchanged resumed batch                    | Stops without creating a fresh attempt. Missing referenced evidence is distinct from saving an initial identity before any attempt exists; that narrow initial interruption resumes correctly.        |
| Clone mutation, migration shim and summary assumptions            | Existing clone isolation, archive checksum/structure validation and v4 migration/resume tests already cover the stated guarantees. No demonstrated correctness defect warrants the suggested rewrite. |
| Repeated service-reference scan and duplicated path regex         | Optional maintenance suggestions, with no demonstrated failure in the current scope. Left unchanged.                                                                                                  |

The 6529bot comment on `27a1db3` claimed code/test fixes in a docs-only commit;
its `7c3c398` follow-up also used partial context and misdescribed some existing
behavior. The verification above, rather than those claims, settles these concerns.
Full local `npm run check` passed: 438 tests passed,
three optional Docker tests skipped, with lint, formatting, workflow policy and
packed CLI checks passing. On pushed implementation `7c3c398`,
[Node 20/22/24 CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34598243936)
and the required `Check package` gate passed; each explicit audit reported zero
known vulnerabilities. Both
[CodeQL analyses](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34598244059)
passed with zero findings on test merge `7f3e393` (parents `cecbee6` and `7c3c398`).
CodeRabbit reviewed the new tests/audit without actionable comments; its waiting
for three CI results timed out, but those jobs subsequently passed as verified
above. Its advisory docstring-coverage warning remains. The 6529bot follow-up
reported no new findings with partial context. This was pre-merge evidence;
the final review and source delivery are recorded above.

## Snyk Code triage, September 11

Reviewed all three low findings in
[the Snyk Code project](https://app.snyk.io/org/6529/project/551de9a2-d5b3-48d0-858d-38da2d7a727d)
against its scanned main commit `cecbee6b1a9374581df2c0379bada59b78257e79` and the
current branch. The flagged code already existed on main. With explicit user
authorization, each specific alert was submitted as **Not vulnerable**, with its
own source-based reason and no expiry. Snyk's subsequent retest succeeded on the
same main commit, analyzing 94 files (78% reported coverage): **0 open findings,
3 ignored findings**. The ignored list was read back and confirmed each original
issue ID, its **Not vulnerable** type, the complete saved reason and no expiry.

| Finding and Snyk issue ID                                                                            | Review outcome recorded in Snyk                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcoded Non-Cryptographic Secret — `294e40d0-4020-4116-af4c-edfb4bf276de`                          | `apps/coordinator/test/run-log.test.mjs:84` uses an inert fake credential in an offline test. The test injects it into errors/events and asserts that neither logs nor terminal output expose it. It authenticates to no service. Reassess if the fixture is used for real authentication.                                                                                                        |
| Use of Password Hash With Insufficient Computational Effort — `780d40af-e3d7-4504-84cc-80f7ad2c10ad` | `apps/coordinator/src/service-contract.mjs:35` calculates Git blob IDs using the required SHA-1 header/content format, then compares them with pinned Git blob IDs. It does not store passwords. Plan fingerprints separately use SHA-256. Reassess if the function's purpose or Git object format changes.                                                                                       |
| Prototype Pollution — `dac707b7-5466-4879-9988-3e98eea49555`                                         | Traced the 57-step report from `apps/coordinator/test/rehearsal.test.mjs:651` to `apps/coordinator/src/rehearsal.mjs:299`. The accessed key comes from the normalized array's `entries()` loop, so it is a numeric list position rather than an exception message or arbitrary property name. The report array is created internally. Reassess if plan normalization or index generation changes. |

This triage changes no application code and establishes no general exemption for
tests, SHA-1 or object access. Scanning and required merge checks remain enabled.

## Controller and history cleanup, September 11

Commit `e6537ab` split the processor into scan, preparation, batch and presentation
steps. Batch rechecks use the frozen eligible pool; unsupported or over-limit
tickets cannot invalidate another group's proof through changing PR evidence.
Included tickets still require exact input and remote result verification.

The v5 writer archives only finished operations with verified cleanup and saved
ticket presentation. Repeated inputs load original attempts and budgets on demand.
Archives and index updates share one non-force Git commit based on the previous
tree; missing/corrupt evidence and competing writes stop processing. Older writers
reject v5. The old 100-batch/1,000-service lifetime caps are removed; per-search
limits remain. Compact references and ticket transitions still grow, so this is
not a claim of unlimited storage. [History storage](./inbox-processing.md#history-storage)
owns the format, migration and retention rules.

At that commit, the full Node 22.16.0 check passed **395 tests**, with three
optional Docker cases skipped, plus lint, formatting, workflow policy, packed CLI
checks and source preservation. These commits subsequently merged in PR #66;
the later [live sandbox acceptance](./testing/history-2026-09-11.md) records the
migration and repeat separately from those offline tests.

## Implementation alignment review, September 11

The agreed future release sequence reuses existing product Actions and their
environment-specific builds. Wait for successful E2E matching the deployed
staging versions before authorized production merges/deployment. Keep one release
active through completion or recovery. Confirmed no-database-change rollback
uses verified revert commits and ordinary deployment/check steps; database
changes or uncertain restoration require a person.

Future implementation still needs actual staging/main compositions, ownership
across the whole release, matching workflow/E2E results and recorded recovery
targets. These rules and remaining decisions belong in the
[execution design](./design.md#agreed-execution-direction-september-11).

## Sandbox source delivery, September 10

The service extension merged in [PR #45](https://github.com/6529-Collections/6529-release-coordinator/pull/45)
at `02fb6a645a4dd40d909f8346e06eba7057a01333`. Its seven live cases are in the
[service/database acceptance record](./testing/service-database-2026-09-10.md).
The subsequent sample-runtime guard synchronization uses the configured backend
pin `49d92ac76c9bf91520c82010afbae7f9e0fdbb39`; that delivery did not repeat all
original cases. Detailed commits, PR CI and runtime readbacks remain in the
[historical delivery record](./history/progress-through-2026-09-11.md#sandbox-source-delivery-september-10).

## v0.1 run logging, September 11

Batching and run logging merged in [PR #61](https://github.com/6529-Collections/6529-release-coordinator/pull/61)
at local ancestor `cecbee6b1a9374581df2c0379bada59b78257e79`.
The [live acceptance record](./testing/run-logging-2026-09-11.md) separates the
running source from later review fixes and CI results. It proves a passing
candidate, ordered service checks, cleanup and complete logs. It also explains
why older held ticket #1 caused exit 2 while the new ticket passed. That inbox
snapshot is historical, not a fresh scan.

## Deliberately deferred

- Real release execution, cross-ticket dependencies and database-changing batches.
- Heartbeat, automatic takeover and overlapping releases. CT-09 still requires a
  person to stop the old process and settle in-flight requests before resuming.
- New publication approval/staged-publishing rules. Bootstrap remains in place;
  the [publishing guide](./npm-publishing.md#later-approval-milestone) owns that decision.
- Removing narrow package-age exceptions during development. Update a pinned
  version and its exact exception together when adopting a new release.
- Broad product dependency remediation. The [fast-uri assessment](./security/fast-uri-assessment.md)
  has a specific dated scope; it does not clear other dependency findings.

## Dated evidence index

| Record                                                                                                                               | What it preserves                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Original progress snapshot](./history/progress-through-2026-09-11.md)                                                               | Earlier plans, delivery/CI records, request tests, dependency observations and housekeeping evidence.                                                                                                                                                                                                   |
| [npm migration](./history/npm-migration.md)                                                                                          | Completed migration checklist and independent review, with historical status clearly marked.                                                                                                                                                                                                            |
| [Merge rehearsal](./testing/merge-rehearsal-2026-09-09.md), [public required checks](./testing/merge-rehearsal-public-2026-09-09.md) | Original Git-engine and public repository acceptance.                                                                                                                                                                                                                                                   |
| [Profiled inbox](./testing/profiled-inbox-2026-09-09.md), [unified command](./testing/unified-inbox-2026-09-09.md)                   | Shared profiles, isolated intake and one-command delivery.                                                                                                                                                                                                                                              |
| [Guarded profile sandbox](./testing/profile-scope-sandbox-2026-09-22.md)                                                             | Filtered one- and multi-ticket selection, normal database isolation, a solo database release, controlled staging E2E failure, protected restoration, two live findings and same-run resume.                                                                                                             |
| [Services/database](./testing/service-database-2026-09-10.md), [batching](./testing/batch-2026-09-10.md)                             | Application assertions, ordering, database behavior and exact combined-code results.                                                                                                                                                                                                                    |
| [20 corner cases](./testing/complex-corner-cases.md)                                                                                 | Per-case results, evidence layers, reproduced gaps and unsupported future behavior.                                                                                                                                                                                                                     |
| [Run logging](./testing/run-logging-2026-09-11.md)                                                                                   | Live logs, source/review boundaries, cleanup and test-ticket retirement.                                                                                                                                                                                                                                |
| [In-flight workflow wait](./testing/sandbox-inflight-wait-2026-09-18.md)                                                             | Per-environment sandbox lock proof, the false-quiet finding and fix, the no-limit wait, Ctrl-C and resume, and the fourteen-operation release of ticket #34.                                                                                                                                            |
| [v5 history](./testing/history-2026-09-11.md)                                                                                        | Merged source, live sandbox migration, preserved archives, exact repeat and test cleanup.                                                                                                                                                                                                               |
| [Sandbox release sequence](./testing/release-sequence-2026-09-11.md)                                                                 | Protected fake staging and production, 14 matching operations, interruption/resume, ticket closeout, cleanup, and the post-run stale-start guard.                                                                                                                                                       |
| [Batch policy v3](./testing/batch-v3-2026-09-15.md)                                                                                  | A+B failing while A and B pass alone, selection of one candidate, fake staging with matching E2E, and waiting through long GitHub queues without an elapsed-time cutoff.                                                                                                                                |
| [GitHub-only build and E2E](./testing/github-build-e2e-2026-09-15.md)                                                                | Locked builds, short-lived artifacts, built-output E2E on GitHub runners, the 14-operation production path, four fixed gaps and cleanup.                                                                                                                                                                |
| [Staging E2E failure](./testing/staging-e2e-failure-2026-09-16.md)                                                                   | A real staging E2E failure stopping before production, the recorded reason, released lock, owned-branch cleanup and manual staging repair.                                                                                                                                                              |
| [Staging restoration](./testing/staging-restoration-2026-09-16.md)                                                                   | Protected undo PRs on the exact staging heads, ordered builds, restored E2E, unchanged test `main` and a transient-error resume.                                                                                                                                                                        |
| [Solo database release](./testing/solo-database-release-2026-09-16.md)                                                               | One `database_change: yes` ticket alone through the protected path, an earlier failed check that stopped without restoration, and manual staging repair.                                                                                                                                                |
| [Fake-production restoration](./testing/fake-production-restoration-2026-09-16.md)                                                   | Test `main` restored before staging through protected undo PRs, matching builds/E2E, final ref/tree readback, the large-journal blob fallback and the still-failed ticket.                                                                                                                              |
| [Sample monitoring deployment](./testing/sandbox-monitoring-2026-09-17.md)                                                           | Monitoring deployed for staging and prod after the test-main merge and before production application deployments, installed templates bound to builds and artifact records, a controlled monitoring failure restored with monitoring redeployed, and the intake pin, allowlist and moved-base findings. |
| [Branch-aligned monitoring acceptance](./testing/monitoring-branch-contract-2026-09-23.md)                                           | Merged test-mirror branch contract, exact staging/prod monitoring sources, full success release, staging and production controlled failures, protected restoration, matching E2E and final branch-tree readback.                                                                                        |

Keep current status and next steps here. Update behavior in its owning guide;
keep dated acceptance reports unchanged unless explicitly recording a new run.
