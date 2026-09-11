# Merge rehearsal and test repository plan

**Original merge-rehearsal scope prepared September 9, 2026; next stages updated
September 10.** The original bounded stage after inbox organization is complete.
[Progress](./progress.md) records what has actually run;
[the app guide](../apps/coordinator/README.md) lists commands that exist. The
engine merged in PR #26; the public sandbox follow-up completed live required-check
acceptance, and later integration delivered the one-command ticket workflow.

The one-ticket sandbox service/database stage is implemented and has local
Docker and live ticket acceptance evidence. [PR #45](https://github.com/6529-Collections/6529-release-coordinator/pull/45)
tracks Coordinator source delivery; the sample repository setup is merged. Batch acceptance remains
future work. Each stage's evidence is separate from the original MR milestone.
Documentation alone is not permission to execute external changes.

## What we will prove

This section records the original merge-only milestone. The implemented
[service/database stage](#service-and-database-acceptance) extends it below;
the [batch matrix](#planned-batch-acceptance) now has a sandbox implementation;
progress separates its local tests, live evidence and source delivery.

Given exact PR commits, an explicit destination in each repository, and an
explicit order, can Git combine those changes in temporary local repositories?
Can the Coordinator distinguish a clean result, a real conflict, and evidence
that is missing or has changed?

Use real Git for local tests, then real GitHub PRs in two small public test
repositories. Fake refers to their sample content; their branches, commits,
PRs, and CI checks are real. An empty production inbox does not prevent testing.

This stage produces a local report. A clean merge does not prove application
correctness, runtime prerequisites, deployment, or permission to release.

## Sequence and finish line

| Phase | Work | Evidence required before proceeding |
| --- | --- | --- |
| 1. Local implementation | Add the private input contract, isolated Git runner, report, and local fixtures. | Automated cases below pass using real temporary Git repositories. Existing tests still pass. |
| 2. GitHub setup | Create the two sample repositories, sample content, required CI check, and controlled PRs. | Exact repository identities, access, public visibility, rules, PR links, and check results recorded. |
| 3. Live rehearsal | Run the same engine against the real test PRs, including deliberate failures and updates. | Each required live case has an expected and actual result, exact commits, and saved evidence. |
| 4. Review and handoff | Repeat unchanged cases, verify boundaries and cleanup, update documentation, and integrate through normal PR checks. | Local and live results recorded separately; remaining limitations explicit; Coordinator implementation merged into `main`. |

The original merge-only milestone stopped after phase 4. Ticket integration and
sandbox service checks were delivered in the separately recorded stages below;
real live rehearsal acceptance and release execution remain separate work.
Do not keep adding cases to the completed MR matrix unless a concrete failure
or uncovered requirement justifies one.

## The two GitHub repositories

Owner: `6529-Collections`. Both repositories were created September 9; their
IDs, visibility, sample PRs, and current acceptance limits are recorded in
[progress](./progress.md). Setup verifies pinned ownership and empty repositories,
or resumes its recorded seed only after checking the exact baseline branches.
It does not overwrite an unrelated existing repository.

| Repository | Current sample content |
| --- | --- |
| `release-coordinator-test-frontend` | A small frontend consumer with an output assertion, earlier merge fixtures, and a generated copy of the shared test runtime. |
| `release-coordinator-test-backend` | Database schema/data definitions, worker and API programs, and `src/config/deploy-services.json` declaring `dbMigrationsLoop -> worker -> api`; also the pinned service-check workflow and generated runtime. |

Each repository starts with a recorded baseline on `main`. Add a test-only
`rehearsal-target` branch to prove that the selected destination matters.
Create new named branches and PRs per case; do not reuse an old PR by changing
its meaning. Record the actual baseline commits and PR numbers after setup.

The original merge-only fixtures used a minimal `Sandbox check`. The current
sample PR checks run meaningful program assertions with temporary MySQL using
the same generated runtime as the ticket checks. Keep `Sandbox check` with read-only
contents permission, no deployment or publication jobs, no product secrets,
and no dependency installation. Pin any Actions used to reviewed commits.
Require the check on the tested destination branches, disable force pushes,
and verify the rules are actually enforced. Private repository rules and
Actions availability must be checked during setup; if unavailable, record the
blocked live coverage rather than describing an ordinary check as required.
This account limitation occurred during the initial private setup. On September 9,
the user authorized making only these two sample repositories public. Their
pinned profile now expects public visibility, and `Sandbox check` is enforced
on both `main` and `rehearsal-target` in each repository. Clean merges still
remain `unknown` whenever the profile's named check cannot be verified as required.
See progress for the separate live acceptance result after this settings change.

The setup step is allowed to seed test branches and open/update test PRs once
execution is authorized. The rehearsal engine itself only reads GitHub and
fetches Git objects; it never pushes, merges a GitHub PR, dispatches a workflow,
changes settings, or writes a comment. The `inbox:run` command wraps that engine
with verified-ticket intake, automatic plan generation, and writes to the selected
inbox's ticket presentation and decision journal. For supported sandbox tickets,
the command also dispatches the pinned service-check workflow. PR setup naturally
starts the sample CI.

## Keep the test environment separate

Build one rehearsal engine with two named configuration profiles. The intended
operator switch is `RELEASE_COORDINATOR_PROFILE=sandbox` or
`RELEASE_COORDINATOR_PROFILE=real`. Both profiles now support verified inbox plans;
the [profiled inbox follow-up](./profiled-inbox-testing.md) defines that path.
Sandbox manifests remain a separate input. Require an explicit valid value;
missing or unknown values must
stop, never fall back to real repositories. Profile selection is separate from
the request's `staging`/`production` deployment target.

| Profile | Repositories | Input source | Rehearsal behavior |
| --- | --- | --- | --- |
| `sandbox` | The two public test repositories | Verified test inbox request with an automatically generated plan, or a validated private test manifest | Shared engine; temporary local merges and local reports. |
| `real` | The two fixed product repositories | Verified real inbox request with an automatically generated plan | The same engine and report contract; still no remote writes or deployment. |

The selected trusted profile supplies repository names/IDs and read adapters.
Its input adapter produces the same internal merge-plan structure, retaining
the input source and proof identity. Keep repository names and input loading
out of the merge algorithm; do not build a sandbox-only copy of the algorithm
and rewrite it for real repositories. Separate reports and temporary state by
profile, and never reuse sandbox results as real evidence. No arbitrary
repository override or mutation permission comes from this environment setting.

The original first milestone enabled only `sandbox`. The profiled inbox follow-up
has now implemented and tested the verified-input adapter for both profiles.
An operator selects the profile and supplies that profile's valid input; the
engine needs no changes. Real live proof remains separate. An environment change
alone cannot promote a test manifest into a verified inbox request.

The current public schema allows only `6529seize-frontend` and
`6529seize-backend`. The public npm CLI retains that real-only boundary. The
private Coordinator profile selects the corresponding readiness repositories
and inbox receipt verifier; sandbox JSON uses separate test names and a marker.

For this stage:

- Add a private, explicitly selected sandbox profile with the two exact
  repository names above. Reject product repositories, arbitrary owners/hosts,
  and mixed sandbox/product inputs. Record repository IDs as well as names
  after provisioning; verify returned identities and PR source repositories.
- Define a private test manifest with a case ID, frontend/backend roles, PR
  numbers, source branches, exact full commit IDs, explicit destination branches
  and commits, merge order, selected services, and part dependencies as needed.
  Validate its shape, duplicates, references, size limits, and dependency cycles.
- Label its input source `test-manifest` and its mode `sandbox` in every report.
  It is not a verified intake receipt and cannot enter `inbox:run` or either
  profile's decision journal. No fabricated workflow/actor proof is accepted.
- Keep GitHub reads behind the selected profile's read adapter. Use the same
  merge engine and shared pure inspection logic; do not make production adapters accept arbitrary
  repositories or caller-supplied API queries to accommodate tests.
- Keep the published package, public request schema, central intake workflow,
  and current ticket policies unchanged. No npm release or product edit is needed.

Two repositories are sufficient for this merge-rehearsal stage. This does not
retest the public CLI-to-inbox receipt path against new repositories. A future
full sandbox intake exercise would need its own isolated inbox and explicit
receipt/identity configuration; do not quietly send fake requests to the real
inbox or claim that local manifests prove submission works.

## Rehearsal behavior to implement

The engine is now part of the single operator command `inbox:run`, with a
verified ticket and automatically generated plan. Its old standalone command has been removed.
The original manifest-based matrix below remains available through the developer
fixture harness described in the app guide; it reads sandbox PRs and writes
local evidence only. Automated fixture tests run offline in the existing suite.

1. Validate the sandbox profile and manifest before accessing repositories.
   Require one explicit destination per repository. Never infer a branch from
   `target: staging`, a PR's base branch, or the local checkout.
2. Read each PR and destination. Verify repository/source identity, requested
   branch and exact commit, PR state, checks, and review evidence. A draft,
   closed, already-merged, or changed PR cannot silently become a passing case.
3. Record the initial facts and fetch the exact objects into fresh temporary
   repositories. Verify the fetched identities. Missing commits, incomplete
   history, or access failures are unknown evidence, not merge conflicts.
4. Start from each recorded destination commit. Merge PR commits sequentially
   in the explicit manifest order, using one documented Git merge method.
   The first version uses `ort` through Git's merge-tree operation and writes
   temporary two-parent commits in bare repositories, without a checkout.
   Record Git version and strategy. Do not switch strategies or
   choose another order to make a failed case pass. Validate part dependencies
   separately; service deployment order does not invent PR merge order.
5. Keep frontend and backend repositories separate. Record every intermediate
   result and final tree identity. A conflict records the step, commits, and
   affected paths. Do not resolve it automatically or silently omit a PR.
6. When a backend merge succeeds, read the catalog as data from that exact
   combined tree and inspect requested services/dependencies against it. Do not
   select one PR's catalog as a substitute. Missing runtime prerequisite proof
   stays unknown; no service gets deployed or silently added to the request.
7. Re-read PR heads, source/base identity, PR state, destination tips, checks,
   and review facts after the work. A change makes the observation stale; a
   failed recheck leaves it unknown. Preserve any earlier diagnostic result
   but do not present it as current evidence or silently update the input.
8. Collect the result, remove temporary resources, and finalize the bounded
   JSON/text report with the actual cleanup outcome. Preserve useful diagnostics
   on failure and recheck source repository boundaries. A cleanup failure must
   name the owned path and prevent a successful exit; a report-write failure
   must not skip cleanup.

Passing CI and a clean Git merge are separate observations. It is useful to
show that a merge was clean even when a required check failed, but the report
must make that blocker visible. A request spanning two repositories cannot
pass the rehearsal if one repository is conflicted, stale, or unverified.
GitHub check/review gates describe each PR against its own base branch; record
that branch. They do not prove the combined tree passed CI or that another
destination's rules were satisfied. Cases intended to pass use PRs targeting
the explicit destination. For a different destination, retain the local merge
finding but leave destination gate evidence unknown unless separately verified.

The final observation does not lock GitHub. Later execution must revalidate
the same destinations, commits, order, and method. A different merge method,
destination, or updated input requires new proof. This plan does not decide
when real `main` changes or how production artifacts are built.

## Local execution boundaries

Use a dedicated temporary directory per run, with cleanup in failure paths.
Do not run Git inside a user's product checkout or borrow its index, branches,
worktrees, hooks, or configuration. Fetch only from the explicit trusted
repository profile; local filesystem remotes belong only to offline fixtures.

Invoke Git and GitHub tools with validated argument arrays and no shell.
Isolate Git configuration and environment so inherited hooks, external merge
drivers, filters, credential output, or command aliases cannot run code from a
PR. Do not execute package scripts, builds, submodules, or repository tools.
Handle unsupported required filters/content explicitly rather than claiming
to reproduce a merge environment the runner did not support.

Bound subprocess duration, output, object retrieval, and request size; terminate
owned child processes on timeout or interruption. Keep credentials out of
reports. Support useful diagnostics without dumping raw credential-bearing
errors or entire file contents. Cleanup removes only directories owned by the
run. An abrupt process kill may leave an owned directory: document explicit
cleanup rather than deleting unknown directories during the next run.

## Report contract

The report records:

- Case/run ID, sandbox input source, manifest hash, Coordinator revision, Git
  version, start/end times, and overall rehearsal result.
- Exact repository IDs/names, PR URLs and numbers, requested/observed commits,
  destination refs/commits, and merge order/method.
- Per-step merge result, intermediate/final tree IDs, conflict paths, and a
  separate required-check/review observation. Compare trees for repeated runs;
  synthetic merge commit IDs may differ because of timestamps.
- Combined backend catalog identity and service/dependency observations where
  relevant, without inventing runtime evidence.
- Initial/final observations, named reasons for conflict, staleness, invalid
  input, or missing evidence, and the next action needed.
- Temporary-resource cleanup outcome and `release_authorized: false`.

Use the following rehearsal observations, never ticket statuses:

| Result | Meaning | Exit code |
| --- | --- | --- |
| `pass` | All requested rehearsal observations passed for this exact snapshot. | `0` |
| `blocked` | Stable evidence demonstrates a conflict or another named blocker. | `1` |
| `unknown` | Evidence or an operation needed to verify the result is incomplete. | `2` |
| `stale` | A recorded input or observed GitHub fact changed during the run. | `3` |

Invalid input is a usage error with exit `2`, before repository work begins.
An unrecoverable tool, report-write, or cleanup failure also exits `2`, with a
named operational error separate from merge findings. Otherwise, changed facts
make the overall result stale first; unavailable final identity/state evidence
makes it unknown. Once observation stability is established, a demonstrated
blocker takes precedence over other unknown checks; all checks must pass for
`pass`. Preserve per-check details in every case. No result means release-ready.

## Test matrix

`Local` means an automated fixture with real Git and controlled GitHub replies.
`Live` means the actual test repositories/PRs. Run all local cases; the marked
live cases form the bounded GitHub acceptance run. Controlled timing and tool
failures remain local so they are deterministic, not dependent on a lucky race.

| ID | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| MR-01 | One independent PR into its recorded destination | Clean final tree includes the requested change. | Local + Live |
| MR-02 | Two compatible PRs in one repository | Both changes included in the declared order. | Local + Live |
| MR-03 | PR conflicts with the destination | Blocked; exact PR, merge step, and paths reported. | Local + Live |
| MR-04 | Two PRs each merge into the baseline but change the same line differently | Each passes alone; the combined request is blocked. | Local + Live |
| MR-05 | PR is clean against `main` but conflicts with `rehearsal-target` | The explicit destination decides the result. | Local + Live |
| MR-06 | Frontend and backend both combine cleanly, with valid selected dependencies | Both trees and dependency observations recorded; no release authority. | Local + Live |
| MR-07 | Frontend is clean but backend conflicts | Whole rehearsal blocked; frontend result retained, nothing applied remotely. | Local + Live |
| MR-08 | Requested PR head changes after manifest creation | Outdated input identified; the new head is not silently substituted. | Local + Live |
| MR-09 | PR or destination changes during a run | Stale, preserving the initial and final identities. | Local |
| MR-10 | Checks/review/PR state changes during a run, or final read fails | Stale for changed facts; unknown for an unavailable recheck. | Local |
| MR-11 | Required sample CI fails | Failed gate visible even if the Git merge is clean. | Local + Live |
| MR-12 | Required CI pending/missing; review required or changes requested | No pass from incomplete or negative evidence. | Local; live pending where observable |
| MR-13 | Draft, closed, or already-merged PR | No passing candidate and no implicit reopening or ticket closure. | Local; live draft + closed |
| MR-14 | Wrong repository/source, mixed product/sandbox input, malformed SHA/ref, duplicate PR, absent destination, invalid/cyclic order | Rejected at the appropriate validation boundary; no unintended repository access. | Local |
| MR-15 | Commit unavailable, insufficient history, authentication/network failure, or partial API pagination | Unknown/error with a useful reason; never an empty-success or invented conflict. | Local |
| MR-16 | Backend PRs modify different parts of the catalog | Inspect the actual merged catalog, not either individual input. | Local + Live |
| MR-17 | Unknown service, invalid/cyclic dependency, or omitted runtime prerequisite | Invalid selection blocks; missing runtime proof stays unknown. | Local |
| MR-18 | Timeout, interruption, fetch failure, merge conflict, report-write failure, and cleanup failure | Owned resources handled; failure and any leftover path reported accurately. | Local |
| MR-19 | Hooks/configuration/filter/driver tricks, unsafe arguments, or secret-bearing tool errors | No unexpected executable runs, shell interpretation, or secret disclosure. | Local |
| MR-20 | Run an unchanged manifest twice | Same decisions and result trees; no GitHub writes or source branch/index changes. | Local + Live |
| MR-21 | Select either profile, omit/misspell the setting, or pass an input/report from the other profile | Both supported adapters use the same engine; no fallback, cross-profile proof reuse, or extra permissions. Real mode rejects test manifests and requires verified inbox input (implemented in the profiled inbox follow-up). | Local; live real-profile acceptance belongs to later integration |

For MR-04, create both PR branches from the same baseline and edit the same
single line to different values. For MR-05, change that line on the separate
destination branch. For MR-08, save the original manifest, then deliberately
push a new sample commit and rerun it. MR-16 should merge without a textual
conflict but produce a catalog that differs from both inputs.

The local boundary tests should assert the allowed Git/GitHub calls, compare
fixture source refs and worktrees before/after, and use markers to detect
unexpected executable hooks or scripts. Live before/after checks compare all
relevant refs and PR state around the read-only rehearsal. Separate authorized
fixture updates from those measurement windows.

## Evidence and completion checklist

Save raw local reports under
`.release-coordinator/merge-rehearsal/<profile>/<run-id>/`. Commit reusable fixture
builders/manifests without credentials; do not rely on ignored local output
as the only durable acceptance record. Record in progress, or a linked dated
test record, each case ID, result, Coordinator revision, exact PR/base/head/tree
identities, check-run links, timestamp, and any limitation. The sample repository
URLs are now public; earlier records describe the visibility observed at their run time.

- [x] Private engine and manifest/profile validation implemented and documented.
- [x] The engine takes a shared internal plan; profile selection and input proof
      stay outside it. MR-21 verifies switching boundaries; the profiled inbox follow-up adds real-profile fixture acceptance.
- [x] All MR local cases and existing package/Coordinator tests pass in CI.
- [x] Public package dry-pack contents remain the existing nine files.
- [x] Both sample repositories and their enforced check rules verified live.
- [x] All required MR live cases pass their stated expectations; expected
      conflicts and failed checks count as successful detection, not green merges.
- [x] Repeat runs and independent before/after reads confirm no rehearsal writes
      to GitHub and no source checkout changes.
- [x] Cleanup and error behavior verified, including a clearly reported leftover.
- Integration and current merge status: [PR #26](https://github.com/6529-Collections/6529-release-coordinator/pull/26),
  using the Coordinator's normal required PR checks. Local/CI and live evidence
  are recorded separately in progress and the dated test record.
- [x] Progress and command documentation describe the implemented limits;
      deferred cases are explicitly marked rather than counted as covered.

The [initial September 9 record](./testing/merge-rehearsal-2026-09-09.md) preserves
the private-run diagnostics and their missing required-check proof. The
[public sandbox acceptance record](./testing/merge-rehearsal-public-2026-09-09.md)
completes that proof: all 15 cases met expectations, with seven passing clean
cases and eight correctly blocked cases. Locally controlled timing/failure
cases retain the local coverage stated in the matrix.

Retain the two test repositories and reusable fixtures for later development.
After recording evidence, close temporary scenario PRs with a test reason when
that cleanup is authorized; do not merge or delete them automatically. Keep
known fixture refs available for reproduction. No repository deletion is part
of this plan.

## Later work remains separate

The [profiled inbox follow-up](./profiled-inbox-testing.md) implements the shared
input integration described below, with sandbox live proof and offline real-profile
tests. Its [dated acceptance record](./testing/profiled-inbox-2026-09-09.md) records
the completed sandbox ticket path; actual real-system acceptance remains
separate from the completed sandbox matrix.

Both profiles now accept verified inbox inputs and automatically generated
destination plans through the same adapter and engine. The combined `inbox:run`
workflow already uses fresh rehearsal results to update the same ticket. That
does not make current readiness results eligible or take execution ownership.
The implemented sandbox service stage below tests one complete ticket's service
order and database behavior through the same command. Its separate service
runner has local and live acceptance evidence; the Git merge engine itself
remains read-only outside its temporary local repositories. The separate batch
adapter now creates owned sandbox trial PRs; see the batch acceptance section.

Before a real rollout, verify real permissions and repository limits with a
separately authorized live read-only run. Real mode rejects test manifests and
requires its own request and destination proof. The profile switch requires no
second merge implementation. A rehearsal never starts ticket processing or
deployment on its own; the existing `inbox:run` command coordinates rehearsal
with ticket processing, while deployment remains absent.

Multi-ticket application checks, real release builds, release ownership,
scheduling, deployment, existing-runtime prerequisites, recovery, and the agreed but unimplemented rules in
[the execution design](./design.md#decisions-to-settle-before-execution) remain
outside this stage. The sandbox can be extended for those tests later, but the
success of the completed merge-rehearsal stage does not count as that later evidence.

<a id="planned-service-and-database-acceptance"></a>

## Service and database acceptance

**Implemented and tested September 10, 2026; sandbox only.** Coordinator source
delivery and merged sample setup are recorded separately. See
[progress](./progress.md) and the [acceptance record](./testing/service-database-2026-09-10.md)
for local, GitHub, and merge evidence. This
stage comes before [batch acceptance](#planned-batch-acceptance). Keep the two
existing sample repositories and their separate test inbox. Start with one
complete ticket, including its frontend/backend parts, exact PRs, selected
services, target, and dependencies. Use controlled new requests for changed
inputs; never edit an accepted ticket's JSON to turn it into a different case.
Start valid cases with `target: staging`, consistent with the sample catalog.
This remains an isolated simulation, not a change to a product staging environment.

### What exists and what the real backend teaches us

The earlier sandbox backend at `33dc26417355f53b8ba94f1d20c9bd9e3779edaa`
only checked `FAIL_CHECK` and declared `api -> dbMigrationsLoop`. That MR evidence
remains its own milestone. The new sample adds a real temporary MySQL check,
`dbMigrationsLoop -> worker -> api -> frontend`, and data/output assertions.
Normal sample PR checks use the same generated runtime as the ticket workflow;
the opposite repository uses its baseline sample in those individual PR checks.
Only the complete ticket run tests both exact candidate versions together.

The real backend was inspected at `main` commit
`5c990e9dbe762277cc13ecfa36f1bc9a58375eef` on September 10:

- Its [service catalog](https://github.com/6529-Collections/6529seize-backend/blob/5c990e9dbe762277cc13ecfa36f1bc9a58375eef/src/config/deploy-services.json)
  lists available deployment units and normal dependencies. For example,
  `ownersBalancesLoop` depends on `dbMigrationsLoop`; `api` also depends on
  `artworkDocumentationProcessor`. The sample below is a deliberately smaller
  dependency example, not the real backend's full graph.
- Its [instructions](https://github.com/6529-Collections/6529seize-backend/blob/5c990e9dbe762277cc13ecfa36f1bc9a58375eef/AGENTS.md)
  require sequential deployments in dependency order, waiting for success before
  continuing, and deploying backend dependencies before dependent frontend work.
  Deploy only relevant units; an omitted prerequisite needs verified existing
  state, not an automatic addition to the request.
- The [deployment workflow](https://github.com/6529-Collections/6529seize-backend/blob/5c990e9dbe762277cc13ecfa36f1bc9a58375eef/.github/workflows/deploy.yml)
  deploys one selected service and explicitly invokes `dbMigrationsLoop` for a
  database deployment. The [database handler](https://github.com/6529-Collections/6529seize-backend/blob/5c990e9dbe762277cc13ecfa36f1bc9a58375eef/src/dbMigrationsLoop/index.ts)
  can synchronize TypeORM entity definitions and run data/migration work.
  Database detection must include entity/schema changes, not just files named
  migrations. A normal service deployment is not an instruction to invoke every
  background business job once.
- Its [test setup](https://github.com/6529-Collections/6529seize-backend/blob/5c990e9dbe762277cc13ecfa36f1bc9a58375eef/src/tests/_setup/globalSetup.ts)
  starts temporary MySQL through Testcontainers. Reuse that approach with small
  fake data; do not copy the product database, credentials, or full application.

These observations inform test fidelity, not a requirement to copy the earlier
Release Bus architecture. Recheck product adapters before any future real use.

### Small executable example

The sample backend contains database setup/change definitions, a worker, and an
API. The sample frontend consumes the API result with a meaningful output check.
The catalog defines service dependencies; the ticket defines the frontend's
dependency on the backend. Keep service execution order separate from PR
merge order; a service edge does not invent an order between PRs.

```text
Validate the database answer and save the complete service plan
  -> prepare and verify temporary MySQL at the saved baseline, with fake rows
  -> apply and verify the requested database change, when needed
  -> run the selected worker and verify its result/version
  -> start the selected API and verify its result/version
  -> check the frontend against that API
  -> save the outcome and clean up owned test resources
```

The `yes` example adds a field to an existing table, preserves existing rows,
has the worker fill the field, and checks the API/frontend output.
The `no` example uses the baseline structure and verifies normal application reads/writes
without a release-specific schema change or one-off data conversion. Database
setup is still necessary for both cases. Upgrade an existing baseline as well
as proving clean setup; building an empty database from candidate code alone
would miss upgrade problems.

Run only selected services in a saved, deterministic dependency order. Verify
success and exact code identity before starting a dependent step. If a required
service is omitted, require matching baseline prerequisite evidence or hold the
request; do not silently deploy it. Keep database outcome, each service outcome,
and the frontend/backend integration result separate. A green workflow or API
health endpoint alone cannot replace the expected application/data assertions.

### Where the test database lives

The Coordinator repository owns the shared database setup, execution, result
checking, and cleanup code. The sample backend repository owns the sample schema
and data definitions and the `sandbox-service-check.yml` workflow. Its GitHub
Actions job creates a temporary MySQL container, seeds fake data, exercises the
exact candidate code, saves the outcome, and removes its owned resources.
Normal sample PR checks also use temporary databases. The explicit local Docker
acceptance runner creates equivalent temporary resources on the operator's machine.

There is no permanent sandbox database. A sample ticket's `target: staging`
refers to the sample service catalog; it does not select the product's staging
database. Real-backend tests and database execution still need real adapters
and their own verification. The sample schema and programs do not become a
production database by switching profiles.

### Database answers and decisions

Use the unchanged public `database_change` field. It describes release-specific
schema or data changes, not whether the application uses a database. The current
sandbox Coordinator compares the answer with the saved sample schema and data
definitions before executing. Real database detection remains future work.

| Input/evidence | Behavior before sandbox service execution |
| --- | --- |
| `no`, with complete supporting inspection | Use the established baseline database; run the selected services without a release-specific database update. |
| `yes` | Save the exact database change, run it against the baseline, and verify its effect before dependent services. An unspecified change or missing execution proof remains held. |
| `unknown` or incomplete inspection | Hold database/service execution with the missing fact and an owner. Never silently interpret uncertainty as `no`. |
| `no`, but inspected code changes the database | Record the disagreement and classify it as database-changing. Hold for a corrected request; preserve the original receipt. Do not silently rewrite its answer or execute as a no-database-change request. |

Use trusted, explicit fixture rules for entity/schema and one-off data-change
paths. Save both the declared answer and inspected evidence. Absence of a known
filename is not general proof that real code cannot change a database. Unknown
patterns stay unresolved; the sandbox rule set does not certify a real detector.

### Shared workflow, isolated execution, and evidence

The implemented stage extends `inbox:run` without another operator command,
manual plan file, or imported passing report. Keep shared inspection, dependency planning,
sequencing, stop/retry decisions, and evidence contracts. Trusted profile
configuration selects repositories and available actions. The new executable
actions are sandbox-only; `real` must refuse unsupported execution capability
while retaining its existing inspection/rehearsal behavior. A profile switch
does not implement or authorize AWS/product deployment.

The local Coordinator remains the manual controller. Live sample execution runs
on isolated GitHub Actions runners using temporary MySQL and the exact candidate
code; local fixture tests can exercise the same logic first. Reuse the sample
program checks in normal sandbox PR CI and in the one-ticket candidate run.
Do not impose this extra per-ticket full run on the later batch design by default.

The trusted runtime is pinned in `apps/coordinator/src/service-runtime-config.mjs`:
test backend repository ID, `sandbox-service-check.yml`, branch
`codex/sandbox-services-runtime-v1`, and an exact expected commit. GitHub dispatch
uses that branch; the controller verifies its commit before dispatch and verifies
the actual run commit afterward. Moving it requires an intentional code pin update.

No per-candidate branch or PR is pushed. Exact regular Git blobs captured from the
passing rehearsed trees are sent as bounded JSON input to the trusted workflow.
The job's own runtime is never loaded from a candidate branch. Candidates execute
in read-only, unprivileged Node containers with no outbound network; only their
program and fake JSON data are available. A separate temporary MySQL container
has no published ports. A trusted adapter mediates its data and validates results.
Container images are pinned by digest in `service-runtime.mjs`.

The trusted adapter validates both baseline and candidate database definitions
with `databaseSpec` before composing SQL. Change IDs are restricted to
`^[a-z][a-z0-9-]{0,60}$` and increments to integers from 0 through 100. These
restrictions are part of the SQL construction boundary; widening them requires
reviewing that boundary and the pinned runtime together. A killed container is
reported as unknown unless its cause and attribution can be verified; an exit
code alone does not establish a ticket defect.

The journal saves the exact service plan and unique attempt before dispatch
(introduced in `inbox-run-v3`, retained in the current v4 writer).
A lost dispatch response is reconciled, never blindly repeated. Subsequent runs
reverify the same workflow result; changed inputs require a different plan.
Lookup filters by the saved actor and creation time with a five-minute clock-skew
margin, and verifies complete pagination up to GitHub's 1,000-run search limit.
Incomplete, changing, or oversized results stay unverified; they never authorize
another dispatch or imply a missing run.
A ten-minute job limit, bounded MySQL probes, 15-second program limits and bounded
controller polling keep uncertain attempts visible for explicit reconciliation.
The result must match the runtime, actor, workflow job, attempt, exact plan,
service order, source versions, data/output assertions and cleanup. Skipped or
cancelled execution cannot pass. The controller rechecks ticket/PR/main inputs
before execution and before presenting its result.
The saved plan remains immutable, but those checks read the current destination
commits again. If `main` advances, the old result remains evidence for its saved
inputs and the current ticket result becomes stale. Comparing the saved plan to
itself would bypass that check. A new explicit run captures the new destination
and needs evidence for that exact combination.

Shared runtime source lives in this Coordinator. `sandbox/provision.mjs` copies
it into the sample repositories as a generated bundle; it is not an independent
implementation. Changes to bundled files require checked sample PRs, a matching
runtime branch and pin, and source comparison before acceptance. Candidate
code must not receive the Coordinator's inbox-write credentials or product
credentials. Tickets name services, not arbitrary commands or database URLs.
Use the existing schema and profile boundary; no public npm change is needed.

Record request/checksum, profile, exact base/PR/candidate commits, catalog and
test configuration, service order, baseline database identity, declared/observed
database classification, per-step start/result/version, workflow attempt and
links, final data/integration assertions, retry decisions, and cleanup. Bind a
cross-repository check to both exact frontend and backend versions. Changed code,
schema, baseline, order, or test configuration needs matching new evidence.

On a failed database or service step, stop dependents and save what changed.
An attributable program failure differs from unavailable infrastructure or an
unknown result. Resume only when saved state and completed effects can be
verified; do not repeat a one-off data update blindly. A failure after a database
change records the need for human recovery in a real release. Destroying an owned
temporary test database after saving evidence is cleanup, not proof of rollback
or permission to restore a real database automatically.

Ticket presentation belongs to the
[sandbox service/database outcomes](./inbox-processing.md#sandbox-service-and-database-ticket-outcomes).
Preserve the receipt and existing history. Existing `rehearsal:passed` continues
to mean Git rehearsal only; it must not become database/application proof.

### Acceptance and finish line

The [dated acceptance record](./testing/service-database-2026-09-10.md) records
which cases have offline, actual local Docker, and live ticket evidence. Tests
for wrong metadata, cancelled/skipped runs, and lost responses use controlled
adapters; they are not presented as all having happened live.

Run offline regressions with `npm run check`. For explicitly authorized local
Docker acceptance, run:

```sh
node apps/coordinator/sandbox/test-runtime.mjs --run-owned-containers
```

This creates owned temporary containers and saves evidence under
`.release-coordinator/service-development/runtime-cases/`. Normal Coordinator PR
CI stays offline; sample repository PR CI runs the shared temporary MySQL checks.
`prepare-cases.mjs --create-sample-prs` is a developer setup utility for the fixed
sandbox repositories, not a second inbox command. Its recorded PRs remain source
fixtures and never become verified tickets without normal submission.
Preparation saves its exact branch and commit before pushing or creating the PR.
A retry reuses that owned checkout/commit and looks up an existing PR before
creating one; ambiguous, closed, or changed PRs require explicit reconciliation.

The initial executor requires all four sample steps. An omitted prerequisite is
held; proving a pre-existing service can satisfy it remains unimplemented.

| Case | Required evidence |
| --- | --- |
| SD-01: No database change | A prepared baseline supports normal worker/API/frontend behavior; no release-specific database update runs and unrelated services do not run. |
| SD-02: Database change | An existing database upgrades successfully, original rows survive, and worker/API/frontend checks pass in the saved order on the exact requested versions. |
| SD-03: Unknown or false `no` | Unknown/missing inspection holds execution; a known entity/schema or one-off data change contradicting `no` is recorded and requests correction. No dependent service starts. |
| SD-04: Dependency selection and order | Unknown services, cycles, and invalid targets block. A missing prerequisite stays held; resolving it from existing runtime evidence is not implemented. Wrong ordering cannot pass; omitted services are never silently selected. |
| SD-05: Database failure or partial effect | Record the failed update and observed database state; dependent services never start. Preserve recovery evidence and do not claim automatic rollback. |
| SD-06: Service failure, timeout, or missing result | Stop dependent steps. Separate a reproducible program failure from runner/evidence uncertainty; report the exact step and next-action owner. |
| SD-07: Repeat and interrupted retry | Same verified operation does not duplicate a one-off data change or ticket decision. Resume checks exact inputs and prior effects; ambiguous state holds instead of rerunning blindly. |
| SD-08: Application and version proof | Reject incorrect data/output, a frontend/API mismatch, wrong service versions, stale results, and skipped/cancelled required checks. A baseline-only failure is not blamed on the ticket. |
| SD-09: Profile boundary and cleanup | Local and live evidence remain separate; real execution and cross-profile resources are rejected. Only owned temporary resources are cleaned after success/failure/interruption, with outcome saved before deletion. The run issues no writes to source PRs, product environments, or the real inbox; independent activity is recorded separately. |

The recorded local and live cases meet this stage's finish line: one complete
sandbox ticket path, controlled cases, visible reasons, saved evidence, and
verified cleanup. Their evidence layers and limits are listed in the acceptance
record. This proves small program behavior and Coordinator decisions against
temporary MySQL. It does not
prove production data compatibility, AWS deployment, real runtime prerequisites,
or recovery. Source delivery through normal PR checks and merge precedes the
existing non-database batch matrix.

## Planned batch acceptance

**Batch acceptance requirements, implemented in the sandbox stage September 10,
2026.** See [progress](./progress.md) and the [dated batch acceptance record](./testing/batch-2026-09-10.md) for
which cases have offline versus live proof. This section follows the
[batch-selection design](./design.md#proposed-batch-testing-and-selection) and
[proposed ticket outcomes](./inbox-processing.md#proposed-batch-ticket-outcomes).
It does not change the completed MR matrix or its dated evidence above.

The subsequent [20-case stress campaign](./testing/complex-corner-cases.md)
records individual results, test layers, the reproduced ownership race, and
unsupported future behavior. Its local simulations do not upgrade earlier
evidence into live GitHub race or release-execution proof.

The [one-ticket service/database matrix](#service-and-database-acceptance)
has local and live evidence and its source merged in PR #45 before batch work.
The batch implementation uses the same two sample repositories, test inbox,
initial checks and meaningful application checks. All cheap ticket/database/Git
filtering precedes temporary PR CI; there is no extra per-ticket service run in
the unscoped sandbox path.

If the combined trees have no changes against saved main, hold the candidate
during cheap preparation with a Coordinator-owned explanation. It cannot create
a useful temporary PR, so do not run services or infer a pass from an empty list
of PR checks. Fresh and reused passing batches require at least one recorded,
verified trial. An unchanged repository may still be covered by the combined
service run when another repository has a verified trial.

Use independent requests without database changes first. Earlier one-ticket
database proof does not authorize database-changing batches. Select whole tickets
and validated dependency groups. Define the trusted representation of dependencies
between tickets before adding those fixtures; the public schema does not already
provide it. Keep the shared profile/engine direction, but only the sandbox's
temporary branches, PRs, checks, ticket projection, and owned trial state are in
this stage. The sandbox adapter has those restricted repository-write capabilities.
The policy saves limits, verifies the required workflow/commit/tree and service
results, and closes/removes only owned trials. Merely reading a workflow name is
not proof its required checks ran against the intended combined commit.

Create a deterministic sample incompatibility: A and B each pass their normal
checks against the same baseline; A+B merges without a Git conflict but fails a
meaningful test. Record the exact code and all three check results. Separate
passing groups must never be used as a substitute for testing their union.

| Case | Expected evidence |
| --- | --- |
| BA-01: Several compatible requests | One initial full combined check run per affected repository, beyond ordinary source-PR CI; no extra full run for each ticket by default. Exact final candidate passes. |
| BA-02: Obvious initial blocker | Existing check/version/scope/merge gates exclude the whole ticket with a reason before expensive combined tests. |
| BA-03: One reproducible failing independent ticket | A failing larger batch is divided within limits, a valid passing candidate survives, and the attributable blocker is recorded only where supported. |
| BA-04: Both halves pass but their union fails | Do not assume passing groups work together or invent a culprit. Retain a verified candidate using the saved priority and explain the incompatible combination. |
| BA-05: A/B incompatibility and changed base | A passes, B passes, A+B fails. B waits when A is selected. In an isolated fixture simulate A becoming the base; B's subsequent attributable failure becomes action-needed. Baseline-only failure must not be blamed on B. No actual sandbox `main` merge is needed. |
| BA-06: One ticket contains multiple frontend/backend PRs | Splitting never drops a part, PR, or selected service from a ticket. Rebuild each candidate's complete service plan. |
| BA-07: Requests must ship together | Inseparable work stays inside one complete ticket. The first implementation does not accept cross-ticket dependency declarations; a trusted representation and group acceptance remain deferred. |
| BA-08: Changed candidate inputs | Changed base, PR commit, membership, order, scope, or required workflow configuration cannot inherit a pass from different inputs. Source-head movement never silently replaces the accepted version. |
| BA-09: Search reaches a limit | Stop at the configured attempt/time limits. Preserve a verified candidate if present; otherwise none proceeds. Untested/excluded tickets stay visible with incomplete-investigation reasons. |
| BA-10: Infrastructure or evidence failure | Runner outage, pending/missing result, baseline failure, and unavailable proof do not become individual code blame or automatic group splitting. Bounded retries and maintainer ownership are recorded. |
| BA-11: Repeat or resume | Preserve priority, attempts, saved inputs, budget and comment identities. Unchanged observations do not duplicate decisions/comments; inconsistent or unknown state stops safely. |
| BA-12: Temporary PR/check lifecycle | Verify owned branches/PRs, expected check identities and combined commits, missing/skipped required-check rejection, clean completion and interruption cleanup. Temporary PRs never merge; source PRs/branches remain unchanged. |
| BA-13: Profile and release boundaries | Mixed profiles/targets, real inbox writes, unsupported database groups, deployment/publication jobs, and release authorization are outside the sandbox run and rejected or explicitly held. |

Record expected/actual outcome, exact inputs, selected and excluded ticket IDs,
candidate/parent attempt, priority, budget, workflow/check links, original/final
ticket presentation, and cleanup for each case. Separate local fixture proof from
live GitHub proof. The finish line is a bounded search that returns a directly
tested candidate or an honest no-candidate result, with correct visible outcomes
for every deferred request. It is not proof of the largest possible batch or of
release readiness. Stop before product merges, shared-environment mutations,
deployment, and the agreed execution rules still requiring implementation.


## History storage acceptance

**Next refactor, planned September 11; none of these archive cases has run.**
Use the actual journal/batch code with controlled GitHub responses first. Then,
when separately authorized, verify migration and repeat behavior in the isolated
sandbox inbox. Never migrate the real journal as part of offline tests.

| Case | Expected result | Status |
| --- | --- | --- |
| More than 100 completed batch histories | Archive finished records and accept later work without a lifetime stop. Keep per-search budgets enforced. | Not run |
| Active work among completed histories | Running/uncertain operations, pending ticket writes and cleanup remain active; `finished` selection alone cannot authorize archiving. | Not run |
| Same exact batch after archive | Load its original record on demand, revalidate remote proof, preserve attempt IDs/budgets and avoid duplicate PRs, workflows or ticket decisions. | Not run |
| Missing, altered or wrong-profile archive | Stop with a specific evidence error; do not treat it as first use or trust a pass from a different inbox. | Not run |
| Archive save fails or response is lost | Preserve active evidence or reconcile the already-committed archive/reference pair; no lost or duplicate authoritative record. | Not run |
| Competing writer during compaction | At most one non-force commit advances; the loser does not discard data or proceed with external actions. | Not run |
| Subsequent ordinary journal writes | Preserve all archived files and verify their references instead of recreating a state-only tree. | Not run |
| Existing v4 migration and older writer | Preserve receipts, transitions, service/batch identities and budgets. Older writers reject the new marker before mutation. | Not run |
| Standalone service history and linked records | Archive only fully finished, unneeded records; preserve active references and prevent the existing 1,000-record cap becoming another lifetime stop. | Not run |

Finish when these cases pass, current repeat/resume/cleanup behavior remains
covered, and an authorized live sandbox migration/repeat proves the same path.
Keep local fixture results, live evidence and merge status separate in progress.
Do not rerun product deployments or the full historical campaign for a storage
change unless a concrete failure justifies it.

## Later execution acceptance

These are future sandbox requirements, not tests already run or permission to
deploy. Build the same coordinator sequence against test-repository Actions
before connecting product workflows. See the [execution design](./design.md#agreed-execution-direction-september-11).

| Case | Required outcome |
| --- | --- |
| Compatible batch through staging then production | Cheap filtering precedes combined PR checks; ordinary staging merges/Actions run; production starts only after matching successful E2E and authorization. Environment-specific builds remain workflow-owned. |
| Required E2E fails, is missing, cancelled or skipped | No production dispatch or successful release. A failed test fails the attempt; uncertain evidence gets its actual reason without blaming all tickets. |
| E2E belongs to another run, code or environment | Reject it even if green. Changed staging during tests requires fresh matching evidence. Cover frontend-only, backend-only and coupled work. |
| Main/staging moves or contains unrelated changes | Preserve shared history; recheck actual compositions before mutation and invalidate unmatched evidence. Never overwrite refs or promote all of staging. |
| Sequential services and partial failure | Backend dependencies succeed before dependents/frontend; record partial effects and stop/recover rather than starting another batch. |
| No-database-change rollback | Save prior deployed versions per service/environment; create verified revert commits, run required checks and ordinary deploys, then check recovery versions/health/E2E. Original release stays failed. |
| Database change/unknown, conflicting revert or failed recovery | Stop automatic recovery for a person; keep release ownership while unresolved. Never blindly reset branches or restore incompatible code. |
| Worker merges its own request / resumes / receives a new ticket | Retain execution ownership after PR merge, reconcile existing runs without duplicates, and keep the next release waiting until completion/recovery. |
| Staging-only success and later production request | Stop after staging. Require explicit production authorization and revalidated composition/evidence for later continuation. |
