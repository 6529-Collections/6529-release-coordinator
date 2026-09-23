# Monitoring branch contract — sandbox acceptance, September 23, 2026

This record covers only the Coordinator test inbox and the test backend/frontend
repositories. Their workflows use sample code and fake deployment evidence. No
real product release, AWS monitoring target, credential, or database was changed.
The Coordinator ran from unmerged PR #219 source; source delivery is separate.

## Published test contract

- Test backend [PR #139](https://github.com/6529-Collections/release-coordinator-test-backend/pull/139)
  and test frontend [PR #127](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/127)
  passed their Docker-backed `Sandbox check` and merged to test `main` at
  `83c510ed129afb6357bc0cbee199c8f33623c385` and
  `95795ad5602fd253c87974411d6277ca15775c65`.
- Main-to-staging [backend #140](https://github.com/6529-Collections/release-coordinator-test-backend/pull/140)
  and [frontend #128](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/128)
  passed `Sandbox check` and merged at `7c2b6ee64ed2219af7fb1caeccd2d8658c627eec`
  and `a2357194e4ed4a7aabc68dd1ecff841f089494eb`.
  The pinned monitoring workflow blob was `e059b1210a5c345b3c546ee1a40a9c911521ecae`
  on both backend branches. The pinned release-contract blob was
  `f11d31f10d867b832b18248fb18adfc86b2375fe` and release-run blob was
  `ed0658a1ce719411614cc35366dbf84e6dcae796` on both branches of both
  test repositories. This matched the Coordinator's trusted pins.
- The automatic test frontend staging deploy
  [35850653717](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35850653717)
  and its staging E2E
  [35850763500](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35850763500)
  passed after staging publication.

## Full success path

Production-target [sandbox ticket #46](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/46)
was submitted through the verified intake
[35851137527](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/35851137527)
by `simo6529`. It named only backend [PR #141](https://github.com/6529-Collections/release-coordinator-test-backend/pull/141)
at `67566a64093b2ffea344cdfb28ad379f28f7f2d0` and frontend
[PR #129](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/129)
at `f7f59228766a4d27570432ba31e419170a927ab8`, declared no database
change, and selected the sample backend units plus monitoring. Both source PRs
passed `Sandbox check`.

The guarded run `3f21b531-70c8-43db-b8ca-04764de4e1c9` used
`RELEASE_COORDINATOR_PROFILE=sandbox`, `RELEASE_COORDINATOR_SCOPE=filtered`,
Issue 46, actor `simo6529`, and the product-workflow adapter. Exact combined
trial checks and the service check
[35852258662](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35852258662)
passed; the temporary database cleanup was verified. The two owned trial PRs
were closed and their branches removed.

All 16 planned release operations passed, in the corrected order:

1. Backend staging integration [#143](https://github.com/6529-Collections/release-coordinator-test-backend/pull/143)
   merged at `9a5b9a2f67867694d37b5e0a907655284e109737`.
   [Staging monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35853129853)
   ran on `1a-staging` at that exact commit **before** any staging application
   deploy. All three backend deploys passed.
2. Frontend staging integration [#131](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/131),
   [deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35854075339)
   and matching [E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35854211692)
   passed before any production merge.
3. Backend production integration [#144](https://github.com/6529-Collections/release-coordinator-test-backend/pull/144)
   merged at `9322d1d35fb30698153f781168dc716e489814c0`.
   [Production monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35854757315)
   ran on `main` at that exact commit **before** production application deploys.
   All three backend deploys passed.
4. Frontend production integration [#132](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/132),
   [deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35855848182)
   and matching [E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35855977312)
   passed. Ticket #46 closed `status:completed` / `reason:release-completed`;
   the run released its journal lock.

The sample workflows exercise the shared order and evidence contract, but this
is not proof that the real frontend/backend workflows deploy correctly or that
the AWS monitoring target is healthy.

## Staging monitoring failure and recovery

Production-target [sandbox ticket #47](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/47)
selected backend [PR #145](https://github.com/6529-Collections/release-coordinator-test-backend/pull/145)
at `234d58cff55b8b5b04ba3bf409643047d8d5bf09` and frontend
[PR #133](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/133)
at `5d1b2f9e3e1c360db7528d443138eabda550aa20`. The backend fixture set
sample `fail_environment` to `staging`; both PRs passed `Sandbox check` and
CodeRabbit without inline findings. The guarded run
`6d19795a-28ff-4038-9270-94f508f79faf` used only Issue 47 and verified
actor `simo6529`. Exact trial PR checks and the temporary-database service
[run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35857925458)
passed, and the owned trials were cleaned up.

Backend staging integration [#147](https://github.com/6529-Collections/release-coordinator-test-backend/pull/147)
merged at `1181d0b34b340ae8e764e130d4c28edd3dc74db8`.
The intended [staging monitoring run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35858999837)
reported failure on `1a-staging` at that exact commit. No staging application
deploy, frontend integration, or production merge followed the failure.

The Coordinator restored backend staging through protected
[PR #148](https://github.com/6529-Collections/release-coordinator-test-backend/pull/148)
at `2a6e8d9de3cbbafd8cf740e420f36a78e4bdc120`. Restored
[staging monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35859604888)
passed on `1a-staging` at that exact undo commit. The ordinary restored backend
database/worker/API deploys, existing frontend staging deploy, and matching
[staging E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35860550912)
all passed. Independent GitHub tree readback found backend staging's final tree
`1af0a12293555ea29bdc1f9f0de17883cf12b525`, exactly its saved pre-test
tree. Backend `main` stayed `9322d1d35fb30698153f781168dc716e489814c0`;
frontend `main` and staging stayed `87b02868c133bf41aa6ee97d20db46520e5658ec`
and `179a06af5bc38744d9dd8d25e9714f34a45486b8`.

The run released its journal lock and intentionally exited nonzero. Ticket #47
remains open `status:action-needed` / `reason:release-failed`, preserving the
original failed attempt rather than relabeling the candidate successful. No
database rollback occurred; the request declared no database change.

## Production monitoring failure and recovery

Production-target [sandbox ticket #48](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/48)
selected backend [PR #149](https://github.com/6529-Collections/release-coordinator-test-backend/pull/149)
at `6627485b1bedd80402e79f71e33fd3a34f8a6961` and frontend
[PR #135](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/135)
at `2f2439b657c87de557c4dfd940ccd382996b0b5b`. The backend fixture set
sample `fail_environment` to `prod`; both source PRs passed `Sandbox check`.
The guarded run `f58c5a8f-9827-48e4-a011-b8ca9b7c66be` used only Issue 48
and verified actor `simo6529`. Exact trial PR checks and the temporary-database
service [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35862567247)
passed, and the owned trials were cleaned up.

Backend staging integration [#151](https://github.com/6529-Collections/release-coordinator-test-backend/pull/151)
merged at `ed2a4121f5eee5c19d654c13859a32f2a887ba68`. Staging
[monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35863496972)
passed on `1a-staging` at that exact commit, followed by all three staging
backend deploys. Frontend staging integration
[#137](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/137)
merged at `f72db9184972a88e5fe72122a6c180d7d9f3e5d1`; its
[deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35864605453)
and matching [E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35864726211)
passed before the production merge.

Backend production integration
[#152](https://github.com/6529-Collections/release-coordinator-test-backend/pull/152)
merged at `bd22c66f279092d23ee723f7c758187b46f49f46`. The intended
[production monitoring run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35865499876)
reported failure on `main` at that exact commit. No production backend service
or candidate frontend deployment started afterward.

The Coordinator restored backend production first through protected
[PR #153](https://github.com/6529-Collections/release-coordinator-test-backend/pull/153)
at `e5bf523d1657043d8c1188cd468233ad1b1ad84a`. Restored
[production monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35866107143)
passed on `main` at that exact undo commit. All three restored production backend
deploys, the saved frontend production deploy and matching
[production E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35867217785)
passed. Only then did the Coordinator restore backend staging through
[PR #154](https://github.com/6529-Collections/release-coordinator-test-backend/pull/154)
at `20927200304fc1259da45990f96c225f848ca7bd` and frontend staging through
[PR #138](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/138)
at `d4e35c7c5e804b75a6bcabb5a3f810c1e8245c8a`. Restored
[staging monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35868455873)
passed on `1a-staging` at the exact backend undo commit, followed by ordered
backend/frontend deploys and matching
[staging E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35868384094).

The first production-failure run exposed an evidence gap despite those green
results: the restored frontend's automatic staging
[deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35868249819)
and E2E started before the restored backend API
[deploy](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35869161887)
finished. The Coordinator recorded the E2E after the backend step, but its
workflow had run earlier, so it could not prove the final restored combination.
PR #219 now makes frontend recovery dispatch a fresh staging deployment after
backend recovery and rejects E2E when its frontend deployment predates the
matching backend deployment. This first run alone is not sufficient recovery
proof; the fresh ticket below accepts that correction.

Independent GitHub tree readback matched every pre-test branch tree:

| Branch                | Before tree                                | Final tree                |
| --------------------- | ------------------------------------------ | ------------------------- |
| Backend `main`        | `2f5e2b0813e7e07f9b6446bd4c7628fd78465937` | same                      |
| Backend `1a-staging`  | `1af0a12293555ea29bdc1f9f0de17883cf12b525` | same                      |
| Frontend `main`       | `dadc7b65377cb8ff6907b9a9a85061d1adc58154` | same; its ref never moved |
| Frontend `1a-staging` | `440a3f1633d84046ce411ea6a1159767d4080348` | same                      |

The run released its journal lock and intentionally exited nonzero. Ticket #48
remains open `status:action-needed` / `reason:release-failed`, preserving the
original failed attempt. No database rollback occurred; the request declared no
database change.

## Production recovery causal-time retest

Fresh [sandbox ticket #49](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/49)
was accepted through [intake 35872065400](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/35872065400).
It named only backend [PR #155](https://github.com/6529-Collections/release-coordinator-test-backend/pull/155)
at `7a5cbde99638ec287eab64c4f6cb32d22c502577` and frontend
[PR #139](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/139)
at `239605d1350260da75abb8ff439434d900962b22`, both with passing `Sandbox
check` and CodeRabbit status. The verified actor was `simo6529`; the filtered
run `93f239fb-ae90-42a6-ae7a-aae6ff408ae3` could see only Issue 49. It
reused the same journal after two safe evidence-read stops, without creating
replacement trial or service runs. Exact combined trials [backend #156](https://github.com/6529-Collections/release-coordinator-test-backend/pull/156)
and [frontend #140](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/140)
and the [service/database check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35873924078)
passed; owned trials were closed and their branches removed.

Staging backend [#157](https://github.com/6529-Collections/release-coordinator-test-backend/pull/157)
merged at `b672de7beb456a27bceb7c874363695248d9a7a3`. Its
[monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35875612879)
ran from `1a-staging` before all three backend deploys. Frontend staging
[#141](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/141)
merged at `a1a77a4d4ea59f9a8b824ded8d4a5ad82a0c3a29`; its
[deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35877585100)
and linked [E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35877712107)
passed before production integration. Backend production
[#158](https://github.com/6529-Collections/release-coordinator-test-backend/pull/158)
merged at `fbafdacb37674a5a391049b8878fdbdc2839de0a`. The intended
[production monitoring run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35878454712)
failed on `main` at that exact commit, before any candidate production app
deploy. GitHub reported the run terminal several minutes before its job record
became terminal. The adapter waited on that same job identity instead of
dispatching again or claiming unverified failure.

Protected backend production undo
[#159](https://github.com/6529-Collections/release-coordinator-test-backend/pull/159)
merged at `b6237ab17556ef8c24121518d61b95abc6323454`; restored
[monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35879866751),
all three backend deploys, saved frontend
[deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35880854057)
and linked [E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35881080385)
passed. Only then did backend staging undo
[#160](https://github.com/6529-Collections/release-coordinator-test-backend/pull/160)
merge at `d0e738dd5a43ff446f071ff68b4bf0506650f2d5` and frontend staging
undo [#142](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/142)
merge at `6cfe5ed9d7ec004d7dbeb8d9d4a46ffcfff7f79a`. Restored staging
[monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35882289574)
and all three backend deploys passed.

The frontend undo merge automatically started [push deploy 35882085629](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35882085629)
at **15:30:39 UTC** and its [E2E 35882223434](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35882223434)
at 15:31:47. The restored backend API [run 35883035034](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35883035034)
completed only at **15:39:19**. The Coordinator did **not** adopt that early
frontend run. It dispatched a fresh [frontend staging deploy 35883314825](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35883314825)
at **15:40:43**, then accepted only the linked
[E2E 35883476668](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35883476668).
Both passed. This time order proves the restored backend/frontend combination
under the sample workflow contract.

Independent GitHub readback found the same four final trees as the saved
pre-test trees in the table above. The run released its journal lock and
intentionally exited nonzero; Issue 49 remains open `status:action-needed` /
`reason:release-failed`. The failed attempt was not relabeled successful. No
database rollback occurred; the request declared no database change.

Together these sandbox runs accept the corrected sample success, staging
failure/recovery, and production failure/recovery paths, including final E2E
causality. They do not prove a real-product deployment or independent AWS
monitoring health.

## Direct dispatch-ID API probe

After the full release runs, an isolated test-backend monitoring dispatch on
`1a-staging` requested `return_run_details: true` with GitHub REST API version
`2022-11-28`. GitHub returned HTTP 200 with exact
[run ID 35885612602](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35885612602).
The run then passed as a `workflow_dispatch` on `1a-staging` at restored commit
`d0e738dd5a43ff446f071ff68b4bf0506650f2d5`. This independently verifies
the opt-in response and sample workflow identity. The Coordinator's new
persist-and-verify path has offline tests, but this direct API probe is not a
new full Coordinator release or real-product acceptance.
