import type { FolderDetail } from "@/lib/types"
import { isHiddenFolderKind } from "@/lib/platform/types"
import { excludeChatFolders, filterTopLevelFolders } from "@/lib/folder-display"

/**
 * Normalize a folder path for duplicate detection: trim whitespace, drop
 * trailing path separators and case-fold. Windows/macOS paths differ in case,
 * trailing separators and symlink resolution, so two folder rows that refer to
 * the same directory won't compare equal as raw strings — this canonical form
 * lets callers collapse them.
 */
export function normalizeFolderPath(path: string | null | undefined): string {
  if (!path) return ""
  return path
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase()
}

/** The minimal project shape this scoping reads. */
export interface FolderScopingProject {
  folderId: number | null
}

/** A repo whose backing folder row id we can resolve (must have `folderId`). */
export interface FolderScopingRepo {
  folderId: number | null
}

/** Inputs for {@link computeScopedTopLevelFolders}. */
export interface ComputeScopedTopLevelFoldersParams {
  /** The sidebar workspace folders (`s.folders`). */
  folders: readonly FolderDetail[]
  /** The full folder set, including hidden chat/platform_repo rows. */
  allFolders: readonly FolderDetail[]
  /** The active project, or null when no project is selected. */
  activeProject: FolderScopingProject | null
  /** The active project's registered sub-repos. */
  activeProjectRepos: readonly FolderScopingRepo[]
}

/**
 * The folder list the input-box folder picker should offer.
 *
 * With an active project it is SCOPED to that project's repos: the project's
 * root folder plus its registered sub-repos. Sub-repos have `kind ===
 * "platform_repo"` and live in `allFolders` (hidden from the sidebar `folders`
 * list). The list collapses duplicate rows for the same directory.
 *
 * Without an active project it falls back to main's default top-level non-chat
 * repos, with hidden platform sub-repo folders additionally excluded so a
 * project's hidden repos never leak into the unscoped list.
 */
export function computeScopedTopLevelFolders({
  folders,
  allFolders,
  activeProject,
  activeProjectRepos,
}: ComputeScopedTopLevelFoldersParams): FolderDetail[] {
  if (!activeProject) {
    return excludeChatFolders(filterTopLevelFolders(folders)).filter(
      (f) => !isHiddenFolderKind(f.kind)
    )
  }

  // Dedup by folder id AND normalized path: a git-rooted project's root can be
  // re-registered as a sub-repo under a DIFFERENT folder row (its path string
  // differs enough that `add_folder_inner` inserts a second row), so the same
  // directory can surface under two ids. Id-only dedup lets that slip through —
  // collapse on path too (mirrors RepoSelector's options).
  const list: FolderDetail[] = []
  const seenPaths = new Set<string>()
  const pushFolder = (f: FolderDetail) => {
    if (list.some((x) => x.id === f.id)) return
    const p = normalizeFolderPath(f.path)
    if (p && seenPaths.has(p)) return
    if (p) seenPaths.add(p)
    list.push(f)
  }

  const rootFolder = allFolders.find((f) => f.id === activeProject.folderId)
  if (rootFolder) pushFolder(rootFolder)
  for (const repo of activeProjectRepos) {
    if (repo.folderId == null) continue
    const repoFolder = allFolders.find((f) => f.id === repo.folderId)
    if (repoFolder) pushFolder(repoFolder)
  }
  return list
}
