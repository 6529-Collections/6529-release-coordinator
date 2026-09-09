# Sandbox merge rehearsal evidence — September 9, 2026

## Scope and result

Run window: **2026-09-09T10:15:49.011Z to 2026-09-09T10:16:55.875Z**.
Coordinator revision: `ee8fd94c2537e5e78bd1e351e4eed1c8c8207885`, clean tracked source throughout all 15 runs.

All 15 live cases met their local merge/input expectations. This is **partial live acceptance**: GitHub refused required branch checks on the private repositories under the current account plan. Clean Git merges therefore report `unknown`; demonstrated conflicts and inactive/outdated inputs report `blocked`. There is no live `pass` claim for complete gate verification.

GitHub returned HTTP 403 with: “Upgrade to GitHub Pro or make this repository public to enable this feature.” The repositories were kept private. The trusted sandbox profile requires GitHub to mark `Sandbox check` as required; optional successful or failed runs cannot replace enforcement.

Independent before/after reads confirmed the same repository identities, visibility, branch commits, and PR head/base/state/title/body values. No release, product-repository mutation, real-inbox write, or deployment occurred. All temporary Git directories created by these runs were removed.

## Exact fixtures

Both repositories belong to `6529-Collections`. Links require access while the repositories remain private. PR branches are retained for reproduction; PR #7 in the frontend was deliberately closed as an inactive-input fixture.

