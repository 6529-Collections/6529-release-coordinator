# 6529 Release Coordinator

## Purpose

This is a standalone project for designing and implementing a new release
coordinator from the ground up. Request submission and local inbox inspection
are implemented; release execution remains a design.

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

## Documentation map

- `README.md` is the entry point and documentation index.
- `docs/progress.md` records dated implementation, merge/publication evidence,
  next steps, and deliberately deferred work.
- `docs/design.md` contains the proposed execution design and unresolved
  differences with the full process diagram. Settle those choices before
  implementing release execution.
- CLI and reader usage belong in their package/application READMEs. The JSON
  Schema owns the request shape; `release-request-schema.md` explains it.
- `docs/npm-publishing.md` is the publishing/adoption guide.
- `docs/history/` holds historical evidence, not current work instructions.

Update the relevant guide and progress record when implementation changes.
Distinguish local implementation, tests, remote merge, package publication,
and runtime/deployment proof. Keep current status out of historical snapshots.
