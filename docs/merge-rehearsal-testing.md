# Merge rehearsal and test repository plan

**Scope and acceptance plan, prepared September 9, 2026.** This is the next
bounded stage after inbox organization. [Progress](./progress.md) records what
has actually run; [the app guide](../apps/coordinator/README.md) lists commands
that exist. The command is implemented and merged in PR #26; the public sandbox
follow-up completes live required-check acceptance. Its integration is recorded
separately in progress.

## What we will prove

Given exact PR commits, an explicit destination in each repository, and an
explicit order, can Git combine those changes in temporary local repositories?
Can the Coordinator distinguish a clean result, a real conflict, and evidence
that is missing or has changed?

Use real Git for local tests, then real GitHub PRs in two small public test
repositories. Fake refers to their sample content; their branches, commits,
PRs, and CI checks are real. An empty production inbox does not prevent testing.

This stage produces a local report. A clean merge does not prove application
correctness, runtime prerequisites, deployment, or permission to release.

## Sequence and finish line

| Phase | Work | Evidence required before proceeding |
| --- | --- | --- |
| 1. Local implementation | Add the private input contract, isolated Git runner, report, and local fixtures. | Automated cases below pass using real temporary Git repositories. Existing tests still pass. |
| 2. GitHub setup | Create the two sample repositories, sample content, required CI check, and controlled PRs. | Exact repository identities, access, public visibility, rules, PR links, and check results recorded. |
| 3. Live rehearsal | Run the same engine against the real test PRs, including deliberate failures and updates. | Each required live case has an expected and actual result, exact commits, and saved evidence. |
| 4. Review and handoff | Repeat unchanged cases, verify boundaries and cleanup, update documentation, and integrate through normal PR checks. | Local and live results recorded separately; remaining limitations explicit; Coordinator implementation merged into `main`. |

Stop after phase 4. Adding a scheduler, processing real inbox requests through
the rehearsal, changing tickets from rehearsal results, or performing releases
is a separate stage. Do not keep adding test cases after this matrix passes
unless a concrete failure or uncovered requirement justifies one.

## The two GitHub repositories

Owner: `6529-Collections`. Both repositories were created September 9; their
IDs, visibility, sample PRs, and current acceptance limits are recorded in
[progress](./progress.md). Setup verifies pinned ownership and empty repositories,
or resumes its recorded seed only after checking the exact baseline branches.
It does not overwrite an unrelated existing repository.

| Repository | Sample content |
| --- | --- |
| `release-coordinator-test-frontend` | A few text/JSON files and a dependency-free sample check. |
| `release-coordinator-test-backend` | Similar sample files plus `src/config/deploy-services.json` with a small `api` and `dbMigrationsLoop` dependency example. |

Each repository starts with a recorded baseline on `main`. Add a test-only
`rehearsal-target` branch to prove that the selected destination matters.
Create new named branches and PRs per case; do not reuse an old PR by changing
its meaning. Record the actual baseline commits and PR numbers after setup.

Use a minimal GitHub Actions check named `Sandbox check`, with read-only
contents permission, no deployment or publication jobs, no product secrets,
and no dependency installation. Pin any Actions used to reviewed commits.
Require the check on the tested destination branches, disable force pushes,
and verify the rules are actually enforced. Private repository rules and
Actions availability must be checked during setup; if unavailable, record the
blocked live coverage rather than describing an ordinary check as required.
This account limitation occurred during the initial private setup. On September 9,
the user authorized making only these two sample repositories public. Their
pinned profile now expects public visibility, and `Sandbox check` is enforced
on both `main` and `rehearsal-target` in each repository. Clean merges still
remain `unknown` whenever the profile's named check cannot be verified as required.
See progress for the separate live acceptance result after this settings change.

The setup step is allowed to seed test branches and open/update test PRs once
execution is authorized. The rehearsal command itself only reads GitHub and
fetches Git objects; it never pushes, merges a GitHub PR, dispatches a workflow,
changes settings, or writes a comment. PR setup naturally starts the sample CI.

## Keep the test environment separate

