# Real production ticket #275: staging workflow pin refresh, September 30

The user authorized one real-profile, filtered production run for
[Issue #275](https://github.com/6529-Collections/6529-release-coordinator/issues/275),
verified actor `simo6529` (GitHub ID `209783236`). It selects only frontend
[PR #4120](https://github.com/6529-Collections/6529seize-frontend/pull/4120) at
`4ccf9b27fac235ea151aa6ed169a52797ead855f`, with no database change or dependencies.
Coordinator `main` was `a605c0f472b40a236b009317a013756eccba104c`.

## Original stopped run

Run `43c83236-e05c-438f-a664-0d2aea5f40d1` passed intake, exact PR rehearsal,
combined Git checking and all 20 candidate checks on temporary frontend
[PR #4131](https://github.com/6529-Collections/6529seize-frontend/pull/4131).
The trial PR was closed unmerged and its owned branch removed. The saved batch
fingerprint is `25e7f2642c5e43e1fa561748ad419e493659e1ece49d3255662e88036d6e50e4`.

Runtime verification stopped the command before release authorization with
`release-runtime`. Journal revision 397 retained the same run lock, ticket `[275]`,
filtered actor scope and `execution: null`. The original process exited 2.
No staging or production integration, deployment or E2E was started by this run.

## Reviewed file change

Frontend `1a-staging` at `97b4239bbd1ea18f6e6362633a1647a1e20f34f6` contains
`.github/workflows/deploy-staging.yml` blob
`c573f80b55aa46b2bb96259dee07b98c231d30b7`. Comparing its full contents to the
previously approved blob `36d10cd5f855d1510c5f2c6ffced7baf86db3987` found exactly
one added environment-variable line:

```yaml
NEXT_PUBLIC_FEATURE_MULTI_COMPETITION: "true"
```

[Frontend commit f371fc5](https://github.com/6529-Collections/6529seize-frontend/commit/f371fc5471e6501521e3e0582a33255328a346b8)
added it on September 29. Workflow triggers, dispatch inputs, build/deploy steps
and permissions are unchanged. This review approves the workflow identity, not
independent proof of the feature's runtime behavior.

Frontend `main` at `780d49bfd8f87afeb6fee27fe9ed8852d5636123` still has the old
blob. The Coordinator therefore stores distinct staging and production pins for
this file, using its existing environment-specific pin support. It does not
replace the shared pin with the staging blob, bypass runtime checking, or modify
either product repository. All other 23 environment/file combinations matched
their trusted pins at the original stop.

The regression test accepts these two exact reviewed blobs, rejects substituting
the production file on staging, rejects substituting the staging file on
production, and rejects both substitutions. The existing shared backend pin
regression remains covered.

The direct product-workflow adapter also has explicit staging and production
frontend deployment regressions. Each accepts its reviewed runtime pair and
normal branch/dispatch inputs, then rejects the other environment's staging
workflow blob before any GitHub write. These tests cover the adapter's separate
`verifyFiles` path, not only the shared identity verifier.

## Delivery and resume boundary

The full local check passed 663 tests with three optional Docker skips. A
read-only call to the real runtime identity verifier then accepted all pinned
files on the four current product branches, using only GitHub GET requests.
The separate npm security audit found three new `brace-expansion` advisories in
ESLint's development-only dependency chain. The lockfile refresh from `5.0.9`
to patched `5.0.12` retains its dependency range, engine requirement and license;
no public CLI production dependency changes. A fresh script-disabled locked
install and the full local check passed again (663 passing tests, three optional
Docker skips); the same required npm audit now reports zero vulnerabilities.
After the review-requested direct product-adapter regressions were added, the
full local check passed 665 tests with three optional Docker skips and the audit
again reported zero vulnerabilities. Remote PR delivery is separate and pending
at this point. The user
authorized the narrow fix, checks and continuation of #275. Resume must preserve
the original run ID and filter, confirm the original process is stopped, and
freshly verify runtime files, source PR and branch inputs. New drift must stop
again; the reviewed pin refresh is not blanket approval for future changes.
Successful candidate checks and the pin refresh alone do not prove a release.
