# Live run logging acceptance, September 11, 2026

## Scope and source

[PR #61](https://github.com/6529-Collections/6529-release-coordinator/pull/61)
contains the bounded sandbox batch implementation and v0.1 run logging.
The live process started from committed source `83b526a8497f080ca0b4f3122292891c202d5526`
on Node 22.16.0. Review fixes subsequently landed in `a45e213` and `21cf6f3`;
their local and PR checks are separate evidence from that already-running process.

Submitted one fresh staging request with `database_change: no`, using the existing
case C sample PRs. Request `0b13b331-ef7d-441c-8491-252b3d320967` arrived as
[ticket #13](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/13)
through the successful
[intake workflow](https://github.com/6529-Collections/release-coordinator-test-inbox/actions/runs/34569378561).
Its source PRs were backend
[#16](https://github.com/6529-Collections/release-coordinator-test-backend/pull/16)
at `540d7e93fbd85a20cd606580aab2049bc42d49eb` and frontend
[#14](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/14)
at `c595a09edd9f9b67e60764a2881863bc67b36ea8`.

Ran the ordinary unscoped command, without a manual plan:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run --silent inbox:run -- --json
```

## Live result: passed at the candidate and logging layers

Run `cd8418d6-d39a-4b83-b295-5633428615e2` lasted from 06:23:05 to 06:37:03 UTC.
Cheap filtering held older ticket #1 and selected only #13. One combined Git attempt
and one candidate check round passed; no splitting or unchanged-baseline test was needed.

| Evidence | Result |
| --- | --- |
| Backend [trial PR #21](https://github.com/6529-Collections/release-coordinator-test-backend/pull/21), [CI run](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34570069210) | Passed; exact combined tree verified. |
| Frontend [trial PR #19](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/19), [CI run](https://github.com/6529-Collections/release-coordinator-test-frontend/actions/runs/34570184747) | Passed; exact combined tree verified. |
| [Service workflow](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34570335690) | Migrations loop, worker, API and frontend passed in order; temporary database removed. |
| Trial cleanup | Both PRs closed unmerged; both owned temporary branches absent on readback. |
| Ticket presentation | Same managed comment `5630338172`, assigned submitter, `batch:passed` and `reason:batch-selected`. |
| Journal | Saved exact attempts and passing evidence; unlocked after completion. |

The command returned **exit 2**, accurately reflecting older ticket #1's existing
unverified rehearsal. Ticket #13 passed. The last log event names only #1 as
remaining work; it does not claim the whole inbox is clear. Ticket #1 stays open
with its hold, including missing service-prerequisite and destination-gate evidence.

After acceptance, `--issue 13 --close-test` retired only our new test ticket in
run `451136b5-64b5-4c99-a138-1ee2a592bcd5`, returning exit 0. Readback confirmed
`reason:test`, the unchanged request body and managed comment ID, preserved earlier
transitions, identical batch evidence and an unlocked journal. Only older ticket
#1 remains open. The retirement also produced a complete separate run log.

## Logging proof

The command produced one parseable JSON result with `logging.complete: true`.
Its private file contained **122 complete events**, with mode `0600`:

```text
~/.6529-release-coordinator/logs/sandbox/1362580376/cd8418d6-d39a-4b83-b295-5633428615e2.jsonl
```

A snapshot taken while Git work was still running contained the started event
and no finish event, proving logs were written during execution. Final assertions
verified cheap filtering before combined Git, then trial creation and checks,
service dispatch, cleanup, ticket updates and journal release. Trial-result events
contained the actual CI run IDs and URLs. Service results contained all four unit
names and their original workflow start/finish times; database cleanup was logged
only after the report was verified.

Before/after readback confirmed both sandbox main refs, source PR heads, pinned
runtime branch and the real inbox journal were unchanged. The runtime remains
`49d92ac76c9bf91520c82010afbae7f9e0fdbb39`. No product merge, package publication or
deployment occurred in this acceptance. The sample programs ran on GitHub Actions;
the command and diagnostic file ran locally.

## Review corrections and final code validation

Review fixed missing trial CI links, removed the workflow definition ID from
service-dispatch events, and added explicit service names to terminal result lines.
The live snapshot predates the latter two display changes; their regression tests
verify the final behavior. The JSON service events already contained their names.

Review also found a separate batch-evidence gap. A candidate whose complete trees
have no changes against saved main now stops during cheap preparation. It cannot
pass through an empty list of PR checks. Fresh, persisted and reused passing evidence
requires at least one actual trial. A real temporary-Git regression uses a PR that
adds and then removes its change; no expensive check starts. The inbox test fixture
now creates recorded trial identities, and its repeat assertion requires evidence
revalidation before reusing a candidate.

The final full local `npm run check` on Node 22.16.0 passed **376 tests**, with
**0 failures and 3 opt-in Docker cases skipped**, plus lint, formatting, workflow
policy, packed CLI/schema smoke checks and source preservation. Source `21cf6f3`
also passed [PR CI](https://github.com/6529-Collections/6529-release-coordinator/actions/runs/34570629958)
on Node 20, 22 and 24, the required `Check package` gate and CodeRabbit review.
The three optional Docker tests were not rerun for these changes; the live sandbox
service workflow above did run its isolated database checks.

Local receipts, input, stdout, stderr, live log snapshot, verification assertions
and remote readbacks are retained under ignored
`.release-coordinator/logging-acceptance-20260911/`. The run log remains outside
checkouts. Resume, interrupted cleanup and log-disk failure are covered by the
local acceptance tests; this live case did not deliberately crash or restart.
The known CT-09 overlapping-process gap remains open. There is no heartbeat,
automatic takeover, linked-ticket support or release execution in this delivery.
