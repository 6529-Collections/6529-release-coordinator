# Local Coordinator commands

This private workspace runs manually on your machine and exits. `inbox:run`
checks requests, rehearses a suitable ticket's exact PRs, and updates that same
ticket with reasons and evidence. Select `sandbox` or `real` explicitly.
Start with [Run the ticket workflow](#run-the-ticket-workflow) below.
No server, timer, or deployment worker is started.

`inbox:read` and `readiness:check` remain read-only diagnostics. The
[ticket rules](../../docs/inbox-processing.md) define labels, ownership, reasons,
and history. See [progress](../../docs/progress.md) for local versus merged evidence.

## Run

Use Node.js 20+ and a current GitHub CLI (`gh`) authenticated to `github.com`.
The account needs read access to the repository's Issues and Actions logs.
The reader uses your existing `gh` authentication; do not put tokens in source.
It does not prompt for credentials or change authentication.

From the repository root, install dependencies if needed:

```sh
npm ci --ignore-scripts
```

Then run one scan:

```sh
npm run inbox:read
```

For machine-readable JSON, suppress npm's script banner:

```sh
npm run --silent inbox:read -- --json
```

Help is available with `npm run inbox:read -- --help` and makes no GitHub calls.

## What gets checked

1. Read every page of **open** Issues with `release-request`, including waiting and action-needed tickets.
   Exclude pull requests, closed Issues, and Issues missing that label.
2. Read the single saved JSON block. Reuse the request package's schema and
   checksum implementation. Check the ID and displayed metadata agree with it.
3. Read the linked GitHub workflow run from the fixed Coordinator repository.
   Require `submit-release-request.yml`, `workflow_dispatch`, a `main` run from
   this repository, the matching request title, and a successful completed run.
4. Identify the successful save job and step in that exact run attempt, reading
   all job pages. Read its logs through the GitHub API. Require one actual
   `RELEASE_REQUEST_RESULT` output line, excluding echoed commands.
5. Match the workflow result's Issue number/link, request ID, full request
   checksum, run ID/link, and actor name/ID. Compare the actor with GitHub's run
   metadata. The request's `requested_by` remains supplied text, not proof of
   identity. Repeated request IDs across open Issues are reported as invalid.

The report includes the saved PR numbers, branches and full commits, release
target, database-change answer, part dependencies, backend units and their
order, and the verified GitHub actor when proof succeeds.
For JSON compatibility, `counts.pending` now counts all selected open requests;
it does not require the legacy `pending` label.

## Results

| Status | Meaning |
| --- | --- |
| `valid` | The saved request matches its schema, checksum, and expected workflow evidence. |
| `invalid` | The saved record is malformed, contradictory, duplicated, or differs from the workflow evidence. |
| `unverified` | Evidence cannot be obtained or uniquely confirmed, or the latest workflow attempt has not succeeded. |

| Exit code | Meaning |
| --- | --- |
| `0` | Every selected record is valid, or a successful scan found no open request Issues. |
| `1` | At least one record is invalid or unverified. |
| `2` | The Issue listing failed or command options were invalid. No complete inbox report is claimed. |

An authentication, network, rate-limit, unexpected-response, or later-page
failure never becomes an empty inbox. A workflow read failure is reported on
that request, allowing the rest of the inbox to be inspected. GitHub calls have
a 30-second timeout and a 16 MiB response limit. Unreadable or oversized logs
leave the request unverified. Raw logs and CLI stderr are not printed.

## Limits and trust

**`inbox:read` checks the saved record, not whether it should be released now.** It does
not check current PR heads, checks, approvals, deployment-unit existence, or
whether the dependency graph makes sense. It never chooses between two requests
for different commits of the same PR. It does not authorize a release.

The trust source is GitHub's run metadata and result from this repository's
inbox workflow on `main`. This is not an independent audit of that workflow or
its dependencies. Editable labels, Issue titles, actor table rows, and a
self-consistent checksum alone are insufficient proof.

The reader captures the run's latest attempt and reads jobs/logs for that
attempt only. If a rerun is in progress or fails, the request is unverified even
if an earlier attempt succeeded. Deleted or expired logs also leave it
unverified; it never falls back to trusting only the Issue body. GitHub's
paginated API is not an atomic snapshot, so a report describes the records
observed during that scan. Repeated Issues across pages cause an explicit error.

Closed test Issues are excluded by selection. An old test still labelled
pending can appear as a valid saved record: that does not make it a real release.
The reader cannot decide whether a saved request is still wanted. Dated live
results and known test records are tracked in [progress](../../docs/progress.md).

## Readiness checks

Run a separate, read-only inspection of current evidence:

```sh
npm run readiness:check
npm run --silent readiness:check -- --json
```

The account also needs read access to frontend and backend PR/check metadata
and the backend catalog. `--help` makes no GitHub calls.

The command first runs the complete inbox proof check above. Invalid or
unverified records do not trigger product repository reads. For verified records,
it checks:

1. **Exact PR code and current state.** Compare branch and full commit, verify
   repository identity, and report drafts, closed PRs, and already merged PRs.
   A changed head means outdated; a merged PR does not prove a deployment.
2. **GitHub merge, check, and review evidence.** Read each PR's mergeability,
   merge gate, review decision, and every page of head-commit check contexts.
   GitHub identifies required contexts with `isRequired`; optional checks are
   counted separately. Required successful, neutral, or skipped check runs
   satisfy that individual check. Missing, pending, failing, or unfamiliar
   evidence never becomes passing merely because the visible list is empty.
   Passing the required-check group also requires GitHub's `CLEAN` or
   `UNSTABLE` merge gate; `UNSTABLE` can include non-required failures. This
   uses [GitHub's own state definitions](https://docs.github.com/en/graphql/reference/pulls#mergestatestatus),
   rather than independently implementing all branch rules or bypass policies.
3. **Part and service dependencies.** Require unique part IDs and PRs, existing
   dependency endpoints, and no cycles. Read `src/config/deploy-services.json`
   at each exact requested backend commit, recording its blob SHA. Check names,
   environment (`production` maps to `prod`), catalog prerequisites, and extra
   ordering edges. Combine service and part edges, including dependencies across
   backend parts. Conflicting orders or ambiguous unit ownership block the request.
   Different catalog service definitions across requested commits require the
   catalog from an exact combined merge result; none is silently chosen.
4. **Stable observations.** Read each PR again after the initial PR/catalog
   reads. Changes to its head, base, state, checks, or reviews make the observation
   unknown. API errors and incomplete pagination also leave evidence unknown.
5. **Overlaps and missing history.** Identify other open requests for the
   same PR and target, without choosing one. Report completed, cancelled, and
   replaced as unknown because this reader has no verified release-outcome source. Issue closure, labels, PR merge state, and newer requests cannot
   substitute for that history.

An omitted catalog prerequisite stays **unknown** until there is proof that its
required state already runs in the requested environment. The checker does not
add it to the request or deploy it. A displayed dependency order describes the
selected services only; it does not prove every affected service was selected,
validate deployment adapters, or establish runtime health.

**Merge proof is limited to each PR's own base branch.** A PR targeting `main`
does not prove it merges into `1a-staging`. Individual PR results do not prove
several PRs merge together. This command does not perform a temporary merge
simulation or choose an execution destination. `release_merge_plan` remains
unknown until the execution plan and exact combined merge proof exist.

Each check reports `pass`, `blocked` (a demonstrated obstacle), or `unknown`
(missing/ambiguous evidence). A request reports `blocked` if any check blocks it;
otherwise it reports `unknown`. There is deliberately no overall `ready` result
while release history and execution merge proof are absent. Both report and
request objects always have `release_authorized: false`.

Exit codes: **0** means a successful scan found no open requests, **1** means
requests have blocked or unknown readiness, and **2** means usage or inbox
listing failure. Exit 1 is an expected inspection result, not a checker crash.
An empty inbox is not release authorization either.

These are observations, not an atomic snapshot, reservation, or GitHub lock.
Facts can change immediately after the last read. Future execution must recheck
its exact plan and authorization. The unresolved execution design remains in
[design](../../docs/design.md); this checker does not settle it.

## Profiled inbox and submission

The [profiled inbox guide](../../docs/profiled-inbox-testing.md) owns the shared
configuration, request formats, submission command, separate journals/reports,
and one-ticket rehearsal plan. `request:submit` and `inbox:run` require
`RELEASE_COORDINATOR_PROFILE=sandbox` or `real`. Read-only inbox/readiness
commands retain their real default and honor an explicit profile.
The installed npm CLI keeps its existing real-only behavior.

## Merge engine and fixture tests

The ticket workflow below uses Node.js 20+, Git 2.38+, and authenticated `gh`
with read access to the selected PR repositories. The two public sample
repositories have their names, IDs, visibility, and required checks pinned in
trusted configuration. A profile does not grant GitHub permissions.

Offline engine and workflow tests run in `npm test`. For developers rerunning
the live sample matrix from an existing verified seed, the fixture harness is:

```sh
node apps/coordinator/scripts/run-rehearsal-cases.mjs --seed SEED_JSON
```

This harness reads the pinned sandbox PRs and writes local reports only. It
constructs test manifests for the matrix, bypassing ticket intake deliberately
to exercise individual engine failure cases. It never updates Issues. Operators
use `inbox:run` with a verified ticket; the command generates its plan internally
and accepts no plan input. The old standalone processing and rehearsal bins/npm
commands are removed.

The private JSON manifest has these fields (not the public release-request schema):

| Field | Meaning |
| --- | --- |
| `schema_version`, `source`, `profile` | Exact values `"1"`, `"test-manifest"`, `"sandbox"`. |
| `case_id`, `target` | A short case identifier and `staging` or `production` for dependency observations. |
| `repositories` | One or two unique frontend/backend roles, in explicit dependency order. |
| Repository `role`, `depends_on` | `frontend` or `backend`; dependencies must name earlier roles. Names, IDs, and expected visibility come from the trusted profile. |
| Repository `destination` | Explicit `branch` and full 40-character `commit`; no inferred staging branch. |
| Repository `pull_requests` | Ordered list of `{number, branch, commit}` records with exact commits. At most ten per repository. |
| Backend `deploy_units`, `deploy_dependencies` | Selected service names and additional `{before, after}` edges. Both fields are required for backend. |

Unknown fields, duplicates, unsafe refs, invalid dependency order, and manifests
over 64 KiB are rejected. No repository URL, credential, arbitrary API request,
or executable command can come from the manifest. The test matrix and fixture
setup are described in the [testing plan](../../docs/merge-rehearsal-testing.md).

The engine rechecks GitHub after trying the exact commits in the declared order.
It uses Git's `ort` merge-tree operation and temporary two-parent commits in
fresh bare repositories. Nothing is checked out or executed from PR content.
Reports include intermediate/final trees, separate CI/review facts, conflicts,
the combined backend catalog, observation changes, cleanup, and
`release_authorized: false`. CI on individual PRs does not prove the combined
tree was tested. Gates for one base branch do not prove another destination.

| Exit | Result |
| --- | --- |
| `0` | All requested rehearsal observations passed for this exact snapshot. |
| `1` | Stable evidence demonstrates a blocker. |
| `2` | Unknown evidence, invalid input, or an operational/report/cleanup failure. |
| `3` | PR, destination, checks, reviews, or state changed during the run. |

The shared runner saves JSON and readable text under
`.release-coordinator/merge-rehearsal/<profile>/<run-id>/` in this checkout.
Each run gets a new directory; old evidence is never overwritten. Reports name
the Coordinator commit and dirty state, including untracked runtime files. Temporary Git storage is removed
before final report writing. A failed cleanup reports its exact owned path;
inspect that path before manually removing it. Abruptly killing the process
may leave an owned `6529-rehearsal-*` directory; there is no automatic sweep.

Current limits: 30 seconds per subprocess, three minutes per rehearsal, 16 MiB
per process output/report, and a monitored 128 MiB temporary-storage budget.
Git configuration is isolated; hooks, custom drivers, filters, submodules, and
repository scripts are not run. Active `.gitattributes` rules and gitlinks are
conservatively unsupported and leave an explicit unknown result. These limits
are part of later product-repository integration, not proof it already works.

Local fixture tests run offline in `npm test`. The live test setup script is a
separate explicit mutation tool for empty, pinned sandbox repositories; it is
never invoked by this command or the test suite. See [progress](../../docs/progress.md)
for actual repository setup, protection availability, and live acceptance evidence.

## Read-only boundary and tests

The inbox GitHub adapter allows only a fixed set of Issue/run/job/log endpoints in
this repository, always with explicit HTTP `GET`, without a shell or request
body. The reader has no GitHub write action, merge/deploy operation, workflow
dispatch, scheduler, or local request-record write. It does not call the CLI's
create/submit/save functions. The workspace is private and adds no dependencies
or files to the published release-request package.

The separate readiness adapter permits only the two fixed product repositories,
positive PR numbers, a fixed GraphQL **read query**, and the fixed backend
catalog path with a full commit SHA. GraphQL queries use HTTP `POST` as required
by GitHub; this is not a GraphQL mutation. Catalog reads use `GET`. There is no
caller-supplied query, method, host, shell, or code execution from a PR. Both
adapters use the same timeout/response-size limits and suppress raw CLI errors.

Run all package and reader tests from the repository root with `npm test`.
The existing PR check runs both suites. Reader tests cover altered and copied
records, actor/run mismatches, unavailable and ambiguous evidence, pagination,
closed tests, duplicate requests, output safety, read failures, and the GET-only
adapter. Unit tests use fake GitHub responses and do not contact GitHub.
Readiness tests additionally cover current-head changes, merge/check/review
blocks, catalog and graph errors, missing history, conflicting requests,
pagination races, adapter input boundaries, and the verified-intake-to-readiness
CLI path. Live evidence is dated separately in the progress record.

## Run the ticket workflow

`inbox:run` **writes to the selected GitHub inbox**. It requires an authenticated
inbox writer with Issue and contents write access, plus read access to the
selected PR repositories. Run the complete current process for one ticket:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --issue NUMBER --json
```

Use `real` for the real configuration with a real receipt. The command verifies
the receipt and current PR evidence, handles obvious blockers, creates and saves
the ticket's merge plan, rehearses its exact PRs, saves the report, then records
and applies its decision to the same ticket. There is no operator plan file.

The ticket supplies scope and dependencies. Trusted profile configuration names
`main` as the rehearsal destination for each repository, for either release
target. The planner reads and verifies its current commit, uses dependency order,
and preserves PR order inside each ticket part. It keeps all requested parts,
PR versions, and backend services. See
[automatic planning](../../docs/profiled-inbox-testing.md#automatic-plan-for-each-ticket).

Initial blockers skip planning/rehearsal. Missing destination configuration or
GitHub evidence gets `reason:merge-plan-unavailable`; an impossible generated
scope/order gets `reason:merge-plan-invalid`. The comment explains what failed.
A pass adds `rehearsal:passed`, with exact destinations and resulting trees.
The ticket still waits for future release execution. Combined code has not been
built or deployed. Conflicts, unknown evidence, and changed inputs retain their
separate rehearsal reasons. Saved reports cannot be imported.

Omit the ticket selector to process all selected tickets through the same flow:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --json
```

Each suitable ticket gets a separate plan; different tickets are not merged
together. Use `npm run --silent inbox:run` to suppress npm's banner for JSON.

Combining tickets and testing smaller groups after a failure is
[planned work](../../docs/design.md#proposed-batch-testing-and-selection).
No batch-selection flags, temporary GitHub PR creation, or combined application
checks exist in this command. The plan keeps this operator entry point and
places full checks at the batch level, with evidence-based outcomes for excluded
tickets. It does not change the command's current permissions or behavior.

The default selection is every open `release-request` Issue plus ticket IDs
already recorded in the journal, even if someone removed their labels. Both
legacy `pending` and new statuses are supported. Processing verifies the original
receipt and current readiness evidence, records its intended decision, applies
managed labels/title/assignment and one status comment, then verifies the result.
The original Issue body is never updated. Unrelated labels and assignees remain.
An active intake workflow is left to finish its initial setup before processing.

Stable outdated requests close with `reason:outdated-commit` and exact code
references. Requests whose PRs are all already merged close with
`reason:already-merged`: the Coordinator will not handle their release, and no
deployment is claimed. This requires verified intake, matching requested code,
same-repository source, stable observations of every requested PR, and a fresh
recheck immediately before closure. Existing outdated-commit decisions take
precedence when the requested code differs. A request combining a verified
merged PR with an open or unverified companion stays `action-needed` for a scope
decision; no subset is executed. Without a verified merged PR, missing product
evidence alone can remain `waiting` with `reason:coordinator-incomplete`.
If deployment is still needed, use the existing authorized release process.
Resubmitting the same merged PR leads to the same closure. Missing proof stays
visible. Required-check failures, conflicts, and invalid dependencies identify
a correction for the submitter. Missing Coordinator capabilities belong to its
maintainers. The processor currently emits waiting, action-needed, and closed;
eligible/completed remain reserved until independent release-history and
execution-ownership evidence can support them. It never calls a merge or deploy API.

This rule applies only to intake before Coordinator release execution. Receipt
acceptance and inbox processing do not take responsibility for executing a
release. A future worker must record and respect execution ownership before it
merges anything; its own merges must never retire work it is already handling.
Unsupported ownership fields in the journal stop this processor before writes.

Submitters can use GitHub's assignee filter. Where assignment is unavailable,
the status comment preserves the verified login/ID and points to:

```sh
npm run inbox:read -- --submitter LOGIN
npm run --silent inbox:read -- --submitter LOGIN --json
```

This filter matches verified receipt identity, not Issue author or free text.
Unverified ownership is not guessed. A renamed login is not assigned to a
different account: assignment requires the recorded stable ID in GitHub's
assignable-user list. Assignment failure does not lose an accepted request.

An operator may explicitly retire **their own verified test request**:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --issue NUMBER --close-test
```

This records `status:closed` and `reason:test`, without a successful-release claim.
The Issue number must identify the operator's intended test; title/label text
never grants this authority. General cancellation, replacement, completion,
and corrections to terminal history have no write command in this version.

### Journal, concurrency, and interrupted runs

The fixed GitHub branch `codex/inbox-state` holds only `inbox-state.json` on an
independent commit history. **Never merge it into main, delete it, or force-push
it.** It is runtime state, not a source branch. See the
[storage and trust contract](../../docs/inbox-processing.md#storage-and-trusted-writers).

Policy `2026-09-09.4` generates plans internally. The journal marker is now
`workflow: "inbox-run-v2"`. First use upgrades a legacy/v1 journal without
rewriting its decisions. Old writers reject v2 before changes. Keep the marker
and history intact; use current code instead of removing unfamiliar fields or
reasons. Read-only diagnostics and the public CLI do not change.

Each run acquires a repository-wide lock through a fast-forward-only Git ref
update. A competing run fails before changing tickets. Each meaningful decision
has a unique ID, prior decision hash, time, deciding account, policy version,
verified request/submitter/workflow, observations, and an applied result. The
generated plan for each ticket is saved under the run lock before Git work. The
intended result and comment identity are saved before Issue writes. Unchanged
runs create no additional decision or comment, though acquire/release commits
record that the scan ran. Missing or corrupted state stops processing.

An interrupted run retains its lock and reports its run ID. **Stop the original
process on its original machine**, ensure no request is still in flight, and wait
at least 60 seconds before using the reported ID:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --resume RUN_ID
```

Resume preserves the stored Issue selection, action, and already saved plans,
rotates lock ownership, checks current evidence, and reconciles partial updates.
It does not silently advance pinned destination commits. A new run captures
current destinations; a ticket not yet planned in an interrupted run is planned
when reached. A legacy interrupted run retains its previously recorded plan. A
nonterminal ticket is rehearsed afresh; an old passing report is never reused.
Do not combine `--resume` with `--issue` or `--close-test`. It does not process
other tickets from a scoped test. There is no automatic timeout, lock stealing,
or background retry. Never resume while another copy may still be running.
GitHub Issues do not offer a multi-operation transaction; the journal makes
partial application explicit and recoverable, not atomic. A maintainer must
investigate edited receipts, deleted/ambiguous status comments, manual closure
without known disposition, or externally rewritten state before proceeding.

| Exit | Ticket workflow result |
| --- | --- |
| `0` | All selected tickets have verified presentation and are closed/preserved or have a saved passing rehearsal. Waiting for future execution is still expected after a pass. |
| `1` | A selected ticket has a blocker or awaits initial evidence. |
| `2` | Usage error, unavailable planning evidence, unknown rehearsal, unverified presentation, or interrupted/partial processing. |
| `3` | Rehearsal evidence changed during the run; no current pass is claimed. |

Code 2 takes precedence, then 3, then 1. Help makes no GitHub calls. A failure
report does not claim all prior writes were rolled back. A pass is an observation
of exact inputs, not release authorization or a reservation of product branches.
