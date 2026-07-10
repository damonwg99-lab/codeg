"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Plus, GripVertical, Trash2, Search } from "lucide-react"
import {
  DndContext,
  closestCorners,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { listTasks, updateTaskStatus, deleteTask } from "@/lib/platform/api"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import type { TaskInfo, TaskPriority, TaskStatus } from "@/lib/platform/types"
import {
  TASK_STATUS_LIST,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_COLORS,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

// ── Relative date helper ──

function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
}

// ── Label resolvers ──

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

// ── TaskCard ──

function TaskCard({
  task,
  projectId,
  onDelete,
}: {
  task: TaskInfo
  projectId: number
  onDelete: (taskId: number) => Promise<void>
}) {
  const { setRoute } = useWorkbenchRoute()
  const t = useTranslations("Platform")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
        zIndex: isDragging ? 50 : undefined,
      }
    : { transition, opacity: isDragging ? 0.5 : 1 }

  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await onDelete(task.id)
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
    }
  }, [onDelete, task.id])

  const relativeDate = useMemo(
    () => formatRelativeDate(task.createdAt),
    [task.createdAt]
  )

  return (
    <>
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
          {/* Clickable content area */}
          <div className="flex flex-col gap-0.5 py-2 pr-2.5 min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="truncate text-[0.8125rem] font-medium min-w-0">
                {task.title}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive ml-auto"
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleteDialogOpen(true)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
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
              <span className="ml-auto">{relativeDate}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>{t("task.deleteTask" as never)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("task.deleteTaskConfirm" as never)}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("project.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={handleDelete}>
              {deleting
                ? t("task.deleteTask" as never) + "…"
                : t("task.deleteTask" as never)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ── KanbanColumn ──

function KanbanColumn({
  status,
  tasks,
  projectId,
  onDeleteTask,
}: {
  status: TaskStatus
  tasks: TaskInfo[]
  projectId: number
  onDeleteTask: (taskId: number) => Promise<void>
}) {
  const t = useTranslations("Platform")
  const taskCount = tasks.length
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ id: status })

  const sortableIds = tasks.map((task) => `task-${task.id}`)

  return (
    <div
      ref={setDroppableRef}
      className={cn(
        "flex flex-col flex-1 min-w-0 transition-colors",
        isOver && "bg-accent/30"
      )}
    >
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
              <TaskCard
                key={task.id}
                task={task}
                projectId={projectId}
                onDelete={onDeleteTask}
              />
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

// ── Main kanban board ──

export function TaskKanban({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  const { setRoute } = useWorkbenchRoute()
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [loading, setLoading] = useState(true)

  const [searchInput, setSearchInput] = useState("")
  const [searchKeyword, setSearchKeyword] = useState("")
  const [filterType, setFilterType] = useState<string>("all")
  const [filterPriority, setFilterPriority] = useState<string>("all")

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listTasks(
          projectId,
          searchKeyword || undefined,
          filterType !== "all" ? filterType : undefined,
          filterPriority !== "all" ? filterPriority : undefined
        )
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
  }, [projectId, searchKeyword, filterType, filterPriority])

  const handleDeleteTask = useCallback(
    async (taskId: number) => {
      try {
        await deleteTask(taskId)
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        toast.success(t("task.taskDeleted" as never))
      } catch {
        toast.error(t("task.deleteTaskFailed" as never))
      }
    },
    [t]
  )

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
        const list = await listTasks(
          projectId,
          searchKeyword || undefined,
          filterType !== "all" ? filterType : undefined,
          filterPriority !== "all" ? filterPriority : undefined
        )
        setTasks(list)
      }
    },
    [tasks, projectId, searchKeyword, filterType, filterPriority]
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
      <div className="flex items-center justify-between px-4 py-3 shrink-0 border-b gap-3">
        <h2 className="text-lg font-semibold shrink-0">{t("task.kanban")}</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("task.searchPlaceholder" as never)}
              value={searchInput}
              onChange={(e) => {
                const val = e.target.value
                setSearchInput(val)
                if (debounceRef.current) clearTimeout(debounceRef.current)
                debounceRef.current = setTimeout(() => {
                  setSearchKeyword(val)
                }, 300)
              }}
              className="h-8 w-[180px] pl-7 text-[0.8125rem]"
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger size="sm" className="w-[110px] text-[0.8125rem]">
              <SelectValue placeholder={t("task.taskType" as never)} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("task.taskType" as never)}</SelectItem>
              <SelectItem value="bug">{t("task.taskTypeOptions.bug" as never)}</SelectItem>
              <SelectItem value="feature">{t("task.taskTypeOptions.feature" as never)}</SelectItem>
              <SelectItem value="task">{t("task.taskTypeOptions.task" as never)}</SelectItem>
              <SelectItem value="improvement">{t("task.taskTypeOptions.improvement" as never)}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger size="sm" className="w-[110px] text-[0.8125rem]">
              <SelectValue placeholder={t("task.priority" as never)} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("task.priority" as never)}</SelectItem>
              <SelectItem value="low">{t("task.priorityOptions.low" as never)}</SelectItem>
              <SelectItem value="medium">{t("task.priorityOptions.medium" as never)}</SelectItem>
              <SelectItem value="high">{t("task.priorityOptions.high" as never)}</SelectItem>
              <SelectItem value="urgent">{t("task.priorityOptions.urgent" as never)}</SelectItem>
            </SelectContent>
          </Select>
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
              onDeleteTask={handleDeleteTask}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
