# Progress and next steps

Last updated: **2026-09-09**. Evidence below carries its own date; the earlier
package and consumer observations were not all rechecked during this update.
Runtime behavior comes from code and live evidence. The [ticket contract](./inbox-processing.md) describes the local manual processor;
[execution design](./design.md) remains future work. There is no running service.

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
| Explicit inbox processing | [PR #21](https://github.com/6529-Collections/6529-release-coordinator/pull/21) merged September 9 at `1240fea37b5d38cc00248feefa77465525d5a5d2`. Updated intake and the first real migration were verified afterward. | [Command guide](../apps/coordinator/README.md#organize-tickets-explicitly), controlled tests #20/#22 and migration evidence below. |
| Already-merged intake boundary | Policy `2026-09-09.2` is implemented in [PR #23](https://github.com/6529-Collections/6529-release-coordinator/pull/23). Follow the PR for current merge and live ticket-closure evidence. | All 170 local tests passed, including the review follow-up. A read-only preview at 08:30 UTC found #13 and #16 would close with `already-merged`; rollout details below. |

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

Neither read-only command changes tickets. The separate
`inbox:process` records decisions and organizes selected tickets. Both updated
readers select all open `release-request` Issues, including tickets without
`pending`. The merged intake workflow's `status:received` setup was verified
with controlled test #22. The already-merged closure extension is tracked in
[PR #23](https://github.com/6529-Collections/6529-release-coordinator/pull/23).

Readiness still lacks a durable completed/cancelled/replaced history source,
runtime evidence for omitted prerequisites, and an exact execution merge plan.
The checker reports these gaps as unknown, even when individual checks pass.

There is no running Coordinator worker, durable release queue/database,
GitHub App with merge authority, automatic merge/build/deploy flow, or recovery
engine. Product repositories still use their existing authorized release
procedures. Recording a release intent is observation only.

## Current scope and later work

The owner has chosen to organize the inbox before building the local merge
rehearsal. The agreed scope is the complete **submit a request -> first inbox
processing** stage, captured in [one plan](./inbox-processing.md):

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
should close without claiming deployment. Roll out this policy before
processing #13 and #16 again. A deployment-proof checker for retiring these
requests is deferred; mixed requests remain open for a scope decision.
After this stage, return to the local merge rehearsal. The larger release worker,
execution permissions, deployment evidence sources, and recovery remain later
work. No npm release or product deployment is required for inbox organization.

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
to the same closure. Requests mixing merged and open/unverified PRs stay open
with a scope decision for the submitter; no subset is executed.

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

**Rollout order:** merge this change, update supported
processor checkouts, then run scoped processing for #13 and #16 with fresh
evidence. The new reason must reach supported processors before being written
to live journal history; older code rejects unknown reasons and stops. Do not
rewrite history or weaken validation to accommodate an old processor.
Follow PR #23 for the actual merge, checks, and subsequent ticket-application
evidence; this preview does not claim those later steps completed.

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
