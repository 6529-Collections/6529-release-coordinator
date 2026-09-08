# Local Coordinator checks

This private workspace is the first Coordinator application. It reads the saved
requests in `6529-Collections/6529-release-coordinator` and prints a report.
It runs manually on your machine and exits. No server, timer, database, or
deployment worker is started.

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

1. Read every page of **open** Issues with both `release-request` and `pending`.
   Exclude pull requests, closed Issues, and Issues missing either label.
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
   identity. Repeated request IDs across pending Issues are reported as invalid.

The report includes the saved PR numbers, branches and full commits, release
target, database-change answer, part dependencies, backend units and their
order, and the verified GitHub actor when proof succeeds.

## Results

| Status | Meaning |
| --- | --- |
| `valid` | The saved request matches its schema, checksum, and expected workflow evidence. |
| `invalid` | The saved record is malformed, contradictory, duplicated, or differs from the workflow evidence. |
| `unverified` | Evidence cannot be obtained or uniquely confirmed, or the latest workflow attempt has not succeeded. |

| Exit code | Meaning |
| --- | --- |
| `0` | Every selected record is valid, or a successful scan found no pending Issues. |
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
5. **Overlaps and missing history.** Identify other pending requests for the
   same PR and target, without choosing one. Report completed, cancelled, and
   replaced as unknown because no durable Coordinator release-history source
   exists. Issue closure, labels, PR merge state, and newer requests cannot
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

Exit codes: **0** means a successful scan found no pending requests, **1** means
requests have blocked or unknown readiness, and **2** means usage or inbox
listing failure. Exit 1 is an expected inspection result, not a checker crash.
An empty inbox is not release authorization either.

These are observations, not an atomic snapshot, reservation, or GitHub lock.
Facts can change immediately after the last read. Future execution must recheck
its exact plan and authorization. The unresolved execution design remains in
[design](../../docs/design.md); this checker does not settle it.

## Read-only boundary and tests

The inbox GitHub adapter allows only a fixed set of Issue/run/job/log endpoints in
this repository, always with explicit HTTP `GET`, without a shell or request
body. The reader has no GitHub write action, merge/deploy operation, workflow
dispatch, scheduler, or local request-record write. It does not call the CLI's
create/submit/save functions. Its workspace is private and adds no dependencies
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
