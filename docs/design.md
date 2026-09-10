# Proposed release execution design

**Draft, not implemented release behavior.** The live system submits requests;
the local app verifies intake, inspects readiness, organizes tickets, rehearses
merges, and runs supported one-ticket sandbox service/database checks.
It does not authorize or execute releases. See [progress](./progress.md) for
that boundary.
This document retains the written execution baseline formerly embedded in the
root README. The [process diagram](../release-coordinator-process.html) is a
separate step-by-step draft; it currently differs in the ways listed below.

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
sandbox checks, and Issue updates. It does not authorize release execution or
settle the choices below.
The full execution design's lane, batch, and worker database should not be
introduced merely to organize tickets. The smaller processing stage still
uses its own GitHub decision journal, not the future worker database.

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
It does not settle the real release lane, timing of `main` changes, or artifact
policy below. The ticket contract now owns rehearsal outcomes; later release
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
sandbox does not settle the real lane, merge timing, builds, production database
inspection, or deployment/recovery choices. The later batch stage still starts
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

`inbox-run-v4` preserves earlier ticket and service history and adds saved batch
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

## Decisions to settle before execution

These are pre-existing differences, not changes introduced by the inbox reader.
The written baseline dates from commit `6980d965` (August 25); the differing
process steps were revised in `7834ebfd` (August 28). Housekeeping has made the
conflict explicit rather than treating both drafts as an agreed implementation.

| Question | Written baseline below | Process diagram draft |
| --- | --- | --- |
| How many releases may progress at once? | One global lane stays reserved across main, staging, production, and recovery. | Staging and production have separate reservations; staging is released after validation. |
| When does `main` change? | After combined tests, before release builds and staging. | After staging validation, the production decision/build, and a saved recovery point. |
| What files reach production? | The same saved builds that passed staging. | Fresh production builds from the same validated commits, with environment-specific files/settings. |

Before a worker can merge, build, or deploy, choose and record these policies,
then update both views together. Also define how a `target: staging` request
stops after staging and what authorizes any later production continuation.
The request schema permits both targets; a full production story must not be
read as permission to promote a staging-only request.

The design below is retained for review, including its older choices. It is
not a second operational authority alongside the current product release
instructions. The historical Release Bus implementation has no design authority
for this new Coordinator.

## The problem

Many developers and agents want to release work at the same time. Today, merge
and deployment are too tightly connected:

- one deployment may require `main` to stay unchanged for a long time;
- another PR can merge while a deployment is running and invalidate a later
  `main` equality check;
- frontend and backend PRs may need a specific order;
- shared staging and production cannot safely accept overlapping mutations;
- someone must keep watching workflows, tests, retries, and recovery;
- it is difficult to answer what is queued, what is running, and what exact
  code is deployed.

The Coordinator should make release submission asynchronous and durable:

> Submit exact ready PRs and their dependencies. The system owns the release
> until it finishes or reaches a problem that genuinely needs a human.

## Core rule: one release lane

Only one batch may use the release lane at a time.

The active batch keeps the lane until the release finishes or recovery is
complete. While it owns the lane, no other batch may:

- freeze its versions;
- change `main`;
- use staging;
- deploy to production.

Developers may keep working on pull requests. Review and CI may also continue.
Those changes wait for a later batch before they can merge.

This is slower than running several releases at once. It is also easier to
understand and recover in version one. The Coordinator always knows which one
batch owns `main`, staging, and production.

## Product promise

A developer, automation, or agent can submit one release request containing:

- exact frontend and backend PR numbers and 40-character head SHAs;
- dependencies between release parts;
- selected backend deploy units and any release-specific dependencies;
- whether the frontend, backend, or both will change;
- whether the database changes;
- the requester's stated identity and request time.

The release JSON says what should be released. It does not prove who submitted
it. One trusted workflow in this Release Coordinator repository adds the real
GitHub actor, actor ID, and workflow run when it sends the request to the inbox.
The repositories, branches, and commits to release come from the JSON itself.

Once accepted, the Coordinator queues, merges, builds, deploys, tests, retries,
recovers, and reports the exact outcome. The submitter does not need to keep a
browser, terminal, or agent task open.

## Architecture

