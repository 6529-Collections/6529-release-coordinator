# Profiled inbox and one-command ticket workflow

Sandbox and real configurations use the same intake, receipt verification,
readiness, local merge engine, and ticket updates. `inbox:run` joins inspection,
rehearsal, supported sandbox service/database checks, and presentation into one
manual run. Unscoped sandbox runs also filter and test complete tickets together,
then move one selected no-database-change batch through protected fake staging,
matching E2E, and protected fake production when requested. `--issue` retains
one-ticket service/database checks. Real service execution, release ownership,
release builds, and deployments remain later work. See
[progress](./progress.md) for local, live sandbox, and remote merge evidence.

## Trusted configuration

`apps/coordinator/src/profiles.mjs` owns the two fixed configurations. An operator
selects a name, never supplies a repository URL, numeric ID, workflow path, or
credential through a request. An unknown name stops without falling back.

| Setting | `sandbox` | `real` |
| --- | --- | --- |
| Inbox | `6529-Collections/release-coordinator-test-inbox`, ID `1362580376` | `6529-Collections/6529-release-coordinator`, ID `1346244762` |
| Frontend PRs | `release-coordinator-test-frontend`, ID `1362504370` | `6529seize-frontend`, ID `579004979` |
| Backend PRs | `release-coordinator-test-backend`, ID `1362505082` | `6529seize-backend`, ID `579003578` |
| Submission workflow | `submit-release-request.yml` on inbox `main` | Same workflow name/ref in the real inbox |
| Receipt checks | Selected inbox, successful workflow/attempt, request checksum, ticket number and GitHub actor | Same checks |
| State journal | `codex/inbox-state` in the test inbox repository | Existing state branch in the real inbox repository |
| Rehearsal destination | Current `main` of each selected test repository | Current `main` of each selected product repository |
| Service/database checks | Fixed, pinned workflow in the test backend; temporary MySQL and sample programs | Not implemented; services are reported as `not-run` |
| Release sequence | Protected `1a-staging` and `main` integration PRs plus a fixed, pinned fake release workflow in both test repositories | Not implemented; no real merge or deployment adapter is configured |
| Local submissions | `.release-coordinator/profiles/sandbox/submissions/` | `.release-coordinator/profiles/real/submissions/` |
| Rehearsal reports | `.release-coordinator/merge-rehearsal/sandbox/` | `.release-coordinator/merge-rehearsal/real/` |

All pinned repositories are public. Live inbox commands verify inbox numeric
identity and visibility. The rehearsal GitHub adapter binds each PR and source
repository to the profile's numeric IDs. Git transport uses the same selected
repository allowlist. Profile selection grants no additional GitHub permission.

The test inbox holds only a workflow wrapper and README. The wrapper checks out
an exact Coordinator commit and executes the shared intake implementation.
The real inbox workflow executes that same implementation from its own checkout.
Updating the sandbox's Coordinator source pin is an explicit fixture configuration
change through a PR; there is no copied implementation to maintain.

## Commands and request formats

