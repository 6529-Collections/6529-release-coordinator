# Real production ticket #247 — first attempt, September 25, 2026

This records a safe stop, **not a production release**. The operator selected
only [Issue #247](https://github.com/6529-Collections/6529-release-coordinator/issues/247),
submitted by `simo6529` for frontend
[PR #4093](https://github.com/6529-Collections/6529seize-frontend/pull/4093)
at `c35be6bc5c4fc17925f3e3f69e687acbcac7c5b2`, target production, declared
database change `no`.

Before the run, the saved request and current PR head matched; all five pinned
frontend required checks were green, the PR was current with `main`, the acting
account matched the pinned DCO signer and ruleset-bypass actor, and the product
workflow blobs on both staging and production refs matched their pins. The real
inbox journal had no lock. The operator ran `inbox:run` with
`RELEASE_COORDINATOR_PROFILE=real`, `RELEASE_COORDINATOR_SCOPE=filtered`,
`--issue 247` and `--actor simo6529`. The saved lock repeated exactly that scope.

Run `19c31b6f-ca82-40b7-a4b1-fdd4a21ed074` verified the receipt and PR but
left the ticket `status:waiting`, with `reason:coordinator-incomplete` and
`reason:batch-deferred`. It did not rehearse, create an integration PR, merge,
dispatch a deployment, or run E2E. It released the lock. The frontend source PR
remained open at its pinned head and frontend `main` remained at
`fbc351e1aeaa41a3a8bf0f3c6d8e055e808a1923`.

The exact obstacle was a GitHub `COMMENTED` CodeRabbit review on the requested
head. GitHub returned a null review decision and `BLOCKED` merge state, while
the existing Coordinator bypass accepted a null decision only when the review
count was zero. The five required checks themselves had passed. The generic
missing-history reason was not a separate product failure; the earlier staging
run had passed that initial phase when its approval bypass evidence was complete.

The follow-up changes the Coordinator's shared bypass check to read every
review state when reviews exist. A null decision may pass only when every
review is `COMMENTED`, with unchanged exact head/base, a pinned bypass-eligible
actor and ruleset, green required checks, no unresolved review threads and all
other existing gates. Requested changes, pending/unknown reviews, incomplete
pagination and changed evidence continue to stop. Focused offline tests and a
read-only GitHub probe of the real PR show the intended eligible result. The
probe read review count `1`, state `COMMENTED`, zero unresolved threads and all
five required checks; the readiness merge, check and review gates reported
`pass` for that exact head. The full local `npm run check` passed 630 tests with
three intentional Docker-only skips, plus lint, formatting, docs, workflow
policy and package checks. This does **not** itself authorize or prove a later
release. PR review, merge and any rerun must be recorded separately.
