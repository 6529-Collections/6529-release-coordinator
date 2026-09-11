# Sandbox release sequence acceptance — September 11, 2026

This record proves the Coordinator's sandbox-only release sequence. The run used
the local `codex/sandbox-release-sequence` source, the three public test
repositories, and fake application data. It did not read or change the real
frontend/backend repositories, staging environments, production environments,
credentials, or deployments.

## Fixed test runtime

The generated runtime was reviewed and merged through normal test-repository PRs:

- [Backend runtime PR #23](https://github.com/6529-Collections/release-coordinator-test-backend/pull/23), merge commit `8ba13bfbe65c36ed86b7f313160e1b1036e04b85`.
- [Frontend runtime PR #21](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/21), merge commit `733d28f9fbe439b68b40b9b83299961b82ea9e78`.
- Both repositories contain the same pinned `sandbox-release.yml` blob, `da76eeee97f41430595b49e288e9909bb6596e31`.
- Both `1a-staging` branches require `Sandbox check`, enforce the rule for administrators, require resolved conversations, and disallow force-pushes and deletion.
- The normal check workflow blob is pinned as `bb736a236bc1d14d2f8ea35ce40953686e91169f`.

The release workflow has read-only repository permission, no secrets, no product
credentials, and a ten-minute job timeout. Only fixed test repositories and exact
saved commits can be checked out. Candidate patches are limited by the existing
sandbox batch allowlist, so they cannot replace the pinned runner. The Coordinator
also verifies the workflow, actor, operation ID/hash, repository/run/attempt, and
exact backend/frontend commits. This is sufficient for a public sandbox fixture;
it is not the trust model for real deployment adapters.

## Request and batch

The accepted production-target test request was
[inbox ticket #15](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/15),
request `a47677de-5ae8-4a09-9531-a85cbe6d3332`:

- [Backend source PR #24](https://github.com/6529-Collections/release-coordinator-test-backend/pull/24), commit `1801ee1b1cf7745815ab656155f44da2483d1f24`.
- [Frontend source PR #22](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/22), commit `03d9fbb0c1f168def3de144984b6a7ee2d6d06db`.
- Database declaration: `no`.
- Backend order: `dbMigrationsLoop`, `worker`, `api`; frontend follows backend.

Cheap ticket filtering left old unsupported ticket #1 waiting and selected only
ticket #15. Batch `1811f082c9bf185d42a73cd9c0bbfcdc7b57372b0fe72c6b60882847458d2f99`
passed exact Git preparation, backend/frontend temporary PR checks, the combined
service workflow, and verified cleanup. The temporary trial PRs were backend
[#25](https://github.com/6529-Collections/release-coordinator-test-backend/pull/25)
and frontend
[#23](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/23);
both are closed and both owned branches were removed.

## Release result

Run `28f4752a-987a-411d-af32-bbd498555958` created release
`ee87762c-6b27-4a3c-860b-94367709b2b2`. All 14 ordered operations passed:

| Order | Operation | Verified evidence |
| ---: | --- | --- |
| 1 | Backend into test staging | [PR #26](https://github.com/6529-Collections/release-coordinator-test-backend/pull/26), merge `b9777ea2cc6d6c0a5ea86b3945502d4aa60a9724` |
| 2 | Staging database-loop check | [run 34610976921](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34610976921) |
| 3 | Staging worker check | [run 34611093548](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34611093548) |
| 4 | Staging API check | [run 34611210126](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34611210126) |
| 5 | Frontend into test staging | [PR #24](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/24), merge `8a4a2da9598e4af1934f5e78bc2d398394f2c35b` |
| 6 | Staging frontend check | [run 34611544560](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34611544560) |
| 7 | Matching staging E2E | [run 34611650172](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34611650172) |
| 8 | Backend into test production | [PR #27](https://github.com/6529-Collections/release-coordinator-test-backend/pull/27), merge `cb865e53e1a881ec4fea01dc0e4c0c051584b444` |
| 9 | Production database-loop check | [run 34611969936](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34611969936) |
| 10 | Production worker check | [run 34612083441](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34612083441) |
| 11 | Production API check | [run 34612181943](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34612181943) |
| 12 | Frontend into test production | [PR #25](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/25), merge `c963f71c7ec186505326cd3380b824977678572b` |
| 13 | Production frontend check | [run 34612511695](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34612511695) |
| 14 | Matching production E2E | [run 34612621796](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34612621796) |

The final test refs equal those merge commits. Every owned `codex/release-...`
branch was removed. Ticket #15 has `status:completed`, `batch:passed`,
`rehearsal:passed`, and `reason:release-completed`; its single managed comment
lists every operation. The release batch is archived under the v6 journal,
ticket history points to its final decision, and the inbox lock is `null`.

## Fail-closed recovery exercised during acceptance

The first attempt stopped before creating temporary PRs because test-repository
setup had changed the required check workflow while the Coordinator still pinned
its prior blob. Inspection showed only the intended staging trigger and step-name
changes. The pin was updated and the empty attempt was closed with an explicit
runtime reason before a fresh batch began.

The release run later stopped after GitHub saved the first integration-step
journal commit but an immediate read did not confirm it. The saved commit and
state matched exactly; staging had not changed. Journal writes now retry bounded
read-only confirmation and accept only the exact expected commit/state, including
when the update response itself is lost. A focused delayed-read test and a
lost-response test pass.

After all release operations passed, the first presentation resume exposed a
missing batch summary on a ticket that had not received its pre-release projection.
The completed release stayed saved and no operation reran. The projection now
derives its batch fingerprint, status, code and message from the saved release;
a focused resume test passes. The next resume closed ticket #15 and released the
lock without recreating release work.

A post-run code review found one additional narrow guard: fake staging could move
after the release captured its starting versions but before it created the first
integration branch. The adapter now compares the current environment with that
saved version before any branch or PR write. A focused offline test proves that
movement stops with zero writes. The live success run had stable starting refs;
it did not exercise this new failure case.

## Boundary and next step

This proves ordering, protected test merges, exact-version workflow evidence,
staging-before-production gating, explicit resume, ticket closeout, and journal
history in the sandbox. Real adapters and automatic rollback remain unimplemented.
The next code stage is to call the existing product release workflows through
similarly narrow, pinned adapters after this source is reviewed and merged.
