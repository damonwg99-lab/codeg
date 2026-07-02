"use client"

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { Plus, Trash2, ListChecks, Loader2 } from "lucide-react"
import { CollapsedOverlayChip } from "@/components/chat/collapsed-overlay-chip"
import { Button } from "@/components/ui/button"
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
  proposedSubTasks: ProposedSubTask[]
  linkedTask: TaskInfo | null
  projects: ProjectInfo[]
  activeProjectId: number | null
  onUpdateSubTasks: (subTasks: ProposedSubTask[]) => void
  onConfirm: (params: ConfirmParams) => void
  onDismiss: () => void
}

const TASK_TYPE_OPTIONS = ["task", "feature", "bug", "improvement"] as const
const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const

export function DecompositionOverlay({
  proposedSubTasks,
  linkedTask,
  projects,
  activeProjectId,
  onUpdateSubTasks,
  onConfirm,
  onDismiss,
}: DecompositionOverlayProps) {
  const t = useTranslations("Platform.task")
  const [isExpanded, setIsExpanded] = useState(true)
  const [selectedProjectId, setSelectedProjectId] = useState<number>(
    activeProjectId ?? projects[0]?.id ?? 0
  )
  const [creating, setCreating] = useState(false)

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
    if (creating) return
    // Filter out entries with empty titles
    const validSubTasks = proposedSubTasks.filter(
      (entry) => entry.title.trim() !== ""
    )
    if (validSubTasks.length === 0) return
    setCreating(true)
    onConfirm({
      projectId: selectedProjectId,
      parentTaskId: linkedTask?.id ?? null,
      subTasks: validSubTasks,
    })
  }, [creating, proposedSubTasks, selectedProjectId, linkedTask, onConfirm])

  if (proposedSubTasks.length === 0) return null

  if (!isExpanded) {
    return (
      <CollapsedOverlayChip
        icon={<ListChecks className="size-3" />}
        summary={t("proposedTasks", { count: proposedSubTasks.length })}
        onClick={() => setIsExpanded(true)}
      />
    )
  }

  // Determine the parent task display name
  const parentTaskLabel = linkedTask
    ? t("createAsSubTasksOf", { taskName: linkedTask.title })
    : null

  return (
    <div
      className={cn(
        "pointer-events-auto w-[min(22rem,calc(100%-2rem))]",
        "rounded-lg border bg-card shadow-lg",
        "flex flex-col max-h-[calc(100dvh-8rem)]"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <ListChecks className="size-3.5" />
          {t("reviewDecomposition")}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setIsExpanded(false)}
        >
          <span className="text-xs">✕</span>
        </Button>
      </div>

      {/* Project & Parent Task */}
      <div className="px-3 py-2 border-b space-y-2">
        {/* Project selector (only when no linked task) */}
        {!linkedTask && projects.length > 0 && (
          <div className="flex items-center gap-2">
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

        {/* Parent task indicator */}
        {parentTaskLabel && (
          <p className="text-xs text-muted-foreground">{parentTaskLabel}</p>
        )}
      </div>

      {/* Sub-task list — scrollable */}
      <div className="overflow-y-auto min-h-0 flex-1 px-3 py-2 space-y-3">
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
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => removeEntry(index)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>

            {/* Description */}
            <Input
              value={entry.description}
              onChange={(e) =>
                updateEntry(index, "description", e.target.value)
              }
              className="h-7 text-xs"
              placeholder={t("taskDescription")}
            />

            {/* Type + Priority */}
            <div className="flex items-center gap-2">
              <Select
                value={entry.taskType}
                onValueChange={(v) => updateEntry(index, "taskType", v)}
              >
                <SelectTrigger className="h-7 text-xs w-[90px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPE_OPTIONS.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={entry.priority}
                onValueChange={(v) => updateEntry(index, "priority", v)}
              >
                <SelectTrigger className="h-7 text-xs w-[90px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      <span
                        className={cn(
                          TASK_PRIORITY_COLORS[p as TaskPriority] ?? ""
                        )}
                      >
                        {p}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}

        {/* Add sub-task button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs w-full"
          onClick={addEntry}
        >
          <Plus className="size-3 mr-1" />
          {t("addTask")}
        </Button>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-3 py-2 border-t shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onDismiss}
          disabled={creating}
        >
          {t("continueDiscussion")}
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={handleConfirm}
          disabled={creating || proposedSubTasks.every((e) => !e.title.trim())}
        >
          {creating && <Loader2 className="size-3 mr-1 animate-spin" />}
          {t("confirmCreate")}
        </Button>
      </div>
    </div>
  )
}
