// Updated only after the generated release workflow bundle passes its own PR
// checks in both sandbox repositories. Tickets and environment variables cannot
// replace these identities.
const files = Object.freeze({
  ".github/workflows/sandbox-release.yml":
    "ca25d499abecd68d3281076c1019ca95ac06fcab",
  "coordinator/src/release-contract.mjs":
    "a7d0b50cd600f1836486f5c998a1a334d07618c0",
  "coordinator/sandbox/application-build.mjs":
    "33f8374059515a6deaa5a151b3450cf49888023e",
  "coordinator/sandbox/release-run.mjs":
    "23fc3a3cf903f0d036a2d07f5988b036b9cb9e54"
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
      files
    }),
    frontend: Object.freeze({
      integrationChecks: Object.freeze(["Sandbox check"]),
      files
    })
  })
});
