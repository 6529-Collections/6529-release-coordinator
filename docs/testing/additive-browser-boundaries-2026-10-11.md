# Safe browser-pack boundaries and saved-policy compatibility

## Scope and cause

The inspected frontend PDF workflow differs from reviewed baseline blob
`9209601a51023b4a17609fb7cdacb360a2e34977` by ten added lines only: one literal
lane registration and its matching sandbox test step. Its resulting blob is
`fa0bd0934b26148d3ca37d76b4f9d926e5052a3a`. Both additions precede Wave feature
tracking rather than Wave creation. The old contract refused their locations,
not the PDF feature's behavior. No frontend workflow or PDF test is changed by
this Coordinator implementation.

## Admission contract

`additive-browser-packs-v2` accepts the existing paired literal templates at
safe boundaries derived only from the hash-verified baseline: top-level lane
registration boundaries after array initialization and before matrix output,
and browser-step boundaries after shared setup and before artifact upload.
It does not infer safety from candidate indentation or execute workflow code.

Every baseline byte must still match in its original order. Existing tests
cannot be moved, removed or weakened. Added check/lane/script/output names must
agree, remain unique and avoid baseline lanes. Arbitrary commands, conditions,
environment changes, runner/actions/permissions changes, failure suppression,
other jobs and other workflow pins remain refused. Product review, exact source
gates, fresh candidate CI and matching environment deployment/E2E gates remain
unchanged. No new dependency, budget or policy limit is introduced.

## Saved policy

The exact old policy remains trusted as historical state and explicitly calls
the unchanged `additive-browser-packs-v1` validator. Fresh preparation uses a
distinct v2 policy hash; the extension version is its only changed policy field.
An unselected, unpublished, non-retry v1 preparation may use the existing
guarded preparation-refresh path. Published or selected work cannot silently
use that transition.

For a verified untouched selected release, the existing explicit
`--refresh-untouched-release` admission permits only the exact reviewed v1-to-v2
pair. All original eligibility, absence, stable-ref, source and new-main checks
remain required. Refresh version 2 saves the full target policy alongside the
complete original checkpoint and its hash, without changing old inputs,
attempts, policies or archives. The new durable writer marker refuses older
writers and cannot be removed or downgraded. A check-retry child additionally
binds the retired checkpoint by fingerprint and record hash; its original
failure and actor authorization stay intact. Fresh Git/CI are required and all
spent attempts continue to count against the same aggregate budgets. No live
saved policy or journal is migrated by this implementation work.

## Offline verification

Focused tests reconstruct the exact inspected PDF blob in its original
locations, cover 81 safe registration/step combinations, compile planning
JavaScript without executing it, and reject unsafe positions, baseline edits,
test movement/deletion, mismatched pairs, duplicate lanes and injected behavior.
Adapter tests distinguish current v2 admission from historical v1 refusal.

Fake-store recovery tests cover the explicit policy transition, unchanged old
records and archives, fresh checks, spent budgets, repeated flags, interrupted
saves and ordinary-resume refusal. Forged checkpoint hashes, authorization,
policy/source changes and missing or downgraded writer markers are refused.
Existing unchanged-policy recovery and preparation-refresh cases remain covered.

Full non-fixing Node 22.16.0 repository gates passed with all 54 test files run
serially: **1206 passed**, three optional Docker skips (1209 total), zero
failures. Lint, formatting, documentation links, workflow policy and isolated
offline packed-CLI checks also passed. Source contents stayed unchanged during
verification; the final evidence-only documentation update was checked
separately.

This is local source and offline test work only, not hosted CI, protected merge,
publication or live recovery proof. Deployment and both scheduled watches remain
paused. No live journal, request, lock, product workflow or source was changed.
