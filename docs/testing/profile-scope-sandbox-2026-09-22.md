# Guarded profile sandbox acceptance — September 22, 2026

These runs used only the Coordinator test inbox and the test frontend and
backend repositories. No real product repository, product staging or
production environment, AWS target, credential, or database was changed. The
Coordinator source was an uncommitted local working tree during acceptance;
source review and delivery remain separate evidence.

## Filtered scope and normal batching

Every run explicitly selected `RELEASE_COORDINATOR_PROFILE=sandbox` and
`RELEASE_COORDINATOR_SCOPE=filtered`, with named Issue numbers and verified
actor `simo6529`. The filtered set then entered the ordinary batch policy:

- One-ticket staging run `5343960e-c9a4-4aff-ae5a-cbbfc13cc373` completed
  [ticket #41](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/41).
  Two GitHub queue observation windows ended before the saved workflows did;
  explicit resume reused those exact runs without another dispatch. The final
  [matching E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35722375027)
  passed and the ticket closed.
- Mixed run `bca97854-01b1-4805-9547-c08c52bf85a6` exposed only
  [tickets #39](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/39),
  [#42](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/42),
  and [#43](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/43).
  The normal policy deferred database-changing #42 and combined only no-database
  tickets #39 and #43. Their exact combined PR checks, service workflow,
  protected staging sequence, and
  [matching E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35726827008)
  passed. Both selected tickets closed; #42 stayed waiting.
- Run `8066f2d7-a6f8-4a7a-94ff-d575e8f54d66` then selected database-changing
  ticket #42 alone. Its exact PR checks, temporary MySQL and cleanup, protected
  staging migration, worker, API and frontend deploys, and
  [matching E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35730694887)
  passed. The ticket closed and the lock cleared. No database rollback was
  attempted or needed.

An earlier filtered run for
[ticket #38](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/38)
also proved that only its selected ticket entered processing. A transient GitHub
runner `container-unavailable` failure triggered protected staging restoration,
and the restored
[matching E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35715472826)
passed. The original failure remained on the open ticket.

## Controlled staging E2E failure and recovery

The first intended failure fixture, ticket #40, was not counted as failure
acceptance: its condition did not match the product-shaped E2E input, so the
sandbox release correctly completed staging and fake production. A fresh
fixture made normal deploy smoke checks pass while the staging-E2E-only
`SELECTED_PACK` environment produced a deterministic mismatch. Required checks
passed on backend
[PR #132](https://github.com/6529-Collections/release-coordinator-test-backend/pull/132)
and frontend
[PR #120](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/120)
before production-target
[ticket #44](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/44)
was submitted.

Run `e67302e0-1f38-4305-93c5-0641d09c90fd` passed exact combined PR and
service checks, protected backend/frontend staging integration, and every
ordinary staging deploy. The exact linked
[staging E2E failed](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35741986521)
as designed. No fake-production integration or deploy operation started.

The first invocation then exposed a reconciliation bug and stopped while
retaining its lock. After the focused fix, explicit resume of the same run
adopted the already-finished failed E2E without redispatching it. Recovery
restored the saved backend staging tree through protected
[PR #135](https://github.com/6529-Collections/release-coordinator-test-backend/pull/135)
and the saved frontend staging tree through protected
[PR #123](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/123).
The restored migration, worker, API and frontend deploys passed, followed by
[matching restored E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35744792065).

Ticket #44 remains open with `status:action-needed` and
`reason:release-failed`. Its result says staging was restored, production was
not changed, and a person still owns the failed release decision. The final
journal lock is clear. Exit `1` is expected for that ticket result; it does not
mean recovery remained unfinished.

## Findings fixed during acceptance

Two adapter gaps were reproduced against live sandbox workflows and covered by
focused offline regression tests:

1. GitHub can start the automatic E2E chain before the Coordinator saves the
   E2E operation. Automatic-chain lookup now uses the exact saved frontend
   deployment run's creation time as its causal lower boundary, rather than the
   later E2E journal-record time.
2. The automatic dispatch wrapper can first be observed while still running.
   The adapter now refreshes that saved wrapper run before deciding whether to
   look for its child E2E. The regression covers both a successful child and a
   completed failed child whose failure must be accepted as verified evidence.

This record proves the guarded selector, ordinary multi-ticket database
isolation, solo database path, failed-E2E containment, restoration, and resume
against the product-shaped sandbox mirrors. It does not prove or authorize a
real-product release or rollback.