The private Coordinator command accepts **complete request JSON**, including its
UUID `request_id`, `schema_version`, and `created_at`. Preserve the same JSON and
ID when inspecting or retrying an uncertain attempt; generating a new ID would
describe a new request.

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run request:submit -- --input REQUEST_JSON --json
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:read -- --json
RELEASE_COORDINATOR_PROFILE=sandbox npm run readiness:check -- --json
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --issue NUMBER --json
```

`request:submit` explicitly dispatches intake and waits up to five minutes for
verified receipt. It saves a prepared record before dispatch and a separate
result. Existing identical receipts, including closed tickets, are reused.
Duplicate/different request data stops submission. Uncertainty is not permission
to retry blindly; inspect the prepared record, workflow, and inbox first.
If saving the result fails, the CLI reports that error and retains the prepared
record path; a missing local result does not prove intake failed.

Sandbox request JSON adds `"profile": "sandbox"` and uses the actual two test
repository names in `release_parts[].repository`. The private adapter checks
those names, then applies the same public schema field/type rules. Real request
JSON uses the unchanged public schema and its two real repository names.
Sandbox JSON cannot validate as a public release request; test records and
workflow receipts cannot be promoted by changing the environment setting.

The installed public npm CLI `0.0.4` retains its existing real-only behavior.
This stage does not publish or require a new npm version. The new profile-aware
submission command belongs to the private Coordinator workspace.

`request:submit` and `inbox:run` require an explicit profile. The read-only
`inbox:read` and `readiness:check` retain their real default and honor an explicit
sandbox profile. `--help` performs no reads or writes.

`inbox:run --issue NUMBER` verifies and inspects the ticket, skips rehearsal for
initial blockers, and otherwise creates a plan and tries its exact PRs locally.
It saves the generated plan in the journal before starting Git, then saves the
report before publishing the result in the same ticket's comment and labels.
A pass adds `rehearsal:passed`; a scoped one-ticket run stays waiting. A combined
conflict adds `reason:rehearsal-blocked`. Unknown and changed evidence get
distinct reasons. A pass never authorizes a real release.

Omit the ticket number to process all selected tickets:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --json
```

Every suitable ticket first gets its own generated plan and Git rehearsal.
Unscoped sandbox runs then test compatible whole tickets together. The selected
batch continues through its saved sandbox release plan. A staging request stops
after matching staging E2E; a production request repeats the protected sequence
on test `main` only after that E2E passes. Real runs retain individual Git
rehearsals and never receive a release executor. The old manual plan input and
separate processing/rehearsal commands have been removed. Diagnostics stay read-only.

## Automatic plan for each ticket

The submitter's ticket already provides the exact PR versions, target, selected
services, and dependencies. The Coordinator adds only the details needed for a
repeatable local test:

1. Verify the receipt and dependency graph. Keep every requested PR and service.
2. Use the shared deterministic dependency sorter to order parts and repositories.
   Dependencies come first; PRs inside a part retain their submitted array order.
   Independent parts use the sorter's stable queue order from the ticket.
3. Read the current commit of each profile-configured rehearsal destination.
   Both profiles explicitly configure `main` for frontend and backend. This is
   a rehearsal setting for both staging/production requests, not a deployment
   destination or a decision about when the future executor changes `main`.
4. Verify repository name, numeric ID, visibility, branch, and full commit.
   No repository/branch override is accepted from a request or command argument.
5. Validate the complete generated plan against the ticket again. Preserve
   existing size, PR-count, scope, and dependency limits. Interleaving repository
   dependencies that this engine cannot represent produce a clear blocker.
6. Save the plan under the journal lock before temporary Git work. Recheck the
   ticket before saving and before/after rehearsal; recheck PRs and destinations.

Missing configuration or destination evidence produces `merge-plan-unavailable`.
Invalid scope/order produces `merge-plan-invalid`. The command does not guess,
drop PRs, try alternate orders until one passes, or ask for another plan file.
A failed or uncertain plan save stops before Git and retains the run lock.

