# Progress and next steps

Last reviewed: **2026-09-11**, against pushed source `7c3c398` and the dependency
coverage/history verification below. This page separates implemented behavior, source delivery
and live proof. Earlier GitHub/package observations carry their original dates;
they were not repeated during this cleanup.

## Current state

| Area | What is available | Evidence boundary |
| --- | --- | --- |
| Request submission | Public npm CLI `0.0.4`, shared intake and receipt verification | Earlier frontend/backend delivery tests passed; [publication guide](./npm-publishing.md) and [original evidence](./history/progress-through-2026-09-11.md#verified-intake-and-reader-checks). |
| Ticket workflow | One manual `inbox:run` command reads requests, checks exact PRs and updates the same tickets | Unified workflow and subsequent sandbox work are merged; [command guide](../apps/coordinator/README.md#run-the-ticket-workflow). |
| Sandbox service/database checks | One-ticket checks run sample services and temporary MySQL in GitHub Actions | Local and live acceptance passed; see [source delivery](#sandbox-source-delivery-september-10). |
| Sandbox batching | Unscoped runs filter cheap blockers before combined PR/service checks, keep tickets whole and record exclusions | Compatible, repeated and incompatible groups have [dated live evidence](./testing/batch-2026-09-10.md). |
| Run logs | Live step updates and private local logs, including explicit resume | Local tests and [live logging acceptance](./testing/run-logging-2026-09-11.md) passed. |
| v5 history | Finished batch/service records archive in the same journal branch; active work and original attempts remain available | Included in open [PR #66](https://github.com/6529-Collections/6529-release-coordinator/pull/66); not merged or live-migrated. |
| PR reviews/security | Fixed bot reviews, CodeRabbit drafts, CodeQL and a complete lockfile audit configured | Node 20/22/24 CI, CodeQL and Snyk passed on `7c3c398`; CodeQL and Snyk merge rules are active. Snyk scans the CLI's six libraries, with the workspace limitation below. Expanded 6529bot activation needs the base-branch merge. |
| Real releases | Existing product release procedures remain in use | Coordinator staging/production execution and rollback are not built. |

The manual command runs once and exits. Real mode inspects and rehearses Git;
profile selection does not enable sandbox execution on real products. A passing
candidate stays waiting and does not authorize a release.

## Next steps

1. Finish review of open PR #66, which contains v5 history, cleanup and the
   review/security setup. The new CI audit and Snyk dependency PR status passed.
   The history concerns have the focused verification below. Verify the expanded 6529bot set after the separately
   authorized merge makes its configuration available on `main`.
2. On a separately authorized sandbox run, verify migration of the existing
   journal and an exact repeat: original attempt IDs/budgets, preserved files,
   no duplicate PRs/workflows/ticket decisions, verified cleanup and lock release.
   [History acceptance](./merge-rehearsal-testing.md#history-storage-acceptance)
   owns the detailed finish line. Live migration has not run.
3. After that proof, build the release sequence in the test repositories before
   adding real adapters. [Later execution acceptance](./merge-rehearsal-testing.md#later-execution-acceptance)
   covers that future stage; it is not part of this cleanup.

## Documentation and code cleanup, September 11

Local changes shorten this page and preserve the previous narrative in
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

Commit `14cbb3c` is pushed to draft PR #66. Its
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
CodeRabbit tool completed. The central 6529bot reads configuration from `main`,
so this branch does not yet activate its expanded review set. Its ordinary
follow-up ran using the existing base-branch defaults.

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
The organization's separate Snyk Code import also reported three low findings on
main; this dependency work does not assess or dismiss those source-code findings.

Seven new offline history regressions passed against the existing implementation;
the history code changes only add comments explaining its existing guarantees.
All 23 focused history tests and 66 workflow/review policy tests passed.

| Bot concern | Verified outcome |
| --- | --- |
| Lost save confirmation followed by a failed journal read | Stops with inspect-the-journal guidance. Durable history remains available; a later exact repeat keeps attempts/budgets and does not dispatch again or duplicate ticket updates. |
| Lost confirmation followed by corrupt archive readback | The archive verification still runs and rejects the result; it cannot report success based only on the saved branch head. |
| Transport error, HTTP 403 or HTTP 422 before the ref update lands | Active records and lock remain; explicit resume preserves the original attempts and completes without duplicate dispatch. |
| Missing archive for an unchanged resumed batch | Stops without creating a fresh attempt. Missing referenced evidence is distinct from saving an initial identity before any attempt exists; that narrow initial interruption resumes correctly. |
| Clone mutation, migration shim and summary assumptions | Existing clone isolation, archive checksum/structure validation and v4 migration/resume tests already cover the stated guarantees. No demonstrated correctness defect warrants the suggested rewrite. |
| Repeated service-reference scan and duplicated path regex | Optional maintenance suggestions, with no demonstrated failure in the current scope. Left unchanged. |

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
reported no new findings with partial context. The following documentation-only
commit records this evidence; PR #66 remains a draft and is not merged.

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
checks and source preservation. Live v5 migration remains pending; these commits
are now included in PR #66.

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

| Record | What it preserves |
| --- | --- |
| [Original progress snapshot](./history/progress-through-2026-09-11.md) | Earlier plans, delivery/CI records, request tests, dependency observations and housekeeping evidence. |
| [npm migration](./history/npm-migration.md) | Completed migration checklist and independent review, with historical status clearly marked. |
| [Merge rehearsal](./testing/merge-rehearsal-2026-09-09.md), [public required checks](./testing/merge-rehearsal-public-2026-09-09.md) | Original Git-engine and public repository acceptance. |
| [Profiled inbox](./testing/profiled-inbox-2026-09-09.md), [unified command](./testing/unified-inbox-2026-09-09.md) | Shared profiles, isolated intake and one-command delivery. |
| [Services/database](./testing/service-database-2026-09-10.md), [batching](./testing/batch-2026-09-10.md) | Application assertions, ordering, database behavior and exact combined-code results. |
| [20 corner cases](./testing/complex-corner-cases.md) | Per-case results, evidence layers, reproduced gaps and unsupported future behavior. |
| [Run logging](./testing/run-logging-2026-09-11.md) | Live logs, source/review boundaries, cleanup and test-ticket retirement. |

Keep current status and next steps here. Update behavior in its owning guide;
keep dated acceptance reports unchanged unless explicitly recording a new run.
