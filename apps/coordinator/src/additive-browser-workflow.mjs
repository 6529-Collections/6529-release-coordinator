import { blobHash, serviceAssert } from "./service-contract.mjs";

export const fixedPositionBrowserContract = "additive-browser-packs-v1";
export const additiveBrowserContract = "additive-browser-packs-v2";
export const reviewedFrontendPrWorkflow =
  "9209601a51023b4a17609fb7cdacb360a2e34977";

// Historical v1 insertion points, not replaceable sections. Both contracts
// protect every reviewed byte, including all existing browser packs.
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
export function validateAdditiveBrowserWorkflow(
  baseline,
  current,
  contract = additiveBrowserContract
) {
  requireContract(
    [fixedPositionBrowserContract, additiveBrowserContract].includes(contract),
    "Unknown browser-pack extension contract."
  );
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
  const additions =
    contract === fixedPositionBrowserContract
      ? fixedPositionAdditions(reviewed, actual)
      : boundaryAdditions(reviewed, actual);
  const { addedRegistrations, addedSteps } = additions;
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

// Historical v1 keeps its exact original admission semantics.
function fixedPositionAdditions(reviewed, actual) {
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
  return { addedRegistrations, addedSteps };
}

function uniqueOffset(text, marker) {
  const offset = text.indexOf(marker);
  requireContract(
    offset >= 0 && text.indexOf(marker, offset + 1) === -1,
    "The reviewed browser-pack boundaries are ambiguous."
  );
  return offset;
}

function boundaryAdditions(reviewed, actual) {
  // Derive insertion boundaries ONLY from the hash-verified baseline, never
  // from candidate indentation. Do not admit code inside conditions/callbacks,
  // before setup, after matrix outputs, in another job, or after artifacts.
  const registrationStart = uniqueOffset(
    reviewed,
    "          const corePlaywrightLanes = [];\n"
  );
  const registrationEnd = uniqueOffset(
    reviewed,
    '          write("app_check_matrix", JSON.stringify({ include: appCheckLanes }));'
  );
  const stepStart = uniqueOffset(
    reviewed,
    "      - name: Run small Playwright smoke pack\n"
  );
  const stepEnd = reviewed.indexOf(
    "      - name: Upload app check artifacts\n",
    stepStart
  );
  requireContract(
    registrationStart < registrationEnd &&
      registrationEnd < stepStart &&
      stepEnd > stepStart,
    "The reviewed browser-pack sections are invalid."
  );
  const boundaries = [
    ...[
      ...reviewed.matchAll(
        /^ {10}(?:if \(|const waveCreationBrowserRequired =)/gmu
      )
    ]
      .filter(
        ({ index }) => index > registrationStart && index < registrationEnd
      )
      .map(({ index }) => ({ offset: index, pattern: registrations })),
    { offset: registrationEnd, pattern: registrations },
    ...[...reviewed.matchAll(/^ {6}- name: /gmu)]
      .filter(({ index }) => index >= stepStart && index <= stepEnd)
      .map(({ index }) => ({ offset: index, pattern: steps }))
  ];
  const addedRegistrations = [],
    addedSteps = [];
  let position = 0,
    previous = 0;
  for (const [index, boundary] of boundaries.entries()) {
    const protectedText = reviewed.slice(previous, boundary.offset);
    requireContract(
      actual.startsWith(protectedText, position),
      "A protected part of the product PR workflow changed."
    );
    position += protectedText.length;
    const nextOffset = boundaries[index + 1]?.offset ?? reviewed.length;
    const nextProtected = reviewed.slice(boundary.offset, nextOffset);
    while (!actual.startsWith(nextProtected, position)) {
      boundary.pattern.lastIndex = position;
      const match = boundary.pattern.exec(actual);
      requireContract(
        match && boundary.pattern.lastIndex > position,
        "A browser-pack addition differs from the reviewed literal template or safe boundary."
      );
      (boundary.pattern === registrations
        ? addedRegistrations
        : addedSteps
      ).push(match.slice(1));
      position = boundary.pattern.lastIndex;
    }
    previous = boundary.offset;
  }
  requireContract(
    actual.slice(position) === reviewed.slice(previous),
    "A protected part of the product PR workflow changed."
  );
  return { addedRegistrations, addedSteps };
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
