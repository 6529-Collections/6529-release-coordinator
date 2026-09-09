# Unified inbox workflow acceptance — September 9, 2026

This record covers the local `inbox:run` implementation on
`codex/unified-inbox-run`. It replaces the old separate processing and rehearsal
operator commands. The initial milestone below used a manual plan; the automatic
planning follow-up removes that input from normal use. It is **uncommitted local source**, with no PR/CI/merge claim
for this change and no new npm publication.

## Initial milestone: source and local tests

The checkout is based on `c52c450992c236750223eb031de78498fd4a0fe5`, the prior
local documentation commit. All live reports correctly record `dirty: true`.
A final run also exercises the compatibility marker added after the repeat.
Its runtime file hashes are in local `runtime-source.json`; aggregate SHA-256:
`03adb74577b441d9789370c822e7a080f0cfdfed2ff81953d1654b91f7ee5149`.
The preceding repeat hash record is retained as `runtime-source-before-marker.json`.

`npm test` passed **247 tests**: 26 public-package tests and 221 Coordinator
tests. The 12 new workflow tests include both named profiles with real temporary
Git merges, two individually mergeable PRs that conflict together, initial
blockers, missing/wrong plans, reason resolution, changing receipts/Issue state,
lost journal ownership, unknown/stale reports, failed report saving, interruption,
resume with the saved plan, partial comment writes, rejection of old commands,
and upgrading the journal without allowing an incompatible writer.
Tests use local fixtures, with no GitHub writes.

The package dry-run still contains nine files for public `0.0.4` and no private
Coordinator code. Public package source and schema are unchanged.

## Initial milestone: live sandbox exercise

