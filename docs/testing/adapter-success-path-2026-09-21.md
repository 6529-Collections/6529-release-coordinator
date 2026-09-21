# Product-workflow adapter success path — September 21, 2026

This acceptance used only the Coordinator test inbox and the test frontend and
backend repositories. It did not read, merge, deploy, or hold credentials for a
real product repository or AWS environment. The Coordinator source was still an
unmerged local branch during the run; source delivery is separate evidence.

## Request and result

Production-target [ticket #36](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/36)
pinned backend [PR #104](https://github.com/6529-Collections/release-coordinator-test-backend/pull/104)
at `80b13735b1313e605b15a433df8c008d86ccf9ce` and frontend
[PR #94](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/94)
at `52d6ecd579c07463cf672b13308af919216d4616`. It selected the
`dbMigrationsLoop`, `worker`, and `api` deployment units plus operational
monitoring, with no database change.

Coordinator run `7f49f7e2-c0b1-4f32-b164-3182d16d0a1f` created release
`54531080-4648-4b6e-a3b9-c6b4e3173610`. The exact combined candidate and
[service checks](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35621521587)
passed. The separate-workflow adapter then completed every required staging and
production operation:

| Stage | Protected integration | Product-shaped workflow evidence |
| --- | --- | --- |
| Staging backend | [backend PR #106](https://github.com/6529-Collections/release-coordinator-test-backend/pull/106) | [dbMigrationsLoop](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35622994601), [worker](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35624929972), [api](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35625234540) |
| Staging frontend | [frontend PR #96](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/96) | [frontend deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35625825572), [matching E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35625946027) |
| Production backend | [backend PR #107](https://github.com/6529-Collections/release-coordinator-test-backend/pull/107) | [staging monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35627451973), [production monitoring](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35628454349), [dbMigrationsLoop](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35628708742), [worker](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35628965741), [api](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35629994443) |
| Production frontend | [frontend PR #97](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/97) | [frontend deploy](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35630732770), [matching E2E](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35630864794) |

The adapter dispatched ordinary staging services from `1a-staging`. It
dispatched both monitoring targets from backend `main` after the production
backend merge and before application deployments. It mapped the Coordinator's
`worker` unit to the mirrored product workflow input
`transactionsProcessingLoop`. Frontend E2E was accepted only from the automatic
run linked to the exact frontend deployment run.

Ticket #36 closed with `status:completed` and `reason:release-completed`. Its
single status comment lists all integration PRs and workflow runs. The journal
lock was released.

## Findings resolved during acceptance

The live run exposed three adapter boundary mistakes before the final accepted
sequence: the backend workflow's concrete worker input was not mapped, the
automatic E2E runner was incorrectly expected to have the human dispatch actor,
and a fresh manual operation could discover an older matching run. The adapter
now maps the service name, verifies the wrapper and automatic actors separately,
and requires a manual workflow run to be created no earlier than its saved
operation. Focused regressions cover all three cases.

This record proves the sandbox adapter against the product-shaped mirrors. It
does not prove that the real products were deployed or authorize a real release.
