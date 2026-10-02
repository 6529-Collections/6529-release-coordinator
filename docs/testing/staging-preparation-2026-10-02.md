# Staging-aware preparation — October 2, 2026

Status: local review, non-fixing checks and both live sandbox cases passed.
This record does not authorize or prove a real-product release.
Real ticket #285 remains stopped and its watcher remains paused.

## Source and local review

The isolated checkout `/tmp/6529-staging-review.zqM8Cf/repo` contains only the
twelve staging-preparation files over merged Coordinator main
`73d8747dc55c842905903a1195093cf414d78230`. Concurrent inbox-cleanup/dashboard
changes in the shared checkout were excluded and left untouched.
The independent review checked ordinary Git composition, staging-only content
and source ancestry, separate production inputs, immutable resume identities,
new-blob publication, cancellation, cleanup and truthful conflict reporting.
No blocking implementation finding was identified. This is a local review,
not the configured final-head GitHub bot reviews or a Coordinator PR merge.

The repeated full `npm run check` on Node 22.16.0 passed **773 tests**, with
three optional Docker skips (776 total), plus non-fixing lint, formatting,
documentation/workflow policy and packed-CLI smoke checks. Source files remained
unchanged. Locked dependency installation reported zero vulnerabilities.
After both live cases and the documentation update, the isolated full gate
passed again with the same 773 passes and three optional Docker skips. Its
lint, formatting, documentation, workflow and packed-CLI checks passed, and
the recorded core source hashes remained identical.

Core implementation SHA-256 identities during acceptance:

| File | SHA-256 |
| --- | --- |
| `release-execution.mjs` | `d529d9392a904accf5332c540be0a5ea804f006e86d7ee301eb777dfe7c37a90` |
| `release-github.mjs` | `f83886c78fd1b20bd9069eca0b8a7b6ab06b1e292e808d7e6b179f2f378926a0` |
| `release-plan.mjs` | `fbe5004eda673bff99162831ef5acee405361464fb2ef1aa063dad3f328be039` |
| `release-state.mjs` | `1576cf9e44f2fdbb384c9bd4f2c7d21c1844d2d823c827e424b14e88219b5b2c` |
| `staging-merge.mjs` | `9308781794926d90366b6902515451d7027c03d68cfbf51b8dd0204fe9b9f609` |

## Live sandbox boundary and inputs

Only `release-coordinator-test-frontend` (ID `1362504370`) and the test inbox
(ID `1362580376`) may be mutated by these cases. The backend test repository
(ID `1362505082`) is observed as the unchanged environment prerequisite.
The same engine uses `sandbox`, `filtered`, actor `simo6529` / `209783236`,
and the default `product-workflows` adapter. Each production-target request is
frontend-only, self-contained and declares no database change.

Initial sandbox journal revision **4661** had no lock or active release.
The actual product-shaped adapter's read-only identity admission passed all
configured runtime pins and repository identities before execution.
Captured versions were:

| Role | Staging | Main |
| --- | --- | --- |
| Frontend | `8d4cdb58b0172f2cffac148ba30c96ab552a7f9f` | `e5060c16a645df80478d9b6fec0ec1e5fecf19b2` |
| Backend | `86ca17d35b3968c1577fe931eed90318cfecac3a` | `b0e7581db5e7d6bb744893a9b9f98390277c99fd` |

Frontend staging had five extra documents relative to main. Acceptance requires
their exact blobs to remain on staging and not enter main:

| Path under `docs/` | Existing staging blob |
| --- | --- |
| `current-sandbox-database-20260922.md` | `43ae5c29aafbcdfad626dcbe2fdb26d6f8f6029e` |
| `current-sandbox-multi-a-20260922.md` | `c17f4f0ef8cff0b05f808fccad2a285322c86e4c` |
| `current-sandbox-multi-b-20260922.md` | `9bec08de82e3d4849f57a7c9a8df2e748098312a` |
| `current-sandbox-multi-c-20260922.md` | `44345c037858f59b8f94e5f013c130c51044d45e` |
| `staging-optional-check-acceptance-20260923.md` | `e5790bf13607e0325c1f979a9f1e197a2743b6ae` |

## Deliberate conflict: ticket #57

