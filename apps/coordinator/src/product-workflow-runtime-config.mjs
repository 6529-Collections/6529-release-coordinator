export const productWorkflowAdapter = "product-workflow-mirror-v1";

const sharedFiles = Object.freeze({
  "coordinator/src/release-contract.mjs":
    "a7d0b50cd600f1836486f5c998a1a334d07618c0",
  "coordinator/sandbox/application-build.mjs":
    "33f8374059515a6deaa5a151b3450cf49888023e"
});

export const productWorkflowRuntime = Object.freeze({
  adapter: productWorkflowAdapter,
  branches: Object.freeze({ staging: "1a-staging", prod: "main" }),
  githubActionsActor: Object.freeze({
    id: "41898282",
    login: "github-actions[bot]"
  }),
  repositories: Object.freeze({
    backend: Object.freeze({
      deployUnits: Object.freeze({
        dbMigrationsLoop: "dbMigrationsLoop",
        worker: "transactionsProcessingLoop",
        api: "api"
      }),
      files: Object.freeze({
        ".github/workflows/deploy.yml":
          "f8c8e8f0841998dc833e20fad50661cad71af32c",
        ".github/workflows/deploy-operational-monitoring.yml":
          "c1a3f6f2bf0b836ef3c7c12f0b09d2609f6deeb3",
        "scripts/controlled-monitoring-deploy.mjs":
          "0d70ac273e694045880d51fd73fe08c052e0fe78",
        "scripts/fake-deployment-evidence.mjs":
          "112421c3dd4aeacabe99bee4b8ebd4a607f8512d",
        ...sharedFiles
      }),
      workflows: Object.freeze({
        deploy: Object.freeze({
          file: "deploy.yml",
          name: "Deploy a service"
        }),
        monitoring: Object.freeze({
          file: "deploy-operational-monitoring.yml",
          name: "Deploy operational monitoring"
        })
      })
    }),
    frontend: Object.freeze({
      files: Object.freeze({
        ".github/workflows/deploy-staging.yml":
          "0d08fcf15a053d0a6516539fbbc6ced30ba13548",
        ".github/workflows/staging-e2e-dispatch.yml":
          "4bbddd181d6aa9138035d1fbf3b831808d4aa738",
        ".github/workflows/staging-e2e.yml":
          "03bd16deddf04dad2f52942ba7ce5a7a6d11863d",
        ".github/workflows/build-upload-deploy-prod.yml":
          "be4bc3a4aae4ab97c45513f40faa98dd059a026c",
        ".github/workflows/production-e2e-dispatch.yml":
          "01dbbd6cf9f2303aecde7e9a4e13212df77b0090",
        ".github/workflows/production-e2e.yml":
          "239233b114bc1e22fb45fb13030f6e9b31c737ce",
        "scripts/fake-deployment-evidence.mjs":
          "d1bc298bf2573a313a1464937c7aadc1e136c5d5",
        ...sharedFiles
      }),
      workflows: Object.freeze({
        stagingDeploy: Object.freeze({
          file: "deploy-staging.yml",
          name: "Web Deploy - STAGING"
        }),
        stagingDispatch: Object.freeze({
          file: "staging-e2e-dispatch.yml",
          name: "Staging E2E Dispatch"
        }),
        stagingE2e: Object.freeze({
          file: "staging-e2e.yml",
          name: "Staging E2E"
        }),
        prodDeploy: Object.freeze({
          file: "build-upload-deploy-prod.yml",
          name: "Web Deploy - PROD"
        }),
        prodDispatch: Object.freeze({
          file: "production-e2e-dispatch.yml",
          name: "Production E2E Dispatch"
        }),
        prodE2e: Object.freeze({
          file: "production-e2e.yml",
          name: "Production E2E"
        })
      })
    })
  })
});
