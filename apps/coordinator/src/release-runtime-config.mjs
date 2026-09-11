// Updated only after the generated release workflow bundle passes its own PR
// checks in both sandbox repositories. Tickets and environment variables cannot
// replace these identities.
const files = Object.freeze({
  ".github/workflows/sandbox-release.yml":
    "da76eeee97f41430595b49e288e9909bb6596e31",
  "coordinator/src/release-contract.mjs":
    "b919af7d89bbdf3357730cd1d3b90e784c5b1397",
  "coordinator/sandbox/release-run.mjs":
    "32c783a499c842a37b1fec28f222b475b52ef477"
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
