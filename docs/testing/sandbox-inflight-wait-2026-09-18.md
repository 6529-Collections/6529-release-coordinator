# Waiting for other workflow runs in sandbox releases — September 18, 2026

This controlled acceptance used only the Coordinator's three test repositories
and GitHub-hosted runners. It did not read or change the real frontend/backend
repositories, product environments, AWS accounts, credentials or deployments.
It ran from local branch `codex/wait-live-proof`, which is merged `main`
`30b61ce` ([PR #181](https://github.com/6529-Collections/6529-release-coordinator/pull/181),
[PR #182](https://github.com/6529-Collections/6529-release-coordinator/pull/182))
plus this record's own PR: the fixture-tool wait case and the quiet-check fix
described below. A sandbox pass authorizes no real release.

## What was tested

Before each protected merge and each workflow dispatch, the Coordinator lists
the pinned `sandbox-release.yml` workflow's active runs in the repository it is
about to change and waits, without a time limit, until there are none. The
sandbox workflow holds one concurrency lock per environment
(`sandbox-release-<environment>`, `cancel-in-progress: false`), so a second run
for an environment waits and a third arrival would cancel the waiting one; the
wait exists so that never happens to a Coordinator run.

## Setup

- Runtime pins on `main` and `1a-staging` of both test repositories: workflow
  `ca25d499…`, contract `a7d0b50c…`, build helper `33f83740…`, runner
  `23fc3a3c…` (read back after the PR #182 republish).
- Fixture PRs from `prepare-cases.mjs --create-wait-prs`, docs-only: backend
  [PR #96](https://github.com/6529-Collections/release-coordinator-test-backend/pull/96)
  at `0283f9fcac2f21b76537c7e574bb5babd81f4f59`, frontend
  [PR #88](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/88)
  at `df237be7ef7a957b8268d9847ba717723f8b7bc1`.
- Request `33787bfa-0afb-403e-aa15-2704bb3b34b3` (production, no database
  change) became ticket
  [#34](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/34)
  through intake run
  [35321765856](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/35321765856).
- "Someone else's deploys": a local helper dispatched throwaway runs of
  `sandbox-release.yml` on backend `main` (environment `staging`, e2e-shaped
  input that the pinned runner refuses after both sample builds) so that one
  run was always running and one waiting. Each lasts ten to thirty seconds
  because the sample packages build in about a second.

## The lock itself, before the release

The republished workflow parsed and ran on the setup branch (run
[35320751493](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35320751493),
failing only at the runner's own refusal). Two same-environment runs dispatched
two seconds apart: run
[35320956662](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35320956662)
ran its job 07:45:22Z–07:45:32Z, and run
[35320959717](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35320959717)
stayed `queued` until the first completed and ran its job 07:45:36Z–07:45:43Z.
Concurrency-blocked runs show status `pending` in GitHub's API.

## First attempt found a false quiet

Run `c3c097b3-1e2e-416b-a666-58212a7c76d3` started 08:07:06Z. Ticket #34
passed intake, rehearsal and the batch checks (attempt `d3efdbcd…`, trial PRs
backend #97 and frontend #89 created and cleaned), and release
`678ef2ed-b764-43d1-9680-bd008e87eef9` began while the helper was dispatching a
throwaway run every ten to twenty seconds.

`staging:integrate:backend` merged
[backend PR #98](https://github.com/6529-Collections/release-coordinator-test-backend/pull/98)
at 08:23:23Z **without a single `release.wait` event** and with no
`waited_for` saved, although runs were active the whole time. Then
`staging:deploy:backend:dbMigrationsLoop` stopped at 08:24:02Z with "Active
sandbox release workflow runs are unreadable or exceed one page": GitHub's
`total_count` for a status disagreed with the list it returned. The run ended
with exit code 2, the journal kept its lock, and the deploy record stayed
`prepared`; nothing was dispatched.

Direct measurement at 08:25:51Z–08:26:10Z, with the helper running, showed
why. The status-filtered listing (`runs?status=<s>`) lags behind run
transitions: it returned pairs such as `in_progress` 1/0, `queued` 1/0 and
`pending` 1/0 (count/listed) within seconds of each other, so it can report
nothing while a run is active. The unfiltered newest page (`runs?per_page=100`)
showed the active runs and their current statuses every time.

The fix in this PR reads both: the workflow is quiet only when the newest page
holds no unfinished run **and** every status count is zero. A count without a
listed run still blocks, and `waited_for.unlisted` keeps the highest lag
indicator seen, the excess of the status counts over the runs listed. Offline tests cover the lagging listing and the newest-page case, and
the earlier strict page assertion is gone.

## Resume one: the wait, then Ctrl-C

`--resume c3c097b3…` from the fixed code started 08:32:42Z, re-read the ticket
and reached `staging:deploy:backend:dbMigrationsLoop` at 08:34:51Z. It logged
`release.wait` at 08:35:11Z, 08:35:37Z, 08:36:04Z, 08:36:30Z, 08:36:57Z and
08:37:23Z, each naming one or two active runs (`in_progress`, `queued` or
`pending`, for example
[35325085280](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35325085280)
and
[35325283860](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35325283860)),
and pressed nothing.

SIGINT was sent at 08:37:34Z. At 08:37:39Z the log shows `[interrupted]
release.deploy`, `run.unfinished` and `run.finish`; the command exited with
code 2 and "This operation was aborted". Journal readback: the lock still
belonged to run `c3c097b3…`, the deploy record was still `prepared` with
`waited_for` (purpose `dispatch`, ten recorded blocking runs, first
`35325085280 in_progress`, `unlisted` 0, no `checks` yet), and no Coordinator
run existed on `1a-staging`.

## Resume two: no time limit, then the press

After the sixty-second settle, `--resume c3c097b3…` started 08:40:56Z and
reached the same deploy step at 08:41:14Z. With the helper still running it
logged `release.wait` 72 times between 08:41:14Z and 09:08:36Z, twenty-seven
minutes, and pressed nothing. The helper was stopped at 09:08:45Z (110
dispatches in that window). The next check found the workflow quiet and the
Coordinator dispatched; `staging:deploy:backend:dbMigrationsLoop` passed at
09:10:06Z with run
[35328064837](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35328064837)
(1,732 s in the step, almost all of it waiting).

## Release operations

Release `678ef2ed-b764-43d1-9680-bd008e87eef9` ran fourteen operations in
this order (execution started 08:20:21Z, completed 09:35:20Z):

| Step | Result |
| --- | --- |
| `staging:integrate:backend` | passed; [backend PR #98](https://github.com/6529-Collections/release-coordinator-test-backend/pull/98), test `1a-staging` `e89ee428e37a` |
| `staging:deploy:backend:dbMigrationsLoop` | passed; run [35328064837](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35328064837); waited before dispatch: 90 blocking runs recorded over 74 checks, first seen 08:34:59Z, quiet 09:09:17Z, highest unlisted count 1 |
| `staging:deploy:backend:worker` | passed; run [35328188473](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35328188473) |
| `staging:deploy:backend:api` | passed; run [35328319132](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35328319132) |
| `staging:integrate:frontend` | passed; [frontend PR #90](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/90), test `1a-staging` `9f7b68df5128`; waited before merge: 5 blocking runs recorded over 4 checks, first seen 09:14:53Z, quiet 09:16:07Z |
| `staging:deploy:frontend:frontend` | passed; run [35328779196](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35328779196) |
| `staging:e2e` | passed; run [35328906594](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35328906594) |
| `prod:integrate:backend` | passed; [backend PR #99](https://github.com/6529-Collections/release-coordinator-test-backend/pull/99), test `main` `726f8e3acbcd` |
| `prod:deploy:backend:dbMigrationsLoop` | passed; run [35329299733](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35329299733) |
| `prod:deploy:backend:worker` | passed; run [35329439156](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35329439156) |
| `prod:deploy:backend:api` | passed; run [35329565729](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35329565729) |
| `prod:integrate:frontend` | passed; [frontend PR #91](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/91), test `main` `ae3beb341751` |
| `prod:deploy:frontend:frontend` | passed; run [35329950388](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35329950388) |
| `prod:e2e` | passed; run [35330119516](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35330119516) |

The record's `waited_for` notes come from the archived batch
(`history/batches/df95072b…json` on `codex/inbox-state`). The first backend
dispatch note spans both resumes: its `first_seen_at` is from resume one and
its 74 checks and `quiet_at` from resume two; `unlisted` 1 shows one check in
which GitHub counted a run its listing did not show.

## Final state

Ticket #34 closed with `status:completed`, `reason:release-completed`,
`rehearsal:passed` and `batch:passed`; its status comment lists every
operation. The journal lock was released at 09:38:33Z and the batch archived.
Both owned `codex/release-678ef2ed-…` branches are gone. Final refs: backend
`main` `726f8e3a`, `1a-staging` `e89ee428`; frontend `main` `ae3beb34`,
`1a-staging` `9f7b68df`. The command exited with code 2 only because the
older tickets #22, #23, #24, #27 and #32 remain `action-needed` from earlier
controlled failures. The helper's throwaway runs remain in both test
repositories' Actions history as failed `Sandbox release` runs on `main`; the
fixture PRs #96 and #88 stay open as test input.


## What this proves and what it does not

- The Coordinator waits before a dispatch while another run of the pinned
  workflow is active, logs each check, records the blocking runs, has no time
  limit, stops cleanly on Ctrl-C before pressing, and presses once after
  resume when the workflow is quiet.
- The merge-path wait also holds with the fixed check. During
  `staging:integrate:frontend` the helper was run against the frontend
  repository from 09:13:38Z (nine dispatches); the Coordinator logged
  `release.wait` before the merge at 09:15:04Z, 09:15:28Z and 09:15:53Z, the
  helper was stopped at 09:15:32Z, and the merge went through at 09:16:47Z once
  the workflow was quiet. The first attempt's merge without a wait was the
  false quiet described above, not a missing check.
- GitHub's status-filtered run listing is not a real-time source; the newest
  unfiltered page is. The fix and its tests are part of this PR, so the source
  that passed this live run is the source being merged.
- The sandbox lock serializes same-environment runs as the real deploy
  workflows do; the real adapters are not built.
