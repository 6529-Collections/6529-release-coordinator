import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const recordPatterns = {
  recovery: /^adapter-recovery-\d{4}-\d{2}-\d{2}\.md$/u,
  success: /^adapter-success-path-\d{4}-\d{2}-\d{2}\.md$/u
};
const documentedPatterns = [
  "adapter-success-path-YYYY-MM-DD.md",
  "adapter-recovery-YYYY-MM-DD.md"
];
const recordPrefix = /^adapter-(?:recovery|success-path)-/u;
const linkedRecord =
  /\]\(\.\/testing\/(adapter-(?:recovery|success-path)-[^)]+\.md)\)/gu;

function isRecord(name) {
  return Object.values(recordPatterns).some((pattern) => pattern.test(name));
}

export function validateAdapterEvidence({ gate, progress, testingFiles }) {
  for (const name of documentedPatterns) {
    assert.ok(
      gate.includes(`\`${name}\``),
      `Adapter retirement gate must prescribe ${name}`
    );
    assert.ok(
      progress.includes(`\`${name}\``),
      `Progress must expose the pending adapter evidence pattern ${name}`
    );
  }

  const records = testingFiles.filter((name) => recordPrefix.test(name));
  for (const name of records) {
    assert.ok(
      isRecord(name),
      `Adapter acceptance record must use a dated canonical filename: ${name}`
    );
  }

  const links = [...progress.matchAll(linkedRecord)].map((match) => match[1]);
  for (const name of links) {
    assert.ok(
      isRecord(name),
      `Adapter acceptance link must use a dated canonical filename: ${name}`
    );
    assert.ok(
      testingFiles.includes(name),
      `Adapter acceptance link target is missing: docs/testing/${name}`
    );
  }
  for (const name of records) {
    assert.ok(
      links.includes(name),
      `Adapter acceptance record must be linked from docs/progress.md: ${name}`
    );
  }
}

export function readAdapterEvidence(root) {
  return {
    gate: readFileSync(
      path.join(root, "docs/merge-rehearsal-testing.md"),
      "utf8"
    ),
    progress: readFileSync(path.join(root, "docs/progress.md"), "utf8"),
    testingFiles: readdirSync(path.join(root, "docs/testing"))
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  validateAdapterEvidence(readAdapterEvidence(root));
  console.log("Adapter acceptance evidence names and progress links passed.");
}
