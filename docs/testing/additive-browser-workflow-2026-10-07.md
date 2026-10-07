# Additive frontend browser-test contract — October 7, 2026

## Problem and scope

The approved frontend PR workflow was Git blob
`134e53f46bfe207742adcc4fec392128bec75ab8`. Adding the ordinary Wave feature-usage
desktop/mobile browser pack produced
`9209601a51023b4a17609fb7cdacb360a2e34977`: complete-file comparison found only
ten added lines, one matrix registration and its matching local sandbox command.
The old Coordinator correctly rejected the changed exact hash, but repeating a
Coordinator pin update for each such addition is unnecessary coupling.

The new policy protects the complete current workflow as its reviewed baseline.
The checked-in 72,006-byte fixture independently matches the latter Git blob.
The baseline includes the tracking pack; removing or changing it is refused.
This change is Coordinator-only. It does not change frontend code, deployment
workflows, required check names, dependencies, count budgets or runtime limits.

## Supported additions

Only the current real frontend `app-pr-ci.yml` policy opts into
`additive-browser-packs-v1`. A future workflow can differ from the baseline at
exactly two insertion points, using the following literal shapes. All other
bytes must remain identical, including whitespace and existing pack order.

Insert a registration immediately before `const waveCreationBrowserRequired`:

```js
          if (plan.checks.playwright_example_pack?.required) {
            corePlaywrightLanes.push({ lane: "playwright-example-pack", label: "Example desktop and mobile", runner: defaultRunner });
          }
```

Insert its step immediately before the existing Wave-creation step:

```yaml
      - name: Run isolated example browser pack
        if: matrix.lane == 'playwright-example-pack'
        env:
          PLAYWRIGHT_OUTPUT_DIR: "test-results/playwright/example-pack"
          PLAYWRIGHT_HTML_REPORT_DIR: "playwright-report/example-pack"
        run: ./bin/6529 run test:e2e:example-pack-sandbox

```

The check identifier, lane, command and directory slug must match. Multiple
additions use the same order in both slots, with one registration/step per pack.
Names are literal ASCII text, not expressions or YAML syntax. New lane names
must be unique and cannot collide with a baseline lane. The registration uses
the existing default runner and the step uses only the two existing output
environment keys. Arbitrary commands, additional environment variables, action
steps, changed conditions and failure suppression are refused. There is no new
Coordinator limit on how many packs may be added.

The validator compares exact strings; it does not execute JavaScript, parse
arbitrary YAML in production, or install a new runtime dependency. Offline tests
also parse accepted fixtures as YAML and compile their plan JavaScript without
executing it, checking the real step shape and unchanged job envelope.

## Admission and evidence boundaries

The reviewed exact hash retains the existing fast path. For a different hash,
the adapter obtains complete current bytes from the exact candidate base and
the exact reviewed baseline via GitHub's Git blob API. Both base64 payloads and
Git blob hashes must verify before extension validation. Missing, truncated,
noncanonical or incorrectly hashed content stops admission before any write.
The immutable base commit and full saved policy continue to bind the candidate
to that workflow; no free-standing approved-hash cache is introduced.

Every baseline permission, trigger, job, action pin, runner, build, existing
test and result aggregator is protected. Backend PR-CI, frontend debt ratchet
and all staging/production deployment/E2E runtime pins retain exact verification.
Candidates remain forbidden from changing their own verification workflows.
Ordinary product review, effective required checks, exact candidate CI, protected
merges and matching deployment/browser E2E are still required. This grammar does
not prove the added package script implements meaningful tests or is isolated;
that remains product source review and CI's responsibility.

The baseline freezes existing required behavior, not every future supplemental
pack forever. A later workflow consisting of the same baseline plus a different
valid supplemental inventory is still eligible. Removing baseline coverage or
altering workflow mechanics needs separate review; this is deliberately not a
general semantic workflow auto-approval system.

## Historical policy and interrupted preparation

The previous Wave-creation snapshot is preserved exactly, including its old
workflow hash and all existing fields. All prior snapshots remain readable and
retain exact-hash admission; they do not inherit the extension contract. New
preparations use a different complete policy hash and fresh candidate evidence.

Only an empty, unselected, unpublished preparation under the original,
session-recovery or previous Wave-creation snapshot may refresh to the new
policy. The existing engine retires old checks, verifies cleanup and the same
receipt/actor/source gates, rebuilds and retests. Original attempts and spent
budgets remain. Native-competition, copy-based, unknown and downgraded policies,
recorded trials/services, selected candidates and release executions are refused.
There is no journal migration, automatic takeover or new resume authorization.

## Verification and delivery

Offline tests cover positive single/multiple future packs, literal byte
protection, malformed or unpaired additions, shell/expression/YAML injection,
duplicate or existing-lane collisions, hash/body verification and GET-only
admission refusal. Policy/resume tests cover exact historical snapshots, fresh
same-ticket checks with unchanged/moved main, source-gate refusal, recorded
resource refusal, interrupted refresh and preserved budgets.

All 104 focused tests passed. Full non-fixing gates passed on Node 22.16.0 with
all 50 test files run serially: **1048 passed**, three optional Docker skips
(1051 total), plus lint, formatting, docs, workflow policy and packed-CLI checks.
The normal check stages were run inside the same source-snapshot wrapper, with
the test stage given `--test-concurrency=1` to avoid parallel workstation load;
all source bytes remained unchanged. No dependency setup, Docker or frontend
build ran; the packed-CLI check used its normal temporary offline consumer install.

At `2026-10-07T10:40:15.756Z`, eight guarded GET-only requests independently read
frontend main `0727a6be43a6dad451d375538e0d9e2185132bc0`, reproduced rejection by
the former Wave-creation policy, and admitted it under the new policy. The actor
was independently matched to `simo6529` / `209783236`. This tests admission of
the actual reviewed baseline only; unknown future extension hashes have offline
coverage, not live acceptance. It is not candidate CI or deployment evidence.

PR review, GitHub CI and merge remain separate pending evidence.
No inbox runner, release request, product PR, workflow dispatch or deployment is
started by these checks. The separately closed long-post attempt is not resumed.
