// Updated only after the generated release workflow bundle passes its own PR
// checks in both sandbox repositories. Tickets and environment variables cannot
// replace these identities.
export const sandboxReleaseRuntime = Object.freeze({
  workflow: "sandbox-release.yml",
  job: "Sandbox release",
  step: "Run sandbox release operation",
  branches: Object.freeze({ staging: "1a-staging", prod: "main" }),
  repositories: Object.freeze({
    backend: Object.freeze({
      workflow_blob: "da76eeee97f41430595b49e288e9909bb6596e31"
    }),
    frontend: Object.freeze({
      workflow_blob: "da76eeee97f41430595b49e288e9909bb6596e31"
    })
  })
});
