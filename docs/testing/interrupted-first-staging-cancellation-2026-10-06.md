# Interrupted first-staging cancellation — October 6, 2026

## Problem and scope

The saved real long-post release `5993c76f-2987-4357-92e1-332820b5d426`
in run `b9f77d5a-9fe8-41d6-bad4-cbc8d7422644` stopped on `release-source`
before merging its first frontend staging proposal. The historical error did
not identify which source-readiness condition failed; this is not evidence of
a feature defect. The original process exited, but the durable checkpoint
remained `running`, step zero, with one `checking` integration PR and no result.
The existing cancellation guard refused it because it was not a review pause
or an interrupted saved review stop. Later shared-branch movement also prevents
ordinary promotion of that old prepared copy; it does not prevent abandonment
of a verified unmerged proposal.

The change accepts this exact checkpoint shape in the shared engine for both
profiles. It requires confirmed no database change, no other release operation,
no prior cleanup choice, and no recovery, staging reconciliation or manual stop.
It does not rewrite a checkpoint into a review pause or infer process liveness.
Operators must independently confirm the original process, current descendants
and requests have stopped and settled for at least 60 seconds before using the
explicit cancellation command. There is no process takeover or new timeout.

The existing adapter still checks the live unmerged PR's author, body, destination,
head and uniquely owned branch. Only that proposal may be closed and its branch
removed with the existing exact-SHA conditional deletion. A merged or foreign
PR, moved branch, uncertain deletion or unavailable conditional transport refuses
completion. There is no shared-ref write, merge, workflow dispatch, restoration,
review-thread resolution, policy-pin refresh or old-proof promotion.

## Offline evidence

Node 22.16.0 focused checks of `release.test.mjs` and
`release-cancellation.test.mjs` passed all 91 tests. Added coverage reproduces a
saved first-staging checkpoint followed by a thrown pre-merge source check,
cancels only its proposal despite moved environment refs, preserves the original
plan/versions/attempts/operation identity, saves cancellation intent before cleanup,
and resumes interrupted cancellation without any forward release action.

Refusal cases cover later steps, an extra staging or production operation,
creating/merging/merged states, a completed result, other stop/recovery choices,
and observed database changes. Both adapters' staging fixtures assert that the
only writes close the exact PR and conditionally remove its owned branch.
The inbox regression covers both old review-pause and new first-checkpoint
cancellation: every selected ticket closes as not planned, cleanup must be
verified before complete-history archival, and normal closeout releases the lane.

All full non-fixing repository gates passed on Node 22.16.0: all 48 test files
ran serially, with 960 tests passed and three optional Docker skips (963 total),
plus lint, formatting, docs, workflow policy and packed CLI checks. The existing
source-snapshot wrapper verified unchanged contents. This uses the same complete
test discovery and gates as `npm run check`, with `--test-concurrency=1` for the
local test invocation only; repository scripts and CI configuration are unchanged.

A fresh GET-only journal read at commit
`50cc050540436d7fa4b8ef12a26ff10532bcca7b`, revision 710, reproduced eligibility
for the same filtered #311 run and sole unmerged staging checkpoint. That is
read-only guard admission, not evidence that live cancellation completed.
Final-head PR review/CI and merge remain pending. No live journal,
ticket, product ref or deployment changed during these offline checks. Actual
cancellation, updating the feature branch and submitting a fresh release request
are later separately verified boundaries; none is claimed here.
