# Real production ticket #250 — tree-identical staging merge, September 26, 2026

This records an unfinished release attempt, **not a production deployment**.
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

The correction reads the saved integration base commit and merged tree. A
tree-identical merge takes the pinned workflow's existing manual-dispatch path,
with the same exact-commit and run-evidence checks as other dispatches. A
changed tree continues to adopt the push-triggered run. Missing or inconsistent
tree evidence stops before dispatch. Focused offline tests cover both paths
and the fail-closed case. This correction still needs protected-branch merge
and a live resume before claiming a completed release.
