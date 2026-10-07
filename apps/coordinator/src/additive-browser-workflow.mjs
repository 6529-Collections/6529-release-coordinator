import { blobHash, serviceAssert } from "./service-contract.mjs";

export const additiveBrowserContract = "additive-browser-packs-v1";
export const reviewedFrontendPrWorkflow =
  "9209601a51023b4a17609fb7cdacb360a2e34977";

// These are insertion points, not replaceable sections. Every reviewed byte,
// including all existing browser packs, remains protected by the baseline hash.
const registrationMarker = "          const waveCreationBrowserRequired =";
const stepMarker = "      - name: Run wave creation browser regression pack\n";
const checkName = "playwright_[a-z0-9]+(?:_[a-z0-9]+)*";
const laneName = "playwright-[a-z0-9]+(?:-[a-z0-9]+)*";
const plainName = "[A-Za-z0-9][A-Za-z0-9 ()/.,_-]*";
const slug = "[a-z0-9]+(?:-[a-z0-9]+)*";
const registrations = new RegExp(
  `          if \\(plan\\.checks\\.(${checkName})\\?\\.required\\) \\{\n` +
    `            corePlaywrightLanes\\.push\\(\\{ lane: "(${laneName})", label: "(${plainName})", runner: defaultRunner \\}\\);\n` +
    "          \\}\n",
  "uy"
);
const steps = new RegExp(
  `      - name: (${plainName})\n` +
    `        if: matrix\\.lane == '(${laneName})'\n` +
    "        env:\n" +
    `          PLAYWRIGHT_OUTPUT_DIR: "test-results/playwright/(${slug})"\n` +
    `          PLAYWRIGHT_HTML_REPORT_DIR: "playwright-report/(${slug})"\n` +
    `        run: \\./bin/6529 run test:e2e:(${slug})-sandbox\n\n`,
  "uy"
);

const requireContract = (ok, message) =>
  serviceAssert(ok, "batch-runtime", message);

function parseAdditions(text, pattern) {
  const matches = [];
  let offset = 0;
  while (offset < text.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    requireContract(
      match && pattern.lastIndex > offset,
      "A browser-pack addition differs from the reviewed literal template."
    );
    matches.push(match.slice(1));
    offset = pattern.lastIndex;
  }
  return matches;
}

/** Accept paired additive sandbox packs, never replacement workflow behavior. */
export function validateAdditiveBrowserWorkflow(baseline, current) {
  requireContract(
    Buffer.isBuffer(baseline) &&
      Buffer.isBuffer(current) &&
      blobHash(baseline) === reviewedFrontendPrWorkflow,
    "The browser-pack contract needs the exact reviewed workflow baseline."
  );
  const reviewed = baseline.toString("utf8");
  const actual = current.toString("utf8");
  requireContract(
    Buffer.from(actual, "utf8").equals(current),
    "The product PR workflow is not canonical UTF-8."
  );
  const registrationOffset = reviewed.indexOf(registrationMarker);
  const stepOffset = reviewed.indexOf(stepMarker);
  requireContract(
    registrationOffset >= 0 &&
      stepOffset > registrationOffset &&
      reviewed.indexOf(registrationMarker, registrationOffset + 1) === -1 &&
      reviewed.indexOf(stepMarker, stepOffset + 1) === -1,
    "The reviewed browser-pack insertion points are ambiguous."
  );
  const prefix = reviewed.slice(0, registrationOffset);
  const middle = reviewed.slice(registrationOffset, stepOffset);
  const suffix = reviewed.slice(stepOffset);
  const middleOffset = actual.indexOf(middle, prefix.length);
  const suffixOffset = actual.length - suffix.length;
  requireContract(
    actual.startsWith(prefix) &&
      actual.endsWith(suffix) &&
      middleOffset >= prefix.length &&
      middleOffset + middle.length <= suffixOffset,
    "A protected part of the product PR workflow changed."
  );
  const addedRegistrations = parseAdditions(
    actual.slice(prefix.length, middleOffset),
    registrations
  );
  const addedSteps = parseAdditions(
    actual.slice(middleOffset + middle.length, suffixOffset),
    steps
  );
  requireContract(
    addedRegistrations.length === addedSteps.length,
    "Each new browser lane needs exactly one matching sandbox test step."
  );
  const existing = new Set(
    [...reviewed.matchAll(/lane: "([^"]+)"/gu)].map((match) => match[1])
  );
  const lanes = [];
  for (const [index, [check, lane]] of addedRegistrations.entries()) {
    const [, stepLane, output, report, command] = addedSteps[index];
    const expectedSlug = lane.slice("playwright-".length);
    requireContract(
      lane === check.replaceAll("_", "-") &&
        stepLane === lane &&
        output === expectedSlug &&
        report === expectedSlug &&
        command === expectedSlug &&
        !existing.has(lane),
      "A browser-pack addition is duplicated, unpaired or changes test routing."
    );
    existing.add(lane);
    lanes.push(lane);
  }
  return { baseline_blob: reviewedFrontendPrWorkflow, lanes };
}

/** Decode complete GitHub bytes and verify the Git identity before parsing. */
export function verifiedWorkflowBytes(file, expectedBlob) {
  requireContract(
    file?.sha === expectedBlob &&
      file.encoding === "base64" &&
      typeof file.content === "string",
    "The product PR workflow has no complete verifiable Git bytes."
  );
  const encoded = file.content.replaceAll(/\s/gu, "");
  const bytes = Buffer.from(encoded, "base64");
  requireContract(
    bytes.toString("base64") === encoded && blobHash(bytes) === expectedBlob,
    "The product PR workflow bytes differ from their Git identity."
  );
  return bytes;
}
