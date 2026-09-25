# Product-commit DCO sign-off — September 25, 2026

## Boundary

The filtered real staging run for Issue #231 stopped at required DCO on the
Coordinator-authored temporary frontend trial PR #4097. The commit had no
`Signed-off-by` line. The Coordinator closed that trial without merging or
deploying, removed its branch, and released the journal lock. See the
[September 24 trial record](./real-trial-checks-2026-09-24.md).

Simo explicitly authorized using his own `@simo6529` identity, with its GitHub
no-reply email, for commits that the Coordinator itself creates in product
repositories while authenticated as that account. This does not sign
developers' source commits or alter the repository's DCO requirement.

The same real-profile helper now prepares the author, committer and matching
sign-off for temporary batch-trial commits and staging/production
integration/restoration commits. Each writing path rechecks the currently
authenticated GitHub account before writing. Other accounts stop. Sandbox
commits and Coordinator inbox-journal commits are unchanged.

## Evidence still needed

- The local `npm run check` passed on the updated
  [Coordinator PR #237](https://github.com/6529-Collections/6529-release-coordinator/pull/237)
  branch: 625 of 628 tests, with three Docker-only skips; lint, formatting,
  documentation, workflow-policy and package checks also passed. Updated-head
  GitHub CI and review remain separate evidence.
- Coordinator PR merge is not yet complete.
- No new real trial PR has tested this sign-off against the frontend's actual
  DCO app. Ticket #231 remains waiting. A new exact trial PR must pass DCO and
  the other configured checks before staging integration or deployment can
  start. Sandbox tests cannot substitute for that real check.
