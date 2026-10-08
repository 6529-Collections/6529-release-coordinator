# Progress and next steps

## October 8 — explicit fresh checks after a diagnostic rerun (local)

The original frontend candidate failed CI. A separately approved diagnostic
rerun passed unchanged code, but a later processing invocation loaded the old
failure and stopped when the required Installed app checks conclusion had
changed. The immutable failure remains valid history, not passing release proof.

The new explicit `--resume RUN_ID --retry-checks ATTEMPT_ID` path creates a
linked fresh Git/CI round for the owner's unchanged one-ticket filtered real
frontend-only no-database-change request. It refuses uncertain owned cleanup,
active old workflows, missing/changed archives, release execution, selected
candidates, attributed code failures and exhausted existing budgets. It does
not reuse a diagnostic pass. Original history, attempts and budgets remain;
safe current-main refresh carries the retry linkage. Repeating the flag resumes
the same round; another failed fresh round holds for human direction.
Source/review/rule/workflow checks and matching staging/production deployment
plus E2E gates are unchanged. No new policy limits or pin changes are introduced.

All 34 focused tests passed. Full non-fixing Node 22.16.0 repository gates
passed with all 52 test files run serially: **1138 tests passed**, three optional
Docker skips (1141 total), plus lint, formatting, docs, workflow policy and
isolated offline packed-CLI checks. Source contents remained unchanged during
the gates. A guarded GET-only inspection of the actual saved request and its
owned trial accepted retry eligibility without saving intent or starting tests.
See the [scope and verification record](./testing/explicit-check-retry-2026-10-08.md)
and [explicit retry contract](./inbox-processing.md#explicit-fresh-checks-after-a-diagnostic-rerun).
PR review, hosted CI and merge remain pending. No request, product source, real
journal, lock, deployment or automation has been changed, and ticket 334 has not
been rerun. This is offline regression and read-only admission proof, not live
retry or release acceptance.

## October 8 — wait for GitHub merge calculation (local)

A read-only diagnostic reproduced an initial `UNKNOWN` merge answer followed
by `MERGEABLE`/`BEHIND` and its freshly audited source-admission proof, with the
requested code unchanged. The next two diagnostic pairs matched. Earlier stopped
attempts did not retain their raw pairs, so this reproduces the same stop rather
than proving the exact changed field in every historical attempt.

The local readiness change waits for pending GitHub merge calculation, then
requires two completed full observations. A pending final read never replaces
the original completed snapshot. Code, base, checks, review or PR identity/state
changes during waiting still stop; completed admission proofs remain part of
the unchanged full comparison. Conflicts and failed gates are never promoted.
Polling uses the existing release-wait cadence of ten seconds, with cancellation
and no added deadline/count ceiling. Network, pagination and malformed-data
failures remain unknown, not automatic retries. The inbox processing and cleanup
readiness callers forward their existing cancellation signal.

Controlled regression tests cover both profiles, pending-to-completed answers,
fresh behind-source audits, drift during waiting and final comparison, failed
gates, read failures, terminal/outdated sources and cancellation. All **176
focused tests passed**. Full non-fixing Node 22.16.0 repository gates passed
with all 51 test files run serially: **1121 tests passed**, three optional Docker
skips (1124 total), plus lint, formatting, docs, workflow policy and isolated
offline packed-CLI checks. Source contents remained unchanged during the gates.
The final evidence-only documentation update was rechecked separately. No release
was retried, no ticket or journal was changed, and no GitHub PR, merge or
deployment was performed. Review and merge remain pending; this is local
regression proof, not live release acceptance.

## October 7 — additive frontend browser-test contract (local)

Ordinary registration of a new frontend browser-test pack changed the whole
PR-CI blob and stopped admission, even when existing checks were untouched.
The local change accepts only matching literal registrations and sandbox test
steps at two reviewed insertion points. Every existing workflow byte stays
protected; permissions, actions, runners, builds, failure aggregation, other
workflow pins, source/reviewer gates and matching staging/production E2E are
unchanged. The current Wave feature-usage pack becomes part of the reviewed
baseline, not an optional removable extension. New supplemental packs still
need normal product review and fresh candidate CI.

The former Wave-creation policy remains trusted only as exact historical state.
Its empty unpublished preparations may use the existing fresh-rebuild transition;
owned trials, selected candidates and release executions cannot migrate.
No journal, ticket, source head, count budget or old evidence is rewritten.
See the [contract and verification record](./testing/additive-browser-workflow-2026-10-07.md).
All 104 focused tests passed. Full non-fixing Node 22.16.0 gates passed with all
50 test files run serially: **1048 tests passed**, three optional Docker skips
(1051 total), plus lint, formatting, docs, workflow policy and packed-CLI checks.
The source snapshot remained unchanged. Eight guarded GET-only GitHub requests
confirmed the former policy refuses current frontend main while the new policy
admits it; future added-pack hashes are covered offline, not yet live-tested.
PR review, GitHub CI and merge are pending; admission is not deployment proof.
The long-post attempt was already closed separately. This work starts no new
release and changes neither staging nor production.

## October 7 — stopped staging deployment closeout (local)

The frontend staging merge and deployment completed externally, followed by
successful matching browser checks, but the local connection stopped before the
Coordinator saved deployment completion. The saved attempt remains at step one
with a null deployment result; backend staging and frontend main subsequently
moved. Continuing old proof or changing saved inputs is not authorized. Existing
keep-current cancellation covered owned unmerged PRs, not this merged checkpoint.

The local extension allows explicit abandonment only for a confirmed
no-database-change frontend-only first deployment with exactly two operations
and no production work. GET-only inspection verifies the historical owned merge,
commits, absent branch, pinned deployed-source files and exact successful run/jobs,
with quiet workflows and final attempt/owned-branch readbacks. It preserves original
operations, attempts, inputs and policy, saves separate abandonment evidence,
and uses normal cancelled-ticket closeout/archival. It does not merge, dispatch,
restore, cancel an external workflow, accept old proof for current environments,
or refresh workflow pins. See the [scope and verification record](./testing/stopped-staging-closeout-2026-10-07.md).
All full repository gates passed on Node 22.16.0 with 48 test files run serially:
**980 tests passed**, three optional Docker skips (983 total), plus non-fixing
lint, formatting, docs, workflow policy and packed CLI checks; the source snapshot
remained unchanged. All 193 focused tests passed. A GET-only actual checkpoint
inspection accepted saved eligibility but correctly refused active product
workflows; a separate GET-only read verified the original merged PR/commits and
absent branch. Neither changed the journal. PR review and merge are pending.
No live cancellation, journal change or new product release has been performed.

## October 7 — unchanged staging tree publication (local)

The fresh long-post release stopped before creating its first staging commit:
its saved ordinary merge preparation has an empty patch and the exact existing
staging tree, while the adapter always attempted Git tree creation. The original
log records only HTTP 422, without the endpoint or response body; that alone
does not establish the server's precise rejection. No staging or production
merge, deployment or E2E completion is recorded for this attempt. The process
and requests stopped; journal revision 743 and its exact saved inputs were
independently reread unchanged on October 7.

The narrow fix verifies that an empty patch retains the staging base tree,
rereads the unchanged staging ref and exact base commit/tree, then reuses that
tree without an empty creation request. A unique two-parent integration commit,
fresh PR checks, protected merge, deployment and matching E2E are still required.
No saved inputs, attempts, policies, workflow pins or count budgets are changed.
See the [scope and regression evidence](./testing/unchanged-staging-tree-2026-10-07.md).
All full repository gates passed on Node 22.16.0: all 48 test files ran serially,
**970 tests passed**, three optional Docker skips (973 total), plus non-fixing
lint, formatting, docs, workflow policy and packed CLI checks. The source snapshot
remained unchanged. A GET-only validation accepted the actual saved preparation
and reproduced its unchanged integration input. Review and merge are pending.
The watcher remains paused and the same release has not been resumed; this is
not deployment proof.

## October 6 — interrupted first-staging cancellation (local)

The long-post release stopped on a pre-merge source gate after saving its first
owned staging PR. No staging merge, deployment or production operation was
recorded; the saved release remains at `running`/step zero although the original
process exited. Existing cancellation accepted review pauses and interrupted
review stops, not this checkpoint. The local change adds only that first-stage,
single-operation, `checking`/null-result case to explicit keep-current cancellation.
The adapter still verifies current unmerged PR ownership, exact head and uniquely
owned branch before its existing conditional cleanup. It cannot merge, deploy,
restore shared refs or refresh old candidate proof. Uncertain merges, later
operations, database effects and recovery remain refused.

All 91 focused engine/adapter tests passed, including interrupted cleanup,
durable intent, moved shared refs, multi-ticket closeout and verified archival.
See the [scope and offline evidence](./testing/interrupted-first-staging-cancellation-2026-10-06.md).
All full repository gates passed on Node 22.16.0, with all 48 test files run
serially to avoid parallel local memory load: **960 tests passed**, three optional
Docker skips (963 total), plus lint, formatting, docs, workflow policy and packed
CLI checks; the source snapshot remained unchanged. A GET-only read of journal
revision 710 reproduced eligibility for the same #311 checkpoint, not cleanup.
PR reviews/CI and merge are pending. The real attempt
has not been cancelled, and no fresh feature head or release request has been
created. The watcher remains paused; unrelated work and old release history
are unchanged. This implementation is not live cleanup or deployment proof.

## October 6 — reviewed Wave-creation PR-CI approval (local)

Coordinator PR #315 and #316 are merged; clean main before this work was
`4446c4445a3995d97879dae597832894c305a9c6`. The authorized isolated real
#311 run `b9f77d5a-9fe8-41d6-bad4-cbc8d7422644` stopped before candidate
publication at `2026-10-06T06:50:36.290Z`: frontend `app-pr-ci.yml` had changed
from approved `0a506cbf14c340198c5273a560b0968d901cbebd` to
`134e53f46bfe207742adcc4fec392128bec75ab8`. Its Git rehearsal passed, but
there is no candidate CI or staging/production deployment proof. Journal
revision 674 preserves the same filtered #311 scope/actor, source/request,
original attempts, empty check resources and owned lock; the runner exited 2
and its actual Node/npm processes were independently absent.

The [complete blob review](./testing/frontend-wave-creation-ci-2026-10-06.md)
found only 14 added lines for a local Wave-creation browser test lane. This
branch approves those bytes only, preserves the superseded policy snapshot and
adds its narrow unpublished-preparation transition to the current policy.
Existing original-policy refresh remains supported; native/copy-based policies
and owned trials/releases do not gain a migration route. The same source must
be rebuilt and freshly checked, preserving history and spent budgets. Required
checks, backend/debt-ratchet/deployment pins, permissions, sandbox policy and
release/recovery gates stay unchanged. All 36 focused policy/admission/resume
tests passed; full non-fixing Node 22.16.0 checks passed **953 tests**, with
three optional Docker skips (956 total), plus lint, formatting, docs, workflow
policy and packed-CLI gates, with source unchanged. Seven guarded GET-only
requests reproduced old-policy refusal and current-policy admission against
exact product main above; saved revision 674 is eligible for the narrow
refresh. This is admission proof, not candidate CI or deployment. PR review/CI
and merge remain pending; #311 has not been resumed. Old #285/#294 history is
untouched.

## October 6 — reviewed production E2E canary workflow pin (local)

The real frontend release adapter now pins `production-e2e.yml` blob
`56b8c0e73121bcb1ac937775fbe3e80dd2f3bce5` on both environment branches,
replacing `29346bd8d8c9816f40388801943b006e21f3f6ef`. Complete blob reads were
independently rehashed at product main `a8a95d30bf20977ef40e6e8cb0c6b1b9a761310a`
and staging `695b86fea2201414a9b158f5cf75f5b954f26da0`, and compared with the
parent of product commit
[`be8c0c8`](https://github.com/6529-Collections/6529seize-frontend/commit/be8c0c832b6ee7f4053df52c34bb32f8b0766fdf).
The new workflow adds live-SHA-bound canary discovery, checks out trusted helpers
at its workflow commit, distinguishes setup/browser failures and preserves
provenance evidence. Its new helper was reviewed at blob
`8d79eb5f1c8525e423b85525ee52e01bc2fbe684`; only schedule/canary scope executes
it. The normal deployment-caused post-deploy chain retains the same inputs,
run/job/live-version/source checks, browser-pack commands and required job name.
No Coordinator dispatch, job matching, permission, limit or recovery change is
needed. All other real pins and the entire sandbox runtime remain unchanged.

Tests use independent reviewed blob literals for GET-only admission on both
branches, refuse the immediately superseded and unknown blobs, and require the
production browser job despite successful ancillary notifications. All 103
focused tests passed. Full non-fixing Node 22.16.0 checks passed **945 tests**,
with three optional Docker skips (948 total), plus lint, formatting, docs,
workflow policy and packed-CLI checks; source contents remained unchanged.
The actual real release identity client also passed with 65 GET-only requests
against both product repositories and both environment refs above; all configured
files/workflow identities matched. This is admission evidence, not deployment.
Remote PR review/merge remain pending. PR #315 is already merged at
`ed3975cdee430c8a712ef477b06adbd1e21f9399`; this separate approval does not
change its candidate-check policy. No #311 run, #285/#294 resume, product edit,
deployment, journal mutation, cleanup or package publication occurred here.

The initial general review suggested replacing the loose rejection regex with
the exact `release-workflow` error code/message; the regression now checks that
specific browser-job contradiction, not an unrelated refusal. Initial primary
general/security/deployment reviews were clear. Initial GLM advisory coverage
was incomplete: three slices returned empty output, and the remaining slice
examined only progress text. That is not GLM coverage of the changed code/tests;
full deterministic checks and the other configured reviews remain separate.

CodeRabbit reviewed the initial five-file head and suggested covering failed
ancillary notification jobs. The added fixtures use the real notification-job
names: a successful run with successful browser evidence is not rejected solely
for an ancillary conclusion, but an unsuccessful run is still refused even when
its browser job passed. No runtime gate was relaxed. Final-head included review
was rate-limited; that green status is not completed review coverage, and no
paid/on-demand review or billing change was requested.
Full non-fixing checks after both review improvements passed **947 tests**, with
three optional Docker skips (950 total), plus all other repository gates and
unchanged-source verification. Canary helper content is not recursively pinned
by a workflow-file hash; it remains outside Coordinator execution scope.

## October 6 — reviewed frontend session-recovery PR-CI pin (local)

The real frontend candidate-check policy now pins `app-pr-ci.yml` blob
`0a506cbf14c340198c5273a560b0968d901cbebd`, replacing
`2cc4f7a5e36ba3d056b1f4b43d534f13f2ebde9a` for fresh preparations. A complete
blob comparison found only the added session-recovery browser regression step
in the existing critical-shell lane. Its package command uses the local
Playwright authentication/composer sandbox. Required checks, permissions,
backend/debt-ratchet and deployment pins, sandbox policy, count budgets and
staging/production/recovery gates are unchanged. The exact native-competition
policy remains trusted for saved-history reads and its original pin checks;
old proof is never promoted to the new policy hash. The existing narrowly gated
pre-publication refresh is not widened to another historical policy.

Fresh real [ticket #311](https://github.com/6529-Collections/6529-release-coordinator/issues/311)
was accepted through intake run `37321444238`, request
`231c312c-bc2c-4753-950c-1754d42ec376`, unchanged frontend PR #4120 head
`39263ae2038767c08f1be1355b218896f82d613f`, verified submitter `simo6529`
(`209783236`), production target, no database change and no dependencies.
Before this change, read-only candidate identity admission reproduced
`batch-runtime: A pinned product PR workflow changed.` Product deployment
identity admission passed separately on October 5. The 30 focused policy/identity/refresh
tests passed. Full non-fixing checks on Node 22.16.0 passed **942 tests**, with
three optional Docker skips (945 total), plus lint, formatting, documentation,
workflow policy and packed-CLI checks; source contents remained unchanged.
GET-only frontend candidate identity admission then passed against product main
`a8a95d30bf20977ef40e6e8cb0c6b1b9a761310a`. Remote reviews/CI, merge and
the authorized isolated #311 release are still pending; ticket creation and
admission readbacks are not staging or production deployment proof. Neither old
ticket #285/#294 attempts nor product code, shared branches or journals changed here.

The October 6 GET-only release recheck found a separate, unapproved frontend
`production-e2e.yml` change on both environment branches: expected blob
`29346bd8d8c9816f40388801943b006e21f3f6ef`, observed
`56b8c0e73121bcb1ac937775fbe3e80dd2f3bce5`. Product commit
[`be8c0c8`](https://github.com/6529-Collections/6529seize-frontend/commit/be8c0c832b6ee7f4053df52c34bb32f8b0766fdf)
adds live-version-bound canary discovery, failure classification and preserved
evidence. All other configured deployment-file pins matched. This PR does not
approve that separate workflow/helper change: #311 remains unstarted pending
its review and explicit approval. The saved journal remained at revision 665
with no lock; its existing native-policy batches are finished, not active
preparations requiring migration. Advisory follow-up tests explicitly reject
current-to-native downgrade and native-to-historical refresh and assert pairwise
distinct prior/native/current policy hashes without changing the guard.

## October 5 — workflow-wait PR integration with current main

PR #304 now integrates remote main `489125e11b7b0b091d2ed2e7240444ff45409fd6`,
which includes the ordinary merged cleanup/release-board PR #307 and the earlier
staging-preparation PR #293. The sole merge conflict was overlapping progress
notes; both delivery histories are retained. The product adapter's automatic
merge also retains #307's exported job-set helper for cleanup evidence alongside
#304's exact-run waiting and cancellation guards. Cleanup, journal ownership and staging preparation
code are otherwise unchanged from reviewed main. The combined non-fixing Node
22.16.0 gate passed **942 tests**, with three optional Docker skips (945 total),
plus lint, formatting, documentation/workflow policy and packed-CLI checks;
the check wrapper verified unchanged source. The regressions still cover both
profiles and automatic E2E in staging and production, late job evidence,
interruption/resume without redispatch, and verified failed-wrapper routing.
Fresh exact-head remote gates remain required before merging #304. This is
offline proof, not a fresh sandbox or real release. No cleanup, release, product
operation, publication or runtime restart occurred for this integration step.

## October 5 — cleanup and release-board publication checkpoint

The existing local cleanup, cooperative ticket reservations, follow-up evidence,
transport diagnostics and release-board work is now saved on
`codex/publish-cleanup-dashboard`. Signed snapshot `0a56398` preserved all the
previously uncommitted files before integrating current remote main
`b00542b503f2af190fce8cbafe0674d0503b111b` (merged staging-preparation PR #293).
The final diff preserves #293's reviewed conflict logging, review-stop cleanup,
tests and acceptance record rather than publishing older copies of those files.
The other cleanup worktree and the separate workflow-wait PR #304 are unchanged;
this branch does not include #304's unmerged fix.

Fresh non-fixing `npm run check` on Node 22.16.0 passed **862 tests**, with three
optional Docker tests skipped (865 total), plus lint, formatting,
documentation/workflow policy and packed-CLI smoke checks. The source snapshot
remained unchanged. These are local offline checks: remote PR CI/reviews and a
merge remain separate gates. No cleanup command, live journal/ticket mutation,
release resume, browser cleanup click, product merge/deployment, npm publication
or runtime restart was performed for this publication checkpoint.

Review follow-up in PR #307 bounds journal ancestry reads by the verified
revision gap, preserving the existing five readback attempts and disjoint-save
rules. Offline regressions reproduced an unconfirmed write reading 220/230
old commits instead of 5/15; rewritten and regressed heads now reject after
their one required snapshot read. A second lane advancing during the reread
still verifies successfully. A large saved-history regression also reproduced
an argument-spread stack overflow; selecting the earliest verified start now
uses a reduction without adding a history cap.

The follow-up reader explicitly reports GitHub's documented 1,000-result
workflow-search cap and imprecise counts as unavailable complete evidence.
It still rejects short or moving pages, accepts exactly 1,000 verified workflow
results, and paginates 1,001 jobs without inventing a job limit. The updated full
local gate passed **870 tests**, with three optional Docker skips (873 total).
Initial primary reviews were context-truncated; CodeRabbit inspected all 33
files and raised the fixed ancestry finding. Initial GLM reviewers all returned
empty output, so no GLM coverage is claimed. Fresh exact-head remote reviews and
CI remain required before the separately authorized merge; these changes have
not been exercised against the live inbox.

The next review pass reproduced a first-decision failure masking its original
error with `.at(-1).id`. Cleanup now preserves the original cause and saved
resume identity when no transition exists or when diagnostic timestamp/save
work fails. Both cases retain their saved claim and resume without duplicate
Issue comments. Additional tests account for two distinct stopped attempts:
every original integration/resource must be settled, and one active or
unaccounted attempt prevents closure; no single-attempt policy limit was added.

CodeRabbit's outside-diff active-workflow finding was also reproduced: a run
created before the history cutoff could be missed. The fixed GET-only client
checks the newest unfiltered page and all existing active-status counts without
a date cutoff, initially and again before accepting follow-up proof. Counted
but unlisted runs and unreadable activity remain unknown. Full local checks
passed **875 tests**, with three optional Docker skips (878 total); 76 focused
cleanup/follow-up/concurrency tests passed. The first fresh GLM advisory returned
only its correctness slice, with three empty slices; its activation concern
does not apply because the claim is saved before any ticket update. Fresh
remote gates for these latest fixes remain separate from local proof.

The final documentation clarification distinguishes still-active older runs
from completed ones. Additional characterization tests verify repeated distinct
CLI issue flags in both profiles, synchronous board-task failure/retry, and
large rejected HTTP bodies followed by a request on the same socket. Those
advisory leads required no runtime changes. The full local gate passed **878
tests**, with three optional Docker skips (881 total). Required GitHub CI at
`8bcfbce` passed; its primary reviews were context-truncated and the GLM advisory
had only its runtime slice available, with three empty slices. Superseded
general-review claims and the advisory leads are answered with current code
and test evidence on PR #307. Final-head remote review and merge remain separate
from these local results; no live inbox or product operation was performed.

## Concurrent cleanup — local installation (October 2)

The approved dashboard cleanup changes were installed locally from the managed
`codex/concurrent-inbox-cleanup` worktree, integrated with reviewed main `73d8747`.
Release and cleanup use separate owners and ticket reservations in the same
GitHub journal. Cleanup skips running, paused, recovering and unfinished release
tickets; the full-inbox release settles unselected tickets before deployment and
does not overwrite subsequent cleanup. New cleanup outcomes remain **Action
needed** or **Closed**. The `cooperative-v1` marker fences older writers on first
authorized acquisition. The installed guides describe activation and recovery.

That worktree's full Node 22 gate passed **840 tests**, with three optional Docker
skips; its fifteen overlap/recovery cases cover both profiles. After installation,
this checkout passed 55 focused cleanup/concurrency/server tests. Runtime patch
paths did not overlap the separately edited staging preparation files; this does
not claim completion of that separate fix or its full combined-checkout gate.
No remote merge or package publication is included in this installation.

The board at `http://127.0.0.1:51901/` was restarted and browser-verified with
**Check & clean up** enabled and idle. Installed-reader GET-only readback retained
real journal revision 598 at `69c8f7ec480ec4ad384b21741282b7e31d5ceccd`, no active
lane and no cooperative marker yet. No cleanup run, ticket/journal write, #285
resume or product dispatch was performed. Opening the board never starts cleanup.
See the [maintenance contract](./inbox-processing.md#cleanup-without-release-execution)
and [release board guide](./release-board.md).

Last reviewed: **2026-10-05** for local confirmed-workflow completion waiting,
and **2026-10-02** for the reviewed frontend release-runtime refresh,
candidate blob publication, behind-main source admission, original-PR
history publication, completed sandbox acceptance, the local frontend PR-CI
pin refresh, and staging-aware preparation's local review and sandbox acceptance. The real #275 evidence
below retains its recorded September 30 date.

## October 5 — wait for confirmed release workflows (local only)

On branch `codex/wait-for-workflow-completion`, the product-shaped adapter used
by both real and sandbox profiles now follows the same verified deployment,
monitoring, automatic E2E dispatcher and E2E run without the old sixty-poll
completion cutoff. Exact job evidence may also settle after that window. The
explicit generic sandbox fallback applies the same known-run waiting rule.
GitHub's workflow/job timeouts, existing run-discovery bounds, PR/check and
sample-service polling, runtime pins, release gates and recovery policy remain
unchanged. Failed/cancelled/timed-out runs, mismatched identity and uncertain
evidence still stop; cancellation preserves the saved run for explicit resume
without redispatching it.

Five new regressions reproduced the old cutoff before the fix. Offline tests
simulate more than sixty pending observations, eventual success and failure,
exact run/actor/source checks, job-index lag, cancellation during waits and
final reads, unchanged missing-run discovery, and resume without a duplicate
dispatch. Automatic E2E duration cases cover staging and production in both
profiles. These are controlled-response local tests, not live GitHub sandbox
acceptance. No release, deployment, ticket/journal mutation, workflow pin
refresh or npm publication is part of this change. At this local checkpoint,
no remote PR or merge had occurred; publication and final-head review are separate
steps and do not establish live acceptance.

The full non-fixing `npm run check` passed on Node 22.16.0: **812 tests passed**,
three optional Docker cases skipped (815 total), plus lint, formatting,
documentation/workflow policy and packed-CLI checks. This is local verification
only, recorded before publication and the PR review below.

### PR #304 review follow-up

[Coordinator PR #304](https://github.com/6529-Collections/6529-release-coordinator/pull/304)
publishes this waiting change separately from the product release. Its initial
required GitHub CI passed. The general review identified an interrupted
wrapper-only window: the confirmed automatic E2E dispatch ID was not saved until
the test run appeared. Two offline regressions reproduced the missing snapshot
and the late cancellation boundary before the fix. The adapter now saves that
wrapper and its causal deployment immediately, checks cancellation after saving,
and resumes the exact wrapper without rediscovery. A missing wrapper or test run
has a specific discovery error rather than an identity-mismatch message.

Further tests verify HTTP 404 stops each confirmed-run path without replacement,
and exercise workflow, actor, branch, event and unknown-status changes while
waiting. The initial GLM advisory had three empty reviewer slices and covered only
design text; it is not code-review coverage. Final-head checks and reviews remain
required. No release or deployment was restarted for this PR.

The review follow-up's full non-fixing local gate passed: **832 tests passed**,
three optional Docker cases skipped (835 total), with lint, formatting,
documentation/workflow policy and packed-CLI checks passing and source unchanged.
The touched helpers now have purpose/boundary docstrings; no review threshold or
configuration was changed. A new local completion bound was deliberately not
added: the agreed behavior waits for GitHub while retaining explicit cancellation.

The completed incremental CodeRabbit review then identified a second valid gap:
a confirmed failed automatic E2E wrapper escaped as an error and left its saved
operation running. Two profile regressions reproduced that behavior before the
fix. A verified wrapper failure now returns failed-only `e2e-dispatch` evidence,
with its actual wrapper identity and no claim that E2E ran or passed. Offline
cases cover both profiles and environments, rejected success/build/deployment
claims, contradictory jobs and cancellation. Engine tests verify existing
no-database-change recovery versus database-changing human stop, and terminal
same-run resume without repeated work. Cancellation, timeout and uncertain
evidence remain reconciliation stops; no recovery policy or workflow pin changed.
Final-head CI and review of this second follow-up remain required before merge.

The second follow-up's full non-fixing local gate passed: **839 tests passed**,
three optional Docker cases skipped (842 total), plus lint, formatting,
documentation/workflow policy and packed-CLI checks. The check wrapper confirmed
unchanged source. Touched test callbacks now document their simulated delay,
cancellation and persistence boundaries; review configuration is unchanged.

CodeRabbit's completed review of `10dbaa6` found no actionable code issue but
retained an aggregate docstring warning. Its subsequent source inspection
confirmed valid JSDoc on the named helpers and callbacks and could not provide
the checker’s nine-function diagnostics. The already-documented test helpers
now use ordinary named function declarations to avoid ambiguous comment attachment;
their response behavior is unchanged. The new failed-wrapper pin check also
explains why its `prod` argument selects the trusted `main` runner's files,
including for staging. GLM's remaining hardcoded-environment lead was independently
rejected against that execution-ref contract; two advisory slices were empty.
These are scoped documentation/readability follow-ups, not a pin or policy change.

The completed `b0da9b2` CodeRabbit review also found no actionable code issue,
but its aggregate documentation count still warned. A further documentation-only
pass describes the existing workflow pin verification, discovery, quiet-wait and
fixture boundaries. No function behavior, review threshold or configuration changed.

## October 2 — staging-aware merge preparation (local and sandbox acceptance)

Local, uncommitted Coordinator-only code now prepares new forward staging
integrations against the captured `1a-staging` tip, preserving staging-only work
and the selected candidate's original source ancestry. Its separate version-two
input records the exact merged tree and SHA-only patch. New merged blobs are
reconstructed and hash-verified in an owned workspace before publication;
staging checks, GitHub's test merge and the final merge bind to that exact
composition. Production's selected current-main candidate, restoration,
workflow pins, required gates and existing policy budgets are unchanged.
Genuine conflicts still stop for a person before publication; failed GitHub
mergeability is reported as a conflict rather than a failed test.

The offline regression uses the two #285 conflict paths and proves that no side
is guessed and no GitHub write occurs. Other cases cover clean divergent merges,
staging-only content, exact source ancestry, new merged blobs, stale checks,
wrong trees/parents, moved staging, lost upload/PR/merge responses, cancellation
and cleanup. Nineteen new staging-merge tests and a final-stop/ticket-message
regression supplement the existing integration and journal-state coverage.
The full non-fixing `npm run check` passed on Node 22.16.0 in a disposable local
checkout containing only these twelve changed files over base
`73d8747dc55c842905903a1195093cf414d78230`: **773 tests passed**, three optional
Docker tests skipped (776 total), plus lint, formatting, documentation/workflow
policy and packed-CLI smoke checks. The source snapshot remained unchanged.
The shared checkout also passed with 860 tests and the same three skips, but
that result includes unrelated concurrent changes; those changes were left alone.
At that implementation checkpoint, no live sandbox acceptance, commit, push or
PR publication had occurred for this fix. The separately authorized October 2
local review repeated the isolated full gate (773 passes, three optional Docker
skips) and found no blocker. The [staging-preparation sandbox record](./testing/staging-preparation-2026-10-02.md)
records completed acceptance for new filtered test tickets #57/#58. The deliberate
conflict named its file, published no staging PR, changed no environment and
released the lane. The clean case kept all five staging-only document blobs,
passed fresh staging CI and matching fake deployment/E2E, then separately passed
main CI and matching fake-production deployment/E2E without importing those
staging-only files. Source PR #168 was marked merged at its exact pinned head;
ticket #58 closed completed, all owned temporary branches were removed, and
journal revision 4749 has a null lock with checksum-verified archived evidence.
Backend refs and real journal revision 598 remain unchanged. This is acceptance
of the isolated, uncommitted source, not a Coordinator PR merge, configured
final-head bot reviews, npm publication or real-product release proof.

Ticket #285 remains stopped at its saved failed staging integration. Its source
head `bc220ad0f6c05f98259940cd295e0089709b330b`, journal revision 598, prior
attempts and cleanup, and paused watcher are untouched. This general preparation
fix does not resolve its two genuine test conflicts or authorize a retry,
ticket submission, journal/lock write, product merge, deployment or npm publication.

### Publication and review follow-up

[Coordinator PR #293](https://github.com/6529-Collections/6529-release-coordinator/pull/293)
was opened from signed commit `990a1ad59bedd1768b1bcd1f3292f68f653d9633`.
Its initial Node 20/22/24, package, CodeQL and Snyk checks passed. Primary reviews
reported no findings, but general/deployment context omitted five changed files;
that is limited coverage, not an exhaustive review. CodeRabbit completed its
included review and identified two valid issues: the integration log omitted
conflict paths, and version-two staging drift prevented explicit review-stop
cleanup. Both were reproduced with failing offline regressions before the narrow
fixes. The branch now logs the conflict details and allows review-stop cleanup
after staging moves without allowing an ordinary resume to merge stale inputs.
Coverage includes sandbox and real-profile actual-Git fixtures, an interrupted
stop save, immutable preparation identity and no shared-branch write during cleanup.
The full non-fixing gate passed again: **775 tests passed**, three optional Docker
skips (778 total), plus lint, formatting, documentation/workflow policy and the
packed-CLI smoke check. Fresh final-head CI and reviews remain required; this PR
is not merged and #285 is not resumed. The live sandbox acceptance above belongs
to the preceding source snapshot; these review follow-ups have offline coverage,
not new live acceptance.

The exact-head GLM advisory was partial: three reviewer slices returned empty
output. Its proposed log-flush race was checked against the synchronous
`writeSync`/`fsyncSync` path; the regression reads durable events after `run()`
resolves, so no asynchronous flush race exists. Its test-cleanup suggestion was
accepted: register root cleanup before logger construction and assert nonempty
log contents before parsing. These are test-only safeguards, not runtime changes.
CodeRabbit acknowledged both corrected functional findings in their threads;
that acknowledgement is not a fresh full review of subsequent commits. Its
automatic docstring-percentage warning is advisory and is not the repository's
required CI gate. No review configuration or documentation threshold was changed.

## October 2 — frontend release-runtime refresh (source update)

Branch `codex/frontend-release-runtime-refresh` updates only the Coordinator's
trusted real frontend file versions after complete immutable-blob comparisons.
Both product branches now carry the previously reviewed staging
multi-competition build setting. The production build adds that same setting;
production E2E adds GET-only retries for transport/server failures while keeping
its exact successful deployment, canonical job, live-version and source checks.
Workflow identities, dispatch inputs, permissions, required integration checks,
serialization and matching staging/production E2E gates are unchanged. Sandbox
files and backend workflow/PR-CI pins are not refreshed. Details and exact
versions are in the [October 2 review record](./testing/frontend-runtime-refresh-2026-10-02.md).

Coordinator PR #291 merged at `f256b73fac62cefd71e99dee714919eacdb50813`.
The authorized same-run #285 resume then published temporary frontend PR #4148
at `8c2bbae6df7325754d2b0080f8fdd6d32fa2e047`, passed all required combined
checks, closed that PR unmerged and removed its exact owned branch. It stopped
at release-runtime identity verification at 14:41 UTC on October 1. Independently
read journal revision 584 at `21046a9273f56f561cebd4f049ca2196684fe9cc`
retains the same filtered #285/`simo6529` run and lock, selected ticket [285],
passed original attempts and cleanup, and no release execution. No staging or
production deployment was started by that attempt. Those tests do not prove a
future candidate or a completed release.

Thirteen new offline tests reproduce the old identity refusal, accept the exact
reviewed frontend versions on both branches, and refuse every superseded or
unknown blob independently before writes. Existing per-operation tests likewise
refuse all three stale/unknown files before a dispatch in each environment.
The 82 focused shared/product runtime, adapter, recovery and bundle checks pass,
including distinct-environment pin independence after the current branches
became byte-identical. The full non-fixing `npm run check` passed on Node 22.16.0:
**753 tests passed**, with three optional Docker tests skipped (756 total), plus
lint, formatting, documentation/workflow policy and packed-CLI
checks. The exact locked dependency audit found zero vulnerabilities. A separate
read-only call to the actual shared/product runtime identity admission also
passed against both environments, without invoking the inbox or dispatching a
workflow. Journal revision 584 and the paused watcher remain unchanged.
The PR review follow-up documents the offline identity helper and explains why
its exact two-read assertion deliberately protects both existing admission
layers. No execution behavior is changed by that follow-up. Remote merge is
tracked in [Coordinator PR #292](https://github.com/6529-Collections/6529-release-coordinator/pull/292);
this source update is not npm publication or live release acceptance.
Per the user's explicit instruction,
**do not resume #285**: its saved journal and paused follow-up remain untouched.

## October 1 — missing combined-file upload (local)

Branch `codex/publish-merged-candidate-blobs` repairs real trial publication when
Git creates combined file contents that do not yet exist in GitHub. The writer
recreates missing bytes from the saved exact main/source heads in an owned
temporary Git workspace, verifies the complete saved tree and SHA-only patch,
cleans the workspace, then uploads only missing hash-verified blobs before the
ordinary exact-tree/parent commit and PR creation. Byte-exact base64 uploads also
preserve binary data. No product edits, policy-pin refresh, journal migration,
source-head change or new limit is part of this fix. Sandbox inline publication
and every later check/review/deployment/E2E gate stay unchanged.
Source delivery is tracked by
[Coordinator PR #291](https://github.com/6529-Collections/6529-release-coordinator/pull/291).

The stopped real #285 attempt exposed two combined help-index blobs missing from
GitHub. The resumed command exited 2 on HTTP 422 during trial creation at
12:21 UTC. Independently read journal revision 571 retains the same filtered
`#285`/`simo6529` run and lock, exact source `bc220ad0f6c0`, and unpublished check
attempt `dea415ce-281b-4095-8601-f2754ff7dfa4`. No release execution exists in
that saved attempt. Its preceding trial #4146 was closed and its owned branch
removed after main moved; those attempts and spent budgets remain preserved.
The follow-up watcher is paused. This code change does not resume that run,
clear its lock, change its request, or start any release or other ticket.

Offline regressions reproduce a genuinely new merged help-index blob using real
temporary Git repositories and independently rebuild the server-side tree from
uploaded objects. They cover binary bytes/executable modes, SHA deduplication,
deletions, saved-check resume after a lost upload response, refusal of bad bytes
or identities, main/authority/interruption guards, and owned cleanup. The full
local `npm run check` passed **736 tests**, with three optional Docker tests
skipped (739 total); lint, formatting, documentation/workflow policy and the
packed CLI smoke test passed. The locked dependency audit found zero
vulnerabilities.

A separate read-only reconstruction used #285's actual saved preparation from
journal commit `b441fc9c81cf0a55293727edd19c0aaa8ac7fa81`. It reproduced tree
`67c4fc3b698d0dc951b404fa88f996dc38ac55e5` and both missing blobs exactly:
`04494223f162d24f3dcc2683b754460705163e24` (602,480 bytes) and
`47daec2dea42ccb1e98966b589b4a22be75e60e2` (602,169 bytes). Owned temporary Git
cleanup completed and the authoritative journal commit remained unchanged.
This check read product Git objects but made no GitHub writes or inbox invocation.
It is reconstruction proof only, not upload/deployment acceptance. No merge,
npm publication or live staging/production acceptance is claimed by that check.

Review hardening adds interrupted multi-blob/reordered-upload coverage with an
explicitly seeded server object set, an explicit subprocess text/Buffer contract
and pre-spawn encoding validation, refusal of a reordered saved patch, and
cleanup-error precedence. The fixture independently builds the server tree in
its owned bare workspace without writing loose objects into its source checkout.
Git is a required offline-check prerequisite, not an optional skipped gate.
The final local check passed **738 tests**, with three optional Docker skips
(741 total), including lint, formatting, documentation/workflow checks and the
packed-CLI smoke test. Remote checks and reviews remain separate evidence.

The final CodeRabbit review identified cancellation during the last known-blob
lookup. A regression first reproduced that publication could continue after the
abort. The writer now checks cancellation after probing and before every request,
including after its awaited write-authority guard. Tests abort during the blob
lookup, destination read and write guard and require no publication or saved
commit. The updated full local check passed **739 tests**, with three optional
Docker skips (742 total); all other repository checks passed. This cancellation
fix does not claim a merge, resumed run or product deployment.

## October 1 — frontend PR-CI pin refresh (local)

Branch `codex/frontend-ci-pin-refresh` updates only the real frontend
PR-check contract. Source delivery is tracked by
[Coordinator PR #290](https://github.com/6529-Collections/6529-release-coordinator/pull/290).
It updates the
`.github/workflows/app-pr-ci.yml` pin from
`874b4eb0070101202d0d3eda081d5e616e87cabd` to
`2cc4f7a5e36ba3d056b1f4b43d534f13f2ebde9a`, after a complete blob comparison.
The product added an optional native-competition browser lane and its dispatch
output/step; the existing required checks, permissions and security gates did
not change. Debt-ratchet and backend pins are not refreshed by this change.
The current backend PR-CI blob also differs from its saved pin; that separate
unreviewed change remains a blocker for backend-containing candidates.

Real filtered [ticket #285](https://github.com/6529-Collections/6529-release-coordinator/issues/285)
passed individual and combined Git preparation, then stopped on the changed
frontend PR-CI pin before recording any trial PR or release execution. Run
`b16e62c4-fcf9-414a-b7eb-1d6add579d9e` retained its filtered #285/`simo6529`
scope and journal lock at revision 541. This local change preserves that exact
historical policy and permits only its explicitly reviewed, unpublished
preparation transition: retire/clean the old check attempt, reverify unchanged
receipts/actors/heads/gates, and perform fresh preparation and CI under the new
policy hash. Main may stay unchanged or advance; prior attempts still count
against the same run's budgets. Published work and existing releases are not
migrated. Unknown workflow blobs remain refused.

Offline regression coverage includes unchanged/moved main, saved-lock resume,
fresh CI identity, old-policy readability, preserved attempts and budgets,
idempotent second resume, changed code/check blockers, and exclusion of owned
trials or release execution. Review hardening adds the explicit backend-pin
drift refusal regression and clarifies same-policy snapshot de-duplication.
The full local `npm run check` passed **726 tests**,
with three optional Docker tests skipped (729 total), including lint, formatting,
documentation/workflow policy and packed-CLI checks. The locked dependency audit
reported zero vulnerabilities. This is local source/test coverage, not GitHub PR
CI or live acceptance. No npm publication, product edit, release resume or
staging/production deployment is part of this update.

## October 1 — behind-main PR preparation

Implementation branch `codex/behind-pr-release-history` allows an independently audited
behind-main source PR to enter fresh testing without changing its requested head
or developer branch. New sandbox/real candidate policies preserve the original
commits through CI-checked staging and protected main integrations; main indirectly marks
the selected source PRs merged. Other gates remain enforced, and unselected
inherited open PRs are refused. Source checks/reviews are read again before
integration. A merged source is not a completed release: resume must still verify
the saved deployment/E2E sequence. Exact older copy-based policies remain readable.
The journal preserves `inbox-run-v7` and fences older writers with the trusted
`source_history: original-pr-v1` field, including after archival.

Source delivery is tracked by
[Coordinator PR #288](https://github.com/6529-Collections/6529-release-coordinator/pull/288).
Review hardening threads cancellation through source-history scans and
re-preparation, filters open PR scans to main, caches repeated immutable SHA
comparisons and rejects a previously attempted preparation snapshot. The
unselected-history check now runs before both staging and main integrations.
No page, retry, time or attempt policy limit was added. Focused regression
tests cover each change; sandbox acceptance below predates these final review
hardening checks and is not a new real-product acceptance.
The final review-hardened local check passed **716 tests**, with three optional
Docker skips (719 total), and the exact lockfile audit reported zero vulnerabilities.

Main-only movement during preparation can clean old trials and rebuild/retest the
same frozen ticket pool within the existing per-run budgets; source/receipt/actor
changes and movement after release execution begins still stop normally.
Automatic refresh covers the combined-candidate phase; if the earlier individual
Git rehearsal itself goes stale, a fresh filtered run still uses the same ticket.
Full local checks passed **711 tests**, with three optional Docker tests skipped.
Focused tests also cover strict source admission, changed heads/checks/reviews,
unselected ancestry, parent preservation, an unchanged-tree role's CI, safe
main-only re-preparation, budget/resume preservation, and resume after originals
enter main but before production E2E, including removal of the superseded waiting
reason when the release completes.

Sandbox production tickets **#56 (A)** and **#55 (B)** were submitted through the
normal CLI with verified `simo6529` receipts. Both pairs of source PRs started on
the same saved mains. Frontend test-main strict freshness was temporarily enabled
to exercise a genuine `BEHIND` gate, with its original check/app identity retained;
its original `strict: false` was restored and verified at 08:41 UTC. A's first invocation stopped
on a GitHub transport error before release execution. Its saved candidate parents,
owned branch, absent trial PR and unchanged mains were read back before the
same-run resume. A completed every staging/production deployment and matching E2E
at 07:18 UTC; both original PRs were marked merged at their requested heads and
journal revision 4525 has no lock. At that point B retained its original heads,
with frontend genuinely `BEHIND`. The live test exposed GitHub retaining an old PR base
commit: the audit now pins live main separately and strict direct-merge checks
compare against that current main. B's first filtered run also exposed rehearsal
requiring an old PR base to equal current main; it stopped before CI/deployment
and released its lock. Rehearsal now binds the same branch while independently
pinning live main; old CI still cannot prove the new combination. An actual-Git
regression test passed, and the same-ticket retry started at 07:29 UTC. B passed
fresh candidate CI/services, staging deployment/E2E and production integrations
without modifying its original heads. Another transport interruption after both
originals entered main was independently inspected before same-run resume. The
resume preserved scope and completed production deployment/E2E without repeating
finished integrations. B exited 0 at 08:38 UTC. Both tickets are closed completed,
all four originals are marked merged, and journal revision 4657 has no lock with
both completed archives checksum-verified. A superseded interim reason on B's
completed presentation was fixed with a regression test. The ordinary guarded
writer appended one repair decision for #55 only, preserving completed release
evidence and its archive checksum; revision 4661 again has no lock. Final local
checks passed 711 tests with three optional Docker skips. Details belong in the
[October 1 sandbox record](./testing/behind-main-history-2026-10-01.md).
Sandbox acceptance is separate from Coordinator PR checks and remote delivery.
This source change does not publish an npm package or authorize or prove a
real-product release.

Real [Issue #275](https://github.com/6529-Collections/6529-release-coordinator/issues/275)
passed exact frontend PR rehearsal and all 20 temporary candidate checks, then
stopped before any release merge or deployment because frontend staging added
`NEXT_PUBLIC_FEATURE_MULTI_COMPETITION: "true"` to its deployment workflow.
Coordinator [PR #277](https://github.com/6529-Collections/6529-release-coordinator/pull/277)
merged the refresh at `1337a0ab156a80884b4fa7bdec1239f8dd29983a`. It approves
that exact staging blob independently while retaining
the existing `main` blob. It leaves product code and workflow steps unchanged;
runtime verification remains mandatory. Full local checks passed 665 tests with
three optional Docker skips. The separate required npm audit passed after updating
ESLint's development-only `brace-expansion` lock entry to patched `5.0.12`.
Required GitHub checks and the main reviews passed; the user explicitly accepted
the unavailable optional GLM advisory review. The updated `main` checkout passed
the full local check again. The original filtered run resumed at 09:00 UTC on
September 30 and retained only #275 / `simo6529`. After waiting for existing
frontend deployment/test workflows, it merged staging integration PR #4133 at
09:30 UTC. Staging deployment 36696554520 and its matching E2E 36697661172
passed and were accepted. Production integration PR #4134 passed all 20 checks,
then paused on an unresolved reviewer thread about keyboard expansion inside
clickable quoted posts. The process exited at 10:03 UTC; journal revision 428
retains `awaiting-review`, the same PR/branch and the #275-only lock. Production
is unchanged, with no production deployment or E2E started. Resolve the linked
PR's review blocker before resuming the saved run; do not start a new run or
manually clear its lock. This is not a completed production release. Tests, remote delivery and the
authorized same-run resume are separate evidence; see the
[September 30 run record](./testing/real-production-ticket-275-2026-09-30.md).
Source PR #4120 subsequently received its tested keyboard fix at `bc220ad0f6c0`.
At 10:57 UTC, the user-authorized `--review-stop` command resumed only the old
Issue #275 run. Other developers have advanced frontend `main` and both staging refs;
those changes must be preserved. Receipt verification passed, but the stop
invocation exited 2 at 11:05 UTC: its pre-production staging guard also prevents closing the
still-unmerged owned PR after external staging drift. Journal revision 430 saves
the stop choice and retains the lane with unfinished `running` state; the process
is stopped, PR #4134 remains open, and no product merge/deploy/restoration occurred.
No replacement request or release has started.
The user then authorized a separate `--cancel-keep-current` cleanup choice.
Local source now implements it for a confirmed no-database-change attempt at
its owned unmerged integration PR, or an interrupted review stop, with no other
production operation or recovery. It records durable cancellation intent,
verifies and closes only the owned PR, removes its exact temporary branch,
preserves current shared code and closes selected tickets as cancelled, not
released. Interrupted cleanup retains the lock and can only resume cancellation.
The full local check passed with 681 tests and three optional Docker skips;
both-profile cancellation simulations and a read-only simulation using #275's
actual saved journal passed. The approved real filtered cancellation then
finished at 12:01 UTC with exit 0: PR #4134 closed unmerged, its exact owned
temporary branch was removed, and #275 closed as `not_planned` with
`reason:release-cancelled`. Independent readback of journal revision 438,
commit `21c5df35bb4007e97ae33cef8e66d5236c27a4c1`, confirms `cancelled`, verified
ticket presentation and no lock. The cancellation's before/after refs and the
independent readback match; no shared staging/main code was altered, restored,
merged or deployed by cancellation. The owned integration commit remains
readable, and source PR #4120 stays open at its fixed `bc220ad0f6c0` head.
The real cancelled record remains in the working journal, inactive and complete.
After that run, local history handling was extended so verified cancellations
archive normally at a later ordinary closeout; this addition has offline proof,
not live archive acceptance yet. No replacement request or fresh release has
started. The implementation, tests and evidence are in
[PR #282](https://github.com/6529-Collections/6529-release-coordinator/pull/282),
with remote delivery tracked by that PR; no package publication is claimed.
Review follow-up adds an explicit missing-operation
guard, structured `release-state` errors for corrupt cancellation journals,
and focused tests for incomplete cleanup, partial refs, missing cancellation
fields, late-merge state, non-selected terminal ticket preservation,
post-cleanup observation failure/resume, missing saved execution, and preservation
of cancelled (but not unfinished) evidence if the old batch later becomes stale.
CodeRabbit's later branch-deletion race finding is addressed with an explicit
saved-SHA Git lease and no unconditional REST fallback. Real Git tests prove
that an intervening push survives deletion refusal; both profile adapters also
retain cleanup ownership in that race. This new transport has offline proof only,
not acceptance from the earlier live cancellation's source hashes.
The independent closed-PR readback remains mandatory before branch deletion.
Full local checks passed 694 tests with three optional Docker skips, and the
locked dependency audit reported no vulnerabilities.
These follow-up additions are offline-only; they were not used in the real cleanup.
After the Coordinator change is merged, use a fresh ticket
and new matching evidence for the fixed frontend version.
The September 29 observations below predate merged Coordinator PR #270 and
Issue #266's manually delivered disposition; their original run state is historical.

## September 29 observations

The local `codex/review-pause` branch adds an explicit `awaiting-review` state
when an exact integration PR has green required checks but GitHub still blocks
its merge. It keeps that PR, its branch, and the journal lock; normal resume
rechecks the same PR, while `--review-stop` closes the verified owned PR and
uses existing recovery rules. Focused pause/retry/stop tests and the full local
`npm run check` passed (662 passing tests, three optional Docker skips). The
stop choice is saved before cleanup, so an interrupted stop cannot become a
merge on ordinary resume; that post-acceptance hardening has offline tests
only. This
is local implementation, not a merged Coordinator PR or real-product proof.
The [September 29 sandbox pause/resume record](./testing/review-pause-2026-09-29.md)
shows a verified ticket pause on an unresolved review thread, retained lock and
open PR, a still-blocked resume, and a second resume that merged the same PR
after resolution. Fake production deploy and matching E2E passed; ticket #54
closed as completed and the sandbox lock was released. The explicit stop path
has offline tests only. This remains unmerged local Coordinator source and
does not prove the behavior on real product repositories.
Real [Issue #266](https://github.com/6529-Collections/6529-release-coordinator/issues/266)
passed exact frontend PR rehearsal and the temporary combined PR checks, then
stopped before release authorization because the pinned backend `deploy.yml`
blobs no longer matched `1a-staging` and `main`. The original journal run lock
remains held; no staging or production release step started. This source updates
the two independently reviewed backend workflow pins without changing product
repositories. Offline checks, PR delivery, and a guarded resume are separate
evidence; see the [dated run record](./testing/real-production-ticket-266-2026-09-29.md).
Real [Issue #253](https://github.com/6529-Collections/6529-release-coordinator/issues/253)
stopped after a successful frontend staging deploy and GitHub staging E2E
because backend staging moved before the Coordinator could accept the E2E.
On September 29, the exact saved run, successful workflow results, local
`release-stale` event, current refs, and public receipt were checked. The
Coordinator journal now records a `needs-human` manual stop, distinguishes the
successful E2E workflow from its stale release acceptance, and has no saved
production operation. The same Issue has `reason:release-stopped`; its original
run lock was released at journal revision 307, commit
`bceb24464a986d58e9d86d0967109faa4f130cfa`. No retest, restoration,
product merge, or deployment was performed by this correction. The
[sandbox acceptance](./testing/staging-drift-2026-09-28.md) and this journal
correction do not establish that the external backend database and
compatibility effects are safe for a new release.
The older evidence below includes the real production release attempt
that failed for open Issue #250 and its verified staging restoration. The
tree-identical staging deploy correction is merged and passed a real-profile
resume; production did not merge or deploy. The earlier completed real staging
ticket #239 is below.
Frontend, backend, package and sandbox observations below retain their recorded
dates unless a newer check is stated. This page separates local implementation,
PR/CI delivery and live environment proof.

Coordinator [PR #256](https://github.com/6529-Collections/6529-release-coordinator/pull/256)
records both branch pairs, projects a named
waiting reason while keeping the run lock, and offers a guarded resume choice:
fresh frontend staging deploy/E2E against the new backend, or restore only
the Coordinator's frontend staging change and verify the result. It refuses
automatic action for database-changing, mixed/backend-owned, or newly moved
refs. It also checks staging again just before the first production action;
the sandbox test found that staging can move after E2E passes. The
product-shaped sandbox report supports a frontend-only selected
deployment without inventing a Coordinator-owned backend deployment. Focused
offline simulations and the [September 28 sandbox run](./testing/staging-drift-2026-09-28.md)
cover the fresh retest, late-drift stop, and frontend-only restoration. The
change merged at `88ddbd7d0a27f63ab2054277cdcacc8fbd0c946f` after green
GitHub checks and current-head review. Its automatic retest/restore choices
were not used for #253 because both staging refs moved beyond the saved
versions. The September 29 local `npm run check` passed 654 tests with three
optional Docker skips for the narrow manual-stop correction; that local result
does not establish merged source or a completed real release.

The first frontend-only sandbox acceptance ticket
[#51](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/51)
passed intake and exact PR rehearsal but stopped before any staging or production
mutation: the older sandbox service stage required both sample repositories.
The follow-up treats a frontend-only sandbox batch like the real
frontend-only scope: exact combined PR checks, no invented backend service or
database execution, then the product-shaped frontend deploy/E2E path. Offline
tests and the full check passed before live acceptance. Sandbox tickets
[#52](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/52)
and [#53](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/53)
then passed the retest and restoration paths respectively; details and the
temporary GitHub journal HTTP 422 are in the
[acceptance record](./testing/staging-drift-2026-09-28.md).

## Current state

| Area                                | What is available                                                                                                                                                                                                                                   | Evidence boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request submission                  | Public npm CLI `0.0.5` with schema `0.000002`; old `0.000001` requests remain readable                                                                                                                                                              | Published from protected Coordinator `main` with provenance, then pinned and merged in frontend and backend; see [September 15 evidence](#cli-005-publication-and-consumer-adoption-september-15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Operational monitoring intake       | Monitoring requests can enter the shared sandbox/real release sequence without pretending monitoring is an application service.                                                                                                                     | PR #218 merged the real workflow pin but its dispatch contract was incompatible with the product backend. Merged Coordinator [PR #219](https://github.com/6529-Collections/6529-release-coordinator/pull/219) fixed it; offline and GitHub checks passed. The corrected sandbox success path and both failure/recovery paths passed [September 23 acceptance](./testing/monitoring-branch-contract-2026-09-23.md). No real monitoring deployment has run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Ticket workflow                     | One manual `inbox:run` command reads requests, checks exact PRs and updates the same tickets                                                                                                                                                        | Unified workflow and subsequent sandbox work are merged; [command guide](../apps/coordinator/README.md#run-the-ticket-workflow).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Guarded inbox selection             | `RELEASE_COORDINATOR_SCOPE=filtered` exposes only repeated `--issue` values whose verified submitter matches `--actor`; `inbox` exposes the full selected-profile inbox. The resulting visible set then uses the normal Coordinator policy.         | Implemented in [PR #218](https://github.com/6529-Collections/6529-release-coordinator/pull/218) with multi-ticket, actor-mismatch, database-isolation, CLI validation and resume coverage. The v7 journal saves the canonical filter so resume cannot widen it. The [September 22 sandbox acceptance](./testing/profile-scope-sandbox-2026-09-22.md) proved one-ticket selection, a three-ticket visible set whose database-changing member was deferred from the two-ticket batch, the database ticket alone, and explicit same-run resume. PR #218 is merged. Filtered real runs for Issues #230 and #231 selected only their named tickets; both stopped before product branches or workflows changed. See the September 24 sizing record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Sandbox service/database checks     | One-ticket checks run sample services and temporary MySQL in GitHub Actions                                                                                                                                                                         | Local and live acceptance passed; see [source delivery](#sandbox-source-delivery-september-10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Sandbox batching                    | Runs filter cheap blockers before combined PR/service checks, keep tickets whole and record exclusions                                                                                                                                              | Complete-inbox and guarded Issue/actor scope feed the same normal batch policy. Compatible, repeated and incompatible groups have [September 10 evidence](./testing/batch-2026-09-10.md). A fresh [September 15 v3 run](./testing/batch-v3-2026-09-15.md) proved A+B failing while A and B pass alone, selected A, completed fake staging and matching E2E, and waited through long GitHub queues without an elapsed-time cutoff. The exact earlier v2 policy found in the live journal is now readable. At the time of that run, this fix existed only on the working branch; it is now merged through PR #149.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Run logs                            | Live step updates and private local logs, including explicit resume                                                                                                                                                                                 | Local tests and [live logging acceptance](./testing/run-logging-2026-09-11.md) passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| v6 history                          | Finished batch/service/release records archive in the same journal branch; active work and original attempts remain available                                                                                                                       | v5 storage merged in [PR #66](https://github.com/6529-Collections/6529-release-coordinator/pull/66). PR #72 merged the v6 writer with exact sandbox release operations; [live staging-to-production acceptance passed](./testing/release-sequence-2026-09-11.md). The real inbox was not migrated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PR reviews/security                 | Fixed bot reviews, CodeRabbit drafts, CodeQL and a complete lockfile audit configured                                                                                                                                                               | PR #178's final head passed Node 20/22/24, package, CodeQL and Snyk checks. The exact-head 6529bot general, security, deployment/Actions and follow-up lanes completed without required changes; the advisory GLM lane ran on every head, and no review thread was opened. Required merge rules remain active. Snyk's six-library workspace limitation remains below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sandbox release sequence            | One selected no-database-change batch moves through PR-based test staging with a Coordinator-gated check, locked builds and artifacts, matching built-output E2E, then protected test `main` for production requests                                | [PR #149](https://github.com/6529-Collections/6529-release-coordinator/pull/149) is merged into `main` at `2b6cc35`. The successful 14-operation path passed live before source review; see [September 15 acceptance](./testing/github-build-e2e-2026-09-15.md). Review fixes were republished through protected PRs and checked on both sandbox branches. [September 16 failure acceptance](./testing/staging-e2e-failure-2026-09-16.md) then proved a real staging E2E failure stops before production, records the failure, and cleans owned branches. No real repository is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Sandbox staging restoration         | Confirmed no-database-change staging failure creates checked undo PRs for exact changed test branches, then reruns ordered build checks and matching E2E                                                                                            | Merged through [PR #168](https://github.com/6529-Collections/6529-release-coordinator/pull/168). The [September 16 live test](./testing/staging-restoration-2026-09-16.md) passed protected restoration, ordered checks and restored E2E. A final source-ref/tree readback guard passed offline tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Solo sandbox database release       | One verified database-changing ticket can enter the fake release sequence alone after its temporary MySQL check; changed sample data is checked through the built-output E2E, and a failed release stops for a person without restoration           | Merged through [PR #168](https://github.com/6529-Collections/6529-release-coordinator/pull/168). The corrected runtime was published to both protected test-repository branches. [September 16 live acceptance](./testing/solo-database-release-2026-09-16.md) passed the full 14-operation protected path and closed ticket #26; a prior failed check left ticket #24 open and required manual staging repair. Multi-ticket database batches remain unsupported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sandbox fake-production restoration | After a confirmed no-database-change production failure, restore affected test `main` and staging branches with Coordinator-checked staging undo PRs and protected main undo PRs, then rerun their normal builds and E2E; keep the original failure | Merged through [PR #172](https://github.com/6529-Collections/6529-release-coordinator/pull/172); see [delivery](#pr-172-delivery-september-17). The [September 16 controlled live test](./testing/fake-production-restoration-2026-09-16.md) passed production and staging restoration, matching builds/E2E, final ref/tree readback, and ticket projection from the then-uncommitted implementation. Offline recovery, resume, moved-ref and adapter tests pass. Review hardening also checks both environment refs before each workflow dispatch and before accepting its result; that guard has offline proof only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Sandbox monitoring deployment       | A production ticket selecting `operational_deployments: ["monitoring"]` runs staging monitoring from test `1a-staging` before staging applications, then production monitoring from test `main` before production applications.                     | The earlier both-from-main behavior passed [September 17 acceptance](./testing/sandbox-monitoring-2026-09-17.md). Test runtime updates merged through backend PRs #139/#140 and frontend PRs #127/#128. The corrected 16-operation success path and both controlled monitoring-failure restorations passed [September 23 acceptance](./testing/monitoring-branch-contract-2026-09-23.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Waiting for other workflow runs     | Before each shared-branch merge and each workflow dispatch, the sandbox adapter waits without a time limit until the pinned release workflow has no active run in the target repository, logs each check and saves the blocking runs                | Merged through [PR #181](https://github.com/6529-Collections/6529-release-coordinator/pull/181) with offline coverage for the dispatch and merge paths, every active status, interruption, resume and state validation; see the [acceptance case](./merge-rehearsal-testing.md#release-sequence-acceptance). The pinned sandbox workflow holds one lock per environment, republished through [PR #182](https://github.com/6529-Collections/6529-release-coordinator/pull/182) to both test repositories' `main` and `1a-staging` (backend [PR #94](https://github.com/6529-Collections/release-coordinator-test-backend/pull/94), frontend [PR #86](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/86)). The [September 18 live acceptance](./testing/sandbox-inflight-wait-2026-09-18.md) found that GitHub's status-filtered run listing lags and can report a false quiet. The correction, reading the newest unfiltered page as well, is delivered together with that record rather than by PR #181; run from that corrected source, the resumed run waited 27 minutes before its first dispatch, stopped cleanly on Ctrl-C during a wait, resumed and dispatched once, waited before a frontend merge, and completed all fourteen operations for ticket #34. |
| Frontend production source guard    | The real `Web Deploy - PROD` workflow accepts an optional `expected_source_sha` and refuses before building when it does not match the `main` commit fixed for the run                                                                              | Frontend [PR #4072](https://github.com/6529-Collections/6529seize-frontend/pull/4072) merged at `7471ac1`; the exact [workflow source](https://github.com/6529-Collections/6529seize-frontend/blob/7471ac113cb2535940b19f036bf38f47f4d44eb6/.github/workflows/build-upload-deploy-prod.yml) was read back from frontend `main`. Manual dispatches may still omit the input under existing human authorization. The PR #218 adapter always supplies the exact approved frontend commit, verifies the pinned workflow source and matching run, and never uses the empty compatibility path. That enforcement has offline coverage only; it has not dispatched the real workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Product-shaped test workflow mirror | Merged test workflows build sample code and publish fake deployment evidence while mirroring the existing product workflow interfaces, including branch-aligned monitoring and linked deploy-to-E2E runs.                                           | Original mirror: frontend PR #92 and backend PR #100, with [September 21 acceptance](./testing/product-shaped-workflow-mirror-2026-09-21.md). Branch-contract correction: backend PRs #139/#140 and frontend PRs #127/#128, with [September 23 success and recovery acceptance](./testing/monitoring-branch-contract-2026-09-23.md). These are test repositories only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Product-workflow sandbox adapter    | Sandbox release operations use the separate product-shaped backend, monitoring, frontend and E2E workflow mirrors by default; the generic `sandbox-release.yml` client remains an explicit fallback                                                 | The [adapter-selection implementation](../apps/coordinator/src/sandbox-release-client.mjs), including the explicit `RELEASE_COORDINATOR_SANDBOX_RELEASE_ADAPTER=generic` fallback, ships in the same change as this status row. Offline contract and recovery suites cover branch sources, exact runs/artifacts, operation persistence, failures and recovery. The independent [success-path acceptance](./testing/adapter-success-path-2026-09-21.md) completed staging and production, and the independent [controlled-recovery acceptance](./testing/adapter-recovery-2026-09-21.md) stopped on monitoring failure, restored production then staging, reran matching deploys/E2E, and resumed the same journal without duplicate dispatch. The [September 22 profile/scope acceptance](./testing/profile-scope-sandbox-2026-09-22.md) additionally passed fresh one-ticket, two-ticket, solo-database and staging-E2E-failure recovery cases; it exposed and fixed causal-time and running-wrapper reconciliation gaps before same-run recovery completed. All used only test repositories. Delivered to protected Coordinator `main` in PR #218.                                                                                                                                          |
| Real-profile release adapter        | PR #218 selects product repositories under `RELEASE_COORDINATOR_PROFILE=real` and uses the shared release engine with existing product workflows.                                                                                                   | Filtered staging Issue #239 completed with exact deploy/E2E; see [September 25 acceptance](./testing/real-staging-ticket-239-2026-09-25.md). Production-target Issue #247 stopped before rehearsal; see [its record](./testing/real-production-ticket-247-2026-09-25.md). Issue #250 proved the tree-identical staging manual-dispatch fallback and verified no-database-change staging restoration after a production integration gate failure; see [September 26 record](./testing/real-production-ticket-250-2026-09-26.md). No production merge or deployment occurred. Successful production, backend services, monitoring and database-changing releases remain unproved in real products. Database-changing failures never enter automatic recovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Real production ticket #250 — September 26

[Issue #250](https://github.com/6529-Collections/6529-release-coordinator/issues/250)
selected only frontend [PR #4093](https://github.com/6529-Collections/6529seize-frontend/pull/4093)
at its exact head, with actor `simo6529` and no database change. The trial
checks passed, and staging integration PR #4105 merged with an unchanged tree.
Coordinator [PR #251](https://github.com/6529-Collections/6529-release-coordinator/pull/251)
merged the manual-dispatch fallback; the same saved run then passed exact
staging deploy and matching E2E. Production integration
[PR #4106](https://github.com/6529-Collections/6529seize-frontend/pull/4106)
stopped at an unresolved code-review thread despite green CI, and closed
unmerged. The Coordinator restored staging through
[PR #4107](https://github.com/6529-Collections/6529seize-frontend/pull/4107),
verified its deploy/E2E and both environment trees, marked #250 `action-needed`,
and released its lock. Production `main` never moved or deployed. The
[dated record](./testing/real-production-ticket-250-2026-09-26.md) has the run
IDs and next source-code action. Do not retry failed #250 unchanged.

### Real frontend rehearsal sizing — September 24

The first filtered real staging run for Issue #230 stopped before batch or
deployment when frontend `main` moved and PR #4093 became `BEHIND`. The second
run used the replacement Issue #231 and verified its exact PR commit, green
required checks, and approval-only bypass eligibility. It then stopped before
batch or deployment because the temporary Git repository crossed the
Coordinator's existing 128 MiB byte guard. Both runs released their journal
locks and changed no product branch or environment.

The [sizing investigation](./testing/real-rehearsal-size-2026-09-24.md)
reproduced the byte-limit trigger at 135,629,887 bytes with 28 entries. A
blob-free partial fetch of the exact product commits used about 17.3 MB and
produced the same clean merge tree, with on-demand file reads. PR #232 merged
this transport fix and its storage/authentication regressions after green CI.
The filtered retry of Issue #231 (run `ebfa6356-2815-4215-a967-bf28e261def7`)
still stopped at the 128 MiB guard: the inbox-ticket caller had selected the
default sandbox/full-fetch mode instead of passing its real profile to the
transport. The run recorded `rehearsal:unknown`, verified cleanup, released the
journal lock, and started no combined checks or product release operations.
The [ticket-mode investigation](./testing/real-ticket-rehearsal-mode-2026-09-24.md)
records that result. PR #233 merged the routing correction. The next filtered
retry (run `9efb8684-5f92-4f02-8fe6-cf62e624e1c2`) passed real Git rehearsal,
cleanup, and combined Git filtering. It opened owned frontend trial PR #4097,
then stopped before release because the trial-check reader did not recognize
GitHub's required Snyk status-context field and queried before every required
job appeared. PR #235 merged the check-reader correction after local and GitHub
checks. An inspected resume of the same run then read all five required checks:
four passed and DCO failed because the Coordinator-created trial commit lacked
a sign-off. The Coordinator recorded `batch:waiting`, closed its owned trial
PR #4097, verified removal of its branch, updated Issue #231, and released the
journal lock. The [trial-check investigation](./testing/real-trial-checks-2026-09-24.md)
records the evidence. At that point no real integration PR, deploy, E2E, or
rollback had occurred. Simo then authorized his own GitHub no-reply DCO identity for commits
the Coordinator creates in product repositories while it is authenticated as
`@simo6529`. Merged PR #237 signs temporary trial and
integration/restoration commits, checks the current GitHub account before
writing them, and leaves source commits, journal commits, sandbox identity and
DCO rules unchanged. Offline checks passed (625 of 628 tests; three Docker-only
skips), and the exact PR head passed GitHub CI and review. The source frontend
PR #4093 was then updated to `c0768baa` against current `main`; all its checks
passed. Its old-commit Issue #231 was closed as outdated by a filtered run,
without release execution. The frontend submitter created replacement staging
Issue #239 for the new exact head. Its filtered real run passed Git rehearsal,
combined Git filtering and the owned temporary PR #4098's required checks,
including **real DCO** on the Coordinator-authored commit. The owned trial PR
and branch were removed. Before any product integration or staging deployment,
the Coordinator rejected drift in its pinned backend deploy workflow on both
environment branches and retained the run lock. Coordinator PR #240 refreshed
the independently checked pins after review and green CI. The same run resumed
with only Issue #239 visible, merged frontend staging PR #4100, passed the exact
staging deploy and matching E2E, closed Issue #239, and released its lock. See
the [real staging acceptance](./testing/real-staging-ticket-239-2026-09-25.md).
The earlier [DCO follow-up](./testing/product-dco-signoff-2026-09-25.md)
records the pre-retry state, not this completed result.

The [September 24 approval-bypass acceptance](./testing/approval-bypass-2026-09-24.md)
added PR-only review-bypass rules to both test `main` branches without removing
their required `Sandbox check`. The shared Coordinator code accepts a missing
approval only when the pinned ruleset says the acting account can bypass,
the exact PR/base and all required checks pass, and review threads and other
known gates are clear. A filtered sandbox production ticket (#50) completed
both unapproved protected-main integration merges, all fake deployments and
matching E2E; the journal recorded each bypass and released its lock. One
mid-run journal-lock interruption occurred after staging integration and before
the protected-main bypass merges; an inspected manual resume continued the
same run without re-merging completed staging PRs. This run did not exercise
rollback. PR #227 merged the shared code. This follow-up pins only the real
frontend's existing `main` bypass ruleset and required checks; the real
backend remains unpinned. That configuration did not execute a release. Real
protected-main bypass, production merge/deploy/E2E, and rollback remain
untested. See
the [read-only product-rule audit](./testing/real-frontend-approval-bypass-config-2026-09-24.md).

The [September 23 staging check alignment](./testing/staging-check-alignment-2026-09-23.md)
removed protection from only the two test `1a-staging` branches, matching the
real product staging setting. Local Coordinator code now gates the exact
staging PR on its configured reported checks without requiring GitHub to mark
them mandatory; product `main` and test `main` still require GitHub-enforced
checks. GitHub readback confirms optional `Sandbox check` on both test staging
PRs and retained required checks on both test `main` branches. All offline
checks pass. A fresh filtered end-to-end sandbox staging release completed
[Issue #45](./testing/staging-check-alignment-2026-09-23.md#fresh-live-sandbox-staging-acceptance):
both integration PRs passed `Sandbox check` while GitHub reported it optional,
backend and frontend staging deployments passed, matching staging E2E passed,
and the journal lock was released. Real frontend staging now has separate
acceptance through Issue #239; real failure/recovery under these settings remains
unproved. The table's earlier protected
staging acceptance links describe the prior rules, not this new setting.

The manual command runs once and exits. Profile selection chooses repositories,
staging and main check gates, workflow pins and evidence rules; it does not copy a second
Coordinator engine. Sandbox completion remains evidence only for the pinned test
repositories. The real profile must collect fresh product evidence.

A ticket is one request and stays whole, even when it contains both frontend and
backend PRs. A filtered run exposes one or more Issues from one verified actor;
complete-inbox scope exposes all available tickets. Either scope can combine
several independent visible tickets into one tested batch after removing tickets
with cheap, clear blockers. Merged PR #218 implements that policy for
both profiles. The sandbox version has multi-ticket acceptance; the real version
has one frontend-only staging acceptance and has not yet exercised multi-ticket
batching on product repositories.

After the PR #218 review fixes, `npm run check` passed locally on September 23:
604 tests ran, 601 passed and the three explicitly Docker-only cases were
skipped. Lint, formatting, documentation, workflow policy and package checks
also passed. GitHub CI and live product acceptance are separate evidence.

## Next steps

Complete CI and review for the Issue #266 backend runtime-pin update, merge it,
then verify the old process is stopped, the same run still owns the journal
lock, and the exact product refs/runtime files are current before resuming
run `5375bc43-986c-418c-8a3c-bc64713e313f`. This is not a new ticket or
a new run. No production outcome is proved by the passing temporary PR checks.

Inspect Issue #253's external backend deployments and possible
database/compatibility effects. Its run is recorded as a `needs-human` manual
stop and its lock is released; do not rerun the one-time correction. Prepare a
fresh exact request if the source PR still needs release. No production merge
or deployment by Issue #253 is proved. Backend-service, monitoring,
database-changing, multi-ticket and other failure/recovery paths still need
separate, scoped real acceptance.

Merged Coordinator [PR #219](https://github.com/6529-Collections/6529-release-coordinator/pull/219)
dispatches staging monitoring from `1a-staging` and production monitoring from `main`,
sends only the existing `environment` input, checks the intended branch commit
before dispatch, and verifies the resulting run's branch/commit afterward.
Local `npm run check` passed on its latest code head: 608 tests passed, three
optional Docker tests skipped, plus lint, formatting, documentation, workflow
policy and package checks. GitHub Node 20/22/24, package, CodeQL and Snyk
checks passed; 6529bot found no blocking issue. PR #219 merged into protected
`main` at `9996fdd`.
The Docker-backed `Sandbox check` passed on test-backend
[PR #139](https://github.com/6529-Collections/release-coordinator-test-backend/pull/139)
and test-frontend
[PR #127](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/127).
Both merged into test `main`; backend [#140](https://github.com/6529-Collections/release-coordinator-test-backend/pull/140)
and frontend [#128](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/128)
published that history to test `1a-staging`. The
[fresh sandbox acceptance](./testing/monitoring-branch-contract-2026-09-23.md)
completed all sixteen success operations on Issue #46, including staging and
production monitoring from the correct branches at exact merged commits and
matching E2E. Issue #47 intentionally failed staging monitoring and restored
the saved staging tree. Issue #48 intentionally failed production monitoring
and restored the saved production and staging trees, but exposed an early
automatic frontend E2E that could not prove the final restored combination.
PR #219 now dispatches a fresh frontend staging deploy after backend recovery
and checks that E2E's causal time. Fresh Issue #49 repeated the controlled
production failure, passed restored production checks, then proved the new
frontend deploy and linked E2E occurred after restored backend API completed.
All affected test branch trees match their saved pre-test trees, failed tickets
retain `action-needed`, and the journal lock was released. GitHub job records
lagged completed workflow runs by minutes during this retest; the adapter now
waits for the exact job set without redispatching.
In that sandbox retest, the real backend workflow was unchanged and no
real-product release occurred.

The September 23 [accepted branch-tip risk](./design.md#operational-monitoring)
remains: a branch move between the pre-dispatch check and GitHub's dispatch can
still deploy a different commit. The local adapter detects a mismatching run
and stops rather than reporting success; it cannot prevent that deployment.
If two same-actor monitoring runs appear after dispatch, it also stops rather
than guessing which one belongs to the release when GitHub supplies no direct
run ID. PR #219 now requests that direct ID and verifies the exact returned run;
the old ambiguous-run stop remains for empty dispatch responses. This API
opt-in has offline tests plus a direct test-backend
[API probe](./testing/monitoring-branch-contract-2026-09-23.md#direct-dispatch-id-api-probe)
returning HTTP 200 and a passing exact run. The dated full Coordinator sandbox
release preceded the opt-in; a direct probe does not promote it into
real-product proof.

PRs #218 and #219 are merged. Their original next step was a deliberately
filtered real acceptance, starting with a small no-database-change staging
ticket before attempting production. That plan is historical: staging ticket
#239 completed, and later production-target attempts are recorded above. The
current #266 locked-run recovery step is at the top of this page. Keep each
live result separate from offline checks and trial-PR evidence.

Package publication and product adoption are complete. The GitHub-only sandbox
build/E2E stage, staging restoration, solo database-changing release and
fake-production restoration are merged into `main`; their dated live results are
linked above, as is sample operational-monitoring deployment in the sandbox
release sequence with its live acceptance. The branch-aligned monitoring
correction is merged through Coordinator PR #219. The environment-ref guard
around workflow dispatch from PR #172 was
exercised live by every September 17 monitoring operation.
The wait for other active workflow runs before each merge and dispatch is
merged (PR #181) with the per-environment sandbox lock that models the real
deploy locks (PR #182); the two-source quiet check that the live acceptance
required is delivered with the acceptance record. The current real adapter
applies the same two-source wait to the real workflow groups and does not rely on
GitHub's status-filtered run listing alone. That path still needs live acceptance.
The frontend production workflow's exact-source guard is now merged through
frontend PR #4072. The current real frontend adapter passes the exact verified
`main` commit as `expected_source_sha`; ordinary authorized manual dispatches
remain backward compatible when the input is empty.
The product-shaped test workflows are merged through frontend test PR #92 and
backend test PR #100, and their protected staging/production success path has
[live acceptance](./testing/product-shaped-workflow-mirror-2026-09-21.md). The
separate-workflow sandbox adapter now satisfies the
[retirement gate](./merge-rehearsal-testing.md#separate-workflow-adapter-retirement-gate):
the dated success and recovery records are linked in the current-state table,
and independent contract/recovery suites cover the branch-source distinction.
The sandbox default is therefore the product-shaped adapter. The old generic
adapter remains available only as the explicit
`RELEASE_COORDINATOR_SANDBOX_RELEASE_ADAPTER=generic` fallback. The canonical
evidence patterns remain `adapter-success-path-YYYY-MM-DD.md` and
`adapter-recovery-YYYY-MM-DD.md`; repository checks enforce their location and
links.
The product execution adapter is merged through PR #218 with offline tests. A
deliberately filtered live acceptance is still needed before treating its
merge, deployment, monitoring, E2E or recovery results as proven in product
environments. AWS-side monitoring target health is not independently verified
by this adapter.
Database-changing multi-ticket batches, linked tickets, heartbeat/takeover and
parallel releases remain later work.

The controlled September 16 test left ticket #22 open with
`reason:release-failed`, the journal unlocked, and both test `main` refs unchanged.
The failed candidate reached test staging before E2E failed. Protected manual
revert PRs restored both staging file trees to match test `main`; this does not
implement automatic rollback or turn the failed release into a success. See the
[failure acceptance record](./testing/staging-e2e-failure-2026-09-16.md).

## Frontend production exact-source guard, September 21

Frontend [PR #4072](https://github.com/6529-Collections/6529seize-frontend/pull/4072)
merged at `7471ac113cb2535940b19f036bf38f47f4d44eb6` (final head
`c6df6d0f493104f4878f97039bb315ac846205f2`). Readback of the exact
[`Web Deploy - PROD` workflow](https://github.com/6529-Collections/6529seize-frontend/blob/7471ac113cb2535940b19f036bf38f47f4d44eb6/.github/workflows/build-upload-deploy-prod.yml)
from frontend `main` confirmed the optional `expected_source_sha`, its full
lowercase commit check, the equality check against GitHub's fixed `github.sha`,
and the dependency that stops the production build when the guard fails. Leaving
the input empty keeps ordinary production dispatches compatible under the
repository's existing human authorization; it is not the Coordinator path.

Immediately before dispatch, the future Coordinator frontend production adapter
must first finish any conflicting-run wait, then make the final GitHub read of
frontend `main`, verify that it still represents the approved production
composition, and provide that exact commit. It must not reuse an earlier staging
read, and it must repeat the quiet check and final ref read before every dispatch.
Any mismatch ends the attempt. Save it as
[`status:action-needed`](./inbox-processing.md#status-labels) with
[`reason:release-failed`](./inbox-processing.md#reason-and-scope-labels), keep the
lane for a person, and require explicit
authorization plus fresh matching evidence for a new attempt; never reuse the
newer SHA. The guard stops before a build, so this state requires revalidation,
not an automatic source revert. This closes the check-to-dispatch source gap
inside the product workflow. It does not create the adapter, authorize a real
release, or prove that a deployment occurred.

## Product-shaped test workflow mirror, September 21

Frontend test [PR #92](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/92)
merged at `42a2a5f19710c8fa853d14d65f3c6803066714d8` and adds
`Web Deploy - STAGING`, `Web Deploy - PROD`, their automatic E2E dispatch
wrappers and their E2E workflows. Backend test
[PR #100](https://github.com/6529-Collections/release-coordinator-test-backend/pull/100)
merged at `75658981146704d71f7e0179526b8f3acf7a8f40` and adds
`Deploy a service` with the real service and specialist input set, plus
`Deploy operational monitoring`. The workflow names, dispatch fields, branch
entry rules, concurrency groups and deploy job names match the product-facing
contracts the future adapter needs. The E2E wrappers pass the exact successful
deploy run ID, and E2E independently reads that run and its canonical deploy job.

The implementation behind those interfaces remains fake. It builds the small
sample packages, records the exact source/workflow/run identity in a
`fake-deployment-evidence-v1` artifact, reads the artifact from the selected run,
and executes the built sample frontend. It has no AWS credentials, product URL,
product database, product monitoring account or product E2E suite. The production
daily canary schedule is intentionally excluded because it is not a Coordinator
dispatch or completion dependency. The old `sandbox-release.yml` is unchanged.

Both final heads passed their normal sandbox PR checks and follow-up reviews
reported no new findings. Local workflow parsing, exact dispatch-input
comparison against the current product workflows, sample builds and fake evidence
creation/readback also passed. The existing container-backed full sample test was
not available locally, but the same test passed in both PR checks.

Protected main-to-staging PRs [frontend #93](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/93)
and [backend #101](https://github.com/6529-Collections/release-coordinator-test-backend/pull/101)
then published the same merged histories to `1a-staging`. The
[September 21 live acceptance](./testing/product-shaped-workflow-mirror-2026-09-21.md)
passed staging frontend deploy -> automatic exact-run E2E, staging backend API,
monitoring staging and prod from backend `main`, production backend API, and
production frontend deploy -> automatic exact-run E2E. Independent artifact
readback matched every role, environment, source SHA, workflow path and run ID.
This proves the separate test interfaces' success path; no Coordinator code
consumes them yet, and adapter journal, stop and recovery behavior remains next.

## PR #181, #182 and #187 delivery, September 18

[PR #181](https://github.com/6529-Collections/6529-release-coordinator/pull/181)
merged at `2d7b2d2ea1e46162a8271cbdbb82463c7e1423ab` (final head
`8eb1bc1f08283ec7f0fd5586e79ae88bd058679a`),
[PR #182](https://github.com/6529-Collections/6529-release-coordinator/pull/182)
at `30b61ceb2d788511276499fe21489792f7753ba4` (final head
`79c09b01ce38f14ece8bdb4f368cdbc88edfbefb`) and
[PR #187](https://github.com/6529-Collections/6529-release-coordinator/pull/187)
at `dc6f85974f32e0e65288c9e70071423497563735` (final head
`206a74c4c41c5498ee60f6c36b6e965546fa93ea`). Each final head passed Node
20/22/24, package, both CodeQL jobs and Snyk. The 6529bot general lane asked
for changes on the first head of each PR and reported "good to merge" on every
final head; the security and deployment/Actions lanes found nothing on any
head, and the follow-up lanes found no new findings. CodeRabbit opened one
thread on PR #182 (hash the generated workflow template against its pin) and
three on PR #187 (save a rising lag indicator at once, separate merged
behaviour from the pending correction, reconcile the wait count); each was
fixed in a follow-up commit and resolved. Three general-lane suggestions were
declined with stated reasons: excluding the Coordinator's own run from the
active listing (the wait never runs while the step's own run exists), keying
the sandbox lock on a declared input (another runtime republish for no
Coordinator change), and paging the whole workflow history on every check
(hundreds of calls per hour, and a created-time horizon would be a new bound).

The merge commits' repository checks and CodeQL also passed:
[#181 checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35320419923)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35320420025),
[#182 checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35322727232)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35322727250),
[#187 checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35332796182)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35332796166).
A local `npm run check` on `dc6f859` passed all repository gates: 566 tests
ran, 563 passed and 3 were intentionally skipped; lint, formatting, workflow
policy and packed-package checks also passed.

This delivers the wait for other active workflow runs before each protected
merge and each workflow dispatch (no time limit, one logged line per check,
`waited_for` on the step record, an abortable sleep and resume that rechecks),
the per-environment sandbox release lock republished to both test repositories
with new workflow and build-helper pins and the offline pin-equals-source
tests, the two-source quiet check that the live acceptance required, the
fixture tool's wait case, and the
[September 18 acceptance record](./testing/sandbox-inflight-wait-2026-09-18.md).
The acceptance ran from the then-unmerged PR #187 branch and remains the
runtime acceptance for that sandbox change. PR #187 itself did not enable real
product releases; the current real adapter is the separate local work described
in the current-state table.

## PR #178 delivery, September 17

[PR #178](https://github.com/6529-Collections/6529-release-coordinator/pull/178)
merged at `3c01a5fec3bb14e8a916eec330388bdc90cb6c81`. Its tree matches the
reviewed final head `1e8b61ba53947d2f47597e0079ef13d5dfd41842`. The final PR
head passed Node 20/22/24, package, both CodeQL jobs and Snyk. The exact-head
6529bot general, security, deployment/Actions and follow-up lanes found no
required changes; the advisory GLM lane ran on all three heads. CodeRabbit
passed on the first head and posted no status or review on the final head; no
review thread was opened. The two follow-up commits took the general lane's
nice-to-haves (an explicit prod-stage assertion for monitoring steps, restored
monitoring operations validated in the failure test, an operational-only
evidence strip with a test, and a layout comment) and the advisory lane's asks
for explicit empty-list, missing-ref and failed-build coverage.

The merge commit's
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35224971371)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35224971350)
also passed. A local `npm run check` on `3c01a5f` passed all repository gates:
552 tests ran, 549 passed and 3 were intentionally skipped; lint, formatting,
workflow policy and packed-package checks also passed. This delivers the
`monitoring` release operation, batch policy v6, the sample monitoring runtime
and fixtures, the Git-workspace allowlist fix, and the documentation and dated
record to `main`. The
[September 17 live acceptance](./testing/sandbox-monitoring-2026-09-17.md) ran
from the then-unmerged branch and remains the runtime acceptance. This does not
enable real product releases, monitoring deployment or rollback.

## PR #172 delivery, September 17

[PR #172](https://github.com/6529-Collections/6529-release-coordinator/pull/172)
merged at `3fd1423a82e1030a652712a9fc1bb29203d8953f`. Its tree matches the
reviewed final head `9aa51ca738448d357152a26a5033db68390c6b2d`. The final PR
head passed Node 20/22/24, package, both CodeQL jobs, Snyk and CodeRabbit. The
exact-head 6529bot general, security, deployment/Actions and follow-up lanes found
no required changes; the advisory GLM lane last ran on the prior head `25621fd`.
The first head's general lane had required the journal blob fallback to reject
an unverifiable large file; `25621fd` delivered that fix with content-SHA
binding. No review thread was opened.

The merge commit's
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35190904892)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/35190904932)
also passed. A local `npm run check` on `3fd1423` passed all repository gates:
534 tests ran, 531 passed and 3 were intentionally skipped; lint, formatting,
workflow policy and packed-package checks also passed. This delivers
fake-production restoration, the pinned Git blob fallback for journal files
above 1 MiB, and the environment-ref guard around workflow dispatch and result
acceptance to `main`. The
[September 16 live test](./testing/fake-production-restoration-2026-09-16.md)
ran from the then-uncommitted implementation and remains the runtime acceptance;
the environment-ref guard has offline proof only. This does not enable real product
releases or rollback.

## GitHub-only build and E2E acceptance, September 15

Production-target sandbox ticket
[#21](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/21)
passed cheap filtering, exact combined PR checks, the temporary database/service
run, protected staging integration, locked builds and artifact uploads, matching
built-output staging E2E, protected test-`main` integration, another complete
build sequence and matching production E2E. All 14 release operations passed;
the ticket is completed, owned branches are absent, the batch is archived and
the journal lock is clear.

Acceptance exposed and fixed four narrow gaps before completion: independent
runtime commits had made staging and main histories diverge; old cancelled check
attempts could mask a successful retry; one commit could reuse checks across
different release PRs; and CodeRabbit's generated PR-body block was treated as
an ownership change. Release PRs now have their own commit IDs, the new
integration checkpoint is validated for recovery, and all fixes have focused
regressions. The latest local `npm run check` passed all repository gates:
503 tests ran, 500 passed and 3 were intentionally skipped; lint, formatting,
workflow policy and packed-package checks also passed. Full links, commit IDs,
artifact digests and boundary proof are in the
[dated acceptance record](./testing/github-build-e2e-2026-09-15.md).

Source review then tightened required-check retry identity, stopped incomplete
legacy release records for manual recovery, made build-file reads stable, and
made missing build evidence explicit. A final recovery guard requires every
active integration checkpoint to retain the exact prepared input and, once
created, its unique integration commit. It keeps old terminal history readable
but stops unfinished legacy work for a person. Required checks with no workflow
run identity also remain separate and blocking instead of being collapsed.
Focused review regressions cover incomplete run identities, tied retries,
partial integration proof, mismatched fixture bases and the intentional
100,000-byte sandbox file boundary. That size boundary does not apply to future
product builds.
The generated runtime changes passed
protected backend PRs [#47](https://github.com/6529-Collections/release-coordinator-test-backend/pull/47)
and [#49](https://github.com/6529-Collections/release-coordinator-test-backend/pull/49),
frontend PRs [#44](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/44)
and [#46](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/46),
then protected main-to-staging PRs
[#50](https://github.com/6529-Collections/release-coordinator-test-backend/pull/50)
and [#47](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/47).
Final readback found the same four pinned runtime blobs on `main` and
`1a-staging` in both repositories. This refresh proves reviewed runtime delivery;
the earlier 14-operation run remains the end-to-end acceptance.

## CLI 0.0.5 publication and consumer adoption, September 15

Protected workflow run
[`34848251003`](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34848251003)
published `@6529-collections/release-request@0.0.5` from Coordinator `main`
commit `502c429f617c0c31ea2aadb03f392a96d5be8a98`. Independent registry
readback matched the workflow's SHA-1, SHA-256 and SHA-512 values, the expected
11-file archive, and SLSA provenance for that repository, workflow and commit.

Frontend [PR #4023](https://github.com/6529-Collections/6529seize-frontend/pull/4023)
merged at `d3a438d0dff68b4583c71bb1431cf9ee7e5b4a6c`. Backend
[PR #2064](https://github.com/6529-Collections/6529seize-backend/pull/2064)
merged at `b397c745499891de98605d5fe87a0a7aa86129e3`. Both current
`main` manifests were read back with the exact `0.0.5` pin. Their refreshed PR
checks and reviews passed; the frontend's additional post-merge full Jest and
coverage run
[`34937545223`](https://github.com/6529-Collections/6529seize-frontend/actions/runs/34937545223)
also passed on its merge commit. These merges enable product repositories to
create the new request shape. They do not enable Coordinator execution against
real staging or production and do not prove a product deployment.

## PR #72 delivery, September 14

[PR #72](https://github.com/6529-Collections/6529-release-coordinator/pull/72)
merged at `ebb0edb54d90ed04e136a317f4be87d31302f631`. Its tree matches the
reviewed final head `2f9391a01f2c66de6c3770888f1e5b8e1325b5b5`. The final PR
head passed Node 20/22/24, package, both CodeQL jobs, Snyk and CodeRabbit. The
exact-head 6529bot general, security, deployment/Actions and follow-up lanes found
no required changes; the GLM lane was advisory. No review thread remained.

The merge commit's
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34846523680)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34846523747)
also passed. This delivers the sandbox release sequence, v6 release evidence,
recovery hardening and recording-only monitoring intake to `main`. It does not
publish CLI `0.0.5`, migrate the real inbox, or enable real product releases.

## Sandbox release sequence acceptance, September 11

The local branch installed a pinned sandbox release check workflow in both public
test repositories and protected each `1a-staging` branch with required `Sandbox
check`. That workflow only inspects the candidate. The authorized Coordinator run
still writes its journal and ticket, integrates through temporary sandbox branches
and PRs, and cleans those temporary resources. Production-target ticket
[#15](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/15)
then passed cheap filtering, exact combined PR checks, combined service checks,
protected backend/frontend staging integration, ordered staging checks, matching
staging E2E, protected backend/frontend test-`main` integration, ordered production
checks, and matching production E2E. The ticket is closed as completed and the
journal lock is clear.

Two live interruptions improved the implementation rather than weakening proof:
the first rejected a changed pinned check workflow before creating a trial PR;
the second exposed a delayed GitHub journal confirmation after the exact commit
had been saved. The latter now retries read-only confirmation and accepts only
the exact expected commit/state and lock token. A resume-projection bug was also fixed so a
completed release can finish its ticket without rerunning release operations.
Focused regressions cover both recovery cases. A final code review also added a
zero-write guard when sandbox staging moves after the release captures its start;
that failure path passed offline and was not needed by the stable live run. Full
links, commits and evidence are in the
[dated acceptance record](./testing/release-sequence-2026-09-11.md).

PR review hardening now uses one validated `production` to `staging, prod`
mapping, prevents stale batches from closing tickets, asserts that only an
unscoped run may adopt unfinished release work, and pins the workflow, contract,
and runner files at every exact fake environment commit. Focused regressions pass;
a read-only live identity check confirmed the three runtime blobs in both test
repositories and environment branches. Cleanup now requires two consecutive
missing-ref reads before an owned branch is recorded as removed, and an unchanged
release role requires its explicit saved base tree.

The September 14 review follow-up prevents an empty resumed batch from starting
a release, requires every completed release step to retain its exact operation
and report, rejects array-shaped saved versions, and turns a malformed saved run
scope into a controlled error. The lost-plan-response regression now proves that
the exact saved plan is reused. These changes do not alter the pinned sandbox
workflow bundle, so the earlier live sequence remains the runtime acceptance.

A second review pass makes failed integration cleanup resumable: the Coordinator
saves `cleaning` before closing the owned PR, then a retry verifies that exact
open or closed PR and completes branch cleanup. Terminal `needs-human` releases
are not adopted by later unscoped runs. Test reports now use the actual frontend
or backend runner identity, and the adapter test rejects mismatched frontend
provenance.

The final review guard also requires every step behind the saved release position
to contain a passing result. A merely present failed result cannot be projected
as completed release evidence. Workflow reports also require numeric GitHub run
and attempt IDs; string-shaped lookalikes are rejected. The v6 migration test now
covers both v4 and v5 saved runs, and ticket-summary regressions retain the exact
selected group and reject leftover execution on an empty batch.

The last recovery gap is also closed: an interrupted v1 batch reconciles and
cleans only already-started exact work under the trusted v1 policy. It starts no
new v1 trial; its evidence is preserved and its selection is retired as stale, so
it cannot enter the v2 release sequence. The reason guide now documents
target-deferred tickets, and the runner-path regression works from any current
directory.

The developer-only sandbox release provisioning helper now saves its exact
branch and commit before pushing, reconciles only that branch and one matching
open PR on retry, and stops on missing, changed, closed, ambiguous or unsaved
resources. Its Git operations have a 60-second timeout. Its local checkpoint uses
a unique, exclusively created temporary file before atomic replacement, so an
interrupted or simultaneous write cannot corrupt the prior checkpoint. This is
local setup hardening; the live sandbox was not reprovisioned.

The final resume guard preserves tickets that already reached `closed` or
`completed`. Reopening the same saved batch can still project results onto its
active tickets, but it cannot replace a terminal ticket's saved decision. The
focused release regression keeps both behaviors in one resumed-batch case. A
separate stale-batch guard stops release execution before identity or integration
work, even when malformed saved state still contains a selected candidate.
Workflow polling now saves a newly discovered run identity even when the operation
was already marked running. A merged integration also reconciles its owned branch
cleanup before any missing branch could be recreated after a lost final save, and
validates the saved merge commit identity before using it in a GitHub API path.
Repeated projection of the same resumed batch replaces its prior reason instead
of accumulating duplicate deferred or failed explanations.
If a later observation makes a batch stale, its validated terminal release
evidence remains readable while the stale guard still prevents any release resume.
Workflow-run recovery reads up to ten stable 100-run pages for the exact saved
operation, instead of becoming permanently stuck when the first page is full.

The final local `npm run check` passed **482 tests** on Node 25.6.1, with the
three explicitly optional Docker cases skipped. Lint, formatting, workflow
policy, packed-CLI installation/behavior, and source-preservation checks also
passed. Node 20/22/24 and external review results remain PR evidence, not local proof.

## PR #66 delivery and live history acceptance, September 11

Final documentation commit `2c801fc` was pushed, PR #66 was marked ready, and
all required checks passed: Node 20/22/24, `Check package`, both CodeQL scans and
Snyk. CodeRabbit completed its review of this head with no actionable comments;
there were no unresolved GitHub review threads. The ready-triggered 6529bot
general review repeated the save/readback and linked-history concerns. They were
checked against the existing focused regressions and completion guards below;
no new defect was demonstrated. The disposition is recorded in the PR description.

[PR #66](https://github.com/6529-Collections/6529-release-coordinator/pull/66)
merged at `f68294c729be00dd967c364c039983678907390c` on September 11, 12:40 UTC.
Its merge tree matches reviewed `2c801fc`. Main's
[repository CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34600113234)
and [CodeQL](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34600113188)
also passed.

The subsequent documentation [PR #70](https://github.com/6529-Collections/6529-release-coordinator/pull/70)
proved base-branch activation on opening head `5e8549d`: general, security,
deployment/Actions and GLM Swarm all published reviews without actionable
findings. Its Node 20/22/24, package, CodeQL and Snyk checks passed. The five-job
push configuration also has the offline policy/parser coverage below; later
head-specific review outcomes remain visible on the PR. CodeRabbit's first
attempt on that documentation head was rate-limited despite its green status,
so that status alone is not counted as a completed review.

The [live acceptance record](./testing/history-2026-09-11.md) proves v4-to-v5
sandbox migration from that clean merged source, preservation of all 13 older
tickets and seven older batch/service records, a fresh passing candidate, and
an exact repeat with zero duplicate PRs, workflows or ticket writes. All eight
archives passed content verification; completed details left active state, and
the run lock was released. Existing held ticket #1 explains exit 2 in both runs.
The temporary ticket #14 was then retired with exit 0, preserved history and
verified cleanup; only #1 remains open. This completes the storage proof step
without migrating the real inbox or executing a product release.

## Documentation and code cleanup, September 11

The cleanup shortened this page and preserved the previous narrative in
[the historical progress record](./history/progress-through-2026-09-11.md).
The guides now identify implemented batch behavior and the v5 writer correctly;
dated reports keep their original evidence and version names.

The CLI's final failure log now matches the processor: stop the old process,
inspect the journal, and resume only if that run still holds the lock. A new
full-CLI regression reproduces archive readback failing after the release commit
already cleared the lock. The duplicate stale-status condition was removed
without changing batch outcomes. No new commands or recovery machinery were added.

Validation on Node 22.16.0 passed **396 tests**, with three optional Docker cases
skipped, plus lint, formatting, workflow policy, packed CLI checks and source
preservation. The new CLI test failed against the old wording and passed after
the fix; all 23 focused logging/batch-selection tests passed. All 243 checked local
file/section references resolve. The historical snapshot preserves all 991
previous lines exactly, apart from relative link paths adjusted for its new home.
The cleanup was subsequently committed as `5e30e32` and pushed with `e6537ab` and
`bbc644d` to PR #66. Node 20/22/24 and `Check package` passed on that head. No
inbox mutation, publication or product deployment was performed.

## Fixed PR reviews and security checks, September 11

Implemented on `codex/coordinator-history-cleanup`: 6529bot general, security,
deployment/Actions and GLM Swarm on opening and every push, plus follow-up after
pushes; CodeRabbit includes drafts and has no automatic commit-count pause.
CodeQL scans JavaScript and Actions with extended security queries, pinned
actions and only the permissions needed to upload its results. Offline policy
tests reject dropped reviews/scans, bypasses and privilege expansion.

Local validation passed **426 tests**, with three optional Docker cases skipped,
plus lint, formatting, workflow/review policy and packed-CLI checks. The 61 policy
tests cover the actual files and rejected regressions; all 248 checked local
documentation links resolve. The bot's own parser/job builder at source
`e882f798239ff8a393bc1c60461023a0d4d4419f` confirmed four opening jobs and five push
jobs. CodeRabbit configuration passed its current official JSON Schema.

Commit `14cbb3c` was pushed while PR #66 was a draft. Its
[repository checks](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34594520569)
passed on Node 20/22/24, including `Check package`. Both
[CodeQL scans](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34594520650)
completed successfully. GitHub recorded zero results and no analysis errors for
JavaScript and Actions on PR merge revision `980d4e083b2cb53b0daede61e836e07268dcdf28`.
This is scanning evidence, not a claim that the code has no security defects.

The active `Protect main` ruleset (`22272421`) was updated and read back:
`Check package` and both CodeQL language jobs are required, with the existing
up-to-date branch and review-thread rules preserved. Its native code-scanning
rule requires CodeQL and blocks new high/critical security alerts or error-level
alerts in the PR diff. No bypass actors were added. GitHub's separate default
CodeQL setup remains off to avoid duplicating the checked-in workflow.

CodeRabbit confirmed it loaded `.coderabbit.yaml` and completed its review of
`14cbb3c` while the PR remained a draft, with a successful status and no actionable
comments. Its supplemental ESLint runner failed to install dependencies; the
repository's own ESLint check passed in CI. Its docstring-coverage warning is not
a repository merge requirement. These results do not claim that every optional
CodeRabbit tool completed. At that point the central 6529bot still read the old
configuration from `main`, so its ordinary follow-up used the existing
base-branch defaults. The later merge is recorded above.

The user completed GitHub authorization for the existing 6529 Snyk integration.
The initial root import saw zero dependencies; the targeted import and coverage
correction are recorded below. No token-bearing PR workflow was added.
[Code checks](./code-checks.md) owns the configuration and activation steps.

## Dependency coverage and bot concern verification, September 11

Snyk's targeted import of `packages/release-request/package.json` created
[the CLI dependency project](https://app.snyk.io/org/6529/project/cd173965-5342-4bf7-bd07-8641c4b40764).
Its main-branch scan sees six libraries and reports zero issues. The original
root project has zero production dependencies; it does not cover development
tools. Snyk's nested-manifest scan uses no shared lockfile: it resolved
`fast-uri@3.1.7`, while the checked-in lockfile uses `3.1.6`. This is a real
coverage distinction, not a reason to change application dependencies.

The added CI npm audit reads the actual shared lockfile for all workspaces and
development tools, fails at low severity or higher, and performs no install or
fix. The local audit reported zero known vulnerabilities. Two disposable fixtures
with a deliberately vulnerable dependency proved that the same command fails
for both a workspace runtime dependency and a root development dependency,
without installing packages or changing either lockfile. The fixtures were removed.
The CLI project's Snyk dependency PR check is enabled for newly introduced issues
of every severity, including issues without a fix. Automatic fix and upgrade PRs
are disabled for this project. These settings were saved and verified in Snyk;
the pushed `7c3c398` received a passing
[Snyk PR result](https://app.snyk.io/org/6529/pr-checks/63ea8730-a65c-4a66-a482-1c7f7e9b0d0c)
including this package. Its "No manifest changes detected" result reuses the
six-library baseline; it is not a fresh exact-lock scan. The observed
`security/snyk (6529)` status is now required by active `Protect main` ruleset
`22272421`, with existing status, up-to-date branch and CodeQL alert rules
preserved and read back after the update.
The organization's separate Snyk Code import reported three low findings on
main. They were subsequently reviewed as false positives; see
[the source-scan triage below](#snyk-code-triage-september-11).

Seven new offline history regressions passed against the existing implementation;
the history code changes only add comments explaining its existing guarantees.
All 23 focused history tests and 66 workflow/review policy tests passed.

| Bot concern                                                       | Verified outcome                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost save confirmation followed by a failed journal read          | Stops with inspect-the-journal guidance. Durable history remains available; a later exact repeat keeps attempts/budgets and does not dispatch again or duplicate ticket updates.                      |
| Lost confirmation followed by corrupt archive readback            | The archive verification still runs and rejects the result; it cannot report success based only on the saved branch head.                                                                             |
| Transport error, HTTP 403 or HTTP 422 before the ref update lands | Active records and lock remain; explicit resume preserves the original attempts and completes without duplicate dispatch.                                                                             |
| Missing archive for an unchanged resumed batch                    | Stops without creating a fresh attempt. Missing referenced evidence is distinct from saving an initial identity before any attempt exists; that narrow initial interruption resumes correctly.        |
| Clone mutation, migration shim and summary assumptions            | Existing clone isolation, archive checksum/structure validation and v4 migration/resume tests already cover the stated guarantees. No demonstrated correctness defect warrants the suggested rewrite. |
| Repeated service-reference scan and duplicated path regex         | Optional maintenance suggestions, with no demonstrated failure in the current scope. Left unchanged.                                                                                                  |

The 6529bot comment on `27a1db3` claimed code/test fixes in a docs-only commit;
its `7c3c398` follow-up also used partial context and misdescribed some existing
behavior. The verification above, rather than those claims, settles these concerns.
Full local `npm run check` passed: 438 tests passed,
three optional Docker tests skipped, with lint, formatting, workflow policy and
packed CLI checks passing. On pushed implementation `7c3c398`,
[Node 20/22/24 CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34598243936)
and the required `Check package` gate passed; each explicit audit reported zero
known vulnerabilities. Both
[CodeQL analyses](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34598244059)
passed with zero findings on test merge `7f3e393` (parents `cecbee6` and `7c3c398`).
CodeRabbit reviewed the new tests/audit without actionable comments; its waiting
for three CI results timed out, but those jobs subsequently passed as verified
above. Its advisory docstring-coverage warning remains. The 6529bot follow-up
reported no new findings with partial context. This was pre-merge evidence;
the final review and source delivery are recorded above.

## Snyk Code triage, September 11

Reviewed all three low findings in
[the Snyk Code project](https://app.snyk.io/org/6529/project/551de9a2-d5b3-48d0-858d-38da2d7a727d)
against its scanned main commit `cecbee6b1a9374581df2c0379bada59b78257e79` and the
current branch. The flagged code already existed on main. With explicit user
authorization, each specific alert was submitted as **Not vulnerable**, with its
own source-based reason and no expiry. Snyk's subsequent retest succeeded on the
same main commit, analyzing 94 files (78% reported coverage): **0 open findings,
3 ignored findings**. The ignored list was read back and confirmed each original
issue ID, its **Not vulnerable** type, the complete saved reason and no expiry.

| Finding and Snyk issue ID                                                                            | Review outcome recorded in Snyk                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcoded Non-Cryptographic Secret — `294e40d0-4020-4116-af4c-edfb4bf276de`                          | `apps/coordinator/test/run-log.test.mjs:84` uses an inert fake credential in an offline test. The test injects it into errors/events and asserts that neither logs nor terminal output expose it. It authenticates to no service. Reassess if the fixture is used for real authentication.                                                                                                        |
| Use of Password Hash With Insufficient Computational Effort — `780d40af-e3d7-4504-84cc-80f7ad2c10ad` | `apps/coordinator/src/service-contract.mjs:35` calculates Git blob IDs using the required SHA-1 header/content format, then compares them with pinned Git blob IDs. It does not store passwords. Plan fingerprints separately use SHA-256. Reassess if the function's purpose or Git object format changes.                                                                                       |
| Prototype Pollution — `dac707b7-5466-4879-9988-3e98eea49555`                                         | Traced the 57-step report from `apps/coordinator/test/rehearsal.test.mjs:651` to `apps/coordinator/src/rehearsal.mjs:299`. The accessed key comes from the normalized array's `entries()` loop, so it is a numeric list position rather than an exception message or arbitrary property name. The report array is created internally. Reassess if plan normalization or index generation changes. |

This triage changes no application code and establishes no general exemption for
tests, SHA-1 or object access. Scanning and required merge checks remain enabled.

## Controller and history cleanup, September 11

Commit `e6537ab` split the processor into scan, preparation, batch and presentation
steps. Batch rechecks use the frozen eligible pool; unsupported or over-limit
tickets cannot invalidate another group's proof through changing PR evidence.
Included tickets still require exact input and remote result verification.

The v5 writer archives only finished operations with verified cleanup and saved
ticket presentation. Repeated inputs load original attempts and budgets on demand.
Archives and index updates share one non-force Git commit based on the previous
tree; missing/corrupt evidence and competing writes stop processing. Older writers
reject v5. The old 100-batch/1,000-service lifetime caps are removed; per-search
limits remain. Compact references and ticket transitions still grow, so this is
not a claim of unlimited storage. [History storage](./inbox-processing.md#history-storage)
owns the format, migration and retention rules.

At that commit, the full Node 22.16.0 check passed **395 tests**, with three
optional Docker cases skipped, plus lint, formatting, workflow policy, packed CLI
checks and source preservation. These commits subsequently merged in PR #66;
the later [live sandbox acceptance](./testing/history-2026-09-11.md) records the
migration and repeat separately from those offline tests.

## Implementation alignment review, September 11

The agreed future release sequence reuses existing product Actions and their
environment-specific builds. Wait for successful E2E matching the deployed
staging versions before authorized production merges/deployment. Keep one release
active through completion or recovery. Confirmed no-database-change rollback
uses verified revert commits and ordinary deployment/check steps; database
changes or uncertain restoration require a person.

Future implementation still needs actual staging/main compositions, ownership
across the whole release, matching workflow/E2E results and recorded recovery
targets. These rules and remaining decisions belong in the
[execution design](./design.md#agreed-execution-direction-september-11).

## Sandbox source delivery, September 10

The service extension merged in [PR #45](https://github.com/6529-Collections/6529-release-coordinator/pull/45)
at `02fb6a645a4dd40d909f8346e06eba7057a01333`. Its seven live cases are in the
[service/database acceptance record](./testing/service-database-2026-09-10.md).
The subsequent sample-runtime guard synchronization uses the configured backend
pin `49d92ac76c9bf91520c82010afbae7f9e0fdbb39`; that delivery did not repeat all
original cases. Detailed commits, PR CI and runtime readbacks remain in the
[historical delivery record](./history/progress-through-2026-09-11.md#sandbox-source-delivery-september-10).

## v0.1 run logging, September 11

Batching and run logging merged in [PR #61](https://github.com/6529-Collections/6529-release-coordinator/pull/61)
at local ancestor `cecbee6b1a9374581df2c0379bada59b78257e79`.
The [live acceptance record](./testing/run-logging-2026-09-11.md) separates the
running source from later review fixes and CI results. It proves a passing
candidate, ordered service checks, cleanup and complete logs. It also explains
why older held ticket #1 caused exit 2 while the new ticket passed. That inbox
snapshot is historical, not a fresh scan.

## Deliberately deferred

- Real release execution, cross-ticket dependencies and database-changing batches.
- Heartbeat, automatic takeover and overlapping releases. CT-09 still requires a
  person to stop the old process and settle in-flight requests before resuming.
- New publication approval/staged-publishing rules. Bootstrap remains in place;
  the [publishing guide](./npm-publishing.md#later-approval-milestone) owns that decision.
- Removing narrow package-age exceptions during development. Update a pinned
  version and its exact exception together when adopting a new release.
- Broad product dependency remediation. The [fast-uri assessment](./security/fast-uri-assessment.md)
  has a specific dated scope; it does not clear other dependency findings.

## Dated evidence index

| Record                                                                                                                               | What it preserves                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Original progress snapshot](./history/progress-through-2026-09-11.md)                                                               | Earlier plans, delivery/CI records, request tests, dependency observations and housekeeping evidence.                                                                                                                                                                                                   |
| [npm migration](./history/npm-migration.md)                                                                                          | Completed migration checklist and independent review, with historical status clearly marked.                                                                                                                                                                                                            |
| [Merge rehearsal](./testing/merge-rehearsal-2026-09-09.md), [public required checks](./testing/merge-rehearsal-public-2026-09-09.md) | Original Git-engine and public repository acceptance.                                                                                                                                                                                                                                                   |
| [Profiled inbox](./testing/profiled-inbox-2026-09-09.md), [unified command](./testing/unified-inbox-2026-09-09.md)                   | Shared profiles, isolated intake and one-command delivery.                                                                                                                                                                                                                                              |
| [Guarded profile sandbox](./testing/profile-scope-sandbox-2026-09-22.md)                                                             | Filtered one- and multi-ticket selection, normal database isolation, a solo database release, controlled staging E2E failure, protected restoration, two live findings and same-run resume.                                                                                                             |
| [Services/database](./testing/service-database-2026-09-10.md), [batching](./testing/batch-2026-09-10.md)                             | Application assertions, ordering, database behavior and exact combined-code results.                                                                                                                                                                                                                    |
| [20 corner cases](./testing/complex-corner-cases.md)                                                                                 | Per-case results, evidence layers, reproduced gaps and unsupported future behavior.                                                                                                                                                                                                                     |
| [Run logging](./testing/run-logging-2026-09-11.md)                                                                                   | Live logs, source/review boundaries, cleanup and test-ticket retirement.                                                                                                                                                                                                                                |
| [In-flight workflow wait](./testing/sandbox-inflight-wait-2026-09-18.md)                                                             | Per-environment sandbox lock proof, the false-quiet finding and fix, the no-limit wait, Ctrl-C and resume, and the fourteen-operation release of ticket #34.                                                                                                                                            |
| [v5 history](./testing/history-2026-09-11.md)                                                                                        | Merged source, live sandbox migration, preserved archives, exact repeat and test cleanup.                                                                                                                                                                                                               |
| [Sandbox release sequence](./testing/release-sequence-2026-09-11.md)                                                                 | Protected fake staging and production, 14 matching operations, interruption/resume, ticket closeout, cleanup, and the post-run stale-start guard.                                                                                                                                                       |
| [Batch policy v3](./testing/batch-v3-2026-09-15.md)                                                                                  | A+B failing while A and B pass alone, selection of one candidate, fake staging with matching E2E, and waiting through long GitHub queues without an elapsed-time cutoff.                                                                                                                                |
| [GitHub-only build and E2E](./testing/github-build-e2e-2026-09-15.md)                                                                | Locked builds, short-lived artifacts, built-output E2E on GitHub runners, the 14-operation production path, four fixed gaps and cleanup.                                                                                                                                                                |
| [Staging E2E failure](./testing/staging-e2e-failure-2026-09-16.md)                                                                   | A real staging E2E failure stopping before production, the recorded reason, released lock, owned-branch cleanup and manual staging repair.                                                                                                                                                              |
| [Staging restoration](./testing/staging-restoration-2026-09-16.md)                                                                   | Protected undo PRs on the exact staging heads, ordered builds, restored E2E, unchanged test `main` and a transient-error resume.                                                                                                                                                                        |
| [Solo database release](./testing/solo-database-release-2026-09-16.md)                                                               | One `database_change: yes` ticket alone through the protected path, an earlier failed check that stopped without restoration, and manual staging repair.                                                                                                                                                |
| [Fake-production restoration](./testing/fake-production-restoration-2026-09-16.md)                                                   | Test `main` restored before staging through protected undo PRs, matching builds/E2E, final ref/tree readback, the large-journal blob fallback and the still-failed ticket.                                                                                                                              |
| [Sample monitoring deployment](./testing/sandbox-monitoring-2026-09-17.md)                                                           | Monitoring deployed for staging and prod after the test-main merge and before production application deployments, installed templates bound to builds and artifact records, a controlled monitoring failure restored with monitoring redeployed, and the intake pin, allowlist and moved-base findings. |
| [Branch-aligned monitoring acceptance](./testing/monitoring-branch-contract-2026-09-23.md)                                           | Merged test-mirror branch contract, exact staging/prod monitoring sources, full success release, staging and production controlled failures, protected restoration, matching E2E and final branch-tree readback.                                                                                        |
| [Real ticket #266 runtime-pin stop](./testing/real-production-ticket-266-2026-09-29.md)                                              | Filtered real run, exact PR rehearsal, passing temporary combined checks, changed backend deploy-workflow pins, retained journal lock and no product release operation.                                                                                                                                 |

Keep current status and next steps here. Update behavior in its owning guide;
keep dated acceptance reports unchanged unless explicitly recording a new run.
