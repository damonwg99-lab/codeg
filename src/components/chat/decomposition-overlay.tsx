"use client"

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { Plus, Trash2, ListChecks, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import type { TaskInfo, ProjectInfo, TaskPriority } from "@/lib/platform/types"
import type { ProposedSubTask } from "@/lib/platform/decomposition-parser"
import { TASK_PRIORITY_COLORS } from "@/lib/platform/types"
import { cn } from "@/lib/utils"

interface ConfirmParams {
  projectId: number
  parentTaskId: number | null
  subTasks: ProposedSubTask[]
}

interface DecompositionOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  proposedSubTasks: ProposedSubTask[]
  linkedTask: TaskInfo | null
  projects: ProjectInfo[]
  activeProjectId: number | null
  submitting?: boolean
  /** Read-only mode: tasks were already created. Hide action buttons and
   *  disable editing inputs. */
  readOnly?: boolean
  onUpdateSubTasks: (subTasks: ProposedSubTask[]) => void
  onConfirm: (params: ConfirmParams) => void
}

const TASK_TYPE_KEYS = ["bug", "feature", "task", "improvement"] as const
const PRIORITY_KEYS = ["low", "medium", "high", "urgent"] as const

export function DecompositionOverlay({
  open,
  onOpenChange,
  proposedSubTasks,
  linkedTask,
  projects,
  activeProjectId,
  submitting = false,
  readOnly = false,
  onUpdateSubTasks,
  onConfirm,
}: DecompositionOverlayProps) {
  const t = useTranslations("Platform.task")
  const [selectedProjectId, setSelectedProjectId] = useState<number>(
    activeProjectId ?? projects[0]?.id ?? 0
  )

  const resolveTypeLabel = (key: string) => {
    const map: Record<string, string> = {
      bug: t("taskTypeOptions.bug"),
      feature: t("taskTypeOptions.feature"),
      task: t("taskTypeOptions.task"),
      improvement: t("taskTypeOptions.improvement"),
    }
    return map[key] ?? key
  }

  const resolvePriorityLabel = (key: string) => {
    const map: Record<string, string> = {
      low: t("priorityOptions.low"),
      medium: t("priorityOptions.medium"),
      high: t("priorityOptions.high"),
      urgent: t("priorityOptions.urgent"),
    }
    return map[key] ?? key
  }

  const updateEntry = useCallback(
    (index: number, field: keyof ProposedSubTask, value: string) => {
      const updated = proposedSubTasks.map((entry, i) =>
        i === index ? { ...entry, [field]: value } : entry
      )
      onUpdateSubTasks(updated)
    },
    [proposedSubTasks, onUpdateSubTasks]
  )

  const removeEntry = useCallback(
    (index: number) => {
      const updated = proposedSubTasks.filter((_, i) => i !== index)
      onUpdateSubTasks(updated)
    },
    [proposedSubTasks, onUpdateSubTasks]
  )

  const addEntry = useCallback(() => {
    onUpdateSubTasks([
      ...proposedSubTasks,
      { title: "", description: "", taskType: "task", priority: "medium" },
    ])
  }, [proposedSubTasks, onUpdateSubTasks])

  const handleConfirm = useCallback(() => {
    if (submitting) return
    const validSubTasks = proposedSubTasks.filter(
      (entry) => entry.title.trim() !== ""
    )
    if (validSubTasks.length === 0) return
    onConfirm({
      projectId: selectedProjectId,
      parentTaskId: linkedTask?.id ?? null,
      subTasks: validSubTasks,
    })
  }, [submitting, proposedSubTasks, selectedProjectId, linkedTask, onConfirm])

  // Determine parent task label
  const parentTaskLabel = linkedTask
    ? t("createAsSubTasksOf", { taskName: linkedTask.title })
    : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-lg grid grid-rows-[auto_1fr_auto] max-h-[calc(100dvh-2rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ListChecks className="h-4 w-4" />
            {t("reviewDecomposition")}
          </DialogTitle>
          <DialogDescription>
            {parentTaskLabel ?? t("selectProject")}
          </DialogDescription>
        </DialogHeader>

        {/* Project selector (only when no linked task) */}
        {!linkedTask && projects.length > 0 && (
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="text-xs text-muted-foreground shrink-0">
              {t("selectProject")}:
            </span>
            <Select
              value={String(selectedProjectId)}
              onValueChange={(v) => setSelectedProjectId(Number(v))}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Sub-task list — scrollable */}
        <div className="overflow-y-auto min-h-0 py-2 space-y-3">
          {proposedSubTasks.map((entry, index) => (
            <div
              key={index}
              className="flex flex-col gap-1.5 rounded-md border p-2"
            >
              {/* Title row */}
              <div className="flex items-center gap-1.5">
                <Input
                  value={entry.title}
                  onChange={(e) => updateEntry(index, "title", e.target.value)}
                  className="h-7 text-xs"
                  placeholder={t("taskTitle")}
                  disabled={readOnly}
                />
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeEntry(index)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                )}
              </div>

              {/* Description */}
              <Input
                value={entry.description}
                onChange={(e) =>
                  updateEntry(index, "description", e.target.value)
                }
                className="h-7 text-xs"
                placeholder={t("taskDescription")}
                disabled={readOnly}
              />

              {/* Type + Priority */}
              <div className="flex items-center gap-2">
                <Select
                  value={entry.taskType}
                  onValueChange={(v) => updateEntry(index, "taskType", v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-7 text-xs w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPE_KEYS.map((type) => (
                      <SelectItem key={type} value={type}>
                        {resolveTypeLabel(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={entry.priority}
                  onValueChange={(v) => updateEntry(index, "priority", v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-7 text-xs w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_KEYS.map((p) => (
                      <SelectItem key={p} value={p}>
                        <span
                          className={cn(
                            TASK_PRIORITY_COLORS[p as TaskPriority] ?? ""
                          )}
                        >
                          {resolvePriorityLabel(p)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}

          {/* Add sub-task button (hidden in read-only mode) */}
          {!readOnly && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs w-full"
              onClick={addEntry}
            >
              <Plus className="size-3 mr-1" />
              {t("addTask")}
            </Button>
          )}
        </div>

        {/* Action buttons — hidden in read-only mode */}
        {!readOnly && (
          <DialogFooter className="mt-4 shrink-0">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t("continueDiscussion")}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={
                submitting || proposedSubTasks.every((e) => !e.title.trim())
              }
            >
              {submitting && (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              )}
              {t("confirmCreate")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