Build one rehearsal engine with two named configuration profiles. The intended
operator switch is `RELEASE_COORDINATOR_PROFILE=sandbox` or
`RELEASE_COORDINATOR_PROFILE=real`. Both profiles now support verified inbox plans;
the [profiled inbox follow-up](./profiled-inbox-testing.md) defines that path.
Sandbox manifests remain a separate input. Require an explicit valid value;
missing or unknown values must
stop, never fall back to real repositories. Profile selection is separate from
the request's `staging`/`production` deployment target.

| Profile | Repositories | Input source | Rehearsal behavior |
| --- | --- | --- | --- |
| `sandbox` | The two public test repositories | Verified test inbox request plus an explicit plan, or a validated private test manifest | Shared engine; temporary local merges and local reports. |
| `real` | The two fixed product repositories | Verified real inbox request plus an explicit destination/merge plan | The same engine and report contract; still no remote writes or deployment. |

The selected trusted profile supplies repository names/IDs and read adapters.
Its input adapter produces the same internal merge-plan structure, retaining
the input source and proof identity. Keep repository names and input loading
out of the merge algorithm; do not build a sandbox-only copy of the algorithm
and rewrite it for real repositories. Separate reports and temporary state by
profile, and never reuse sandbox results as real evidence. No arbitrary
repository override or mutation permission comes from this environment setting.

The original first milestone enabled only `sandbox`. The profiled inbox follow-up
has now implemented and tested the verified-input adapter for both profiles.
An operator selects the profile and supplies that profile's valid input; the
engine needs no changes. Real live proof remains separate. An environment change
alone cannot promote a test manifest into a verified inbox request.

The current public schema allows only `6529seize-frontend` and
`6529seize-backend`. The public npm CLI retains that real-only boundary. The
private Coordinator profile selects the corresponding readiness repositories
and inbox receipt verifier; sandbox JSON uses separate test names and a marker.

For this stage:

- Add a private, explicitly selected sandbox profile with the two exact
  repository names above. Reject product repositories, arbitrary owners/hosts,
  and mixed sandbox/product inputs. Record repository IDs as well as names
  after provisioning; verify returned identities and PR source repositories.
- Define a private test manifest with a case ID, frontend/backend roles, PR
  numbers, source branches, exact full commit IDs, explicit destination branches
  and commits, merge order, selected services, and part dependencies as needed.
  Validate its shape, duplicates, references, size limits, and dependency cycles.
- Label its input source `test-manifest` and its mode `sandbox` in every report.
  It is not a verified intake receipt and cannot enter `inbox:process` or the
  real decision journal. No fabricated workflow/actor proof is accepted.
- Keep GitHub reads behind the selected profile's read adapter. Use the same
  merge engine and shared pure inspection logic; do not make production adapters accept arbitrary
  repositories or caller-supplied API queries to accommodate tests.
- Keep the published package, public request schema, central intake workflow,
  and current ticket policies unchanged. No npm release or product edit is needed.

Two repositories are sufficient for this merge-rehearsal stage. This does not
retest the public CLI-to-inbox receipt path against new repositories. A future
full sandbox intake exercise would need its own isolated inbox and explicit
receipt/identity configuration; do not quietly send fake requests to the real
inbox or claim that local manifests prove submission works.

## Rehearsal behavior to implement

Command name: `merge:rehearse`, in the private Coordinator workspace.
Runnable flags are in the app guide. It runs manually on the local
machine, saves a report under the ignored `.release-coordinator/` directory,
and exits. Automated fixture tests must run offline in the existing test suite.

1. Validate the sandbox profile and manifest before accessing repositories.
   Require one explicit destination per repository. Never infer a branch from
   `target: staging`, a PR's base branch, or the local checkout.
2. Read each PR and destination. Verify repository/source identity, requested
   branch and exact commit, PR state, checks, and review evidence. A draft,
   closed, already-merged, or changed PR cannot silently become a passing case.
3. Record the initial facts and fetch the exact objects into fresh temporary
   repositories. Verify the fetched identities. Missing commits, incomplete
   history, or access failures are unknown evidence, not merge conflicts.
