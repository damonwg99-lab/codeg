"use client"

import { useCallback, useEffect, useRef } from "react"
import { useTabContext } from "@/contexts/tab-context"
import { usePlatform } from "@/contexts/platform-context"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"

/**
 * Coordinates project switching with tab management.
 *
 * When the user switches projects:
 * - Draft tab (no conversationId): retargeted to the new project root folder
 * - Existing conversation: closed, then a new draft is created in the new project root
 * - Task kanban page: route params updated to the new projectId so data refreshes
 *
 * The pending-switch ref ensures this only fires on explicit user action
 * (not on initial hydration from localStorage).
 */
export function useProjectSwitchCoordinator() {
  const { tabs, activeTabId, closeTab, openNewConversationTab } =
    useTabContext()
  const { setActiveProjectId, activeProject } = usePlatform()
  const { allFolders } = useAppWorkspace()
  const { routeId, routeParams, setRoute } = useWorkbenchRoute()
  const pendingSwitchRef = useRef<number | null>(null)

  const switchProject = useCallback(
    (newId: number) => {
      // Check the active tab BEFORE switching — is it a draft or existing?
      const activeTab = tabs.find((t) => t.id === activeTabId)
      const isDraft = activeTab?.conversationId == null

      // Existing conversation → close it first
      if (!isDraft && activeTab) {
        closeTab(activeTabId)
      }

      // If currently on task kanban or task detail, update the route's
      // projectId so the view refreshes for the new project
      if (
        routeId === "task-kanban" ||
        routeId === "task-detail" ||
        routeId === "create-task"
      ) {
        setRoute(routeId, { ...routeParams, projectId: newId })
      }

      // Mark pending so the effect knows to create/retarget a draft after
      // the project detail loads
      pendingSwitchRef.current = newId
      setActiveProjectId(newId)
    },
    [
      tabs,
      activeTabId,
      closeTab,
      setActiveProjectId,
      routeId,
      routeParams,
      setRoute,
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
