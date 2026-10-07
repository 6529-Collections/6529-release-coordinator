# Unchanged staging tree publication — October 7, 2026

## Exact stopped attempt

Fresh frontend ticket #326 retains request
`6f0b412a-0094-45e2-b6b7-ba180f8f8cc1`, checksum
`2a9b804d24b2f1ab289ba569277d733c2d00cea17383ebff5a34a83b7dc69889`
and source PR #4120 at `6488108007507eff7c1bed524a0d0f5a61a7fe91`.
The saved filtered scope contains only #326 for `simo6529` (ID `209783236`).
Its run is `c8a6be6f-dbdf-4429-a44c-a3971c00a611`, release execution
`c851b8fc-4d87-4fd4-8c86-49f58bcb624a` and first staging operation
`ae7ae566-e508-46fe-810b-8c0590a9a1dc`.

Journal revision 743 at `2288fd4d956ffabb35d655ba05fcb280fdec0f02`
was independently reread on October 7 at `04:57:04.770Z`. The operation remains
`commit-prepared` with no integration commit, branch, PR number or result saved.
The original run finished with exit 2 on October 6 at `15:28:23.194Z`; process
and scoped request absence were verified after settling, and again on October 7.

The immutable staging preparation records:

- base `c63995b31e934754990e288f712a8b3f59dfa3af`;
- base tree and prepared tree both `c22180fa9cc98529bd8744a1c9f5db976008a0d8`;
- candidate `e197bb991529aced503df112099bfc904653adc9`;
- candidate tree `903638331a19e97037a96f99288dcaf2df149fc0`;
- patch `[]`, with deterministic integration parents `[base, candidate]`.

The live staging and main refs remain unchanged from the saved release plan.
Owned candidate trial #4189 was closed unmerged and its branch removed by the
engine. No shared staging/main merge, deployment or E2E completion is recorded.
Candidate CI passing is separate evidence, not deployment proof.

## Diagnosis and narrow fix

The adapter unconditionally posted `/git/trees` with `tree: []` after verifying
the staging base. The original log retains only generic HTTP 422, not the
endpoint or error body, so the precise original server rejection is unproven.
[GitHub's Git tree API](https://docs.github.com/en/rest/git/trees) describes
overlaying entries on an existing base tree and documents validation errors;
that documentation alone does not prove this original failure's cause.

An offline real-Git fixture now rejects empty tree creation with a controlled
HTTP 422. Both profiles' new success and interrupted-resume tests failed on the
original adapter with that error. This is an offline reproduction of the
unnecessary-write failure mode, not a new live GitHub mutation or server proof.

For an empty patch, validation requires prepared tree equals base tree. After
the existing fresh staging ref/base commit/tree readbacks, the adapter reuses
that tree without any blob or tree write. It still creates its unique signed-off
two-parent integration commit, verifies ancestry and exact checked tree, obtains
fresh PR checks, merges normally and cleans only its owned resource. The
deployment/E2E, account, source, rules and workflow gates are unchanged.

The exact saved `commit-prepared` checkpoint resumes without another rehearsal
or replacement preparation. Moved staging refs, changed base trees and an empty
patch claiming another tree are refused before GitHub writes. Existing non-empty
patch publication, conflict, cleanup and interrupted-response coverage remains.
Two older synthetic adapter/engine fixtures incorrectly paired empty patches
with different trees; each now represents its changed tree using a SHA-only
blob entry rather than weakening validation.

## Verification and remaining boundary

Ten new regressions cover both sandbox and real profiles with temporary actual
Git repositories. All 165 focused staging/adapter tests passed. A GET-only read
of unchanged journal revision 743 at `2026-10-07T05:02:30.207Z` accepted the
actual saved empty-patch preparation and independently reproduced its unchanged
deterministic integration input. This is validation only, not release advancement.
Full repository gates passed on Node 22.16.0, with all 48 test files run serially:
970 passing tests and three optional Docker skips (973 total), non-fixing lint,
formatting, docs, workflow policy and packed CLI checks. Source contents remained
unchanged. Configured PR reviews/CI and merge are pending. The user authorized
the normal reviewed Coordinator fix and then an
explicit resume of only this same saved release; no resume has occurred here.
No product code, runtime pins, journal records, attempt budgets, unrelated
processes or old #311/#285/#294 history were changed. The release watcher remains
paused until the reviewed fix is ready for the independently verified same-run
continuation. Staging deployment plus matching E2E must pass before production;
production requires its own matching deployment and E2E proof.
