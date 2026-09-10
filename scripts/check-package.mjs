import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageName = "@6529-collections/release-request";
const expectedFiles = [
  "LICENSE",
  "README.md",
  "package.json",
  "bin/6529-release-request.mjs",
  "release-request.example.json",
  "release-request.schema.json",
  "src/github-submission.mjs",
  "src/inbox-issue.mjs",
  "src/index.mjs"
];

export function validatePackageContents(archive, manifest) {
  assert.equal(archive.name, packageName);
  assert.equal(archive.version, manifest.version);
  assert.deepEqual(
    archive.files.map((file) => file.path).sort(),
    [...expectedFiles].sort(),
    "Published files differ from the reviewed allowlist"
  );
  assert.match(archive.filename, /^[a-z0-9][a-z0-9.-]*\.tgz$/u);
  assert.match(archive.integrity, /^sha512-[A-Za-z0-9+/=]+$/u);
}

export async function checkPackage() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const npm = process.env.npm_execpath;
  assert.ok(npm, "Run through npm run check:package.");
  const temporary = await mkdtemp(
    path.join(tmpdir(), "coordinator-package-check-")
  );
  try {
    // Dependency archives are already downloaded by npm ci. Use that cache,
    // with a clean environment and no credentials or repository npm settings.
    const cache = execFileSync(
      process.execPath,
      [npm, "config", "get", "cache"],
      { cwd: root, encoding: "utf8" }
    ).trim();
    const env = {
      PATH: process.env.PATH,
      HOME: temporary,
      TMPDIR: temporary,
      npm_config_cache: cache,
      npm_config_userconfig: path.join(temporary, "user.npmrc"),
      npm_config_globalconfig: path.join(temporary, "global.npmrc"),
      npm_config_ignore_scripts: "true",
      npm_config_offline: "true",
      npm_config_audit: "false",
      npm_config_fund: "false"
    };
    const run = (args, cwd = root) =>
      execFileSync(process.execPath, args, {
        cwd,
        env,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024
      }).trim();
    const manifest = JSON.parse(
      await readFile(
        path.join(root, "packages/release-request/package.json"),
        "utf8"
      )
    );
    const archives = JSON.parse(
      run([
        npm,
        "pack",
        "--ignore-scripts",
        "--json",
        `--workspace=${packageName}`,
        "--pack-destination",
        temporary
      ])
    );
    assert.equal(archives.length, 1);
    const [archive] = archives;
    validatePackageContents(archive, manifest);
    const consumer = path.join(temporary, "consumer");
    await mkdir(consumer);
    const archiveReference = `file:${path.join(temporary, archive.filename)}`;
    const consumerManifest = {
      name: "package-smoke-consumer",
      version: "1.0.0",
      private: true,
      dependencies: { [packageName]: archiveReference }
    };
    const repositoryLock = JSON.parse(
      await readFile(path.join(root, "package-lock.json"), "utf8")
    );
    assert.equal(
      repositoryLock.lockfileVersion,
      3,
      "Review the smoke install when changing lockfile format"
    );
    // Preserve the repository's exact production resolutions. npm ci can then
    // install the real tarball offline without selecting newer transitive deps.
    const packages = Object.fromEntries(
      Object.entries(repositoryLock.packages).filter(
        ([name, entry]) =>
          name.startsWith("node_modules/") && !entry.dev && !entry.link
      )
    );
    packages[""] = consumerManifest;
    packages[`node_modules/${packageName}`] = {
      version: manifest.version,
      resolved: archiveReference,
      integrity: archive.integrity,
      dependencies: manifest.dependencies,
      bin: manifest.bin,
      engines: manifest.engines
    };
    await writeFile(
      path.join(consumer, "package.json"),
      JSON.stringify(consumerManifest)
    );
    await writeFile(
      path.join(consumer, "package-lock.json"),
      JSON.stringify({
        name: consumerManifest.name,
        version: consumerManifest.version,
        lockfileVersion: 3,
        requires: true,
        packages
      })
    );
    run(
      [npm, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
      consumer
    );
    const bin = path.join(consumer, "node_modules/.bin/6529-release-request");
    assert.equal(run([bin, "--version"], consumer), manifest.version);
    assert.match(run([bin, "--help"], consumer), /Usage:/u);
    assert.ok(JSON.parse(run([bin, "template"], consumer)).release_parts);
    run(
      [
        "--input-type=module",
        "--eval",
        `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      import { readFileSync } from 'node:fs';
      import { validateReleaseRequest } from '${packageName}';
      const require = createRequire(import.meta.url);
      const schema = JSON.parse(readFileSync(require.resolve('${packageName}/schema'), 'utf8'));
      const example = JSON.parse(readFileSync(require.resolve('${packageName}/example'), 'utf8'));
      assert.equal(schema.type, 'object');
      const result = validateReleaseRequest(example);
      assert.equal(result.ok, true, JSON.stringify(result));
    `
      ],
      consumer
    );
    console.log(
      `Package ${manifest.version}: ${archive.files.length} approved files; isolated offline install, CLI and schema checks passed.`
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await checkPackage();
}
