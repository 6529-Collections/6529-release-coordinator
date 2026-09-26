# Real production ticket #250 — tree-identical staging merge, September 26, 2026

This records a failed release attempt with verified staging restoration,
**not a production deployment**.
The filtered real-profile run selected only
[Issue #250](https://github.com/6529-Collections/6529-release-coordinator/issues/250),
submitted by `simo6529` for frontend
[PR #4093](https://github.com/6529-Collections/6529seize-frontend/pull/4093)
at `c35be6bc5c4fc17925f3e3f69e687acbcac7c5b2`. The request targets
production and declares no database change.

Before the run, staging-only frontend [PR #4103](https://github.com/6529-Collections/6529seize-frontend/pull/4103)
aligned the browser test with the source PR. Its staging deploy and separate
staging E2E both passed. The Coordinator then passed request validation, exact
Git rehearsal, combined checks, and owned trial PR #4104. It merged staging
integration [PR #4105](https://github.com/6529-Collections/6529seize-frontend/pull/4105)
at `9ac34b5efc6a3ad50c55c04892596592b0a93ae6`.

That merge changed staging history but no files. Its tree remained
`36366ee1ac5197a726443eecc2fe55a6c1deb037`, matching the pre-merge tree.
The frontend staging workflow ignores pushes with no eligible changed paths;
no push-triggered deploy appeared for that exact commit. The Coordinator
assumed every merge produced such a run and waited for one that could not
start. Run `7dd97148-06c3-4615-acde-6db3c5ed9c9a` exited with an unresolved
deploy step. The original process stopped. The GitHub journal lock still names
only #250 and actor `simo6529`; its staging integration operation is completed,
while the staging deploy is prepared with no workflow run ID. The ticket has
not closed. Frontend production `main` did not move and no production workflow
was dispatched.

Merged Coordinator [PR #251](https://github.com/6529-Collections/6529-release-coordinator/pull/251)
at `47b6d5a93bceaa427cde10d2779f0ea079ea59ef` reads the saved integration
base commit and merged tree. A
tree-identical merge takes the pinned workflow's existing manual-dispatch path,
with the same exact-commit and run-evidence checks as other dispatches. A
changed tree continues to adopt the push-triggered run. Missing or inconsistent
tree evidence stops before dispatch. The full offline check passed 632 tests
with three Docker-only skips, and protected-branch checks and reviews passed.

The saved run resumed with only #250 in scope. It dispatched and verified
[staging deploy 36236806581](https://github.com/6529-Collections/6529seize-frontend/actions/runs/36236806581)
for exact staging commit `9ac34b5efc6a3ad50c55c04892596592b0a93ae6`, then
verified linked [staging E2E 36237340050](https://github.com/6529-Collections/6529seize-frontend/actions/runs/36237340050).
The first invocation ended before the deploy workflow completed; the saved
run ID and dispatch boundary allowed a later resume to accept the same run
without dispatching twice.

Production integration [PR #4106](https://github.com/6529-Collections/6529seize-frontend/pull/4106)
for the selected code passed its reported checks but remained GitHub `BLOCKED`.
A Codex review raised an unresolved P2 thread: two distinct clipboard files
with the same metadata could be mistaken for one. The PR had one unresolved
review thread and lacked the separate approval needed to merge without the
Coordinator's approval-only bypass. The Coordinator's journal calls this
`kind: checks` with a generic "integration PR checks failed" message; the
specific observed blocker was review/merge eligibility, not a failing CI job.
PR #4106 was closed unmerged. The source PR #4093 remains open at its pinned
head. Production `main` stayed at
`fbc351e1aeaa41a3a8bf0f3c6d8e055e808a1923`; no production workflow ran.

Because the ticket declared no database change, the Coordinator restored
staging through checked [PR #4107](https://github.com/6529-Collections/6529seize-frontend/pull/4107),
resulting commit `d36d02a4e8a196c445cbe68b50904aeaf20915fc`. Its tree
`36366ee1ac5197a726443eecc2fe55a6c1deb037` matched the saved pre-release
staging tree. The restored commit passed
[deploy 36238579916](https://github.com/6529-Collections/6529seize-frontend/actions/runs/36238579916)
and linked [E2E 36239162592](https://github.com/6529-Collections/6529seize-frontend/actions/runs/36239162592).
The journal's final ref/tree readback matched both saved environments.
Issue #250 is open `action-needed` / `release-failed`; its run lock was
released. The source developer should inspect and resolve the P2 review
finding. After that, submit a fresh exact-head production request instead
of reusing failed #250.
