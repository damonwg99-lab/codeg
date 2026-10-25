/** Absolute on-disk path of a knowledge-base doc.
 *
 *  KB docs store `filePath` relative to the knowledge directory.
 *  Supports both project-relative paths (default `_knowledge`) and arbitrary
 *  external absolute paths (e.g. shared git repository `D:/repos/team-kb`).
 */
export function kbDocAbsPath(
  kbLocalDir: string | null,
  rootDir: string,
  filePath: string
): string {
  const normRootDir = rootDir.replace(/\\/g, "/")
  const normFilePath = filePath.replace(/\\/g, "/").replace(/^\/+/, "")

  let kbDir: string
  if (kbLocalDir && kbLocalDir.trim()) {
    const trimmed = kbLocalDir.trim().replace(/\\/g, "/")
    if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith("/")) {
      kbDir = trimmed
    } else {
      kbDir = `${normRootDir}/${trimmed}`
    }
  } else {
    kbDir = `${normRootDir}/_knowledge`
  }

  kbDir = kbDir.replace(/\/+$/, "")
  return `${kbDir}/${normFilePath}`
}
