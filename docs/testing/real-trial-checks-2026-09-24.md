# Real trial PR checks — September 24, 2026

## Observed run

After Coordinator PR [#233](https://github.com/6529-Collections/6529-release-coordinator/pull/233)
merged at `247369e`, filtered real run
`9efb8684-5f92-4f02-8fe6-cf62e624e1c2` selected only Issue #231. The
real-profile temporary Git rehearsal passed and its workspace was removed.
Combined Git filtering passed. The Coordinator created its owned frontend
[trial PR #4097](https://github.com/6529-Collections/6529seize-frontend/pull/4097)
at exact commit `9ea3dd0a45d7761ac81d6d4eae8016a5ff9e80dd` for the
checked tree. It did not merge that PR or deploy.

The first trial-check read returned `batch-checks` almost immediately after PR
creation, before all required jobs had appeared. After the jobs settled, an
explicit same-run resume returned the same error. GitHub GraphQL showed that
all five configured frontend checks were required, including Snyk as a
`StatusContext` with `context: "security/snyk (6529)"`; the reader compared only
`check.name`, so it falsely treated Snyk as absent. The run retained its journal
lock and the owned trial for reconciliation.

Separately, the trial PR's required DCO check failed because the
Coordinator-created commit has no Signed-off-by line. Other completed checks
passed. The DCO failure is a real gate and must not be bypassed or changed on
the pinned trial commit.

## Local correction and remaining boundary

The local reader change recognizes both check-run names and status-context
names, waits within its existing poll budget for a required job not yet
attached to a new PR, and still stops when a present configured check is not
required. An offline real-frontend fixture covers delayed jobs, a required
Snyk context, failed DCO, and a demoted required check. At the first cut of
this record, the change had not merged or resumed the locked live run. Future
trial commit sign-off needs separate authorization and testing; this
correction does not add one.

## Follow-up acceptance boundary

Coordinator [PR #235](https://github.com/6529-Collections/6529-release-coordinator/pull/235)
merged at `b8b1865` after 622 of 625 local tests passed (three Docker-only
skips), green GitHub checks, and a review-driven regression for a demoted
check while another job is late. The original run was resumed again from that
merged `main`, with only Issue #231 in its saved filter. It recognized all five
required frontend checks: Plan risk and security checks, Debt ratchet,
Installed app checks, and Snyk passed; DCO was `ACTION_REQUIRED`. It recorded
the candidate as `unknown`/`batch-deferred`, without release authorization.

The Coordinator closed owned trial PR #4097 without merging, verified its
branch was removed, updated Issue #231 to `status:waiting` with
`rehearsal:passed`, and released the journal lock. The source PR #4093 and
frontend `main` were not merged or deployed. DCO remains the blocking product
gate; this follow-up does not authorize a sign-off or bypass.
