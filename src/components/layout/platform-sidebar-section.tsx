"use client"

import { FolderKanban, KanbanSquare } from "lucide-react"
import { useTranslations } from "next-intl"
import { usePlatformOptional } from "@/contexts/platform-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { SidebarNavButton } from "@/components/layout/sidebar"

/**
 * Platform (Cluster A) sidebar section: the Projects and Tasks route buttons.
 * Rendered at the top of the sidebar's fixed actions row. (The project switcher
 * itself now lives in the top bar, next to the repo switcher.)
 *
 * Degrades to null when no PlatformProvider is mounted (e.g. in unit tests that
 * render the bare Sidebar without platform wiring).
 */
export function PlatformSidebarSection() {
  const t = useTranslations("Platform.nav")
  const platform = usePlatformOptional()
  const { routeId, setRoute } = useWorkbenchRoute()

  if (!platform) return null
  const { activeProjectId, hasProjects } = platform

  return (
    <>
      <SidebarNavButton
        icon={FolderKanban}
        label={t("projectList")}
        active={
          routeId === "project-list" ||
          routeId === "project-detail" ||
          routeId === "create-project"
        }
        onClick={() => setRoute("project-list")}
      />
      {hasProjects && (
        <SidebarNavButton
          icon={KanbanSquare}
          label={t("taskKanban")}
          active={
            routeId === "task-kanban" ||
            routeId === "task-detail" ||
            routeId === "create-task" ||
            routeId === "release-list" ||
            routeId === "release-detail" ||
            routeId === "create-release" ||
            routeId === "archive-view"
          }
          onClick={() => {
            if (activeProjectId == null) {
              setRoute("project-list")
              return
            }
            setRoute("task-kanban", { projectId: activeProjectId })
          }}
        />
      )}
    </>
  )
}
