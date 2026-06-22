"use client"

import { Suspense, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { ProjectList } from "@/components/platform/project-list"
import { ProjectDetail } from "@/components/platform/project-detail"
import { CreateProjectForm } from "@/components/platform/create-project-form"
import { TaskDetail } from "@/components/platform/task-detail"
import { TaskKanban } from "@/components/platform/task-kanban"
import { TaskListTable } from "@/components/platform/task-list-table"
import { ScrollArea } from "@/components/ui/scroll-area"

function PlatformContent() {
  const searchParams = useSearchParams()
  const t = useTranslations("Platform")
  const view = searchParams.get("view") ?? "home"
  const id = searchParams.get("id")
  const projectId = searchParams.get("projectId")

  const content = useMemo(() => {
    switch (view) {
      case "project-detail":
        return id ? <ProjectDetail projectId={Number(id)} /> : null
      case "create-project":
        return <CreateProjectForm />
      case "task-detail":
        return id ? <TaskDetail taskId={Number(id)} /> : null
      case "kanban":
        return projectId ? (
          <TaskKanban projectId={Number(projectId)} />
        ) : null
      case "task-list":
        return projectId ? (
          <TaskListTable projectId={Number(projectId)} />
        ) : null
      default:
        return <ProjectList />
    }
  }, [view, id, projectId, t])

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-4">{content}</div>
    </ScrollArea>
  )
}

export default function PlatformPage() {
  return (
    <Suspense fallback={<div className="p-4 text-muted-foreground">Loading…</div>}>
      <PlatformContent />
    </Suspense>
  )
}
