"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { DndContext, closestCorners, type DragEndEvent } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { Plus } from "lucide-react"
import { listTasks, updateTaskStatus, createTask } from "@/lib/platform/api"
import type { TaskInfo, TaskStatus } from "@/lib/platform/types"
import {
  TASK_STATUS_LIST,
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

function TaskCard({ task }: { task: TaskInfo }) {
  const router = useRouter()
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
      {...attributes}
      {...listeners}
      className={cn(
        "cursor-pointer transition-colors hover:bg-accent",
        "touch-none select-none"
      )}
      onClick={() => router.push(`/platform?view=task-detail&id=${task.id}`)}
    >
      <CardContent className="p-2.5">
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "h-5 shrink-0 px-1.5 text-[0.625rem]",
              TASK_STATUS_COLORS[task.status as TaskStatus] ??
                TASK_STATUS_COLORS.backlog
            )}
          >
            {TASK_STATUS_LABELS[task.status as TaskStatus] ?? task.status}
          </Badge>
          <span className="truncate text-[0.8125rem]">{task.title}</span>
        </div>
        <div className="mt-1 flex items-center gap-1 text-[0.625rem] text-muted-foreground">
          <Badge variant="outline" className="text-[0.625rem]">
            {task.taskType}
          </Badge>
          {task.priority && (
            <Badge variant="outline" className="text-[0.625rem]">
              {task.priority}
            </Badge>
          )}
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
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const handleCreateTask = useCallback(async () => {
    setCreating(true)
    try {
      const task = await createTask({
        projectId,
        title: "New task",
        taskType: "bug",
      })
      // Set initial status to the column's status
      if (status !== "backlog") {
        await updateTaskStatus(task.id, status)
      }
      router.push(`/platform?view=task-detail&id=${task.id}`)
    } catch (e) {
      console.error("Create task failed:", e)
    }
    setCreating(false)
  }, [projectId, status, router])

  const sortableIds = tasks.map((t) => `task-${t.id}`)

  return (
    <div className="flex flex-col gap-2 min-w-[200px]">
      <div className="flex items-center justify-between px-1">
        <Badge
          variant="outline"
          className={cn("px-2 text-[0.75rem]", TASK_STATUS_COLORS[status])}
        >
          {TASK_STATUS_LABELS[status]}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          disabled={creating}
          onClick={handleCreateTask}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <SortableContext
          items={sortableIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-1.5 px-1">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
            {tasks.length === 0 && (
              <div className="py-4 text-center text-[0.75rem] text-muted-foreground">
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
  const router = useRouter()
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

      // Parse task ID from sortable ID "task-{id}"
      const taskId = Number(String(active.id).replace("task-", ""))
      // The over.id could be another task card or a column
      // For simplicity, we use the over container's status
      // Find the new status from the column the task was dropped into
      const overId = String(over.id)

      // Determine the target status
      let newStatus: string | null = null
      // If over is a task card, use that task's status
      if (overId.startsWith("task-")) {
        const overTask = tasks.find(
          (t) => t.id === Number(overId.replace("task-", ""))
        )
        if (overTask) newStatus = overTask.status
      } else {
        // over.id might be a column status directly
        newStatus = overId
      }

      if (!newStatus) return

      // Optimistic update
      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId ? { ...task, status: newStatus } : task
        )
      )

      try {
        await updateTaskStatus(taskId, newStatus)
      } catch {
        // Revert on failure
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("task.kanban")}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              router.push(`/platform?view=task-list&projectId=${projectId}`)
            }
          >
            {t("task.list")}
          </Button>
        </div>
      </div>

      <DndContext collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex gap-2 overflow-x-auto pb-2">
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
