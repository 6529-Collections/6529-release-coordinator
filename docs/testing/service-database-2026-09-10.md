# One-ticket service and database acceptance — September 10, 2026

At the time of acceptance, the Coordinator implementation was local and
uncommitted, based on merged
`430cae629fac12fe78a57bc57e00d3ef411c6742`. Sandbox setup PRs are separate from
the Coordinator's own merge status. No product release was performed. Later
source delivery is tracked in [progress](../progress.md#sandbox-source-delivery-september-10);
the observations below retain the state and evidence from the acceptance run.

## Scope and mechanism

One verified staging ticket contains backend and frontend PRs plus the selected
`dbMigrationsLoop`, `worker`, and `api` units. The frontend depends on the backend.
`inbox:run` checks the receipt/current gates, saves and rehearses exact inputs,
captures regular Git blobs, classifies the supported sample database definitions,
and saves a service attempt before dispatching the pinned sandbox workflow.

The GitHub runner uses the shared source bundle, temporary MySQL with fake rows,
and separate restricted Node containers. The controller checks the result and
current ticket/PR/main inputs before presenting it. Passing stays waiting;
the receipt is unchanged. Fixture setup and scenario PRs are intentional writes
to the existing test repositories. Candidate execution does not modify source
PR refs, product environments, or the real inbox.

## Local evidence

Seven real Docker cases passed expected assertions using MySQL 8.4 and Node 22
images pinned by digest in `service-runtime.mjs`. The local controller ran Node
25.6.1. Reports are under the ignored
`.release-coordinator/service-development/runtime-cases/` directory.

| Case | Observed result |
| --- | --- |
| No database change | Baseline row value 10 becomes 20 through normal worker activity; API and frontend agree. No release-specific update. |
| Database upgrade | An existing table gains `display_value`; the one-off update adds 5 once, the worker yields 30, and API/frontend show 30. Repeating the update reports already applied. |
| Partial database failure | Schema addition remains visible with original row value 10 and null new field. Database step blocked; worker/API/frontend never start. Evidence precedes cleanup. |
| API failure | Database and worker pass; API blocks; frontend never starts. |
| Frontend mismatch | The wrong displayed result blocks despite earlier successful steps. |
| Timeout | Worker exceeds its time limit; result is unknown, dependents never start. |
| Isolation | Candidate has no credential environment, Docker socket, repository/evidence mount, writable source mount or outbound GitHub connection. Expected computation still passes. |

Every case verified owned-resource cleanup. These cases exercise the actual
Docker adapter. Offline tests separately inject wrong versions/metadata, cancelled
or skipped workflow steps, duplicate runs, baseline failures, lost dispatch
responses, final checkpoint failures and stale inputs. The complete command test
checks journal-before-dispatch, ticket labels, waiting status and unchanged retry
without a second workflow or duplicate decision/comment.

The final `npm run check` passed **306 tests on Node 24.19.0**, lint, formatting,
workflow policy, the offline nine-file package install/CLI/schema check, and
source preservation. No package dependency or public version changed.

The local Docker matrix was repeated after runtime fixes; all seven assertions
passed again. Both merged sample bundles were compared byte-for-byte with all
five shared source files and matched.

## Merged sample runtime and source fixtures

- Frontend setup: [PR #9](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/9),
  merged at `3ace36be4b2df1b9c4eb9e44cbf89f3712681fff`.
- Backend setup/hardening: [PR #5](https://github.com/6529-Collections/release-coordinator-test-backend/pull/5),
  [PR #6](https://github.com/6529-Collections/release-coordinator-test-backend/pull/6),
  [PR #7](https://github.com/6529-Collections/release-coordinator-test-backend/pull/7),
  ending at `18d33510d925b0e5ce30168e888cc7586f532749`.
- Runtime branch `codex/sandbox-services-runtime-v1` points to that exact backend
  commit, as does the local trusted configuration. Actual workflow metadata and
  generated source contents were verified. These merges concern test repositories;
  the Coordinator source remains uncommitted.

All setup PRs passed the required Sandbox check. Source fixtures also passed
their normal application CI: frontend
[consumer PR #10](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/10);
backend [no-change #8](https://github.com/6529-Collections/release-coordinator-test-backend/pull/8),
[upgrade #9](https://github.com/6529-Collections/release-coordinator-test-backend/pull/9),
[schema-only #10](https://github.com/6529-Collections/release-coordinator-test-backend/pull/10),
[conditional database failure #11](https://github.com/6529-Collections/release-coordinator-test-backend/pull/11),
and [conditional API incompatibility #12](https://github.com/6529-Collections/release-coordinator-test-backend/pull/12).
Scenario PRs stay open as reproducible inputs. The conditional failures are
triggered by combining individually passing PRs within one ticket.

## Live evidence

The first full live path passed on
[ticket #2](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/2),
using [service run 34456463421](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34456463421).
The exact no-change source passed Git rehearsal and all four application steps.
The ticket stayed waiting with `services:passed`, then the explicit own-test
closure retired it while preserving its receipt and history.

This run exposed a log-transport integration defect: `gh` refused Actions logs
containing terminal controls. The Coordinator recorded unknown instead of a false
pass. The reader now requests those bytes into memory, never prints raw logs,
and parses the bounded result. A regression test covers that transport option.
Re-running the same ticket verified the original service workflow without another
dispatch. Its history retains both unknown and passed outcomes.

The first upgrade submission
[run 34457231031](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/34457231031)
stayed queued without a runner beyond the receipt timeout. It was cancelled and
read back as cancelled with no matching Issue before one controlled retry.
[Intake retry 34457847933](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/34457847933)
then succeeded with the same request ID. This was an infrastructure delay, not a
database-code failure. The remaining live cases are recorded below.

## Verified live cases

All seven cases produced their expected outcomes through normal request intake
and `inbox:run`, with no supplied plan or imported report. Each receipt was
preserved. The controlled tickets are retired with explicit own-test closures;
closure verification and protected-resource readback are recorded below.

| Case | Ticket | Result before test closure | Service workflow |
| --- | --- | --- | --- |
| No database change | [#2](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/2) | waiting; services passed | [Run 34456463421](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34456463421) |
| Database upgrade | [#3](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/3) | waiting; services passed | [Run 34458067449](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34458067449) |
| Partial database failure | [#4](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/4) | action-needed; services blocked | [Run 34458724069](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34458724069) |
| API failure | [#5](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/5) | action-needed; services blocked | [Run 34459701580](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34459701580) |
| Unknown database answer | [#6](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/6) | waiting; services unknown | No service dispatch |
| Incorrect no | [#7](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/7) | action-needed; services blocked | No service dispatch |
| Missing prerequisite | [#8](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/8) | waiting; services not-run | No service dispatch |

The upgrade retry reused run `34458067449`; its comment and decision count were
unchanged. The four service attempts reached verified completion: two passed
and two recorded expected application failures. The three held cases dispatched
no service workflow. Partial failure retained row value 10 and the new null
field, with every dependent step not run. API failure retained successful
database/worker results and left the frontend not run.

The final local guidance for missing database information explicitly requests
confirmation and a corrected immutable request when its answer must change;
it does not suggest reconciling a nonexistent service attempt. Its regression
and the full 306-test check passed. The live hold evidence above establishes
classification and no-dispatch behavior; that final wording refinement was
verified locally after ticket #6's run.

### Coverage boundary

SD-01/02, SD-03's unknown/false-no decisions, SD-04's missing prerequisite,
SD-05's partial database effect, and SD-06's API stop all have live ticket proof.
SD-07 has live unchanged retry and actual recovery after an unreadable result,
plus a real one-off-update repeat assertion. Additional lost-POST ambiguity,
wrong identities/versions, stale inputs, skipped/cancelled service jobs, baseline
failure and malformed data are controlled offline cases. Timeout, frontend
mismatch and candidate isolation also ran against actual local containers.
These evidence layers are deliberately distinct; they do not claim every injected
failure occurred in a live GitHub ticket.

## Cleanup and protected-resource readback

All seven new test tickets (#2–#8) were closed through `inbox:run --close-test`
and read back as closed. The v3 sandbox journal has no active lock and contains
four completed service attempts: two passed and two expected blocked results.
All four report owned-resource cleanup as removed. No local container with the
Coordinator service-attempt label remains.

All six scenario PRs retain their recorded heads and remain open for future
reproduction. Original sandbox ticket #1 retains its body, title, state, labels
and assignees. The real inbox's `codex/inbox-state` commit is unchanged.

Product `main` refs advanced during this acceptance window:

- frontend: `9daf13eb1a9cab857af452c870ab372f45d9e2c5` → `2cd462314e8b3d569db3312dc2187a0a69cf56d6`.
- backend: `5c990e9dbe762277cc13ecfa36f1bc9a58375eef` → `906300c6022b317206c5c358a81a401408b95597`.

This task issued no product-repository writes or deployment commands. Those
moving product refs are not reported as unchanged or counted as sandbox proof.
The Coordinator source checkout remains on `main` at
`430cae629fac12fe78a57bc57e00d3ef411c6742`, matching remote `main` at the final
source check, with implementation/documentation changes uncommitted.

## Limits

This models one complete ticket, including multiple PRs inside that ticket.
Multi-ticket selection/splitting is not implemented. The initial executor requires
all four explicit sample steps; it holds an omitted prerequisite rather than
proving an existing service can satisfy it. Fake programs and data do not validate
the real backend's complete service catalog or database-change detector.

No AWS deployment, production credentials, public npm publication, real database
recovery, persistent-service rollout, or real execution adapter is included.
Deleting a temporary database after recording a partial effect is cleanup, not
rollback. A future real partial database failure still requires a recovery decision.
