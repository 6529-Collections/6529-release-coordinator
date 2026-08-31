# 6529 Release Coordinator

6529 Release Coordinator is a proposed service for moving exact frontend and
backend changes through `main`, build, staging, production, checks, and recovery.
A developer or agent does not need to watch the release while it runs.

Status: **the first local CLI is implemented**. The full Coordinator remains a
design. This repository does not yet contain a running API, worker, database,
GitHub App, or deployment authority.

[Open the interactive process diagram](./release-coordinator-process.html)

[Open the first-version architecture](./release-coordinator-architecture.html)

The first implementation is smaller than the full design. It is one small CLI
package. The existing agent flow can call it without asking the developer to
fill in a new form or write JSON.

Every `create` run is saved locally. A successful run also creates a valid
release-request JSON file. A failed run saves its input and validation
errors, but it will not create a valid release request. Nothing is posted, and
no release starts.

The release-request contract is saved in the
[versioned JSON Schema](./packages/release-request/release-request.schema.json), with a
[field guide](./release-request-schema.md) and a
[valid example](./packages/release-request/release-request.example.json).

## First software piece

All Release Coordinator source code can live in this repository without making
frontend and backend install the full Coordinator.

The first package is:

```text
packages/release-request/
```

The package is named `@6529/release-request`. It is not published or installed
in the product repositories yet. When that integration is added, frontend and
backend will install only this package. Their existing agent skills will call
its `6529-release-request` command.

The package will contain only:

- the CLI command;
- release-request creation;
- local validation;
- local run records;
- local release-request files.

It will not contain the future Coordinator server, queue, database, GitHub App,
build logic, deployment logic, or these HTML documents.

The future central system can be added separately in the same repository:

```text
apps/coordinator/
```

That application will be deployed as a service. Frontend and backend will not
install it.

### Local files from the first CLI

| File | Created when | Meaning |
| --- | --- | --- |
| `.release-coordinator/runs/<run-id>.json` | Every `create` run | Shows whether the CLI started, succeeded, or failed. A record left as `running` shows that the run did not finish cleanly. |
| `.release-coordinator/outbox/<request-id>.json` | Only after validation passes | The valid release request that a later Coordinator can accept. |

The CLI saves the run record before it creates the request. It updates the same
record when validation succeeds or fails. If validation fails, the error is
kept in the run record and no request is added to the outbox.

These paths are inside the frontend or backend repository where the agent runs
the command. The whole `.release-coordinator/` folder is local runtime data and
should be ignored by Git.

For a combined frontend and backend release, the agent runs the CLI once from
the repository where the release was requested. The one JSON request contains
both release parts. The CLI does not create a second copy in the other
repository.

## The problem

Many developers and agents want to release work at the same time. Today, merge
and deployment are too tightly connected:

- one deployment may require `main` to stay unchanged for a long time;
- another PR can merge while a deployment is running and invalidate a later
  `main` equality check;
- frontend and backend PRs may need a specific order;
- shared staging and production cannot safely accept overlapping mutations;
- someone must keep watching workflows, tests, retries, and recovery;
- it is difficult to answer what is queued, what is running, and what exact
  code is deployed.

The Coordinator should make release submission asynchronous and durable:

> Submit exact ready PRs and their dependencies. The system owns the release
> until it finishes or reaches a problem that genuinely needs a human.

## Core rule: one release lane

Only one batch may use the release lane at a time.

The active batch keeps the lane until the release finishes or recovery is
complete. While it owns the lane, no other batch may:

- freeze its versions;
- change `main`;
- use staging;
- deploy to production.

Developers may keep working on pull requests. Review and CI may also continue.
Those changes wait for a later batch before they can merge.

This is slower than running several releases at once. It is also easier to
understand and recover in version one. The Coordinator always knows which one
batch owns `main`, staging, and production.

## Process at a glance

1. Submit the release request.
2. Check who sent it.
3. Check the pull requests.
4. Decide recovery safety.
5. Reserve the release lane.
6. Freeze the release batch.
7. Prepare the release branches.
8. Test the full batch.
9. Recheck everything before changing `main`.
10. Move the tested code to `main`.
11. Build the release.
12. Update the staging database when needed.
13. Deploy the backend to staging.
14. Deploy the frontend to staging.
15. Confirm the staging versions.
16. Test important journeys in staging.
17. Save the recovery point.
18. Update the production database when needed.
19. Deploy the backend to production.
20. Deploy the frontend to production.
21. Release to more users slowly when supported.
22. Confirm the production versions.
23. Test important journeys in production.
24. Watch production health.
25. If something failed, recover to one known state or wait for a person.
26. Close a successful release.