```mermaid
flowchart LR
    U[Developer or agent] --> S[Product release skill]
    S --> CLI[Release-request CLI]
    CLI --> LOCAL[Local run and outbox files]
    CLI -->|submit| GHIN[Central GitHub submission workflow]
    GHIN --> INBOX[Public GitHub Issue inbox]
    INBOX --> R[Local read-only inbox reader]
    INBOX --> RC[Local read-only readiness observations]
    INBOX --> IP[inbox:run - inspect and rehearse]
    IP -->|record reasons and result| INBOX
    INBOX -. later .-> W[Coordinator worker]
    W --> DB[(Coordinator database)]

    W --> GH[GitHub API and merge rules]
    W --> FE[Frontend workflows]
    W --> BE[Backend workflows]
    W --> DBC[Database change workflow]
    FE --> ART[Saved builds]
    BE --> ART
    FE --> STG[Staging]
    BE --> STG
    FE --> PROD[Production]
    BE --> PROD
    DBC --> STG
    DBC --> PROD

    STG --> E2E[Version and journey checks]
    PROD --> E2E
    E2E --> DB
    DB --> C[Final result]
    W -. status .-> INBOX
```

The Coordinator is a separate system. It coordinates the product repositories
but does not copy their build, deployment, journey-test, notification, or release-note
logic.

### Coordinator owns

- authenticated release submission;
- the durable cross-repository queue;
- dependency resolution and stable ordering;
- release state, attempts, ownership records, errors, and history;
- one global release lane;
- staging and production environment ownership;
- workflow dispatch and result correlation;
- exact saved batch records and build identities;
- retries, safe recovery, and notifications.

### Product repositories own

- PR review and CI;
- how frontend and backend code is built;
- how the backend is deployed;
- how the frontend is deployed;
- how database changes are applied;
- runtime version reporting;
- repository-specific checks and journey-test entry points;
- deployment communication and release-note implementations.

## Where inbox and queue state live

The first inbox is a set of GitHub Issues in this public repository. One issue
stores one accepted release request and its trusted submission proof. This is
enough to collect requests before the Coordinator starts doing release work.

Before release execution, the [inbox-processing plan](./inbox-processing.md)
adds a separate lifecycle for organizing these tickets. Its statuses and
decision history must not be confused with an executing release batch. Its
durable history lives on the inbox repository's independent `codex/inbox-state`
branch; editable labels alone are not that history.

The inbox is not the full release queue. When the Coordinator starts batching,
merging, building, and deploying requests, it will use its own database, such as
PostgreSQL. GitHub has one merge queue per repository, so it cannot hold the full
truth for one release that includes both frontend and backend.

Minimum durable records:

- release request and stated requester;
- trusted GitHub actor, actor ID, and central workflow run;
- ordered release items and dependency edges;
- exact PR heads and captured `main` SHAs;
- current state and state-transition history;
- merge, build, staging, production, and journey-test attempts;
- GitHub workflow run IDs and links;
- saved build checksums and running version identities;
- retry limits, blockers, ownership records, and human decisions.

Only the Coordinator changes queue state. GitHub statuses and PR comments are
useful projections, but they are not the authoritative queue.

## How progress is saved

Before each step starts, the Coordinator saves what it is about to do. It also
saves which worker is doing the work and when that worker last reported that it
was active.

After the step finishes, the Coordinator saves the result and the proof. It
moves to the next step only after this save succeeds.

Each release record shows:

- the current step and status;
- when the step started and finished;
- which worker is responsible;
- the result and its proof;
- the current blocker, if there is one;
- what should happen next.

If a worker stops, another worker reads this record and checks what really
happened before it continues. It does not trust browser memory or a workflow
success message.

If the start or result cannot be saved, the release stops. It does not move to
the next step or open the release lane while its state is unclear. Saving the
same progress again must be safe and must not create a second result.

## Sources of truth

| Fact | Source of truth |
| --- | --- |
| Accepted request and trusted submission proof | Public GitHub Issue plus verified central workflow evidence |
| Queue, order, and current release phase | Coordinator database, once processing exists |
| PR number, current exact head, review, and CI | GitHub |
| Saved build identity | Trusted build storage |
| What is actually running | Runtime version proof |
| Whether the running release works | Journey tests and health signals linked to the saved batch |

## How `main` is protected

`main` is always protected by GitHub repository rules. Normal users and agents
cannot push or merge directly. A narrowly permitted Release Coordinator GitHub
App is the normal merge actor.

The database queue decides order. GitHub rules enforce authority.

When a batch reaches the front of the queue, the Coordinator:

1. reserves the global release lane;
2. freezes the exact pull request versions and current `main` versions;
3. combines and tests candidates on temporary branches, using the bounded
   selection rules above before choosing one exact passing batch;
4. checks the pull requests, approvals, CI, dependencies, and `main` again;
5. moves the tested result to `main`;
6. keeps the lane until the release or recovery is complete.

The final recheck and the change to `main` happen together. If anything changed,
`main` does not move.

GitHub cannot atomically merge two different repositories. Therefore:

