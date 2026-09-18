# 6529 Release Coordinator

## Purpose

This is a standalone project for designing and implementing a new release
coordinator from the ground up. Request submission, local inbox inspection,
read-only readiness observations, and one manual `inbox:run` workflow are
implemented. That workflow inspects tickets, rehearses suitable exact PRs, runs
supported sandbox service/database checks, and updates the same ticket and
journal. See progress for local implementation versus merged and live evidence.
Unscoped sandbox runs select whole tickets together, finish cheap conflict
filtering before expensive combined PR/service checks, and record deferred tickets.
They can also take one selected no-database-change batch through protected fake
staging, locked npm builds and artifacts, matching built-output E2E, protected
fake production, and another matching E2E. Real product release execution
remains a design; passing sandbox checks never authorize it.
One verified database-changing ticket can use the sandbox release path alone;
a failure then stops for a person without automatic restoration. The merged
source also restores changed test `main` and staging branches after a confirmed
no-database-change fake-production failure. The merged source deploys a sample
monitoring package for a production ticket that selects operational monitoring,
after the test-main merge and before production application deployments; the
sample backend deploys monitoring only from test `main`, like the real one.
Check progress for live proof.

It is intended to coordinate releases across:

- [6529seize-frontend](https://github.com/6529-Collections/6529seize-frontend)
- [6529seize-backend](https://github.com/6529-Collections/6529seize-backend)

## Finding the product projects

Look for local checkouts named `6529seize-frontend` and
`6529seize-backend`. If local checkouts are unavailable, use the GitHub links
above.

Read their code when real frontend or backend context is needed. Read each
project's own `AGENTS.md` before inspecting it deeply. Do not edit either
project unless the user explicitly asks for that work.

## Existing Release Bus work

The existing Release Bus code, documents, workflows, and terminology inside
the frontend and backend projects are earlier failed attempts.

They are not a source of truth for this project and have no design authority
here. They may be inspected only to understand past problems or useful lessons.
Do not copy their architecture or assume this project must remain compatible
with them.

Design decisions for the new Coordinator are made in this standalone project
from first principles.

## Adding limits

Do not add a new Coordinator policy limit for time, retries, attempts, queue
size, history, batch size, or similar behavior merely as a precaution. Discuss
the concrete problem and tradeoff with the user first, and add the limit only
after the user explicitly agrees. Necessary platform timeouts and limits imposed
by an external service may be represented accurately; document their source.
Existing limits stay unchanged until they are separately discussed.

## Documentation map

- `README.md` is the entry point and documentation index.
- `docs/progress.md` is the concise current status, next steps and evidence index.
  Keep detailed past delivery narratives in `docs/history/` and dated acceptance
  reports in `docs/testing/`; do not turn historical plans into a fresh work queue.
- `docs/code-checks.md` owns checks for this repository's code and PR gate.
  `npm run check` runs non-fixing lint, formatting checks, all offline tests,
  workflow policy checks, and a packed-CLI smoke test. It does not run the inbox.
  Keep format fixes separate and distinguish local checks from live GitHub CI.
  The same guide owns the fixed 6529bot/CodeRabbit review set, CodeQL and Snyk
  setup. Preserve draft/push coverage, scoped analysis permissions and central
  bot admission/budgets. Distinguish checked-in config from base-branch activation,
  external integrations, completed reviews and enforced GitHub merge rules.
- `docs/inbox-processing.md` owns the ticket workflow,
  status/reason labels, submitter ownership, history requirements, and migration.
  Check `docs/progress.md` for local implementation versus merged/runtime proof.
  Documentation alone does not authorize changing tickets.
  Keep existing read-only commands read-only. Ticket inspection, rehearsal, and
  presentation use the single explicit `inbox:run` command. Require a named
  profile. Generate each ticket's plan from its scope/dependencies and trusted
  rehearsal destination configuration; save pinned inputs before Git work.
  Never require operator plan files or import saved reports.
  Preserve `codex/inbox-state` and its workflow marker; older writers must stop.
- `docs/profiled-inbox-testing.md` owns the shared sandbox/real profile switch,
  isolated test inbox, complete-request submission, receipt boundaries, separate
  journals/reports, and one-ticket rehearsal plan. Public npm remains real-only.
  Profile selection never grants permissions or promotes sandbox proof into real
  evidence. Check progress for offline versus actual live acceptance.
- `docs/merge-rehearsal-testing.md` owns the sandbox rehearsal scope,
  its test repositories, test matrices, and finish lines. The current sandbox stage
  tests one ticket's services/database behavior, bounded no-database-change
  batches, and one database-changing ticket alone.
  Its service/database section owns the small programs, temporary MySQL baseline,
  declared-versus-observed database answer, ordered steps, retry/stop evidence,
  and cleanup. It also owns the protected fake staging/E2E/production release
  sequence, its dated live acceptance, and sandbox environment restoration
  acceptance. Keep the shared Coordinator logic and
  explicit profile boundary; sandbox actions never enable real deployment. Check progress for local
  implementation, live coverage, and GitHub account limitations.
  Keep test manifests separate from verified inbox requests; do not widen the
  public schema or production repository allowlist to accommodate test fixtures.
  Documentation is not permission to create external resources. Keep the runtime
  bundle identical to its source, verify its fixed branch/commit, and preserve
  service, batch, and release attempts in the v6 journal before dispatch.
  Publish generated runtime changes to test `main` first, then merge that history
  into protected `1a-staging`; never create unrelated lookalike runtime commits
  on both branches. Keep trial and environment integration commits distinct so
  checks cannot be reused across stages.
- `docs/design.md` and the full process diagram contain the agreed execution
  direction for the real products. Its sandbox release and staging restoration
  subsets, including fake-production restoration, are live tested in the sandbox.
  Its operational-monitoring section owns the agreed order: monitoring deploys
  only from `main`, after the production merge and before production
  application deployments; the sandbox models it with a sample package.
  Product adapters and real-production rollback are not built. Reuse existing product Actions and their
  environment-specific builds; no configuration redesign or portable artifacts.
  Wait for successful matching staging E2E before production merges into `main`.
  Keep one release active through completion or recovery. Automatic rollback
  requires confirmed no database change, verified revert commits and ordinary
  deploy/check steps; otherwise stop for a person. Its v0.1 logging section owns local
  run diagnostics; logs never replace journal authority or prove a process stopped.
  Heartbeat and automatic process takeover remain deferred. Real-product release
  rollback is future work, distinct from process restart. Keep state in the GitHub journal;
  `docs/inbox-processing.md` owns verified archives and v6 migration; preserve
  unfinished work, archive checksums, original attempts and per-run budgets.
  Lifetime record caps are removed; keep sandbox migration evidence separate from
  real-profile migration and release execution.
  A separate database/dashboard is not required. Its batch-testing section owns the bounded
  search before release mutations: keep tickets/dependencies whole,
  test the final exact combination, and never blame every member of a failed
  group. Batch ticket projections belong in `docs/inbox-processing.md`; planned
  acceptance cases belong in `docs/merge-rehearsal-testing.md`. These are sandbox
  requirements for sandbox batching, not real release authorization. The current
  sandbox adapter and release sequence support self-contained tickets only; cross-ticket dependency
  declarations and database-changing multi-ticket batches remain deferred. Keep cheap
  filtering before expensive checks, preserve owned trial cleanup and agreed count budgets.
- CLI, inbox reader, and readiness usage belong in their package/application
  READMEs. The JSON Schema owns the request shape; `release-request-schema.md`
  explains it. Ticket lifecycle fields belong to Coordinator state, not the
  submitter's request JSON.
- `docs/npm-publishing.md` is the publishing/adoption guide.
- `docs/history/` holds historical evidence, not current work instructions.

Update the relevant guide and progress record when implementation changes.
Distinguish local implementation, tests, remote merge, package publication,
and runtime/deployment proof. Keep current status out of historical snapshots.
