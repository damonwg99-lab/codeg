"use client"

import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { AutomationsPage } from "@/components/automations/automations-page"
import { ProjectList } from "@/components/platform/project-list"
import { ProjectDetail } from "@/components/platform/project-detail"
import { CreateProjectForm } from "@/components/platform/create-project-form"
import { TaskKanban } from "@/components/platform/task-kanban"
import { TaskDetail } from "@/components/platform/task-detail"
import { CreateTaskForm } from "@/components/platform/create-task-form"
import { ReleaseList } from "@/components/platform/release-list"
import { ReleaseDetail } from "@/components/platform/release-detail"
import { CreateReleaseForm } from "@/components/platform/create-release-form"
import { ArchiveView } from "@/components/platform/archive-view"

/**
 * Registry of full-page routes that take over the main content region. The
 * `"conversations"` route is the default workspace and is intentionally absent
 * here — it is the fallback rendered underneath. To add a new left-sidebar
 * route: extend WorkbenchRouteId, add a case below, and add a SidebarNavButton
 * that calls `setRoute("<id>")`.
 *
 * Some routes need params (id, projectId, taskId) which are passed via
 * WorkbenchRouteContext.routeParams.
 */
export function WorkbenchRoutePage() {
  const { routeId, routeParams, setRoute } = useWorkbenchRoute()

  switch (routeId) {
    case "automations":
      return <AutomationsPage />
    case "project-list":
      return <ProjectList />
    case "project-detail":
      return <ProjectDetail id={Number(routeParams.id)} />
    case "create-project":
      return <CreateProjectForm />
    case "task-kanban":
      return <TaskKanban projectId={Number(routeParams.projectId)} />
    case "task-detail":
      return <TaskDetail taskId={Number(routeParams.taskId)} />
    case "create-task":
      return <CreateTaskForm projectId={Number(routeParams.projectId)} />
    case "release-list":
      return <ReleaseList projectId={Number(routeParams.projectId)} setRoute={setRoute} />
    case "release-detail":
      return <ReleaseDetail />
    case "create-release":
      return <CreateReleaseForm projectId={Number(routeParams.projectId)} />
    case "archive-view":
      return (
        <ArchiveView
          projectId={Number(routeParams.projectId)}
          searchKeyword={(routeParams.searchKeyword as string) || ""}
          filterType={(routeParams.filterType as string) || "all"}
          filterPriority={(routeParams.filterPriority as string) || "all"}
        />
      )
    default:
      return null
  }
}
