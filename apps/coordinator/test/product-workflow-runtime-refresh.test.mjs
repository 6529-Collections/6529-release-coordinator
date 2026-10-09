import assert from "node:assert/strict";
import test from "node:test";
import { createProductWorkflowReleaseGitHub } from "../src/product-workflow-release-github.mjs";
import { realProductWorkflowRuntime } from "../src/product-workflow-runtime-config.mjs";
import { realProfile } from "../src/profiles.mjs";

// Independently reviewed product blobs, not values copied from the active
// configuration: a stale pin must fail this acceptance fixture.
const reviewedFrontendFiles = {
  ".github/workflows/deploy-staging.yml":
    "c573f80b55aa46b2bb96259dee07b98c231d30b7",
  ".github/workflows/production-build-artifact.yml":
    "5df8df3da1a50336a7b9f4816b79fbe639d0a3e1",
  ".github/workflows/production-e2e.yml":
    "31f8ad4fb58cc3cab99419d96547fe52da6f7a10",
  ".github/workflows/staging-e2e.yml":
    "6afa8ced671b00394b87e6c47dac498b137c17af"
};
const reviewedBackendFiles = {
  ".github/workflows/deploy.yml": {
    staging: "39250777ed9eca0ade44ccfc5eb3776d7a047929",
    prod: "938ccac897092972c64de444001c48133291abed"
  }
};
const reviewedFiles = {
  frontend: reviewedFrontendFiles,
  backend: reviewedBackendFiles
};
const supersededFrontendFiles = {
  ".github/workflows/deploy-staging.yml":
    "36d10cd5f855d1510c5f2c6ffced7baf86db3987",
  ".github/workflows/production-build-artifact.yml":
    "22bafb14740b35388d7f6e07f67af01c42486c11",
  ".github/workflows/production-e2e.yml":
    "29346bd8d8c9816f40388801943b006e21f3f6ef"
};
const newlySupersededFiles = {
  frontend: {
    ".github/workflows/production-e2e.yml":
      "56b8c0e73121bcb1ac937775fbe3e80dd2f3bce5",
    ".github/workflows/staging-e2e.yml":
      "63ace61b4d7b8f38605838435649ba47cec0ad25"
  },
  backend: {
    ".github/workflows/deploy.yml": {
      staging: "55f2db38999869b7b231c476f849ae330abef1da",
      prod: "eff687cc84a14df7f15134af1068039c5b875bda"
    }
  }
};
const versions = {
  staging: { backend: "a".repeat(40), frontend: "b".repeat(40) },
  prod: { backend: "c".repeat(40), frontend: "d".repeat(40) }
};
const response = (data) =>
  `HTTP/2 200 OK\nContent-Type: application/json\n\n${JSON.stringify(data)}`;

/**
 * Build a GET-only GitHub fixture for the actual real-profile identity client.
 * Refreshed product responses use independently reviewed blob literals, not
 * active pins. An optional mutation replaces one file in one environment to
 * exercise refusal without contacting GitHub, writing state or deploying.
 * Other files and workflow identities retain their configured reviewed values.
 *
 * @param {{role?: "frontend" | "backend", environment: "staging" | "prod", path: string, sha: string}} [mutation]
 * @returns {object} Recorded requests and the product identity client.
 */
