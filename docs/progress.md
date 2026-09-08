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
| Local inbox reader | Implemented and committed locally as `6af610a`. It is not yet pushed or merged into remote `main`. | [Reader guide](../apps/coordinator/README.md). All 71 local tests passed: 22 CLI tests and 49 reader tests. |

At this check, Coordinator remote `main` was
`9e69d60a64e8d0bbceda9abd9c3ae8df1b77c33f`. Local commit, remote merge,
package publication, and deployment are separate milestones. Update this record
when those states change rather than inferring one from another.

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

This proves public-package delivery from the frontend checkout and read-only
inspection of saved requests. A backend-originated live submission after PR
#1977 is not recorded as verified here. A merged backend integration is not
proof that this separate runtime path has been exercised.

## What the system does not do yet

The reader checks the saved JSON and its workflow evidence. It does not check
current PR readiness, resolve dependency graphs, choose the latest wanted
request, or approve a deployment. It makes only GitHub GET requests.

There is no running Coordinator worker, durable release queue/database,
GitHub App with merge authority, automatic merge/build/deploy flow, or recovery
engine. Product repositories still use their existing authorized release
procedures. Recording a release intent is observation only.

## Proposed next work

1. Share the local reader through the normal PR/check/merge path. No npm
   package release is needed for this private application.
2. On the next authorized backend release or separately authorized controlled
   test, record backend-originated delivery evidence without duplicating a
   combined frontend/backend request.
3. Add a separate read-only readiness check for current PR heads, repository
   rules, checks, and request dependencies. Finish when it clearly reports
   ready, blocked, or unverifiable with reasons, without making release changes.
4. Before implementing any release execution, settle the three
   [design disagreements](./design.md#decisions-to-settle-before-execution).
   Define the worker's permissions and durable state after that.

Old test/pending requests will need deliberate disposition before a future
worker may consume the inbox. Documentation housekeeping does not close Issues
or change their labels.

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
