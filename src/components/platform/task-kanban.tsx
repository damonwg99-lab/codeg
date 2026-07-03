"use client"

import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Plus, GripVertical } from "lucide-react"
import { DndContext, closestCorners, type DragEndEvent } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { listTasks, updateTaskStatus } from "@/lib/platform/api"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import type { TaskInfo, TaskPriority, TaskStatus } from "@/lib/platform/types"
import {
  TASK_STATUS_LIST,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_COLORS,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

/** Resolve task status label using i18n (same pattern as task-detail). */
function resolveStatusLabel(t: (key: never) => string, status: string): string {
  const keyMap: Record<string, string> = {
    backlog: "task.status.backlog",
    confirmed: "task.status.confirmed",
    in_progress: "task.status.in_progress",
    done: "task.status.done",
    released: "task.status.released",
  }
  const key = keyMap[status]
  return key ? (t(key as never) ?? status) : status
}

/** Resolve task type label using i18n. */
function resolveTypeLabel(t: (key: never) => string, taskType: string): string {
  const keyMap: Record<string, string> = {
    bug: "task.taskTypeOptions.bug",
    feature: "task.taskTypeOptions.feature",
    task: "task.taskTypeOptions.task",
    improvement: "task.taskTypeOptions.improvement",
  }
  const key = keyMap[taskType]
  return key ? (t(key as never) ?? taskType) : taskType
}

/** Resolve task priority label using i18n. */
function resolvePriorityLabel(
  t: (key: never) => string,
  priority: string
): string {
  const keyMap: Record<string, string> = {
    low: "task.priorityOptions.low",
    medium: "task.priorityOptions.medium",
    high: "task.priorityOptions.high",
    urgent: "task.priorityOptions.urgent",
  }
  const key = keyMap[priority]
  return key ? (t(key as never) ?? priority) : priority
}

function TaskCard({ task, projectId }: { task: TaskInfo; projectId: number }) {
  const { setRoute } = useWorkbenchRoute()
  const t = useTranslations("Platform")
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `task-${task.id}` })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }
    : { transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "cursor-pointer transition-colors hover:bg-accent",
        "touch-none select-none rounded-md"
      )}
      onClick={() =>
        setRoute(
          "task-detail",
          { taskId: task.id, projectId },
          { routeId: "task-kanban", params: { projectId } }
        )
      }
    >
      <CardContent className="flex items-stretch p-0">
        {/* Drag handle — separate from click target */}
        <div
          {...attributes}
          {...listeners}
          className="flex items-center px-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
        {/* Clickable content area — no status badge before title */}
        <div className="flex flex-col gap-0.5 py-2 pr-2.5 min-w-0 flex-1">
          <span className="truncate text-[0.8125rem] font-medium">
            {task.title}
          </span>
          <div className="flex items-center gap-1 text-[0.625rem] text-muted-foreground">
            <Badge variant="outline" className="text-[0.625rem]">
              {resolveTypeLabel(t, task.taskType)}
            </Badge>
            {task.priority && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[0.625rem]",
                  TASK_PRIORITY_COLORS[task.priority as TaskPriority] ?? ""
                )}
              >
                {resolvePriorityLabel(t, task.priority)}
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function KanbanColumn({
  status,
  tasks,
  projectId,
}: {
  status: TaskStatus
  tasks: TaskInfo[]
  projectId: number
}) {
  const t = useTranslations("Platform")
  const taskCount = tasks.length

  const sortableIds = tasks.map((task) => `task-${task.id}`)

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {/* Column header — centered */}
      <div className="flex items-center justify-center gap-2 px-2 py-1.5 shrink-0">
        <Badge
          variant="outline"
          className={cn("px-2 text-[0.75rem]", TASK_STATUS_COLORS[status])}
        >
          {resolveStatusLabel(t, status)}
        </Badge>
        <span className="text-[0.75rem] text-muted-foreground">
          {taskCount}
        </span>
      </div>
      {/* Scrollable card area */}
      <ScrollArea className="flex-1 min-h-0 rounded-md">
        <SortableContext
          items={sortableIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-1.5 p-1">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} projectId={projectId} />
            ))}
            {tasks.length === 0 && (
              <div className="py-8 text-center text-[0.75rem] text-muted-foreground">
                {t("task.noTasks")}
              </div>
            )}
          </div>
        </SortableContext>
      </ScrollArea>
    </div>
  )
}

export function TaskKanban({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  const { setRoute } = useWorkbenchRoute()
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listTasks(projectId)
        if (!cancelled) {
          setTasks(list)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return

      const taskId = Number(String(active.id).replace("task-", ""))
      const overId = String(over.id)

      let newStatus: string | null = null
      if (overId.startsWith("task-")) {
        const overTask = tasks.find(
          (task) => task.id === Number(overId.replace("task-", ""))
        )
        if (overTask) newStatus = overTask.status
      } else {
        newStatus = overId
      }

      if (!newStatus) return

      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, status: newStatus } : task
        )
      )

      try {
        await updateTaskStatus(taskId, newStatus)
      } catch {
        const list = await listTasks(projectId)
        setTasks(list)
      }
    },
    [tasks, projectId]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b">
        <h2 className="text-lg font-semibold">{t("task.kanban")}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRoute("create-task", { projectId })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("task.create")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRoute("task-kanban", { projectId })}
          >
            {t("task.list")}
          </Button>
        </div>
      </div>

      {/* Kanban board — columns fill width equally, each scrolls vertically */}
      <DndContext collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex flex-1 min-h-0 gap-0 divide-x">
          {TASK_STATUS_LIST.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={tasks.filter((task) => task.status === status)}
              projectId={projectId}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
