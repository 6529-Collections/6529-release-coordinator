# Real frontend approval-bypass configuration — September 24, 2026

This is a read-only product-rule audit and an offline Coordinator test, **not**
a real release or merge-bypass acceptance. No frontend/backend code, GitHub rule,
product branch, workflow, or deployment was changed by this audit.

GitHub reported frontend `main` ruleset `18018081` active and the current
`simo6529` token eligible for `pull_requests_only` bypass. Its one-review rule
and strict required-check rule remain in force. The effective required checks
were `DCO`, `security/snyk (6529)`, `Plan risk and security checks`,
`Installed app checks`, and `Debt ratchet`. The Coordinator real profile now
pins that exact ruleset and those names for the frontend only; the real backend
has no bypass pin. The shared gate still independently checks every requirement
it understands and rejects missing, unfinished, changed, or unknown evidence.

The read-only Coordinator probe of frontend
[PR #4093](https://github.com/6529-Collections/6529seize-frontend/pull/4093)
read head `d635b5fbcf59f08250e21c311fca216f3e79d5a0` and base
`82583c91f81e29779e727cd583c5f6ea35fcb245`. All five required checks
reported success, but GitHub reported `BEHIND`, so the new real profile returned
**no** bypass. This is the required stop, not a release failure.

Offline tests cover an otherwise eligible real-frontend PR, each required
check separately missing or unfinished, a `BEHIND` PR with all five checks
green, and a ticket whose pinned SHA differs from the PR head. The full local
`npm run check` passed: 621 tests ran, 618 passed, three Docker-only tests
skipped; lint, formatting, docs, workflow policy, and package checks passed.
GitHub CI and review are separate evidence.

Existing [staging Issue #224](https://github.com/6529-Collections/6529-release-coordinator/issues/224)
is verified for actor `simo6529` but pins the old PR head. Updating the PR
branch changes that SHA, so Issue #224 cannot be reused for the eventual real
staging test. A new verified ticket pinned to the new head is required. No real
Coordinator release, integration merge, deployment, E2E, or rollback was run.
