# Automatic sandbox fake-production restoration — September 16, 2026

This controlled run used only the Coordinator's three test repositories. It
started from the current local `main` checkout with uncommitted implementation;
it did not use real product repositories, environments, or deployment
credentials. Source delivery is separate from this acceptance result.

## Intentional production failure

Production-target [ticket #27](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/27)
contained no database change and pinned backend [source PR #71](https://github.com/6529-Collections/release-coordinator-test-backend/pull/71)
at `a723d9e72c565906ed18af55247c1b4067de7688` and frontend
[source PR #66](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/66)
at `b5e5da06195d99c74fe94d2d5413d19fe5bc0e40`. Both source checks passed.
The frontend fixture returned the wrong value only for the pinned fake-production
E2E operation; its source check, combined service check, staging checks and
production builds could still pass.

Coordinator run `cc0e7173-1bfc-4161-8cb9-db0db6989109` selected #27 alone.
Its combined PR and [service checks](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35104363537)
passed. Protected staging integrations and ordered builds passed, followed by
[matching staging E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35106239211).
Protected fake-production integrations and ordered builds then passed. The
[matching production E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35107859802)
failed as designed. The saved batch fingerprint was
`4ccf58ad540aa47cb56a5edaa7e987d12189522fe4c9426d52ce9116619c1b60`.

## Automatic restoration and final state

The Coordinator restored the two changed test `main` roles first through
protected backend [PR #75](https://github.com/6529-Collections/release-coordinator-test-backend/pull/75)
and frontend [PR #70](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/70).
Both merged after required checks. Ordered backend and frontend builds and
[matching production E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35109390352)
passed on the restored pair. It then restored test `1a-staging` through
protected backend [PR #76](https://github.com/6529-Collections/release-coordinator-test-backend/pull/76)
and frontend [PR #71](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/71).
Their ordered builds and [matching staging E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35110904354)
passed.

Independent GitHub readback found the final branches at these commits. Each
file tree matches its own saved pre-release baseline, even though the restore
commits are new commits:

| Test branch | Final commit | Final and baseline tree |
| --- | --- | --- |
| Backend `main` | `39a8d7afdff4b2e3e27dd86e374f815a9be1191b` | `c868b39c9850e45836dbf9595bf36e378af3b98a` |
| Frontend `main` | `5b99ea84fc297bcf3d5f1b17a45738bb1f10aaff` | `248295a6d6959e3f195c63a89baf3863ce348bb3` |
| Backend `1a-staging` | `55ca6220dcc6cc35dd8281a02b520d06dd303a5d` | `c868b39c9850e45836dbf9595bf36e378af3b98a` |
| Frontend `1a-staging` | `0a4b885774a097d2ffebb52c9bf955174a45e0b9` | `248295a6d6959e3f195c63a89baf3863ce348bb3` |

The original release remains `needs-human`; restoration does not make the
requested code pass. [Ticket #27](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/27)
remains open with `status:action-needed`, `reason:release-failed`, the failed
step `prod:e2e`, and a readable explanation of completed restoration. The
journal lock is clear. The command exits `2` because action-needed tickets
remain, not because restoration is still running.

## Journal read and resume finding

After restoration, ticket projection initially stopped with “Inbox state file
is invalid.” The journal had grown beyond 1 MiB. GitHub's Contents API returned
its metadata with `encoding: none` and empty inline `content`; the saved Git
blob itself was valid. The local reader now fetches that exact blob by its
reported SHA and verifies its identity and byte count before parsing it. The
same fallback covers archive reads. Focused regressions cover successful reads
and mismatched blob identity.

After the old process exited, resuming the *same locked run* applied the saved
ticket decision without repeating the release or restoration and released the
lock. The complete local `npm run check` passed: 530 tests ran, 527 passed,
3 were intentionally skipped; lint, format, workflow policy and package checks
also passed. The large-file reader fix and restoration implementation are still
uncommitted local source, so this run is sandbox acceptance, not merged-source
or real-product release proof.
