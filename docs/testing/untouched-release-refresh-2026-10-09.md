# Untouched release refresh — October 9, 2026

## Scope

The existing release invocation for request 334 exited during its first staging
integration's unlimited workflow-serialization wait. The saved execution had
started, so ordinary candidate refresh correctly refused it, while current
product branches had advanced. No staging integration/deployment/E2E or
production evidence was saved.

The approved local fix adds the explicit resume-only
`--refresh-untouched-release RELEASE_ID` action. It applies only to the same
owner-held single frontend-only real production request with confirmed no
database change, unchanged policy, and an untouched first prepared staging
operation. It rejects any saved resource/write intent or unknown field and
independently requires absent expected owned branch/PR, settled old trials,
unchanged source/receipt gates and stable current environment refs. The newly
observed main must not have been attempted before.

The atomic journal transition preserves the complete old execution snapshot
and entire-batch hash, original inputs, policy, attempts, archives and spent
budgets. The old execution becomes terminal `superseded` stale history, not a
successful release or rollback. A durable writer marker prevents older code
from silently reading the new contract. Fresh preparation retains retry linkage
and all previous count usage, and must pass fresh Git/CI before ordinary saved
staging deployment/E2E and then production deployment/E2E. Repeating the old
release ID and resuming after a lost save response do not allocate another round.

No product/source/workflow/pin change, new policy limit, process takeover,
automatic release retry, provider change or deployment bypass is introduced.

## Actual stopped-state inspection

Before implementation, read-only process inventories more than 60 seconds apart
confirmed the original Node/npm process, actual descendants, scoped runners and
in-flight requests absent. The last inventory was at
`2026-10-09T14:06:52.571Z`. These are historical observations, not permission to
assume process absence before a future execution.

Authoritative journal revision 840 remained at
`3758870ec3e28e96a8ff1083f2f4768fc950366a`, blob
`fe7c59befacb1bed06e85f8746f3948001e10694`. The held run
`d46efc1b-5acb-4ebd-93cf-72d261445531` and release
`14873912-1e40-43d9-a88c-5660d3d26bd8` still named request 334 only. The first
staging operation was `prepared` with a null result and no branch/base/commit/PR
or integration intent. Its exact expected owned branch returned 404 and its
all-state PR query returned an empty list. Journal, release plan and execution
validators passed. The immutable outbox/request matched and source PR 4120
remained open, non-draft and unchanged at
`6488108007507eff7c1bed524a0d0f5a61a7fe91`.

The earlier candidate's checks and owned trial cleanup were successful, but
their base was no longer current. Neither those checks nor the historical
diagnostic rerun prove an environment deployment. The saved `running` status
describes unfinished journal work, not a live process.

## Offline verification

Node 22.16.0, non-fixing verification:

- All 15 focused recovery tests passed. They cover exact identity and old-record
  preservation, archive validation, fresh Git/CI, old-proof refusal, budget
  exhaustion, source/cleanup/absence/stability failures, cancellation/ownership
  loss, unknown or effectful fields, ordinary resume, repeated old commands,
  a newer unfinished execution, lost save responses, writer-marker preservation,
  CLI forwarding and unrelated-record preservation.
- All 53 repository test files ran serially: 1173 tests total, 1170 passed,
  three optional Docker skips and zero failures.
- Lint, formatting check, documentation links, workflow policy and isolated
  offline packed-CLI checks passed. The source-snapshot guard confirmed no source
  changed during the full gate. A final evidence-only documentation update was
  checked separately.

All new recovery tests use fake journal/GitHub adapters and do not call GitHub
or run a product workflow. The new action was not exercised against the live
journal; the earlier read-only stopped-state observations are not live recovery
acceptance or fresh admission for a future execution.

## Delivery boundary

This record covers implementation and offline verification. Publishing a feature
branch and opening a review PR do not establish hosted review/CI, protected merge,
package publication or live recovery acceptance; those remain separate gates.
No live journal/ticket/lock, product workflow, source PR, staging/production
environment or automation was changed during implementation. The scheduled watch
remains paused and deployment remains stopped. A future live action needs fresh
human authorization and independent stopped-process/current-state admission;
the earlier one-time retry permission was consumed.