function identityHarness(mutation) {
  const calls = [];
  const execute = async (args) => {
    const method = args[args.indexOf("--method") + 1];
    const endpoint = args[args.indexOf("--method") + 2];
    calls.push({ method, endpoint });
    assert.equal(method, "GET", "Runtime identity must not write or deploy.");
    if (endpoint === "user")
      return response({ id: 209783236, login: "simo6529" });
    const role = endpoint.includes("6529seize-frontend")
      ? "frontend"
      : "backend";
    const repository = realProfile.repositories[role];
    if (endpoint === `repos/${repository.full_name}`)
      return response({
        id: repository.id,
        full_name: repository.full_name,
        private: false,
        permissions: { push: true }
      });
    if (endpoint.includes("/git/ref/heads/")) {
      const environment = endpoint.endsWith("/main") ? "prod" : "staging";
      assert.ok(endpoint.endsWith("/main") || endpoint.endsWith("/1a-staging"));
      return response({ object: { sha: versions[environment][role] } });
    }
    if (endpoint.includes("/contents/")) {
      const [, path, commit] = endpoint.match(/\/contents\/(.+)\?ref=(.+)$/u);
      const environment = Object.keys(versions).find(
        (name) => versions[name][role] === commit
      );
      assert.ok(environment, "Runtime reads must use the exact branch commit.");
      const configured = realProductWorkflowRuntime.repositories[role].files;
      const pin = reviewedFiles[role][path] || configured[path];
      const observed = typeof pin === "string" ? pin : pin[environment];
      return response({
        type: "file",
        path,
        sha:
          role === (mutation?.role ?? "frontend") &&
          mutation?.path === path &&
          mutation.environment === environment
            ? mutation.sha
            : observed
      });
    }
    if (endpoint.includes("/actions/workflows/")) {
      const file = endpoint.split("/").at(-1);
      const workflows = Object.values(
        realProductWorkflowRuntime.repositories[role].workflows
      );
      const index = workflows.findIndex((value) => value.file === file);
      assert.notEqual(index, -1);
      return response({
        id: (role === "backend" ? 10 : 20) + index + 1,
        path: `.github/workflows/${file}`,
        name: workflows[index].name,
        state: "active"
      });
    }
    throw new Error(`Unexpected identity endpoint: ${endpoint}`);
  };
  return {
    calls,
    client: createProductWorkflowReleaseGitHub({
      profile: realProfile,
      execute
    })
  };
}

test("real runtime identity accepts the reviewed product refresh on both branches without writes", async () => {
  const harness = identityHarness();
  const identity = await harness.client.identity();
  assert.deepEqual(identity.versions, versions);
  assert.deepEqual(identity.actor, { id: "209783236", login: "simo6529" });
  for (const environment of ["staging", "prod"])
    for (const role of ["frontend", "backend"])
      for (const [path, reviewed] of Object.entries(reviewedFiles[role])) {
        const pin = realProductWorkflowRuntime.repositories[role].files[path];
        const expected =
          typeof reviewed === "string" ? reviewed : reviewed[environment];
        assert.equal(
          typeof pin === "string" ? pin : pin[environment],
          expected
        );
        // Intentionally protect both current, independent admission layers.
        // A future shared cache requires reviewing this contract, not just weakening
        // the assertion to let one layer's file verification disappear unnoticed.
        assert.equal(
          harness.calls.filter(({ endpoint }) =>
            endpoint.endsWith(
              `/contents/${path}?ref=${versions[environment][role]}`
            )
          ).length,
          2
        );
      }
  assert.ok(harness.calls.every(({ method }) => method === "GET"));
});

for (const environment of ["staging", "prod"])
  for (const [path, superseded] of Object.entries(supersededFrontendFiles))
    for (const [kind, sha] of [
      ["superseded", superseded],
      ["unknown", "e".repeat(40)]
    ])
      test(`real ${environment} identity refuses the ${kind} ${path} blob without writes`, async () => {
        const harness = identityHarness({ environment, path, sha });
        await assert.rejects(
          harness.client.identity(),
          /pinned product release runtime file changed/u
        );
        assert.ok(harness.calls.every(({ method }) => method === "GET"));
      });

for (const environment of ["staging", "prod"])
  for (const role of ["frontend", "backend"])
    for (const [path, previous] of Object.entries(newlySupersededFiles[role])) {
      const superseded =
        typeof previous === "string" ? previous : previous[environment];
      for (const [kind, sha] of [
        ["superseded", superseded],
        ["unknown", "f".repeat(40)],
        ...(role === "backend"
          ? [
              [
                "other-environment",
                reviewedBackendFiles[path][
                  environment === "staging" ? "prod" : "staging"
                ]
              ]
            ]
          : [])
      ])
        test(`real ${environment} ${role} identity refuses the ${kind} ${path} blob without writes`, async () => {
          const harness = identityHarness({ role, environment, path, sha });
          await assert.rejects(
            harness.client.identity(),
            /pinned product release runtime file changed/u
          );
          assert.ok(harness.calls.every(({ method }) => method === "GET"));
        });
    }
