# Shared inbox profile acceptance — September 9, 2026

The sandbox ticket completed submission, verified receipt, retry, explicit inbox
processing, and two passing local merge rehearsals. This is one request containing
three sample PRs. It is not multi-ticket batching or a release.

## Revisions and fixture configuration

- Coordinator runtime: `5cab79f129899d4637cc32103cb167b2f77daac5`, clean tracked
  source for both rehearsals. Base main: `c9ff50230caba774b6c7c486b49a9af4f0ef00d7`.
- [Test inbox](https://github.com/6529-Collections/release-coordinator-test-inbox),
  public, ID `1362580376`; wrapper main `02a9c4c1bfb7e2e0f6de7500f4164af7289c7f1c`.
  The wrapper checks out the exact Coordinator runtime above and calls the shared
  intake module. It holds no copied intake code.
- Inbox main requires PRs, resolved conversations, and zero approvals, including
  for admins; force pushes and deletion are disabled. Source CI belongs to the
  Coordinator PR, not the wrapper repository.
- Existing public frontend/backend fixtures retain their IDs and enforced
  `Sandbox check`, documented in the [previous matrix](./merge-rehearsal-public-2026-09-09.md).

## Request and receipt

[Test ticket #1](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/1)
was created by [successful intake run 34347245930](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/34347245930),
attempt 1, from wrapper main above.

- Request: `2fd02bc0-07ca-46c1-8e2f-0951de1853e9`.
- Checksum: `52aa63243314fdaf8cf064da9734039fa6d90e63b8875c6b5857071940ad0111`.
- Verified submitting actor: `simo6529`, numeric ID `209783236`.
- Target: staging; database change: no. Frontend depends on backend.
- Backend services: `dbMigrationsLoop`, then `api-v2`, verified against the saved
  backend commit's service catalog. Frontend follows both services.

| Repository role | Requested PR / branch | Exact requested commit | Explicit destination main |
| --- | --- | --- | --- |
| Backend | [#1](https://github.com/6529-Collections/release-coordinator-test-backend/pull/1), `codex/rehearsal-catalog-a` | `dd694fa34ce8de67d3c0e1fe4dee5283ca4d8e81` | `33dc26417355f53b8ba94f1d20c9bd9e3779edaa` |
| Frontend, first | [#1](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/1), `codex/rehearsal-clean-a` | `4644b404492ca298fb6d6156d30986d80c2784c7` | `5e5d27c5bfee263259e15eb9dee0ad0ea89c0e53` |
| Frontend, second | [#2](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/2), `codex/rehearsal-clean-b` | `6e904ef637ce268f2553fb3f8cc761aa64d8201a` | Same frontend destination |

Retrying the identical JSON returned `reused: true`, the same ticket, checksum,
actor, and workflow. The independent after snapshot found one sample ticket,
one intake workflow run, and one status comment.

## Results and isolation

| Step | Observed result |
| --- | --- |
| Inbox verification | Request JSON, checksum, selected inbox, actor, successful workflow/job/step/log marker all verified. |
| Readiness | All three PRs and the service/dependency graph passed their checks. Overall `unknown` (exit 1): readiness does not consume the separate rehearsal report or have verified release-outcome history. |
| First rehearsal | `pass`, exit 0; run `f4b0fc6e-2b9c-4754-9c34-8bed2b0933ab`. |
| Explicit processing | Exit 0; run `cad8c671-fe3f-45b9-b96e-2a09a0bf787f`; `waiting`, `coordinator-incomplete`, applied and verified. |
| Rehearsal after processing | `pass`, exit 0; run `357409c2-4a7d-4088-8bc9-d18eec965ff2`. Same receipt binding and result trees. |
| Sample source repositories | All branches and all 12 PR head/base/state/title/body observations matched the before snapshot. No sample PR was merged. |
| Real inbox/state | All 13 release-request Issue observations matched before/after. Real journal stayed `5d136b76469154083ff79fbeb19478950efec34f`. |

Both rehearsals verified final inbox and repository observations and removed
their temporary Git workspaces. They retained `release_authorized: false`.
Backend result tree: `be6681e603484a8cd38f4d25ba29d184aa94cfca`.
Frontend result tree: `7bc4bafd351a4c095afac863eb8286717de2f5bc`.

The processor wrote only the test inbox's `codex/inbox-state` branch, ending at
`eb57705fd2c65f7c16aa262d8be6dbf9758b4f9e`. Transition:
`ad044ba9-1fef-4662-a8df-12af29b7a76b`. The original status comment
`5601315765` was updated in place. Intake initially reported unavailable
assignment; the explicit processor subsequently assigned the verified submitter.
The ticket remains open with target/component labels and a clear waiting reason.
The isolation snapshot was captured at `2026-09-09T11:53:59.262Z`.

## Local tests, review, and CI

Initial full suite: 232 passing tests, including 16 new profile tests. Review
added three tests (19 focused profile tests passing): both profiles reject a
non-JSON HTTP 503 from GitHub without an accepted receipt, and the CLI surfaces
a result-record write failure with the prepared record path. A missing dependency
also proves the existing graph check returns `invalid_inbox_plan` before lookup.
The full local suite then passed all **235 tests** (26 public-package and 209
Coordinator). Review also corrected misleading invalid-profile error text in
the readiness CLI and stale descriptions of the implemented profile adapter.
The public package source/bin/schema remain unchanged; the dry pack has nine files.

The [initial required CI run](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34347334610)
passed at `5cab79f`. [PR #30](https://github.com/6529-Collections/6529-release-coordinator/pull/30)
records final-head CI and merge state separately. Automated security review
reported no findings within its stated partial context; this is not a claim
that every security property or production condition was exercised.

Raw local evidence is under `.release-coordinator/profiled-inbox-20260909/`
(`before.json`, `after.json`, request/plan, submission/retry, readiness, processing,
and two rehearsal reports). Canonical per-run reports live under
`.release-coordinator/merge-rehearsal/sandbox/<run-id>/`. Setup evidence is
`.release-coordinator/profile-inbox-setup.json`. These local artifacts are ignored;
the durable identities and results are recorded above.

Both named profiles use the same implementation. Only sandbox has live proof
for this new complete path. Real permissions, repository limits, and the first
real rehearsal need separate live acceptance. Test records cannot be reused as
real evidence. Rehearsal-to-ticket policy, multi-ticket batching, application
builds/tests, release ownership, scheduling, and deployments remain later work.
No npm version was published and no product deployment occurred.
