// Updated only after the generated release workflow bundle passes its own PR
// checks in both sandbox repositories. Tickets and environment variables cannot
// replace these identities.
const files = Object.freeze({
  ".github/workflows/sandbox-release.yml":
    "ca25d499abecd68d3281076c1019ca95ac06fcab",
  "coordinator/src/release-contract.mjs":
    "f11d31f10d867b832b18248fb18adfc86b2375fe",
  "coordinator/sandbox/application-build.mjs":
    "33f8374059515a6deaa5a151b3450cf49888023e",
  "coordinator/sandbox/release-run.mjs":
    "ed0658a1ce719411614cc35366dbf84e6dcae796"
});

export const sandboxReleaseRuntime = Object.freeze({
  profile: "sandbox",
  workflow: "sandbox-release.yml",
  job: "Sandbox release",
  step: "Run sandbox release operation",
  branches: Object.freeze({ staging: "1a-staging", prod: "main" }),
  repositories: Object.freeze({
    backend: Object.freeze({
      integrationChecks: Object.freeze(["Sandbox check"]),
      stagingIntegrationChecks: Object.freeze(["Sandbox check"]),
      files
    }),
    frontend: Object.freeze({
      integrationChecks: Object.freeze(["Sandbox check"]),
      stagingIntegrationChecks: Object.freeze(["Sandbox check"]),
      files
    })
  })
});
