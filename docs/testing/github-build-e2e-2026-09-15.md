# GitHub-only sandbox build and E2E acceptance — September 15, 2026

This record proves the build-backed sandbox release path. It used the three
public Coordinator test repositories and GitHub-hosted runners. It did not read
or change the real frontend/backend repositories, product environments,
credentials, databases, or deployments. The HTTP servers and build artifacts
were temporary; no outside application host was created.

## Runtime setup

The generated build runtime first reached test `main` through normal protected
PRs, then each current `main` was merged into protected `1a-staging`. This keeps
the branches in one history instead of creating unrelated commits with similar
files.

| Repository | Runtime on `main` | Main-to-staging sync |
| --- | --- | --- |
| Backend | [PR #42](https://github.com/6529-Collections/release-coordinator-test-backend/pull/42), merge `aeeb244ef808f6bbc6f68d3df2c27a4344e0a292`, [check `34968665917`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34968665917) | [PR #43](https://github.com/6529-Collections/release-coordinator-test-backend/pull/43), merge `dea08a53d16dd2b72ad9741fb671b10214a893ed`, [check `34968972155`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34968972155) |
| Frontend | [PR #39](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/39), merge `b2d7aa750a59fee5a2b7c1a8160abbacc975151a`, [check `34968717216`](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34968717216) | [PR #40](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/40), merge `97c5afd4691b9e5b05c6d5c0db13bff81c7831df`, [check `34968985250`](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34968985250) |

Both roles and both environment branches had the same four pinned runtime
blobs before the release:

- `.github/workflows/sandbox-release.yml`:
  `14461c4318b22524dfc41032f8af3cd18f1e1bdc`
- `coordinator/src/release-contract.mjs`:
  `395eb44286c3e9853b5cd8a87e0f17e352cbba7b`
- `coordinator/sandbox/application-build.mjs`:
  `dfc6b7da170b3b54bf38ea864a20e313fbad4204`
- `coordinator/sandbox/release-run.mjs`:
  `034acaa0c85e0629212f8b75466c2463091bbcbf`

The PR workflow used a locked npm install, the role's program checks, an npm
build, and the pinned artifact upload action. The release workflow rebuilt exact
environment commits, verified their manifests, recorded artifact digests, and
ran E2E against the built backend and frontend over local runner HTTP ports.

## Request and batch

[Inbox ticket #21](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/21)
contained request `38316462-c99c-4a0e-aa82-cf57432609e2`:

- Backend [source PR #38](https://github.com/6529-Collections/release-coordinator-test-backend/pull/38),
  commit `846315a6349b83a087511a7461e69d2ab331e4f1`, passed
  [run `34969650186`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34969650186).
- Frontend [source PR #36](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/36),
  commit `f9e5667ea4943a414c69a4f8b9216de5de3202da`, passed
  [run `34969698783`](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34969698783).
- The request declared no release-specific database change and ordered backend
  `dbMigrationsLoop`, `worker`, `api` before frontend.

Cheap filtering selected only ticket #21. Batch
`a9953001855cc298b3074c6a86bc9cb481984223c6731f6fa4c156bb2f15f440`
passed combined Git and fresh PR checks:

- backend temporary [PR #44](https://github.com/6529-Collections/release-coordinator-test-backend/pull/44),
  [run `34971466193`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34971466193);
- frontend temporary [PR #41](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/41),
  [run `34971578247`](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34971578247);
- combined service/database
  [run `34972000250`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34972000250)
  passed all four units and confirmed temporary database cleanup.

Both temporary batch PRs were closed unmerged and both owned branches were
removed before release execution. Source PRs remained open and unchanged, as
required by the current sandbox contract; the release PRs carried their exact
combined trees into the environment branches.

## Release result

Coordinator run `05417118-05b0-429f-b0e8-a601b0ba09ef` created release
`c8c6f8a1-5a2c-4204-ae68-2d60435ae95f`. All 14 ordered operations passed:

| Order | Operation | Verified evidence |
| ---: | --- | --- |
| 1 | Backend into test staging | [PR #45](https://github.com/6529-Collections/release-coordinator-test-backend/pull/45), unique head `293a33873150e2e9ae193af624d63aacdc801d7c`, merge `90c94c97d5cb61aa785f045fa9bb9b444a2262cb` |
| 2 | Staging database-loop build/check | [run `34972874291`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34972874291) |
| 3 | Staging worker build/check | [run `34973108450`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34973108450) |
| 4 | Staging API build/check | [run `34973258987`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34973258987) |
| 5 | Frontend into test staging | [PR #42](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/42), unique head `c82dd13660c6f392eee60e01e74eff05f5862c58`, merge `7b3fcb4a5af0eaaa713cb627469aa5d66af7674b` |
| 6 | Staging frontend build/check | [run `34973670094`](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34973670094) |
| 7 | Matching built staging E2E | [run `34973820319`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34973820319) |
| 8 | Backend into test production | [PR #46](https://github.com/6529-Collections/release-coordinator-test-backend/pull/46), unique head `8cb7f8575270cf64d0858c0409e2a0771f940cae`, merge `1cb5ef0a6ba7852ce0b11034ea790428a60055ad` |
| 9 | Production database-loop build/check | [run `34974670099`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34974670099) |
| 10 | Production worker build/check | [run `34974840011`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34974840011) |
| 11 | Production API build/check | [run `34974986325`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34974986325) |
| 12 | Frontend into test production | [PR #43](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/43), unique head `e4a52ee4dd37c9fa3f21dc2484d8623c345ac736`, merge `4aedf0166851a831cd8c3fb0a56ab5082db980b1` |
| 13 | Production frontend build/check | [run `34975424003`](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34975424003) |
| 14 | Matching built production E2E | [run `34975582515`](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34975582515) |

Staging E2E uploaded backend artifact `10398606465` with digest
`sha256:52ea6dcd66e7f2fe70219dcc9b7b39dbb54571c61feaa16c214d4efb47d3ba79`
and frontend artifact `10398027672` with digest
`sha256:106647ab7f514c18bd2b5d8b2c981e0a9450e68c27603829e9546811ab7be7c9`.
Production E2E uploaded backend artifact `10398279345` with digest
`sha256:cb357b88be815e7a357368dae02775d41cb11aa3aee7133ca68359e2ca7ac608`
and frontend artifact `10398996642` with digest
`sha256:263e28a8f50fc7c26292a108fc2b1a9dbeeff141ebd99a395672fb194a26a06e`.
All four were unexpired on readback and have September 22 expiry dates.

Final protected branch readback showed matching environment trees:

| Repository | `1a-staging` | `main` | Shared exact tree |
| --- | --- | --- | --- |
| Backend | `90c94c97d5cb61aa785f045fa9bb9b444a2262cb` | `1cb5ef0a6ba7852ce0b11034ea790428a60055ad` | `e195ed0ec75fc29abf3373fff04d171841107bc9` |
| Frontend | `7b3fcb4a5af0eaaa713cb627469aa5d66af7674b` | `4aedf0166851a831cd8c3fb0a56ab5082db980b1` | `ed45ad757d26c31ffe81a5bebdc9a2355c314448` |

## Gaps found and fixed during acceptance

1. Runtime files had first been published independently to staging and main.
   The matching files hid divergent histories, and ticket #20 correctly stopped
   on a staging integration conflict without changing either environment. Setup
   now publishes to main first and requires a protected main-to-staging sync.
2. Several old cancelled attempts for one source check were displayed beside its
   successful retry. The Coordinator now uses the uniquely newest dated attempt
   for one app/name identity. Missing or tied dates remain blocked.
3. Trial and release PRs originally reused the same candidate commit, allowing a
   check attached to that commit to appear on a later PR. Every release stage now
   creates and journals its own commit with the exact candidate tree and parent.
4. CodeRabbit appended its generated release summary to production backend PR
   #46 after creation. The first invocation stopped before merging it because the
   body no longer matched byte-for-byte. The verifier now accepts only the exact
   original body or that body followed by CodeRabbit's complete marker block;
   branch, commit, base, repository and author checks remain exact. Explicitly
   resuming the same run reused its saved PR and all completed staging evidence.

## Local source verification

The latest `npm run check` passed after the live acceptance and review fixes.
It ran 500 tests: 497 passed, 3 were intentionally skipped and none failed.
Non-fixing lint, formatting, workflow-policy checks and the isolated packed-CLI
check also passed. `git diff --check` found no whitespace errors.

## Finish-line readback

- Ticket #21 is closed with `status:completed`, `rehearsal:passed`,
  `batch:passed`, and `reason:release-completed`.
- The completed batch is archived at
  `history/batches/bbb718012f7f133d183f7082d1d55b3240b17cb2ae0eb81de32c775ffa3b34f5.json`;
  its active record is absent and the journal lock is `null`.
- All four release PRs are merged. All four owned release branches and both
  temporary batch branches are absent.
- The success proves only the public sandbox implementation. It authorizes no
  real product merge, build, deployment, or rollback.
