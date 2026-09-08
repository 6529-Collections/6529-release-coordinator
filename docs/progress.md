# Progress and next steps

Last checked: **2026-09-08**. This is the dated progress record. Runtime behavior
comes from code and live evidence; the [future design](./design.md) is not a
description of a running release service.

## Implemented and verified

| Area | State | Evidence |
| --- | --- | --- |
| Public CLI | Exact version `0.0.4` is published on public npm as `latest`, with GitHub provenance. | [Publication run](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34096336628); public registry version, timestamp, integrity, and attestation link checked September 8. |
| Frontend installation | Public `0.0.4` is pinned in `main`. | [PR #3898](https://github.com/6529-Collections/6529seize-frontend/pull/3898), merged September 8 at `72f6ca467272a7995515ce7ea727a80d174840b5`; current manifest checked. |
| Frontend release recording | Instructions submit new frontend or combined release intents before release mutations. | [PR #3907](https://github.com/6529-Collections/6529seize-frontend/pull/3907), merged at `22c15717ff773580b3cd5b4a3f6ab717983611a1`; current `AGENTS.md` and deployment skill checked. |
| Backend release recording | Public `0.0.4` is pinned in `main`; backend-only intents submit from the backend. Combined releases reuse one frontend-owned request. | [PR #1977](https://github.com/6529-Collections/6529seize-backend/pull/1977), merged at `c52537a11b529b801cff614679e0914a62d4d686`; current manifest, `AGENTS.md`, and deployment skill checked. |
| Central inbox | The submission workflow validates requests and saves public GitHub Issues. | [Workflow source](../.github/workflows/submit-release-request.yml) and the live intake test below. |
| Local inbox reader | Implemented in `6af610a`; reader and documentation shared through [PR #14](https://github.com/6529-Collections/6529-release-coordinator/pull/14). Follow the PR for merge and check evidence. | [Reader guide](../apps/coordinator/README.md). All 71 local tests passed: 22 CLI tests and 49 reader tests. No npm release is required for this private application. |

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

The reader checks the saved JSON and its workflow evidence. It does not check
current PR readiness, resolve dependency graphs, choose the latest wanted
request, or approve a deployment. It makes only GitHub GET requests.

There is no running Coordinator worker, durable release queue/database,
GitHub App with merge authority, automatic merge/build/deploy flow, or recovery
engine. Product repositories still use their existing authorized release
procedures. Recording a release intent is observation only.

## Current scope and later work

The authorized scope is sharing the reader/docs through PR #14 and proving
backend delivery with the controlled test above. The delivery test is complete;
the PR is the source of truth for the sharing milestone. No new npm version or
product deployment is part of this work.

Readiness checking is **deferred at the owner's request**. A future separate
read-only check could inspect current PR heads, repository rules, checks, and
request dependencies, then report ready, blocked, or unverifiable with reasons.
Do not start that implementation as a continuation of this delivery test.

Before implementing release execution, settle the three
[design disagreements](./design.md#decisions-to-settle-before-execution),
then define the worker's permissions and durable state.

Old test/pending requests will need deliberate disposition before a future
worker may consume the inbox. The authorized cleanup above changed only test
Issue #15; it did not dispose of earlier pending requests.

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
result. The assessment and regression test are on branch
`codex/assess-fast-uri-boundary`.
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
shape, and the design file records future choices. The two HTML views have
different purposes: implemented intake/inspection and the proposed full
release process.

Completed migration checklists and the independent review were combined into
[one historical record](./history/npm-migration.md). Historical findings and
unchecked boxes are evidence from that time, not a fresh implementation queue.
