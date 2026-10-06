# Frontend Wave-creation PR-CI review — October 6, 2026

## Scope and provenance

The user approved reviewing the changed frontend PR workflow, updating only
Coordinator support through normal tests/reviews/PR merge, then continuing the
same isolated #311 run. No product code, workflow settings, backend pins,
package publication or live release was changed during this review.

At frontend main `faa7ea95a28d059d18fe2ddcc4d6b08d27710938`, the complete
`.github/workflows/app-pr-ci.yml` blob is
`134e53f46bfe207742adcc4fec392128bec75ab8` (71,416 bytes). The complete
superseded approved blob is `0a506cbf14c340198c5273a560b0968d901cbebd`
(70,173 bytes). Both were independently fetched and rehashed with Git's blob
header. Their exact comparison contains 14 additions and no deletions or other
changes. Product commit
[`58823f7`](https://github.com/6529-Collections/6529seize-frontend/commit/58823f769e1a44a6cc4de1fe03ce72e3c0468b5a)
adds changed-path selection, a `playwright-wave-creation` matrix lane and its
browser-pack step. Existing checkout, action pins, permissions, concurrency,
runner validation, install and aggregate-check contracts are byte-identical.

## Effective check and safety contract

Wave creation, related drop creation, discovery/sidebar and localization paths,
the sandbox spec and this workflow select the additional lane. The existing
`core_playwright_required` output follows the nonempty lane matrix; the existing
`Installed app checks` aggregate requires successful core Playwright checks
when that output is true. No optional notification substitutes for browser
success, and the Coordinator's five required frontend check names are unchanged.

The referenced `test:e2e:wave-creation-sandbox` package command was read at
package blob `f4662d2d47f64ef65deadce62467087b5786b064`. It runs desktop and
mobile Chromium against local port 3298 with one worker, local authentication
and composer flags, and mock API port 4298. The referenced server at blob
`21e0fbe66ceda7947dbcfc92aba7fe49b13f3218` binds its API to loopback and
overrides application API/allowlist/WebSocket origins to that mock. The spec
at `5a16873b8957dfb8a8b49cf937b552a6b4b3e817` installs the local mutation
guard. That guard (`7f6aecd494bb80df93f237141d1baad6f7b521c1`) refuses
non-local test URLs, blocks external HTTP writes and asserts unexpected
mutations absent. Tests cover validation, draft restoration, explicit mock
creation and desktop/mobile layouts. These helper reads explain the reviewed
command; a workflow pin does not recursively pin helper content or prove test
execution. No product browser tests were run by this audit.

## Saved-policy transition

The current approval differs from the immediately superseded session-recovery
snapshot only in this frontend workflow blob. That historical full policy hash
remains trusted for exact saved reads and original workflow admission.
Unmodified original reviewed-policy preparations retain their existing refresh
route; unpublished session-recovery preparations gain the explicit route to
this current policy. Native-competition/copy-based snapshots, unknown modified
policies, downgrades, selected candidates, recorded trial/service resources and
release executions remain excluded. No policy limit is added or changed.

The existing engine must retire the empty old preparation, preserve original
attempt IDs/results, policy hashes and spent Git/check budgets, then revalidate
the same pinned request/source heads and rebuild on current main. Only fresh
candidate CI counts. Existing-owned work is not migrated, even if its cleanup
was recorded as removed. Staging/production deployment and matching E2E gates
and supported recovery remain unchanged.

## Evidence boundary

All 36 focused policy/admission/resume tests passed. They cover both approved
refresh sources on unchanged/moved main, preserved attempts and spent budgets,
fresh CI exactly once, interruption after retirement, recorded-resource refusal,
changed-source/failing-gate refusal, unknown policies and prohibited downgrades.
Full non-fixing Node 22.16.0 checks passed **953 tests**, with three optional
Docker skips (956 total), plus lint, formatting, docs, workflow policy and
packed-CLI gates; the wrapper verified source contents unchanged.

Seven guarded GET-only requests independently reproduced superseded-policy
`batch-runtime` refusal and new-policy admission against exact product main
above, with verified actor `simo6529` (`209783236`). The authoritative journal
was independently reread at revision 674, commit
`d7f11d733e657b7b99cf5c973f7904f6d381ccd2`; its exact filtered #311 scope,
original owned lock and unpublished attempts qualify for this narrow transition.
Neither readback mutated the journal or product repositories.

Configured remote reviews/CI and merge remain pending. No new live sandbox
acceptance is claimed. #311 is stopped before candidate publication with no
release execution; all old ticket histories are unchanged. Merge must precede
any separately verified continuation of the same saved #311 run.
