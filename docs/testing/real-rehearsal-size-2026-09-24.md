# Real frontend rehearsal sizing — September 24, 2026

This is a local Git transport investigation and read-only product-object test,
not a real staging release or deployment acceptance. No product branch, PR,
workflow, or environment was changed by the diagnostics.

The first real filtered staging attempt for Issue #230 stopped before batch
selection when frontend `main` advanced and PR #4093 became `BEHIND`. Its journal
lock was released and no release executed. The replacement Issue #231 pinned
frontend PR #4093 at `acafa9cfabc802c1827e5c02b69afa49837488e1` against
`main` at `0f04f8482165514aa0d77da7ebc16599addeae60`. The real-profile
run `b2957f61-a2c1-4ef2-80a4-acab50e0b8d0` verified the ticket, required
checks, and PR-only approval-bypass eligibility, but its merge rehearsal returned
`resource_limit`: the temporary repository exceeded its storage guard. Issue
#231 remains open and waiting; no combined checks, integration PR, merge,
workflow dispatch, E2E, or deployment occurred. The temporary workspace was
removed and the journal lock released.

The shared Git helper has an existing 128 MiB byte guard and a 20,000-entry
guard. A bounded reproduction of the same exact two-commit full fetch crossed
the byte guard at 135,629,887 bytes with only 28 entries. This identifies the
trigger; it is not a disk-space shortage on the operator's computer. The
product frontend repository's GitHub-reported size was 1,103,187 KiB at the
time of the investigation.

A blob-free partial fetch of the same two commits finished in about eight
seconds with 17,286,483 bytes and 31 entries. Git listed both trees, read the
three changed files on demand, and produced clean merge tree
`8ff0d1efc8071a8b7f7204205b8415deb8ecdb40`. The resulting temporary
storage remained near 17.3 MB. The edited Coordinator helper then repeated
the exact product-object rehearsal, including its attribute checks, changed
paths, file reads, and merge, using 17,282,490 bytes and 36 entries; cleanup
was verified. The 128 MiB and 20,000-entry guards remain unchanged.

An offline regression fixture with a large unrelated blob passed a clean merge
and detected an add/add conflict while staying below a 1 MiB injected guard;
it also exercised on-demand file reads and cleanup. This change is local on
`codex/real-rehearsal-partial-fetch` until checks, review, and merge complete.
The full local `npm run check` passed: 622 tests ran, 619 passed, three
Docker-only cases were skipped; lint, formatting, documentation, workflow
policy, and package checks passed. This is not GitHub CI or live release proof.
It has **not** rerun Issue #231 or reached product staging. After merged source
is available, recheck the PR head and frontend `main`; if the ticket still pins
the exact head, retry only Issue #231 and actor `simo6529`. A changed PR commit
requires a new verified ticket.