| Repository | ID | Main baseline | Alternative destination |
| --- | --- | --- | --- |
| [frontend](https://github.com/6529-Collections/release-coordinator-test-frontend) | 1362504370 | 5e5d27c5bfee263259e15eb9dee0ad0ea89c0e53 | 66df16a8ccce645db144a295cb14dcc85b35ccd0 |
| [backend](https://github.com/6529-Collections/release-coordinator-test-backend) | 1362505082 | 33dc26417355f53b8ba94f1d20c9bd9e3779edaa | 0e1d4be642a3e855963439cd5083cd768e338fda |

| Repository / scenario | PR | Requested commit | Sample CI |
| --- | --- | --- | --- |
| frontend / clean-a | [#1](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/1) | 4644b404492ca298fb6d6156d30986d80c2784c7 | [success](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338678321) |
| frontend / clean-b | [#2](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/2) | 6e904ef637ce268f2553fb3f8cc761aa64d8201a | [success](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338679916) |
| frontend / conflict-a | [#3](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/3) | ba2c2643afb614571f72505613e6f41fd094f309 | [success](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338685024) |
| frontend / conflict-b | [#4](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/4) | bc823999176d206710b3a04bfbae9b1277c29212 | [success](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338690158) |
| frontend / ci-failure | [#5](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/5) | dce8936d1e01c22bcb2f6dae10bbd8faf4c62767 | [failure](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338696346) |
| frontend / draft | [#6](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/6) | 51c5fd9c8e92a5b8c9f285f6a18da2f6d31c6caf | [success](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338703874) |
| frontend / closed | [#7](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/7) | 7245530e944e7f24920f13810cbfa8497d614146 | Not run / inactive fixture |
| frontend / outdated | [#8](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/8) | 1692baea0cb7e6a1c190618b7d07ddeb9eb264fd | [success](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34338714707) |
| backend / catalog-a | [#1](https://github.com/6529-Collections/release-coordinator-test-backend/pull/1) | dd694fa34ce8de67d3c0e1fe4dee5283ca4d8e81 | [success](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34338730913) |
| backend / catalog-b | [#2](https://github.com/6529-Collections/release-coordinator-test-backend/pull/2) | 95e2a835d6fe17bd8ccb161c80e5dbae3af3f6a0 | [success](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34338731502) |
| backend / conflict-a | [#3](https://github.com/6529-Collections/release-coordinator-test-backend/pull/3) | db37d03e2bdbc69923dac32688a39d2abcdcfebb | [success](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34338735948) |
| backend / conflict-b | [#4](https://github.com/6529-Collections/release-coordinator-test-backend/pull/4) | ad9f9a5ed0adb3dca10dd3dd1a13a516889a2f1f | [success](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34338741044) |

For MR-08, an original manifest was saved before advancing frontend PR #8 from `1692baea0cb7e6a1c190618b7d07ddeb9eb264fd` to `c6ac9e39187f1802f45de094d6ec03ed0e3a4e6a`. The rehearsal retained the original requested commit and reported the mismatch.

## Live observations

Every row below passed its stated local expectation. Required-check enforcement remains blocked by the account plan for all rows.

| Case | Overall observation | Local expectation | Run ID |
| --- | --- | --- | --- |
| MR-01 | unknown | clean | 4495e7c0-cd28-4433-8d84-db9b25e443da |
| MR-02 | unknown | clean | 5c9fcde1-3103-4313-975e-40e03a2374f3 |
| MR-03 | blocked | conflict | 2ab28b85-5572-404f-b49d-7c51ae3e939f |
| MR-04-alone-a | unknown | clean | 05a0f1fd-7580-4f6a-b2a7-d6f2c77b1ccb |
| MR-04-alone-b | unknown | clean | 72fd120e-136e-4bfd-b28c-3f202a06e648 |
| MR-04 | blocked | conflict | c301418d-3f84-42a2-855a-dddbf33b2e77 |
| MR-05 | blocked | conflict | a3ab695a-d906-4cf5-a1b2-02d544bfe5fe |
| MR-06 | unknown | clean | 67f1ec3e-a35d-4eee-81dd-28176f8a8577 |
| MR-07 | blocked | conflict | 7f618191-eccf-4b14-974a-6169feb03c9a |
| MR-11 | unknown | ci-failure | 46c620d8-efe3-4993-8e0f-c6b890eaddae |
| MR-13-draft | blocked | inactive | 72e29dac-c507-43f5-bb26-e15772e2545c |
| MR-13-closed | blocked | inactive | 49596fe7-8f9c-4d3a-80ed-081b066fd72f |
| MR-16 | unknown | clean | e30811d8-1345-4fa7-af29-13a1de77cf21 |
| MR-20 | unknown | clean | d620c0ae-ba21-4a5e-9441-f51609dc7c75 |
| MR-08 | blocked | outdated | ca758c27-af0c-45f1-b13b-0b3290e7f002 |

MR-04-alone-a and MR-04-alone-b each combined cleanly with `main`. MR-04 combined the same two PRs and reported `shared.txt` as a conflict. MR-03/MR-05 used `rehearsal-target` explicitly and also found that file conflicted. MR-07 retained the clean frontend tree while the backend conflicted, keeping the whole request blocked.

Frontend PR #5 really failed its sample CI, but that check was optional because protection was unavailable. MR-11 therefore verifies observation of the failed run and refusal to assume required enforcement; its full required-failure acceptance remains pending.

## Reproducible result identities

| Case | Repository | Final tree |
| --- | --- | --- |
| MR-01 | frontend | 52ad2d02c1896c65e245a438c8aada758e3ab265 |
| MR-02 | frontend | 7bc4bafd351a4c095afac863eb8286717de2f5bc |
| MR-04-alone-a | frontend | da2ef40ffcd3e82450e600251676e233b03a02e0 |
| MR-04-alone-b | frontend | d8bf67383087ff7faa93225a091faaa10e5c9202 |
| MR-06 | backend | 3feca0677aa664fb2764176de03487adf79593df |
| MR-06 | frontend | 52ad2d02c1896c65e245a438c8aada758e3ab265 |
| MR-07 | frontend | 52ad2d02c1896c65e245a438c8aada758e3ab265 |
| MR-11 | frontend | 096d7a36c7afbd08e3c6c047cf862ba50b1dfe2f |
| MR-16 | backend | 3feca0677aa664fb2764176de03487adf79593df |
| MR-20 | frontend | 52ad2d02c1896c65e245a438c8aada758e3ab265 |

The combined backend catalog blob was `4eeb0c470cab44414affdae805f4da6d1aa619b7`, read from the resulting tree rather than either individual PR. MR-01 and MR-20 produced the same frontend tree and observation. Synthetic merge commit timestamps are not treated as reproducible tree identity.

## Evidence storage and remaining acceptance

Raw JSON/text reports, manifests, snapshots, and check-run links are saved under:

```text
.release-coordinator/live-rehearsal/2026-09-09T10-15-49-009Z/
.release-coordinator/merge-rehearsal/sandbox/<run-id>/
.release-coordinator/rehearsal-setup-20260909/
```

The committed tables retain exact identities and conclusions without relying on ignored files as the only durable record. Local timing/error cases MR-09, MR-10, MR-14, MR-15, MR-17, MR-18, MR-19, and profile boundaries MR-21 remain automated fixture coverage; they are not claimed as live GitHub coverage.

Outstanding: obtain authorized support for branch protection, verify required-check enforcement, and rerun the relevant acceptance cases. Real profile/inbox integration and release execution remain deferred. See [progress](../progress.md) for subsequent local tests, PR/CI, and merge evidence.
