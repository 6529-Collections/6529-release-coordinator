# Profiled inbox and one-ticket rehearsal

This stage connects a verified ticket to the existing merge engine. Sandbox and
real configurations use the same intake, receipt verification, readiness,
processing, and rehearsal code. Only sandbox live execution is part of this
rollout. Multiple-ticket batching, release ownership, builds, deployments,
and rehearsal-driven ticket decisions remain later work.

## Trusted configuration

`apps/coordinator/src/profiles.mjs` owns the two fixed configurations. An operator
selects a name, never supplies a repository URL, numeric ID, workflow path, or
credential through a request. An unknown name stops without falling back.

| Setting | `sandbox` | `real` |
| --- | --- | --- |
| Inbox | `6529-Collections/release-coordinator-test-inbox`, ID `1362580376` | `6529-Collections/6529-release-coordinator`, ID `1346244762` |
| Frontend PRs | `release-coordinator-test-frontend`, ID `1362504370` | `6529seize-frontend`, ID `579004979` |
| Backend PRs | `release-coordinator-test-backend`, ID `1362505082` | `6529seize-backend`, ID `579003578` |
| Submission workflow | `submit-release-request.yml` on inbox `main` | Same workflow name/ref in the real inbox |
| Receipt checks | Selected inbox, successful workflow/attempt, request checksum, ticket number and GitHub actor | Same checks |
| State journal | `codex/inbox-state` in the test inbox repository | Existing state branch in the real inbox repository |
| Local submissions | `.release-coordinator/profiles/sandbox/submissions/` | `.release-coordinator/profiles/real/submissions/` |
| Rehearsal reports | `.release-coordinator/merge-rehearsal/sandbox/` | `.release-coordinator/merge-rehearsal/real/` |

All pinned repositories are public. Live inbox commands verify inbox numeric
identity and visibility. The rehearsal GitHub adapter binds each PR and source
repository to the profile's numeric IDs. Git transport uses the same selected
repository allowlist. Profile selection grants no additional GitHub permission.

The test inbox holds only a workflow wrapper and README. The wrapper checks out
an exact Coordinator commit and executes the shared intake implementation.
The real inbox workflow executes that same implementation from its own checkout.
Updating the sandbox's Coordinator source pin is an explicit fixture configuration
change through a PR; there is no copied implementation to maintain.

## Commands and request formats

The private Coordinator command accepts **complete request JSON**, including its
UUID `request_id`, `schema_version`, and `created_at`. Preserve the same JSON and
ID when inspecting or retrying an uncertain attempt; generating a new ID would
describe a new request.

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run request:submit -- --input REQUEST_JSON --json
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:read -- --json
RELEASE_COORDINATOR_PROFILE=sandbox npm run readiness:check -- --json
RELEASE_COORDINATOR_PROFILE=sandbox npm run merge:rehearse -- --issue NUMBER --plan PLAN_JSON --json
```

`request:submit` explicitly dispatches intake and waits up to five minutes for
verified receipt. It saves a prepared record before dispatch and a separate
result. Existing identical receipts, including closed tickets, are reused.
Duplicate/different request data stops submission. Uncertainty is not permission
to retry blindly; inspect the prepared record, workflow, and inbox first.

Sandbox request JSON adds `"profile": "sandbox"` and uses the actual two test
repository names in `release_parts[].repository`. The private adapter checks
those names, then applies the same public schema field/type rules. Real request
JSON uses the unchanged public schema and its two real repository names.
Sandbox JSON cannot validate as a public release request; test records and
workflow receipts cannot be promoted by changing the environment setting.

The installed public npm CLI `0.0.4` retains its existing real-only behavior.
This stage does not publish or require a new npm version. The new profile-aware
submission command belongs to the private Coordinator workspace.

`request:submit` and `merge:rehearse` require an explicit profile. Existing
`inbox:read`, `readiness:check`, and `inbox:process` keep their real default for
backward compatibility, but honor an explicitly selected sandbox profile.
Use an explicit setting during sandbox work. `--help` performs no reads/writes.

Ticket processing remains a separate explicit write command:

```sh
RELEASE_COORDINATOR_PROFILE=sandbox npm run inbox:process -- --issue NUMBER --json
```

It uses the same existing ticket policy and its own inbox journal. A passing
rehearsal does not change ticket status or authorize a release.

## Explicit plan for one verified ticket

The plan names the ticket binding and exact destination/merge order. It cannot
add, omit, duplicate, or change any requested PR. Request part dependencies must
agree with the order. Multi-part requests in one repository retain their service
dependencies; a repository order that cannot satisfy the parts is rejected.

```json
{
  "schema_version": "1",
  "profile": "sandbox",
  "source": "inbox-plan",
  "inbox": {
    "repository_id": 1362580376,
    "issue_number": 1,
    "request_id": "REQUEST_UUID_FROM_RECEIPT",
    "checksum": "REQUEST_CHECKSUM_FROM_RECEIPT"
  },
  "repositories": [
    {
      "role": "frontend",
      "destination": { "branch": "main", "commit": "FULL_DESTINATION_COMMIT" },
      "pull_requests": [
        { "number": 1, "branch": "EXACT_REQUESTED_BRANCH", "commit": "FULL_REQUESTED_COMMIT" }
      ]
    }
  ]
}
```

Placeholders above are explanatory, not runnable fixture values. The shared
`inboxBinding`/`inboxMergePlan` helpers construct and verify the binding. The
reader verifies current workflow proof before any merge and again afterward.
The engine rechecks PRs/destinations/checks as before. A changed proof is stale;
a closed, missing, invalid, or unreadable ticket on recheck prevents a pass.
Reports retain both receipt observations, the exact PR/destination trees, and
`release_authorized: false`. Existing `--manifest` input remains sandbox-only
and can never stand in for verified inbox input.

## Verification and finish line

Local tests cover both named profiles using the same functions: submission,
workflow validation, receipt verification, real temporary Git merges, exact
ticket/PR scope, closed-ticket rechecks, hostile or crossed profile input,
repeated submissions, and separate records/journals. Tests do not contact GitHub.

The sandbox live proof must:

1. Submit one sample request and verify its actual workflow, actor, ticket, and checksum.
2. Reuse that receipt on retry without a second ticket.
3. Inspect and, when explicitly run, organize the sample ticket in its own journal.
4. Rehearse its exact sample PRs and destination commits with the existing engine.
5. Confirm unchanged sample PR refs and real inbox/state, cleanup, and a durable report.

Record the source pin, local runtime revision, fixture commits, receipt and
workflow URLs, report results, and separate CI/merge evidence in progress.
Stop at this finish line. Switching the new Coordinator commands to `real`
requires only the named configuration once installed, but permissions, product
repository limits, and the first real live run still need verification. Offline
real-profile tests are not real-system runtime proof.
