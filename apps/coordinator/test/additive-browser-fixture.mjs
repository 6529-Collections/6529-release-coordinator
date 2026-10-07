import { readFileSync } from "node:fs";
import { blobHash } from "../src/service-contract.mjs";

export const reviewedWorkflow = readFileSync(
  new URL("./fixtures/frontend-app-pr-ci-reviewed.yml", import.meta.url)
);

export function browserPack(name) {
  const lane = `playwright-${name}`;
  return {
    registration:
      `          if (plan.checks.${lane.replaceAll("-", "_")}?.required) {\n` +
      `            corePlaywrightLanes.push({ lane: "${lane}", label: "Example desktop and mobile", runner: defaultRunner });\n` +
      "          }\n",
    step:
      "      - name: Run isolated example browser pack\n" +
      `        if: matrix.lane == '${lane}'\n` +
      "        env:\n" +
      `          PLAYWRIGHT_OUTPUT_DIR: "test-results/playwright/${name}"\n` +
      `          PLAYWRIGHT_HTML_REPORT_DIR: "playwright-report/${name}"\n` +
      `        run: ./bin/6529 run test:e2e:${name}-sandbox\n\n`
  };
}

export function extendWorkflow(packs) {
  return Buffer.from(
    reviewedWorkflow
      .toString("utf8")
      .replace(
        "          const waveCreationBrowserRequired =",
        packs.map((pack) => pack.registration).join("") +
          "          const waveCreationBrowserRequired ="
      )
      .replace(
        "      - name: Run wave creation browser regression pack\n",
        packs.map((pack) => pack.step).join("") +
          "      - name: Run wave creation browser regression pack\n"
      )
  );
}

export const gitWorkflow = (bytes) => ({
  sha: blobHash(bytes),
  encoding: "base64",
  content: bytes.toString("base64")
});
