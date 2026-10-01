# Behind-main original-PR history — October 1, 2026

Status: both sandbox releases completed. Source was local and uncommitted during
acceptance; subsequent remote delivery is tracked in progress. No real-product
release is authorized or proved here.

The source starts from merged Coordinator `150eb16cbde0bea2662ff80880d87fe2c61dba37`
on `codex/behind-pr-release-history`. Full local checks passed 711 tests, with three
optional Docker skips. Offline proof is not sandbox or product release proof.

## Fixture and normal intake

The explicit `--create-behind-history-prs` developer fixture command created
only new sandbox source PRs. Local fixtures and request JSON are preserved under
`.release-coordinator/behind-history-development/`. Two complete production
requests select backend `dbMigrationsLoop -> worker -> api`, then frontend, with
no database change. Use issue/actor-filtered runs and the default
`product-workflows` adapter, not generic fallback.

| Ticket | Role | Original PR | Exact requested head |
| --- | --- | --- | --- |
| A / #56 | backend | [#167](https://github.com/6529-Collections/release-coordinator-test-backend/pull/167) | `d97a72b37d4a4f612ae2e23e7d81af993f84d34c` |
| A / #56 | frontend | [#159](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/159) | `1663b25f61a6af68501c7cd206c37c4a7731c44a` |
| B / #55 | backend | [#168](https://github.com/6529-Collections/release-coordinator-test-backend/pull/168) | `d39cb16f70013daefacbf595cc478a9529415e6c` |
| B / #55 | frontend | [#160](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/160) | `1c4a713771670e553d643de47ac7e45acfa5a7a2` |

