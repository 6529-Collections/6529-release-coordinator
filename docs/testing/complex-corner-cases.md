# Complex corner-case testing plan

Executed **CT-01 through CT-20 in numerical order on September 10, 2026**,
using Node 24.19.0. Results: **17 passed within the stated test layer, 2 partial,
and 1 ownership gap reproduced**. This is not a claim that every case passed
end to end on GitHub.

- **CT-05 — partial:** stale inputs stop the run and trials are cleaned, but the
  inbox's generic stale reason does not identify which repository base moved.
- **CT-09 — gap:** recovery cannot prevent a write that crosses the interval
  between an old owner's successful guard and its GitHub request. The documented
  requirement to stop the previous process before resume remains necessary.
- **CT-20 — partial:** today's intake rejects unsupported cross-ticket fields.
  Future dependency groups and splitting rules are not implemented or testable.

Most cases use the real Coordinator functions with controlled GitHub responses;
CT-03/04/05/13/18 also use actual temporary Git repositories. CT-14/15/17 ran
actual local Docker containers and temporary MySQL, with pinned runtime images.
CT-12 re-read [GitHub workflow 34479747515](https://github.com/6529-Collections/release-coordinator-test-backend/actions/runs/34479747515)
and verified that its genuine passing report cannot certify different inputs.
No new GitHub PRs, tickets or workflows were created for this campaign. All local
containers created by these tests were removed; no product deployment occurred.

The CT-09 automated assertion deliberately reproduces the current unsafe takeover
window. Its green test-runner result means the gap was reproduced, **not** that
its safety expectation passed. The per-case status below is the acceptance result.

A, B and C mean complete tickets, including their frontend and backend PRs.
Timing and failure scenarios ran locally with controlled GitHub responses.
Those simulations are not claims of operating-system crash or live GitHub race proof. Case 17
uses the existing single-ticket database path. Case 20 distinguishes today's
unsupported dependency declarations from future dependency support.

Related guide: [Sandbox merge and batch testing](../merge-rehearsal-testing.md).

## CT-01: A failure that needs three tickets

**Status:** passed (local)

**Result:** Controlled search: ABC failed; AB and C passed; the selected AB had its own passing check. C remained waiting, without individual blame. The initial test expected a different allowed subset; its assertion was corrected to the actual priority rule. Assertions passed. Local run: 2026-09-10T14:47:39.799490+00:00. Evidence: `.release-coordinator/corner-cases/CT-01.log`.

**Scenario:** A, B and C each work alone. Every pair also works. Only A+B+C
fails—for example, two backend changes together produce data that the third
ticket's frontend cannot handle.

**Expected outcome:** The Coordinator selects a combination it actually tested
successfully. It does not assume pairwise compatibility proves the whole group
works, or blame one ticket without evidence.

## CT-02: A third ticket repairs an incompatible pair

**Status:** passed (local)

**Result:** Controlled search selected ABC in one combined round even though the AB fixture fails. No unnecessary splitting. Assertions passed. Local run: 2026-09-10T14:47:39.987139+00:00. Evidence: `.release-coordinator/corner-cases/CT-02.log`.

**Scenario:** A+B fails, but C contains a compatibility change that makes A+B+C
work. All three combine cleanly in Git.

**Expected outcome:** The full group passes and stays together. The Coordinator
does not unnecessarily split it or assume that adding tickets can only make a
failing group worse.

## CT-03: One large ticket must remain indivisible

**Status:** passed (local)

**Result:** Real temporary Git repositories: ticket 2 contained four PRs; its final frontend PR conflicted with ticket 1. Only complete ticket 1 reached the check adapter; no changes from ticket 2 leaked into the selected trees. Assertions passed. Local run: 2026-09-10T14:48:41.807802+00:00. Evidence: `.release-coordinator/corner-cases/CT-03.log`.

**Scenario:** One ticket contains two backend PRs and two frontend PRs. Only its
final frontend PR conflicts with another ticket; its other three PRs would fit.

**Expected outcome:** All four PRs stay together through selection and splitting.
The selected code never accidentally contains three quarters of that ticket.

## CT-04: Service dependencies become circular only after combining

**Status:** passed (local)

**Result:** Local Git/catalog rehearsal accepted X→Y, Y→Z and Z→X separately and blocked their combined cycle without running application CI. This exercises graph validation with a local catalog fixture. Assertions passed. Local run: 2026-09-10T14:48:50.991492+00:00. Evidence: `.release-coordinator/corner-cases/CT-04.log`.

**Scenario:** In a local service-catalog fixture, separate tickets add
dependencies X→Y, Y→Z and Z→X. Each ticket's graph is valid alone; their combined
graph contains a cycle.

**Expected outcome:** Cheap checks identify the complete cycle before application
CI starts. The Coordinator never invents an execution order for an impossible
dependency graph.

## CT-05: One repository's main changes halfway through testing

**Status:** partial (local)

**Result:** With real prepared Git trees and controlled GitHub responses, backend main moved after both trial checks passed. Services did not start and both owned trials were cleaned. Limitation: the production inbox reason currently groups ticket, gates and main changes; identifying the specific moved base is not proven by this injected detector. Assertions passed. Local run: 2026-09-10T14:50:04.043717+00:00. Evidence: `.release-coordinator/corner-cases/CT-05.log`.

**Scenario:** Frontend checks pass against its saved base. Before combined
services run, backend `main` advances while frontend `main` stays unchanged.
Simulate this using local fixtures or controlled GitHub responses.

**Expected outcome:** The old combined result cannot become a current passing
candidate. The Coordinator records which base changed and cleans up its owned
trials.

## CT-06: The code stays unchanged, but approval requirements change

**Status:** passed (local)

**Result:** Full local inbox/batch flow: after the combined check passed, withdrawal of approval and introduction of a pending required check each cleared selection and left tickets waiting. No passing label survived. Assertions passed. Local run: 2026-09-10T14:50:12.633808+00:00. Evidence: `.release-coordinator/corner-cases/CT-06.log`.

**Scenario:** All tests pass. Before the final decision, an approval is withdrawn
or a new required check is added and remains pending.

**Expected outcome:** An unchanged commit does not bypass changed requirements.
The candidate waits until the current requirements are satisfied.

## CT-07: A ticket is withdrawn and replaced during its test

**Status:** passed (local)

**Result:** Closing A during completed service testing invalidated the batch and retained an interrupted run for explicit recovery. The replacement Issue and receipt were untouched and could not inherit the old selection. Assertions passed. Local run: 2026-09-10T14:50:17.547834+00:00. Evidence: `.release-coordinator/corner-cases/CT-07.log`.

**Scenario:** While A's checks run, its Issue is closed and a new request arrives
for similar code under a different request ID.

**Expected outcome:** The Coordinator stops treating A as an active candidate.
It does not silently replace A with the new ticket or transfer A's receipt and
approval evidence to it.

## CT-08: Several tickets overlap in different ways

**Status:** passed (local)

**Result:** Full local inbox flow with four tickets: A/B shared a backend PR and A/C shared a frontend PR. All three received overlap labels; D alone reached rehearsal and combined checks. Assertions passed. Local run: 2026-09-10T14:50:24.060011+00:00. Evidence: `.release-coordinator/corner-cases/CT-08.log`.

**Scenario:** A and B reference the same backend PR. A and C reference the same
frontend PR. D is completely independent.

**Expected outcome:** A, B and C receive clear overlap reasons. D can still be
considered. No shared PR is applied twice, and no ticket is partially included
to avoid the overlap.

## CT-09: Two Coordinator processes compete for ownership

**Status:** failed (ownership gap reproduced)

**Result:** Safety gap reproduced: concurrent journal acquisition had one winner and later stale guards/unlock/cleanup were rejected, but a PR POST already between guard and HTTP execution completed after recovery changed ownership. Current recovery instructions require stopping the old process first. This test characterizes that gap; it is not a safety pass. The reproduction assertions confirmed the gap. Local run: 2026-09-10T14:52:08.509254+00:00. Evidence: `.release-coordinator/corner-cases/CT-09.log`.

**Scenario:** Start two processes simultaneously in a controlled local test.
Then simulate the winning process pausing, recovery taking ownership, and the
old process waking up.

**Expected outcome:** Only the current owner can write. The old process cannot
create PRs, update tickets, delete resources or unlock the replacement process's
run.

## CT-10: Repeated crashes around successful GitHub writes

**Status:** passed (local)

**Result:** Controlled GitHub failures: lost PR-creation response, accepted dispatch followed by failed run-ID save, and accepted ref deletion followed by lost response. Recovery performed one PR creation, one dispatch, one PR closure and one ref deletion. Assertions passed. Local run: 2026-09-10T14:52:33.736164+00:00. Evidence: `.release-coordinator/corner-cases/CT-10.log`.

**Scenario:** GitHub creates a PR but its response is lost. After recovery,
GitHub accepts a workflow dispatch but saving its ID fails. Later, cleanup
succeeds but its response is lost.

**Expected outcome:** Every recovery finds the original operation. There is one
PR, one workflow dispatch and one cleanup—not a growing collection of
replacements.

## CT-11: Ticket presentation is only half updated

**Status:** passed (local)

**Result:** After labels updated but the managed comment failed, a human added a label and separate comment. Resume updated the same managed comment, retained both human additions and added no duplicate decision. Assertions passed. Local run: 2026-09-10T14:52:33.929073+00:00. Evidence: `.release-coordinator/corner-cases/CT-11.log`.

**Scenario:** The journal records a decision and labels update, but the status
comment update fails. Meanwhile, a person adds their own label and a separate
comment.

**Expected outcome:** Recovery completes the missing update without creating
another decision or managed comment. Human labels and comments remain intact.

## CT-12: A genuine green result belongs to the wrong combination

**Status:** passed (read-only GitHub evidence and local rejection)

**Result:** Re-read the successful two-ticket GitHub service workflow 34479747515 and verified its original identity. The same genuine report was rejected for a different ticket binding or attempt; a controlled green PR result with the wrong checkout tree was also rejected. Read-only GitHub verification; no new CI. Assertions passed. Local run: 2026-09-10T14:54:06.051183+00:00. Evidence: `.release-coordinator/corner-cases/CT-12.log`.

**Scenario:** Provide a real successful workflow result for A+B while the
candidate is A+C. Make the workflow name and other superficial details look
correct.

**Expected outcome:** The result is rejected because its exact code, combination
or attempt identity does not match. A genuine GitHub success is insufficient
when it tested different inputs.

## CT-13: The environment makes every candidate look broken

**Status:** passed (local)

**Result:** Real Git preparation plus controlled service failure: candidate failed and unchanged baseline setup failed. The batch stopped after one expensive round, cleaned both trials, did not split, and left every ticket waiting without code blame. Assertions passed. Local run: 2026-09-10T14:54:36.910425+00:00. Evidence: `.release-coordinator/corner-cases/CT-13.log`.

**Scenario:** Break the temporary database setup or baseline data so both the
candidate and unchanged baseline fail with similar application errors.

**Expected outcome:** The Coordinator identifies missing environmental proof,
stops splitting and avoids blaming submitters. It does not spend its entire
budget searching for a bad ticket that does not exist.

## CT-14: Everything looks healthy, but the application returns wrong data

**Status:** passed (local Docker/MySQL)

**Result:** Actual local Docker/MySQL runs, using the pinned sample runtime: separate wrong-worker, HTTP-200-but-stale-API, and wrong-frontend variants were rejected by data assertions. Each used a passing unchanged baseline and removed its temporary containers. Assertions passed. Local run: 2026-09-10T14:55:14.177039+00:00. Evidence: `.release-coordinator/corner-cases/CT-14.log`.

**Scenario:** Processes start, HTTP endpoints return 200, and ordinary PR checks
pass. However, the worker writes incorrect rows, the API returns stale data, or
the frontend displays the wrong result.

**Expected outcome:** The service test catches the incorrect behavior. Process
startup and green workflow badges cannot substitute for checking the actual
application output.

## CT-15: Candidate code tries to forge its own success

**Status:** passed (local Docker isolation)

**Result:** Actual local containers attempted to read a host canary and controller environment token, overwrite the controller report and read-only wrapper, and print a forged success marker. Isolation checks and report parsing were exercised against real Docker; only artificial canaries were used. Assertions passed. Local run: 2026-09-10T14:57:29.785098+00:00. Evidence: `.release-coordinator/corner-cases/CT-15.log`.

**Scenario:** A sample program prints a fake success-report marker, tries to
alter the trusted report, and attempts to read a harmless canary secret placed
outside its allowed environment. Use artificial secrets and controlled targets.

**Expected outcome:** Forged output cannot become trusted evidence, and the
canary remains inaccessible.

## CT-16: Sandbox evidence is accidentally used with the real profile

**Status:** passed (local)

**Result:** A completed sandbox journal was refused under the real profile, including after superficially changing its repository name. Real-profile trial/service adapters and saved-evidence validation stopped before every API spy: zero real calls or writes. Assertions passed. Local run: 2026-09-10T14:57:47.785757+00:00. Evidence: `.release-coordinator/corner-cases/CT-16.log`.

**Scenario:** Save a sandbox run, then attempt to resume or load its evidence
with the real profile. Include matching Issue and PR numbers to make accidental
matching plausible. Use local API spies to observe attempted operations.

**Expected outcome:** Repository IDs, profile bindings and saved ownership
prevent reuse. No real write is attempted.

## CT-17: A database change commits, but its completion proof is lost

**Status:** passed (local MySQL and controlled recovery)

**Result:** Actual local MySQL on the single-ticket database path: schema/data committed (value 15 and change ID present), then the checkpoint failed. Worker/API/frontend did not run; the report stayed unknown and retained the observed database effect before cleanup. Recovery read the same attempt without repeating its dispatch or claiming rollback. Assertions passed. Local run: 2026-09-10T14:57:56.113613+00:00. Evidence: `.release-coordinator/corner-cases/CT-17.log`.

**Scenario:** Through the existing single-ticket database path, apply a
migration or one-off data update, then stop execution after the temporary
database commits but before its result is recorded.

**Expected outcome:** Dependent services do not proceed on an assumption.
Recovery does not blindly repeat the change or claim rollback. Removing the
temporary database is not presented as proof that the operation never happened.

## CT-18: The budget expires during recovery

**Status:** passed (local)

**Result:** After A passed and B had only its backend trial created, the saved deadline expired. Resume kept the original three-round budget and deadline, reconciled and cleaned B using the same attempt, kept the proven A candidate, and started no fourth round. Assertions passed. Local run: 2026-09-10T14:58:12.255333+00:00. Evidence: `.release-coordinator/corner-cases/CT-18.log`.

**Scenario:** One subgroup has passed. Another has created its backend trial
but not finished its frontend trial. Exhaust the saved time or attempt budget,
then restart the process.

**Expected outcome:** Restarting does not reset the limits. Existing work is
reconciled and cleaned up, proven results are preserved, and no new candidate
round starts. Untested tickets are not labelled broken.

## CT-19: Important information is hidden on a later API page

**Status:** passed (local)

**Result:** Read 350 historical issues across four pages and recovered an open journaled ticket after its intake label disappeared. A failed required check on page three (#201) blocked readiness; unavailable issue/check pages raised explicit errors instead of yielding a partial pass. Assertions passed. Local run: 2026-09-10T14:58:32.174811+00:00. Evidence: `.release-coordinator/corner-cases/CT-19.log`.

**Scenario:** Create hundreds of historical tickets, remove the intake label
from a still-open journaled ticket, and place a failed required check on a later
API page. Also simulate one page becoming unavailable.

**Expected outcome:** The open ticket is not lost, and an incomplete check list
cannot produce a pass. Missing pages cause an explicit evidence problem rather
than silent omission.

## CT-20: Several tickets must ship together

**Status:** partial (current guard passed; future feature unavailable)

**Result:** Current intake rejected cross-ticket prerequisite and inseparable-group fields for all four diamond-graph requests. The future behavior for keeping dependency groups together, cycle handling and oversized groups cannot run because that feature is not implemented. Assertions passed. Local run: 2026-09-10T14:58:45.011993+00:00. Evidence: `.release-coordinator/corner-cases/CT-20.log`.

**Scenario:** For future cross-ticket dependency support, model four linked
tickets: A provides a prerequisite, B and C depend on A, and D depends on both B
and C. Mark an inseparable group, then make the search try to split through it.

**Expected outcome today:** Unsupported cross-ticket dependency declarations
cannot slip into execution.

**Expected outcome after that feature exists:** Splitting preserves inseparable
groups, prerequisites remain satisfied, and dependency cycles or oversized
groups produce clear holds.

## Reproduce a case

The assertions are in
[`complex-corner-cases.test.mjs`](../../apps/coordinator/test/complex-corner-cases.test.mjs).
Run one ID at a time:

```sh
node --test --test-name-pattern='^CT-01:' apps/coordinator/test/complex-corner-cases.test.mjs
```

CT-14, CT-15 and CT-17 require an explicit Docker acceptance run. They are skipped
by the normal offline suite; each was separately executed during this campaign:

```sh
COORDINATOR_CT_DOCKER=1 COORDINATOR_CT_EVIDENCE=.release-coordinator/corner-cases \
  node --test --test-name-pattern='^CT-14:' apps/coordinator/test/complex-corner-cases.test.mjs
```

Docker must be available. This command runs and removes owned temporary sample
containers. `COORDINATOR_CT_EVIDENCE` is optional and writes the detailed reports
into the supplied local directory. The campaign's ignored `.release-coordinator/corner-cases/`
folder contains a log per case plus Docker and GitHub reports. These local records
are not included in a Git commit; the outcomes above and repeatable assertions are.

CT-12 normally uses generated local proof. For the additional read-only GitHub
check, this campaign supplied `COORDINATOR_CT_LIVE_JOURNAL` pointing to the earlier
batch acceptance journal, from which it selected a successful two-ticket attempt.
This optional mode requires GitHub read access and an existing local journal;
it is not required by offline CI and does not import evidence into `inbox:run`.

After the sequential campaign, `npm run check` passed: **364 passed, 0 failed,
3 skipped** in the offline suite, plus lint, formatting, workflow policy, packed
CLI smoke and source-preservation checks. The three skips are CT-14/15/17, which
all passed in their separate Docker runs above. Log:
`.release-coordinator/corner-cases/repository-check.log`. See
[progress](../progress.md) for delivery status.
