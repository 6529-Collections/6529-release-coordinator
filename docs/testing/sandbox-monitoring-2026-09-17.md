# Sample operational monitoring in sandbox releases — September 17, 2026

This controlled acceptance used only the Coordinator's three test repositories
and GitHub-hosted runners. It did not read or change the real frontend/backend
repositories, product environments, AWS accounts, credentials or deployments.
It ran from local branch `codex/sandbox-monitoring-release`; source delivery is
recorded separately in [progress](../progress.md).

## Runtime and fixture setup

- Runtime publication: backend
  [PR #77](https://github.com/6529-Collections/release-coordinator-test-backend/pull/77)
  (merged `332e80dff23b3b6929cff2d984ae2a5af0b3d998`) and frontend
  [PR #72](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/72)
  (merged `06128561de4a7b395032d414f490274aa8dd8991`) added the sample
  `ops/monitoring` package (backend only), the backend `Check monitoring
  package` step, and the pinned release runtime with the `monitoring`
  operation. Protected main-to-staging PRs
  [#78](https://github.com/6529-Collections/release-coordinator-test-backend/pull/78)
  (`62750c5aa354a4e42aaa924ace94070ebe2c3d95`) and
  [#73](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/73)
  (`d66656de622b7f9da58ca1905207d1f1a3d0ae01`) carried that history into
  `1a-staging`. Read-only readback found the same four pinned runtime blobs on
  `main` and `1a-staging` in both repositories: workflow `121726ba95…`,
  contract `a7d0b50cd6…`, build helper `0c59c68d84…`, runner `23fc3a3cf9…`; the
  backend check workflow is `58396920d9…` on both branches.
- Intake pin: the sandbox inbox wrapper checked out Coordinator commit
  `5cab79f1` (September 9), which predates schema `0.000002`, so the first
  submission's intake run
  [35201788728](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/35201788728)
  failed with "Request does not match the selected profile's schema or request
  ID." Test-inbox [PR #28](https://github.com/6529-Collections/release-coordinator-test-inbox/pull/28)
  (merged `224824aac9b72947c2c8d0acb3352428fef61a36`) moved the pin to merged
  Coordinator `main` `f2ad24f1b82248a00eb258957c1f678313b15131`.
- Fixture PRs, all based on test `main` after the runtime publication:
  monitoring-only backend
  [PR #79](https://github.com/6529-Collections/release-coordinator-test-backend/pull/79)
  (three alarms, regenerated inventories) with frontend companion
  [PR #74](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/74);
  failing backend
  [PR #81](https://github.com/6529-Collections/release-coordinator-test-backend/pull/81)
  (`deploy.json` `fail_environment: "staging"`) with companion
  [PR #76](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/76);
  mixed backend
  [PR #85](https://github.com/6529-Collections/release-coordinator-test-backend/pull/85)
  (worker comment plus two alarms) with companion
  [PR #75](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/75).
  The first mixed fixture,
  [PR #80](https://github.com/6529-Collections/release-coordinator-test-backend/pull/80),
  replaced the worker with the fixture baseline and failed its own application
  check; it was closed and its branch name stays reserved by that closed PR.

## Run 1 exposed a third path allowlist (ticket #29)

Ticket [#29](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/29)
(request `af8a76f1-03ab-4079-ae15-32acf77cb8bc`) requested PR #79 at
`d79c58cdf0e4c00678fc8e8415fa0d2a1efc2506` and PR #74 at
`c34b96e40718cfb187c7c768711cee536fa1af6a` for `production`. Sandbox readiness
passed its `operational_deployments` check and the ticket entered the batch
search alone. The combined Git attempt `43eed860-32a5-4721-ab6b-67eea4072a2d`
ended `unknown`: the Git workspace's candidate patch rule still allowed only
`src/`, `docs/`, `README.md` and `shared.txt`, so it reported "Candidate patch
is outside sample paths." No trial PR, workflow or branch was created; the
ticket was deferred with that saved reason and the lock was released. The fix
(`rehearsal-git.mjs`, with a real-Git regression test) allows the four sample
monitoring files for backend candidates only. Because a finished batch with a
saved `unknown` attempt is deliberately never retried for identical inputs, the
retry used a new empty commit `a74423bf97356625832caa517673314a2df6b03f` on the
same fixture branch and a new ticket. Run 2 then retired #29 as
`reason:outdated-commit` and held the new ticket as an overlapping request until
that closure applied; run 3 released it.

## Monitoring-only change deployed after the test-main merge (ticket #30)

Ticket [#30](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/30)
(request `15406ad4-dd5a-4408-9e63-dcee7e53307b`, production target, backend
`operational_deployments: ["monitoring"]`) passed cheap filtering as the only
suitable ticket, the combined Git attempt `fd956bc5-7e31-46ea-9a54-ec6c038a1913`,
trial checks (backend run
[35205613986](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35205613986),
frontend run
[35205728009](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35205728009))
and the combined service check
[35205883363](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35205883363).
Release `900d8d15-825d-4a71-b224-67d1b2103f58` then ran sixteen operations in
this order:

| Step | Result |
| --- | --- |
| `staging:integrate:backend` | passed; [backend PR #83](https://github.com/6529-Collections/release-coordinator-test-backend/pull/83) |
| `staging:deploy:backend:dbMigrationsLoop` | passed; run [35206500242](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35206500242) |
| `staging:deploy:backend:worker` | passed; run [35206629390](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35206629390) |
| `staging:deploy:backend:api` | passed; run [35206792767](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35206792767) |
| `staging:integrate:frontend` | passed; [frontend PR #78](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/78) |
| `staging:deploy:frontend:frontend` | passed; run [35207161840](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35207161840) |
| `staging:e2e` | passed; run [35207273163](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35207273163) |
| `prod:integrate:backend` | passed; [backend PR #84](https://github.com/6529-Collections/release-coordinator-test-backend/pull/84), test `main` `36a2a4933a6e8556ae8d37acfbdac12bf3de531e` |
| `prod:monitoring:staging` | passed; run [35207631647](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35207631647) on `main` at `36a2a493` |
| `prod:monitoring:prod` | passed; run [35207752586](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35207752586) on `main` at `36a2a493` |
| `prod:deploy:backend:dbMigrationsLoop` | passed; run [35207902329](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35207902329) |
| `prod:deploy:backend:worker` | passed; run [35208019467](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35208019467) |
| `prod:deploy:backend:api` | passed; run [35208136654](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35208136654) |
| `prod:integrate:frontend` | passed; [frontend PR #79](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/79) |
| `prod:deploy:frontend:frontend` | passed; run [35208502722](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35208502722) |
| `prod:e2e` | passed; run [35208631579](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35208631579) |

Both monitoring runs executed only the monitoring build, upload and runner
steps (the backend and frontend application builds were skipped), each on
branch `main` at the merged backend commit. Their verified reports carried the
checks `monitoring:source`, `build:monitoring`, `artifact:monitoring` and
`monitoring:<environment>`, and an installed record bound to the build
manifest: staging template `monitoring-staging.json` SHA-256
`daba0629c81f62cef91135ee6441ba03329a972cec12ed4d4001e8686f17d108`, prod
template `monitoring-prod.json` SHA-256
`c1739bd5ad72e19db1c1979f49bba97b1d1fa83685dea48aa7e72f0f924996f2`, both with
source commit `36a2a4933a6e8556ae8d37acfbdac12bf3de531e`. The Coordinator's
independent readback matched GitHub's artifact records: staging artifact
`10491135479` (`sandbox-build-caa952c5-1e75-4b85-86ae-dc92e36750cb-monitoring`,
digest `f9a617ef0f461797fe8fe61acc4a55ebf4364d0bcf39b82963c7b3a30b6658be`) and
prod artifact `10491080898`
(`sandbox-build-b252c514-d57e-4d08-be82-4afd756efb43-monitoring`, digest
`a7a3778901352df0f30320970925a24977a3081412456b05396c757de48fb807`), neither
expired, each belonging to its run.

The ticket closed as `status:completed` with `reason:release-completed`,
`batch:passed`, `rehearsal:passed` and `component:monitoring`; its status
comment lists every operation and states that operational monitoring was
deployed for staging and production from the merged test `main` commit before
the production application deployments. Owned release branches were removed
(the remaining `codex/release-sequence-case-*` branches are September 11
fixtures), the batch archived, and the journal lock was released. Final refs:
backend `main` `36a2a49`, `1a-staging` `b6ea6f2`; frontend `main` `8d82398`,
`1a-staging` `4b8b3b8`.

## Existing gates held the first failure-case ticket (ticket #31)

Ticket [#31](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/31)
(request `bbc227b1-11f9-4cf9-8758-53a0d4bd151a`) requested the failing backend
PR #81 at `12a221124ab15d8d5e13497cb8b83ead2e29c3d0` and companion PR #76 at
`73bc11842adc31008c9371c1022b42206047ea75`, both branched before ticket #30's
release moved test `main`. Two existing gates held it, as designed:

- Run 4 (10:16) recorded `observation_stability` as unknown for both PRs: their
  mergeability changed between the Coordinator's two reads because GitHub was
  recomputing it against the moved base. The ticket waited with "run it again".
- Run 5 (10:21) passed readiness but the one-ticket Git rehearsal reported
  `destination_gate` unknown for both PRs: GitHub still reported their creation
  base (`332e80d…`, `0612856…`) while the destinations were `36a2a493…` and
  `8d823988…`, so their green checks were not accepted as proof for the new
  destination. No trial PR, workflow or branch was created.

The submitter-side remedy is GitHub's own "update branch": merging current
`main` into each fixture branch moved the PRs' recorded bases to the current
destinations (backend head `faffb6dc50c91570b944d50580497639cc14ddec` on base
`36a2a493…`, frontend head `e20c9b7e10729eee3cc4f81499234bd4b2db5e81` on base
`8d823988…`) and re-ran their checks; an empty commit alone had not moved the
recorded base. Ticket #31 was retired with `--issue 31 --close-test`
(`reason:test`), and ticket
[#32](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/32)
(request `804318dc-0618-4047-aecf-3aedc9eeebd9`) requested the updated heads.
The public schema's 100-character `requested_by` limit rejected one draft of
that request locally before dispatch.

## Monitoring deployment failure stops before production and restores both environments (ticket #32)

Ticket #32 passed readiness, its one-ticket Git rehearsal, cheap filtering
(alone), the combined Git attempt `94b26f56-3cfc-4105-ac44-b6b17409587b` and
the batch checks `d843bdc3-8437-4c92-a539-a5273e246208` (service check run
[35212457924](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35212457924)).
Release `a4bd77b6-a742-4436-934f-0d8421248e1c` then ran:

| Step | Result |
| --- | --- |
| `staging:integrate:backend` | passed; [PR](https://github.com/6529-Collections/release-coordinator-test-backend/pull/87) |
| `staging:deploy:backend:dbMigrationsLoop` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35213225817) |
| `staging:deploy:backend:worker` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35213405201) |
| `staging:deploy:backend:api` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35213590792) |
| `staging:integrate:frontend` | passed; [PR](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/81) |
| `staging:deploy:frontend:frontend` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35214111561) |
| `staging:e2e` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35214269434) |
| `prod:integrate:backend` | passed; [PR](https://github.com/6529-Collections/release-coordinator-test-backend/pull/88) |
| `prod:monitoring:staging` | failed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35214733125) |
| *restoration* | |
| `restore:prod:integrate:backend` | passed; [PR](https://github.com/6529-Collections/release-coordinator-test-backend/pull/89) |
| `restore:prod:monitoring:staging` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35215196108) |
| `restore:prod:monitoring:prod` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35215324604) |
| `restore:prod:deploy:backend:dbMigrationsLoop` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35215462087) |
| `restore:prod:deploy:backend:worker` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35215600633) |
| `restore:prod:deploy:backend:api` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35215740210) |
| `restore:prod:deploy:frontend:frontend` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35215883285) |
| `restore:prod:e2e` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35216055278) |
| `restore:staging:integrate:backend` | passed; [PR](https://github.com/6529-Collections/release-coordinator-test-backend/pull/90) |
| `restore:staging:integrate:frontend` | passed; [PR](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/82) |
| `restore:staging:deploy:backend:dbMigrationsLoop` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35216859653) |
| `restore:staging:deploy:backend:worker` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35217007771) |
| `restore:staging:deploy:backend:api` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35217162176) |
| `restore:staging:deploy:frontend:frontend` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35217297546) |
| `restore:staging:e2e` | passed; [run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35217460599) |

The failed operation ran on `main` at the merged backend commit
`df3d3228a1ca137c97cdb0e7523efe0c16c9086b`. Its verified report passed
`monitoring:source`, `build:monitoring` and `artifact:monitoring` and failed
`monitoring:staging` with "Controlled monitoring deployment failure for
staging."; it carried no installed record, and the Coordinator recorded no
installed artifact. No `prod:deploy:*` operation had started. The confirmed
no-database-change failure produced a version-2 restoration plan of fifteen
steps: test `main` was restored first (undo PR #89 to
`bbd5cd59f628ab381c2c9c71dc0c664ecc4bb44f`), both monitoring environments were
redeployed from that restored commit as ordinary deploy steps, the production
checks and E2E reran, and then both staging branches were restored (undo PRs
#90 and #82) and rechecked. The restored monitoring templates are byte-identical
to the ones ticket #30 installed (`monitoring-staging.json` SHA-256
`daba0629c81f62cef91135ee6441ba03329a972cec12ed4d4001e8686f17d108`, artifact
`10493419602`, digest `d2fedac7785a1ea49186f46a6f37d17498ea82ddd8d405259a56138f25485002`;
`monitoring-prod.json` SHA-256
`c1739bd5ad72e19db1c1979f49bba97b1d1fa83685dea48aa7e72f0f924996f2`, artifact
`10494870323`, digest `da5fc859bab89af2ee1899aff6339a8677458b7002e400a48d162c33f01e9875`).

The final readback at 11:47:27Z confirmed prod versions backend
`bbd5cd59f628ab…` / frontend `8d823988cf2051…` and staging versions backend
`de31a8b51186e8…` / frontend `c9b7c24374342…`, with both environments' trees at
backend `5cafcc53823aed64c8d140e5bdadd820f0cdaf27` and frontend
`c0cbcde5af4acc9e8df319a768f476f50ef47bb2`: exactly the trees ticket #30 had
released. The execution ended `needs-human` with "prod:monitoring:staging
failed. Changed test main and staging branches were restored to their saved
trees; their matching build and E2E checks passed. The release still needs a
person." Ticket #32 stays open with `status:action-needed` and
`reason:release-failed`; the journal lock was released.

## Mixed application and monitoring change (ticket #33)

Ticket [#33](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/33)
(request `35e2cdb9-946f-4fdd-9dd2-0d92cba5b00a`) requested the mixed backend
PR #85 at `d2de7f545c577313ee23648f0acdb7281947f060` (a worker comment plus a
two-alarm inventory) and companion PR #75 at
`8d8c6b8378b478a6207da0d28349b9bcba2a8e0c`, both updated onto the restored
`main` first. Its first run was held because GitHub reported PR #75's merge
gate as `BLOCKED` by the repository's required conversation resolution (an
unresolved CodeRabbit note on the companion file); resolving that note made the
gate `CLEAN`, and the next run selected the ticket alone. It passed the combined
Git attempt `3dde6de0-8be9-49a4-8a34-1f69e2527e09`, trial checks (backend
[35219552786](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35219552786),
frontend [35219677071](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35219677071))
and the service check
[35219846308](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35219846308).
Release `3155c8e2-6ee6-4a6e-adb8-c74f9e51f8fd` ran the same sixteen-operation
order as ticket #30: staging
[PR #92](https://github.com/6529-Collections/release-coordinator-test-backend/pull/92)
/ [PR #84](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/84),
staging checks
[35220533407](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35220533407),
[35220681077](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35220681077),
[35220814086](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35220814086),
[35221265427](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35221265427)
and E2E
[35221397572](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35221397572);
then [PR #93](https://github.com/6529-Collections/release-coordinator-test-backend/pull/93)
put backend commit `004d49d42357257c98271f435b17414ebb0bb7b1` on test `main`,
monitoring deployed for staging
([35221794017](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35221794017))
and prod
([35221930759](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35221930759)),
and only then the production application checks
[35222074006](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35222074006),
[35222211857](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35222211857),
[35222346646](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35222346646),
frontend [PR #85](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/85)
and [35222744340](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35222744340),
and prod E2E
[35222886498](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35222886498).

The installed templates changed with the inventory: `monitoring-staging.json`
SHA-256 `5fc80cd9240b2b296fa9f368bdc8f62c4e28b269ef378f623a8a26178567cce5`
(artifact `10496613613`, digest
`a018ef2ef4d014b8da9965aed5be3578a74bcc64ce531ed9ca9ebf6faf7f6302`) and
`monitoring-prod.json` SHA-256
`be5afe237eaf7dd3d813255da6b82b5166e0279567352bc715e526e5e9df729d` (artifact
`10497432542`, digest
`3abe4aa14a41db8b02554b7a037f0e23014aac0395e20b7d63fb814772191ec0`), both with
source commit `004d49d4…`. Test `main` now carries six staging alarms
(`Errors` and `Throttles` for each of the three sample functions). The ticket
closed as `status:completed` with `reason:release-completed` and
`component:monitoring`. Final refs: backend `main` `004d49d`, `1a-staging`
`10c1702`; frontend `main` `73f906a`, `1a-staging` `8e73049`.

## Boundaries and what remains offline-only

- The sample "installed" monitoring is a verified build artifact and a report
  bound to it; the real backend deploys CloudFormation to a separate AWS
  account, and a real adapter must read that deployed state instead.
- A monitoring operation dispatched from a branch other than test `main`, a
  staging-only request that selects monitoring, and a monitoring-only sandbox
  request have offline regression coverage only.
- Tickets #22, #23, #24 and #27 from earlier acceptances remain open and
  `action-needed`; the September 11 `codex/release-sequence-case-*` fixture
  branches remain in both test repositories. Neither affected these runs.
- Nothing here used or changed a real product repository, environment,
  credential or deployment, and no sandbox pass authorizes a real release.
