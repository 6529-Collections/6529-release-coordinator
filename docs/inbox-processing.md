# Inbox processing contract

**One-ticket workflow merged; sandbox services, batching, and the fake release
sequence implemented and tested by September 11, 2026.** See
[progress](./progress.md) for test and rollout evidence. Submit a request, then
run one explicit command to inspect its ticket, rehearse suitable exact PRs,
run supported sandbox service checks, and record the result on that same ticket.
A sandbox run can continue one selected no-database-change batch through
protected fake staging and production. It also selects one verified
database-changing ticket alone. Real product evidence remains separate from
sandbox evidence.
The current working tree applies the same ticket/batch engine to the real
repositories and existing product workflows; it has offline proof only.

This document owns the ticket states, labels, reasons, and first-processing
rules. [Progress](./progress.md) owns dated implementation and live evidence.
[The app guide](../apps/coordinator/README.md) owns commands that actually exist.
[The execution design](./design.md) describes the live-tested sandbox path and
the locally implemented real-product path.

## Goal and boundary

### Cleanup without release execution

`inbox:cleanup` is a separate, manually invoked ticket maintenance action. The
user-approved October 1 design uses only `action-needed` and `closed` for new
decisions: it never emits `waiting` or `eligible`, and passing initial checks
does not authorize or start a release. Existing terminal decisions and closed
Issues remain unchanged. Cleanup skips tickets reserved by a running, paused or
recovering release. It can check and update other tickets while that release
continues; saved unfinished releases remain protected even without a live lock.

The command requires an explicit profile and `inbox` or `filtered` scope, verifies
the existing current-profile v7 journal and intake receipts, reads current PR,
check, review and dependency evidence, and updates the same Coordinator status
comment, managed labels and next-action owner. It journals each decision before
applying it and verifies the resulting Issue. GitHub remains the state source;
the dashboard reads those same Issues and applied decisions.

The cleanup scan reuses successful intake proof only for the same Issue ID,
number and exact receipt body within that invocation. Closed tickets with an
already verified terminal presentation and matching journal receipt are left
unchanged without downloading their old submission logs again. Pending closure,
reopened Issues and changed receipts do not take that shortcut.
Completed job logs and catalogs at pinned commits can be reused within the run;
workflow metadata, PRs, assignee eligibility and Issue/comment readback stay fresh.
Before a new closure the writer re-verifies the receipt and current intake
workflow, then independently rechecks current PR and any release-follow-up evidence.

Clearly obsolete or all-merged requests use a fixed, smaller PR-identity query
and two independent observations, without check pagination, catalog reads or
approval-bypass discovery. They still use the same closure rules, source binding
and saved release-ownership protection. Requests that may still need release
work use the full check/review/dependency reader. This maintenance observation
does not establish release readiness. Managed label definitions are ensured
once per run; every Issue's applied labels, comment and state are still verified.

Verified stable outdated requests and requests whose exact PRs were all merged
before release execution can close with their existing reasons. Missing proof,
pending checks, failed checks, conflicts, review requirements and overlapping
requests become concrete named actions. Current requests without a first-stage
blocker receive `reason:release-action-required`: decide whether to run an explicit
scoped release with fresh checks or record an authorized cancellation.
No request is closed merely for its age or a guessed replacement.

An earlier selected release or recorded release projection prevents automatic
intake closure merely because its PR is now merged or changed. The October 2
follow-up checker can reconcile a verified frontend-only, no-database-change
attempt stopped with `release-stale` before production operations. It requires
the full saved batch bound to the exact request, completed known staging
operations, no recovery/cancellation, and recorded temporary cleanup.

The checker uses a separate fixed GET-only client. It verifies repository
identities, current staging/production refs, and complete workflow-run/job
pagination from the earliest owned attempt's start. Separate activity reads
have no date cutoff: the newest workflow page and every active-status count
must be quiet both initially and on the final reread. Positive but unlisted
counts, unreadable activity, or a still-active run created before the original
attempt block closure. Completed older runs do not block closure. Current
staging must have a successful deployment and its unique automatic matching E2E chain; a production
request also needs the corresponding current production chain. It checks approved
workflow blobs, exact run/attempt identities, required successful jobs, triggers,
actors and causal order. Backend deployment must match its current branch and
predate frontend validation. Every requested commit must be an ancestor of its
merged PR head, and that merge must be included in the later delivered commit.
Rebased or otherwise unprovable equivalence needs a person.

Several saved attempts may name the same pinned request. Every attempt must pass
the stopped/no-database-change eligibility checks, and every attempt's temporary
resources and original staging integrations must be accounted for independently.
The current delivery chain can then prove that same request's inclusion once;
it does not blend their outcomes, omit an old effect or change their history.
One active, uncertain or unaccounted attempt keeps the whole ticket actionable.

