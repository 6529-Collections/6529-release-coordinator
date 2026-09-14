import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

const systemFiles = { rename, rm, writeFile, uuid: randomUUID };

export async function writeFileAtomically(
  destination,
  contents,
  files = systemFiles
) {
  const temporary = `${destination}.${files.uuid()}.tmp`;
  try {
    await files.writeFile(temporary, contents, { flag: "wx" });
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
