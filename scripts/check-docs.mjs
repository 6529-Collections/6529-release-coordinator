import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const canonicalRecord =
  /^adapter-(?:recovery|success-path)-(\d{4})-(\d{2})-(\d{2})\.md$/u;
const documentedPatterns = [
  "adapter-success-path-YYYY-MM-DD.md",
  "adapter-recovery-YYYY-MM-DD.md"
];
const recordPrefix = /^adapter-(?:recovery|success-path)/u;
const markdownLink = /\]\(([^)\n]*)\)/gu;

function isRecord(name) {
  const match = name.match(canonicalRecord);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

function adapterLinks(progress) {
  const links = [];
  for (const match of progress.matchAll(markdownLink)) {
    const contents = match[1].trim();
    let destinationWithSuffix;
    if (contents.startsWith("<")) {
      const close = contents.indexOf(">");
      assert.notEqual(
        close,
        -1,
        "Angle-bracket Markdown link in docs/progress.md needs a closing >"
      );
      destinationWithSuffix = contents.slice(1, close);
    } else {
      destinationWithSuffix = contents.split(/\s/u, 1)[0];
    }
    const destination = destinationWithSuffix.split(/[?#]/u, 1)[0];
    const name = path.posix.basename(destination);
    if (!recordPrefix.test(name)) continue;
    assert.ok(
      destination === `./testing/${name}` || destination === `testing/${name}`,
      `Adapter acceptance links in docs/progress.md must target testing/${name}`
    );
    links.push(name);
  }
  assert.equal(
    new Set(links).size,
    links.length,
    "Progress must link each adapter acceptance record once"
  );
  return links;
}

export function validateAdapterEvidence({
  gate,
  otherDocsFiles = [],
  progress,
  testingFiles
}) {
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
  for (const name of otherDocsFiles) {
    assert.ok(
      !recordPrefix.test(path.posix.basename(name)),
      `Adapter acceptance filename prefixes are reserved for docs/testing/: ${name}`
    );
  }

  const links = adapterLinks(progress);
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

function filesBelow(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesBelow(path.join(directory, entry.name), name));
    } else if (entry.isFile()) {
      files.push(name);
    }
  }
  return files;
}

export function readAdapterEvidence(root) {
  const docs = path.join(root, "docs");
  return {
    gate: readFileSync(
      path.join(root, "docs/merge-rehearsal-testing.md"),
      "utf8"
    ),
    otherDocsFiles: filesBelow(docs).filter(
      (name) => !name.startsWith("testing/")
    ),
    progress: readFileSync(path.join(root, "docs/progress.md"), "utf8"),
    testingFiles: readdirSync(path.join(docs, "testing"))
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
