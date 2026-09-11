# Inbox processing contract

**One-ticket workflow merged; sandbox service extension implemented and tested
September 10, 2026.** See
[progress](./progress.md) for test and rollout evidence. Submit a request, then
run one explicit command to inspect its ticket, rehearse suitable exact PRs,
run supported sandbox service checks, and record the result on that same ticket.
Release execution remains separate.

This document owns the ticket states, labels, reasons, and first-processing
rules. [Progress](./progress.md) owns dated implementation and live evidence.
[The app guide](../apps/coordinator/README.md) owns commands that actually exist.
[The execution design](./design.md) describes later release work.

## Goal and boundary

After a processing run, a submitter can scan their open tickets and answer:

- Where is my request?
- Why is it waiting, or what needs fixing?
- Who needs to act next, and what should they do?

Clear outdated requests and requests whose PRs are all already merged leave the
active inbox with a recorded reason. Other requests that need evidence stay
visible. Closing a ticket never silently claims that a release happened.

The scope is intake defaults, ticket inspection, local merge rehearsal, supported
sandbox service/database checks, status updates, decision history, and migration
of existing tickets. Keep the installed CLI `0.0.4`
input and request schema `0.000001` unchanged. No new npm release or frontend/
backend installation is needed for this scope.

The rehearsal only merges in temporary local repositories. The release worker,
scheduling, product merges, builds, deployments, and recovery remain later work. No ticket status or
label authorizes release execution. The [agreed release rules](./design.md#agreed-execution-direction-september-11)
reuse existing deployments, require successful staging E2E before production,
and keep one release active through recovery. Those rules are not implemented here.

## Responsibility and commands

| Part | Responsibility after implementation |
| --- | --- |
| Public CLI | Continue sending the existing exact request. It does not supply trusted identity, lifecycle status, or release authorization. |
| Central submission workflow and Issue-creation helper | Verify the request, identify the GitHub submitter, and create a consistently organized ticket. Preserve an existing ticket on a retry. |
| `inbox:read` and `readiness:check` | Remain read-only. Share the inspection logic with processing, but never apply Issue changes. |
| `inbox:run` | Inspect tickets, generate a plan from the ticket and configured destinations, rehearse its exact PRs, save evidence, and apply labels, status comment, assignment, and Issue state. Run manually and exit. |

The write command is `inbox:run`. It requires an explicit sandbox/real profile.
The command automatically creates a separate plan for each suitable ticket. Its
[command guide](../apps/coordinator/README.md#run-the-ticket-workflow)
describes GitHub writes, selection, and recovery. It is not a background service.

Older workflow revisions create `release-request`, `pending`, and target labels
with the request UUID as title. The updated workflow creates the defaults below;
both updated readers select every open `release-request` ticket. Ship these
changes together and update local readers before dropping legacy `pending`.

## Initial ticket setup

For a new, verified request, the central workflow should create:

- A readable title derived from target, repositories, PR numbers, and selected
  units. Example: `Staging · backend PR #1978 · API`. Keep the full request ID
  in the existing receipt and markers; a title is display text, not identity.
- `release-request`, exactly one `status:received`, exactly one target label,
  and the applicable component labels.
- The verified GitHub submitter as assignee where assignment is supported.
  Preserve the actor's stable ID and login from the workflow. Never derive
  trusted identity from the free-text `requested_by` field.
- One Coordinator status comment: received, next action is inspection, action
  owner is the Coordinator, and no submitter action is required yet.

Do not create speculative reason labels before inspecting evidence. Preserve
the accepted JSON, checksum, request markers, actor, and workflow receipt.
The initial status comment is separate from that receipt.

The same request ID and same JSON must reuse its existing Issue, including a
closed Issue. A retry must not reset status, reopen it, or duplicate comments.
Different JSON under the same request ID remains an error. Corrected code or
scope requires a new request, not editing the original payload.

## Status labels

Use exactly one Coordinator `status:*` label per ticket. These are ticket
lifecycle states, distinct from the read-only report's `valid`, `blocked`, and
`unknown` observations.

| Label | Meaning | GitHub Issue state |
| --- | --- | --- |
| `status:received` | Accepted and awaiting first inspection. | Open |
| `status:waiting` | Waiting for checks, evidence, or missing Coordinator capability. The next action owner is stated. | Open |
| `status:action-needed` | A named person or team must make a specific correction or decision. | Open |
| `status:eligible` | Initial inspection found a candidate for further release checks. This is not release readiness or deployment approval. | Open |
| `status:completed` | Successful release of this exact request to its target is supported by verified evidence. | Closed |
| `status:closed` | Retired without claiming successful release. At least one closure reason is required. | Closed |

Received tickets move to the state justified by inspection. Waiting and
action-needed tickets are reassessed on later runs and may become eligible or
close when the required evidence or decision exists. Eligible tickets must also
be rechecked: code, checks, and evidence can change.

Terminal decisions are preserved on repeated runs and resubmission. Neither a
manual label edit nor an Issue reopen erases recorded history. A deliberate
correction of a wrong decision must identify the authorized actor and append a
new decision; it must not rewrite the old record.

## Reason and scope labels

Use zero or more reason labels, drawn from a small registry. Remove resolved
reasons from the current labels while keeping them in decision history. Waiting,
action-needed, and closed tickets need at least one reason and a plain-language
explanation. Reasons are not permissions.

| Reason | Typical action |
| --- | --- |
| `reason:outdated-commit` | Retire a verified request whose requested commit no longer matches its PR. Include requested and observed commits. |
| `reason:already-merged` | Retire a verified request when all its exact PRs were already merged before Coordinator execution. A verified merged PR plus an open or unverified companion keeps the request action-needed for a scope decision. Unverified evidence alone does not trigger this reason. Deployment is not verified or claimed. |
| `reason:checks-pending` | Wait for required checks; recheck on the next processing run. |
| `reason:checks-failed` | Identify the failed required checks and the person who can fix them. |
| `reason:merge-conflict` | Identify the PR/base evidence and the correction needed. |
| `reason:review-required` | State the review requirement or requested changes and who needs to respond. |
| `reason:invalid-dependencies` | Explain missing parts, unknown services, unsupported target, or ordering cycles. Ask for a corrected request. |
| `reason:request-unverified` | Keep the ticket visible when intake proof cannot be verified. Route contradictory records to maintainers; temporary API/log failures may wait. |
| `reason:deployment-unverified` | Obtain proof for the exact code, selected scope, and target. Merged PRs alone are insufficient. |
| `reason:prerequisite-unverified` | Obtain the required deployed state of an omitted prerequisite; do not add or deploy a service automatically. |
| `reason:coordinator-incomplete` | Name the missing Coordinator capability. The action belongs to Coordinator maintainers, not automatically to the submitter. |
| `reason:overlapping-requests` | Explain which requests overlap and what decision is needed. Do not select the newest by timestamp. |
| `reason:merge-plan-required` | Historical manual-plan reason, retained only to read old decisions; no longer emitted. |
| `reason:merge-plan-invalid` | Resolve a request/order that the Coordinator cannot turn into a valid rehearsal plan. |
| `reason:merge-plan-unavailable` | Restore the configured destination or missing GitHub evidence so the Coordinator can prepare its plan. |
| `reason:rehearsal-blocked` | Resolve the recorded combined conflict or other stable rehearsal blocker. |
| `reason:rehearsal-unverified` | Restore missing evidence or report storage, then rerun. |
| `reason:rehearsal-stale` | Inspect changed inputs, refresh the plan where appropriate, then rerun. |
| `reason:cancelled` | Close after an authorized cancellation is recorded. |
| `reason:replaced` | Close with an explicit replacement request link and recorded replacement decision. |
| `reason:test` | Close a confirmed test after its purpose is complete. Editable title text alone does not establish this. |

Retain the existing `release-request` and `target:staging` /
`target:production` labels. Add `component:frontend` and/or
`component:backend`, derived from the saved request. Combined requests get
both component labels.

The processor owns its registered labels, not arbitrary user-created labels.
It must not remove unrelated labels or use them as proof of an outcome.
The legacy `pending` label is replaced only through the migration below.

## Rehearsal outcome

The same command first applies the initial gates below. Terminal/outdated,
already-merged, overlapping, draft, failed-check, review, identity, and other
initial blockers do not enter rehearsal. Unknown per-PR service catalogs may
be resolved by the exact combined catalog; unknown runtime prerequisites cannot.
For suitable tickets, the Coordinator generates a plan from the saved request
and current `main` commits selected by trusted profile configuration. It uses
the shared dependency sorter and keeps PR order within each part. It never
drops a requested PR or guesses an unavailable destination. Invalid scope/order
gets `merge-plan-invalid`; unavailable configuration/evidence gets
`merge-plan-unavailable`. No operator plan file is needed.

For nonterminal tickets, use one managed outcome label, separate from lifecycle:

| Label | Meaning |
| --- | --- |
| `rehearsal:not-run` | Initial evidence or an invalid generated plan prevented rehearsal. |
| `rehearsal:passed` | Exact planned merges and observed gates passed; cleanup and report saving succeeded. |
| `rehearsal:blocked` | Stable evidence demonstrates a conflict or another blocker. |
| `rehearsal:unknown` | Evidence, cleanup, or report saving could not be verified. |
| `rehearsal:stale` | Inputs changed during the rehearsal. |

The single maintained comment shows findings, exact destinations, resulting
trees, and the plan fingerprint. A blocked rehearsal is action-needed; unknown
or stale evidence waits. Passing rehearsal still waits for independent release
history/ownership and future execution. It never produces eligible/completed,
claims a tested build, or authorizes a release.

Only freshly generated reports enter this policy. Reverify the receipt before
and after rehearsal, recheck PRs/destinations, and save the report before recording
passing ticket evidence. On meaningful change, the journal stores the plan,
receipt bindings, report hash and revision, findings, cleanup, and exact results.
Before Git begins, each generated plan is also saved under its ticket number in
the run lock. An uncertain save prevents rehearsal and ticket writes.
Unchanged repeated runs still rehearse afresh and save local reports, but do not
append duplicate decisions/comments. A later failure removes the old passing
label and retains both meaningful outcomes in history. An interrupted run keeps
its lock; explicit resume uses the stored plan and fresh evidence.

<a id="proposed-service-and-database-ticket-outcomes"></a>

## Sandbox service and database ticket outcomes

**Implemented and tested September 10, 2026; see [progress](./progress.md) for live and merge evidence.** The
[one-ticket sandbox stage](./merge-rehearsal-testing.md#service-and-database-acceptance)
comes before batching. Reuse the managed comment, submitter ownership, and
decision history and original request/receipt. The sandbox writer uses
`inbox-run-v5` (service attempts were introduced in v3); older writers must stop. The journal's `service_attempts` map saves
exact plans and attempts before dispatch; finished results remain available for
retries through the history index.

Managed labels are `services:not-run`, `services:passed`, `services:blocked`,
`services:unknown`, and `services:stale`. Reasons are `database-unverified`,
`database-declaration-mismatch`, `service-checks-failed`,
`service-checks-unverified`, and `service-checks-stale`. These describe sandbox
checks separately from Git rehearsal and any future release outcome.

| Evidence | Presentation and next action |
| --- | --- |
| Sandbox service/database/integration checks pass | Keep the ticket open and waiting for future release capability. Show the exact tested versions and sample outcomes separately from `rehearsal:passed`; never claim real deployment or completion. |
| Database answer or inspection is unknown | Wait with the missing fact and its owner. The current unresolved classification goes to Coordinator maintainers for reconciliation, including obtaining requester clarification. No dependent execution starts. |
| Declared `no` contradicts a verified database change | Action-needed for a corrected request. Show the declaration, changed files, observed database change, and submitter action without altering the receipt. |
| A database or service check has an attributable program failure | Action-needed with the exact step, versions, expected/actual result, and correction owner. Preserve any partial database effect and which dependents did not start. |
| Runner failure, timeout, unknown prior effect, or missing version/prerequisite proof | Wait with evidence and a bounded retry or reconciliation action owned by the responsible maintainer. Do not blame the submitter's code without support. |

Show the attempted service order, database declaration and inspection result,
per-step outcomes, data/integration assertions, workflow/report links, cleanup,
and retry condition. Compare with the baseline before claiming a ticket caused a
failure. A retry must not duplicate data changes or unchanged comments/decisions.
A database classification hold has no service attempt to reconcile. Confirm the
answer and inspection coverage; changing the immutable answer requires a corrected
request before another run can proceed.
Simulation of a failure after a database change must state that real recovery
would require a person; temporary-resource cleanup is not successful recovery.

<a id="proposed-batch-ticket-outcomes"></a>

## Batch ticket outcomes

**Implemented for unscoped sandbox runs; see [progress](./progress.md) for evidence.**
The [batch-selection policy](./design.md#proposed-batch-testing-and-selection)
finishes cheap intake, scope, database and Git filtering before new combined
PR/service checks. `--issue` retains one-ticket handling. Initial batching only
supports self-contained staging requests with verified no-database-change scope.
Cross-ticket dependency declarations remain future work; inseparable changes
must be submitted as one complete ticket.

`inbox-run-v5` preserves the batch history introduced in v4 and archives completed
details without rewriting prior decisions or attempt identities. New managed labels are `batch:passed`, `batch:blocked`, `batch:waiting`,
`batch:unknown` and `batch:stale`. Reasons are `batch-selected`,
`batch-ticket-failed`, `batch-incompatible`, `batch-limit`, `batch-deferred` and
`batch-unsupported`; the existing database-declaration-mismatch reason is reused.
A selected passing group stays `status:waiting`, never completed or eligible for
release execution. Excluded tickets retain the same comment, reasons, action
owner, exact group/attempt and check links. Unknown results never blame a submitter.
Reusing a saved group requires fresh input checks and a fresh read of its actual
GitHub CI/service evidence. Missing or changed proof stops reuse; a cached journal
result alone is insufficient. This verification starts no new CI. Its scope is the frozen eligible pool after
cheap scope and ticket/PR-limit filtering. A ticket held outside that pool cannot
invalidate its test result by changing unrelated PR evidence. Tickets inside the
pool still require fresh exact evidence throughout selection and splitting.

The general future outcomes below also cover capabilities beyond this first
stage, including cross-ticket dependency groups and reassessment after a real
release. Those capabilities are not implied by the new sandbox labels.

Leaving a ticket out of a candidate keeps its PRs and Issue open. Keep the entire
ticket and any inseparable dependency group together. Selection or a passing
test never means completed; only verified release evidence can support that.

| Evidence for exclusion | Proposed ticket state and next action |
| --- | --- |
| A specific required check, code failure, internal/base conflict, or invalid scope is attributable to this ticket | `status:action-needed`; name the exact blocker, evidence, and person/team who can correct it. Fixed code or scope requires a new request. |
| A and B pass separately but fail together | Leave the excluded independent ticket `status:waiting`; link the chosen candidate, the incompatible request(s), exact versions, and failing attempt. Do not claim either ticket is individually broken. |
| A request needs another excluded request | `status:waiting`; name the dependency and keep the required group together. |
| Testing stopped at its time/attempt limit without a conclusive result | `status:waiting`; say that investigation is incomplete and the Coordinator owns the next attempt. |
| A runner, GitHub read, baseline test, or result verification failed | Usually `status:waiting`; state the infrastructure/evidence problem and bounded retry. If a known correction needs a person, route action-needed to the responsible maintainer, not automatically the submitter. |
| An inseparable group is incompatible and cannot be divided | `status:action-needed` for a named correction or scope decision; explain the group evidence and any uncertainty about attribution. Never guess one culprit. |

After the selected release finishes, reassess deferred requests against the
actual current base. In the A/B case, once A is in `main`, B includes A through
that base. If B still has a confirmed attributable failure, it becomes
action-needed. Waiting alone is not a fix. Do not keep retrying a known unchanged
failure without a recorded reason; new code must arrive through a new request.

Before blaming a ticket for a combined test failure, compare the unchanged base
when needed. A group failure, a pre-existing failure on `main`, or an unavailable
runner is not proof that every included request introduced a bug. State exactly
what was tested and what remains unknown. The existing handling of a failed
required PR check still identifies that check as a blocker; it does not prove
which author caused it.

Use the same managed status comment, assignment rules, and append-only decision
history. Show the candidate/attempt, request versions, reason, linked checks or
conflict paths, next action, action owner, and retry condition. Keep the original
receipt intact. Unchanged observations must not create duplicate comments.
For example, before any real merge:

> **Status:** Waiting.
>
> **Reason:** B passed separately, but A+B failed test X. A was selected first
> under the saved request order; this does not prove B is independently broken.
>
> **Next action:** The Coordinator will reassess B after A's release finishes.
> If the failure remains against the new `main`, B will need a correction.
>
> **Evidence:** Link both passing attempts and the failing A+B attempt, with
> exact commits and the test log. Until those results exist, use an incomplete
> evidence reason instead of this example.

## What submitters see

Maintain one recognizable Coordinator status comment per ticket. Use stable
identity for that comment, not a search for arbitrary matching text. Show:

| Field | Content |
| --- | --- |
| Status | The current state in plain language. |
| Why | Each unresolved reason, tied to the affected PR, part, or service. |
| Next action | A concrete action; say when the next processing run can recheck automatically. |
| Action owner | Coordinator, Coordinator maintainers, submitter, or a named reviewer/operator. |
| Submitter action | Exactly what the submitter needs to do, or explicitly none. |
| Evidence | Relevant request, PR, checks, workflow/deployment links, exact commits, and target. |
| Last decision | Time and the person or trusted process responsible for the latest meaningful change. |

Example for backend ticket #13 under the already-merged policy, if a fresh
inspection still verifies its exact PR as merged:

> **Status:** Closed — already merged
>
> **Why:** This PR was already merged before Coordinator release execution.
> The Coordinator will not handle this request. Deployment has not been verified.
>
> **Next action:** If deployment is still needed, use the existing authorized
> release process. Submitting the same merged PR again leads to the same closure.
>
> **Action owner:** Submitter.
>
> **Submitter action:** Arrange the existing release process if deployment is needed.
>
> **Evidence:** Request #13, backend PR #1978, matching requested branch/commit,
> same-repository source, and stable merged-state observations.

Assigning the verified submitter makes an Assignee filter useful even though
the workflow created the Issue. Keep submitter assignment separate from the
next action owner: a ticket can belong to a submitter while waiting on the
Coordinator. GitHub supports filtering by assignee and labels; assignment is
subject to repository eligibility. See [assignment rules](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/assigning-issues-and-pull-requests-to-other-github-users)
and [Issue filters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests).

If assignment cannot be made, preserve and display the verified submitter,
report the assignment problem, and provide lookup by that recorded identity.
Do not substitute a different user or treat ownership setup failure as loss of
the accepted request. The implementation must cover this fallback.

Repeated unchanged scans must not append comments, recreate labels, or produce
duplicate transition records. Keep per-run check times in scan output/history
without turning each poll into a new ticket conversation.

## First-processing rules

1. List all open `release-request` Issues, including waiting, action-needed,
   and eligible tickets. Complete pagination before claiming a complete inbox.
   Reconcile known ticket IDs with recorded history where necessary; an edited
   label must not erase a recorded request or decision.
2. Verify saved intake evidence before using the payload for product reads or
   an automatic terminal decision. Missing or contradictory proof stays visible
   for investigation; it is not proof of cancellation or completion.
3. Reuse current PR, required-check, review, catalog, and dependency observations.
   Recheck facts supporting a change before applying it. A failed read or
   moving observation cannot become a confident automatic closure.
4. Retire clearly outdated requests with requested/observed commit evidence.
   Do not call them replaced unless an explicit replacement relationship is
   established. Respect any recorded terminal or active execution ownership;
   later execution must not have its frozen request retired by a routine scan.
5. Retire a request with `already-merged` when every requested PR has verified
   matching code, same-repository source, and stable merged-state observations.
   Recheck closure evidence before closing. No deployment, prerequisite state,
   or previous release outcome is inferred. Existing outdated-commit handling
   takes precedence when code differs. A request with at least one verified
   merged PR and an open or unverified companion stays action-needed: use the
   existing authorized release process for the whole
   release, or submit corrected open-PR scope with required dependencies accounted
   for. Do not execute a subset or instruct an identical merged-PR resubmission.
6. Put unresolved evidence in waiting, or a concrete human correction in
   action-needed, and name the owner. A missing Coordinator feature is not a
   submitter failure. Unverified or unstable merge evidence cannot close a ticket.
   With no verified merged PR, missing product evidence alone can remain waiting
   with `reason:coordinator-incomplete`; missing intake proof uses
   `reason:request-unverified`.
7. Mark eligible only when the required initial checks support candidacy and
   there is no unresolved first-processing blocker or recorded terminal outcome.
   The full readiness report may still have unknown later-stage checks, such
   as combined-merge proof. Do not map report statuses directly to labels or
   infer eligibility from a valid receipt alone.
8. Record the decision before presenting it as applied, then update only the
   managed ticket presentation and Issue state. Verify the applied result and
   report any partial failure for reconciliation on the next run.

Missing release history is not evidence that a request was never completed or
cancelled. Initial processing history can record its own new decisions; it must
not invent earlier outcomes. `status:completed` is reserved until a supported
source proves the exact release outcome. The first implementation need not be
able to complete existing releases in order to organize the inbox honestly.

The already-merged rule applies before Coordinator release execution, including
to tickets previously marked received/waiting/action-needed. These are intake
states, not execution ownership. No executor exists in this version. A future
worker must record ownership before merging and retain responsibility after
its own merge; this intake rule must not abandon that work. Unknown ownership
fields in the journal already stop the current processor before ticket writes.

## Decision history and safe retries

Labels and the maintained comment are a readable view of decisions, not the
sole trusted history. Keep a durable record of meaningful transitions with:

- Request ID, Issue ID/number, request checksum, exact code/scope, and target.
- Previous and new status, reason codes and explanations, and evidence references.
- Next action and its owner; verified submitter ID and login.
- Decision time, deciding actor/process, inspection revision/run, and policy version.
- A unique transition identity and recorded application result so retries can
  finish an interrupted update without creating a second decision.
- Replacement request identity or cancellation/completion evidence when relevant.

Do not rewrite the original receipt to store mutable status. Preserve previous
decisions, including decisions later corrected. If a GitHub update succeeds only
partly, report it and reconcile against the recorded intended result. Never
describe an unapplied update as complete. Concurrent runs must not overwrite
newer decisions or reset terminal outcomes.

<a id="planned-history-storage"></a>

### History storage

**Implemented locally September 11; live migration has not run.** The v5 writer
keeps complete unfinished work in `inbox-state.json` and moves finished batch and
standalone service details to the same independent `codex/inbox-state` branch.
The former 100-batch and 1,000-service lifetime caps are removed. Per-search
limits still apply: 10 tickets, 10 PRs per repository, 40 Git attempts, 12 check
rounds and 45 minutes. Closing a ticket does not erase its evidence.

- `inbox-state.json` retains ticket decisions and their transition chains, the
  current lock and plans, complete active attempts, and a compact `history`
  index. Index keys are the original batch fingerprints or service plan hashes.
- `history/batches/<checksum>.json` and `history/services/<checksum>.json` hold
  complete records, including original inputs, budgets, attempt IDs and results.
  The checksum names the content, so a later stale observation can have a new
  snapshot without overwriting the original result. Earlier files remain in the
  branch tree and their references remain in Git commit history.
- Index summaries contain ticket/request IDs and request checksums, outcome,
  evidence links, file path and content checksum. Exact PR versions and full
  result details are in the archive. The managed ticket still explains outcomes.
- Exact repeats load only the required record, check its profile, identity,
  checksum and structure, then use the normal remote evidence revalidation.
  Old attempt IDs, deadlines and budgets remain intact. Missing or altered
  archives stop reuse; they never mean “start a fresh attempt.”

Archiving is part of releasing a successfully presented manual run, not a new
command or a background worker. All referenced tickets must have their latest
updates saved and no presentation error. Their history must contain the relevant
batch/service outcome. Every operation must have a terminal result and verified
cleanup, including temporary PRs and service resources. `batch.status: finished`
only says the selection search ended; it is not enough on its own. Unfinished
records stay active. A standalone service attempt referenced by an active batch
also stays active. There is no implemented release executor needing to keep a
candidate active; a future executor must add its own ownership check here.

The writer builds on the verified previous Git tree, saves archives and the
smaller state file in one non-force commit, and reads back the state and newly
written archives. Ordinary saves preserve existing files. A lost archive ref
response is accepted only if the exact intended commit and its contents can be
verified; otherwise processing stops. If final readback fails, inspect the journal:
the release commit may already exist, so resume only if that run still holds the
lock. A failed or competing save cannot silently
drop active evidence. Earlier ordinary-save uncertainty still stops the run.

If both the save confirmation and the following journal read fail, the processor
stops and tells the operator to inspect the journal. It never skips verification
and reports success. Once readable, the durable archive can support an exact
repeat with its original attempt IDs and budgets. A batch identity saved before
its first attempt is different: it legitimately has no prior record yet. Resuming
that initial gap may create its first attempt; a referenced but missing archive
always stops processing, including when the batch inputs are unchanged.

`workflow: "inbox-run-v5"` fences older writers before they can drop archive
files. The next authorized v5 run upgrades a legacy/v1/v2/v3/v4 journal under its
lock, preserving receipts, transitions, plans, original results and resume scope.
Cleanup and presentation obligations must still finish before details move out
of the active file. Profile separation and stop-before-resume are unchanged.
The API adapter permits only the fixed state file, checksum-named archive paths,
and the existing journal branch operations.

This is a small Git-backed index, not unlimited storage. Compact references and
ticket decision history still grow in the main file. Keep them for this manual
stage; measure usage before adding index pagination or retention. There is no
separate database, dashboard or automatic archive deletion.

See [history acceptance](./merge-rehearsal-testing.md#history-storage-acceptance)
and [local implementation evidence](./progress.md#controller-and-history-cleanup-september-11).

### Storage and trusted writers

The first implementation uses the fixed GitHub branch **`codex/inbox-state`**,
with `inbox-state.json`, verified history files and an independent commit history. It
is never merged into source branches. The state includes a versioned schema,
repository identity, parent commit, run lock, and per-ticket decisions/application
results. Decision records form a hash chain. Their receipt binding and previous
records are checked before use. Git updates never force a ref; two competing
writers cannot both advance the same parent.

The trusted writer is the authenticated GitHub account with repository write
permission, verified from `/user` and repository permissions. The account needs
contents and Issues write access. Each decision records its stable GitHub ID and
login. Repository administrators and writers remain trusted: hashes detect broken
records, not a malicious maintainer who can rewrite the entire branch. Preserve
this branch and its history; deletion cannot be distinguished from first setup
by a new machine. External state edits or force pushes are outside this protocol.

Acquire the repository-wide journal lock before inspection/Issue changes. Save
intended decisions and the status-comment identity before applying updates. Save
and verify the applied result afterward. A failed or uncertain API call keeps
the lock. Resume is an explicit operator action after stopping the old process
and allowing in-flight calls to settle, never an automatic lease expiry. It
preserves the original selection/action and rotates the ownership token. The
old process checks the current token before every Issue mutation and journal
advance. GitHub Issue calls are not transactional; do not run a resumed copy
while the original process may still be alive. The command guide owns the
recovery procedure and timeout guidance.

The [v0.1 run logs](./design.md#next-step-v01-run-logging) add local step history
and live progress, separate from this journal. They explain started, verified and
uncertain operations and actual cleanup. They do not supply ticket evidence,
change labels or ownership, or replace the journal's recovery records. A log write
failure is visible but does not discard saved decisions or prevent existing
cleanup. No heartbeat, board or automatic takeover is included; the
stop-before-resume requirement remains. See progress for local versus live proof.

The workflow's initial comment identity is bound to its verified result log.
If a comment POST loses its response, its previously recorded random marker and
author ID allow recovery; an arbitrary lookalike comment is not adopted. Once
known, the exact comment ID is retained. Ambiguous, missing, or edited identities
stop processing for investigation. The processor waits for active intake to
finish so it cannot race the workflow's initial setup.

Only the verified original submitter may use the explicit `--close-test` action
for their own test. It records that authenticated decision. General cancellation,
replacement, completion, and terminal corrections remain reserved; no commands
for those actions exist yet. No test is inferred from editable request/title text.

The combined workflow uses policy `2026-09-10.2`. It upgrades the journal to
`workflow: "inbox-run-v5"` without changing prior decisions or service identities;
legacy/v1/v2/v3/v4 journals upgrade on an authorized write. Older
checkouts reject this field before writes, even if a pass adds no new reason.
Once that marker is recorded, use a checkout supporting the combined workflow. Older processors reject unknown reasons and stop safely;
update the checkout rather than rewriting history. No public CLI upgrade is needed.

`status:eligible` and `status:completed` are also reserved in this first version.
Unknown earlier release outcomes/active execution ownership currently produce
`reason:coordinator-incomplete`. This inbox journal proves its own dispositions;
it is not independent evidence of a prior deployment, cancellation, or worker
reservation. Unchanged scans create no new transitions/comments; acquire/release
commits record runs. The active journal and compact history index are intended for this small manual
inbox; growth beyond GitHub's content API limits must be addressed before scaling.

## Migration of existing tickets

Ship intake setup, broader reader selection, status handling, and migration as
one coordinated change:

1. Make readers and processing understand both legacy `pending` tickets and
   the new statuses. Preserve read-only command behavior and existing proof checks.
2. Start new-ticket initialization with `status:received` and the new metadata.
   Do not remove `pending` while any supported reader still depends on it.
3. Inspect existing open tickets afresh, record their justified outcomes, and
   apply the new title/assignment/status presentation without changing their
   original request or workflow receipt. Use the verified original submitter.
4. Remove legacy `pending` after the supported readers no longer require it.
   Ensure a waiting ticket remains in future scans.
5. Preserve already closed tests and other terminal tickets. Repeated submission
   and migration must not reopen them or reset their status. Existing closed
   tickets without trusted disposition history are not automatically completed.

The September 9 migration closed #1, #2, #3, and #19 as outdated and left #13
and #16 waiting under policy `2026-09-09.1`. Policy `2026-09-09.2` can close the
remaining two with `already-merged` after rollout and a fresh confirming check.
The earlier waiting decisions stay in history. See progress for actual live
application; this policy description does not claim those closures happened.

## Implementation finish line

- Existing CLI requests still submit unchanged; no consumer/npm upgrade is required.
- New tickets have a readable title, derived scope labels, received state,
  verified submitter ownership, and one initial status comment.
- One explicit processing run leaves every selected ticket organized or reports
  exactly why an update could not be applied. Unknowns stay visible with owners.
- Both read-only commands remain read-only and continue to include open waiting
  tickets after the legacy-label migration.
- Automated tests cover initial intake, retries on open and closed tickets,
  outdated/already-merged closure, mixed requests, incomplete/contradictory proof,
  reasons resolving, assignment failure, history integrity, concurrent/partial
  updates, and migration without lost or duplicate tickets.
- An authorized controlled GitHub test verifies actual labels, assignment,
  comment, closure, and unchanged original receipt; its deliberate test outcome
  is recorded. Local tests and live ticket writes are reported separately.
- Repeating processing with unchanged facts produces no duplicate comments,
  transitions, or reopened requests. No merge, build, or deployment occurs.

The [merge engine](./merge-rehearsal-testing.md) and
[profiled inbox](./profiled-inbox-testing.md) now feed the same ticket workflow.
The local implementation and its acceptance evidence are recorded in
[progress](./progress.md). Release execution and independent deployment/prerequisite
evidence still need their own work.
