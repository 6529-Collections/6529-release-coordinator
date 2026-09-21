# Product-workflow adapter recovery — September 21, 2026

This controlled failure used only the Coordinator test inbox and test frontend
and backend repositories. No real product repository, AWS target, credential,
or database was used. The Coordinator source was an unmerged local branch during
the run; source delivery is separate evidence.

## Intentional failure

Production-target [ticket #37](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/37)
pinned backend [PR #108](https://github.com/6529-Collections/release-coordinator-test-backend/pull/108)
at `614429c33769f30ce33bbfe2410cd993efd14e64` and frontend
[PR #98](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/98)
at `0ea6488734a2b05d053878344a3ccbc25c61397f`. The backend fixture
asked the sample monitoring deploy to fail for the staging monitoring target.
The request declared no database change and selected the three backend services,
frontend, and operational monitoring.

Coordinator run `984c5ad5-0f8b-4da1-9c6f-ace3855bda45` created release
`405015a1-265a-47e2-8c15-61776fa4004b`. Exact combined PR and service checks
passed. Protected staging integrations [backend #110](https://github.com/6529-Collections/release-coordinator-test-backend/pull/110)
and [frontend #100](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/100),
all four staging deploys, and [matching staging E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35636922529)
passed. The backend then reached test `main` through [PR #111](https://github.com/6529-Collections/release-coordinator-test-backend/pull/111).

The first production monitoring operation
[failed as designed](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35637839041).
No production backend service or candidate frontend deployment started after
that failure.

## Automatic recovery

The Coordinator restored the saved backend production tree through protected
[PR #112](https://github.com/6529-Collections/release-coordinator-test-backend/pull/112).
It then proved the restored production pair with both
[monitoring staging](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35638518470)
and [monitoring production](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35638742063),
the three ordered backend service deploys
([database](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35638985567),
[worker](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35639296060),
[API](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35639565713)),
the [saved frontend deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35639822097),
and [matching production E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35640022052).

Staging was restored next through protected backend
[PR #113](https://github.com/6529-Collections/release-coordinator-test-backend/pull/113)
and frontend [PR #101](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/101).
The restored database, worker, API, and frontend deployments passed, followed by
[matching staging E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35641234776).
Monitoring recovery continued to dispatch from restored backend `main`; ordinary
staging services continued to dispatch from restored `1a-staging`. The offline
test `recovery keeps restored staging services on 1a-staging and restored staging
monitoring on main` in
[`product-workflow-recovery.test.mjs`](../../apps/coordinator/test/product-workflow-recovery.test.mjs)
enforces the same split.

Independent GitHub readback found the final branch trees equal in each test
repository:

| Test branch | Final commit | Final tree |
| --- | --- | --- |
| Backend `main` | `713a90360f9adb363dc7a74fcd9a5ec348171a2c` | `ef9f742664c2f973abbcbb7184548d6298c3b877` |
| Backend `1a-staging` | `e0091d475214506060a0c066660312f264b130f4` | `ef9f742664c2f973abbcbb7184548d6298c3b877` |
| Frontend `main` | `d776cedbedf2f59d7fca789c11870f9bb4f8ec1a` | `84adf0c038a4e1841aed4d9194181b6ef44e46a5` |
| Frontend `1a-staging` | `3769416dd749f70f1888d4dd1a56996f4b178ac5` | `84adf0c038a4e1841aed4d9194181b6ef44e46a5` |

There was no database rollback. The request explicitly declared no database
change, and recovery restored application trees and reran their normal workflow
checks only.

## Journal and ticket result

After recovery passed, one unrelated historical ticket presentation read hit a
GitHub transport error. The process stopped with the original run lock, as
designed. After the documented sixty-second settling period, explicit resume of
the same run reread the receipts, reused every completed operation without a
second dispatch, reconciled the ticket writes, and released the lock.
The offline test `an interrupted monitoring deployment resumes without
dispatching the finished one again` in
[`release-monitoring.test.mjs`](../../apps/coordinator/test/release-monitoring.test.mjs)
deterministically checks that idempotency rule.

Ticket #37 remains open with `status:action-needed` and
`reason:release-failed`. Its status comment identifies
`prod:monitoring:staging` as the failed step and lists every recovery result.
The final journal lock is clear. Exit `2` is expected because the failed release
and older sandbox tickets still need people; it does not mean recovery remained
unfinished.

This record proves sandbox failure containment, restoration, and resume against
the product-shaped mirrors. It does not implement or authorize real-product
rollback.
