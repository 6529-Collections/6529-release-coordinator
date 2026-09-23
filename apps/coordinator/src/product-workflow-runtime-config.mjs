export const productWorkflowAdapter = "product-workflows-v2";

const sharedFiles = Object.freeze({
  "coordinator/src/release-contract.mjs":
    "a7d0b50cd600f1836486f5c998a1a334d07618c0",
  "coordinator/sandbox/application-build.mjs":
    "33f8374059515a6deaa5a151b3450cf49888023e"
});

export const sandboxProductWorkflowRuntime = Object.freeze({
  adapter: productWorkflowAdapter,
  profile: "sandbox",
  evidence: "sandbox-artifact",
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
      integrationChecks: Object.freeze(["Sandbox check"]),
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
      integrationChecks: Object.freeze(["Sandbox check"]),
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

export const realProductWorkflowRuntime = Object.freeze({
  adapter: productWorkflowAdapter,
  profile: "real",
  evidence: "product-runtime",
  branches: Object.freeze({ staging: "1a-staging", prod: "main" }),
  githubActionsActor: Object.freeze({
    id: "41898282",
    login: "github-actions[bot]"
  }),
  repositories: Object.freeze({
    backend: Object.freeze({
      deployUnits: "identity",
      integrationChecks: Object.freeze(["Build backend and API"]),
      files: Object.freeze({
        ".github/workflows/deploy.yml": Object.freeze({
          staging: "9644738f3e06f2ddc26cd5b63f138f1f8fbbbc6a",
          prod: "14565b6dabd5772f21f89f868e1029ae5a95aace"
        }),
        ".github/workflows/deploy-operational-monitoring.yml":
          "2621e6705ab9fa70b006e7d8345762c95685cf73"
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
      integrationChecks: Object.freeze([
        "DCO",
        "security/snyk (6529)",
        "Plan risk and security checks",
        "Installed app checks",
        "Debt ratchet"
      ]),
      files: Object.freeze({
        ".github/workflows/deploy-staging.yml":
          "36d10cd5f855d1510c5f2c6ffced7baf86db3987",
        ".github/workflows/staging-e2e-dispatch.yml":
          "07c0f501372f013300e2be44d6724238df760c5f",
        ".github/workflows/staging-e2e.yml":
          "63ace61b4d7b8f38605838435649ba47cec0ad25",
        ".github/workflows/build-upload-deploy-prod.yml":
          "8b2c3cc8dd2351a877c919d99c1def8ec0089c25",
        ".github/workflows/production-build-artifact.yml":
          "22bafb14740b35388d7f6e07f67af01c42486c11",
        ".github/workflows/production-artifact-metadata.yml":
          "ca7e80eaa4d2cccb53b4d87b0abaeca103fbc0c6",
        ".github/workflows/production-artifact-verifier.yml":
          "ca2fc4af84b5dd9903a835be2ee52e200f4b4bdf",
        ".github/workflows/production-e2e-dispatch.yml":
          "d89f00759703c6de7bb2773540c9517a49f181a6",
        ".github/workflows/production-e2e.yml":
          "93c6e39132308f9733eab70ba1191e8a4bd9cd15",
        "ops/scripts/verify-deployment-version.cjs":
          "683ad00ff450ed3bdce617997cd99bec14b2a0b8"
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

// Compatibility name for the accepted sandbox runtime and existing tests.
export const productWorkflowRuntime = sandboxProductWorkflowRuntime;

export function productWorkflowRuntimeForProfile(profile) {
  if (profile?.name === "sandbox") return sandboxProductWorkflowRuntime;
  if (profile?.name === "real") return realProductWorkflowRuntime;
  throw new Error(
    "No product workflow runtime is configured for this profile."
  );
}
