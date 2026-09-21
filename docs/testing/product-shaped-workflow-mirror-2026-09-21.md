# Product-shaped workflow mirror acceptance — September 21, 2026

This controlled acceptance used only the Coordinator's frontend and backend test
repositories and GitHub-hosted runners. It did not read or change the real
frontend/backend repositories, product environments, AWS accounts, credentials,
databases, monitoring accounts or deployments.

## Protected staging publication

The already-reviewed mirror histories were published from protected test `main`
to protected `1a-staging` through checked pull requests:

- frontend [PR #93](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/93)
  merged as `0373223002e6fb4a79a10e19c6ad6e24ec95a7b4`;
- backend [PR #101](https://github.com/6529-Collections/release-coordinator-test-backend/pull/101)
  merged as `5e5c7b4f23f039152d9e16419975782da45c7a16`.

Both PRs passed their required `Sandbox check` before merge. The repositories
had no active or queued workflow run immediately before either protected merge
or manual dispatch.

## Successful workflow sequence

| Stage | Result |
| --- | --- |
| Frontend staging deploy | [run 35605828443](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35605828443) passed on protected `1a-staging` at `0373223` |
| Staging E2E dispatch wrapper | [run 35605940009](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35605940009) passed and selected deploy run `35605828443` |
| Exact staging E2E | [run 35605950971](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35605950971) passed as `Staging E2E automatic 35605828443` |
| Backend API staging | [run 35605923124](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35605923124) passed on protected `1a-staging` at `5e5c7b4` |
| Monitoring staging | [run 35606056993](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35606056993) passed from backend `main` at `7565898` |
| Monitoring production | [run 35606116283](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35606116283) passed from the same backend `main` commit before production applications |
| Backend API production | [run 35606173242](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35606173242) passed on `main` at `7565898` |
| Frontend production deploy | [run 35606279043](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35606279043) passed its exact-source guard and deployed `42a2a5f` |
| Production E2E dispatch wrapper | [run 35606476402](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35606476402) passed and selected deploy run `35606279043` |
| Exact production E2E | [run 35606488650](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35606488650) passed as `Production E2E automatic 35606279043` |

Every run completed successfully on its first attempt. The final readback found
no active or queued run in either test repository. Both monitoring dispatches
intentionally ran from backend `main`, including the staging-environment deploy,
because that is the real backend workflow's source contract. The future adapter's
contract and recovery tests must preserve this distinction from ordinary staging
service dispatches, which run from `1a-staging`.

The exact monitoring dispatch requests were:

This table covers only the monitoring workflow's dispatch source. The ordinary
backend service used protected `1a-staging` for staging in run `35605923124` and
`main` for production in run `35606173242`, as recorded in the run table above.

| Environment | Dispatch source branch/ref | `environment` input | `commit_sha` input |
| --- | --- | --- | --- |
| staging | `main` | `staging` | `75658981146704d71f7e0179526b8f3acf7a8f40` |
| prod | `main` | `prod` | `75658981146704d71f7e0179526b8f3acf7a8f40` |

## Deployment evidence readback

The fake deployment artifacts were downloaded independently after the runs. All
were present, unexpired and declared `fake-deployment-evidence-v1`. Their saved
identity matched the expected run:

| Role | Environment | Source | Workflow | Run | Unit |
| --- | --- | --- | --- | --- | --- |
| frontend | staging | `0373223` | `deploy-staging.yml` | `35605828443` | — |
| backend | staging | `5e5c7b4` | `deploy.yml` | `35605923124` | `api` |
| monitoring | staging | `7565898` | `deploy-operational-monitoring.yml` | `35606056993` | — |
| monitoring | prod | `7565898` | `deploy-operational-monitoring.yml` | `35606116283` | — |
| backend | prod | `7565898` | `deploy.yml` | `35606173242` | `api` |
| frontend | prod | `42a2a5f` | `build-upload-deploy-prod.yml` | `35606279043` | — |

The frontend E2E jobs also independently resolved each deploy run, required the
canonical successful deploy job, downloaded that run's evidence artifact,
verified its source and executed the built sample output. This proves the E2E
runs tested the selected fake deployments rather than rebuilding unrelated code.

## Evidence boundary and next step

This acceptance proves the separate product-shaped test workflows' successful
staging and production path. It does not prove a Coordinator adapter, failed-run
recovery or any real-product execution. The Coordinator still calls
`sandbox-release.yml`.

The next implementation step is a sandbox-profile adapter that dispatches these
separate workflows. It must satisfy the canonical
[separate-workflow adapter retirement gate](../merge-rehearsal-testing.md#separate-workflow-adapter-retirement-gate)
before the generic adapter is retired.
