import { createRehearsalGit } from "./rehearsal-git.mjs";
import {
  blobHash,
  serviceAssert,
  serviceHash,
  ServiceError
} from "./service-contract.mjs";

const sha = (value) => /^[0-9a-f]{40}$/u.test(value ?? "");

/** Bind a SHA-only staging preparation to the captured destination and selected candidate. */
export function validateStagingMerge(record, candidate) {
  const prepared = record.staging_preparation;
  serviceAssert(
    record.step.kind === "integrate" &&
      record.step.environment === "staging" &&
      !record.step.recovery &&
      prepared?.version === "staging-merge-v1" &&
      prepared.profile === (record.profile ?? "sandbox") &&
      prepared.role === record.step.role &&
      candidate.role === record.step.role &&
      sha(record.base) &&
      prepared.base === record.base &&
      prepared.candidate_commit === candidate.commit &&
      prepared.candidate_tree === candidate.tree &&
      [
        prepared.base_tree,
        prepared.tree,
        candidate.commit,
        candidate.tree
      ].every(sha) &&
      Array.isArray(prepared.patch) &&
      new Set(prepared.patch.map((file) => file?.path)).size ===
        prepared.patch.length &&
      prepared.patch.every(
        (file) =>
          typeof file?.path === "string" &&
          file.path.length > 0 &&
          !file.path.startsWith("/") &&
          !file.path.includes("\u0000") &&
          !file.path.split("/").some((part) => !part || part === "..") &&
          ["100644", "100755"].includes(file.mode) &&
          file.type === "blob" &&
          (file.sha === null || sha(file.sha)) &&
          Object.keys(file).sort().join(",") === "mode,path,sha,type"
      ),
    "release-state",
    "Staging preparation no longer matches its exact destination and selected candidate."
  );
  return prepared;
}

/** Rehearse ordinary Git merging in an owned workspace; never choose a side of a conflict. */
export async function prepareStagingMerge(
  record,
  candidate,
  {
    profile,
    signal,
    authentication,
    createGit = createRehearsalGit,
    expected,
    missing = []
  } = {}
) {
  serviceAssert(
    ["sandbox", "real"].includes(profile?.name) &&
      profile.repositories?.[candidate.role] &&
      candidate.role === record.step.role &&
      record.step.environment === "staging" &&
      !record.step.recovery &&
      [record.base, candidate.commit, candidate.tree].every(sha) &&
      Array.isArray(missing) &&
      new Set(missing).size === missing.length &&
      missing.every(sha),
    "release-input",
    "Staging preparation requires exact immutable merge inputs."
  );
  signal?.throwIfAborted();
  const session = await createGit({
    repositories: profile.repositories,
    candidatePatchMode: profile.name,
    signal,
    authentication
  });
  let result;
  let failure;
  try {
    const workspace = await session.repository({
      role: candidate.role,
      identity: profile.repositories[candidate.role],
      destination: { commit: record.base },
      pull_requests: [{ commit: candidate.commit }]
    });
    serviceAssert(
      (await workspace.tree(candidate.commit)) === candidate.tree,
      "release-ownership",
      "The selected staging candidate has a different tree."
    );
    const merged = await workspace.merge(record.base, candidate.commit);
    if (merged.status !== "pass") {
      serviceAssert(
        !expected,
        "release-state",
        "Saved staging preparation no longer reproduces a clean merge."
      );
      result = { conflicts: merged.conflicts };
    } else {
      const paths = await workspace.changedPaths(record.base, merged.commit);
      const patch = (
        await workspace.patch(record.base, merged.commit, paths)
      ).map((file) => ({
        path: file.path,
        mode: file.mode,
        type: file.type,
        sha:
          file.sha === null
            ? null
            : (file.sha ?? blobHash(Buffer.from(file.content)))
      }));
      const preparation = {
        version: "staging-merge-v1",
        profile: profile.name,
        role: candidate.role,
        base: record.base,
        base_tree: await workspace.tree(record.base),
        candidate_commit: candidate.commit,
        candidate_tree: candidate.tree,
        tree: merged.tree,
        patch
      };
      validateStagingMerge(
        { ...record, profile: profile.name, staging_preparation: preparation },
        candidate
      );
      serviceAssert(
        (!expected || serviceHash(preparation) === serviceHash(expected)) &&
          missing.every((oid) => patch.some((file) => file.sha === oid)),
        "release-state",
        "Reconstructed staging tree or patch differs from its saved preparation."
      );
      const blobs = [];
      for (const oid of missing) {
        signal?.throwIfAborted();
        const bytes = await workspace.blobBytes(oid);
        serviceAssert(
          Buffer.isBuffer(bytes) && blobHash(bytes) === oid,
          "release-ownership",
          "Staging blob bytes do not match their exact Git identity."
        );
        blobs.push({
          sha: oid,
          encoding: "base64",
          content: bytes.toString("base64")
        });
      }
      result = { preparation, blobs };
    }
  } catch (error) {
    failure = error;
  }
  try {
    await session.cleanup();
  } catch {
    const error = new ServiceError(
      "cleanup_failed",
      `Failed to remove owned staging directory: ${session.directory}`
    );
    error.owned_path = session.directory;
    throw error;
  }
  if (failure) throw failure;
  signal?.throwIfAborted();
  return result;
}
