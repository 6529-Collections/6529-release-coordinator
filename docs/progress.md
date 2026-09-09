# Progress and next steps

Last updated: **2026-09-09**. Evidence below carries its own date; the earlier
package and consumer observations were not all rechecked during this update.
Runtime behavior comes from code and live evidence. The [ticket contract](./inbox-processing.md) describes the local manual processor;
[execution design](./design.md) remains future work. There is no running service.

**Latest completed milestone:** [PR #30](https://github.com/6529-Collections/6529-release-coordinator/pull/30)
merged September 9 at `f53a143a52cba354570716d696fc44d6b2229d49`. Sandbox and real
profiles now share submission, receipt verification, inspection, processing,
and one-ticket merge-rehearsal code. All 235 local tests passed, and
[required CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34348455618)
passed on final head `5c2465801be5114dbb8bd3c9df3d8f454992017d`. The
[sandbox acceptance record](./testing/profiled-inbox-2026-09-09.md) proves the
live test-ticket path. Real-project live acceptance and using rehearsal reports
to update ticket decisions remain separate next steps; neither is release execution.

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

Neither read-only command changes tickets. The separate
`inbox:process` records decisions and organizes selected tickets. Both updated
readers select all open `release-request` Issues, including tickets without
`pending`. The merged intake workflow's `status:received` setup was verified
with controlled test #22. The already-merged closure extension is tracked in
[PR #23](https://github.com/6529-Collections/6529-release-coordinator/pull/23).

Readiness still lacks a verified completed/cancelled/replaced release-history
source and runtime evidence for omitted prerequisites. It also does not consume
the separate rehearsal's explicit plan and merge-result reports. The checker
reports these gaps as unknown, even when individual checks pass.

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

We can continue developing and testing in the sandbox. The next integration is
the policy for using rehearsal reports to update ticket decisions; the current
processor does not consume those reports. Multiple-ticket batching, real-project
live acceptance, the larger release worker, execution permissions, deployment
evidence sources, and recovery remain later work.

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
Its final head `5c2465801be5114dbb8bd3c9df3d8f454992017d` passed
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
