"use client"

import type { ComponentType } from "react"
import { useTranslations } from "next-intl"
import {
  Archive,
  FilePlus,
  FolderOpen,
  FolderPlus,
  KanbanSquare,
  ListTodo,
  PackagePlus,
  Rocket,
  type LucideIcon,
} from "lucide-react"
import {
  useWorkbenchRoute,
  type WorkbenchRouteId,
} from "@/contexts/workbench-route-context"
import { AutomationsPage, AutomationsPageTitle } from "@/components/automations/automations-page"
import { TasksPage, TasksPageTitle } from "@/components/tasks/tasks-page"
import {
  TokenUsagePage,
  TokenUsagePageTitle,
} from "@/components/token-usage/token-usage-page"
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

// ─── Platform page titles (window-chrome strip) ──────────────────────────────
// Same chrome-strip idiom as TasksPageTitle: a h-10 band with an icon + title.
// Each platform route gets one so the full-screen overlay reads consistently.

function makePlatformTitle(icon: LucideIcon, labelKey: string) {
  return function PlatformPageTitle() {
    const t = useTranslations("Platform")
    const Icon = icon
    return (
      <div className="flex h-10 shrink-0 items-center gap-2 pl-4">
        <h1 className="flex items-center gap-1.5 text-[0.8125rem] font-semibold leading-none">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t(labelKey as never)}
        </h1>
      </div>
    )
  }
}

const ProjectListTitle = makePlatformTitle(FolderOpen, "nav.projectList")
const ProjectDetailTitle = makePlatformTitle(FolderOpen, "project.detail")
const CreateProjectTitle = makePlatformTitle(FolderPlus, "nav.createProject")
const TaskKanbanTitle = makePlatformTitle(KanbanSquare, "nav.taskKanban")
const TaskDetailTitle = makePlatformTitle(ListTodo, "task.detail")
const CreateTaskTitle = makePlatformTitle(FilePlus, "task.create")
const ReleaseListTitle = makePlatformTitle(Rocket, "task.releaseManagement")
const ReleaseDetailTitle = makePlatformTitle(Rocket, "task.releaseManagement")
const CreateReleaseTitle = makePlatformTitle(PackagePlus, "task.createRelease")
const ArchiveViewTitle = makePlatformTitle(Archive, "task.archivedTasks")
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
  tasks: TasksPage,
  tokenUsage: TokenUsagePage,
}

/** Optional per-route content for the window-chrome strip above the page
 *  (the h-10 band the fixed corner overlays sit on) — e.g. the page title. */
const WORKBENCH_ROUTE_STRIPS: Partial<Record<WorkbenchRouteId, ComponentType>> =
  {
    automations: AutomationsPageTitle,
    tasks: TasksPageTitle,
    tokenUsage: TokenUsagePageTitle,
    "project-list": ProjectListTitle,
    "project-detail": ProjectDetailTitle,
    "create-project": CreateProjectTitle,
    "task-kanban": TaskKanbanTitle,
    "task-detail": TaskDetailTitle,
    "create-task": CreateTaskTitle,
    "release-list": ReleaseListTitle,
    "release-detail": ReleaseDetailTitle,
    "create-release": CreateReleaseTitle,
    "archive-view": ArchiveViewTitle,
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

/** The active route's strip content (page title), or nothing. */
export function WorkbenchRouteStrip() {
  const { routeId } = useWorkbenchRoute()
  const Strip = WORKBENCH_ROUTE_STRIPS[routeId]
  return Strip ? <Strip /> : null
}

/** Whether the active route contributes chrome-strip content — lets the host
 *  style the band (e.g. its bottom border) only when a title renders. */
export function useHasWorkbenchRouteStrip(): boolean {
  const { routeId } = useWorkbenchRoute()
  return WORKBENCH_ROUTE_STRIPS[routeId] != null
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
