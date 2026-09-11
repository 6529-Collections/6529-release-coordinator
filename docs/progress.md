# Progress and next steps

Last updated: **2026-09-11**. Evidence below carries its own date; the earlier
package and consumer observations were not all rechecked during this update.
Runtime behavior comes from code and live evidence. The [ticket contract](./inbox-processing.md) describes the local manual processor;
[execution design](./design.md) remains future work. There is no always-on release
worker; each manual run exits after its work.

## Controller and history cleanup, September 11

**Implemented and verified locally on `main`; not pushed or live-migrated.** No remote inbox,
product repository, workflow dispatch, package publication or deployment changed.
Live sandbox journal migration/repeat remains a separate acceptance step.

- Batch rechecks now use only the frozen eligible ticket pool. Unsupported or
  over-limit tickets still receive reasons but cannot invalidate an unrelated
  candidate through changing PR evidence. Included tickets still get exact input,
  destination and remote proof checks.
- The main processor now orders named scan, preparation, batch and presentation
  steps. Ticket writes remain journaled and verified. This is a source split,
  not a new framework or another operator command.
- The v5 journal keeps complete active work and a compact history index. Finished
  batch/service records move to checksum-named files in the same Git branch only
  after verified cleanup and ticket presentation. Exact repeats load original
  attempts and budgets on demand. Later observations get new immutable snapshots.
- Archive and index changes use one non-force commit based on the prior tree,
  followed by readback. Failed saves preserve active evidence; a lost archive ref
  response can be reconciled only to the exact intended commit. Older writers
  reject the v5 marker. No heartbeat or automatic process takeover was added.
- Persistent 100-batch/1,000-service caps are removed. The per-search limits remain
  10 tickets, 10 PRs per repository, 40 Git attempts, 12 check rounds and 45 minutes.
  Compact references and ticket transitions still grow; this is not an unlimited
  storage claim. No separate database, dashboard or retention service is needed now.

