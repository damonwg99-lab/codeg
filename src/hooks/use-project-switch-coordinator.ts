"use client"

import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useTabContext } from "@/contexts/tab-context"
import { usePlatform } from "@/contexts/platform-context"
import { useAppWorkspace } from "@/contexts/app-workspace-shim"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"

/**
 * Coordinates project switching with tab management.
 *
 * When the user switches projects:
 * - Draft tab (no conversationId): retargeted to the new project root folder
 * - Existing conversation: closed, then a new draft is created in the new project root
 * - Task kanban page: route params updated to the new projectId so data refreshes
 * - A bottom-right toast confirms the switch, matching the folder picker below
 *   the chat input (single source of truth for the "current workspace").
 *
 * The pending-switch ref ensures this only fires on explicit user action
 * (not on initial hydration from localStorage).
 */
export function useProjectSwitchCoordinator() {
  const t = useTranslations("Platform.switcher")
  const { tabs, activeTabId, closeTab, openNewConversationTab } =
    useTabContext()
  const { setActiveProjectId, activeProject, projects } = usePlatform()
  const { allFolders } = useAppWorkspace()
  const { routeId, setRoute } = useWorkbenchRoute()
  const pendingSwitchRef = useRef<number | null>(null)

  const switchProject = useCallback(
    (newId: number) => {
      // Check the active tab BEFORE switching — is it a draft or existing?
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const isDraft = activeTab?.conversationId == null

      // Existing conversation → close it first
      if (!isDraft && activeTab && activeTabId) {
        closeTab(activeTabId)
      }

      // When switching project from a project-specific page, navigate to
      // the corresponding list/kanban view so the page data is consistent
      // with the new project.
      if (routeId === "project-detail" || routeId === "create-project") {
        setRoute("project-list")
      } else if (routeId === "task-detail" || routeId === "create-task") {
        setRoute("task-kanban", { projectId: newId })
      } else if (routeId === "task-kanban") {
        // Kanban already project-specific — just update projectId
        setRoute("task-kanban", { projectId: newId })
      }

      // Mark pending so the effect knows to create/retarget a draft after
      // the project detail loads
      pendingSwitchRef.current = newId
      setActiveProjectId(newId)

      // Confirm the switch with the same bottom-right toast the folder picker
      // below the chat input uses, so top project switching and bottom
      // folder/workspace switching stay visibly consistent.
      const target = projects.find((p) => p.id === newId)
      toast.success(t("toasts.switchedToProject", { name: target?.name ?? "" }))
    },
    [
      tabs,
      activeTabId,
      closeTab,
      setActiveProjectId,
      routeId,
      setRoute,
      projects,
      t,
    ]
  )

  // After the project detail loads, create or retarget a draft tab in the
  // new project's root folder.
  useEffect(() => {
    if (pendingSwitchRef.current === null) return
    if (activeProject?.id !== pendingSwitchRef.current) return
    pendingSwitchRef.current = null

    if (activeProject.folderId) {
      const rootFolder = allFolders.find((f) => f.id === activeProject.folderId)
      if (rootFolder) {
        openNewConversationTab(rootFolder.id, rootFolder.path, {
          inheritFromActive: true,
        })
      }
    }
  }, [activeProject, allFolders, openNewConversationTab])

  return { switchProject }
}