Step 25 is a failure path. A successful release skips it and moves from health
checks to the final close step.

## Product promise

A developer, automation, or agent can submit one release request containing:

- exact frontend and backend PR numbers and 40-character head SHAs;
- dependencies between release parts;
- selected backend deploy units and any release-specific dependencies;
- whether the frontend, backend, or both will change;
- whether the database changes;
- requester identity and request time.

Once accepted, the Coordinator queues, merges, builds, deploys, tests, retries,
recovers, and reports the exact outcome. The submitter does not need to keep a
browser, terminal, or agent task open.

## Architecture

```mermaid
flowchart LR
    U[Developer or agent] --> C[Web UI, CLI, or skill]
    C --> API[Release Coordinator API]
    API --> DB[(Coordinator database)]
    DB --> W[Coordinator worker]

    W --> GH[GitHub API and merge rules]
    W --> FE[Frontend workflows]
    W --> BE[Backend workflows]
    W --> DBC[Database change workflow]
    FE --> ART[Saved builds]
    BE --> ART
    FE --> STG[Staging]
    BE --> STG
    FE --> PROD[Production]
    BE --> PROD
    DBC --> STG
    DBC --> PROD

    STG --> E2E[Version and journey checks]
    PROD --> E2E
    E2E --> API
    API --> C
```

The Coordinator is a separate system. It coordinates the product repositories
but does not copy their build, deployment, journey-test, notification, or release-note
logic.

### Coordinator owns

- authenticated release submission;
- the durable cross-repository queue;
- dependency resolution and stable ordering;
- release state, attempts, ownership records, errors, and history;
- one global release lane;
- staging and production environment ownership;
- workflow dispatch and result correlation;
- exact saved batch records and build identities;
- retries, safe recovery, and notifications.

### Product repositories own

- PR review and CI;
- how frontend and backend code is built;
- how the backend is deployed;
- how the frontend is deployed;
- how database changes are applied;
- runtime version reporting;
- repository-specific checks and journey-test entry points;
- deployment communication and release-note implementations.

## Request submission

The first implementation saves every `create` run locally. A valid request is saved
to the local outbox. It has no API and sends nothing anywhere.

Later, all entry points should call the same authenticated Coordinator API:

- a small web interface;
- a CLI command;
- a Codex or agent skill;
- a direct API client.

A version `0.000001` request looks like this:

```json
{
  "schema_version": "0.000001",
  "request_id": "11111111-1111-4111-8111-111111111111",
  "created_at": "2026-08-31T09:00:00Z",
  "requested_by": "simo",
  "target": "staging",
  "database_change": "no",
  "release_parts": [
    {
      "id": "backend",
      "repository": "6529seize-backend",
      "pull_requests": [
        {
          "number": 123,
          "branch": "feature/backend-change",
          "commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      ],
      "depends_on": [],
      "deploy_units": ["api"],
      "deploy_dependencies": []
    },
    {
      "id": "frontend",
      "repository": "6529seize-frontend",
      "pull_requests": [
        {
          "number": 456,
          "branch": "feature/frontend-change",
          "commit": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }
      ],
      "depends_on": ["backend"]
    }
  ]
}
```

The JSON contract for the local first version is defined by
[`release-request.schema.json`](./packages/release-request/release-request.schema.json). A future API may
wrap this request, but it should not change what the fields mean.

## Where queue state lives

The Coordinator uses its own database, such as PostgreSQL or MySQL. GitHub has
one merge queue per repository, so it cannot hold the full truth for one release
that includes both frontend and backend.

Minimum durable records:

- release request and requester;
- ordered release items and dependency edges;
- exact PR heads and captured `main` SHAs;
- current state and state-transition history;
- merge, build, staging, production, and journey-test attempts;
- GitHub workflow run IDs and links;
- saved build checksums and running version identities;
- retry limits, blockers, ownership records, and human decisions.

Only the Coordinator changes queue state. GitHub statuses and PR comments are
useful projections, but they are not the authoritative queue.

## How progress is saved

Before each step starts, the Coordinator saves what it is about to do. It also
saves which worker is doing the work and when that worker last reported that it
was active.

After the step finishes, the Coordinator saves the result and the proof. It
moves to the next step only after this save succeeds.

