# Explicit check retry — October 8, 2026

## Scope

An approved diagnostic rerun changed the old frontend trial's Installed app
checks conclusion from failure to success, on unchanged code. A later ordinary
processing invocation correctly refused changed saved evidence but could not
start fresh checks. The diagnostic remains separate from release proof.

The new resume-only `--retry-checks ATTEMPT_ID` action creates a distinct, linked
Git/CI round for the owner's unchanged single-ticket filtered real frontend-only
request with no database change. It preserves the old record and archive,
attempt IDs, policy and spent budgets. It requires a completed saved CI failure,
verified owned cleanup and completed old workflows. It refuses selected or
deployed batches, uncertain cleanup, changed source/request/history, backend or
database work and exhausted existing budgets. Repeating the same action resumes
its saved round; another failed fresh round stops for human direction.

Fresh source/review/rule/workflow checks remain mandatory. A supported
current-main refresh carries the immutable retry link and counts all previous
attempts. Matching saved staging deployment plus browser E2E still precede
production, which needs its own matching deployment and E2E. No new count/time
limit, workflow pin, recovery bypass or automatic retry is introduced.

## Offline verification

Node 22.16.0, scoped non-fixing checks:

- All 34 focused retry and GitHub-adapter tests passed, including fresh-round
  identity, immutable archive/history, repeated approval, interruption, source
  gate failure, cancellation, current-main refresh, cleanup/workflow refusal,
  complete workflow pagination and existing budget exhaustion.
- All 52 repository test files ran serially: 1141 tests total, 1138 passed,
  three optional Docker cases skipped, zero failed.
- Lint, formatting check, documentation links, workflow policy and isolated
  offline packed-CLI checks passed. Source contents were unchanged throughout
  the full gate. The final evidence-only document update was checked separately.

These checks created no GitHub resources or product deployments.

## Actual saved-state inspection

At 2026-10-08T11:58:05.841Z, guarded GET-only reads inspected real journal
revision 811 at `43d194e1ad3b28311a561a25129cd5b54b9932f1` and its verified
original batch archive. The same owner-held run and unchanged request 334 matched
the immutable local outbox; source PR 4120 remained open, non-draft, with exact
head `6488108007507eff7c1bed524a0d0f5a61a7fe91`.

The original owned trial was closed unmerged, its branch absent, and every
workflow for its exact candidate head completed. The new eligibility helper
accepted the saved failed check attempt on a clone in memory. Its save callback
captured intent only in memory; it did not write the journal, acquire a lock,
publish a trial or run CI. A final read verified the journal ref remained
unchanged. This is eligibility evidence, not live retry or deployment proof.

## Delivery boundary

At authoring, PR review, exact-head hosted checks and merge remain pending.
No ticket retry, source change, real journal/lock mutation, product workflow
dispatch, deployment or automation change was performed. The monitor remains
paused. A later explicitly approved retry must first verify settled process and
request absence, then reread current saved state and normal admission gates.
