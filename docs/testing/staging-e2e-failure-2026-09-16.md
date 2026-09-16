# Sandbox staging E2E failure acceptance — September 16, 2026

This live run tested the failure gate in the three Coordinator test repositories.
It used no real frontend/backend repository, product environment, database or
deployment. It ran from Coordinator `main` after
[PR #157](https://github.com/6529-Collections/6529-release-coordinator/pull/157)
merged at `a0bc8489659bd67f28f627a03f98f6db4bbc86a7`.

## Controlled input

Production-target sandbox [ticket #22](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/22)
requested backend [source PR #51](https://github.com/6529-Collections/release-coordinator-test-backend/pull/51)
at `32ae6e3feb434dedd6bf36e73302377713cdc048` and frontend
[source PR #48](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/48)
at `c8d043b58b57eb703b4587d83ba9f7b779f28bd1`. Both normal source
`Sandbox check` jobs passed. The backend change was a companion document. The
frontend rendered the expected value during source and built smoke checks, but
returned a different value when the built HTTP frontend received the backend's
payload. Local source checks and builds confirmed this distinction before
submission. The request declared no release-specific database change.

Coordinator run `0e1ce7d0-6e7e-4869-b865-f65d0c918ea1` selected ticket #22
after cheap filtering and combined Git rehearsal. Temporary backend
[trial PR #52](https://github.com/6529-Collections/release-coordinator-test-backend/pull/52)
and frontend [trial PR #49](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/49)
passed their normal required checks. The [combined service run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35065483988)
passed database loop, worker, API, frontend and temporary database cleanup.
Both trial PRs closed unmerged and their owned branches returned 404.

## Staging result and production gate

Release `87ea2769-bf4b-4a2d-a2e7-73d93ec8ccf8` merged the backend into
protected test staging through [PR #53](https://github.com/6529-Collections/release-coordinator-test-backend/pull/53),
then passed the ordered [database loop](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35066615711),
[worker](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35066831790)
and [API](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35066972849)
build/check workflows. Frontend protected staging
[PR #50](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/50)
merged and its [built smoke check](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35067467932)
passed. Each protected PR's required `Sandbox check` passed before merge.

The matching [staging E2E workflow](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35067575483)
built both exact staging commits and uploaded both artifacts successfully, then
failed only `matching-built-version-e2e`: the rendered result differed from
`Value: 20`. The saved operation bound this failure to backend
`6076ca8e09ec65d2c844c2e54f9b249b2068f1e9` and frontend
`24a31a9c294a1d68272dbeab4a5f44e4394b6653`. No production operation
was recorded or dispatched. Test backend `main` remained
`a7bb4e760b57f2f69a47a2602af28c46abcfb516`, and frontend `main`
remained `7422ec6be8aaf385f23b487c58e4a61a354ef113`.

The Coordinator finished with expected exit code `1`. Ticket #22 stayed open
with `status:action-needed` and `reason:release-failed`; its managed comment
names `staging:e2e` and links the seven attempted staging operations. The saved
release is `needs-human`, not completed. The sandbox journal lock became `null`.
Both staging integration branches returned 404 after their protected PR merges.
The original source PRs remained open and unchanged.

## Manual restoration of test staging

This version does not automatically roll back a failed release. To leave the
test repositories ready for another case, we manually reverted only the two
controlled staging merges through protected backend
[PR #54](https://github.com/6529-Collections/release-coordinator-test-backend/pull/54)
and frontend [PR #51](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/51).
Local sample checks and both required GitHub `Sandbox check` jobs passed before
these PRs merged. Final GitHub comparison found no file differences between
`main` and `1a-staging` in either test repository; the histories retain the
failed attempt and its restoration. Test `main` remained unchanged throughout.
The ticket and journal preserve the failed release; manual restoration does not
rewrite it as a success or demonstrate automatic rollback.