Each release record shows:

- the current step and status;
- when the step started and finished;
- which worker is responsible;
- the result and its proof;
- the current blocker, if there is one;
- what should happen next.

If a worker stops, another worker reads this record and checks what really
happened before it continues. It does not trust browser memory or a workflow
success message.

If the start or result cannot be saved, the release stops. It does not move to
the next step or open the release lane while its state is unclear. Saving the
same progress again must be safe and must not create a second result.

## Sources of truth

| Fact | Source of truth |
| --- | --- |
| Release intent, queue, order, and current phase | Coordinator database |
| PR number, current exact head, review, and CI | GitHub |
| Saved build identity | Trusted build storage |
| What is actually running | Runtime version proof |
| Whether the running release works | Journey tests and health signals linked to the saved batch |

## How `main` is protected

`main` is always protected by GitHub repository rules. Normal users and agents
cannot push or merge directly. A narrowly permitted Release Coordinator GitHub
App is the normal merge actor.

The database queue decides order. GitHub rules enforce authority.

When a batch reaches the front of the queue, the Coordinator:

1. reserves the global release lane;
2. freezes the exact pull request versions and current `main` versions;
3. combines and tests the full batch on temporary branches;
4. checks the pull requests, approvals, CI, dependencies, and `main` again;
5. moves the tested result to `main`;
6. keeps the lane until the release or recovery is complete.

The final recheck and the change to `main` happen together. If anything changed,
`main` does not move.

GitHub cannot atomically merge two different repositories. Therefore:

- all cross-repository changes are fully preflighted before the first merge;
- backend changes must be safe to land before dependent frontend changes,
  normally through backward compatibility or a feature flag;
- if only part of the cross-repository merge succeeds, the release stops,
  records exact truth, and requires a deliberate repair;
- the system never claims that two repository merges were atomic.

An emergency administrator bypass may exist, but it is not part of the normal
release path and must be audited.

## Queue and release lane

Many requests may wait in the durable queue. Only one batch may become active.

The active batch owns one global lane across `main`, staging, and production.
No later batch may overtake it. A later batch starts only after the active
release finishes or recovery reaches a known safe result.

The lane is saved in the Coordinator database. It has an owner, a heartbeat,
and a current step. If the worker stops, another worker must prove that it can
continue safely before it takes over.

## Release lifecycle

The first state model is:

```text
SUBMITTED
  -> CHECKING
  -> WAITING
  -> ACTIVE
  -> PREPARING
  -> TESTING
  -> MOVING_MAIN
  -> BUILDING
  -> STAGING
  -> STAGING_VALIDATED
  -> PRODUCTION
  -> VERIFYING
  -> DONE
```

This is the successful path. If a release fails after `main`, staging, or
production changed, it leaves this path and enters `RECOVERING`. A successful
release never passes through recovery.

Important final or side states:

- `CANCELLED`
- `NEEDS_HUMAN`
- `RECOVERING`
- `RECOVERED`
- `FAILED`

Every transition is saved before later work begins. Operations are designed to
be safe to retry, and workers claim durable ownership so a restart cannot create
two owners for one mutation.

## Staging

For each release, the Coordinator:

1. applies the saved database change when the batch has one;
2. checks that the staging database change worked;
3. deploys the saved backend build;
4. deploys the saved frontend build after the backend is ready;
5. confirms the exact frontend and backend versions;
6. tests the important user journeys;
7. records `STAGING_VALIDATED` only when the versions and tests pass.

Staging validation belongs to the saved batch. A successful workflow is not
enough. The running versions and the user journeys must both pass.

## Production

Production receives the same saved builds that passed staging.

The Coordinator:

1. checks and saves the current production versions and last working builds;
2. applies the saved database change when the batch has one;
3. deploys the backend build;
4. deploys the frontend build after the backend is ready;
5. gives the release to more users slowly when the platform supports it;
6. confirms the exact production versions;
7. runs safe tests of important user journeys;
8. watches health for the full agreed time;
9. closes the successful release only when every check passes.

The Coordinator compares production with the saved batch. It never trusts a
deployment success message on its own.

## Recovery path

Recovery is a separate path. It runs only after `main`, staging, or production
changed and the release later failed.

The Coordinator:

1. stops the release and saves the exact current state;
2. chooses automatic recovery only when the database did not change and
   restoring the old code is safe;
3. restores the last working builds and adds new commits that undo the failed
   code, or follows the plan chosen by a person;