4. Start from each recorded destination commit. Merge PR commits sequentially
   in the explicit manifest order, using one documented Git merge method.
   The first version uses `ort` through Git's merge-tree operation and writes
   temporary two-parent commits in bare repositories, without a checkout.
   Record Git version and strategy. Do not switch strategies or
   choose another order to make a failed case pass. Validate part dependencies
   separately; service deployment order does not invent PR merge order.
5. Keep frontend and backend repositories separate. Record every intermediate
   result and final tree identity. A conflict records the step, commits, and
   affected paths. Do not resolve it automatically or silently omit a PR.
6. When a backend merge succeeds, read the catalog as data from that exact
   combined tree and inspect requested services/dependencies against it. Do not
   select one PR's catalog as a substitute. Missing runtime prerequisite proof
   stays unknown; no service gets deployed or silently added to the request.
7. Re-read PR heads, source/base identity, PR state, destination tips, checks,
   and review facts after the work. A change makes the observation stale; a
   failed recheck leaves it unknown. Preserve any earlier diagnostic result
   but do not present it as current evidence or silently update the input.
8. Collect the result, remove temporary resources, and finalize the bounded
   JSON/text report with the actual cleanup outcome. Preserve useful diagnostics
   on failure and recheck source repository boundaries. A cleanup failure must
   name the owned path and prevent a successful exit; a report-write failure
   must not skip cleanup.

Passing CI and a clean Git merge are separate observations. It is useful to
show that a merge was clean even when a required check failed, but the report
must make that blocker visible. A request spanning two repositories cannot
pass the rehearsal if one repository is conflicted, stale, or unverified.
GitHub check/review gates describe each PR against its own base branch; record
that branch. They do not prove the combined tree passed CI or that another
destination's rules were satisfied. Cases intended to pass use PRs targeting
the explicit destination. For a different destination, retain the local merge
finding but leave destination gate evidence unknown unless separately verified.

The final observation does not lock GitHub. Later execution must revalidate
the same destinations, commits, order, and method. A different merge method,
destination, or updated input requires new proof. This plan does not decide
when real `main` changes or how production artifacts are built.

## Local execution boundaries

Use a dedicated temporary directory per run, with cleanup in failure paths.
Do not run Git inside a user's product checkout or borrow its index, branches,
worktrees, hooks, or configuration. Fetch only from the explicit trusted
repository profile; local filesystem remotes belong only to offline fixtures.

Invoke Git and GitHub tools with validated argument arrays and no shell.
Isolate Git configuration and environment so inherited hooks, external merge
drivers, filters, credential output, or command aliases cannot run code from a
PR. Do not execute package scripts, builds, submodules, or repository tools.
Handle unsupported required filters/content explicitly rather than claiming
to reproduce a merge environment the runner did not support.

Bound subprocess duration, output, object retrieval, and request size; terminate
owned child processes on timeout or interruption. Keep credentials out of
reports. Support useful diagnostics without dumping raw credential-bearing
errors or entire file contents. Cleanup removes only directories owned by the
run. An abrupt process kill may leave an owned directory: document explicit
cleanup rather than deleting unknown directories during the next run.

## Report contract

The report records:

- Case/run ID, sandbox input source, manifest hash, Coordinator revision, Git
  version, start/end times, and overall rehearsal result.
- Exact repository IDs/names, PR URLs and numbers, requested/observed commits,
  destination refs/commits, and merge order/method.
- Per-step merge result, intermediate/final tree IDs, conflict paths, and a
  separate required-check/review observation. Compare trees for repeated runs;
  synthetic merge commit IDs may differ because of timestamps.
- Combined backend catalog identity and service/dependency observations where
  relevant, without inventing runtime evidence.
- Initial/final observations, named reasons for conflict, staleness, invalid
  input, or missing evidence, and the next action needed.
- Temporary-resource cleanup outcome and `release_authorized: false`.

Use the following rehearsal observations, never ticket statuses:

