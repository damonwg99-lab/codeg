"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabStore } from "@/stores/tab-store"
import { useOptionalWorkbenchRoute } from "@/contexts/workbench-route-context"
import { listProjectRepos } from "@/lib/platform/api"
import type { ProjectInfo, ProjectRepoInfo } from "@/lib/platform/types"
import {
  buildFolderProjectIndex,
  resolveProjectForFolder,
} from "@/lib/folder-project-mapping"

/**
 * Keeps the active project in sync with the focused conversation tab — the
 * reverse direction of `useProjectSwitchCoordinator`.
 *
 * A tab never stores a `projectId`; the project is reverse-resolved from the
 * tab's bound `folderId` (exact match → parent-chain walk → path prefix, see
 * folder-project-mapping.ts). When the user focuses a tab belonging to another
 * project, the active project silently follows — so the top project switcher,
 * RepoSelector, the file tree, git panels and the task kanban filter all
 * describe the same workspace the focused tab is anchored to. No tab is ever
 * closed or rebuilt by this hook.
 *
 * Folders that resolve to no project (freely opened directories, hidden chat
 * folders) leave the current project untouched.
 */

// Module-level cache: project id → its registered repos. Filled lazily, one
// `list_project_repos` call per project, so the folder→project index covers
// every project's root and repos (not just the currently active one).
const reposCache = new Map<number, ProjectRepoInfo[]>()

/**
 * Gate for explicit switches (`useProjectSwitchCoordinator`). While a pending
 * explicit switch has not yet materialized a tab in the target project
 * (e.g. the root folder still has to be opened), the follow hook must not
 * pull the active project back to the still-focused tab.
 */
let explicitSwitchProjectId: number | null = null

/** Called by the switch coordinator right before it switches projects. */
export function markExplicitProjectSwitch(projectId: number): void {
  explicitSwitchProjectId = projectId
}

/**
 * Give up an in-flight explicit switch (e.g. the target project turned out to
 * have no openable folder). The follow hook resumes normal tab-following.
 */
export function clearExplicitProjectSwitch(): void {
  explicitSwitchProjectId = null
}

/**
 * Snapshot of the module-level repos cache, for consumers that need to build a
 * folder→project index outside this hook (the switch coordinator).
 */
export function getProjectReposSnapshot(): Map<number, ProjectRepoInfo[]> {
  return reposCache
}

export interface TabProjectFollowParams {
  activeProjectId: number | null
  setActiveProjectId: (id: number | null) => void
  activeProject: ProjectInfo | null
  projects: ProjectInfo[]
}

/**
 * Mounted inside `PlatformProvider` (which owns the project state), so the
 * project values are injected as parameters — `usePlatform()` cannot be used
 * here: the hook runs while that provider is still rendering.
 */
export function useTabProjectFollow({
  activeProjectId,
  setActiveProjectId,
  activeProject,
  projects,
}: TabProjectFollowParams): void {
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  const route = useOptionalWorkbenchRoute()

  const [reposVersion, setReposVersion] = useState(0)
  const pendingFollowRef = useRef<{
    projectId: number
    folderId: number
  } | null>(null)

  const missingRepoIds = useMemo(
    () => projects.filter((p) => !reposCache.has(p.id)).map((p) => p.id),
    [projects]
  )

  // Fill the repos cache once per not-yet-loaded project. Failures cache an
  // empty list so a broken transport doesn't retry-loop.
  useEffect(() => {
    if (missingRepoIds.length === 0) return
    let cancelled = false
    void (async () => {
      await Promise.all(
        missingRepoIds.map(async (id) => {
          try {
            const repos = await listProjectRepos(id)
            if (!cancelled) reposCache.set(id, repos)
          } catch {
            if (!cancelled) reposCache.set(id, [])
          }
        })
      )
      if (!cancelled) {
        setReposVersion((v) => v + 1)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [missingRepoIds])

  const index = useMemo(
    () => buildFolderProjectIndex(projects, reposCache),
    // `reposCache` is a module-level mutable map; `reposVersion` marks fills.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, reposVersion]
  )

  // Follow: the focused tab's folder determines the active project.
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? null
    if (!activeTab || activeTab.isChat === true) return

    const folder = allFolders.find((f) => f.id === activeTab.folderId)
    if (!folder) return

    const derived = resolveProjectForFolder(folder, allFolders, index)

    // An explicit switch is in flight — defer to it until the tab it is
    // about to open/activate makes the derived project converge.
    if (explicitSwitchProjectId != null) {
      if (derived != null && derived === explicitSwitchProjectId) {
        explicitSwitchProjectId = null
      }
      return
    }

    if (derived == null || derived === activeProjectId) {
      pendingFollowRef.current = null
      return
    }

    pendingFollowRef.current = { projectId: derived, folderId: folder.id }

    setActiveProjectId(derived)

    // Full-page task routes carry a projectId — keep the page on the project
    // the user just focused.
    if (route?.routeId === "task-kanban") {
      const routeProjectId = route.routeParams.projectId
      if (routeProjectId != null && Number(routeProjectId) !== derived) {
        route.setRoute("task-kanban", { projectId: derived })
      }
    }
  }, [
    tabs,
    activeTabId,
    allFolders,
    index,
    activeProjectId,
    setActiveProjectId,
    route,
  ])

  // `platform-context` loads the new project's detail and pulls the workspace
  // active folder to the project root — for a tab-driven switch that is wrong
  // (the focused tab's folder is the truth). Re-assert it once the detail
  // lands, mirroring the explicit-switch flow without closing anything.
  useEffect(() => {
    const pending = pendingFollowRef.current
    if (!pending) return
    if (activeProject?.id !== pending.projectId) return
    pendingFollowRef.current = null

    const workspace = useAppWorkspaceStore.getState()
    workspace.addFolderToWorkspaceById(pending.folderId).catch(() => {})
    workspace.setActiveFolderId(pending.folderId)
  }, [activeProject?.id])
}
