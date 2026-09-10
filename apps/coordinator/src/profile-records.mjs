import { mkdir, lstat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function saveProfileRecord(
  profile,
  name,
  value,
  root = process.cwd()
) {
  if (
    !["sandbox", "real"].includes(profile.name) ||
    !/^[0-9a-f-]{36}\.(prepared|result)\.json$/u.test(name)
  )
    throw new Error("Invalid profile record identity.");
  let directory = root;
  for (const part of [
    ".release-coordinator",
    "profiles",
    profile.name,
    "submissions"
  ]) {
    directory = path.join(directory, part);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(
        "Profile records require local directories without symlinks."
      );
  }
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new Error("Submission record exceeds 1 MiB.");
  const filename = path.join(directory, name);
  await writeFile(filename, text, { flag: "wx", mode: 0o600 });
  return filename;
}