| Result | Meaning | Exit code |
| --- | --- | --- |
| `pass` | All requested rehearsal observations passed for this exact snapshot. | `0` |
| `blocked` | Stable evidence demonstrates a conflict or another named blocker. | `1` |
| `unknown` | Evidence or an operation needed to verify the result is incomplete. | `2` |
| `stale` | A recorded input or observed GitHub fact changed during the run. | `3` |

Invalid input is a usage error with exit `2`, before repository work begins.
An unrecoverable tool, report-write, or cleanup failure also exits `2`, with a
named operational error separate from merge findings. Otherwise, changed facts
make the overall result stale first; unavailable final identity/state evidence
makes it unknown. Once observation stability is established, a demonstrated
blocker takes precedence over other unknown checks; all checks must pass for
`pass`. Preserve per-check details in every case. No result means release-ready.

## Test matrix

`Local` means an automated fixture with real Git and controlled GitHub replies.
`Live` means the actual test repositories/PRs. Run all local cases; the marked
live cases form the bounded GitHub acceptance run. Controlled timing and tool
failures remain local so they are deterministic, not dependent on a lucky race.

| ID | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| MR-01 | One independent PR into its recorded destination | Clean final tree includes the requested change. | Local + Live |
| MR-02 | Two compatible PRs in one repository | Both changes included in the declared order. | Local + Live |
| MR-03 | PR conflicts with the destination | Blocked; exact PR, merge step, and paths reported. | Local + Live |
| MR-04 | Two PRs each merge into the baseline but change the same line differently | Each passes alone; the combined request is blocked. | Local + Live |
| MR-05 | PR is clean against `main` but conflicts with `rehearsal-target` | The explicit destination decides the result. | Local + Live |
| MR-06 | Frontend and backend both combine cleanly, with valid selected dependencies | Both trees and dependency observations recorded; no release authority. | Local + Live |
| MR-07 | Frontend is clean but backend conflicts | Whole rehearsal blocked; frontend result retained, nothing applied remotely. | Local + Live |
| MR-08 | Requested PR head changes after manifest creation | Outdated input identified; the new head is not silently substituted. | Local + Live |
| MR-09 | PR or destination changes during a run | Stale, preserving the initial and final identities. | Local |
| MR-10 | Checks/review/PR state changes during a run, or final read fails | Stale for changed facts; unknown for an unavailable recheck. | Local |
| MR-11 | Required sample CI fails | Failed gate visible even if the Git merge is clean. | Local + Live |
| MR-12 | Required CI pending/missing; review required or changes requested | No pass from incomplete or negative evidence. | Local; live pending where observable |
| MR-13 | Draft, closed, or already-merged PR | No passing candidate and no implicit reopening or ticket closure. | Local; live draft + closed |
| MR-14 | Wrong repository/source, mixed product/sandbox input, malformed SHA/ref, duplicate PR, absent destination, invalid/cyclic order | Rejected at the appropriate validation boundary; no unintended repository access. | Local |
| MR-15 | Commit unavailable, insufficient history, authentication/network failure, or partial API pagination | Unknown/error with a useful reason; never an empty-success or invented conflict. | Local |
| MR-16 | Backend PRs modify different parts of the catalog | Inspect the actual merged catalog, not either individual input. | Local + Live |
| MR-17 | Unknown service, invalid/cyclic dependency, or omitted runtime prerequisite | Invalid selection blocks; missing runtime proof stays unknown. | Local |
| MR-18 | Timeout, interruption, fetch failure, merge conflict, report-write failure, and cleanup failure | Owned resources handled; failure and any leftover path reported accurately. | Local |
| MR-19 | Hooks/configuration/filter/driver tricks, unsafe arguments, or secret-bearing tool errors | No unexpected executable runs, shell interpretation, or secret disclosure. | Local |
| MR-20 | Run an unchanged manifest twice | Same decisions and result trees; no GitHub writes or source branch/index changes. | Local + Live |
| MR-21 | Select either profile, omit/misspell the setting, or pass an input/report from the other profile | Both supported adapters use the same engine; no fallback, cross-profile proof reuse, or extra permissions. Real mode rejects test manifests and requires verified inbox input (implemented in the profiled inbox follow-up). | Local; live real-profile acceptance belongs to later integration |

