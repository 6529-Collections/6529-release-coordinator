# Automatic sandbox staging restoration — September 16, 2026

This controlled run used only the Coordinator's three test repositories. It
started from local branch `codex/sandbox-staging-restore`; that implementation
is not yet merged. It did not use real product repositories, environments or
deployment credentials. The earlier [manual failure test](./staging-e2e-failure-2026-09-16.md)
remains separate evidence.

## Input and failed staging run

Production-target [sandbox ticket #23](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/23)
requested backend [source PR #55](https://github.com/6529-Collections/release-coordinator-test-backend/pull/55)
at `a849cddc5d813a00800814535d0f54e1c840e847` and frontend
[source PR #52](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/52)
at `7eaf81d856275f96e4318a4b39a81f39f7506f40`. The request declared no
database change. Both source PRs passed their normal required checks and remain
open. The frontend fixture deliberately returned a different rendered value
only when the built frontend received the backend's real HTTP payload; source
and individual build checks passed.

Coordinator run `4b93306a-20d3-4c98-aabb-cda14c4375a7` selected #23, passed
temporary backend [trial PR #56](https://github.com/6529-Collections/release-coordinator-test-backend/pull/56),
frontend [trial PR #53](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/53),
and the [combined service check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35072940978).
It then merged protected backend staging [PR #57](https://github.com/6529-Collections/release-coordinator-test-backend/pull/57)
and frontend staging [PR #54](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/54).
The ordered staging builds passed. The matching [staging E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35074676055)
failed by design, so no test-production step was dispatched.

During frontend staging integration, GitHub returned HTTP 502. The Coordinator
stopped with its saved lock rather than guessing a result. Readback showed
frontend staging still at its original commit and the protected PR open with
its required check passed. Resuming the same run completed that PR without
replaying earlier steps.

## Automatic restoration

The Coordinator made new commits that restored the saved pre-release staging
trees through protected backend [PR #58](https://github.com/6529-Collections/release-coordinator-test-backend/pull/58)
and frontend [PR #55](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/55).
Both passed required checks and merged. Backend staging moved to
`96ee1d4247f9dc0d1db33b976fccf19a5eb6d0fd`, and frontend staging moved to
`878c9cd0d9ea9d2d880f543cf357af592aa55052`. Their trees match the saved
pre-release staging trees from backend `818b93337fbf73ce83e06b46e7074ad224b6f861`
and frontend `2d64d755549eddc53d2551970230dbe3cd755444`.

The restored pair passed the ordinary ordered [database loop](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35075363410),
[worker](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35075491220),
[API](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35075613076)
and [frontend build](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35075738202),
then [matching E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35075857190)
passed. The journal records the original failed E2E and successful restoration
separately. The release remains `needs-human`, and ticket #23 remains open with
`status:action-needed` and `reason:release-failed`. Both test `main` refs stayed
at backend `a7bb4e760b57f2f69a47a2602af28c46abcfb516` and frontend
`7422ec6be8aaf385f23b487c58e4a61a354ef113`; comparison found no file
differences between each test `main` and `1a-staging`. Owned trial and release
branches were removed.

The live readback proved those final refs and trees. After this run, the local
implementation gained an explicit final ref/tree readback before it records
restoration complete. That added guard has offline tests, not a second live run.

## Subsequent ticket projection check

A later unscoped run initially tried to replace old failed ticket #22's result
with a waiting result. Another prior test ticket, #20, had been deliberately
closed; its old unapplied failure transition must not reopen it. Both cases were
fixed with focused tests. Corrective run
`9d4d2a0c-fadd-448d-bd88-af2f50f87e86` finished with no candidate and an
unlocked journal. Final readback left #20 closed as a test, #22 open as a failed
release, and #23 open as a failed release. The command's exit code `2` reflected
action-needed tickets, not a failed restoration or stuck run.