Explicit `--resume RUN_ID` keeps the selection and plans already saved by that
run, and rehearses against fresh observations of those pinned inputs. It cannot
reuse an old passing report or silently replace the pinned destination commit.
Starting a new run captures current destination commits. See the
[recovery procedure](../apps/coordinator/README.md#journal-concurrency-and-interrupted-runs).

Plans remain internal evidence: the journal stores the ticket/request binding,
exact PR order and destinations; full reports record their resulting trees.
The journal's `inbox-run-v6` marker prevents older writers from overwriting the
run format or discarding archived history. See [history storage](./inbox-processing.md#history-storage)
for active records, archive validation and migration evidence. A legacy interrupted v1 run retains its already recorded scope
and plan on explicit resume.

Developer test manifests remain sandbox-only fixture inputs. They cannot enter
the ticket workflow or either decision journal. The public request schema and
installed npm CLI are unchanged.

## Verification and finish line

Local tests cover both named profiles using the same functions: submission,
workflow validation, receipt verification, real temporary Git merges, exact
ticket/PR scope, closed-ticket rechecks, hostile or crossed profile input,
repeated submissions, and separate records/journals. Tests do not contact GitHub.

The earlier [September 9 sandbox acceptance record](./testing/profiled-inbox-2026-09-09.md)
completes the following live proof:

1. Submit one sample request and verify its actual workflow, actor, ticket, and checksum.
2. Reuse that receipt on retry without a second ticket.
3. Inspect and, when explicitly run, organize the sample ticket in its own journal.
4. Rehearse its exact sample PRs and destination commits with the existing engine.
5. Confirm unchanged sample PR refs and real inbox/state, cleanup, and a durable report.

Record the source pin, local runtime revision, fixture commits, receipt and
workflow URLs, report results, and separate CI/merge evidence in progress.
The combined workflow has its own [acceptance record](./testing/unified-inbox-2026-09-09.md). Switching the new Coordinator commands to `real`
requires only the named configuration once installed, but permissions, product
repository limits, and the first real live run still need verification. Offline
real-profile tests are not real-system runtime proof.

## Service and database extension

The local `inbox:run` implementation includes tested
[one-ticket service/database acceptance](./merge-rehearsal-testing.md#service-and-database-acceptance).
See progress for Coordinator source delivery, separate local/live evidence,
and merged sample setup. Unscoped sandbox runs now add
[bounded batching](./design.md#proposed-batch-testing-and-selection), with cheap
elimination before expensive combined checks and durable temporary PR ownership.
The batch writer is sandbox-only; choosing `real` does not enable it.
The same repositories, test inbox,
exact-input bindings and automatically generated plans are retained.

The manual controller runs locally. Live sample programs run in isolated GitHub
Actions jobs with temporary MySQL. Trusted source configuration in
`apps/coordinator/src/service-runtime-config.mjs` fixes the backend repository,
workflow, branch and expected commit. Ref movement holds execution. Tickets
cannot choose commands, database URLs, runtime code or runner credentials.

Candidate programs receive only their read-only source file and fake JSON data
in separate restricted containers. MySQL is a separate owned container. The
trusted adapter mediates reads/writes and checks expected data. The workflow has
read-only repository permission and no inbox/product credentials in candidates.

The shared profile still selects capabilities, not permissions. `real` keeps
inspection and Git rehearsal; its service result is `not-run`. Real deployment,
database inspection and recovery adapters remain absent. No environment switch
can transfer sandbox proof or enable AWS deployment.

Service evidence is kept in the sandbox journal's `service_attempts` and local
`.release-coordinator/service-checks/sandbox/` reports, bound to both exact product
sample versions. See [progress](./progress.md) for local, live and merge evidence.
The public request schema and npm package are unchanged.

## Sandbox release sequence

The unscoped sandbox command creates one exact release plan from the selected
passing batch. For each required environment it integrates backend first, runs
`dbMigrationsLoop`, `worker`, and `api` in order, integrates frontend, runs the
frontend workflow, and then waits for an E2E result tied to that exact backend
and frontend pair. Production is never started before matching staging E2E.

Each integration uses a protected PR and required `Sandbox check`. Each workflow
result must match the saved release ID, operation ID, operation input hash, exact
commits, environment, role, unit, runner repository, run, attempt, and fixed
workflow commit. The journal saves an operation before dispatch and its verified
result afterward. Resume reuses a completed matching operation; it does not run
it again. A confirmed failure stops later steps and marks the release for a
person. Unknown effects keep the lock for explicit reconciliation.

When the final required E2E passes and owned branches are gone, the Coordinator
marks the selected ticket `status:completed` with `reason:release-completed`,
closes it, archives the full batch and release evidence, and releases the lock.
The first live run and the safe recoveries found during it are recorded in the
[September 11 acceptance report](./testing/release-sequence-2026-09-11.md).

This exists only in the two public sample repositories. Their workflows use fake
programs, fake data, read-only contents permission, and no product credentials.
Selecting `real` cannot enable this adapter. Connecting real repositories means
writing separate, narrow adapters for their existing Actions and completing a
new acceptance run.
