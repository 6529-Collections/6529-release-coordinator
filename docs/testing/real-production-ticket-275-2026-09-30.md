# Real production ticket #275: pin refresh and production review pause, September 30

The user authorized one real-profile, filtered production run for
[Issue #275](https://github.com/6529-Collections/6529-release-coordinator/issues/275),
verified actor `simo6529` (GitHub ID `209783236`). It selects only frontend
[PR #4120](https://github.com/6529-Collections/6529seize-frontend/pull/4120) at
`4ccf9b27fac235ea151aa6ed169a52797ead855f`, with no database change or dependencies.
Coordinator `main` was `a605c0f472b40a236b009317a013756eccba104c`.

## Original stopped run

Run `43c83236-e05c-438f-a664-0d2aea5f40d1` passed intake, exact PR rehearsal,
combined Git checking and all 20 candidate checks on temporary frontend
[PR #4131](https://github.com/6529-Collections/6529seize-frontend/pull/4131).
The trial PR was closed unmerged and its owned branch removed. The saved batch
fingerprint is `25e7f2642c5e43e1fa561748ad419e493659e1ece49d3255662e88036d6e50e4`.

Runtime verification stopped the command before release authorization with
`release-runtime`. Journal revision 397 retained the same run lock, ticket `[275]`,
filtered actor scope and `execution: null`. The original process exited 2.
No staging or production integration, deployment or E2E was started by this run.

## Reviewed file change

Frontend `1a-staging` at `97b4239bbd1ea18f6e6362633a1647a1e20f34f6` contains
`.github/workflows/deploy-staging.yml` blob
`c573f80b55aa46b2bb96259dee07b98c231d30b7`. Comparing its full contents to the
previously approved blob `36d10cd5f855d1510c5f2c6ffced7baf86db3987` found exactly
one added environment-variable line:

```yaml
NEXT_PUBLIC_FEATURE_MULTI_COMPETITION: "true"
```

[Frontend commit f371fc5](https://github.com/6529-Collections/6529seize-frontend/commit/f371fc5471e6501521e3e0582a33255328a346b8)
added it on September 29. Workflow triggers, dispatch inputs, build/deploy steps
and permissions are unchanged. This review approves the workflow identity, not
independent proof of the feature's runtime behavior.

Frontend `main` at `780d49bfd8f87afeb6fee27fe9ed8852d5636123` still has the old
blob. The Coordinator therefore stores distinct staging and production pins for
this file, using its existing environment-specific pin support. It does not
replace the shared pin with the staging blob, bypass runtime checking, or modify
either product repository. All other 23 environment/file combinations matched
their trusted pins at the original stop.

The regression test accepts these two exact reviewed blobs, rejects substituting
the production file on staging, rejects substituting the staging file on
production, and rejects both substitutions. The existing shared backend pin
regression remains covered.

The direct product-workflow adapter also has explicit staging and production
frontend deployment regressions. Each accepts its reviewed runtime pair and
normal branch/dispatch inputs, then rejects the other environment's staging
workflow blob before any GitHub write. These tests cover the adapter's separate
`verifyFiles` path, not only the shared identity verifier.

## Delivery and resume boundary

The full local check passed 663 tests with three optional Docker skips. A
read-only call to the real runtime identity verifier then accepted all pinned
files on the four current product branches, using only GitHub GET requests.
The separate npm security audit found three new `brace-expansion` advisories in
ESLint's development-only dependency chain. The lockfile refresh from `5.0.9`
to patched `5.0.12` retains its dependency range, engine requirement and license;
no public CLI production dependency changes. A fresh script-disabled locked
install and the full local check passed again (663 passing tests, three optional
Docker skips); the same required npm audit now reports zero vulnerabilities.
After the review-requested direct product-adapter regressions were added, the
full local check passed 665 tests with three optional Docker skips and the audit
again reported zero vulnerabilities. Remote PR delivery is separate and pending
at this point. The user
authorized the narrow fix, checks and continuation of #275. Resume must preserve
the original run ID and filter, confirm the original process is stopped, and
freshly verify runtime files, source PR and branch inputs. New drift must stop
again; the reviewed pin refresh is not blanket approval for future changes.
Successful candidate checks and the pin refresh alone do not prove a release.

## Merged delivery and authorized resume

Coordinator [PR #277](https://github.com/6529-Collections/6529-release-coordinator/pull/277)
merged at `1337a0ab156a80884b4fa7bdec1239f8dd29983a` from tested head
`b1289339f2dca76b3cf2f63cd04653892ad3b54d`. Required package checks, all three
Node versions, both CodeQL language jobs and Snyk passed. CodeRabbit completed
its included final review without actionable findings; general, security,
deployment and follow-up reviews also completed on that head without blocking
findings. The GLM advisory job returned empty output from all reviewer slices
on both attempts. The user explicitly approved proceeding with that coverage
gap. No review configuration, provider, billing setting, required CI or product
release gate was changed or waived.

The local checkout fast-forwarded to this merged `main`, remained clean before
execution, and passed the full check again (665 passing tests, three optional
Docker skips). A GET-only live runtime preflight matched the trusted files.
The same PR head, open ticket, actor and retained run lock were freshly checked;
the previous process was stopped well beyond the documented 60-second boundary.

The same-run command started at `2026-09-30T09:00:09Z`:

```sh
RELEASE_COORDINATOR_PROFILE=real RELEASE_COORDINATOR_SCOPE=filtered \
  npm run --silent inbox:run -- --resume 43c83236-e05c-438f-a664-0d2aea5f40d1 --json
```

Invocation `85148ec6-0330-4740-874e-57797dc100ef` resumed the original run and
saved journal revision 398 with only Issue #275 and verified actor `simo6529`.
The receipt scan completed at 09:08:08 UTC, and #275's intake and identity checks
passed. The release snapshot captured frontend staging
`b8030074ac81d29d14468119c7e5f9fa607505fe`, backend staging
`a4dcdd7036b67edd2bd1be9af0f9b18c1022b6f7`, frontend production
`780d49bfd8f87afeb6fee27fe9ed8852d5636123`, and backend production
`62c37a1d764162d3f5c67a9e3643babe61301ec5`.

The Coordinator waited for existing product workflows to become quiet without an
elapsed-time cutoff. The other developer's staging deployment 36693856031,
earlier staging E2E 36692267435 and automatic staging E2E 36695084209 all completed
successfully. These are not #275 deployment or test proof.

At `2026-09-30T09:30:49Z`, the Coordinator merged owned frontend staging
[PR #4133](https://github.com/6529-Collections/6529seize-frontend/pull/4133) into
`1a-staging` at `5054276baf42622b9a4599f2c3d40dcc420635a0`, tree
`c196e1921ba7fa1d3925fa1e34844732203a3d4a`. Its owned integration branch was
removed. Journal revision 413 records the completed staging integration and
prepared staging deployment. Frontend
[staging deployment 36696554520](https://github.com/6529-Collections/6529seize-frontend/actions/runs/36696554520)
passed on that exact commit at 09:40:50 UTC. Its normal staging E2E dispatch
36697648805 linked to
[E2E 36697661172](https://github.com/6529-Collections/6529seize-frontend/actions/runs/36697661172),
which passed at 09:50:07 UTC. The E2E workflow code ran from frontend `main`, but
its deployment evidence identifies staging commit `5054276baf42622b9a4599f2c3d40dcc420635a0`
and deployment 36696554520; the workflow head alone is not the tested deployment.
The Coordinator accepted that matching result at 09:50:21 UTC with backend
staging still `a4dcdd7036b67edd2bd1be9af0f9b18c1022b6f7`.

Journal revision 425 recorded owned frontend production
[PR #4134](https://github.com/6529-Collections/6529seize-frontend/pull/4134) open
against `main` at integration head `0e517177a6683500d65d8c6fb29a946baf0a9f47`.
It then passed all 18 check runs and both commit statuses, including the exact
required set, application build/browser/quality checks, CodeQL, SonarCloud,
CodeRabbit and Snyk.

## Production review pause and terminal verification

At `2026-09-30T10:03:19Z`, GitHub still reported `BLOCKED`. The Coordinator saved
`awaiting-review` for the same integration PR and did not merge production or
start any later release step. Its ticket update completed and the invocation
exited 1 at `2026-09-30T10:03:58Z`. The Node process was independently confirmed
absent; the journal pause is not a running background retry.

A read-only GitHub query found one current, unresolved
[Codex reviewer thread](https://github.com/6529-Collections/6529seize-frontend/pull/4134#discussion_r4143330904),
`PRRT_kwDOIoLqM86nevn_`, on `components/waves/drops/WaveDropQuote.tsx`. It reports
that Enter/Space on a nested Show more/Show less button can bubble to the quote
card's keyboard handler and navigate to the quoted post instead of expanding
the text. This is a reported product-code issue, not a failed CI job or the
optional GLM review failure on Coordinator PR #277. The frontend rule requires
review-thread resolution. The existing missing-approval bypass does not permit
ignoring unresolved review threads; no bypass or silent resolution was attempted.
This readback identifies an actual unresolved blocker but does not assert that
it is the only applicable GitHub merge condition.

Journal revision 428 retains the original run ID, filtered Issue `[275]`, actor
`simo6529`, batch fingerprint, owned production PR/branch and lane lock. The
ticket remains open with `status:waiting`, `batch:waiting` and
`reason:release-review-pending`; its existing public status comment records the
three successful staging operations and the production pause. Other tickets
were not selected. This retained lock blocks another Coordinator release, not
unrelated manual developers or Actions.

Final branch readback confirmed frontend staging still
`5054276baf42622b9a4599f2c3d40dcc420635a0`, backend staging still
`a4dcdd7036b67edd2bd1be9af0f9b18c1022b6f7`, frontend production still
`780d49bfd8f87afeb6fee27fe9ed8852d5636123` and backend production still
`62c37a1d764162d3f5c67a9e3643babe61301ec5`. Source PR #4120 remains open at its
original pinned head. No production merge, deployment or E2E occurred, no backend
deployment was selected, and no restoration was performed for this review wait.

Next: handle the linked product review, then explicitly resume the same run to
revalidate its saved inputs. If a code fix changes the saved PR/head, follow the
normal changed-input decision rather than editing journal evidence or assuming
the previous deployment/test results cover the new code. A separate explicit
`--review-stop` choice can stop this release through ordinary recovery; it was
not selected here. The successful real staging path and real review pause do not
establish a completed production release.

## Fixed source and explicit stop attempt

The frontend task completed the keyboard fix on source PR #4120 at
`bc220ad0f6c05f98259940cd295e0089709b330b`. A fresh GitHub readback confirmed
all 18 check runs and both commit statuses passed on that head. Its task report
and public audit record 57 focused unit tests and six desktop/mobile browser
checks passing. The owned integration PR #4134 was deliberately not changed;
those new results do not cover its frozen old code or update #275's receipt.

After the user authorized ending the old attempt and testing the fixed version,
the preflight found unrelated branch movement: frontend staging
`3afa54af09c4f5a760c522f8283ac456481efdc5`, backend staging
`b9c0f960ad28740932bb78c288dd82a9ffa1c18d`, frontend production
`bcbec614a4487970920c1199b931e30e2fd5eada` and unchanged backend production
`62c37a1d764162d3f5c67a9e3643babe61301ec5`. Both new staging refs are descendants
of their saved versions. Frontend production advanced through unrelated PR #4135.
Restoring the old snapshots over this work is not authorized.

The approved stop command started at `2026-09-30T10:57:31Z`:

```sh
RELEASE_COORDINATOR_PROFILE=real RELEASE_COORDINATOR_SCOPE=filtered \
  npm run --silent inbox:run -- --resume 43c83236-e05c-438f-a664-0d2aea5f40d1 --review-stop --json
```

Journal revision 429 retained the original run and only #275 / `simo6529` during
the receipt scan. The scan and immutable receipt checks passed. The explicit
stop choice was saved at revision 430 as `cleanup_reason: review-stop` on the
same owned production integration operation, with execution status `running`
and the former review-pause projection removed.

The invocation exited 2 at `2026-09-30T11:05:46Z` with:

> Staging moved after production work may have begun. Inspect the saved production operation manually before reconciliation.

The first-production staging guard runs before integration-PR cleanup. It refuses
the saved production operation in `checking` state even for explicit review stop,
so no call reached the product integration adapter. This exposes a cleanup gap:
the existing command cannot close this still-open, unmerged owned PR after
external staging drift. If that guard were simply skipped, the ordinary stop
would request snapshot restoration and encounter the separate advanced-ref
guard; bypassing either check is not a safe continuation.

Independent readback confirms both processes stopped, PR #4134 still open and
unmerged at its original owned head, the ticket still open with its previous
review-pending labels, no recovery record and no production deploy/E2E operation.
The retained `running` journal status is saved unfinished work, not evidence of
a live process. Stop invocation `d07fe077-803b-4dbf-a2f7-ac09223f4522` selected no
other ticket. No replacement request, merge, deployment or restoration occurred.

By the terminal branch readback, external work had advanced the refs again:
frontend staging `aebaa84218139e741d85c1caee5f3bfa447c053d`, frontend production
`d77b017e3d925f57672e04dd213de4ff71d1301c`, backend staging
`b9c0f960ad28740932bb78c288dd82a9ffa1c18d` and backend production
`75d042d687865fa333a0f68fc60b543190a2f789`. These are new observations, not this
stop command's deployments. Shared-ref movement does not imply that this
Coordinator process is still running or that unrelated developers are blocked.

Completion now needs an explicitly agreed cleanup choice that closes only the
verified owned PR, records stopping without claiming restoration or completion,
preserves the current external branch versions and releases the lane truthfully.
That behavior is not implemented or authorized by merely skipping guards. Do not
retry `--review-stop` against the saved `running` state, manually clear its lock,
reuse old test results, or submit a new execution around the unfinished release.

## Explicit keep-current cancellation implementation and preflight

The user subsequently authorized implementing, testing and applying a separate
cancel-without-rollback option. `--resume RUN_ID --cancel-keep-current` uses the
same engine and exact-owned-PR cleanup in both profiles. It requires confirmation
of no database change and an owned unmerged integration PR, or its interrupted stop;
it refuses other production operations or recovery. Intent and the operator are
saved before cleanup. It does not merge, dispatch, recreate a branch, restore
code or modify shared staging/main refs. Interrupted cancellation can only
continue cancellation.

The full local `npm run check` passed twice, including the final executable
source: 681 passing tests and three optional Docker skips. The 16 added cases
cover CLI forwarding and invalid combinations, moved staging/main refs,
interrupted stop/cancellation, bad cleanup results, database/production ambiguity,
durable state validation, multi-ticket closeout, both real/sandbox adapters,
wrong ownership, missing/moved branches, an already merged PR, and lost close/
delete responses. Normal recovery and release checks remain unchanged.
These are offline simulations, not a live sandbox cancellation campaign or
proof of the fixed frontend's deployment.

A read-only simulation against the actual revision-430 journal also passed:
it validated the saved #275-only selection and stop intent, inspected the live
owned PR/head/branch and current refs, then used those exact inputs in the real
adapter with all mutation calls replaced by in-memory responses. The only
simulated product writes were closing PR #4134 and deleting its exact owned
branch. No real product write occurred in that simulation.

Preflight observations: PR #4134 was still open/unmerged at
`0e517177a6683500d65d8c6fb29a946baf0a9f47`; `simo6529` was the authenticated
operator (ID `209783236`). No old inbox process remained. Observed refs were:

| Environment | Backend | Frontend |
| --- | --- | --- |
| Staging | `b9c0f960ad28740932bb78c288dd82a9ffa1c18d` | `b2dd25d91c457ef932eac19e1b48d259d9c86c1b` |
| Production | `75d042d687865fa333a0f68fc60b543190a2f789` | `12fd63db95ada39ba091c3a85ebee7d4d68a230d` |

The authorized live command started at `2026-09-30T11:51:38Z`, invocation
`8de3d8e2-e452-42e4-b462-10fbafa11810`:

```sh
RELEASE_COORDINATOR_PROFILE=real RELEASE_COORDINATOR_SCOPE=filtered \
  npm run --silent inbox:run -- --resume 43c83236-e05c-438f-a664-0d2aea5f40d1 --cancel-keep-current --json
```

It uses local uncommitted implementation on merged base
`1337a0ab156a80884b4fa7bdec1239f8dd29983a`. For reproducibility, SHA-256 hashes
of the executable files used are:

| Source under `apps/coordinator/src/` | SHA-256 |
| --- | --- |
| `release-cancellation.mjs` | `5296d537caca95e944156600a4c84ec9e9961531762ca720a73775ea57672198` |
| `release-execution.mjs` | `069efb6c5f7f3900de20aa7582ff7fcf5b1e6ac81adfb3e3fe4523653712f638` |
| `release-github.mjs` | `bd86dfefec895b59df37547b61e4b893dc8b3ba1667b7a2d2612eb3a987495ac` |
| `inbox-processor.mjs` | `b94079d8534877ab9a45e91b876d75b6c5849dfdb396c348ad47f72025852bfc` |
| `inbox-run-cli.mjs` | `f127e68f63dd1a8b266dbb62eb62989c390be4bc5b7224449e8172f978846567` |
| `inbox-batch.mjs` | `b9b757f23deb1e88b7fc34fcc07523f2318b0cfe6c04fd7cfd118a3e2ae51c0c` |
| `inbox-ticket-writer.mjs` | `f37ed0728d10338b15dfc45b87dbb47323391b4023064dfed513f95648e26647` |
| `release-state.mjs` | `05c03ff200536073fe3c60ba828bd5554922a169b37f5437f5a108d09015a876` |
| `ticket-presentation.mjs` | `a0cbf12471be405c51d95ea7aeb2df97192ed796612633f7ad2afb19732f1b72` |
| `product-workflow-release-github.mjs` | `62df8296582a3ba48063a342ff4bc17b4ad9da357c08d8fe80ae72823aa57368` |

## Verified cancellation outcome

The command finished at `2026-09-30T12:01:32.384Z` with exit 0 and complete
local logging. Receipt verification took 456.8 seconds and retained only #275 /
`simo6529` for processing. Cancellation saved its explicit operator/intent before
cleanup, closed the verified owned PR at `2026-09-30T11:59:57Z`, removed its exact
branch, and confirmed cleanup at `12:00:19Z`. Execution became `cancelled` with
completion time `2026-09-30T12:00:20.834Z`. The same ticket was presented and
verified as closed, then the original journal lock was released normally.

Independent readback after the process exited confirms:

- Journal revision **438**, commit
  `21c5df35bb4007e97ae33cef8e66d5236c27a4c1`, validates with `lock: null`.
- #275 is closed with GitHub reason `not_planned`, saved terminal `closed`
  decision, `reason:release-cancelled` and `outdated-commit`. The changed source
  head remains recorded as different; old tests are not promoted into new proof.
- #4134 is closed and **unmerged** at its original integration head. Its exact
  owned branch is absent. Integration commit `0e517177a6683500d65d8c6fb29a946baf0a9f47`
  is still readable, so deleting the temporary branch did not erase that code.
- The before/after environment refs and independent current-ref readback all
  match the table above. No shared branch was merged, reverted or restored;
  no workflow was dispatched by cancellation. The saved release still has no
  production deploy/E2E or recovery operation.
- Source PR #4120 remains open and unmerged at
  `bc220ad0f6c05f98259940cd295e0089709b330b`. This cleanup did not deploy its fix.
- Original npm/Node PIDs 21581/21665 are gone. The local invocation's complete
  log remains at the previously recorded run path.

The real cancelled record currently remains complete but inactive in the
working journal. A post-run local change makes such verified cancellations
eligible for ordinary archival with an explicit `cancelled` summary, preserving
all attempts and evidence. The cancellation disposition also stays terminal if
the old batch later becomes stale: cancelling is not a claim that its code passed
new release tests. Offline tests verify that projection, multi-ticket archive
readback and rejection of unverified cleanup. These additions were made only after the live process
stopped, so it was not part of the executable hashes above and has no live archive
acceptance yet. It makes no extra real journal write in this task.

At the time of live cancellation, source and documentation were local and
uncommitted. The cancellation implementation and later history hardening are
submitted in [PR #282](https://github.com/6529-Collections/6529-release-coordinator/pull/282).
This acceptance record covers the live cleanup, not that PR's remote delivery.
A replacement request, fresh test of the fixed source head and production delivery remain
separate. No new release ticket was created by this cancellation.