- all cross-repository changes are fully preflighted before the first merge;
- backend changes must be safe to land before dependent frontend changes,
  normally through backward compatibility or a feature flag;
- if only part of the cross-repository merge succeeds, the release stops,
  records exact truth, and requires a deliberate repair;
- the system never claims that two repository merges were atomic.

An emergency administrator bypass may exist, but it is not part of the normal
release path and must be audited.

## Queue and release lane

Many requests may wait in the durable queue. Only one batch may become active.

The active batch owns one global lane across `main`, staging, and production.
No later batch may overtake it. A later batch starts only after the active
release finishes or recovery reaches a known safe result.

The lane is saved in the Coordinator database. It has an owner, a heartbeat,
and a current step. If the worker stops, another worker must prove that it can
continue safely before it takes over.

## Release lifecycle

The first state model is:

```text
SUBMITTED
  -> CHECKING
  -> WAITING
  -> ACTIVE
  -> PREPARING
  -> TESTING
  -> MOVING_MAIN
  -> BUILDING
  -> STAGING
  -> STAGING_VALIDATED
  -> PRODUCTION
  -> VERIFYING
  -> DONE
```

This is the successful path. If a release fails after `main`, staging, or
production changed, it leaves this path and enters `RECOVERING`. A successful
release never passes through recovery.

Important final or side states:

- `CANCELLED`
- `NEEDS_HUMAN`
- `RECOVERING`
- `RECOVERED`
- `FAILED`

Every transition is saved before later work begins. Operations are designed to
be safe to retry, and workers claim durable ownership so a restart cannot create
two owners for one mutation.

## Staging

For each release, the Coordinator:

1. applies the saved database change when the batch has one;
2. checks that the staging database change worked;
3. deploys the selected backend services from saved builds in dependency order, verifying each before its dependents;
4. deploys the saved frontend build after the backend is ready;
5. confirms the exact frontend and backend versions;
6. tests the important user journeys;
7. records `STAGING_VALIDATED` only when the versions and tests pass.

Staging validation belongs to the saved batch. A successful workflow is not
enough. The running versions and the user journeys must both pass.

## Production

Production receives the same saved builds that passed staging.

The Coordinator:

1. checks and saves the current production versions and last working builds;
2. applies and verifies the saved database change when the batch has one;
3. deploys the selected backend services from saved builds in dependency order, verifying each before its dependents;
4. deploys the frontend build after the backend is ready;
5. gives the release to more users slowly when the platform supports it;
6. confirms the exact production versions;
7. runs safe tests of important user journeys;
8. watches health for the full agreed time;
9. closes the successful release only when every check passes.

The Coordinator compares production with the saved batch. It never trusts a
deployment success message on its own.

## Recovery path

Recovery is a separate path. It runs only after `main`, staging, or production
changed and the release later failed.

The Coordinator:

1. stops the release and saves the exact current state;
2. chooses automatic recovery only when the database did not change and
   restoring the old code is safe;
3. restores the last working builds and adds new commits that undo the failed
   code, or follows the plan chosen by a person;
4. confirms the running versions, tests important user journeys, and checks
   system health;
5. closes the failed release and releases the lane only when the system is safe
   and its exact state is known.

These steps are shown as `R1` to `R5` in the process diagram. If the database
changed or anything is unclear, a person chooses how to recover. The lane stays
reserved until recovery is complete.

## Failure and recovery rules

### Database changes

These are proposed real-release rules. The sandbox implements their limited
sample equivalent; real database inspection/execution remains absent. The request's `database_change` answer covers release-specific schema
changes and one-off data changes. Normal application reads/writes still happen
for `no` requests; a test database must still be prepared.

Compare the declaration with inspected changes at the exact saved commits using
trusted rules. Include entity/schema definitions and one-off data-change code,
not just a migration directory. A yes from either source means database change.
An `unknown` answer, incomplete coverage, or missing change identity holds
execution. Absence of a familiar filename does not prove `no`. A declared `no`
contradicted by inspected code is recorded as database-changing and held for a
corrected request; never modify the accepted receipt or silently run it as `no`.

The same saved database change runs in staging first and production later. It
must finish and be verified before dependent backend services start. In the real
backend this may involve deploying and invoking `dbMigrationsLoop`; that adapter
and its proof remain to be designed, rather than assuming a separate SQL command.
Each environment must report the exact change, starting state, and verified result.

Only selected services run in dependency order. Omitted prerequisites need exact
existing-state proof; do not add them automatically. Retry/resume must verify
prior effects and avoid applying the same one-off data change twice. Unknown
partial state stops dependent work and requires reconciliation.

