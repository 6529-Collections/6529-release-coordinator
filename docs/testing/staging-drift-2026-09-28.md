# Sandbox staging-drift retest and restoration — September 28, 2026

This is test-repository acceptance for Coordinator PR
[#256](https://github.com/6529-Collections/6529-release-coordinator/pull/256),
not permission to resume real Issue #253. Both tickets used the sandbox profile,
filtered Issue/actor scope, no declared database change, and documentation-only
source changes. The test backend staging changes were unrelated to the selected
frontend tickets and changed no sample application, database or deploy workflow.

## Fresh staging retest: ticket #52

[Ticket #52](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/52)
selected frontend [PR #147](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/147).
The Coordinator passed exact PR rehearsal and combined checks, then merged
staging [PR #149](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/149)
at `aedff5cd95554ab35eef4e8968ed0dd627aa6068`. While its first staging E2E
was being accepted, unrelated backend staging
[PR #165](https://github.com/6529-Collections/release-coordinator-test-backend/pull/165)
merged at `01f3ede96f530ba5667f953e5f91407e32005bba`. The Coordinator saved
both branch pairs, left test production unchanged and made #52 wait with
`release-staging-changed`.

After confirming the backend PR touched documentation only and no backend deploy
workflow was triggered, the operator chose `--staging-change retest` for the
same run `0d61ebb0-b935-4bcd-9983-1fc4f8a3f2ba`. A **new** frontend staging
[deploy 36424424327](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36424424327)
and matching [E2E 36424574761](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36424574761)
passed against the changed backend branch. The Coordinator then merged test
production [PR #150](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/150)
at `fb779f00123a5224507980f237b850e6cb5da378`, and its matching
[deploy 36425357567](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36425357567)
and [E2E 36425491062](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36425491062)
passed. The final journal commit initially returned GitHub HTTP 422 after all
steps were saved as passed. A later resume saved completion, closed #52, and
released the lock without replaying deployments. The exact cause of the one
HTTP 422 response is unknown; the same journal write succeeded on retry.

The earlier [ticket #51](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/51)
stopped before release mutation because the sandbox service stage required both
test repositories. The frontend-only batch correction was in place for #52.

## Staging restoration and late-drift guard: ticket #53

[Ticket #53](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/53)
selected frontend [PR #151](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/151).
Exact rehearsal and combined checks passed. The Coordinator merged frontend
staging [PR #153](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/153)
at `3c19904caa071620097411c2440412a53846fdb1`, then passed
[deploy 36431241671](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36431241671)
and [E2E 36431382737](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36431382737).
Unrelated backend staging
[PR #166](https://github.com/6529-Collections/release-coordinator-test-backend/pull/166)
merged at `b9c09d5293c9d71932b693201ef99af6a87785bb` **after** that E2E passed
and as production integration began. This missed the original E2E-acceptance
window and exposed a second boundary needing protection.

The test run `754e5e7e-0dfa-4d64-a11e-f5fd9a5a5fd2` was stopped during a
prepared production integration. Readback found no test-production PR or branch
for that operation and test frontend `main` still at
`fb779f00123a5224507980f237b850e6cb5da378`. PR #256 then added a staging
ref check immediately before the first production action, with regression tests
for both choices after an already-passed E2E. Resuming the same run stopped at
`release-staging-changed` before any fake-production merge.

After exact ref and backend-diff readback, the operator chose
`--staging-change restore`. The Coordinator merged checked frontend staging
[restore PR #154](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/154)
at `580745558fb8c2d1b3be142a3efca8b0db6b715c`, waited for an automatic
workflow to become quiet, then passed a fresh frontend staging
[deploy 36434951611](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36434951611)
and matching [E2E 36435108203](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36435108203).
The restored frontend staging tree `df121147e2615c7a807283dd26717fe70588755b`
matches its saved pre-ticket tree exactly. Backend staging remains at the other
developer's `b9c09d5` commit. Frontend test-production `main` remains at
`fb779f0`; backend test-production `main` remains at `5f57cba`. The journal
verified these refs/trees, released the lock, and left #53 open
`action-needed`/`release-failed`, as intended for a restored failed release.
The command's exit code 1 reflects that ticket outcome, not a failed restore.

## Boundary

These runs prove the sandbox choices and the newly added last check with the
test workflow mirror. They do not prove that real backend staging was deployed
successfully, that its database effects are absent, or that the real frontend
and backend are compatible. Real Issue #253 remains stopped pending those
separate checks. A later read-only September 28 comparison found that all four
real staging/`main` refs had moved beyond the saved versions. Its automatic
choices require unchanged refs, so neither is available for that old run; it
needs manual reconciliation and, if appropriate, a fresh exact request.
Coordinator PR #256 merged at `88ddbd7d0a27f63ab2054277cdcacc8fbd0c946f`
after green checks and current-head review; this is source delivery, not
real-profile recovery proof.

The real journal's saved versions were backend staging `2c84d3e7`, frontend
staging `5719c1b9`, backend `main` `664eef9d`, and frontend `main` `fbc351e1`.
The later read-only refs were `d66b9e65`, `85b7d754`, `29bf0f37`, and
`1672474d` in the same order. This is a ref comparison, not deployment proof
or an attribution of those later changes to Issue #253.
