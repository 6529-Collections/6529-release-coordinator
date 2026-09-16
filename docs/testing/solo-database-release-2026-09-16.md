# Solo database-changing sandbox release — September 16, 2026

This acceptance used only the three Coordinator test repositories and the local
`codex/sandbox-staging-restore` branch. No real frontend/backend repository,
environment, database or deployment credential was used. It exercises one
complete ticket with `database_change: yes`; combining database-changing
tickets remains unsupported.

## First attempt exposed a built-output test error

[Sandbox ticket #24](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/24)
requested exact backend [PR #61](https://github.com/6529-Collections/release-coordinator-test-backend/pull/61)
and frontend [PR #58](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/58).
The Coordinator selected this ticket alone. Combined PR checks and its
[temporary MySQL/service check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35088280868)
passed. Backend integration reached protected test staging through
[PR #63](https://github.com/6529-Collections/release-coordinator-test-backend/pull/63),
and its database-loop and worker checks passed. The [API check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35089094960)
failed because the Coordinator's sample smoke test bypassed the worker and sent
the raw fixture row directly to the API. The sample app's actual path is
worker to API. This was a Coordinator test-runner error, not evidence that the
candidate's database change was broken.

The Coordinator stopped before frontend staging or test production. It did not
automatically restore staging because this was a database-changing ticket.
Ticket #24 stayed open with `status:action-needed` and
`reason:release-failed`. Manual readback found only the backend candidate on
test staging; the temporary MySQL database had been cleaned up. A protected
manual [repair PR #64](https://github.com/6529-Collections/release-coordinator-test-backend/pull/64)
restored the exact prior backend staging tree after required checks passed.
The ticket remains open as the failed attempt's evidence.

The smoke test was corrected to call the built worker before the built API, with
a regression test. The corrected runtime was published to both test repositories'
`main` and `1a-staging` through protected PRs, then checked by exact file blob.
A second ticket, [#25](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/25),
could not reuse the same source PRs while failed #24 owned them. It was closed
with the verified test-ticket closure path; it did not perform a release.

## Fresh candidate and restart observation

Fresh backend [PR #67](https://github.com/6529-Collections/release-coordinator-test-backend/pull/67)
at `6f8f8f18736fe0b5c1fff378db1ccbcaee8e5f6e` and frontend
[PR #62](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/62)
at `c910c6cc39ed46559205e548da4dc33a89f7a3e3` passed normal source PR
checks. [Ticket #26](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/26)
requested these exact heads with a database change. The unscoped sandbox run
selected #26 alone.

During temporary PR creation, GitHub returned a transient 404 while the
Coordinator was saving its journal. The locked run retained its original run ID
`cf6528b2-bed8-4c94-a0d3-98b8a90145a2` and saved identities. Readback
showed the journal commit and backend trial [PR #68](https://github.com/6529-Collections/release-coordinator-test-backend/pull/68),
but no frontend PR. The saved frontend `creating` step occurred before the POST,
so the exact saved frontend branch, base, head, actor and body were used to
create [trial PR #63](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/63)
manually. Explicit resume adopted that PR and continued the same run. This
case required inspection; the Coordinator did not blindly repeat an uncertain
PR creation.

The two trial PRs passed required checks and were cleaned up. The combined
[temporary MySQL/service run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35093503876)
passed. Backend test staging integrated through
[PR #69](https://github.com/6529-Collections/release-coordinator-test-backend/pull/69),
then its database-loop, worker and corrected API checks passed. Frontend test
staging integrated through
[PR #64](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/64),
its build passed, and the matching [staging E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35095040764)
passed using built output and the changed sample value. Test production backend
integrated through [PR #70](https://github.com/6529-Collections/release-coordinator-test-backend/pull/70),
and the [database-loop check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35095514969)
passed. The [worker check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35095986919)
and corrected [API check](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35096344011)
passed too. Frontend test production integrated through
[PR #65](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/65)
after its required checks passed. The
[frontend build check](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/35096979945)
also passed. The matching
[production E2E](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/35097116805)
passed with built output and the changed sample value. Ticket/journal readback
is recorded below when complete.

## Final result

The resumed run completed all 14 saved release operations. Final readback
confirmed that test staging was at backend
`64572a2545c83b516f1fac0bf8f78cce33395a60` and frontend
`3f158dd4e1d4f53bd2992302f4b56a5f60817fbf`, while test production
`main` was at backend `e2461834e764870ecec58bd2e0ca10184b16d768`
and frontend `89a8ebb3e61ee78741df21d7e85461bbcdf9909e`. The four
environment integration branches were recorded as removed. The journal's
batch `f80a0b8c22aa4900209c723904cb664d5948e8dbfdc71d9f3d80d1474aab429a`
was archived as passed with its original attempt and evidence, and its run
lock was `null`.

Ticket #26 is closed with `status:completed` and
`reason:release-completed`. Its applied journal transition names the same run
ID. The command itself exited `2` because earlier failed sandbox tickets #22,
#23 and #24 still need human attention. That exit code does not undo #26's
completed release; it accurately reports unresolved work elsewhere in the
inbox. The fake database is temporary, so this proves the declared change on
sample data and the complete protected test-repository release path, not a
real database deployment or real product release.
