"use client"

import { memo, useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ListChecks,
  ChevronDown,
  ChevronUp,
  PencilLine,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import type { ProposedSubTask } from "@/lib/platform/decomposition-parser"
import { proposalKey } from "@/hooks/use-decomposition-detector"
import {
  useDecompositionOverlayContext,
  type DecompositionOverlayStatus,
} from "@/components/chat/decomposition-overlay-context"
import { cn } from "@/lib/utils"

// ── Task type badge color helper ──

function getTypeBadgeClass(taskType: string): string {
  switch (taskType) {
    case "bug":
      return "text-red-700 bg-red-500/10 border-red-500/20 dark:text-red-300"
    case "feature":
      return "text-green-700 bg-green-500/10 border-green-500/20 dark:text-green-300"
    case "improvement":
      return "text-blue-700 bg-blue-500/10 border-blue-500/20 dark:text-blue-300"
    default:
      // "task" and unknown
      return "text-slate-700 bg-slate-500/10 border-slate-500/20 dark:text-slate-300"
  }
}

function getPriorityBadgeClass(priority: string): string {
  switch (priority) {
    case "urgent":
      return "text-red-700 bg-red-500/10 border-red-500/20 dark:text-red-300"
    case "high":
      return "text-amber-700 bg-amber-500/10 border-amber-500/20 dark:text-amber-300"
    case "medium":
      return "text-slate-700 bg-slate-500/10 border-slate-500/20 dark:text-slate-300"
    case "low":
      return "text-muted-foreground bg-muted/30 border-border/50"
    default:
      return "text-muted-foreground"
  }
}

// ── Single task entry row ──

function TaskEntry({
  task,
  typeLabel,
  priorityLabel,
}: {
  task: ProposedSubTask
  typeLabel: string
  priorityLabel: string
}) {
  const [expanded, setExpanded] = useState(false)
  const hasDescription = task.description.trim().length > 0

  return (
    <div className="flex items-start gap-2 px-1 py-1 text-sm">
      <Badge
        variant="outline"
        className={cn(
          "h-5 shrink-0 text-[10px] uppercase",
          getTypeBadgeClass(task.taskType)
        )}
      >
        {typeLabel}
      </Badge>
      <div className="min-w-0 flex-1">
        <span className="font-medium leading-5 break-words [overflow-wrap:anywhere]">
          {task.title}
        </span>
        {hasDescription && (
          <button
            type="button"
            className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </button>
        )}
        {hasDescription && expanded && (
          <p className="mt-0.5 text-xs text-muted-foreground leading-4 break-words [overflow-wrap:anywhere]">
            {task.description}
          </p>
        )}
      </div>
      <Badge
        variant="outline"
        className={cn(
          "h-5 shrink-0 text-[10px] uppercase",
          getPriorityBadgeClass(task.priority)
        )}
      >
        {priorityLabel}
      </Badge>
    </div>
  )
}

// ── Status action slot ──

function OverlayStatusSlot({
  status,
  onOpenOverlay,
  reopenLabel,
  createdLabel,
}: {
  status: DecompositionOverlayStatus
  onOpenOverlay: () => void
  reopenLabel: string
  createdLabel: string
}) {
  if (status === "dismissed") {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-6 text-[10px] gap-1 shrink-0"
        onClick={onOpenOverlay}
      >
        <PencilLine className="size-3" />
        {reopenLabel}
      </Button>
    )
  }

  if (status === "confirmed") {
    return (
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5",
          "text-[10px] font-medium text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
          "dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors",
          "cursor-pointer"
        )}
        onClick={onOpenOverlay}
      >
        <CheckCircle2 className="size-3" />
        {createdLabel}
      </button>
    )
  }

  // "open" or "none" — no action needed
  return null
}

// ── Main card ──

export const DecompositionCard = memo(function DecompositionCard({
  tasks,
  isStreaming = false,
}: {
  tasks: ProposedSubTask[]
  isStreaming?: boolean
}) {
  const t = useTranslations("Platform.task")
  const overlayCtx = useDecompositionOverlayContext()

  // Resolve labels (hooks must be called before any early return)
  const resolveTypeLabel = useCallback(
    (key: string) => {
      const map: Record<string, string> = {
        bug: t("taskTypeOptions.bug"),
        feature: t("taskTypeOptions.feature"),
        task: t("taskTypeOptions.task"),
        improvement: t("taskTypeOptions.improvement"),
      }
      return map[key] ?? key
    },
    [t]
  )

  const resolvePriorityLabel = useCallback(
    (key: string) => {
      const map: Record<string, string> = {
        low: t("priorityOptions.low"),
        medium: t("priorityOptions.medium"),
        high: t("priorityOptions.high"),
        urgent: t("priorityOptions.urgent"),
      }
      return map[key] ?? key
    },
    [t]
  )

  // When streaming, always show the placeholder card even with empty tasks.
  // For completed decompositions, skip rendering if there are no tasks.
  if (!isStreaming && tasks.length === 0) return null

  // Determine if this card corresponds to the *latest* decomposition
  // by comparing its proposalKey with the context's currentProposalKey.
  const cardKey = proposalKey(tasks)
  const isLatest =
    cardKey !== null && cardKey === overlayCtx?.currentProposalKey

  // Only show overlay status/action for the latest decomposition
  const effectiveStatus: DecompositionOverlayStatus = isLatest
    ? (overlayCtx?.overlayStatus ?? "none")
    : "none"

  const statusSlot =
    effectiveStatus !== "none" && effectiveStatus !== "open" && overlayCtx ? (
      <OverlayStatusSlot
        status={effectiveStatus}
        onOpenOverlay={overlayCtx.onOpenOverlay}
        reopenLabel={t("decompositionReopenOverlay")}
        createdLabel={t("decompositionStatusCreated", {
          count: overlayCtx.confirmedCount,
        })}
      />
    ) : null

  return (
    <div className="overflow-hidden rounded-lg border bg-card/50">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <ListChecks className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("decompositionCardTitle")}
        </span>
        {isStreaming ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Badge variant="secondary" className="h-5 shrink-0">
            {t("decompositionSubTaskCount", { count: tasks.length })}
          </Badge>
        )}
        {!isStreaming && statusSlot}
      </div>
      {isStreaming ? (
        <div className="px-3 py-3 text-sm text-muted-foreground animate-pulse">
          {t("decompositionStreaming")}
        </div>
      ) : (
        <ScrollArea className="max-h-72 px-2 py-2">
          <div className="space-y-1">
            {tasks.map((task, index) => (
              <TaskEntry
                key={`${task.title}-${index}`}
                task={task}
                typeLabel={resolveTypeLabel(task.taskType)}
                priorityLabel={resolvePriorityLabel(task.priority)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
})