4. confirms the running versions, tests important user journeys, and checks
   system health;
5. closes the failed release and releases the lane only when the system is safe
   and its exact state is known.

These steps are shown as `R1` to `R5` in the process diagram. If the database
changed or anything is unclear, a person chooses how to recover. The lane stays
reserved until recovery is complete.

## Failure and recovery rules

### Database changes

The request says whether the database changes. The Coordinator also checks the
changed files. A yes from either source means database change.

The same saved database change runs in staging first and production later. It
runs before the backend deployment in this first design. Each environment must
report a clear result.

A database-changing release never recovers automatically. If it fails after the
database changed, the Coordinator saves the exact state and waits for a person.

### A waiting PR moves

Cancel or supersede the old exact request. Never silently deploy the new head.

### An active PR branch moves

The release continues with its already saved `main` commits and builds.
The newer PR head belongs to another request.

### Merge conflict or failed preflight

No release build is produced. The request becomes `NEEDS_HUMAN` with the
exact PR and blocker. Because `main`, staging, and production did not change,
the Coordinator releases the lane. Dependent work stays blocked, but unrelated
waiting work may continue in a later batch.

### Partial cross-repository merge

Stop. Record which `main` branch changed and which did not. Do not deploy or
pretend the merge was atomic. A human chooses the exact repair.

### Infrastructure failure

Retry only the same exact command and build within a fixed limit. An
AWS, GitHub, network, or runner failure is not evidence that a PR is bad.

### Build failure

Stop before staging. Because `main` already changed, the batch moves to the
recovery path. The lane stays reserved until `main` is repaired or a person
chooses another safe result.

### Staging application or journey-test failure

Do not validate the release. Move to recovery. A non-database batch may restore
the last working staging builds when every safety check passes. A
database-changing batch waits for a person.

Version one does not search for a smaller passing batch. The failed batch stops
with a clear reason.

### Production failure

Stop giving the release to more users. Save the exact running versions and
database state. A non-database batch may restore the saved builds and add new
commits to `main` that undo the failed code when every safety check passes. A
database-changing or unclear result waits for a person.

Recovery is complete only after the restored versions and health are checked.
The system never reports success from a workflow message alone.

### Stop request

- Before mutation, Stop cancels the release immediately.
- After mutation begins, Stop means safe stop. Finish or stop the active command,
  save the exact state, and enter recovery.

## Submit and almost forget

The API acknowledges a durable release ID. From that point, event-driven
workers and workflow callbacks continue the release without browser or agent
polling.

The submitter is notified only for meaningful outcomes:

- request accepted;
- staging validated;
- production completed;
- request cancelled because exact code changed;
- recovery completed;
- human action required, with the exact blocker and evidence links.

## Version-one scope

Version one should include:

- exact frontend and backend PR submission;
- explicit dependencies and deployment order;
- one durable database queue;
- one global release lane;
- GitHub-enforced protected `main` branches;
- one final safety check before `main` changes;
- saved batch records and builds that cannot change;
- clear database, backend, and frontend deployment steps;
- exact version checks and important journey tests;
- safe automatic recovery only for non-database releases;
- human recovery for database-changing or unclear releases;
- bounded infrastructure retries;
- final notifications and an operator dashboard.

## Explicit non-goals for version one

- automatic PR discovery;
- large automatic release trains;
- automatic search for a smaller passing batch;
- more than one active release batch;
- automatic recovery after a database change;
- pretending cross-repository merges are atomic;
- copying product build and deployment logic into the Coordinator;
- allowing two deployment authorities for the same environment;
- treating a successful workflow message as proof that deployment worked.

## Open decisions

- database technology and hosting;
- API and authentication contract;
- GitHub App permissions and emergency access;
- maximum release size;
- exact merge implementation and repository rules;
- database change commands and version proof;
- gradual rollout support;
- runtime version proof for the frontend and backend;
- production health signals and limits;
- how the Coordinator proves workflow results are real and handles timeouts;
- retention and audit requirements;
- human recovery roles;
- disaster recovery for the Coordinator itself;
- how the Coordinator is deployed without depending on its own release path.

## Design influences

- [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Google Cloud CI/CD guidance](https://cloud.google.com/solutions/best-practices-continuous-integration-delivery-kubernetes)
- [Google SRE canary guidance](https://sre.google/workbook/canarying-releases/)

These sources guide the design, but this document is the project contract. The
first implementation must not silently add behaviour that is absent here.
