# Review-pause sandbox acceptance — September 29, 2026

This test used only the sandbox inbox and sample frontend repository. It used
local, unmerged Coordinator source from `codex/review-pause`; no real product
repository or release was touched.

## Exact test scope

- Documentation-only source fixture [frontend PR #155](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/155), head `465725d8d764490cb07c25a3e616b6586f223f32`.
- Verified production-target sandbox [ticket #54](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/54), submitted by `simo6529` through [intake run 36566785426](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/36566785426). Filtered run `0b3fc005-575d-4880-99bb-0d2fbebaf7e5` exposed only #54.
- Temporary trial [PR #156](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/156) passed its required check, then was closed and its branch removed.
- Staging integration [PR #157](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/157), [deploy 36568710488](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36568710488), and [matching E2E 36568839990](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36568839990) passed before production integration.

## Pause and resume observations

The Coordinator opened protected test-main [integration PR #158](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/158) at exact head `a45d2705aba0906359070430fc715a26d3de306e` against base `fb779f00123a5224507980f237b850e6cb5da378`. A controlled [unresolved review comment](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/158#discussion_r4133506581) was added to the new documentation line while its required `Sandbox check` ran. That check passed. GitHub reported `BLOCKED`, and the Coordinator saved `awaiting-review` instead of closing the PR or starting production deployment.

Ticket #54 became `status:waiting` with `reason:release-review-pending` and the PR link. The journal retained the same run lock and exact PR/head/base. Test `main` remained at its saved base. After the original process exited and the documented wait elapsed, ordinary `--resume` rechecked the still-unresolved thread and returned to the same pause without another PR, merge, or deploy.

The test thread was then resolved. A second explicit resume rechecked the same PR and merged it under the existing approval-only bypass checks, producing test-main commit `58ee3011cea7a2498de60d4890a667e469308840`. [Fake production deploy 36570383846](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36570383846) and its [matching E2E 36570759532](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36570759532) passed. The E2E job queued for several minutes before running; the Coordinator waited for its exact result rather than claiming completion early.

Final readback found ticket #54 closed with `status:completed` and `reason:release-completed`, PR #158 merged, the Coordinator-owned integration branch absent, and the sandbox journal lock released at revision 4397. The same run ID was used across the initial pause and both resumes. No new candidate or duplicate production integration PR was created.
Source fixture PR #155 remains open as a test record; it was not itself merged.

The `--review-stop` path (verified owned PR closure followed by normal recovery) has offline adapter and release-state tests; it was not invoked in this sandbox run. After live acceptance, the stop choice was made durable before cleanup and tested against a lost-save-response interruption, so ordinary resume cannot accidentally turn it into a merge. The log outcome for a deliberate review pause was also made `waiting` instead of `unknown`. Those two follow-ups have offline tests, not a separate live run. The final local `npm run check` passed 662 tests with three optional Docker skips, plus lint, formatting, documentation, workflow-policy, and package checks. A sandbox pass is not real-product acceptance or permission to resume the separate real Issue #266 run.
