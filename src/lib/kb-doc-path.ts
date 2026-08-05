/** Absolute on-disk path of a knowledge-base doc.
 *
 *  KB docs store `filePath` relative to the `_knowledge/` directory. The old
 *  flow resolved that against the active file-workspace folder, which made the
 *  view-file button a silent no-op whenever the active conversation tab wasn't
 *  bound to the project's folder (activeFolder null). Passing the absolute path
 *  to openFilePreview needs no folder context at all — splitAbsPath derives
 *  (root_dir, relative) purely from the path, so IO works regardless.
 */
export function kbDocAbsPath(
  kbLocalDir: string | null,
  rootDir: string,
  filePath: string
): string {
  const kbDir = (
    kbLocalDir ?? `${rootDir.replace(/\\/g, "/")}/_knowledge`
  ).replace(/\\/g, "/")
  const normFilePath = filePath.replace(/\\/g, "/")
  return `${kbDir}/${normFilePath}`
}
