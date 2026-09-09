# Public sandbox required-check acceptance — September 9, 2026

Run window: **2026-09-09T10:51:21.026Z to 2026-09-09T10:52:42.164Z**.
Coordinator revision: `f34d70a71ee5eb292bef33d0c9b5f17505d3f9c0`, clean tracked source throughout all 15 cases.

All **15 live cases met their expectations**: seven clean cases passed and eight deliberately invalid cases were blocked. This completes the bounded sandbox live matrix, including the previously unverified required-check gate. No release was authorized or executed.

## Setup and independent checks

The user authorized changing only the two sample repositories to public. GitHub readback at 10:49 UTC verified their existing numeric IDs and admin access. Both `main` and `rehearsal-target` in each repository now require `Sandbox check` from GitHub Actions (app ID `15368`), including for admins. All four branch rules require PRs and resolved conversations, prohibit force pushes and deletion, and require zero approving reviews. No account upgrade was purchased.

- [Frontend sandbox](https://github.com/6529-Collections/release-coordinator-test-frontend), ID `1362504370`.
- [Backend sandbox](https://github.com/6529-Collections/release-coordinator-test-backend), ID `1362505082`.

Exact fixture branches, requested/current commits, destination commits, and check-run links are unchanged from the [earlier private-run record](./merge-rehearsal-2026-09-09.md#exact-fixtures). Visibility and branch protections changed in the authorized setup, before this measurement window. Independent before/after reads around the rehearsal verified unchanged visibility, all four protections, branch commits, and PR head/base/state/title/body values.

The live runner now requires actual passing clean cases and a blocked required-check failure; it no longer accepts the initial account-plan fallback. It verifies branch protections before and after the matrix. Invalid/incomplete seeds are rejected before GitHub reads or evidence-directory creation.

## Results

Every row met its expected result. `blocked` is successful detection of the deliberately invalid case.

| Case | Overall result | Exit code | Named required check | Run ID |
| --- | --- | --- | --- | --- |
| MR-01 | pass | 0 | verified | 276c35c5-9148-4f28-bf36-e9128428fc32 |
| MR-02 | pass | 0 | verified | 5ba8117c-5af3-450f-a2f9-c382033ba6db |
| MR-03 | blocked | 1 | verified | 68ec6598-139d-40e2-9550-e4074a9df78d |
| MR-04-alone-a | pass | 0 | verified | b4abde71-4ed1-4a78-a6de-a4be4464edc1 |
| MR-04-alone-b | pass | 0 | verified | b8c31674-ef96-4fc7-b1a2-0d928e8a7c05 |
| MR-04 | blocked | 1 | verified | 86fca74c-2242-4f4c-b3fc-3672dbd2d481 |
| MR-05 | blocked | 1 | verified | 18c52385-1d71-48ef-ab42-afb40716c084 |
| MR-06 | pass | 0 | verified | 8918a7c4-3414-4e23-8dac-593d86912541 |
| MR-07 | blocked | 1 | verified | 356ce0dc-a6e8-465b-9848-e90b6f55f6ac |
| MR-11 | blocked | 1 | verified | 3371d2f0-df68-4b4d-9cb8-cf3e48000d40 |
| MR-13-draft | blocked | 1 | verified | 046b55dd-3efa-4e33-92b6-8b29715d4f85 |
| MR-13-closed | blocked | 1 | not-observable-for-input | 5bb9a791-060b-49b7-94b1-08f82f2b2a16 |
| MR-16 | pass | 0 | verified | 28715c44-f654-4455-a4d6-c7da007e9fb0 |
| MR-20 | pass | 0 | verified | 8b349ed3-764e-4343-b234-ba76f0a103fb |
| MR-08 | blocked | 1 | verified | 41280e0f-30ff-4cf5-985b-1244b4832827 |

MR-11 observed [frontend PR #5's deliberate CI failure](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338696346) with `isRequired: true`. The exact commits still merged cleanly into tree `096d7a36c7afbd08e3c6c047cf862ba50b1dfe2f`, but the required-check observation and overall result were blocked. This is the previously missing live proof.

MR-13-closed has no check run, so named-check evidence remains unobservable for that input; the PR is blocked as closed and no local merge is attempted. This is not an account limitation. Alternate-destination conflict cases do not claim that PR-base checks prove another destination's gates.

MR-01 and MR-20 produced the same decisions and frontend tree `52ad2d02c1896c65e245a438c8aada758e3ab265`. The compatible pair produced `7bc4bafd351a4c095afac863eb8286717de2f5bc`; the combined backend catalog produced `3feca0677aa664fb2764176de03487adf79593df`. These match the previous private-run trees. All created temporary Git workspaces were removed; inactive/outdated cases needed none.

## Local and CI evidence

All **216 existing automated tests passed locally** (26 public-package and 190 Coordinator), and the public package dry pack still contains exactly nine files. Three focused invalid-seed checks also passed: missing backend, missing outdated fixture, and malformed commit, with no GitHub access or evidence directory created. The normal follow-up PR records CI and merge evidence separately.

Raw local evidence:

- `.release-coordinator/live-rehearsal/2026-09-09T10-51-21-024Z/`: before/after snapshots, manifests, per-case results, summary.
- `.release-coordinator/sandbox-public-protection-20260909.json`: independent setup readback.
- `.release-coordinator/merge-rehearsal/sandbox/<run-id>/`: per-run JSON/text reports.

The earlier private-run record remains historical. Timing/network/failure injection and pending/review conditions retain their stated local coverage in the [matrix](../merge-rehearsal-testing.md#test-matrix). The real profile remains disabled. Product changes, real-inbox integration, combined application testing, scheduling, deployment, and ticket writes from rehearsal results remain outside this stage.
