"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, KanbanSquare } from "lucide-react"
import { listProjects, listTasks } from "@/lib/platform/api"
import type { ProjectInfo, TaskInfo, TaskStatus } from "@/lib/platform/types"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function SidebarProjectPanel() {
  const t = useTranslations("Platform")
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>("")
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [loading, setLoading] = useState(false)

  // Load projects on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listProjects()
        if (!cancelled) setProjects(list)
      } catch {
        // Keep previous list on transient failure
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Load tasks when project is selected
  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === "_none") {
      setTasks([])
      return
    }
    let cancelled = false
    setLoading(true)
    async function load() {
      try {
        const list = await listTasks(Number(selectedProjectId))
        if (!cancelled) {
          setTasks(list)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setTasks([])
          setLoading(false)
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [selectedProjectId])

  function navigateToKanban() {
    if (selectedProjectId && selectedProjectId !== "_none") {
      router.push(`/platform?view=kanban&projectId=${selectedProjectId}`)
    }
  }

  function navigateToCreateProject() {
    router.push("/platform?view=create-project")
  }

  return (
    <div className="flex flex-col gap-2 px-1.5 pt-1.5">
      {/* Project selector */}
      <div className="flex items-center gap-1.5">
        <Select
          value={selectedProjectId}
          onValueChange={setSelectedProjectId}
        >
          <SelectTrigger className="h-8 flex-1 text-[0.875rem]">
            <SelectValue placeholder={t("sidebar.selectProject")} />
          </SelectTrigger>
          <SelectContent>
            {projects.length === 0 && (
              <SelectItem value="_none" disabled>
                {t("sidebar.noProject")}
              </SelectItem>
            )}
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-[0.8125rem]"
          disabled={!selectedProjectId || selectedProjectId === "_none"}
          onClick={navigateToKanban}
        >
          <KanbanSquare className="mr-1 h-3.5 w-3.5" />
          {t("task.kanban")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-[0.8125rem]"
          onClick={navigateToCreateProject}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("sidebar.createProject")}
        </Button>
      </div>

      {/* Task list (recent tasks for selected project) */}
      {selectedProjectId && selectedProjectId !== "_none" && (
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col gap-1 pb-2">
            {loading ? (
              <div className="py-4 text-center text-[0.8125rem] text-muted-foreground">
                Loading…
              </div>
            ) : tasks.length === 0 ? (
              <div className="py-4 text-center text-[0.8125rem] text-muted-foreground">
                {t("task.noTasks")}
              </div>
            ) : (
              tasks.slice(0, 10).map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className={cn(
                    "group flex items-center gap-1.5 rounded-md px-2 py-1.5",
                    "text-[0.8125rem] text-sidebar-foreground",
                    "hover:bg-sidebar-accent outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                  onClick={() =>
                    router.push(`/platform?view=task-detail&id=${task.id}`)
                  }
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 shrink-0 px-1.5 text-[0.625rem]",
                      TASK_STATUS_COLORS[task.status as TaskStatus] ?? TASK_STATUS_COLORS.backlog,
                    )}
                  >
                    {TASK_STATUS_LABELS[task.status as TaskStatus] ?? task.status}
                  </Badge>
                  <span className="truncate">{task.title}</span>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
