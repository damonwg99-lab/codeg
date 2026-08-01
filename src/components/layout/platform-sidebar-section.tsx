"use client"

import { FolderKanban, KanbanSquare } from "lucide-react"
import { useTranslations } from "next-intl"
import { usePlatform } from "@/contexts/platform-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { ProjectSwitcher } from "@/components/platform/project-switcher"
import { SidebarNavButton } from "@/components/layout/sidebar"

/**
 * Platform (Cluster A) sidebar section: a project switcher at the top plus the
 * Projects and Tasks route buttons. Rendered at the top of the sidebar's fixed
 * actions row. `ProjectSwitcher` returns null until at least one project exists,
 * so the switcher only appears when there's something to switch between.
 */
export function PlatformSidebarSection() {
  const t = useTranslations("Platform.nav")
  const { activeProjectId, hasProjects } = usePlatform()
  const { routeId, setRoute } = useWorkbenchRoute()

  return (
    <>
      <ProjectSwitcher />
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