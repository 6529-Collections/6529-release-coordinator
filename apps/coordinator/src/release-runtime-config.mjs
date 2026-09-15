// Updated only after the generated release workflow bundle passes its own PR
// checks in both sandbox repositories. Tickets and environment variables cannot
// replace these identities.
const files = Object.freeze({
  ".github/workflows/sandbox-release.yml":
    "14461c4318b22524dfc41032f8af3cd18f1e1bdc",
  "coordinator/src/release-contract.mjs":
    "395eb44286c3e9853b5cd8a87e0f17e352cbba7b",
  "coordinator/sandbox/application-build.mjs":
    "dfc6b7da170b3b54bf38ea864a20e313fbad4204",
  "coordinator/sandbox/release-run.mjs":
    "034acaa0c85e0629212f8b75466c2463091bbcbf"
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
