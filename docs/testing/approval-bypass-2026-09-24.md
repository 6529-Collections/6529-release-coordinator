# Approval-bypass mirror — sandbox acceptance, September 24, 2026

This acceptance used only the test inbox and the two sample product repositories.
It changed no real frontend/backend rules, code, workflow or deployment. The
Coordinator code used here is local and unmerged; this record does not authorize
or prove a real-product release.

## Test repository policy

Both test `main` branches retained their existing classic protection: pull
requests, the app-bound required `Sandbox check`, conversation resolution, and
no force pushes or deletion. New active rulesets add one required approval and
give only GitHub user `simo6529` (`209783236`) PR-only bypass:

| Test repository | Ruleset | Review details |
| --- | --- | --- |
| [Backend](https://github.com/6529-Collections/release-coordinator-test-backend/rules/23921709) | `23921709` | One approval; no last-push approval |
| [Frontend](https://github.com/6529-Collections/release-coordinator-test-frontend/rules/23921701) | `23921701` | One approval; last-push approval and resolved review threads |

This is a behavior mirror, not a byte-for-byte copy. The real repos have
different required check names and reviewer-team rules. The existing classic
conversation-resolution protection remains enabled in both test repos.

The sandbox profile pins these two ruleset IDs. The real profile has no bypass
ruleset pin, so the new code does not take the real-profile bypass path. The
shared gate accepts `BLOCKED` with `REVIEW_REQUIRED`, or a null review decision
only when GitHub also reports zero formal reviews. It confirms this token's
`pull_requests_only` entitlement on the pinned effective ruleset,
finds no unresolved review thread or unrecognized effective rule, and
independently checks every required result and the exact PR/base commits. An
up-to-date requirement is checked by commit ancestry. It rechecks immediately
before an integration merge and saves bypass evidence in the journal. GitHub's
bypass applies to its ruleset as a whole, so the Coordinator must keep checking
the other known conditions itself; a ruleset change it cannot audit stops the
bypass.

## Offline checks

The focused tests cover a missing approval with green checks; wrong or
ineligible actor, failed/pending/missing checks, requested changes, conflicts,
moved head/base, unresolved threads, unknown rules, classic review
requirements, and strict up-to-date checks. After the null-decision follow-up,
the review follow-up also covered failed/absent optional readiness evidence and
malformed ancestry responses. `npm run check` passed locally: 620 tests ran,
617 passed and three Docker-only
tests skipped; lint, formatting, documentation, workflow policy and package
checks passed. This is local source proof, not a merged PR or GitHub CI result.

## Live sandbox run

The unapproved, green source fixtures were backend
[#161](https://github.com/6529-Collections/release-coordinator-test-backend/pull/161)
and frontend
[#143](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/143).
Verified [test ticket #50](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/50)
was submitted by `simo6529` through
[intake run 35964643290](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/35964643290).
The filtered run saw only Issue #50, declared no database change, and selected
both PRs. Exact Git rehearsal, the backend/frontend temporary trial checks,
and the [sample service/database check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35965775830)
passed; temporary trial PRs were closed and their owned branches removed.

The product-shaped sandbox adapter then completed all fourteen operations:

1. Staging backend [#163](https://github.com/6529-Collections/release-coordinator-test-backend/pull/163)
   and frontend [#145](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/145)
   integration PRs passed their configured `Sandbox check`, followed by ordered
   fake backend and frontend deploys and matching
   [staging E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35967240531).
2. Protected test-main backend [#164](https://github.com/6529-Collections/release-coordinator-test-backend/pull/164)
   and frontend [#146](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/146)
   integration PRs each passed the required `Sandbox check` and merged with
   zero reviews while GitHub still reported `REVIEW_REQUIRED`. The archived
   journal records each exact checked head/base, the matching ruleset ID,
   `Sandbox check`, and zero unresolved threads. Fake production deploys and
   matching [production E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35968915555)
   then passed.

The initial process stopped after frontend staging integration with “Inbox lock
changed.” Inspection found the same saved run still held the lock, both staging
integrations were recorded as passed, and the next frontend deploy was only
prepared. The original process had exited; after the documented wait, an
explicit `--resume` of run `6175b694-b2ef-4b13-86bc-b5f9623ed07d`
reconciled the already-completed exact staging deploy and continued without a
duplicate deployment. The cause of the lock-change observation is not proven;
the interruption means the path was not uninterrupted. The resumed run finished
with verified results, closed Issue #50 as `release-completed`, archived the
release evidence, and released the journal lock.

The two source fixture PRs remain open. The test main branches contain the
released sample fixture through the Coordinator's integration PRs. No source
PR was merged directly, and no real product repository was touched.

## Real-rule read-only probe after the live sandbox run

Frontend [PR #4093](https://github.com/6529-Collections/6529seize-frontend/pull/4093)
currently has no reviews and GitHub reports `mergeStateStatus: BLOCKED`, but
its GraphQL `reviewDecision` is **null**, unlike the sandbox PRs'
`REVIEW_REQUIRED`. The real ruleset requires a maintainer-team review, which
the sandbox rulesets do not copy because the team lacks write access to the
test repositories. Granting that team test-repo write access was not part of
this acceptance.

The local code was extended after the live sandbox run to handle this null
case only with a verified zero-review count and the same ruleset/check/ref
audit. The later review follow-up also makes an unavailable optional bypass
read leave readiness blocked on approval instead of aborting the whole scan.
A read-only probe supplied the real frontend ruleset ID and required
check names to an in-memory profile copy, without changing the configured
real profile. It found the current `simo6529` token PR-only eligible on exact
PR #4093 head `d635b5f` and current base `82583c9`, with all five ruleset
checks successful, strict ancestry satisfied, zero reviews and zero unresolved
threads. This proves the local observation logic on one real PR; it does **not**
test a real merge, release workflow, or deployment. The final null-case code
has offline tests but no live sandbox merge of a null-decision PR.
