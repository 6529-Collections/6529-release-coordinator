# Proposed release execution design

**Draft, not implemented release behavior.** The live system submits requests;
the local app verifies intake, inspects readiness, organizes tickets, rehearses
merges, and runs supported one-ticket sandbox service/database checks and
bounded sandbox batches without database changes.
It does not authorize or execute releases. See [progress](./progress.md) for
that boundary.
The [agreed execution direction](#agreed-execution-direction-september-11)
and [process diagram](../release-coordinator-process.html) describe the same
September 11 decisions. They are requirements for later implementation, not
evidence that product release execution is available.

## Inbox stage before execution

The implemented smaller stage is [inbox processing](./inbox-processing.md): central
intake defaults, clear ticket statuses and reasons, submitter ownership,
recorded decisions, and migration of existing tickets. `inbox:run` now joins
initial inspection, local rehearsal, supported sandbox service checks, and
ticket updates in one manual process.
See progress for local, merge, and runtime evidence.

The current intake boundary excludes requests whose PRs are all already merged:
processing closes them with `already-merged`, without claiming deployment.
A verified merged PR plus an open or unverified companion keeps the request open
for a scope decision; missing evidence alone can remain waiting. Deploying already
merged work uses the existing authorized product release process; a dedicated
deployment-only request mode is not implemented. A future worker must record
execution ownership before merging and keep responsibility afterward. Its own
merge must not trigger this intake closure rule. Inbox receipt acceptance and
ticket processing are not execution ownership.

That document owns the first-processing contract. It keeps the existing CLI input
and read-only commands; `inbox:run` combines inspection, rehearsal, supported
sandbox checks, and Issue updates. It does not authorize release execution.
Keep the existing GitHub journal and manual operation. A separate database,
heartbeat, dashboard and automatic takeover are not prerequisites for the next
step. The future release lane is different from today's per-command inbox lock.

<a id="next-step-v01-run-logging"></a>

## v0.1 run logging

**Implemented September 11, 2026.** Here, v0.1 names this small Coordinator
milestone, not a new public npm package version. The existing `inbox:run` command
shows progress and saves diagnostic history. The manual recovery procedure is
unchanged. See [progress](./progress.md#v01-run-logging-september-11) for validation
and delivery evidence, including [live sandbox logging acceptance](./testing/run-logging-2026-09-11.md).

### What the logs show

- Show progress as each meaningful step starts and finishes: intake, filtering,
  Git rehearsal, temporary PR creation, waiting for checks, service execution,
  ticket updates and cleanup. Log a changed outcome, not every unchanged poll.
- Save the same events in chronological order for each run. Include UTC time,
  run ID, step, outcome and a plain explanation; include ticket/request,
  candidate/attempt, repository, PR or workflow identity and links where relevant.
  Completed steps include elapsed time.
- Distinguish **started**, **succeeded**, **failed**, **unknown** and
  **interrupted**. Starting a GitHub request is not proof that it succeeded.
  A lost response stays uncertain until the existing reconciliation verifies it.
- Explain stops precisely. If backend `main` changes, name that repository and
  record the expected and observed commits. Say that the old result cannot be
  used. Report cleanup separately: what was verified removed, what remains,
  and what is unknown. Do not claim cleanup succeeded merely because it started.
- On explicit resume, append a visible resume boundary to the same run's history
  and retain existing attempt identities. End a normal run with its outcome,
  unfinished work, any existing recovery instruction, and the log location.

For example: “Backend main changed during testing. These results belong to the
previous version. The temporary test PRs were cleaned up; a fresh run is needed.”
That cleanup sentence is valid only after cleanup has been verified. If cleanup
is incomplete, name the remaining owned PRs/branches and the required next action.
This addresses the explanation gap recorded in CT-05; it does not change when
stale evidence is rejected.

### Where the information lives

Detailed logs live on the machine running the command, outside individual
checkouts: `~/.6529-release-coordinator/logs/PROFILE/INBOX_REPOSITORY_ID/RUN_ID.jsonl`.
The command reports the actual path. Profile and immutable inbox repository ID
separate histories; files contain one JSON event per line and use private local
permissions. Each command invocation has its own ID inside the events.

Before acquiring the journal lock, a new command writes a `startup-UUID.jsonl`
file. After acquisition, it moves that same history to the assigned run ID without
replacing an existing file. An early failure retains the startup file. Explicit
resume appends to the run's existing file, including a resume boundary. If a crash
left a partial final line, preserve those bytes, begin new events on a separate
line and report the old incomplete tail. Logs are diagnostics, not replay input.
They survive changing checkout or branch but are not a shared board or journal backup.

The existing `codex/inbox-state` journal remains the source for recorded intent,
ownership, attempts and recovery decisions. Save those records before the same
external actions as today. Local logs are for explanation, never imported as
passing evidence or permission to continue. Preserve the v4 writer boundary,
current attempt budgets and profile permissions.

Logs contain selected Coordinator events and bounded error codes, not raw Actions
output, exception dumps, environment dumps or full request bodies. Known credential
values and token patterns are redacted from diagnostic text. Live progress goes to
stderr; `--json` stdout remains one final result with `logging.file`, `complete`,
`invocation_id`, `run_id` and `previous_tail_incomplete` metadata.

Failure to initialize a log stops before inbox work. A later write failure warns
once and marks `logging.complete: false`; existing journal decisions and cleanup
continue under their existing rules. The command exits `2` even if ticket processing
finished successfully. A log failure does not erase a verified ticket result.

Remote service steps are reported when the completed workflow report is verified,
with the source start/finish times separate from local observation time. Waiting
for that workflow is visible immediately. This does not stream raw Actions logs
or poll for a heartbeat.

### Limits and finish line

There is **no heartbeat** in this step. No new live-status file or command,
GitHub status Issue/Project, dashboard, background service, automatic restart,
takeover, machine ownership/OS-lock hardening, or stop/restart control system.
Logs can show the last observed action; silence cannot distinguish slow work,
a paused process, a crash or a lost connection.

Existing Ctrl+C handling and explicit `--resume` remain. Record interruption
when the process can do so; an abrupt crash may leave only a “started” event.
Stop the old process and let in-flight requests settle before manual recovery,
following the [command guide](../apps/coordinator/README.md#journal-concurrency-and-interrupted-runs).
The CT-09 overlapping-process gap remains open: logs do not prevent a paused
process from finishing a GitHub write after ownership changes.

The cases below are covered by
[run logging tests](../apps/coordinator/test/run-log.test.mjs), using the real CLI,
journal, selection and check logic with controlled GitHub responses. The trial
cases also prepare real temporary Git repositories. These are local tests, not
new live GitHub acceptance.

| Case | Required result |
| --- | --- |
| Normal run | Ordered start/result events identify the run, relevant tickets/attempts, elapsed steps and final outcome in terminal and saved log. |
| Failure or lost response | Verified failure and unknown outcome are distinct; an attempted operation is never logged as confirmed success. |
| Main changes during checks | Name the changed repository and both commits, reject stale proof, and report verified cleanup or remaining resources accurately. |
| Interruption and explicit resume | Preserve earlier events and attempt IDs, mark the resume, and use journal reconciliation; a missing final event never authorizes takeover. |
| Storage and output | Separate profiles/inboxes outside checkouts, report the path and any write failure, and preserve parseable `--json` stdout. |
| Sensitive output | Useful step/errors remain visible without credentials, raw workflow output or request-body dumps. |

This bounded step requires no request-schema change, consumer integration update,
package publication,
source-PR merge or deployment. The dated corner-case results remain evidence of
the earlier behavior; new tests must record their own results in progress.

## Bounded stage: sandbox merge rehearsal

The [testing plan](./merge-rehearsal-testing.md) defines local Git fixtures and
two public test GitHub repositories for sample PRs. The
[profiled inbox guide](./profiled-inbox-testing.md) adds a separate public test
inbox and the shared sandbox/real input path. Both profiles accept a verified
inbox ticket and generate the destination/merge plan internally; private test manifests
remain sandbox-only. The same engine checks exact commits and merge order,
with separate evidence for conflicts, CI/review blockers, and changing inputs.

The original profiled engine and unified command are merged and have live
sandbox proof. The command uses fresh reports to update the same ticket, with
distinct passed/blocked/unknown/stale outcomes. Real-project live acceptance remains
outstanding. See [progress](./progress.md) for exact implementation, test, and
merge evidence. Git rehearsal changes no product branches and runs no builds
or deployments; the sandbox service extension below runs application tests.

This scope requires explicit destinations and one documented merge method.
It does not implement the agreed real release lane, timing of `main` changes, or
build policy below. The ticket contract now owns rehearsal outcomes; later release
execution still requires its own decisions and evidence.

<a id="next-bounded-stage-sandbox-services-and-database"></a>

## Sandbox services and database

**Implemented and tested September 10, 2026; sandbox only.** Source delivery is
tracked in [progress](./progress.md#sandbox-source-delivery-september-10).
One complete sandbox ticket exercises small database, worker, API, and
frontend steps. The [service/database guide](./merge-rehearsal-testing.md#service-and-database-acceptance)
owns the fixtures, temporary MySQL baseline, test matrix, evidence, and finish line.
The real backend's catalog, sequential deployment instructions, database handler,
and existing temporary-MySQL tests inform this example; the guide records pinned
sources. The local Coordinator inspects the sample database definitions and
runs the sample service checks through a pinned GitHub workflow. The controlled
local and live cases have their expected results recorded in progress; real
execution remains unimplemented.

Keep one `inbox:run` workflow and shared decision logic. Sandbox actions
operate on isolated temporary resources, with exact service versions and results
verified before dependents start. `database_change: no` still uses the existing
database; `yes` needs an identified and verified change; unknown or contradictory
evidence holds execution. Preserve failures, partial effects, and safe retry
decisions in the same ticket's history without claiming release completion.

The shared profile selects configuration and available actions, not permissions.
Real execution adapters remain absent. Testing the order and data behavior in
sandbox does not implement the real lane, merge timing, builds, production database
inspection, or deployment/recovery rules. The later batch stage still starts
with requests without database changes.

<a id="proposed-batch-testing-and-selection"></a>
## Batch testing and selection

**Sandbox implementation, September 10, 2026.** See [progress](./progress.md)
for local checks versus live acceptance and source delivery. An unscoped sandbox
`inbox:run` now selects and tests whole tickets together. `--issue NUMBER` keeps
the existing one-ticket service/database path. Real mode remains inspection and
Git rehearsal only. No manual plan, extra batch command, product merge or release
permission is introduced.

### Cheap elimination before expensive checks

1. Verify immutable intake, exact PR versions, existing required PR checks and
   reviews, scope, dependencies and per-ticket Git merges. Reading existing CI
   results does not rerun them.
2. Inspect the supported sample files, complete service scope and database answer.
   Only self-contained staging tickets with verified `database_change: no` enter
   batching. A false no is action-needed; unsupported scope or unresolved answers
   stay visible with a reason.
3. Save the ordered selection and starting main commits. Try the whole group's
   Git merge. If it conflicts, build a compatible group in saved priority order,
   recording exclusions. Complete this cheap filtering before starting new CI.
4. For that group's changed repositories, open owned temporary PRs to run the
   normal required `Sandbox check`. Their exact trees must equal the locally
   rehearsed trees, and GitHub's test merge must use the saved base and head.
5. Once required PR checks pass, run the combined backend/frontend sample service
   plan through the existing pinned runtime. Passing independent repository CI
   alone is not combined application proof.

Ordinary source-PR CI continues normally. The Coordinator adds no mandatory full
application run per ticket before selecting a batch. A tree that merges cleanly
can still fail application tests; that is why later test failures may require
additional candidate checks.

```mermaid
flowchart TD
    A[Read tickets and existing PR results] --> B[Cheap scope, database and Git checks]
    B --> C[Find a compatible group of whole tickets]
    C --> D[Temporary PR checks on combined code]
    D -->|Pass| E[Combined services and frontend checks]
    E -->|Pass| F[Save exact passing group and ticket reasons]
    D -->|Confirmed code failure| G[Verify unchanged baseline]
    E -->|Confirmed code failure| G
    G -->|Baseline passes| H[Try smaller whole groups within limits]
    H --> C
    D -->|Missing evidence| I[Wait or reconcile saved attempt]
    E -->|Missing evidence| I
    G -->|Baseline fails or unknown| I
```

### Saved order, scope and limits

The code-owned `sandbox-batch-v1` policy uses ascending GitHub Issue number as a
stable intake order. The requester cannot choose priority through `created_at`.
Each ticket is indivisible: all its parts, PRs and selected services stay together.
The current intake contract describes dependencies within a ticket. Cross-ticket
must-ship-together groups are **not yet represented or supported**; put inseparable
work in one complete ticket. Overlapping PR requests remain held by the initial
policy, without choosing a version by age.

A selection contains at most **10 tickets and 10 PRs per repository**. Its saved
search permits **40 combined Git attempts and 12 candidate check rounds**, with
**45 minutes to start new rounds**. Each round can run one normal PR workflow per
changed repository, one combined service workflow, and an unchanged-baseline
workflow only when diagnosing a code failure. Existing attempts still reconcile
and clean up after the search deadline; a deadline does not erase ownership.
Ticket/PR overflow stays waiting instead of breaking up a ticket.

All candidates in one search use the same saved main commits and PR versions.
Each candidate rebuilds the full service graph. Its identity includes exact
intake bindings, membership/order, code and test/runtime configuration. A changed
PR head never silently replaces accepted code; corrected code requires a new
request. Changed main or gates invalidate the usable candidate. Owned temporary
PRs are reconciled/closed before a fresh run can start.

### Bounded splitting and failure attribution

Try the compatible group first. Split a confirmed failing group into two ordered
halves, recursively within limits. Keep earlier passing candidates. If useful
parts from both halves survive, test their union before selecting it. An identical
candidate is not tested again merely to spend another attempt. The search returns
a directly tested candidate or an honest no-candidate result; it does not promise
the largest possible passing group.

Every later command re-reads the saved trials' GitHub checks and service reports
before reusing their result. The checkout log must identify a commit whose tree
and parents match the saved combination. Closed temporary PRs retain this proof;
rechecking it does not reopen them or rerun CI. Missing or changed evidence stops
reuse and requires reconciliation.

If A passes, B passes, but A+B fails, the saved priority selects A and leaves B
waiting with the exact failure and selected candidate. B is not labelled broken.
Once A actually reaches main through a future authorized release process, B must
be checked against that new base. A specific failure caused by B's addition can
then require a correction. The priority policy does not prove which author made
an error.

Only a verified code failure with a passing unchanged baseline permits splitting
for attribution. Runner outages, pending/skipped/cancelled checks, wrong result
identity, baseline failures and uncertain saves do not identify a bad ticket.
Missing evidence stops the search or preserves an interrupted attempt for
explicit reconciliation. Unchanged completed unknown results are retained; a new
input/configuration or a resolved interrupted attempt is needed for new evidence.

### Journal, temporary PRs and recovery

`inbox-run-v5` preserves earlier ticket, service and v4 batch history, including
inputs, attempts, budgets, intermediate Git results, exact temporary PR identities,
service attempts, results and cleanup. Older writers reject the marker. A saved
selection remains fixed on resume; newly arriving tickets wait for a later run.
State/ownership errors retain the existing inbox lock for explicit `--resume`.

Only branches named `codex/batch-trial-<attempt UUID>` can be created or removed by
the batch adapter. The branch/commit is saved before PR creation. Lost creation
responses reconcile by that unique head; they cannot create a replacement PR.
The original Coordinator identity block must remain unchanged at the start of the
PR description. Appended review summaries are ignored and cannot supply inputs.
The adapter verifies repository IDs, actor, required workflow blob, workflow/run
attempt, job/step, required checks, head/base commits and combined tree. It never
merges trial PRs, edits source PRs or writes product repositories/workflows.
Completed evidence is saved before trial PR closure and branch removal. An
interruption preserves owned identities until an explicit resume can finish.
Normal Actions jobs remain isolated and time-limited by the existing workflow.

[Ticket projections](./inbox-processing.md#proposed-batch-ticket-outcomes) own
labels and submitter-facing reasons. The [acceptance matrix](./merge-rehearsal-testing.md#planned-batch-acceptance)
records expected cases and the dated evidence distinguishes local tests from live
GitHub proof. Database-changing batches, cross-ticket dependency declarations,
real application execution and deployment remain future work.

### Deferred: links between separate tickets

The agreed future direction distinguishes two rules: **“B needs A”** allows A
to proceed alone but requires A with B; **“A and B must stay together”** makes
the group indivisible. Neither rule is part of the logging milestone, and the
current request format still rejects unsupported declarations.

When this feature is built:

1. Reference immutable request IDs. A replacement request must not silently
   satisfy a link to the original.
2. Validate missing requests, incompatible targets/scopes, circular requirements
   and oversized groups before expensive tests.
3. Make selection and splitting respect the links. If A is excluded, B waits
   with a specific reason. Never split a must-stay-together group.
4. Save links with the exact selection so resume preserves them, and show the
   prerequisite/group and waiting reason on affected tickets.
5. Test the feature in sandbox and update the schema, submission CLI, intake and
   frontend/backend submission integrations together before real adoption.

The first version requires prerequisites in the same tested batch. Accepting an
earlier release as satisfying a prerequisite needs later, verified release
evidence. Until then, put inseparable work in one complete ticket; CT-20 records
the current rejection behavior, not proof of this future feature.

<a id="decisions-to-settle-before-execution"></a>

## Agreed execution direction, September 11

These decisions replace the conflicting August written and visual drafts.
They do not enable deployment in the current command.

| Question | Agreed rule |
| --- | --- |
| How many releases progress at once? | One batch from selection through staging, production, or completed recovery. Later requests may arrive and ordinary PR CI may run, but the next release does not start. |
| When does `main` change? | After staging E2E passes and production is authorized. Merge the selected exact PR versions through normal protected Git merges. |
| What builds reach production? | Existing product workflows build separately for staging and production. Reuse their settings; no portable-build or environment-variable redesign. |
| What gates production? | Successful staging deployment/version/health checks and completed successful required E2E for the recorded deployed versions. Failed E2E fails the release attempt; missing, cancelled, skipped-required, or uncertain results cannot pass. |
| What happens after failure? | Stop advancement. After shared state changed, recover the recorded batch; never split it as a recovery shortcut. Database-changing or uncertain releases require a person. |
| How does automatic rollback work? | Only for confirmed no-database-change releases: new commits undo the failed batch, required checks run, and ordinary deployment Actions rebuild and deploy the restored code. Verify recovery before releasing the lane. |
| Where does state live? | Continue using the profile's GitHub inbox journal. Keep active records complete; archive finished records in the same repository and read them when needed. The local v5 writer removes lifetime record caps; live migration remains pending. |

The Coordinator owns selection, ordering, authorized merges/dispatch, waiting,
evidence matching, ticket outcomes and recovery decisions. Product repositories
own builds, environment settings, secrets, deployment internals, tests and release
notes. Their existing deploy skills/workflows remain the integration interfaces.
Current product skills allow E2E to run separately without gating promotion;
the new Coordinator deliberately adds a staging E2E gate. It does not invent a
second test suite or weaken required PR/security checks.

A `target: staging` request finishes after successful staging validation and
saving its result; it never reaches production implicitly. A later explicitly
authorized production continuation must revalidate selected versions,
destinations and evidence. If another release changed those inputs, test the new
combination. A production-intended batch keeps its lane through production or
recovery, including while waiting for any required approval.

One lane serializes this Coordinator; it cannot stop unrelated humans or Actions.
Check current refs and conflicting runs before mutations and match deployed
versions to E2E. Shared staging may contain other changes: inspect and record its
actual merge composition, preserve others' work, and do not claim staging
validated a different production composition. Changed bases or scope require
fresh matching combined evidence; if that cannot be established, stop.

Verified integration references on September 11: frontend
[`deploy-6529`](https://github.com/6529-Collections/6529seize-frontend/blob/faf4aa616bc3a25ccab5a0db8162980d9cdaedd1/ops/skills/deploy-6529/SKILL.md),
[`Web Deploy - STAGING`](https://github.com/6529-Collections/6529seize-frontend/blob/faf4aa616bc3a25ccab5a0db8162980d9cdaedd1/.github/workflows/deploy-staging.yml),
[`Web Deploy - PROD`](https://github.com/6529-Collections/6529seize-frontend/blob/faf4aa616bc3a25ccab5a0db8162980d9cdaedd1/.github/workflows/build-upload-deploy-prod.yml),
backend [`deploy-6529`](https://github.com/6529-Collections/6529seize-backend/blob/a367473904f83816fd2b67ab5a88d9bfe19e288e/ops/skills/deploy-6529/SKILL.md)
and [`Deploy a service`](https://github.com/6529-Collections/6529seize-backend/blob/a367473904f83816fd2b67ab5a88d9bfe19e288e/.github/workflows/deploy.yml).
These are source observations, not deployments performed in this review.
The retired Release Bus has no design authority here.

## Core rule: one release lane

Many requests may wait, but only one release batch progresses at a time.
The active batch holds the lane until its requested target succeeds or recovery
reaches a verified and saved safe result. A human-required or uncertain state
keeps the lane reserved. Later release selection/testing does not overlap it.
Developers may continue their PRs, ordinary CI and request submission.

Save the lane, batch identity and current step in the GitHub journal. Today's
per-command inbox lock does not yet provide this release-spanning ownership.
Manual resume still requires stopping the old process and settling in-flight
calls. Logs do not prove a silent process is dead. Heartbeat, automatic expiry,
automatic takeover and speculative testing against an active release are deferred.
Speculative future releases would need revalidation when the active batch changes.

## Product promise and ownership

One request names exact frontend/backend PRs, commits, release-part dependencies,
selected backend services and order, target and database-change answer. The
requester's stated name is context; the central workflow records the verified
GitHub actor. Submission, a passing rehearsal and profile selection grant no
merge or deployment authority.

The Coordinator should eventually perform the authorized sequence and save a
clear result without requiring the submitter to watch every Action. It owns:

- request verification, queue order, whole-ticket selection and reasons;
- batch identity, current phase, lane ownership, bounded retries and recovery;
- normal authorized Git merges, workflow dispatch, and matching results;
- ticket projections and links to the product workflows' evidence.

Product repositories continue owning:

- PR reviews, required checks, security gates and branch protections;
- builds, dependency installation, environment configuration and secrets;
- backend/frontend deployment and any database change mechanism;
- runtime version/health proof and E2E entry points;
- autonomous release notes, including PR/service grouping metadata.

Do not copy those implementations into the Coordinator or restore the old
Release Bus. The current request schema needs no change for these decisions.
Cross-ticket links and database-changing batches remain deferred.

## Architecture

```mermaid
flowchart LR
    U[Developer or agent] --> CLI[Product skill and request CLI]
    CLI --> INBOX[Verified GitHub Issue inbox]
    INBOX --> IP[inbox:run - checks and sandbox trials]
    IP --> J[(Profile-specific GitHub journal)]
    INBOX -. later .-> W[Release worker - one batch]
    W --> J
    W --> GH[Normal protected merges]
    W --> BE[Existing backend Actions - one service at a time]
    W --> FE[Existing frontend Actions]
    BE --> STG[Staging]
    FE --> STG
    STG --> E2E[Matching versions and successful staging E2E]
    E2E -->|with production authorization| PROD[Existing production Actions]
    PROD --> VERIFY[Versions, health and required safe E2E]
    VERIFY --> J
    J --> INBOX
```

This is an execution design. Current sandbox trials and their temporary MySQL
prove limited test behavior, not a real deployment or rollback.

## Where inbox and queue state live

Use the existing independent `codex/inbox-state` branch in the selected inbox
repository. The local v5 implementation keeps active state in `inbox-state.json`
and [archived finished records](./inbox-processing.md#history-storage) in the same
branch, loading full old details only on demand. Live migration remains pending. A separate database or new
operator dashboard is not required for this stage.

Minimum release records are the requests and their trusted receipts, selected
PR heads, actual destination compositions, target, ordered services, phase,
operation/run IDs and attempts, result links, recorded deployed versions,
pre-release recovery targets, blockers and human decisions. Preserve useful
checksums supplied by workflows; do not create another artifact store.

GitHub Issues show the result, but editable labels/comments alone are not the
trusted journal. Archived results remain readable on demand. Retain enough
identity to avoid treating repeated work as a brand-new batch or resetting its
attempt budget. Never archive unfinished operations or pending cleanup.

## How progress is saved

Before an external step starts, save its intended action, exact inputs and owner.
Afterward, verify what happened and save the result before advancing. A missing
or uncertain save stops further actions and keeps ownership. Partial saves or
responses require inspecting the recorded operation, not starting a duplicate.

Explicit resume after the old process stops reuses those identities and checks
remote truth. It does not trust browser state, local logs or a success message
alone. The known paused-process overlap case remains outside automatic recovery.

| Fact | Source of truth |
| --- | --- |
| Accepted request and trusted submission proof | Issue plus verified central workflow evidence |
| Queue, phase, ownership and attempts | Profile-specific GitHub journal and verified archived records |
| PR head, destination refs, reviews and required CI | GitHub |
| Built/deployed code identity | Existing workflow evidence plus actual runtime/service version proof |
| Whether that deployed combination passed | Required E2E and health results matched to its versions |

## How shared branches are changed

Preserve ordinary repository protections and authorized merge paths. Do not
require new exclusive GitHub App ownership just to integrate this workflow.
The execution identity and permissions still need verification before building
that adapter; journal ownership is not permission to merge.

Freeze exact PR heads and destination commits. Finish cheap elimination before
expensive combined PR checks. Re-read refs and required checks immediately before
normal protected merges and verify each result afterward. If a destination
moved, recompute and obtain evidence for the changed combination. Never force
an old tree over somebody else's work, or claim a client-side check makes two
GitHub repository merges atomic.

Shared `1a-staging` may differ from `main`. Rehearsing only against `main`, as the
current sandbox does, is insufficient proof for an actual staging merge. Inspect
staging contents and candidate merge before pushing; frontend staging pushes can
start deployment immediately. Keep backend dependencies ready before the
frontend merge. Likewise, do not merge all of staging into production: use the
selected PR changes and verify the actual production composition.

If only part of a cross-repository merge or deployment succeeds, save exactly
which refs/services changed and stop advancement. Recover that recorded state;
uncertain or incompatible partial state requires a person. Never mark the batch
successful or begin subset selection after shared state changed.

## Release lifecycle

The proposed successful production path is:

```text
CHECKING -> WAITING -> ACTIVE -> PREPARING -> TESTING
  -> MOVING_STAGING -> STAGING -> STAGING_E2E -> STAGING_VALIDATED
  -> MOVING_MAIN -> PRODUCTION -> VERIFYING -> DONE
```

A staging-only request ends successfully after `STAGING_VALIDATED` and saving its
outcome. Other states include `FAILED`, `RECOVERING`, `RECOVERED`, `NEEDS_HUMAN`
and `CANCELLED`. A recovered release still records that the original release
failed. Release states are different from today's inbox labels; do not teach
intake to close a worker-owned request merely because that worker merged its PRs.

## Staging

1. Save current staging refs and actually deployed frontend/service versions as
   recovery targets before the first shared change.
2. Verify the actual merge composition with `1a-staging`, merge backend changes
   normally, then dispatch `Deploy a service` with `environment=staging`.
3. Wait for each selected backend service before dispatching the next in
   dependency order. When database-changing execution is later supported, use
   and verify the existing database service before its dependent services.
4. After backend prerequisites succeed, merge frontend changes into
   `1a-staging`. Its push starts `Web Deploy - STAGING`; use its documented
   manual dispatch for an authorized ops-only deployment.
5. Save the exact runs, source commits, deployed versions and existing artifact/
   health results. Actions own the separate staging builds and settings.
6. Wait for required staging E2E to finish successfully for the recorded deployed
   frontend/backend combination. Reuse existing tests, including an appropriate
   trigger and version coverage for backend-only releases.
7. Recheck deployed versions and record `STAGING_VALIDATED` only when all required
   results match. A deployment success alone does not pass this gate.

Match repository, environment, workflow/run attempt, source and deployed service
versions. If staging changes during E2E, the old run cannot validate the new
combination. Failed required E2E fails the release attempt and blocks production.
Missing, cancelled, skipped-required, or unconfirmable results stop advancement
with a clear reason; they are never converted into a pass or automatic code blame.

## Production

Production uses the selected PR versions and a verified `main` composition.
Existing workflows build fresh production packages with their normal production
settings. Staging bytes are not promoted and the Coordinator does not redesign
how the apps receive configuration.

1. Require matching successful staging validation and production authorization.
2. Save the currently deployed frontend and each affected backend service version,
   source and workflow/build identity. Current `main` is not necessarily the last
   working deployed version; services may have different prior versions.
3. Recheck the destination compositions, selected PRs and required gates. Changed
   bases or scope require fresh matching combined evidence before proceeding.
4. Merge backend changes into `main` and dispatch `Deploy a service` with
   `environment=prod`, one selected service at a time in dependency order.
5. After backend prerequisites pass, merge frontend changes into `main` and
   dispatch `Web Deploy - PROD`. Preserve existing release-note grouping.
6. Confirm exact running versions and existing health checks, and wait for the
   configured required production-safe E2E results.
7. Save the result before closing the successful release and freeing its lane.
   A new gradual-rollout or monitoring platform is outside this step.

## Recovery path

Recovery starts only after shared refs or an environment changed and the release
later failed. Before any mutation, failure simply holds/fails the candidate and
cleans its owned trials. Never split a deployed batch to recover it.

The process diagram groups recovery as `R1` through `R5`:

1. **Stop and save.** Stop new steps, inspect in-flight Actions and record which
   refs and services changed. Do not launch recovery against an unknown operation.
2. **Choose automatic or human recovery.** A database-changing release, unknown
   database answer/effect, missing recovery target or uncertain state requires a
   person. Confirmed no database change is necessary but not sufficient: restoring
   the selected code must also be safe and verifiable.
3. **Revert and deploy normally.** Prepare new commits on the affected current
   shared branches undoing this batch's changes. Preserve unrelated work and
   branch protections. Verify restored source against the saved deployed targets,
   run required checks, then rebuild/deploy through ordinary Actions in a verified
   compatible service order. Do not blindly reverse the original order.
4. **Verify recovery.** New deployment identities must map to the intended
   restored source. Check versions, health and required E2E in every affected
   environment. New commits/builds need not have the old IDs or identical bytes.
5. **Close the failed release.** Save the original failure and recovery outcome.
   Release the lane only after recovery is verified and saved, or a person records
   a known safe resolution. Successful recovery does not turn the release green.

Frontend production currently rejects deploying an older commit directly. A new
revert commit preserves history and uses its existing release path. Do not reset
shared refs, force-push, blindly copy old packages, or assume reverting source also
reverses a database change. A conflict, moved destination, incompatible per-service
recovery targets, failed recovery check or uncertain save stops automatic work for
a person. Do not repeatedly improvise different rollback combinations.

## Failure and recovery rules

### Database changes

The request answer covers release-specific schema and one-off data changes, not
ordinary application writes. Compare it with inspected exact source using trusted
rules, including entities/schema and data-change code. Absence of a familiar
migration filename does not prove `no`. Unknown coverage/identity holds execution;
a false `no` requires a corrected request, without rewriting its original receipt.

Single-ticket sandbox database tests exist. Real database inspection/execution
and database-changing batches remain deferred. When real execution is built,
reuse the backend's selected database service (which may require deploying and
invoking `dbMigrationsLoop`), verify its effects before dependents and never repeat
a one-off change merely because a response was lost. Database-changing releases
never roll back automatically. Temporary MySQL cleanup is not real recovery proof.

### Changed PRs, bases or environments

Before shared mutation, changed requested heads or bases invalidate the candidate;
never substitute a new PR version silently. After mutation starts, keep the saved
batch identity, stop advancement if a required input moved, and reconcile actual
state. A later source-branch commit is not added to an active deployment. Do not
claim old E2E proves new code. Staging-to-production continuation rechecks inputs.

### Failed preflight, infrastructure or build

Before shared mutation, confirmed Git/code failures may use the bounded selection
rules above. Infrastructure/unknown failures get their own reasons and bounded
same-operation retries, not PR blame. Missing evidence or cleanup stops work.
After a staging ref, `main` or an environment changed, even a build failure needs
recorded recovery/reconciliation; do not assume nothing changed because deploy
never finished. Preserve existing workflow checks and verify retry run identity.

### Failed staging or production E2E/health

Fail the release attempt and stop advancement. Staging failure blocks production.
Confirmed no-database-change recovery uses the ordinary revert/deploy path;
database-changing or unclear state requires a person. Keep every ticket's reason
and evidence without labelling every batch member as independently broken.

### Stop request

Before mutation, cancel and clean owned trials. After mutation, stop new steps,
settle/inspect in-flight operations, save actual state and enter recovery. Keep
ownership while any effect, cleanup or save is uncertain.

## Version-one scope and deferred work

The local [history refactor](./inbox-processing.md#history-storage) has offline
[acceptance coverage](./merge-rehearsal-testing.md#history-storage-acceptance);
its separately authorized live sandbox migration/repeat remains pending.
Keep the current command, profile isolation, cheap-first selection, exact evidence,
logs, no-database-change batch boundary and manual stop-before-resume procedure.

Later execution work adds the single release lane, trusted product workflow
adapters, protected staging/main merges, matching E2E waits, deployed recovery
targets, conditional rollback and ticket closeout. Exercise the same sequence in
the test repositories first, then connect real repositories with verified
configuration and permissions. Profile selection does not grant authority.

Explicitly deferred: cross-ticket links, database-changing batches, portable
staging-to-production builds, environment-variable redesign, a separate state
database, heartbeat, automatic takeover, a new dashboard, overlapping/speculative
releases, exhaustive subset search, new canary infrastructure and automatic
recovery after a database change. Preserve existing autonomous notifications and
release notes rather than creating parallel implementations.

## Remaining integration decisions

- Authorized execution identity and existing repository merge rules.
- Actual staging/main composition handling, including unrelated staging changes.
- Trusted workflow/run/result and runtime-version contracts for each service.
- Existing E2E trigger and deployed-version coverage, especially backend-only
  releases; required production-safe tests and existing health completion signals.
- Verified recovery ordering and source restoration when prior service versions
  differ, plus clear human ownership for anything uncertain.
- Explicit production continuation evidence and protection against a worker's own
  merged PRs being retired by intake.
- Archive migration, verification and focused tests in the history plan; later
  retention/disaster-recovery operations when actual usage justifies them.

These are bounded integration details, not permission to revive the conflicting
old design or introduce a new build/deployment platform. See
[progress and implementation review](./progress.md#implementation-alignment-review-september-11)
for which changes are needed now versus later.
