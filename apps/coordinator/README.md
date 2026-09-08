# Local inbox reader

This private workspace is the first Coordinator application. It reads the saved
requests in `6529-Collections/6529-release-coordinator` and prints a report.
It runs manually on your machine and exits. No server, timer, database, or
deployment worker is started.

## Run

Use Node.js 20+ and a current GitHub CLI (`gh`) authenticated to `github.com`.
The account needs read access to the repository's Issues and Actions logs.
The reader uses your existing `gh` authentication; do not put tokens in source.
It does not prompt for credentials or change authentication.

From the repository root, install dependencies if needed:

```sh
npm ci --ignore-scripts
```

Then run one scan:

```sh
npm run inbox:read
```

For machine-readable JSON, suppress npm's script banner:

```sh
npm run --silent inbox:read -- --json
```

Help is available with `npm run inbox:read -- --help` and makes no GitHub calls.

## What gets checked

1. Read every page of **open** Issues with both `release-request` and `pending`.
   Exclude pull requests, closed Issues, and Issues missing either label.
2. Read the single saved JSON block. Reuse the request package's schema and
   checksum implementation. Check the ID and displayed metadata agree with it.
3. Read the linked GitHub workflow run from the fixed Coordinator repository.
   Require `submit-release-request.yml`, `workflow_dispatch`, a `main` run from
   this repository, the matching request title, and a successful completed run.
4. Identify the successful save job and step in that exact run attempt, reading
   all job pages. Read its logs through the GitHub API. Require one actual
   `RELEASE_REQUEST_RESULT` output line, excluding echoed commands.
5. Match the workflow result's Issue number/link, request ID, full request
   checksum, run ID/link, and actor name/ID. Compare the actor with GitHub's run
   metadata. The request's `requested_by` remains supplied text, not proof of
   identity. Repeated request IDs across pending Issues are reported as invalid.

The report includes the saved PR numbers, branches and full commits, release
target, database-change answer, part dependencies, backend units and their
order, and the verified GitHub actor when proof succeeds.

## Results

| Status | Meaning |
| --- | --- |
| `valid` | The saved request matches its schema, checksum, and expected workflow evidence. |
| `invalid` | The saved record is malformed, contradictory, duplicated, or differs from the workflow evidence. |
| `unverified` | Evidence cannot be obtained or uniquely confirmed, or the latest workflow attempt has not succeeded. |

| Exit code | Meaning |
| --- | --- |
| `0` | Every selected record is valid, or a successful scan found no pending Issues. |
| `1` | At least one record is invalid or unverified. |
| `2` | The Issue listing failed or command options were invalid. No complete inbox report is claimed. |

An authentication, network, rate-limit, unexpected-response, or later-page
failure never becomes an empty inbox. A workflow read failure is reported on
that request, allowing the rest of the inbox to be inspected. GitHub calls have
a 30-second timeout and a 16 MiB response limit. Unreadable or oversized logs
leave the request unverified. Raw logs and CLI stderr are not printed.

## Limits and trust

**This checks the saved record, not whether it should be released now.** It does
not check current PR heads, checks, approvals, deployment-unit existence, or
whether the dependency graph makes sense. It never chooses between two requests
for different commits of the same PR. It does not authorize a release.

The trust source is GitHub's run metadata and result from this repository's
inbox workflow on `main`. This is not an independent audit of that workflow or
its dependencies. Editable labels, Issue titles, actor table rows, and a
self-consistent checksum alone are insufficient proof.

The reader captures the run's latest attempt and reads jobs/logs for that
attempt only. If a rerun is in progress or fails, the request is unverified even
if an earlier attempt succeeded. Deleted or expired logs also leave it
unverified; it never falls back to trusting only the Issue body. GitHub's
paginated API is not an atomic snapshot, so a report describes the records
observed during that scan. Repeated Issues across pages cause an explicit error.

Closed test Issues are excluded by selection. An old test still labelled
pending can appear as a valid saved record: that does not make it a real release.
In particular, historical test Issue #1 was still open and pending on September
8, 2026. The reader cannot decide whether a saved request is still wanted.

## Read-only boundary and tests

The GitHub adapter allows only a fixed set of Issue/run/job/log endpoints in
this repository, always with explicit HTTP `GET`, without a shell or request
body. The reader has no GitHub write action, merge/deploy operation, workflow
dispatch, scheduler, or local request-record write. It does not call the CLI's
create/submit/save functions. Its workspace is private and adds no dependencies
or files to the published release-request package.

Run all package and reader tests from the repository root with `npm test`.
The existing PR check runs both suites. Reader tests cover altered and copied
records, actor/run mismatches, unavailable and ambiguous evidence, pagination,
closed tests, duplicate requests, output safety, read failures, and the GET-only
adapter. Unit tests use fake GitHub responses and do not contact GitHub.