For MR-04, create both PR branches from the same baseline and edit the same
single line to different values. For MR-05, change that line on the separate
destination branch. For MR-08, save the original manifest, then deliberately
push a new sample commit and rerun it. MR-16 should merge without a textual
conflict but produce a catalog that differs from both inputs.

The local boundary tests should assert the allowed Git/GitHub calls, compare
fixture source refs and worktrees before/after, and use markers to detect
unexpected executable hooks or scripts. Live before/after checks compare all
relevant refs and PR state around the read-only rehearsal. Separate authorized
fixture updates from those measurement windows.

## Evidence and completion checklist

Save raw local reports under
`.release-coordinator/merge-rehearsal/<profile>/<run-id>/`. Commit reusable fixture
builders/manifests without credentials; do not rely on ignored local output
as the only durable acceptance record. Record in progress, or a linked dated
test record, each case ID, result, Coordinator revision, exact PR/base/head/tree
identities, check-run links, timestamp, and any limitation. The sample repository
URLs are now public; earlier records describe the visibility observed at their run time.

- [x] Private engine and manifest/profile validation implemented and documented.
- [x] The engine takes a shared internal plan; profile selection and input proof
      stay outside it. MR-21 verifies switching boundaries; the profiled inbox follow-up adds real-profile fixture acceptance.
- [x] All MR local cases and existing package/Coordinator tests pass in CI.
- [x] Public package dry-pack contents remain the existing nine files.
- [x] Both sample repositories and their enforced check rules verified live.
- [x] All required MR live cases pass their stated expectations; expected
      conflicts and failed checks count as successful detection, not green merges.
- [x] Repeat runs and independent before/after reads confirm no rehearsal writes
      to GitHub and no source checkout changes.
- [x] Cleanup and error behavior verified, including a clearly reported leftover.
- Integration and current merge status: [PR #26](https://github.com/6529-Collections/6529-release-coordinator/pull/26),
  using the Coordinator's normal required PR checks. Local/CI and live evidence
  are recorded separately in progress and the dated test record.
- [x] Progress and command documentation describe the implemented limits;
      deferred cases are explicitly marked rather than counted as covered.

The [initial September 9 record](./testing/merge-rehearsal-2026-09-09.md) preserves
the private-run diagnostics and their missing required-check proof. The
[public sandbox acceptance record](./testing/merge-rehearsal-public-2026-09-09.md)
completes that proof: all 15 cases met expectations, with seven passing clean
cases and eight correctly blocked cases. Locally controlled timing/failure
cases retain the local coverage stated in the matrix.

Retain the two test repositories and reusable fixtures for later development.
After recording evidence, close temporary scenario PRs with a test reason when
that cleanup is authorized; do not merge or delete them automatically. Keep
known fixture refs available for reproduction. No repository deletion is part
of this plan.

## Later work remains separate

The [profiled inbox follow-up](./profiled-inbox-testing.md) implements the shared
input integration described below, with sandbox live proof and offline real-profile
tests. Its [dated acceptance record](./testing/profiled-inbox-2026-09-09.md) records
the completed sandbox ticket path; actual real-system acceptance remains
separate from the completed sandbox matrix.

Both profiles now accept verified inbox inputs and explicitly chosen destination
plans through the same adapter and engine. The next sandbox extension can define
how a rehearsal report informs ticket status; that policy is not implemented by
the input adapter. It must not make current readiness results automatically
eligible or take execution ownership.

Before a real rollout, verify real permissions and repository limits with a
separately authorized live read-only run. Real mode rejects test manifests and
requires its own request and destination proof. The profile switch requires no
second merge implementation. A rehearsal never starts ticket processing or
deployment; either remains a separate capability.

Actual combined application builds/tests, release ownership, scheduling,
deployment, runtime prerequisites, recovery, and the unresolved choices in
[the execution design](./design.md#decisions-to-settle-before-execution) remain
outside this stage. The sandbox can be extended for those tests later, but the
success of this plan does not count as that later evidence.