The initial milestone ran the manual-plan interface twice and once more after
adding its compatibility marker. That operator interface has since been removed;
use the current [command guide](../../apps/coordinator/README.md#run-the-ticket-workflow).
The original command JSON and exact input remain in the raw evidence directory.

The plan is the existing verified three-PR sample request from the earlier
[profiled inbox acceptance](./profiled-inbox-2026-09-09.md). It binds
[test ticket #1](https://github.com/6529-Collections/release-coordinator-test-inbox/issues/1)
to request `2fd02bc0-07ca-46c1-8e2f-0951de1853e9` and checksum
`52aa63243314fdaf8cf064da9734039fa6d90e63b8875c6b5857071940ad0111`.
Intake still uses the existing shared source pin; no workflow dispatch or new
request was needed for this acceptance.

| Observation | First run | Repeat |
| --- | --- | --- |
| Command exit | 0 | 0 |
| Rehearsal | Passed, cleanup removed | Fresh rehearsal passed, cleanup removed |
| Ticket lifecycle | Waiting for independent release history/ownership | Same |
| Status comment | Updated existing `5601315765` | Same ID, content, and update time |
| Decision history length | 1 → 2 | Remained 2 |
| Original receipt | Unchanged | Unchanged |

Final labels are `release-request`, `target:staging`, both component labels,
`status:waiting`, `reason:coordinator-incomplete`, and `rehearsal:passed`.
The maintained comment shows the exact destination commits and result trees.
No eligible/completed label or release authorization was produced.

| Repository | Destination `main` | Final combined tree |
| --- | --- | --- |
| Test backend | `33dc26417355f53b8ba94f1d20c9bd9e3779edaa` | `be6681e603484a8cd38f4d25ba29d184aa94cfca` |
| Test frontend | `5e5d27c5bfee263259e15eb9dee0ad0ea89c0e53` | `7bc4bafd351a4c095afac863eb8286717de2f5bc` |

The backend PR is #1; frontend PRs are #1 then #2. Exact requested commits and
order are preserved in the plan, both reports, and the journal evidence.

## Evidence and boundaries

Snapshots ran at 12:50:32, 12:52:35, and 12:54:17 UTC. They verified the original
receipt, one comment, and unchanged ticket presentation on repeat. All 12 sample
PRs and every listed sample branch stayed unchanged. The real inbox Issues and
its journal stayed unchanged at `5d136b76469154083ff79fbeb19478950efec34f`.

Sandbox journal refs: `eb57705fd2c65f7c16aa262d8be6dbf9758b4f9e` before,
`9be8383989689eb5fcbfe16a61731417f1b70088` after the first run, and
`4ea4816402ffbc9e34fecacd9f3304d02ab9add0` after repeat. Acquire/release commits
record each run; the repeated ticket and transition records are identical.
Both runs released their locks. The new decision is
`505553e1-3157-4a2e-8c65-0f0e83837931`, policy `2026-09-09.3`.
The final run adds `workflow: "inbox-run-v1"` at the top of the journal.
The actual pre-change validator from the base commit was exercised locally:
it accepts the earlier passing record and rejects the marker before writes.
Use current code for this sandbox journal; preserve both the marker and history.

| Run | Command run ID | Saved report ID |
| --- | --- | --- |
| First | `51fb8a18-021a-40b8-bc89-35856ca070fc` | `f00314e4-1230-420b-a023-f3f7694faba3` |
| Repeat | `5fee7457-f08d-46dc-a54c-0956383ab155` | `7aeb7901-5c62-41b9-82a9-6df0536a0b3f` |

The journal retains the first meaningful report hash
`26045dd78319148873fe93c244dbdbf4d72569f0290d9a37f32d2f7fd68d0f52`;
the repeat saves a fresh local report without another decision. Its hash is
`2239e9fc4998bb6b9ab2f48e8129e9af842e38a8792b61ea24d9f850d9cfc619`.

The final compatibility run also exited 0 and retained the same ticket, comment,
and two decisions. Snapshot at 2026-09-09T13:01:34.896501+00:00 confirmed marker `inbox-run-v1`,
released lock, and unchanged real inbox/sample refs. Final sandbox journal:
`dfa7168d49b84c65c607213384948a63b1faae6d`. Command run: `195ae7e1-e809-44dc-aba6-24a89a257f20`;
report: `2dae350d-ab13-4f9d-86ef-21c58861bf8e`; report hash:
`0096bf21db3a0a1fde7f7abd0e8476186a29d29c43c29af11c20f57ccd8c2a4a`. Cleanup was removed and release authorization remained false.

Raw snapshots, command JSON, journal snapshots, runtime hashes, and comparison
results live under the ignored `.release-coordinator/unified-inbox-20260909/`.
Full reports live under `.release-coordinator/merge-rehearsal/sandbox/<report-id>/`.

This proves the live sandbox check → rehearsal → same-ticket update and stable
retry. Conflict/failure recovery in the combined workflow was tested locally.
It does not prove real-product runtime support, combined application builds,
multiple-ticket batches, release ownership, product merges, or deployments.


## Automatic planning follow-up

The operator now supplies only the ticket, with an explicit profile. The CLI
has no plan-file option. The ticket's PRs, dependencies, and services supply
scope; trusted profile configuration supplies `main` as each rehearsal branch.
The Coordinator reads current destination commits, orders dependencies, preserves
PR order within each part, and saves each generated plan before starting Git.

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:run -- --issue 1 --json
```

All **255 tests passed**: 26 public-package and 229 Coordinator tests. Coverage
includes automatic planning under both profiles, dependency order, immutable
scope, destination identity/configuration, limits, per-ticket plans in an inbox
scan, failed plan saves, fixed inputs on resume, legacy-run migration, new-run
refresh, and refusal of the removed CLI option. Public package files and schema
remain unchanged.

The simpler command passed twice on the same live sandbox ticket. Both runs
created their plans without a supplied file, completed rehearsal, released the
lock, and kept the same waiting ticket, comment, and two historical decisions.
The new journal marker is `inbox-run-v2`; new decisions use policy `2026-09-09.4`.
The existing meaningful decision stays intact because its result is unchanged.

Runtime base: `c52c450992c236750223eb031de78498fd4a0fe5`, with `dirty: true`.
Runtime file-set SHA-256: `fe498c8205d12b5b319a048e1d3ddf0c490687ca9128e7504b334a0db9035017`.
This remains local uncommitted code, without PR/CI/merge or publication proof.

| Evidence | First automatic run | Repeat |
| --- | --- | --- |
| Command run | `b98ef6e2-8cff-4205-8424-d354a24c5931` | `624c861b-1d71-492e-996d-a74d676351b4` |
| Saved plan commit | `02950446f95239d3bb09cc8f86c52fe77db34389` | `19c1ee8afc4b4138a30f506f43f69a95505ec5e4` |
| Rehearsal report | `34a940fa-f5c0-413d-965b-370c0765a839` | `0c0df6a0-e6eb-4987-bfb1-8c75ebfed534` |
| Final journal commit | `8ead1db69649d1e6171be0cb61e05b5839e7add3` | `fe9710fad6cc4b374409e0106ca3cf63ac741fa1` |

The saved-plan commits precede the rehearsal start times, and their stored
PR order/destinations match the full reports. Plan fingerprint on both runs:
`f3e9fb6516356b61f51c08bf554884855f979fafce6b7b4b733971a55f5ff7b9`. Result trees match the initial milestone above.
Both reports show cleanup removed and `release_authorized: false`.

Snapshots at 13:20:11, 13:22:58, and 13:24:57 UTC verified unchanged ticket
receipts, comments, decision history, all 12 sample PRs and branches, and the
real inbox/journal. The real journal stayed at
`5d136b76469154083ff79fbeb19478950efec34f`. Before this follow-up, the sandbox
journal was `dfa7168d49b84c65c607213384948a63b1faae6d`.

Raw snapshots, saved-plan proof, command results, runtime hashes, and comparison
assertions are in the ignored `.release-coordinator/automatic-plans-20260909/`.
Full reports use the existing per-profile report directory. Live acceptance
covers this sandbox ticket and its repeat; real-product runtime and releases
remain outside this proof.