GitHub's [workflow-run search](https://docs.github.com/en/rest/actions/workflow-runs)
returns at most 1,000 matches for a `created`-filtered query. Its
[September 25 API change](https://github.blog/changelog/2026-09-25-changes-to-query-results-in-the-github-actions-api-and-ui/)
also permits imprecise large counts. A capped, imprecise, moving or incomplete
result remains unknown and names the missing complete evidence; a maintainer
must reconcile narrower dated evidence rather than close from a partial list.
Exactly 1,000 consistently counted results can be verified across ten pages.
This external search cap is not a Coordinator history limit or a limit on
[job pagination](https://docs.github.com/en/rest/actions/workflow-jobs).

Old trial PRs must be closed unmerged and their exact owned branches absent;
old merged staging integrations must remain accounted for in current staging.
The checker rereads workflow history and environment refs at the end. Immediately
before closure the ticket writer runs the whole follow-up check independently.
Missing, changed or ambiguous evidence produces `reason:release-followup-required`
with the specific next action and links to any verified evidence. Backend/database
requests, other stop/failure types, recovery and production effects still require
maintainer reconciliation. No missing proof is treated as successful cleanup.

Complete proof closes the ticket as `closed` / `not_planned` with
`reason:release-reconciled`: later delivery settled its remaining ticket action.
The original stopped release projection and hash-chained history stay unchanged;
this is never a new `completed` outcome. Cleanup does not cancel releases, restore
environments, create/delete product resources, rehearse Git, dispatch workflows,
or archive existing history.

Both updated entrypoints use the current reviewed release engine and recognize
the maintenance reasons, `original-pr-v1` history and reviewed batch policies.
They preserve all existing markers and history. First cooperative acquisition
adds `ticket_updates: cooperative-v1` to the same journal. Older strict writers
reject this field before mutations; install the updated release and cleanup
code together before enabling the dashboard action. An existing legacy release
blocks activation until it finishes or is explicitly resumed after its old
process stops. A same-run legacy cleanup resume finishes in its original
exclusive lane rather than moving unsettled ownership.

The release owns `lock`; maintenance owns `cleanup_lock`. Only one run may own
each lane. A full-inbox release protects all tickets until its scanned selection
is saved, then protects those tickets during preparation. Before deployment it
fully presents decisions for unselected tickets and saves `reserved_tickets`
for only the selected group. Those unselected tickets are not presented again
after deployment, so a subsequent cleanup result cannot be overwritten.

Cleanup observes a ticket without reserving it, then refreshes the journal and
claims `current_ticket` only if its saved ticket/batch evidence is unchanged and
no release reserves it. The claim is saved before any Issue mutation and checked
before every mutation. If release selection wins that race, cleanup skips the
ticket. The claim is removed only after verified presentation. Partial or
uncertain updates retain it, preventing an overlapping release selection while
other reserved release tickets can continue.

Both lanes save by ordinary, non-forced Git fast-forwards. A confirmed rejected
fast-forward can retry only after validating ancestry, unchanged own ownership
and disjoint foreign progress. Unrelated saved progress is imported without
overwriting the other lane. Same-ticket, ownership or protocol changes stop
writes. A lost response must prove the exact own commit, or its verified
descendant with intact own effects; an unknown outcome never triggers another
mutation merely because the other lane advanced. This adds no retry/time budget
or automatic takeover. GitHub Issues and this journal remain the only state
source; separate lane reservations are not a database or heartbeat.

Ancestry verification walks no further than the verified journal revision gap:
each saved journal commit has one parent and increments the revision by one.
Rewritten, regressed or unconfirmed sibling heads stop without searching all
older history. This follows the existing journal invariant, not a new attempt
budget; exact successful saves beneath unrelated later progress still reconcile.

Interrupted writes retain the cleanup reservation and partial-application
evidence. After the previous process has stopped, `inbox:cleanup --resume RUN_ID`
rechecks the same saved selection and safely reconciles pending presentation.
It processes the saved claimed ticket first, before revisiting earlier open
tickets. A fully verified ticket stays applied if releasing its reservation
fails; resume verifies and clears that claim before moving on.
Failure before a first decision never invents a partial application record.
The original error and saved cleanup resume identity survive missing local
transitions and failed diagnostic timestamps/saves; existing saved ownership
remains intact for the same-run recovery.
The updated journal client rejects resuming cleanup through `inbox:run`, or
resuming a release through cleanup, before rotating the lock. Use the matching
updated command for the saved action. Existing read-only commands stay read-only.
CLI syntax and the dashboard button are documented in the
[Coordinator README](../apps/coordinator/README.md) and [release board guide](./release-board.md).

After a processing run, a submitter can scan their open tickets and answer:

- Where is my request?
- Why is it waiting, or what needs fixing?
- Who needs to act next, and what should they do?

Clear outdated requests and requests whose PRs are all already merged leave the
active inbox with a recorded reason. Other requests that need evidence stay
visible. Closing a ticket never silently claims that a release happened.

The scope is intake defaults, ticket inspection, local merge rehearsal, supported
sandbox service/database checks, profile-specific batch/release execution,
status updates, decision history, and migration of existing tickets. Public consumers remain on
CLI `0.0.5` and schema `0.000002`, including recording for operational
monitoring. Frontend and backend pin that exact public version. Existing
`0.000001` requests from older clients remain valid. The sandbox deploys the
sample monitoring package inside a complete sandbox ticket after the production
merge into test `main`. The real adapter pins and dispatches the existing product
monitoring workflow in the same production-stage order.

One ticket contains one submitted release request. That request can name
frontend PRs, backend PRs, or both. A filtered `inbox:run` accepts one or more
Issue numbers and one verified submitter login; those Issues are the complete
inbox visible to that run. Full-inbox scope exposes every available ticket.
Either profile and scope can select several separate, self-contained visible
tickets and test their exact PR changes together as one batch.
It never splits a ticket or merges the submitters' source PRs during selection.
Cross-ticket dependency declarations and database-changing multi-ticket batches
are still unsupported.

The per-ticket rehearsal only merges in temporary local repositories. A sandbox
run may merge its selected candidate into the protected branches of the
two fake repositories and run their test Actions. Product merges, builds,
deployments, and rollback remain later work. No sandbox ticket status or label
authorizes them. The [agreed release rules](./design.md#agreed-execution-direction-september-11)
reuse existing deployments, require successful staging E2E before production,
and keep one release active through recovery. The sandbox subset implements those
ordering and ownership rules without product access.

## Responsibility and commands

| Part                                                  | Responsibility after implementation                                                                                                                                                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public CLI                                            | Continue sending the existing exact request. It does not supply trusted identity, lifecycle status, or release authorization.                                                                                                                |
| Central submission workflow and Issue-creation helper | Verify the request, identify the GitHub submitter, and create a consistently organized ticket. Preserve an existing ticket on a retry.                                                                                                       |
| `inbox:read` and `readiness:check`                    | Remain read-only. Share the inspection logic with processing, but never apply Issue changes.                                                                                                                                                 |
| `inbox:run`                                           | Select either a guarded Issue/actor subset or the complete inbox, generate plans, rehearse exact PRs, and apply the saved ticket presentation. A sandbox run also selects a batch and runs its fake release sequence. Run manually and exit. |

The write command is `inbox:run`. It requires an explicit sandbox/real profile
and an explicit filtered/full inbox scope.
The command automatically creates a separate plan for each suitable ticket. Its
[command guide](../apps/coordinator/README.md#run-the-ticket-workflow)
describes GitHub writes, selection, and recovery. It is not a background service.
For a staging change detected at E2E acceptance or immediately before the first
production action, the run records both exact
branch pairs, gives the ticket reason `release-staging-changed`, and keeps
its lane lock. The operator must inspect the external deployment before an
explicit `--resume RUN_ID --staging-change retest|restore` choice. Only a
no-database-change frontend-only release with stable refs can use these
automatic paths. A retest starts a fresh frontend deploy/E2E; a restoration
undoes only the Coordinator's frontend staging change and verifies it. Neither
path automatically rolls back another developer's backend or any database
change.

For the specific real Issue #253 stop, both staging refs later moved beyond
the saved versions, so neither automatic choice was safe. The one-time
`ops/scripts/reconcile-issue-253.mjs` correction first verifies the exact
journal head, run lock, public intake, stale-acceptance log event, workflow
conclusions and current staging refs. Its read-only `--check` mode makes no
writes; `--apply` records a `needs-human` manual stop without calling either
product release adapter, presents `reason:release-stopped` on the same Issue,
and releases the original journal lock. It retains the successful E2E workflow
conclusion separately from the stopped Coordinator acceptance and leaves the
run's production steps absent. A changed journal head or uncertain outcome
requires inspection, not rerunning this one-time correction.

### Inbox selection guard

`RELEASE_COORDINATOR_PROFILE=sandbox|real` selects the trusted repositories.
`RELEASE_COORDINATOR_SCOPE=filtered|inbox` independently selects visibility.
`filtered` requires at least one `--issue NUMBER` and exactly one
`--actor LOGIN`; all named Issues must be open, verified requests whose intake
receipt records that login. `inbox` accepts neither filter and exposes the whole
profile inbox. An unknown or incomplete selection stops without fallback.

Selection is not release policy. Once the visible set is created, the existing
rules decide conflicts, batches, database isolation, target order and execution.
Tickets outside a filtered selection are absent: they cannot join a batch, cause
an overlap, or be written. A previously unfinished release outside the filter is
the safety exception: the run stops instead of adopting it or starting a second
release. The canonical mode, sorted Issue list and lower-case actor login are
saved in the run lock. Resume reuses that saved selection and
cannot broaden it; the operator supplies only the same scope mode and run ID.

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

| Label                  | Meaning                                                                                                                | GitHub Issue state |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `status:received`      | Accepted and awaiting first inspection.                                                                                | Open               |
| `status:waiting`       | Waiting for checks, evidence, or missing Coordinator capability. The next action owner is stated.                      | Open               |
| `status:action-needed` | A named person or team must make a specific correction or decision.                                                    | Open               |
| `status:eligible`      | Initial inspection found a candidate for further release checks. This is not release readiness or deployment approval. | Open               |
| `status:completed`     | Successful release of this exact request to its target is supported by verified evidence.                              | Closed             |
| `status:closed`        | Retired without claiming successful release. At least one closure reason is required.                                  | Closed             |

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

| Reason                           | Typical action                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reason:outdated-commit`         | Retire a verified request whose requested commit no longer matches its PR. Include requested and observed commits.                                                                                                                                                                                                |
| `reason:already-merged`          | Retire a verified request when all its exact PRs were already merged before Coordinator execution. A verified merged PR plus an open or unverified companion keeps the request action-needed for a scope decision. Unverified evidence alone does not trigger this reason. Deployment is not verified or claimed. |
| `reason:release-action-required` | Cleanup found current unmerged code with no initial blocker. A maintainer decides whether to run the explicit scoped release with fresh checks or record an authorized cancellation. No readiness or deployment is claimed. |
| `reason:release-followup-required` | A stopped attempt lacks specific delivery, staging, history or owned-resource evidence. The comment names what a maintainer must verify; cleanup performs no release or resource removal. |
| `reason:release-reconciled` | Separate matching delivery, current staging validation and owned-resource checks settled a supported stopped attempt. Close as not planned while preserving its original stopped outcome; no new Coordinator completion is claimed. |
| `reason:checks-pending`          | Wait for required checks; recheck on the next processing run.                                                                                                                                                                                                                                                     |
| `reason:checks-failed`           | Identify the failed required checks and the person who can fix them.                                                                                                                                                                                                                                              |
| `reason:merge-conflict`          | Identify the PR/base evidence and the correction needed.                                                                                                                                                                                                                                                          |
| `reason:review-required`         | State the review requirement or requested changes and who needs to respond.                                                                                                                                                                                                                                       |
| `reason:invalid-dependencies`    | Explain missing parts, unknown services, unsupported target, or ordering cycles. Ask for a corrected request.                                                                                                                                                                                                     |
| `reason:request-unverified`      | Keep the ticket visible when intake proof cannot be verified. Route contradictory records to maintainers; temporary API/log failures may wait.                                                                                                                                                                    |
| `reason:deployment-unverified`   | Obtain proof for the exact code, selected scope, and target. Merged PRs alone are insufficient.                                                                                                                                                                                                                   |
| `reason:prerequisite-unverified` | Obtain the required deployed state of an omitted prerequisite; do not add or deploy a service automatically.                                                                                                                                                                                                      |
| `reason:coordinator-incomplete`  | Name the missing Coordinator capability. The action belongs to Coordinator maintainers, not automatically to the submitter.                                                                                                                                                                                       |
| `reason:overlapping-requests`    | Explain which requests overlap and what decision is needed. Do not select the newest by timestamp.                                                                                                                                                                                                                |
| `reason:merge-plan-required`     | Historical manual-plan reason, retained only to read old decisions; no longer emitted.                                                                                                                                                                                                                            |
| `reason:merge-plan-invalid`      | Resolve a request/order that the Coordinator cannot turn into a valid rehearsal plan.                                                                                                                                                                                                                             |
| `reason:merge-plan-unavailable`  | Restore the configured destination or missing GitHub evidence so the Coordinator can prepare its plan.                                                                                                                                                                                                            |
| `reason:rehearsal-blocked`       | Resolve the recorded combined conflict or other stable rehearsal blocker.                                                                                                                                                                                                                                         |
| `reason:rehearsal-unverified`    | Restore missing evidence or report storage, then rerun.                                                                                                                                                                                                                                                           |
| `reason:rehearsal-stale`         | Inspect changed inputs, refresh the plan where appropriate, then rerun.                                                                                                                                                                                                                                           |
| `reason:batch-target-deferred`   | Keep the complete ticket queued for a later run because the current batch uses the other release target.                                                                                                                                                                                                          |
| `reason:release-completed`       | The exact release plan reached its requested target and every matching check passed. Close the ticket as completed.                                                                                                                                                                                               |
| `reason:release-failed`          | A confirmed release step failed after execution began. Stop later steps and hand the saved partial state to a person.                                                                                                                                                                                             |
| `reason:release-cancelled`       | An explicit keep-current cancellation verified the owned PR closed unmerged and its branch removed. Close selected tickets as not planned; current code remains, with no release-completion or rollback claim. |
| `reason:release-unverified`      | The selected release is unfinished or its effect is uncertain. Keep the ticket waiting and reconcile the saved operation before retrying.                                                                                                                                                                         |
| `reason:cancelled`               | Close after an authorized cancellation is recorded.                                                                                                                                                                                                                                                               |
| `reason:replaced`                | Close with an explicit replacement request link and recorded replacement decision.                                                                                                                                                                                                                                |
| `reason:test`                    | Close a confirmed test after its purpose is complete. Editable title text alone does not establish this.                                                                                                                                                                                                          |

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

| Label               | Meaning                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `rehearsal:not-run` | Initial evidence or an invalid generated plan prevented rehearsal.                   |
| `rehearsal:passed`  | Exact planned merges and observed gates passed; cleanup and report saving succeeded. |
| `rehearsal:blocked` | Stable evidence demonstrates a conflict or another blocker.                          |
| `rehearsal:unknown` | Evidence, cleanup, or report saving could not be verified.                           |
| `rehearsal:stale`   | Inputs changed during the rehearsal.                                                 |

The single maintained comment shows findings, exact destinations, resulting
trees, and the plan fingerprint. A blocked rehearsal is action-needed; unknown
or stale evidence waits. Passing rehearsal alone still waits for release
evidence. Either profile may continue to its separately recorded release
sequence; only complete matching release evidence can produce completed status.
The rehearsal result itself does not claim a tested build or deployment.

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
`inbox-run-v7` (service attempts were introduced in v3); older writers must stop. The journal's `service_attempts` map saves
exact plans and attempts before dispatch; finished results remain available for
retries through the history index.

Managed labels are `services:not-run`, `services:passed`, `services:blocked`,
`services:unknown`, and `services:stale`. Reasons are `database-unverified`,
`database-declaration-mismatch`, `service-checks-failed`,
`service-checks-unverified`, and `service-checks-stale`. These describe sandbox
checks separately from Git rehearsal and any release outcome.

| Evidence                                                                             | Presentation and next action                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox service/database/integration checks pass                                     | Record this stage separately from `rehearsal:passed`; it is not real deployment evidence by itself. The same run may continue only if the ticket is selected into a saved profile release plan.                 |
| Database answer or inspection is unknown                                             | Wait with the missing fact and its owner. The current unresolved classification goes to Coordinator maintainers for reconciliation, including obtaining requester clarification. No dependent execution starts. |
| Declared `no` contradicts a verified database change                                 | Action-needed for a corrected request. Show the declaration, changed files, observed database change, and submitter action without altering the receipt.                                                        |
| A database or service check has an attributable program failure                      | Action-needed with the exact step, versions, expected/actual result, and correction owner. Preserve any partial database effect and which dependents did not start.                                             |
| Runner failure, timeout, unknown prior effect, or missing version/prerequisite proof | Wait with evidence and a bounded retry or reconciliation action owned by the responsible maintainer. Do not blame the submitter's code without support.                                                         |

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

**Implemented for sandbox runs; see [progress](./progress.md) for evidence.**
The [batch-selection policy](./design.md#proposed-batch-testing-and-selection)
finishes cheap intake, scope, database and Git filtering before new combined
PR/service checks. Inbox scope only controls which tickets are visible; filtered
and full-inbox scope use the same batching rules. Batching supports
self-contained staging or production requests with verified no-database-change
scope. One verified database-changing ticket can use the same sandbox release
sequence alone. Older suitable tickets take priority; other tickets wait while
that ticket is selected. A batch contains only one target.
Cross-ticket dependency declarations remain future work; inseparable changes
must be submitted as one complete ticket.

`inbox-run-v7` preserves the batch history introduced in v4 and archives completed
details without rewriting prior decisions or attempt identities. New managed labels are `batch:passed`, `batch:blocked`, `batch:waiting`,
`batch:unknown` and `batch:stale`. Reasons are `batch-selected`,
`batch-ticket-failed`, `batch-incompatible`, `batch-limit`, `batch-deferred` and
`batch-unsupported`. `batch-target-deferred` keeps a complete ticket queued when
the current run is forming a batch for the other target. The existing
database-declaration-mismatch reason is reused.
A selected passing group continues through the sandbox release sequence. It stays
waiting while that sequence is incomplete, becomes action-needed if a confirmed
release step fails, and becomes `status:completed` only after every step required
by its target passes and owned branches are removed. Excluded tickets retain the
same comment, reasons, action owner, exact group/attempt and check links. Unknown
results never blame a submitter.
For a confirmed no-database-change failure after test branches changed,
automatic restoration uses checked undo PRs and reruns normal checks. A later
fake-production failure restores affected test `main` branches before affected
staging branches. Passing restoration does not complete the request: the ticket
remains open with `reason:release-failed`, the original failed step, recovery
steps, and Coordinator-maintainer ownership. A failed or uncertain undo leaves
the ticket and environment for a person to inspect.
A complete sandbox ticket whose backend part selects `operational_deployments:
["monitoring"]` adds `staging:monitoring:staging` after the staging backend
merge and, for a production request, `prod:monitoring:prod` after the main
backend merge. Each runs before that environment's application deployments.
A confirmed failure stops later forward steps; no-database-change restoration
redeploys monitoring from the matching restored environment branch. A
monitoring-only sandbox
request has no sample services to check, so it waits with
`reason:coordinator-incomplete` and the action to submit the change inside a
complete sandbox ticket. The real adapter can select the existing monitoring
workflow, but that path has offline tests only and no live product acceptance.
For a database-changing ticket, a failed release step leaves the ticket open
with `reason:release-failed` and Coordinator-maintainer ownership. Automatic
restoration is not attempted; a person inspects the recorded step and affected
test environments before another release.
Reusing a saved group requires fresh input checks and a fresh read of its actual
GitHub CI/service evidence. Missing or changed proof stops reuse; a cached journal
result alone is insufficient. This verification starts no new CI. Its scope is the frozen eligible pool after
cheap scope and ticket/PR-limit filtering. A ticket held outside that pool cannot
invalidate its test result by changing unrelated PR evidence. Tickets inside the
pool still require fresh exact evidence throughout selection and splitting.

The general future outcomes below also cover capabilities beyond this first
stage, including cross-ticket dependency groups and reassessment after a real
release. Those capabilities are not implied by the new sandbox labels.

Behind-main source PRs may enter fresh candidate testing after an independent
checks/rules/reviews/thread audit; failed or unfinished required checks, a changed
requested head, unresolved reviews, conflicts and unknown policy remain stops.
The developer branch and immutable request stay unchanged. New candidates retain
the original PR commits, so main integration indirectly marks those PRs merged.
That expected source transition does not close an active release ticket: resume
must finish its saved deploy/E2E proof. An unselected open main PR inherited by a
candidate is refused rather than silently consumed by the issue filter.

If main moves during preparation only, the Coordinator can clean its old trials,
verify the same receipt/actor/source inputs and rebuild/retest on new main in the
same run. Old proof and its counts remain saved; no checks or budgets are reset.
Once release execution exists, automatic re-preparation is forbidden. Ordinary
stale-release reconciliation still applies.

Leaving a ticket out of a candidate keeps its PRs and Issue open. Keep the entire
ticket and any inseparable dependency group together. Selection or a passing
batch test never means completed; only the matching saved release sequence can
support that sandbox completion.

| Evidence for exclusion                                                                                           | Proposed ticket state and next action                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A specific required check, code failure, internal/base conflict, or invalid scope is attributable to this ticket | `status:action-needed`; name the exact blocker, evidence, and person/team who can correct it. Fixed code or scope requires a new request.                                                                        |
| A and B pass separately but fail together                                                                        | Leave the excluded independent ticket `status:waiting`; link the chosen candidate, the incompatible request(s), exact versions, and failing attempt. Do not claim either ticket is individually broken.          |
| A request needs another excluded request                                                                         | `status:waiting`; name the dependency and keep the required group together.                                                                                                                                      |
| Testing stopped at its time/attempt limit without a conclusive result                                            | `status:waiting`; say that investigation is incomplete and the Coordinator owns the next attempt.                                                                                                                |
| A runner, GitHub read, baseline test, or result verification failed                                              | Usually `status:waiting`; state the infrastructure/evidence problem and bounded retry. If a known correction needs a person, route action-needed to the responsible maintainer, not automatically the submitter. |
| An inseparable group is incompatible and cannot be divided                                                       | `status:action-needed` for a named correction or scope decision; explain the group evidence and any uncertainty about attribution. Never guess one culprit.                                                      |

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

| Field            | Content                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| Status           | The current state in plain language.                                                 |
| Why              | Each unresolved reason, tied to the affected PR, part, or service.                   |
| Next action      | A concrete action; say when the next processing run can recheck automatically.       |
| Action owner     | Coordinator, Coordinator maintainers, submitter, or a named reviewer/operator.       |
| Submitter action | Exactly what the submitter needs to do, or explicitly none.                          |
| Evidence         | Relevant request, PR, checks, workflow/deployment links, exact commits, and target.  |
| Last decision    | Time and the person or trusted process responsible for the latest meaningful change. |

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
   An unchanged, same-repository, open, non-draft source may wait for GitHub's
   pending merge calculation. Polling has no added deadline/count limit and
   honors cancellation. Changes to code, base, PR identity/state, checks or
   reviews while waiting stop the scan. Two completed full observations must
   still match; pending answers and newly available admission proofs do not
   bypass that comparison. Read failures are not automatically retried, and a
   completed calculation does not override conflicts, failed checks or reviews.
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
not invent earlier outcomes. `status:completed` requires a supported source for
the exact outcome. The sandbox executor supplies that source only for work it
owns; it cannot complete earlier or real releases.

The already-merged rule applies before Coordinator release execution, including
to tickets previously marked received/waiting/action-needed. These are intake
states, not execution ownership. The sandbox executor records its batch and
release before merging, then retains responsibility after its own merge. This
intake rule must not abandon that work. Real execution ownership is unsupported;
unknown ownership fields in the journal stop the processor before ticket writes.

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

**Merged history storage and locally implemented v6 release storage were verified
in the sandbox September 11.** The writer keeps complete unfinished work in
`inbox-state.json` and moves finished batch and
standalone service details to the same independent `codex/inbox-state` branch.
The former 100-batch and 1,000-service lifetime caps are removed. Per-search
limits still apply: 10 tickets, 10 PRs per repository, 40 Git attempts, 12 check
rounds, and no elapsed-time cutoff. Closing a ticket does not erase its evidence.

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
  result details are in the archive. A selected release also keeps its exact plan,
  starting versions, operations, results, and terminal state there. The managed
  ticket still explains outcomes.
- Exact repeats load only the required record, check its profile, identity,
  checksum and structure, then use the normal remote evidence revalidation.
  Old attempt IDs and budgets remain intact. Historical v1/v2 deadlines remain
  in their archived evidence, but they are no longer enforced; new v3 records
  have no deadline. Missing or altered archives stop reuse; they never mean
  “start a fresh attempt.”

Archiving is part of releasing a successfully presented manual run, not a new
command or a background worker. All referenced tickets must have their latest
updates saved and no presentation error. Their history must contain the relevant
batch/service outcome. Every operation must have a terminal result and verified
cleanup, including temporary PRs and service resources. `batch.status: finished`
only says the selection search ended; a selected batch remains active until its
sandbox release is completed or marked `needs-human` and every ticket update is
saved. Unfinished release records and standalone service attempts referenced by
an active batch also stay active.

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

`workflow: "inbox-run-v7"` fences older writers before they can drop release or
archive files or widen a saved Issue filter. The first authorized v7 run upgrades
a legacy/v1/v2/v3/v4/v5/v6 journal under its
lock, preserving receipts, transitions, plans, original results and resume scope.
Cleanup and presentation obligations must still finish before details move out
of the active file. Profile separation and stop-before-resume are unchanged.
The API adapter permits only the fixed state file, checksum-named archive paths,
and the existing journal branch operations.

This is a small Git-backed index, not unlimited storage. Compact references and
ticket decision history still grow in the main file. Keep them for this manual
stage; measure usage before adding index pagination or retention. There is no
separate database, dashboard or automatic archive deletion.

See [history acceptance](./merge-rehearsal-testing.md#history-storage-acceptance),
[live sandbox evidence](./testing/history-2026-09-11.md) and
[implementation evidence](./progress.md#controller-and-history-cleanup-september-11).
This sandbox acceptance did not migrate the real inbox journal.

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

Acquire the release or cleanup lane before inspection/Issue changes, and protect
the specific ticket before its mutation as described above. Save
intended decisions and the status-comment identity before applying updates. Save
and verify the applied result afterward. A failed or uncertain API call keeps
the lock. Resume is an explicit operator action after stopping the old process
and allowing in-flight calls to settle, never an automatic lease expiry. It
preserves the original selection/action and rotates the ownership token. The
old process checks the current token before every Issue mutation and journal
advance. GitHub Issue calls are not transactional; do not run a resumed copy
while the original process may still be alive. The command guide owns the
recovery procedure and timeout guidance.

The guard reads `codex/inbox-state`'s current commit SHA and compares it with
the last fully validated snapshot and its saved lock token. Git commits are
immutable, so an unchanged SHA names that same state without another file
download. A changed ref allows only verified disjoint cooperative progress;
an unreadable ref or different own token stops the writer. Initial
acquire, resume and every save still read and validate the complete state,
history and ancestry; save still verifies the exact persisted result.

If an exact integration PR has green required checks but GitHub still marks
its merge gate `BLOCKED`, the release records `awaiting-review` and the ticket
gets `reason:release-review-pending` with the PR link. The owned PR and branch
stay open, no later release step runs, and the same journal lock remains held.
This is a safe wait, not proof that review is the only rule blocking GitHub.
After a person handles the PR, ordinary `--resume RUN_ID` rechecks its exact
head, base, checks, rules, and branch before a merge; a still-blocked PR stays
paused. `--resume RUN_ID --review-stop` explicitly closes the verified owned
PR and follows the normal release recovery path. A moved target branch blocks
ordinary resume; ordinary stop may also refuse unsafe staging drift or restoration. An
uncertain identity or moved Coordinator-owned PR branch keeps the lock for manual
investigation. Neither command ignores a
review thread, auto-resumes, or imposes a pause timeout. Other releases in the
same profile wait; the separate sandbox and real journals do not block each
other. Once a stop choice is saved, an interrupted stop uses ordinary
`--resume RUN_ID` to continue that saved cleanup; it cannot turn back into a
merge merely because the GitHub review changes meanwhile.

`--resume RUN_ID --cancel-keep-current` is a separate explicit choice: abandon
this attempt without undoing any code. It supports a confirmed no-database-change
release paused at its exact owned, unmerged integration PR, including an
interrupted `--review-stop` whose intent is already saved. It also supports an
interrupted first staging checkpoint: saved `running`, step index zero, exactly
one integration operation, PR state `checking`, null result and no cleanup
choice. This checkpoint can remain after a thrown pre-merge check; it does not
prove the original process is alive. Independently confirm the process and its
requests have stopped and settled for at least 60 seconds before cancellation.
This first-PR case refuses any other release operation, uncertain merge state,
staging reconciliation, manual stop, database uncertainty or recovery. The
existing review-pause path still refuses other production operations. This is
not a general override for arbitrary failures or deployments in progress.

For product-shaped adapters, keep-current cancellation also supports an
interrupted first frontend staging deployment: step one, exactly the completed
frontend staging merge and its saved `running`/null-result deployment, a known
workflow run, and no database change, E2E, backend/monitoring work, production
operation or recovery. The operator must first independently confirm the old
process and its requests stopped and settled for at least 60 seconds. The adapter
reads only GitHub: it verifies the exact merged PR, both immutable commits and
removed owned branch, the pinned workflow files at the deployed source, the
recorded run's source/actor/workflow/attempt and passing required deployment jobs.
Pinned product workflows must be quiet; active, missing, failed or uncertain
evidence retains the lane. It neither cancels a workflow nor adopts the old
deployment as a release pass. Original operations/results remain unchanged;
separate cancellation evidence records the historical verification. Current
shared refs are observed, not rewritten or restored, even if they moved.
Selected tickets close as not planned and normal archival/lane release follows.
Fresh code and current environment validation require a fresh request.

The journal saves the operator, decision, step and observed staging/main refs
before cleanup or finished-deployment inspection. For unmerged PRs, the same
adapter in both profiles verifies the unique PR, saved
head, author, body, destination and exact owned branch, closes it unmerged, and
verifies branch removal. It never recreates a missing branch, merges code,
dispatches a workflow, restores snapshots or changes either shared branch.
Other developers may continue moving those branches; before/after observations
are not deployment or health proof. Uncertain ownership, an already merged PR,
or unverified cleanup retains the lock for inspection.

An interrupted cancellation stays `cancelling`. Ordinary resume can only finish
that saved cancellation. Confirmed cleanup records `cancelled`, closes every
selected ticket as `not_planned` with `reason:release-cancelled`, and releases the
original lane through normal journal closeout. Earlier staging work is preserved;
no rollback or completed production release is claimed. Changed code needs a
fresh request and new matching release evidence. This choice cannot be combined
with `--review-stop` or `--staging-change`.
Verified cancelled batches can be archived by the normal journal closeout,
with the explicit `cancelled` disposition and their complete operation history.
Unverified cleanup or ticket presentation prevents archival. See progress for
the distinction between live cancellation and this archive path's offline proof.
The integration operation reuses the existing `review-stop` cleanup reason and
result contract. The parent execution's explicit `cancellation.mode: keep-current`
and `status: cancelled` distinguish cancellation from ordinary stop/recovery.
Likewise, `batch_status: passed` describes the earlier selected-combination checks,
not a successful release: ticket status is `closed`, execution status is
`cancelled`, history summary is `cancelled`, and `release_executed` is false.
Exact before/after refs are required audit observations, not deployment proof.
If their readback fails after PR cleanup, the saved cancellation retains its lock
and ordinary resume re-verifies that same cleanup; it never promotes code.
Branch deletion uses an explicit saved-SHA Git lease, not REST's unconditional
reference deletion. A push to that temporary branch between readback and delete
therefore refuses deletion and retains ownership. The adapter uses an isolated
empty bare repository and the same GitHub CLI credential identity over HTTPS;
it does not use an operator checkout, hooks, SSH identity or global Git config.
If Git access fails, there is no REST fallback. This transport hardening has
real-Git offline race proof, not live GitHub cancellation acceptance yet.
The contract follows [Git's explicit lease](https://git-scm.com/docs/git-push)
because [GitHub ref deletion](https://docs.github.com/en/rest/git/refs#delete-a-reference)
does not accept an expected SHA.

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
`workflow: "inbox-run-v7"` without changing prior decisions or service identities;
legacy/v1/v2/v3/v4/v5/v6 journals upgrade on an authorized write. Older
checkouts reject this field before writes, even if a pass adds no new reason.
Once that marker is recorded, use a checkout supporting the combined workflow. Older processors reject unknown reasons and stop safely;
update the checkout rather than rewriting history. No public CLI upgrade is needed.

`status:eligible` remains reserved. The v7 sandbox executor may write
`status:completed` only from its own matching saved release. Unknown earlier real
release outcomes or unsupported execution ownership still produce
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