A database-changing release never recovers automatically. If it fails after the
database changed, the Coordinator saves the exact state and waits for a person.
Cleaning up a disposable sandbox database proves test isolation, not real rollback.

### A waiting PR moves

Cancel or supersede the old exact request. Never silently deploy the new head.

### An active PR branch moves

The release continues with its already saved `main` commits and builds.
The newer PR head belongs to another request.

### Merge conflict or failed preflight

Before `main` or a shared deployment environment changes, apply the bounded
batch-selection rules above. A confirmed code conflict or failing combined check
may lead to a smaller passing candidate. Save each attempt; leave excluded
tickets waiting or action-needed according to evidence. Never declare every
member broken because the group failed. No release is authorized by these tests.
If nothing passes within the limits, stop with recorded reasons. Keep ownership
while work or state is uncertain; release it only after safe cleanup and saving.

### Partial cross-repository merge

Stop. Record which `main` branch changed and which did not. Do not deploy or
pretend the merge was atomic. A human chooses the exact repair.

### Infrastructure failure

Retry only the same exact command and build within a fixed limit. An
AWS, GitHub, network, or runner failure is not evidence that a PR is bad.

### Build failure

Stop before staging. Because `main` already changed, the batch moves to the
recovery path. The lane stays reserved until `main` is repaired or a person
chooses another safe result.

### Staging application or journey-test failure

Do not validate the release. Move to recovery. A non-database batch may restore
the last working staging builds when every safety check passes. A
database-changing batch waits for a person.

After staging or another shared release state has changed, do not search for a
smaller batch as a recovery shortcut. Stop with a clear reason and recover the
recorded release. Bounded splitting belongs to pre-release candidate testing only.

### Production failure

Stop giving the release to more users. Save the exact running versions and
database state. A non-database batch may restore the saved builds and add new
commits to `main` that undo the failed code when every safety check passes. A
database-changing or unclear result waits for a person.

Recovery is complete only after the restored versions and health are checked.
The system never reports success from a workflow message alone.

### Stop request

- Before mutation, Stop cancels the release immediately.
- After mutation begins, Stop means safe stop. Finish or stop the active command,
  save the exact state, and enter recovery.

## Submit and almost forget

The API acknowledges a durable release ID. From that point, event-driven
workers and workflow callbacks continue the release without browser or agent
polling.

The submitter is notified only for meaningful outcomes:

- request accepted;
- staging validated;
- production completed;
- request cancelled because exact code changed;
- recovery completed;
- human action required, with the exact blocker and evidence links.

## Version-one scope

Version one should include:

- exact frontend and backend PR submission;
- explicit dependencies and deployment order;
- bounded batch selection and combined PR checks before release mutations;
- visible reasons and next actions for every excluded ticket;
- one durable database queue;
- one global release lane;
- GitHub-enforced protected `main` branches;
- one final safety check before `main` changes;
- saved batch records and builds that cannot change;
- clear database, backend, and frontend deployment steps;
- exact version checks and important journey tests;
- safe automatic recovery only for non-database releases;
- human recovery for database-changing or unclear releases;
- bounded infrastructure retries;
- final notifications and an operator dashboard.

## Explicit non-goals for version one

- automatic PR discovery;
- large automatic release trains;
- exhaustive search for the largest passing batch;
- splitting a release after shared state changed instead of recovering it;
- more than one active release batch;
- automatic recovery after a database change;
- pretending cross-repository merges are atomic;
- copying product build and deployment logic into the Coordinator;
- allowing two deployment authorities for the same environment;
- treating a successful workflow message as proof that deployment worked.

## Open decisions

- when the GitHub Issue inbox should move into the Coordinator database;
- GitHub App permissions and emergency access;
- maximum release size;
- real execution equivalents for the sandbox workflow/result, retry and cleanup contracts;
- the batch implementation choices listed under the batch milestone sequence;
- exact merge implementation and repository rules;
- real database inspection coverage, change commands, and version/effect proof;
- gradual rollout support;
- runtime version proof for the frontend and backend;
- production health signals and limits;
- how the Coordinator proves workflow results are real and handles timeouts;
- retention and audit requirements;
- human recovery roles;
- disaster recovery for the Coordinator itself;
- how the Coordinator is deployed without depending on its own release path.

## Design influences

- [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Google Cloud CI/CD guidance](https://cloud.google.com/solutions/best-practices-continuous-integration-delivery-kubernetes)
- [Google SRE canary guidance](https://sre.google/workbook/canarying-releases/)

These sources informed the draft. Settle the decisions above and align the
written plan with the process diagram before implementing release execution.
A future implementation must not silently choose between conflicting drafts.
