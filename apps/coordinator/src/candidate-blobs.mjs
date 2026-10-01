import { createRehearsalGit } from "./rehearsal-git.mjs";
import {
  blobHash,
  serviceAssert,
  serviceHash,
  ServiceError
} from "./service-contract.mjs";

/**
 * Recover verified bytes from immutable inputs, not a product checkout or
 * saved report. Existing SHA-only preparations survive rehearsal cleanup;
 * owned reconstruction cleanup must finish before bytes can be returned.
 * No content enters the journal.
 */
export async function readCandidateBlobs(
  record,
  patch,
  missing,
  { profile, signal, authentication, createGit = createRehearsalGit } = {}
) {
  const identity = profile?.repositories?.[record.role];
  serviceAssert(
    profile?.name === "real" &&
      identity &&
      Array.isArray(record.source_prs) &&
      record.source_prs.length > 0 &&
      Array.isArray(missing) &&
      missing.length > 0 &&
      new Set(missing).size === missing.length &&
      missing.every((sha) => patch.some((file) => file.sha === sha)),
    "batch-blob-input",
    "Missing candidate blobs require the saved exact source heads."
  );
  signal?.throwIfAborted();
  const session = await createGit({
    repositories: profile.repositories,
    candidatePatchMode: "real",
    signal,
    authentication
  });
  const blobs = [];
  let failure;
  try {
    const workspace = await session.repository({
      role: record.role,
      identity,
      destination: { commit: record.base },
      pull_requests: record.source_prs
    });
    let current = record.base;
    for (const pr of record.source_prs) {
      signal?.throwIfAborted();
      const merge = await workspace.merge(current, pr.commit);
      serviceAssert(
        merge.status === "pass",
        "batch-blob-tree",
        "Saved candidate inputs no longer reproduce a clean merge."
      );
      current = merge.commit;
    }
    serviceAssert(
      (await workspace.tree(current)) === record.tree,
      "batch-blob-tree",
      "Reconstructed candidate differs from the saved exact tree."
    );
    const paths = await workspace.changedPaths(record.base, current);
    const reconstructed = await workspace.patch(record.base, current, paths);
    serviceAssert(
      serviceHash(reconstructed) === serviceHash(patch),
      "batch-blob-patch",
      "Reconstructed candidate differs from the saved SHA-only patch."
    );
    for (const sha of missing) {
      signal?.throwIfAborted();
      const bytes = await workspace.blobBytes(sha);
      serviceAssert(
        Buffer.isBuffer(bytes) && blobHash(bytes) === sha,
        "batch-blob-content",
        "Candidate blob bytes do not match their saved Git identity."
      );
      blobs.push({
        sha,
        content: bytes.toString("base64"),
        encoding: "base64"
      });
    }
  } catch (error) {
    failure = error;
  }
  try {
    await session.cleanup();
  } catch {
    const error = new ServiceError(
      "cleanup_failed",
      `Failed to remove owned candidate directory: ${session.directory}`
    );
    error.owned_path = session.directory;
    throw error;
  }
  if (failure) throw failure;
  return blobs;
}