Both backend source heads started from `5f57cba452ad797f0f0f9c097700db9e3b539a35`;
both frontend heads started from `58ee3011cea7a2498de60d4890a667e469308840`.
All four source `Sandbox check` jobs passed. Normal `request:submit` CLI receipts
bind actor `simo6529` / `209783236` to test inbox tickets
[#56](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/56)
and [#55](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/55).
Intake workflows `36823180964` and `36823180948` completed successfully.

Frontend test main's existing required `Sandbox check`, app `15368`, had
`strict: false`. Only strict freshness was temporarily changed to `true` to
exercise GitHub's genuine `BEHIND` gate; required check/app and review rules were
read back unchanged. After both releases, the original `strict: false` was restored
at 08:41 UTC and independently read back with the same `Sandbox check` / app
`15368`. Backend freshness stayed unchanged. No real repository setting was changed.

## A: saved start and transport recovery

Run `c6a0df61-b977-444b-94da-dcb4d25e07f1` selects only #56 / `simo6529`. Intake,
readiness, individual Git rehearsal and combined Git preparation passed.
The first invocation exited 2 at 06:23:47 UTC on an unreadable GitHub transport
response before any release execution/shared merge/deployment. Journal revision
4408 retained its lock and check attempt `087d53d7-c243-4633-8e2b-de3ae36d77ec`.

Independent readback confirmed backend candidate
`682efbf41eee8251c8eca242c2f58426f5c0efbc` has parents
`[5f57cba452ad797f0f0f9c097700db9e3b539a35, d97a72b37d4a4f612ae2e23e7d81af993f84d34c]`
and tree `644805b40cbf42d28cd9a22c1919ce8882cba4c0`. Its exact owned trial branch
exists; no trial PR exists or PR-creation intent was recorded. Both main refs
still matched their starting versions and no release execution existed.
The process had exited and more than 60 seconds elapsed before same-run resume
at 06:25:16 UTC. No replacement ticket/candidate was created.

The resume adopted the writer marker and re-read the same inputs and evidence.
All 14 release steps passed, including three backend services and frontend in
each environment, separate integration PRs, and matching E2E. Ticket #56 closed
as completed; the command exited 0 at 07:18:34 UTC. Independent journal readback
at revision 4525 confirms no lock and a verified archive at
`history/batches/32a8083751ecad552e4578d9237971c7b71893a92926e87dc3fcf9fbfee6fbef.json`.
Backend original #167 and frontend original #159 are merged with their exact
requested heads unchanged; the production integration records contain
`source_merges` readbacks for both originals.

| A evidence | Backend | Frontend / E2E |
| --- | --- | --- |
| Candidate PR CI | #169 / `36825065825` | #161 / `36825316045` |
| Combined services | `36825540684` | Included in the same service plan |
| Staging integration | #170 | #162 |
| Staging deploy | `36826426163`, `36826616157`, `36826801718` | `36827167430` |
| Staging E2E | Matching backend `4cc91491c999a80010341849c201ac1a74d8afb1` | `36827257708` |
| Production integration | #171 | #163 |
| Production deploy | `36828035365`, `36828227216`, `36828434663` | `36829162331` |
| Production E2E | Matching backend `1a3ab40b15d409328129b6fe598965a299d7728a` | `36829292439` |

A advanced backend main to `1a3ab40b15d409328129b6fe598965a299d7728a` and frontend
main to `f4782b4681441c42b4cbf6df60c21a4b772c6727`. At that point B remained open
at both original heads. Frontend B reported `MERGEABLE` / `BEHIND` /
`REVIEW_REQUIRED`; backend B reported `BLOCKED` by the existing approval rule
with soft freshness.

## B: retained PR base versus current main

The first read-only B audit stayed blocked: GitHub retains each original PR's old
`baseRefOid`, which differs from the current branch tip. The audit incorrectly
treated that legitimate difference as moving pages. No B release had started.
The shared audit now captures current main separately, rejects changes between
audit pages, records `audited_base_commit`, and compares ordinary strict merge
freshness against that live main rather than the retained old PR base.

New regression tests prove behind-source admission with an old PR base, ordinary
soft-freshness approval bypass, rejection of a strict direct merge against moved
main, and a stop when live main moves between audit pages. Full checks passed
710 tests with three optional Docker skips. Fresh live readback admits frontend
B only with a `source-integration-only` certificate and the existing independently
audited missing-approval exception. Backend B has its existing narrow approval
bypass; no ordinary strict merge gate was relaxed.

B's first same-ticket filtered run `d0c89bb0-3533-4b8c-9b8d-9dad9457a1ce`
started at 07:21 UTC. Readiness and exact Git merges passed, but rehearsal still
required the retained PR base commit to equal current main. Its destination gate
therefore stayed unknown; no candidate CI or release started. It exited 2 at
07:25:42 UTC with the ticket waiting and its lock released.

The rehearsal now checks the same destination branch, independently pins and
re-reads its current commit, and reports only source gate/Git proof. A newer main
never inherits old combination CI. Another destination branch remains unknown;
changed heads, conflicts and moving destinations still stop. An actual-Git
regression test advances fixture main and proves the original branch/head remains
unchanged through rehearsal. Full recheck passed 711 tests, with three optional
Docker skips. The same #55 / `simo6529` request retry started at 07:29:12 UTC;
no receipt, source head or developer branch changed. Run
`3b876357-bc63-4803-a813-8532e60c0b80` passed intake, readiness, individual Git
rehearsal and combined Git filtering. Its backend candidate PR #172 names
`d9191ef9dcc59c3a831299f700cc450db0479a31`, with the expected tree
`6597fbb19ea4fda1ed1c51479cac53978a97a17b` and verified parents
`[1a3ab40b15d409328129b6fe598965a299d7728a, d39cb16f70013daefacbf595cc478a9529415e6c]`.
Thus the new candidate contains current main and the unchanged original B head.

A live read-only negative guard test against that exact GitHub candidate removed
B from the selection and ignored only owned trial #172. It correctly refused
unselected source PR #168, which would enter main through the candidate. No PR,
branch, workflow or ticket was mutated by this negative test.

Frontend trial #164 names `88c2a2c9daeddd2147636bda5f97d8ff459bc78c`, with tree
`57a541ac46acc16c4a2f93dffafdbfb3286a86b0` and verified parents
`[f4782b4681441c42b4cbf6df60c21a4b772c6727, 1c4a713771670e553d643de47ac7e45acfa5a7a2]`.
Backend candidate CI `36831457698`, frontend CI `36831676062` and combined
service workflow `36831906591` all passed. Owned trials #172/#164 were closed
and their exact branches removed; combined checks finished at 07:46:37 UTC.

The Codex chat's existing PR attachment list reached its platform maximum of 100.
Attaching these newly created test PRs returned `thread attachment identity count
exceeds 100`; no existing attachments were removed. The explicit repository/PR
identities and evidence links in this report remain available independently.

## B: interruption after original PRs enter main

All staging deployments and matching E2E passed (`36833961409`). Production
integrations #174/#166 passed, and original PRs #168/#160 were marked merged at
their exact requested heads. All three production backend deploys passed.
At 08:23:20 UTC a GitHub transport error stopped the process at frontend
production deployment, before a readable response; no deployment result was
claimed. The original command exited 2 and the saved lock remained.

Independent journal revision 4644 readback at 08:30 UTC binds the same run,
only #55 / `simo6529`, to batch
`ebc2d078bcb0246afb838658c4484abed3140b8b2dc5150563cb244d10738fc0` and release
`6d4b525b-1413-4087-9b8b-f10398a03094`. The unfinished frontend deploy operation
`15042504-c3ab-4352-af7c-a3b7eb92e816` remains `prepared`, with no dispatch intent
or workflow run recorded. The actual deploy workflow listing contains no run
for new frontend main `e5060c16a645df80478d9b6fec0ec1e5fecf19b2`; backend main
still matches saved `b0e7581db5e7d6bb744893a9b9f98390277c99fd`. The original
process is stopped and more than 60 seconds have elapsed.

A same-run resume started at 08:31:29 UTC only after those checks. It preserved
the exact filtered scope, did not repeat completed integrations, and continued
frontend production deployment `36837021048` and matching E2E `36837161178`.
Both passed. This exercised the expected merged-source transition with
deployment/E2E still unfinished: merged source PRs did not retire the active
ticket or bypass its remaining release proof.

The release completed at 08:36 UTC, ticket #55 was verified completed at 08:37,
and the command exited 0 with its lock released at 08:38:03 UTC. Independent
journal revision 4657 readback verifies both completed archives and all 14 passed
operations per release. B's checksum-verified archive is
`history/batches/5bc5ffcf7fdc558fce23b842c886a90ea8364c4d89d7d8d498331e890d4d3fa7.json`.
All four original PRs are marked merged at their unchanged requested heads.

| B evidence | Backend | Frontend / E2E |
| --- | --- | --- |
| Candidate PR CI | #172 / `36831457698` | #164 / `36831676062` |
| Combined services | `36831906591` | Included in the same service plan |
| Staging integration | #173 | #165 |
| Staging deploy | `36832993049`, `36833214558`, `36833437463` | `36833850233` |
| Staging E2E | Matching backend `86ca17d35b3968c1577fe931eed90318cfecac3a` | `36833961409` |
| Production integration | #174 | #166 |
| Production deploy | `36834759544`, `36834958262`, `36835172849` | `36837021048` |
| Production E2E | Matching backend `b0e7581db5e7d6bb744893a9b9f98390277c99fd` | `36837161178` |

B's final frontend main is `e5060c16a645df80478d9b6fec0ec1e5fecf19b2`;
its staging frontend is `8d4cdb58b0172f2cffac148ba30c96ab552a7f9f`.

The resumed completion exposed a presentation-only bug: the interim
`release-unverified` reason remained beside `release-completed`. The completion
projection now removes that superseded reason, and the interrupted-release
regression checks both journal reasons and managed issue labels. This does not
change release operations or completed evidence.

After verifying B's completed archive and immutable normal intake, a scoped
presentation repair used the ordinary journal lock, append-only decision and
guarded ticket writer for #55 / `simo6529` only. Repair run
`f810c571-3766-496e-8af4-7fd0af6ee8f5` added one decision transition, removed the
superseded reason from the existing comment/labels and verified completion.
Journal revision 4661 has no lock; B's original archive checksum is unchanged.
No release operation was repeated and no other ticket was changed.

Final local `npm run check` passed: 714 tests, 711 passed, zero failures and three
optional Docker skips; non-fixing lint, formatting, docs/workflow policy and the
packed CLI smoke check passed. The GitHub sandbox service workflows exercised
their actual temporary MySQL/service checks; optional local Docker skips are not
represented as local Docker proof. At acceptance, Coordinator source was
local/uncommitted, with no Coordinator PR, remote merge or package publication. Real frontend,
backend and inbox releases were not run or mutated in this acceptance.

## Coverage boundary

Fresh sandbox acceptance covers sequential no-database-change backend/frontend
releases A then B, genuine behind-main source admission, preserved original
heads/ancestry, normal required checks, matching staging/production E2E and
same-run continuation after originals become merged. The unselected inherited
PR guard also has a live read-only negative check. Moving main during combined
candidate preparation, automatic cleanup/re-preparation budgets, changed source
gates, unchanged-tree roles and both-profile safety cases have offline regression
coverage; this report does not claim fresh live acceptance of those additional
failure/recovery paths or any real-product release.

## PR review hardening

[Coordinator PR #288](https://github.com/6529-Collections/6529-release-coordinator/pull/288)
adds abort checkpoints around every source-history page/comparison response and
preparation refresh, a main-only server-side PR filter, per-scan caching of
immutable SHA comparisons, and refusal to re-attempt an already recorded base
snapshot. The unselected-history guard now runs before staging as well as main
merges. Focused tests cover cancellation, reduced duplicate comparisons,
repeated preparation evidence and both shared-ref guard placements. Existing
count budgets and the user-agreed no-limit waits are unchanged; no page/time/
retry cap was added.

Read-only live GitHub comparisons confirmed that `base_commit.sha` is the first
requested SHA for both `behind` (backend main to original B) and `diverged`
(frontend original B to original A); the merge-base SHA is distinct as expected.
At review, main-target open PR counts were 35 frontend and 19 backend. Exact
ancestry of each unselected unique head still needs a compare; these reads cannot
be safely replaced with an assumption that a head is unrelated. A failed or
rate-limited read fails closed. These are review-time readbacks, not mutable
future guarantees. No new sandbox release or real-product run was executed for
the review hardening changes.

The review-hardened full local check passed 719 tests: 716 passed, zero failures
and three optional Docker skips. Lint, formatting, docs/workflow policy and the
packed CLI smoke check passed. The exact shared lockfile audit also reported
zero vulnerabilities. These local results remain distinct from the latest
PR head's GitHub checks and review availability.

The partial GLM testing slice prompted additional same-count regressions:
candidate verification rejects a changed parent SHA, reordered parents and a
changed tree as well as a missing parent; the resume test confirms the saved
production frontend integration passed before interruption and checks journal
reasons as well as labels; non-behind states cannot receive source-integration
admission; and unsupported history policy shapes must fail with `batch-policy`.
The cancellation fixture deliberately supplies a fixed API-free plan stub, so
its exact read count is deterministic. An ancestry flag alone is not an
admission/merge grant; the independently audited source-only certificate and
fresh exact candidate checks remain authoritative.