Targeted verification passed, covering excluded/included evidence,
exact archive reuse, more than 100 batches and 1,000 services, active cleanup and
linked records, missing/corrupt/wrong-profile archives, failed/lost saves,
competing writers, preserved files and v4 migration. Final review added explicit
archive-readback uncertainty and full-processor v4 resume checks; all 16 history
tests passed. Recovery messages now ask the operator to inspect the lock instead
of assuming a failed final readback means it is still held. See
[history acceptance](./merge-rehearsal-testing.md#history-storage-acceptance).
Full `npm run check` passed on **Node 22.16.0: 395 tests passed, three optional
Docker tests skipped**. Non-fixing lint, formatting, structural workflow policy,
packed public-CLI installation/startup/schema checks, and the source-preservation
check passed. Documentation file links, diagram JavaScript syntax and
`git diff --check` also passed. No live archive acceptance is claimed.

## Implementation alignment review, September 11

The preceding documentation commit `bbc644d` aligned the release design with
existing product Actions: environment-specific builds, successful matching
staging E2E before production, one release through completion/recovery, and
verified revert commits only for confirmed no-database-change rollback. The
local history and controller changes above now address its immediate storage
refactor and the subsequent implementation review. No release executor exists.

### Build with the later execution step

- **Actual staging/main integration:** current plans rehearse against `main`;
  product Actions use `1a-staging` and `main`. Inspect actual compositions before
  pushing, preserve unrelated staging changes, and revalidate changed bases.
- **One release lane and deployment ownership:** the current lock lasts one
  inbox command, not a release across staging/E2E/production. Future worker-owned
  requests must survive their own PR merges rather than being retired by intake's
  `already-merged` rule. Keep today's intake behavior until that ownership exists.
- **Workflow and E2E adapters:** the current batch policy/checks are explicitly
  sandbox-only. Reuse product Actions with verified run/version identities,
  sequential services, matching E2E gates and backend-only E2E coverage. A profile
  switch alone cannot enable this. Preserve product release-note metadata.
- **Rollback evidence:** there is no real deployed-version snapshot, revert or
  recovery executor. Save previous deployed versions per environment/service,
  verify safe restoration, and test the ordinary deploy path before real use.

These are missing execution features, not regressions in today's sandbox path.
Keep current cheap-before-expensive ordering, whole-ticket selection, exact-input
checks, remote proof revalidation, no-database-change batch scope, logs and
stop-before-resume behavior. No broad refactor or request/CLI change is needed
for the agreed direction. Cross-ticket links and database-changing batches stay
deferred. After live history acceptance, exercise the execution sequence in test
repositories before enabling real adapters.

## v0.1 run logging, September 11

Pre-merge review in [PR #61](https://github.com/6529-Collections/6529-release-coordinator/pull/61)
corrected trial workflow links and removed the workflow definition ID from the
dispatch event; `workflow_id` in logs identifies a run. It also closes a batch
evidence gap: when combined trees have no changes against saved main, cheap
preparation holds the candidate before CI/services. A passing or reused batch
must contain at least one verified temporary PR. The inbox fixture now records
trial PRs, and its repeat assertion requires remote evidence revalidation.
Live output inspection also led to explicit service names in terminal result lines.
The updated full local check passed on Node 22.16.0: **376 passed, 0 failed,
3 opt-in Docker cases skipped**, with all other check phases passing.

Implemented [live and saved run logs](./design.md#next-step-v01-run-logging) in the
existing `inbox:run` command. Events show meaningful steps starting and finishing,
verified versus uncertain outcomes, ticket/PR/workflow and attempt identities,
step durations, interruption and actual cleanup. Logs live outside checkouts at
`~/.6529-release-coordinator/logs/PROFILE/INBOX_REPOSITORY_ID/RUN_ID.jsonl`.
Explicit resume appends history and preserves the original attempt IDs. JSON stdout
stays machine-readable; progress goes to stderr and the final result names its log.

The real input-verification path now names the repository whose `main` changed
and its saved/current commits. A stale batch's ticket reasons also report verified
trial cleanup or remaining work. This addresses the explanation gap from CT-05;
the earlier dated campaign remains unchanged. Missing current-commit evidence
stays unknown rather than being described as a verified branch change.

Added ten logging acceptance tests using the real CLI/journal/selection/check
logic with controlled GitHub responses; trial cases prepare actual temporary Git
repositories. They cover lost dispatch responses, partial cleanup, explicit resume
without duplicate service execution, private separated paths, redaction, JSON output,
a crash-truncated log and disk failure. A startup storage failure stops before inbox
work; a mid-run log failure preserves existing journal/cleanup work and returns
exit `2` with `logging.complete: false`.

The full `npm run check` passed on **Node 22.16.0: 374 passed, 0 failed,
3 opt-in Docker cases skipped**, plus lint, formatting, workflow policy, packed
CLI/schema smoke checks and source preservation. The ten new cases passed, and
CT-10 still proves recovery after a lost response/save with optional runtime
metadata. Evidence: `.release-coordinator/run-logging-check.log`. These are local
checks; the Docker cases were not rerun for this logging-only change.

The initial logging commit `40d7d86` included the implementation, earlier
corner-case tests and documentation. It did not itself run live acceptance.
Source delivery is tracked in [PR #61](https://github.com/6529-Collections/6529-release-coordinator/pull/61),
which also includes the earlier bounded batch work. The existing journal writer, profile permissions, batch budgets and
manual stop-before-resume rule remain. Logs do not solve CT-09's overlapping-process
gap. No heartbeat, board, ownership lock or automatic recovery was added.

The authorized [live logging acceptance](./testing/run-logging-2026-09-11.md)
passed with sandbox ticket #13: exact backend/frontend trial CI and all four service
steps passed, temporary PRs/branches/database were removed, and the journal was
unlocked. The private log contains 122 complete events, including real CI links and
start/finish evidence. Exit 2 correctly retains older ticket #1's existing hold;
ticket #13 passed. The owned test ticket was then retired with `--close-test`,
preserving its request, comment and batch history. Only older #1 remains open.
Source PRs, test main refs, runtime and the real journal were unchanged.
The latest code check at `21cf6f3` also passed [GitHub PR CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34570629958)
on Node 20/22/24 and the required gate. See the acceptance record for the tested
source and subsequent display/evidence fixes. No package publication or deployment ran.
[Links between separate tickets](./design.md#deferred-links-between-separate-tickets)
remain later work: directional prerequisites and inseparable groups use immutable
request IDs and initially require prerequisites in the same tested batch. CT-20
remains partial until that feature and its submission integrations are implemented.

## Complex corner-case campaign, September 10

Ran [CT-01 through CT-20](./testing/complex-corner-cases.md) sequentially on the
local `codex/bounded-sandbox-batches` branch after commit `1697d3b`. **17 passed
at their recorded layer, 2 were partial, and 1 ownership gap was reproduced.**
Most tests use controlled GitHub responses and real Coordinator logic; five also
use temporary Git repositories. Three cases ran actual local Docker/MySQL, and
CT-12 re-read an existing passing GitHub workflow without dispatching new work.
The tests created no remote resources; all owned local containers were removed.

CT-09 confirms that replacing a paused process's journal token cannot fence a
GitHub write already past its last ownership guard. Stop the previous process
before explicit recovery, as the current command requires; takeover of a still
running process is not proven safe. CT-05 holds stale code and cleans trials,
but its generic reason does not name the moved repository base. CT-20 verifies
rejection of unsupported cross-ticket declarations; future dependency-aware
splitting remains unimplemented.

Added repeatable CT assertions and shared test fixtures. At this campaign checkpoint,
the changes were local and uncommitted, with no production source change; they are
included in the logging commit recorded above. The full `npm run check`
passed on Node 24.19.0: **364 passed, 0 failed, 3 explicit Docker cases skipped**
in the offline suite, plus lint, formatting, workflow policy, package smoke and
source-preservation checks. Those three Docker cases each passed separately in
the sequential campaign. Log: `.release-coordinator/corner-cases/repository-check.log`.
This is local validation, not pushed PR CI, a merge or a deployment.

## Sandbox batch implementation, September 10

The service extension merged in [PR #45](https://github.com/6529-Collections/6529-release-coordinator/pull/45)
at `02fb6a645a4dd40d909f8346e06eba7057a01333`; this batch work started from that clean main.
Local branch `codex/bounded-sandbox-batches` extends the same `inbox:run` command.
Without `--issue`, sandbox runs finish cheap ticket/scope/database and Git conflict
filtering before normal CI on temporary combined PRs and combined service checks.
`--issue` keeps the one-ticket path, including supported database changes.

The implementation saves whole tickets, exact inputs, deterministic Issue-number
order, temporary PR identities, attempts and cleanup in `inbox-run-v4`, preserving
v3 service history. Limits are 10 tickets, 10 PRs per repository, 40 combined Git
attempts, 12 candidate check rounds and 45 minutes to start new rounds. Only
confirmed code failures with a passing unchanged baseline trigger splitting.
Every selected final combination has its own passing evidence; excluded tickets
retain reasons, ownership and check links. No source PR is merged or altered.

The full local `npm run check` passed **347 tests on Node 24.19.0**, lint,
formatting, workflow policy, packed CLI/schema smoke checks and source preservation.
The 33 new tests include actual temporary Git repositories, cheap-before-expensive
ordering, splitting and attribution, limits, repeat/resume, GitHub identity and
cleanup verification, and the complete inbox/journal/presentation path.
Live [sandbox acceptance](./testing/batch-2026-09-10.md) verified a compatible
pair, a repeat with no duplicate tests/comments/decisions, and an A/B pair whose
combined code fails while each complete ticket passes alone. The bounded search
selected #11 and left #12 waiting as incompatible after exactly three candidate
rounds. Recovery reused existing PRs after a GitHub server error and after fixing
an overly strict check of descriptions appended by CodeRabbit. All eight trial
PRs were closed unmerged, temporary refs removed, and all source heads and
protected refs were unchanged. At this September 10 checkpoint, source delivery
was limited to the local branch. The later PR checks and logging acceptance are
recorded above; this earlier snapshot does not claim them or a deployment.

Cross-ticket must-ship-together declarations remain unsupported; inseparable work
belongs in one complete ticket. Database-changing batches, real adapters and
release execution remain future work.

**Baseline before the sandbox service extension:** [PR #40](https://github.com/6529-Collections/6529-release-coordinator/pull/40)
merged September 10 at `430cae629fac12fe78a57bc57e00d3ef411c6742`.
The unified `inbox:run` workflow and this repository's code checks are on `main`.
The merge and successful [post-merge main CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34450016915)
were rechecked September 10; local `main` was at that merge before this work.
The service/database extension is implemented and tested; its
[source delivery](#sandbox-source-delivery-september-10) is recorded separately
from the earlier acceptance snapshots.
No package publication or product deployment was part of the merge.

## Coordinator code checks: merged, September 10

Delivery completed in [PR #40](https://github.com/6529-Collections/6529-release-coordinator/pull/40),
from `codex/coordinator-pr-checks`, based on PR #31's September 9 merge
`8d13a69a9cb6ea919a4bfd8f9f0c67d466a77056`.
Implementation commit `4f06ed35dc7bbe509e90b2a4726f92312c06749f` passed
[GitHub PR CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34449207007)
on September 10: 287 tests on each of Node 20, 22, and 24, with all other check
phases successful. The required `Check package` gate passed and publication
was skipped. Final source head `f893f0154fb78f98dbb8ac524e76dd2d21e921c4`
merged at **07:27:06 UTC on September 10**, producing the current baseline above.
[Post-merge main CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34450016915)
passed all three Node jobs and `Check package` at that exact merge commit;
publication was skipped. These remote results were read back during this update,
not rerun as part of documentation housekeeping.

Pre-merge review corrected the extra-privileged-job test fixture to clone its
job and assert the job-allowlist error, so YAML alias rejection cannot satisfy
that test accidentally. The delivery record also now separates local validation
from the verified GitHub run above.

`npm run check` combines JavaScript lint, formatting checks,
all discovered test files, structural workflow policy checks, and an isolated
smoke install of the packed public CLI. See [code checks](./code-checks.md).

The PR workflow runs the full command on Node 20, 22, and 24 and keeps the
required `Check package` name. Its final gate rejects failed, cancelled, or
skipped verification. Intake Issue permission is scoped to its writer job;
intake installs production dependencies only. Publication is still manual,
limited to `main`, and protected by its environment and successful checks.

Local validation passed with **287 tests on each of Node 20.20.2, 22.23.2,
and 24.21.0**, using the full `npm run check` command. Each run also passed lint,
formatting, workflow policy, the offline packed-package install, and the source
unchanged check. The test count replaces two old workflow text tests with 34
structural-policy, package-allowlist, and source-preservation tests. Deliberately
invalid JavaScript and formatting also made the full command fail as expected.
`npm ci --ignore-scripts` passed and reported no audit findings for this lockfile.
Existing production dependency lock entries are unchanged.

Existing JavaScript received a one-time formatting baseline plus small lint
cleanups. Parsing comparisons separated formatting from the few code/test edits.
No inbox, product PR, package publication, or deployment command ran. An initial
local path named `node@24` actually resolved to Node 25.6.1; its successful run
was not counted as Node 24 evidence. The listed 20/22/24 runtimes were downloaded
from nodejs.org with archive SHA-256 checks and verified separately.

The live [Protect main ruleset](https://github.com/6529-Collections/6529-release-coordinator/rules/22272421)
was updated and read back September 10: **Check package** remains required from
GitHub Actions, and an **up-to-date branch is now required**. Other rules and
bypass settings were preserved. The publication environment still allows only
branch `main`. This server rule is active. The new command and workflow passed
PR and post-merge main CI as recorded above. This code-check delivery is complete.

## Merged one-ticket workflow and its earlier acceptance evidence

`inbox:run` replaces both old operator entry points. It inspects tickets,
automatically creates a plan from each suitable ticket and the profile-configured
current `main` commits, rehearses its exact PRs, and updates the same ticket and
journal from fresh evidence. There is no operator plan file. Missing configuration
or evidence gets a clear reason. Read-only diagnostics remain available.

Before PR #31 merged, all 255 local tests passed (26 package, 229 Coordinator).
The command passed twice on live sandbox ticket #1 with no supplied plan file.
Each generated plan was saved before Git. Both runs preserved the same ticket,
comment, and two historical decisions, and left all sample PRs/branches and the
real inbox/journal unchanged. The journal upgraded to `inbox-run-v2`, preserving
history and preventing old writers from replacing the new run format. See the
[automatic planning evidence](./testing/unified-inbox-2026-09-09.md#automatic-planning-follow-up).
A passing rehearsal remains separate from release authorization and deployment
proof. Public npm remains at the previously published `0.0.4`.

## Sandbox services and database, September 10

**Implemented and tested; see [source delivery](#sandbox-source-delivery-september-10)
for the Coordinator PR and CI, separate from sample-runtime merges.**
The same `inbox:run` command now follows a passing supported sandbox rehearsal
with temporary MySQL, a selected database step, worker, API and frontend checks.
The local controller dispatches a fixed, pinned GitHub Actions runtime and binds
its result to the exact ticket, candidate sources, baseline and execution order.
The public request schema/npm package and real execution capabilities are unchanged.

The `inbox-run-v3` journal saves each service plan and attempt before dispatch.
Retries reverify the same run, including after a lost dispatch response, instead
of blindly repeating effects. New `services:*` labels and reasons show service
results separately from Git rehearsal. Passing checks leave the ticket waiting.
Unknown or contradictory database answers, missing prerequisites, stale input,
unverifiable runtime output and cleanup uncertainty cannot become success.

The [acceptance record](./testing/service-database-2026-09-10.md) contains the
local and live matrix, exact runtime/source pins and fixture links. Seven actual
local Docker cases passed their expected assertions: no change, upgrade with an
idempotent one-off update, partial schema failure, API failure, frontend mismatch,
timeout, and candidate isolation. Expected failure cases stop dependent steps,
retain the observed database state and remove only owned temporary resources.
Offline tests also cover malformed input, missing/wrong metadata, skipped or
cancelled execution, stale input, durable dispatch and repeated ticket handling.
The final `npm run check` passed **306 tests on Node 24.19.0**, lint, formatting,
workflow policy, packed CLI/schema smoke checks and source preservation.

The sample repositories receive a generated copy of the shared runtime and
meaningful normal PR checks. They do not host a separately maintained algorithm.
All seven live ticket cases produced the expected outcomes: two passes, a
partial database failure, an API failure, and three holds for unknown/incorrect
answers or a missing prerequisite. Four exact service workflows ran; retries
reused them and the held cases started none. The first live run caught a log
transport issue, which was fixed and rechecked against its saved run. One intake
queue timeout was cancelled and reconciled before a successful controlled retry.
See the linked record for cleanup and protected-resource verification. These
results do not imply a Coordinator source merge. All seven new test tickets are
closed, the sandbox journal is unlocked, all local containers are removed, and
the six source fixture PR heads and real inbox journal are unchanged. Product
main refs advanced independently during the test window; no product writes or
deployments were issued by this task.

The real backend reference remains pinned in the
[service/database guide](./merge-rehearsal-testing.md#service-and-database-acceptance).
This fixture models order, baseline upgrades and data/output checks. It does not
prove AWS deployment, real database change detection, persistent service health,
existing-runtime prerequisites or real rollback. Missing prerequisites remain
held. Source delivery through normal PR checks and merge precedes bounded batches
of complete requests without database changes. This historical snapshot predates
the batch implementation recorded above; no separate batch command was added.

## Documentation alignment, September 10

The housekeeping update aligned guides and diagrams with the implemented and
tested sandbox service/database checks. At that point Coordinator source was
still uncommitted; merged sample setup and live results were recorded separately.
The testing guide
also identifies where temporary MySQL runs and separates the sample `staging`
target from a product staging database. Older section links remain valid.

The next sequence at that checkpoint was delivery of the service extension, then
bounded sandbox batching without database changes. Historical acceptance records remain dated evidence;
real service execution, deployment, and recovery remain future work. This
housekeeping changes documentation only; the earlier 306-test result is not a
new test run, and external state was not rechecked for this wording update.
Documentation validation checked 148 local file/section links across 13 changed
documents and the three retained legacy anchors. All passed; `git diff --check`
also passed.

## Sandbox source delivery, September 10

The accepted implementation and documentation were committed without signing as
`af5117f29cad4c036fc509b4ff5c0af557c8c5df` on `codex/sandbox-service-checks` and
submitted in [PR #45](https://github.com/6529-Collections/6529-release-coordinator/pull/45).
That PR is the source of truth for its current review, check, and merge state.
The existing [306-test local acceptance](./testing/service-database-2026-09-10.md)
precedes the PR; it does not substitute for GitHub CI.

The first [PR CI run](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34470317468)
passed on source `af5117f`: 306 tests and the full check command on each of Node
20, 22, and 24, followed by the required `Check package` gate. Publication was
skipped. Later commits require their own passing checks; the PR records those
results and review resolution. The delivery-note update passed 155 local links
across 13 documents and `git diff --check`.

Before submission, remote `main` still matched the recorded `430cae6` baseline
and the test backend's runtime branch still matched the configured
`18d33510d925b0e5ce30168e888cc7586f532749` pin. Main protection requires
`Check package`, an up-to-date branch, and resolved review threads, with no
bypass actors. This delivery does not publish npm or deploy product code.

PR review added guards for legacy-plan resume, malformed report steps, reserved
frontend service names, and complete workflow-run reconciliation. The workflow
search uses the saved actor and creation time with a clock-skew margin; truncated,
changing, or oversized results stay unverified. Fixture preparation also saves
its exact branch before push/PR creation and reconciles a lost PR response.
The command guide now states the GitHub CLI 2.97.0 minimum for service logs.
All 42 focused tests and the full **314-test Node 24.19.0 check** passed locally
after these changes. A read-only GitHub check at 11:36 UTC recovered and verified
the original passing run `34456463421` using the updated actor/time-filtered query;
it issued no dispatch. The seven original live ticket cases remain dated evidence
at their original runtime pin, rather than new runs of every review edge case.

Runtime synchronization completed separately in sample
[frontend PR #11](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/11),
merged at `b2a43d5a362116a371aae86aa17d23be146cf1f6`, and
[backend PR #13](https://github.com/6529-Collections/release-coordinator-test-backend/pull/13),
merged at `49d92ac76c9bf91520c82010afbae7f9e0fdbb39` on September 10.
Both passed `Sandbox check` and CodeRabbit before merge. Each changes only the
shared report-step guard; all five bundled runtime files were compared with the
Coordinator source and matched in both merged trees. The fixed backend runtime
branch was advanced without force and read back at `49d92ac`; the Coordinator
configuration now pins that full commit. This is sample-runtime delivery, not
a product deployment or a repeat of the complete live ticket matrix.

## Planned later stage: batch selection and tests, September 9

**Historical September 9 plan; see the September 10 implementation above.** The
[batch design](./design.md#proposed-batch-testing-and-selection) now puts full
application checks on the selected combination of tickets, after the existing
checks for each request. It avoids an extra full build/test run per ticket by
default. Confirmed combined failures can trigger smaller-group attempts within
limits, such as 10 to 5 to smaller groups that preserve dependencies. The final selected
combination must itself pass. No promise is made to find the largest passing set.

Tickets and inseparable dependencies stay whole. Exclusions retain visible
[reasons and next actions](./inbox-processing.md#proposed-batch-ticket-outcomes).
When A and B pass separately but fail together, use a saved priority order to
select one independent candidate and defer the other. Reassess the deferred
ticket after the selected release; a failure against the new base may then need
a correction. Group failures, infrastructure problems, and testing limits do
not automatically make every ticket action-needed.

The Coordinator code-check delivery is complete. The one-ticket service/database
matrix has passed its recorded local and live cases; merge that extension, then
implement selection across sandbox tickets and reuse those meaningful sample PR
checks on their combined code. Start with
requests without database changes. The [planned acceptance cases](./merge-rehearsal-testing.md#planned-batch-acceptance)
cover splitting, incompatibility, limits, exact inputs, and ticket presentation.
Numeric limits, tie-breaking, dependencies between tickets, saved attempt state,
runner permissions/results, temporary PR cleanup, and batch reason codes still
need implementation decisions. Both design views now agree on bounded selection
before release mutations; their listed later execution differences remain open.

The September 9 batch-design update changed documentation only. Its existing
single-ticket behavior and 255-test/live-sandbox evidence remain the prior milestone. There is no
batch executor, multi-ticket application CI, product merge, or deployment proof.

## Implemented and verified

| Area | State | Evidence |
| --- | --- | --- |
| Public CLI | Exact version `0.0.4` is published on public npm as `latest`, with GitHub provenance. | [Publication run](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34096336628); public registry version, timestamp, integrity, and attestation link checked September 8. |
| Frontend installation | Public `0.0.4` is pinned in `main`. | [PR #3898](https://github.com/6529-Collections/6529seize-frontend/pull/3898), merged September 8 at `72f6ca467272a7995515ce7ea727a80d174840b5`; current manifest checked. |
| Frontend release recording | Instructions submit new frontend or combined release intents before release mutations. | [PR #3907](https://github.com/6529-Collections/6529seize-frontend/pull/3907), merged at `22c15717ff773580b3cd5b4a3f6ab717983611a1`; current `AGENTS.md` and deployment skill checked. |
| Backend release recording | Public `0.0.4` is pinned in `main`; backend-only intents submit from the backend. Combined releases reuse one frontend-owned request. | [PR #1977](https://github.com/6529-Collections/6529seize-backend/pull/1977), merged at `c52537a11b529b801cff614679e0914a62d4d686`; current manifest, `AGENTS.md`, and deployment skill checked. |
| Central inbox | The submission workflow validates requests and saves public GitHub Issues. | [Workflow source](../.github/workflows/submit-release-request.yml) and the live intake test below. |
| Local inbox reader | Implemented in `6af610a`; reader and documentation shared through [PR #14](https://github.com/6529-Collections/6529-release-coordinator/pull/14). Follow the PR for merge and check evidence. | [Reader guide](../apps/coordinator/README.md). All 71 local tests passed: 22 CLI tests and 49 reader tests. No npm release is required for this private application. |
| Local readiness observations | [PR #18](https://github.com/6529-Collections/6529-release-coordinator/pull/18) merged September 8 at `f2e7f918068181b454e8af277717f2e4f48a3849`. Merge and successful CI were rechecked September 9. | [Readiness guide](../apps/coordinator/README.md#readiness-checks); [successful CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34228394618) at final head `fb7897941fb453c902553378607694b50da72f82`. Public CLI and product code were unchanged; nothing was deployed. |
| Explicit inbox processing | [PR #21](https://github.com/6529-Collections/6529-release-coordinator/pull/21) merged September 9 at `1240fea37b5d38cc00248feefa77465525d5a5d2`. Updated intake and the first real migration were verified afterward. | [Command guide](../apps/coordinator/README.md#run-the-ticket-workflow), controlled tests #20/#22 and migration evidence below. |
| Already-merged intake boundary | [PR #23](https://github.com/6529-Collections/6529-release-coordinator/pull/23) merged September 9 at `3ca9fa281db8fa7614f73250022c838a137c8cff`. Scoped processing closed #13 and #16 with `already-merged`. | All 170 tests passed locally and in [CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34330324182). Live readback at 08:49 UTC verified both closures and an empty inbox; details below. |
| Sandbox merge rehearsals | [PR #26](https://github.com/6529-Collections/6529-release-coordinator/pull/26) merged September 9 at `3dc05203ec97bed20ef3952bc99183954e2b2b5f`. Public sandbox required-check acceptance completed in the follow-up below. | All 216 local tests pass; [15 public sandbox cases](./testing/merge-rehearsal-public-2026-09-09.md) met expectations, including deliberate required CI failure. Real mode was disabled at that milestone; see the profiled follow-up below. |

Both controlled intake tests below ran the central workflow at Coordinator
commit `9e69d60a64e8d0bbceda9abd9c3ae8df1b77c33f`. This is their evidence
revision, not a claim about the latest remote `main`. Local commit, remote
merge, package publication, and deployment are separate milestones.

## Verified intake and reader checks

The public `0.0.4` CLI was run from a local frontend checkout on September 8.
It returned request `300057e3-9a51-466b-a149-5f80f9822672`, its local records,
and [test Issue #12](https://github.com/6529-Collections/6529-release-coordinator/issues/12).
[Workflow run 34212759619](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34212759619)
completed successfully. The Issue was closed and its `pending` label removed;
that state was checked again during this housekeeping. No release merge or
deployment was part of the test.

The local reader then found three open pending Issues and verified all three
against their workflow results. Closed test #12 was excluded. Older test
[Issue #1](https://github.com/6529-Collections/6529-release-coordinator/issues/1)
was still pending and therefore appeared in the report. It remains test
evidence, not a request to execute. Issues #2 and #3 name different commits of
the same frontend PR; record verification does not choose between them.

The backend controlled test also passed on September 8. A separate worktree of
backend `main` at `41dfb41a33b9c1c01b7f4cb6a082838febf4594e` installed the
locked public package through `./bin/6529 ci`. The installed CLI reported
`0.0.4`; one foreground `./bin/6529 exec 6529-release-request submit --input -`
returned request `5a4b8e0d-e758-4a93-ab60-cd1796af14eb` and
[test Issue #15](https://github.com/6529-Collections/6529-release-coordinator/issues/15).
[Workflow run 34221505825](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34221505825)
succeeded, and the reader verified the saved request against that run's result.
The CLI retained its run record `e4fdabd0-d6eb-420e-af96-074618d10479` and
request JSON under the worktree's ignored `.release-coordinator/` directory.

The payload explicitly said **DELIVERY TEST ONLY; NO RELEASE OR DEPLOYMENT**.
It used already merged backend PR #1977 and its verified source head as test
metadata, with canonical backend unit names and an ordering edge. It was not
a readiness test or an instruction to deploy those units. Test #15 was marked
in its title, closed, and had `pending` removed without changing its saved JSON.

At 11:37 UTC, the follow-up reader scan excluded both closed tests and verified
the four remaining pending records: #1, #2, #3, and
[backend Issue #13](https://github.com/6529-Collections/6529-release-coordinator/issues/13).
Another developer submitted #13; this test did not create or change it.
Together, these checks prove public-package delivery from both product
checkouts and read-only inspection of the resulting inbox records. They do not
prove release readiness or execution.

## What the system does not do yet

`inbox:read` checks saved JSON and workflow evidence using GitHub GET requests.
The separate `readiness:check` adds current PR/check/review observations and
dependency validation. It uses a fixed GraphQL read query and catalog GETs.
Neither command chooses the latest wanted request or approves a deployment.

Neither read-only command changes tickets. The local `inbox:run` combines
inspection, rehearsal, supported sandbox service checks, and ticket decisions.
Its old separate operator commands
have been removed. Both updated
readers select all open `release-request` Issues, including tickets without
`pending`. The merged intake workflow's `status:received` setup was verified
with controlled test #22. The already-merged closure extension is tracked in
[PR #23](https://github.com/6529-Collections/6529-release-coordinator/pull/23).

Readiness still lacks a verified completed/cancelled/replaced release-history
source and runtime evidence for omitted prerequisites. It also does not consume
rehearsal plans or merge-result reports. The write workflow consumes fresh
rehearsal evidence separately. The read-only checker reports these gaps as unknown, even when individual checks pass.

There is no running Coordinator worker, durable release queue/database,
GitHub App with merge authority, automatic merge/build/deploy flow, or recovery
engine. Product repositories still use their existing authorized release
procedures. Recording a release intent is observation only.

## Current scope and later work

The complete **submit a request -> first inbox processing** stage was chosen
before the merge rehearsal and is now implemented and exercised live. Its
[contract](./inbox-processing.md) covers:

- Keep public CLI input and schema unchanged.
- Initialize new tickets centrally with readable titles, verified submitter
  ownership, scope labels, and `status:received`.
- Add a separate explicit command for ticket decisions and updates; preserve
  both existing read-only commands.
- Define clear statuses, reasons, next actions/owners, and durable decision history.
- Migrate existing tickets and scan all open release requests so waiting tickets
  remain visible. Preserve terminal outcomes and the original request receipt.

**Implemented in [PR #21](https://github.com/6529-Collections/6529-release-coordinator/pull/21).**
The private app now includes the write command, initial ticket setup,
managed presentation, verified submitter lookup, and a GitHub state branch with
recorded decisions and explicit retry/recovery. The installed public package and
request schema are unchanged. The first real migration subsequently organized
all six existing open tickets; see the dated evidence below.

The owner then narrowed intake: a request whose PRs are all already merged
should close without claiming deployment. The merged policy was applied to #13
and #16, and both closures were verified. A deployment-proof checker for retiring these
requests is deferred; mixed requests remain open for a scope decision.
The [sandbox rehearsal matrix](./merge-rehearsal-testing.md) and
[profiled inbox follow-up](./profiled-inbox-testing.md) are now implemented and
merged. Two public sample repositories and a separate public test inbox prove
submission, receipt reuse, explicit processing, and rehearsal of one ticket's
exact PRs. Both profiles share the same implementation; test manifests and
receipts remain separate from real request evidence.

We can continue developing and testing in the sandbox. The merged combined
workflow uses fresh rehearsal reports to update the same ticket. The Coordinator
code-check delivery is tracked above.
The [service/database stage](#sandbox-services-and-database-september-10) is
implemented with local and live acceptance evidence; its Coordinator source
delivery is tracked above. The
[batch stage](#sandbox-batch-implementation-september-10) now has a local
implementation and its own acceptance record. Real-project live acceptance, the larger release
worker, execution permissions, deployment evidence sources, and recovery remain
later work.

### Sandbox rehearsal implementation, September 9

The plan was committed as `718eaaa` on
`codex/sandbox-merge-rehearsal`, branched from freshly verified `main` at
`514fed01f2c5149eac60a15898b562409479ec1f`. The private `merge:rehearse` command
now uses one normalized-plan engine, an explicit sandbox profile, pinned
GitHub repository identities, temporary bare Git repositories, and local
JSON/text reports. At that initial milestone, real mode stopped before input
reads pending verified-inbox integration. Existing production repository restrictions and public
CLI/schema are unchanged.

[PR #26](https://github.com/6529-Collections/6529-release-coordinator/pull/26)
carries the implementation and documentation; its page records current merge
status. Required [CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34340135589)
passed on exact runtime head `a58b450e4f47e61b8b17867a0b6bf23f1a1e0a1e`, using
Node.js 20, all 216 tests, and the nine-file package dry pack. Publication was skipped.

All **216 local tests passed**: 26 public-package tests and 190 Coordinator
tests, including 46 new rehearsal tests across the MR matrix. Tests exercise
real local Git merges, conflicts across individually clean PRs, exact combined
catalogs, changing/missing evidence, profile boundaries, interrupted and partial
operations, resource limits, and cleanup. The public package dry pack still
contains exactly nine files. This is local test evidence; CI and remote merge
are separate milestones.

Created both private test repositories with verified admin/read access:

- [Frontend sandbox](https://github.com/6529-Collections/release-coordinator-test-frontend),
  repository ID `1362504370`, baseline `5e5d27c5bfee263259e15eb9dee0ad0ea89c0e53`.
- [Backend sandbox](https://github.com/6529-Collections/release-coordinator-test-backend),
  repository ID `1362505082`, baseline `33dc26417355f53b8ba94f1d20c9bd9e3779edaa`.

They contain only sample files, a dependency-free CI check, and controlled PRs:
frontend #1-#8 and backend #1-#4. Frontend #6 is deliberately a draft, #7 was
deliberately closed, and #5 deliberately fails its CI check. There are no
deployment/publication workflows or fake requests in the real inbox.

**Initial live acceptance limitation (resolved setup below):** GitHub refused branch protection on the private
repositories with HTTP 403: "Upgrade to GitHub Pro or make this repository
public to enable this feature." Both were private during those initial runs;
no plan upgrade or visibility change was made then. The sandbox profile
explicitly requires `Sandbox check` to be marked required by GitHub; an optional
check cannot substitute, so missing enforcement stays unknown in reports.

All **15 live cases** met their local merge/input expectations from clean
Coordinator commit `ee8fd94c2537e5e78bd1e351e4eed1c8c8207885`, between
10:15:49 and 10:16:55 UTC. Required-check acceptance remains incomplete:
clean merges reported `unknown`, while demonstrated conflicts and inactive/
outdated inputs reported `blocked`. The failed sample CI was observed, but
could not prove required-failure enforcement while protection was unavailable.
Independent before/after snapshots verified unchanged sandbox branch commits
and PR state. All run-owned temporary Git directories were removed.

[The dated test record](./testing/merge-rehearsal-2026-09-09.md) retains exact
fixture commits, PR/check links, run IDs, result trees, and coverage limits.
Raw evidence is under `.release-coordinator/rehearsal-setup-20260909/` and
`.release-coordinator/live-rehearsal/2026-09-09T10-15-49-009Z/`. A subsequent
local review tightened the rare setup-failure cleanup path so a second
repository cannot hide a leftover from the first; its two-repository regression
test is part of the current suite. Input adaptation also preserves multiple
service parts per repository in the shared engine; the added regression proves
that later real-inbox integration does not need a second merge algorithm.
The final runtime head above then repeated all 15 live cases, with matching
observations and tree identities and unchanged source state. That repeat is
recorded in the dated test record and under
`.release-coordinator/live-rehearsal/2026-09-09T10-25-28-454Z/`. The required-check
enforcement gap remained unverified in those runs; it was not counted as a passing gate.

### Shared profiled inbox implementation, September 9

On branch `codex/profiled-inbox-rehearsal` from verified `main` at
`c9ff50230caba774b6c7c486b49a9af4f0ef00d7`, the shared sandbox/real input path now
covers private complete-request submission, workflow intake, receipt verification,
readiness, explicit processing, separate inbox journals/local records, and a
one-ticket merge plan. The [profiled inbox guide](./profiled-inbox-testing.md)
defines the exact boundaries and operator commands.

Created the public [test inbox](https://github.com/6529-Collections/release-coordinator-test-inbox),
ID `1362580376`. It is a separate fixture repository; sample PRs remain in the
existing frontend/backend test repositories. Its protected main workflow pins
Coordinator commit `5cab79f129899d4637cc32103cb167b2f77daac5` and runs the same
shared intake code as the real workflow.
Public npm source/schema and installed `0.0.4` behavior remain unchanged.

The initial **232 local automated tests passed** (26 public-package and 206 Coordinator),
including 16 new profile/inbox tests. They cover both profiles and the shared
real Git engine, cross-profile rejection, workflow identity, exact PR scope,
ticket rechecks, retries, and separate state. Three review tests add non-JSON
GitHub failure coverage for both profiles and a reported local result-save failure;
the focused profile suite now has 19 passing tests. All **235 tests passed** in
the full local suite (26 public-package, 209 Coordinator). The public dry pack remains
nine files.

The [live sandbox record](./testing/profiled-inbox-2026-09-09.md) proves submission
through the shared workflow to [test ticket #1](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/1),
receipt reuse without a second workflow/ticket, explicit processing into the
test journal, and two passing one-ticket rehearsals with identical result trees.
All sample PR refs and 13 real inbox records remained unchanged. The real state
journal also remained unchanged. The test ticket stays `status:waiting` with
`reason:coordinator-incomplete`; the processor does not consume rehearsal reports.

[PR #30](https://github.com/6529-Collections/6529-release-coordinator/pull/30)
merged at `f53a143a52cba354570716d696fc44d6b2229d49` on September 9 at 12:00:22 UTC.
Its final head `5c2475801be5114dbb8bd3c9df3d8f454992017d` passed
[required CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34348455618)
and repeated the same live ticket rehearsal successfully in run
`37191114-423b-4a3f-ace6-7e74a67babad`, with matching result trees and cleanup.
The PR records that final-runtime confirmation. Real-profile live proof is
outside this rollout.
No real inbox processing, product merge, package publication, or deployment was
performed by this exercise. Multiple-ticket batching remains later work.

### Public sandbox required checks, September 9

[PR #27](https://github.com/6529-Collections/6529-release-coordinator/pull/27)
carries this follow-up; its page records required CI and current merge status.

The user authorized making only the two sample repositories public to complete
required-check acceptance. Both visibility changes were applied, and independent
GitHub reads at **10:49 UTC** verified the same pinned repository IDs, admin access,
and `Sandbox check` from GitHub Actions (app ID `15368`) required on `main` and
`rehearsal-target` in both repositories. All four protections enforce admins,
require PRs and resolved conversations, and prohibit force pushes and deletion.
The profile now pins public visibility; the public CLI, product repository
allowlist, and disabled real rehearsal profile are unchanged.

Raw protection readback is saved in
`.release-coordinator/sandbox-public-protection-20260909.json`. The previous
private-run evidence remains historical.

All **15 live cases met their expectations** from clean runtime commit
`f34d70a71ee5eb292bef33d0c9b5f17505d3f9c0`, between **10:51:21 and 10:52:42 UTC**:
seven clean cases passed and eight deliberately invalid cases were blocked.
The failed sample CI was marked `isRequired: true` and blocked MR-11 despite
a clean local merge, closing the original live acceptance gap. Before/after
reads verified unchanged refs, PR state, visibility, and all four protections;
all created temporary Git workspaces were removed. MR-01/MR-20 repeated the
same result and tree. The closed fixture remains blocked without check evidence.

The updated live runner asserts protection and clean/failed-check expectations
without the old account-plan fallback. Three invalid-seed checks passed before
network access or evidence creation. All **216 automated tests** passed locally;
the package dry pack still contains nine files. The [public acceptance record](./testing/merge-rehearsal-public-2026-09-09.md)
records exact revisions, run IDs, trees, and coverage limits. The bounded sandbox
matrix is complete; real-input integration remains the next separate stage.

### Rehearsal planning baseline, September 9

Before this documentation update, local `main`, freshly fetched `origin/main`,
and GitHub's live `main` all matched
`514fed01f2c5149eac60a15898b562409479ec1f` (the PR #24 merge). There were no
uncommitted tracked implementation changes. The two older untracked root npm
planning/review documents were left untouched; they are not current instructions.

The new plan defines one shared rehearsal engine with explicit sandbox/real
profiles, the private sandbox input boundary, exact destination and
merge behavior, two proposed repository names, phased setup, automated/live
test matrix, evidence requirements, and a bounded finish line. The README,
app guide, ticket contract, design, and agent documentation map link to it.
The first milestone enables sandbox operation. The real profile will use the
same engine once its verified-inbox adapter has separate integration proof;
an environment change alone cannot make a test manifest trusted.

This update is documentation only. No rehearsal command, test repository,
sample PR, or test execution is claimed. The prior 170-test results above are
implementation evidence from the earlier work, not new tests of this plan.
Documentation checks passed for all seven changed/new guides, 52 local links,
the 21 scenario IDs, and whitespace. At that planning checkpoint the edits were
local and uncommitted. The owner subsequently authorized execution; the plan
commit and implementation evidence are recorded above. This paragraph preserves
the planning baseline rather than claiming those later steps had already run.

### Merged intake and real migration, September 9

The updated workflow ran at merge commit `1240fea37b5d38cc00248feefa77465525d5a5d2`
in [run 34325943376](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34325943376).
It initialized [test #22](https://github.com/6529-Collections/6529-release-coordinator/issues/22)
with a readable title, received/scope labels, verified submitter assignment,
and one bot-authored status comment. Explicit test retirement updated that same
comment and closed the ticket. Resubmission reused the closed ticket; an unchanged
processing retry made zero ticket writes. Readback preserved its original receipt
and one decision. No release was performed.

The first real migration finished at **08:09 UTC**, with independent readback at
**08:10 UTC**. Run `0067f329-c3db-419e-830d-c8afe9d2c530`, policy `2026-09-09.1`,
closed #1, #2, #3, and #19 as outdated. #13 and #16 stayed waiting under that
policy. All six acquired readable titles, labels, verified submitter assignments,
one status comment, and one recorded decision. Original receipts and existing
terminal tests #20/#22 were unchanged. Both remaining open receipts still verified.
The journal was unlocked at `61775db72efaf3660b23979a0ced1384b06e21c1`.
No product branch, npm package, release, or deployment changed.

### Already-merged policy, September 9

Policy `2026-09-09.2`, implemented in [PR #23](https://github.com/6529-Collections/6529-release-coordinator/pull/23), closes a request with `status:closed` and
`reason:already-merged` when every requested PR has matching code, verified
same-repository source, and stable merged-state observations. A fresh check is
required immediately before closure. Missing deployment or prerequisite evidence
does not keep such a request open: the Coordinator declines to handle it without
claiming that it was deployed. The comment directs any remaining deployment to
the existing authorized release process. Identical merged-PR resubmission leads
to the same closure. A verified merged PR plus an open or unverified companion
keeps the request open with a scope decision for the submitter; no subset is
executed. Missing product evidence alone can remain waiting when there is no
verified merged PR.

This is intake disposition, not execution ownership. A future worker must record
ownership before merging and continue handling its own release afterward. Current
processing rejects unsupported ownership records before ticket writes. Existing
terminal decisions, request receipts, and comment identities remain preserved.

All **170 local tests** passed: 26 package, 51 reader, 55 readiness, and 38
processing. Coverage includes all/mixed merged requests, unavailable or moving
proof, waiting-to-closed history, unchanged retry/resubmission, last-moment proof
changes, lost closure responses, and refusing future execution ownership. The
review follow-up adds merged-plus-outdated companion coverage, confirming the
documented outdated-commit precedence without changing the policy.
The public package, schema, read-only commands, and product repositories are unchanged.

A fresh **read-only preview at 08:30 UTC** verified #13 and #16 and proposed
`closed` / `already-merged` for both. It made zero GitHub writes. At that time the
live tickets remained waiting; the preview is not evidence of applied closures. Local evidence
is saved under `.release-coordinator/already-merged-policy-20260909/`.

**Rollout completed:** PR #23 merged at **08:45 UTC** after required CI passed
on final head `14181d8cf8ed8f062ea82766453cb89b5c33e883`. CI ran all 170 tests
and confirmed the public package still contains nine files. Local `main` was
updated to the merge before any live history used the new reason. Older processor
checkouts must update before running; they reject unknown reasons and stop. Do
not rewrite history or weaken validation to accommodate an old processor.

Scoped runs from merged `main` applied `status:closed` + `reason:already-merged`
to [#13](https://github.com/6529-Collections/6529-release-coordinator/issues/13#issuecomment-5598449115)
and [#16](https://github.com/6529-Collections/6529-release-coordinator/issues/16#issuecomment-5598458998).
Run IDs were `c0bf4c06-1b88-45f0-951a-bd7c2c41a4ac` and
`314d951a-e8bb-4af4-9077-1bb07a52907a`, respectively. Independent readback at
**08:49 UTC** verified unchanged original receipts/assignees, the same one status
comment per ticket, and exactly two decisions per ticket: the earlier waiting
decision and the new closure. Other recorded tickets were unchanged. The reader
found no open release requests. The journal had no active lock at
`5d136b76469154083ff79fbeb19478950efec34f`.

Late review clarified documentation only: action-needed requires a verified
merged PR plus an open/unverified companion; missing evidence alone can remain
waiting. Runtime behavior was already correct and unchanged by that clarification.
No release, product deployment, or npm publication was performed during rollout.

### Inbox processing evidence, September 9

The full local suite passed **155 tests** on Node.js 25.6.1: 26 package, 49
reader, 55 readiness, and 25 processing tests. New coverage includes initial
received presentation, retries on open/closed Issues, missing and contradictory
proof, active-intake races, merged-but-unverified code, dependency/overlap reasons,
assignment failure and stable-identity lookup, resolved reasons, changed closure
evidence, altered receipts/history, concurrent writers, lost comment/close
responses, and scoped recovery. No new dependency was added. The npm packing
dry run still contains exactly the existing nine public CLI files; the private
processor is not shipped in that package.

The controlled test used the existing submission implementation and the real
central workflow on `main`, returning request
`52a4f045-786e-4f34-a8e3-278925a95c74` and
[Issue #20](https://github.com/6529-Collections/6529-release-coordinator/issues/20).
[Submission run 34322386066](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34322386066)
succeeded. This was a test request for already merged backend PR #1978, exact
head `6a730dbaaf75b00fc5756bf6f05493fafdbd6afb`, staging, `api` and
`dbMigrationsLoop`. It was not a release or deployment instruction.

The new local `inbox:process -- --issue 20` command applied and verified:

- A readable title, `component:backend`, target/status/reason labels, and
  assignment to the workflow-verified submitter `simo6529` (ID `209783236`).
- One [maintained status comment](https://github.com/6529-Collections/6529-release-coordinator/issues/20#issuecomment-5597739390),
  ID `5597739390`, with reasons, next action, owner, and exact code references.
- `status:action-needed`: deployment/history proof was missing and the request
  overlapped with existing ticket #13. It did not choose, modify, or replace #13.
- An unchanged second processing run issued **zero ticket writes**, retaining
  the same comment and decision ID.
- Explicit `--close-test` recorded the authenticated submitter's test decision,
  closed #20 with `status:closed` + `reason:test`, and removed resolved reasons.
- [Resubmission run 34322955149](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34322955149)
  reused closed #20. A further processing run issued **zero ticket writes**.

At **07:18 UTC / 10:18 Tallinn**, readback verified the unchanged original Issue
body, one comment, correct assignment/labels, and exactly two decision records.
The state branch contained only test #20 and had no active lock; its verified
head was `5cd3b1219033856936305b34520b69e7d1572830`.
Existing tickets #1, #2, #3, #13, and #16 had unchanged title, body, state,
labels, assignees, and comment counts. Another developer's new ticket #19 arrived
during testing and remained unprocessed with its original pending presentation.
The final check compares existing tickets individually because new intake can
continue while a scoped test runs; the entire inbox is not a frozen snapshot.

The GitHub test proves the processor's real writes, journal, retry, and closure
behavior. At this test's revision, initial `status:received` setup by the
**updated workflow** was covered by local tests; it had not been merged or run
on GitHub. Follow PR #21 for subsequent merge and updated-workflow test evidence.
Neither product repository was edited, no npm package was published, and nothing
was merged or deployed. Ignored request/reports are under
`.release-coordinator/inbox-processing-test-20260909/` in the working checkout.

This controlled test deliberately excluded the full migration. The subsequent
PR #21 merge, updated-workflow test #22, and authorized migration are recorded
above; they completed the original rollout prerequisites.

### PR #21 review follow-up

The review identified one malformed-option bug: `inbox:read --submitter --json`
could treat `--json` as a username, read GitHub, and return an empty successful
report. Submitter validation now rejects leading/trailing hyphens before any
GitHub read. Regression coverage includes missing/option-like values and valid
single-character, mixed-case, numeric, and internally hyphenated names. This
changes only argument validation for the read-only filter.
The regression reproduced the empty-success bug before the fix; afterward all
157 local tests passed (26 package, 51 reader, 55 readiness, 25 processing).

### Readiness evidence, September 8

The local suite passed **130 tests** on Node.js 25.6.1: 26 package, 49 inbox,
and 55 readiness tests. The package dry run also passed and included only the
existing nine public CLI files. These tests include a complete fake GitHub
intake-to-readiness CLI run and failure cases for moving commits/bases/checks/reviews, required-check failures,
missing evidence, service/dependency mistakes, pagination, and unsafe API inputs.
The subsequent required GitHub check passed at PR #18's final head; the successful
run and merge evidence are linked in the implementation table above. No new
application tests were run for the September 9 documentation-only update.

A live read-only scan at **12:40 UTC** verified five saved pending records and
reported **3 blocked, 2 unknown**, with no GitHub writes:

- Issues #1, #2, and #3 name older PR commits than GitHub currently reports.
  These existing requests are outdated. #2 and #3 also overlap on the same PR
  and target; neither was selected or marked replaced.
- Issue #13 matches backend PR #1978's recorded head. The PR is merged, which
  does not prove deployment. The pinned catalog says `api` depends on
  `dbMigrationsLoop`; only `api` is selected, and prerequisite runtime evidence
  is unavailable. This remains unknown, not an instruction to deploy migrations.
- Issue #16 matches frontend PR #3908's recorded head. The PR is merged, but
  completed/cancelled/replaced release history remains unknown.

The scan successfully read real workflow proof, PR/check metadata, and the
backend catalog. All observed PRs were already merged, so passing open-PR
mergeability behavior was covered by automated fixtures, not a live open-PR
release test. Closed delivery tests #12 and #15 remained excluded. No pending
Issue, product branch, workflow, or deployment was changed.

### Repeat scan, September 9

An authorized `npm run readiness:check` at **05:54 UTC / 08:54 Tallinn** again
verified all five pending records. The pending set and findings were unchanged:
#1, #2, and #3 blocked as outdated; #13 and #16 unknown. All referenced PRs were
merged. No GitHub read failures were reported. Exit 1 was the expected blocked/
unknown result, not a crash, and the scan made no GitHub writes.

Under the proposed processing rules, #1-#3 would leave the active inbox as
closed/outdated, and #13/#16 would remain open with explicit missing-evidence
reasons and an action owner. These are dated candidates for future migration;
fresh evidence must support actual updates. None were closed or relabelled.

Before implementing release execution, settle the three
[design disagreements](./design.md#decisions-to-settle-before-execution),
then define the worker's permissions and durable state.

The new plan provides the disposition rules for old test/pending
requests. The earlier authorized backend-test cleanup changed only test Issue
#15; it did not dispose of earlier pending requests.

## Separate backend dependency observation

The backend installation reported 18 npm audit findings: 2 low, 10 moderate,
5 high, and 1 critical. The six affected high/critical packages already had
the same root locked versions before backend PR #1977. No dependency versions
were changed in this task. This calls for a separate assessment of affected
code paths and fixes; successful request delivery is not a security audit.

The subsequent [focused fast-uri assessment](./security/fast-uri-assessment.md)
found that the four reviewed URI-rewriting vulnerabilities are not reachable
through the current CLI request path. Both installed public `0.0.4` consumer
copies used affected `fast-uri@3.1.5`, while this Coordinator lockfile already
used patched `3.1.6`. Across all three installations, request validation,
schema-injection probes, and simulated submissions made zero request-time
calls to fast-uri. No dependency versions were changed or warnings suppressed.
Other dependency uses and the remaining audit findings are not cleared by this
result. The assessment and regression test are shared through
[PR #17](https://github.com/6529-Collections/6529-release-coordinator/pull/17),
which records their GitHub check and merge evidence.
The full local suite passed 75 tests: 26 package tests and 49 reader tests.

## Deliberately deferred

- Keep narrow, exact-version package-age exceptions during active development
  and immediate testing. Update the pinned version and its matching exception
  together when adopting another new release. Do not remove the exception
  simply because `0.0.4` has become old enough.
- Human approval and staged npm publishing remain a later owner decision.
  Bootstrap publication still uses the protected workflow and short-lived
  identity. See the [publishing guide](./npm-publishing.md).

## Documentation maintenance

The root README is the entry point; this file owns dated progress. Runnable
commands belong in the CLI/reader guides, the JSON Schema owns the request
shape, the inbox-processing plan owns ticket lifecycle rules, and the execution
design records later choices. The two HTML views show implemented intake/
inspection and the proposed full release process; both point to the intervening
inbox-processing stage and its rollout evidence.

Completed migration checklists and the independent review were combined into
[one historical record](./history/npm-migration.md). Historical findings and
unchecked boxes are evidence from that time, not a fresh implementation queue.

The September 9 housekeeping removed the two remaining untracked root copies
after verifying that all their text was preserved in that history file (only
heading levels differed). It also corrected older current-state summaries,
the intake diagram's initial labels, public test-repository descriptions, and
the profile-specific report path. Dated test reports and migration history
remain intact; this cleanup changes documentation only.
