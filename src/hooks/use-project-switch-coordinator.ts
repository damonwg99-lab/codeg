"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useTabContext } from "@/contexts/tab-context"
import { usePlatform } from "@/contexts/platform-context"
import { useAppWorkspace } from "@/contexts/app-workspace-shim"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import {
  buildFolderProjectIndex,
  pickProjectAnchorFolder,
  resolveProjectForFolder,
} from "@/lib/folder-project-mapping"
import {
  clearExplicitProjectSwitch,
  getProjectReposSnapshot,
  markExplicitProjectSwitch,
} from "@/hooks/use-tab-project-follow"

/**
 * Coordinates project switching WITHOUT destroying the current session.
 *
 * Switching projects is non-destructive:
 * - An existing tab of the target project is activated when one exists.
 * - Otherwise a new draft tab is opened in the target project's root folder
 *   (deferred to the effect below when the root folder is not open yet).
 * - Full-page task routes are re-pointed at the new projectId.
 * - A toast confirms the switch, matching the folder picker below the chat
 *   input (single source of truth for the "current workspace").
 *
 * The active project state itself is also followed back: focusing a tab of
 * another project pulls the active project along (see useTabProjectFollow), so
 * tab strips can freely mix projects without the header/workspace disagreeing.
 */
export function useProjectSwitchCoordinator() {
  const t = useTranslations("Platform.switcher")
  const { tabs, activeTabId, switchTab, openNewConversationTab } =
    useTabContext()
  const { activeProjectId, setActiveProjectId, activeProject, projects } =
    usePlatform()
  const { allFolders } = useAppWorkspace()
  const { routeId, setRoute } = useWorkbenchRoute()
  const pendingSwitchRef = useRef<number | null>(null)

  const switchProject = useCallback(
    (newId: number) => {
      if (newId === activeProjectId) return

      // Gate the tab-follow hook while the explicit switch materializes.
      markExplicitProjectSwitch(newId)
      setActiveProjectId(newId)

      const index = buildFolderProjectIndex(projects, getProjectReposSnapshot())
      const targetProject = projects.find((p) => p.id === newId)

      // Activate an existing tab of the target project when one is open;
      // only fall back to opening a fresh draft in the root folder.
      const targetTab = tabs.find((tab) => {
        if (tab.isChat === true) return false
        const folder = allFolders.find((f) => f.id === tab.folderId)
        return (
          folder != null &&
          resolveProjectForFolder(folder, allFolders, index) === newId
        )
      })
      if (targetTab) {
        switchTab(targetTab.id)
      } else {
        const anchor = targetProject
          ? pickProjectAnchorFolder(targetProject, allFolders, index)
          : null
        if (anchor) {
          openNewConversationTab(anchor.id, anchor.path, {
            inheritFromActive: true,
          })
        } else {
          // Root folder not open yet — platform-context adds it while loading
          // the project detail; the effect below opens the draft then.
          pendingSwitchRef.current = newId
        }
      }

      // When switching from a project-specific page, navigate to the
      // corresponding view so the page data matches the new project.
      if (routeId === "project-detail" || routeId === "create-project") {
        setRoute("project-list")
      } else if (
        routeId === "task-detail" ||
        routeId === "create-task" ||
        routeId === "task-kanban"
      ) {
        setRoute("task-kanban", { projectId: newId })
      }

      const target = projects.find((p) => p.id === newId)
      toast.success(t("toasts.switchedToProject", { name: target?.name ?? "" }))
    },
    [
      tabs,
      activeProjectId,
      switchTab,
      openNewConversationTab,
      setActiveProjectId,
      routeId,
      setRoute,
      projects,
      allFolders,
      t,
    ]
  )

  // The root folder was not open at switch time — once the project detail
  // loads (platform-context auto-opens the root folder) open a draft in it.
  // Skipped when a tab of the target project became active meanwhile.
  useEffect(() => {
    if (pendingSwitchRef.current === null) return
    if (activeProject?.id !== pendingSwitchRef.current) return
    const pendingId = pendingSwitchRef.current
    pendingSwitchRef.current = null

    const index = buildFolderProjectIndex(projects, getProjectReposSnapshot())
    const activeTab = tabs.find((t) => t.id === activeTabId)
    const activeFolder =
      activeTab != null
        ? allFolders.find((f) => f.id === activeTab.folderId)
        : null
    if (
      activeFolder != null &&
      resolveProjectForFolder(activeFolder, allFolders, index) === pendingId
    ) {
      return
    }

    const anchor = pickProjectAnchorFolder(activeProject, allFolders, index)
    if (!anchor) {
      // Project has no openable folder — resume tab-following.
      clearExplicitProjectSwitch()
      return
    }
    openNewConversationTab(anchor.id, anchor.path, { inheritFromActive: true })
  }, [
    activeProject,
    allFolders,
    tabs,
    activeTabId,
    projects,
    openNewConversationTab,
  ])

  return { switchProject }
}
