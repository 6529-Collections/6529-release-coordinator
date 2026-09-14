import { rename, rm, writeFile } from "node:fs/promises";

const systemFiles = { rename, rm, writeFile };

export async function writeFileAtomically(
  destination,
  contents,
  files = systemFiles
) {
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await files.writeFile(temporary, contents);
    await files.rename(temporary, destination);
  } catch (error) {
    try {
      await files.rm(temporary, { force: true });
    } catch {
      // The original checkpoint is still authoritative even if temp cleanup fails.
    }
    throw error;
  }
}
