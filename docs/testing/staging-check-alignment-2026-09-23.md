# Staging check alignment — September 23, 2026

This change matches the test repositories' staging branch policy to the real
frontend and backend staging branches. It does not change either real product
repository, its Actions workflows, or its GitHub settings.

## Observed difference

- Real frontend and backend `1a-staging` had no effective ruleset rules and no
  classic branch protection. On backend
  [PR #2037](https://github.com/6529-Collections/6529seize-backend/pull/2037)
  and frontend
  [PR #4043](https://github.com/6529-Collections/6529seize-frontend/pull/4043),
  GitHub reported passing DCO and `security/snyk (6529)` as optional. The
  backend `Build backend and API` workflow and
  frontend `App PR CI` and `Debt Ratchet` workflows target PRs to `main` only.
- Both test `1a-staging` branches previously had classic protection requiring
  `Sandbox check`, plus PR-only, conversation-resolution and no-force-push
  rules. That was stronger than the real staging policy.

## Change and readback

The Coordinator now gates staging integration PRs on configured checks reported
for the exact integration commit even when GitHub marks them optional. Real
staging uses DCO and Snyk; test staging uses `Sandbox check`. A missing,
unfinished or failed configured check cannot pass. Any additional check GitHub
does require must also pass. Production `main` keeps the earlier rule: every
configured integration check must be marked required by GitHub and pass.

Classic branch protection was removed only from `1a-staging` in the two test
repositories. A readback returned `Branch not protected` for both. GitHub's
`isRequired` query then reported `false` for `Sandbox check` on test backend
[PR #135](https://github.com/6529-Collections/release-coordinator-test-backend/pull/135)
and test frontend
[PR #123](https://github.com/6529-Collections/release-coordinator-test-frontend/pull/123).
Both test `main` branches and both `rehearsal-target` branches still require
`Sandbox check`. No real product setting changed.

`npm run check` passed locally: 601 tests passed, 3 Docker-only cases skipped,
with lint, formatting, workflow policy, documentation and package checks
passing. Focused release tests cover optional staging checks, a status-context
Snyk result, missing checks, unrelated required checks, failed staging checks,
and retained required-check enforcement for production.

This is live settings readback plus offline Coordinator proof, **not** a fresh
end-to-end sandbox release after the settings change. The earlier protected
staging acceptance reports remain historical evidence only. No real product
release or rollback was run.
