# Inbox processing contract

**Implemented locally September 9, 2026; see [progress](./progress.md) for test
and rollout evidence.** Submit a request, then run one explicit command to
organize its ticket. Release execution remains separate.

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

The scope is intake defaults, ticket inspection, status updates, decision
history, and migration of existing tickets. Keep the installed CLI `0.0.4`
input and request schema `0.000001` unchanged. No new npm release or frontend/
backend installation is needed for this scope.

Do not implement the merge rehearsal, release worker, scheduling, merges,
builds, deployments, or recovery as part of this stage. No ticket status or
label authorizes release execution. The execution design's unresolved branch,
release ownership, and production-build choices remain unresolved.

## Responsibility and commands

| Part | Responsibility after implementation |
| --- | --- |
| Public CLI | Continue sending the existing exact request. It does not supply trusted identity, lifecycle status, or release authorization. |
| Central submission workflow and Issue-creation helper | Verify the request, identify the GitHub submitter, and create a consistently organized ticket. Preserve an existing ticket on a retry. |
| `inbox:read` and `readiness:check` | Remain read-only. Share the inspection logic with processing, but never apply Issue changes. |
| Explicit inbox-processing command | Inspect tickets, record decisions, and apply the corresponding labels, status comment, ownership, and Issue state. Run manually and exit. |

The write command is `inbox:process`. One invocation inspects and processes the
inbox. Its [command guide](../apps/coordinator/README.md#organize-tickets-explicitly)
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

### Storage and trusted writers

The first implementation uses the fixed GitHub branch **`codex/inbox-state`**,
with `inbox-state.json` as its only file and an independent commit history. It
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

The `already-merged` registry addition requires policy `2026-09-09.2` or newer.
Merge the change and update supported processor checkouts before writing that
reason to live history. Older processors reject unknown reasons and stop safely;
update the checkout rather than rewriting history. No public CLI upgrade is needed.

`status:eligible` and `status:completed` are also reserved in this first version.
Unknown earlier release outcomes/active execution ownership currently produce
`reason:coordinator-incomplete`. This inbox journal proves its own dispositions;
it is not independent evidence of a prior deployment, cancellation, or worker
reservation. Unchanged scans create no new transitions/comments; acquire/release
commits record runs. The single-file journal is intended for this small manual
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

After this stage, return to the local merge rehearsal. Release execution and
independent deployment/prerequisite evidence still need their own work.
