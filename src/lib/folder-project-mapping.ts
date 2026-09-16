import type { ProjectInfo, ProjectRepoInfo } from "@/lib/platform/types"

/**
 * Folder → platform-project resolution.
 *
 * Everything here is derived from data the frontend already holds (the project
 * list + per-project registered repos), so a conversation tab never needs to
 * store a `projectId` — its bound folderId is reverse-resolved at runtime.
 *
 * Resolution order (deepest signal wins):
 *  1. Exact folderId match against `platform_project.folderId` or
 *     `platform_project_repo.folderId` (project roots and registered sub-repos).
 *  2. `parent_id` chain walk — worktree folders are `parent_id` children of
 *     their repo/root folder (mirrors `resolvePickerSelectedFolderId` in
 *     folder-display.ts).
 *  3. Path-prefix fallback — `folder.path` under `project.rootDir` or
 *     `repo.localDir`. Covers repos registered without a folder_id and any
 *     folder row that was inserted under a project directory directly.
 *  4. `null` — the folder belongs to no project (freely opened directory,
 *     hidden chat folder, …). Callers keep the current project.
 */

/** Minimal folder shape the mapping reads (FolderDetail satisfies this). */
export interface FolderLike {
  id: number
  path: string
  parent_id: number | null
}

interface PathRoot {
  projectId: number
  /** Normalized (forward slashes, case-folded, no trailing slash). */
  path: string
  /** Segment count — used to prefer the deepest root on overlap. */
  depth: number
}

export interface FolderProjectIndex {
  folderIdToProject: Map<number, number>
  /** Deepest-first; the first prefix hit is the tightest match. */
  pathRoots: PathRoot[]
}

/**
 * Canonical form for project/repo/folder path comparison: trim, unify
 * separators to `/`, drop trailing separators, case-fold. Mirrors
 * `normalizeFolderPath` in folder-scoping.ts but also folds backslashes, since
 * `rootDir`/`localDir` strings and folder `path` values may disagree on
 * separator style.
 */
export function normalizeProjectPath(path: string | null | undefined): string {
  if (!path) return ""
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
}

/**
 * Build the lookup index from the project list plus each project's registered
 * repos. `reposByProject` entries may be absent (repos not loaded yet) — the
 * index simply covers less and callers see more `null` resolutions until the
 * cache fills.
 */
export function buildFolderProjectIndex(
  projects: readonly ProjectInfo[],
  reposByProject: ReadonlyMap<number, readonly ProjectRepoInfo[]>
): FolderProjectIndex {
  const folderIdToProject = new Map<number, number>()
  const pathRoots: PathRoot[] = []

  const pushRoot = (projectId: number, rawPath: string | null | undefined) => {
    const normalized = normalizeProjectPath(rawPath)
    if (!normalized) return
    pathRoots.push({
      projectId,
      path: normalized,
      depth: normalized.split("/").length,
    })
  }

  for (const project of projects) {
    if (project.folderId != null) {
      folderIdToProject.set(project.folderId, project.id)
    }
    pushRoot(project.id, project.rootDir)
    const repos = reposByProject.get(project.id) ?? []
    for (const repo of repos) {
      if (repo.folderId != null) {
        folderIdToProject.set(repo.folderId, project.id)
      }
      pushRoot(project.id, repo.localDir)
    }
  }

  pathRoots.sort((a, b) => b.depth - a.depth)
  return { folderIdToProject, pathRoots }
}

/**
 * Resolve the project a folder belongs to, or `null` when the folder is not
 * associated with any project.
 *
 * `folders` must contain the full folder set (including hidden
 * `platform_repo` and worktree rows) for the parent chain to resolve.
 */
export function resolveProjectForFolder(
  folder: FolderLike | null | undefined,
  folders: readonly FolderLike[],
  index: FolderProjectIndex
): number | null {
  if (!folder) return null

  const direct = index.folderIdToProject.get(folder.id)
  if (direct != null) return direct

  // Worktree (and deeper) folders: walk up the parent chain to the repo/root.
  const seen = new Set<number>([folder.id])
  let current: FolderLike | undefined = folder
  while (current?.parent_id != null) {
    const parentId: number = current.parent_id
    if (seen.has(parentId)) break
    seen.add(parentId)
    const parent = folders.find((f) => f.id === parentId)
    if (!parent) break
    const hit = index.folderIdToProject.get(parent.id)
    if (hit != null) return hit
    current = parent
  }

  // Path-prefix fallback — deepest root wins (`pathRoots` is depth-sorted).
  const normalized = normalizeProjectPath(folder.path)
  if (normalized) {
    for (const root of index.pathRoots) {
      if (normalized === root.path || normalized.startsWith(`${root.path}/`)) {
        return root.projectId
      }
    }
  }

  return null
}

/**
 * Pick the folder a new conversation draft for `project` should be anchored
 * to: the project root folder when present in the open set, else the first
 * open folder that resolves to the project (a registered sub-repo). Returns
 * `null` when the project has no openable folder yet — callers then keep the
 * current workspace as-is.
 */
export function pickProjectAnchorFolder(
  project: ProjectInfo,
  folders: readonly FolderLike[],
  index: FolderProjectIndex
): FolderLike | null {
  const root =
    project.folderId != null
      ? folders.find((f) => f.id === project.folderId)
      : undefined
  if (root) return root
  return (
    folders.find(
      (f) => resolveProjectForFolder(f, folders, index) === project.id
    ) ?? null
  )
}
