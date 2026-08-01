"use client"

import type { ComponentType } from "react"
import {
  useWorkbenchRoute,
  type WorkbenchRouteId,
} from "@/contexts/workbench-route-context"
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
 * route: extend WorkbenchRouteId, add an entry below, and add a SidebarNavButton
 * that calls `setRoute("<id>")`.
 */
const WORKBENCH_ROUTES: Partial<Record<WorkbenchRouteId, ComponentType>> = {
  automations: AutomationsPage,
  "project-list": ProjectList,
  "project-detail": ProjectDetailRoute,
  "create-project": CreateProjectForm,
  "task-kanban": TaskKanbanRoute,
  "task-detail": TaskDetailRoute,
  "create-task": CreateTaskFormRoute,
  "release-list": ReleaseListRoute,
  "release-detail": ReleaseDetail,
  "create-release": CreateReleaseFormRoute,
  "archive-view": ArchiveViewRoute,
}

/**
 * Renders the active non-conversation route page, or nothing when the
 * conversation workspace is active. WorkspaceContent overlays this on top of the
 * (kept-mounted, hidden) conversation surface so live sessions survive the swap.
 */
export function WorkbenchRoutePage() {
  const { routeId } = useWorkbenchRoute()
  const Page = WORKBENCH_ROUTES[routeId]
  return Page ? <Page /> : null
}

// ─── Platform route wrappers (Cluster A/B Release) ───────────────────────────
// Each wrapper reads route params from useWorkbenchRoute() and forwards them to
// the underlying page component. Plain components (ProjectList, CreateProjectForm,
// ReleaseDetail) register directly because they don't take params.

function ProjectDetailRoute() {
  const { routeParams } = useWorkbenchRoute()
  const id = Number(routeParams.id)
  return Number.isFinite(id) ? <ProjectDetail id={id} /> : null
}

function TaskKanbanRoute() {
  const { routeParams } = useWorkbenchRoute()
  const projectId = Number(routeParams.projectId)
  return Number.isFinite(projectId) ? <TaskKanban projectId={projectId} /> : null
}

function TaskDetailRoute() {
  const { routeParams } = useWorkbenchRoute()
  const taskId = Number(routeParams.taskId)
  return Number.isFinite(taskId) ? <TaskDetail taskId={taskId} /> : null
}

function CreateTaskFormRoute() {
  const { routeParams } = useWorkbenchRoute()
  const projectId = Number(routeParams.projectId)
  return Number.isFinite(projectId) ? <CreateTaskForm projectId={projectId} /> : null
}

function ReleaseListRoute() {
  const { routeParams, setRoute } = useWorkbenchRoute()
  const projectId = Number(routeParams.projectId)
  return Number.isFinite(projectId) ? (
    <ReleaseList projectId={projectId} setRoute={setRoute} />
  ) : null
}

function CreateReleaseFormRoute() {
  const { routeParams } = useWorkbenchRoute()
  const projectId = Number(routeParams.projectId)
  return Number.isFinite(projectId) ? (
    <CreateReleaseForm projectId={projectId} />
  ) : null
}

function ArchiveViewRoute() {
  const { routeParams } = useWorkbenchRoute()
  const projectId = Number(routeParams.projectId)
  return Number.isFinite(projectId) ? (
    <ArchiveView
      projectId={projectId}
      searchKeyword={(routeParams.searchKeyword as string) || ""}
      filterType={(routeParams.filterType as string) || "all"}
      filterPriority={(routeParams.filterPriority as string) || "all"}
    />
  ) : null
}