[Source PR #167](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/167)
pins `fe17fc0cc8d7f38ecf8e622076877668202ed62b` on
`codex/staging-preparation-conflict-20261002`. It adds different content at
`docs/staging-optional-check-acceptance-20260923.md`, which exists only on staging.
An independent actual-Git merge reproduced that precise add/add conflict.

[Ticket #57](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/57)
was submitted through the normal private CLI. Request ID is
`a84305ef-a12c-46c2-a00d-22c0192bc974`, checksum
`ab643b500c9b90e1af07a8062c39dc9207fd50b4b7762ceb3289e95afc45af97`.
[Intake 36995926854](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/36995926854)
passed and its receipt verified the actual submitter.

The exact filtered run `51ca8990-5469-4f31-8bfc-7d443c75e8e7` began at
10:36:35 UTC. Its saved scope contains only #57. Individual/combined Git checks
against current main passed, then
[owned trial #169](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/169)
at `33df21038c5dd87cb4c01c997c7bd623849b990c` passed
[required CI 36997163165](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36997163165).
The deliberate-conflict case passed its acceptance criteria. Release
`ac752a39-4242-48a2-bf29-4d00d22b1813` stopped at staging preparation at
10:49:48 UTC with result kind `merge-conflict` and the exact conflicting path.
No staging integration PR was published and no shared branch changed. Its only
saved operation is the failed staging integration; no deployment or E2E was
started. Independent GitHub readback confirmed all four captured environment
refs were unchanged and no matching deployment workflow was created.

Trial #169 was closed unmerged and its exact owned branch was absent. Ticket
#57 is open/action-needed, with the named conflict in its final Coordinator
comment. Journal revision **4687** at
`e6ab7db9b73d020c3d12f25d98c3d91da84e753d` records the terminal release,
preserved attempts and a null lock. The command ended with expected exit 1 at
10:50:55 UTC; no inbox-runner process remained. This intentional fixture does
not need to be resumed or resolved to execute the separate clean case.

## Clean divergent composition: ticket #58

[Source PR #168](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/168)
pins `54f3efb83ddfb3ed1f0131a5ff5f2edb4b44fad8` on
`codex/staging-preparation-clean-20261002`. It adds only
`docs/staging-preparation-clean-20261002.md`.
[Ticket #58](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/58)
has request ID `9d5ad91a-bf8a-41da-973e-abf1f252196e`, checksum
`b023049e5e718e51fdf851b65886f5b5d20453202d0d6dad59ea472cc3a17b17`.
[Intake 36995993880](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/36995993880)
passed and the normal CLI verified its receipt.

Using actual GitHub inputs, the new preparation independently reproduced
combined staging tree `3235593c3afc9b5cce23e205edc6c986ebc1feaa` from captured
staging and this source. The source tree is
`7bfed85693dee5f0f7a207d274edea135e466c00`; production must retain that selected
main-based tree, not substitute the staging tree.

CodeRabbit's minor fixture-documentation request was addressed in the PR's
acceptance specification and linked inline response, then the exact thread was
resolved. Candidate/source bytes and the accepted request were not changed.
The specification names the paths, captured commits, expected tree, fresh
integration CI and matching staging/production deploy/E2E requirements. The
tree identity stays outside its own candidate file to avoid self-reference.
This does not represent a completed release or override any Coordinator gate.

Verified outcome: fresh staging integration checks, matching fake staging
deploy/E2E, separate main integration and matching fake production deploy/E2E,
original source marked merged, verified ticket closeout and owned cleanup,
unlocked lane, staging-only documents unchanged and absent from main.
The clean case was started once at 10:56:47 UTC using only filtered issue #58
and actor `simo6529`, after the conflict case ended and its lane was verified
clear. Invocation ID is `b639c922-95be-41fe-8e09-7b79a9c6c5ba`; execution
session was `54455`. The command finished successfully with exit 0 at
11:26:05 UTC.
The saved run is `bb4cc3ca-37be-4ac8-b92e-c2868b64731c`; npm PID `90825`
and Node PID `90847` were observed after startup. The local log is
`~/.6529-release-coordinator/logs/sandbox/1362580376/bb4cc3ca-37be-4ac8-b92e-c2868b64731c.jsonl`.
Its journal scope is exactly filtered #58/`simo6529`, verified actor
`209783236`, `close_test: false`, `release_adapter: product-workflows`.
Batch fingerprint is
`5f9ef3e0c70b3c0a5160478bb6a24c6c2536a087408d026f1d059bc4eb08fa83`.
Individual and combined Git rehearsal passed. Combined checks attempt
`c828f57c-5165-4ca2-9d26-d7c627d24367` published
[trial #170](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/170)
at `dd79737de3721e570c42e8857bcaa47ce4fc22aa`; its
[required CI 36999021723](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36999021723)
passed. These checks alone are not staging or production acceptance.

Release ID is `6051d044-a68a-47cb-8c19-e8592e3b9526`. Its staging operation
`a6d9f4d5-e245-4418-9f6b-2455f38a660c` saved `integration_version: 2`,
the independently expected combined tree, the one-file SHA-only patch and both
captured parents before publication. GitHub independently read back integration
commit `ec69a2a369531435a1d615a9debb376a84c86618` with tree
`3235593c3afc9b5cce23e205edc6c986ebc1feaa` and parents
`8d4cdb58b0172f2cffac148ba30c96ab552a7f9f` /
`dd79737de3721e570c42e8857bcaa47ce4fc22aa`. Its complete recursive tree
retained all five staging-only document blobs unchanged.
[Staging PR #171](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/171)
passed fresh
[CI 36999668751](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36999668751)
on that exact integration head. The Coordinator verified its staging merge at
11:14:16 UTC. The actual merge is
`ff9168a3cfbfde8d1aaba44702fed72006e30056`.
[Staging deployment 36999844705](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36999844705)
and [matching E2E 36999957724](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36999957724)
passed. The automatic dispatch wrapper is
[36999948046](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/36999948046).
The downloaded `fake-staging-deployment-36999844705` artifact (ID
`11222424815`, digest
`6d9b8298a12c4378b317409e273adce57a7c67de86cc88a4328726d7de0f490b`)
independently passed built-file/hash/source verification. Its deployment record
names the exact staging merge and run; manifest fingerprint is
`93d52d13ba2d61124dae0d5cd65593c30308b8613cb536ba21c34b4632a69c62`.
Actual E2E job steps resolved and checked out that deployed source, downloaded
the selected deployment and passed its built-output tests. The E2E workflow's
own head is main, not the deployed SHA; its dispatch title binds to deployment
`36999844705`, as the existing matching-chain contract requires.

[Production PR #172](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/172)
passed fresh
[CI 37000256241](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/37000256241)
at `d9124baee9f5265af546917d5fdbaf61365ca3ee`. Independent GitHub commit
readback confirmed selected tree `7bfed85693dee5f0f7a207d274edea135e466c00`
and candidate parent `dd79737de3721e570c42e8857bcaa47ce4fc22aa`, not the
staging tree/parent. Its complete recursive tree contains the clean fixture but
none of the five staging-only documents. GitHub merged #172 at 11:20:06 UTC as
`55cde5f7fca54c2d64472f07f6e90badf710eb29`.
[Fake-production deployment 37000619534](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/37000619534)
and [matching read-only E2E 37000729111](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/37000729111)
passed. Their automatic dispatch wrapper is
[37000720538](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/37000720538).
The downloaded `fake-production-deployment-37000619534` artifact (ID
`11223771991`, digest
`39672d5672aeee678b9267bc15350e9cfc236666c17d173bd62a5139706f458b`)
passed independent file/hash/source verification, with manifest fingerprint
`5cbe388e4953993d937c69c7dbee1a984748c9bfc58267c2b9cef9a1395fd75d`.
For both deployment artifacts, independent assertions matched the complete
deployment-evidence JSON and manifest-file checksum to the actual successful
GitHub run and its exact source. Actual production E2E job steps downloaded,
verified and tested that selected deployment; its title binds to run
`37000619534`.

Final shared-ref readback matched the saved release exactly: staging is
`ff9168a3cfbfde8d1aaba44702fed72006e30056` / tree
`3235593c3afc9b5cce23e205edc6c986ebc1feaa`; main is
`55cde5f7fca54c2d64472f07f6e90badf710eb29` / tree
`7bfed85693dee5f0f7a207d274edea135e466c00`. Their actual merge parents
match the captured environment bases and the separate integration commits.
All five staging-only blobs remain unchanged on staging and absent from main;
both backend refs remain at their initial values. Original source PR #168 is
marked merged at its unchanged pinned head, with its source merge saved in the
production operation. Trial #170 is closed unmerged, and its branch plus both
owned release branches are independently absent.

Ticket #58 closed at 11:25:40 UTC with completed/release-completed labels and
links to all six passing operations. Release completion is recorded at
11:24:53 UTC. Journal revision **4749** at
`dc26ccdc77a8ba039ca738ac32162cf6d549df6b` has a null lock and the completed
batch in its normal verified archive:
`history/batches/cf4b10ded9684599c3d690ba5051a89b84cf815787f6592cafbd2673e9107e02.json`.
Independent archive validation passed its identity, profile, checksum, terminal
history, cleanup and evidence summary; all six saved operations passed, and
all four deployment/E2E report hashes independently recomputed correctly.
The existing archived history was not replaced or reset. No inbox-runner
process remained after completion.

## Evidence limits

Source PR CI and local checks alone are not deployment proof. These live cases
include the saved exact release operations and independent GitHub/artifact
readback described above.
New-blob reconstruction, tampering, interrupted response reconciliation and
cancellation remain offline coverage unless explicitly listed as live cases.
No real ticket was run, no real journal lock was changed, no product source was
pushed or deployed, and no npm publication or Coordinator PR merge is included.
The real journal was independently re-read unchanged at revision 598 with a
null lock, and the #285 watcher remains paused. The scoped Coordinator source
and regression tests stayed unchanged throughout both runs and match their
corresponding files in the shared checkout. Other concurrent changes were not
used for acceptance or modified by this work.

The app's existing 100-attachment limit prevented attaching new test PRs.
Their verified links remain in this record; no unrelated attachment was removed.
