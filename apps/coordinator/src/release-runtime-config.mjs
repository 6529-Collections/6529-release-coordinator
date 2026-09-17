// Updated only after the generated release workflow bundle passes its own PR
// checks in both sandbox repositories. Tickets and environment variables cannot
// replace these identities.
const files = Object.freeze({
  ".github/workflows/sandbox-release.yml":
    "121726ba956c6994aba1e6bb7aa4ca5884935a2d",
  "coordinator/src/release-contract.mjs":
    "a7d0b50cd600f1836486f5c998a1a334d07618c0",
  "coordinator/sandbox/application-build.mjs":
    "0c59c68d8441298a9bfcce09d9aaeb72d5c5b4f5",
  "coordinator/sandbox/release-run.mjs":
    "23fc3a3cf903f0d036a2d07f5988b036b9cb9e54"
});

export const sandboxReleaseRuntime = Object.freeze({
  workflow: "sandbox-release.yml",
  job: "Sandbox release",
  step: "Run sandbox release operation",
  branches: Object.freeze({ staging: "1a-staging", prod: "main" }),
  repositories: Object.freeze({
    backend: Object.freeze({
      files
    }),
    frontend: Object.freeze({
      files
    })
  })
});
