"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ClipboardList } from "lucide-react"
import { cn } from "@/lib/utils"
import { searchTasks } from "@/lib/platform/api"
import {
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  type TaskInfo,
} from "@/lib/platform/types"
import type {
  TaskSuggestionController,
  TaskSuggestionRenderState,
} from "./task-suggestion"

/** Imperative keyboard handler exposed by the popup for the controller. */
export interface TaskSuggestionPopupHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface TaskSuggestionPopupProps {
  controller: TaskSuggestionController
  activeProjectId: number | null
  onSelect: (task: TaskInfo) => void
}

export function TaskSuggestionPopup({
  controller,
  activeProjectId,
  onSelect,
}: TaskSuggestionPopupProps) {
  const [state, setState] = useState<TaskSuggestionRenderState | null>(null)
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Live refs for values needed in the synchronous onKeyDown handler
  const tasksRef = useRef<TaskInfo[]>([])
  const selectedIndexRef = useRef(0)
  const onSelectRef = useRef(onSelect)

  // Keep refs in sync so the imperative onKeyDown reads live values
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])
  useEffect(() => {
    selectedIndexRef.current = selectedIndex
  }, [selectedIndex])
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Imperative keyboard handler — called synchronously from the TipTap plugin
  // event, NOT from a React effect, so setState is safe here.
  const handleKeyDown = (event: KeyboardEvent): boolean => {
    const currentTasks = tasksRef.current
    const currentIdx = selectedIndexRef.current
    if (!state || currentTasks.length === 0) return false
    if (event.key === "ArrowDown") {
      setSelectedIndex(Math.min(currentIdx + 1, currentTasks.length - 1))
      return true
    }
    if (event.key === "ArrowUp") {
      setSelectedIndex(Math.max(currentIdx - 1, 0))
      return true
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (currentTasks[currentIdx])
        onSelectRef.current(currentTasks[currentIdx])
      return true
    }
    if (event.key === "Escape") {
      setState(null)
      setTasks([])
      abortRef.current?.abort()
      return true
    }
    return false
  }

  // Stable controller wired once (refs/setState are stable), matching the
  // MentionSuggestion pattern. The onKeyDown handler is called synchronously
  // from the TipTap suggestion plugin (not from a React effect).
  const wiredController = useMemo<TaskSuggestionController>(
    () => ({
      onStart: (s) => {
        setState(s)
        setSelectedIndex(0)
      },
      onUpdate: (s) => {
        setState(s)
        setSelectedIndex(0)
      },
      onExit: () => {
        setState(null)
        setTasks([])
        abortRef.current?.abort()
      },
      onKeyDown: (event) => handleKeyDown(event),
    }),
    // handleKeyDown is defined in the render body and reads from refs that
    // stay current via effects, so this is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Wire the controller onto the passed-in object so TipTap reads it
  useEffect(() => {
    Object.assign(controller, wiredController)
  }, [controller, wiredController])

  // Search tasks when query changes
  useEffect(() => {
    if (!state || !activeProjectId) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    searchTasks({ projectId: activeProjectId, query: state.query })
      .then((results) => {
        if (!ac.signal.aborted) {
          setTasks(results)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setTasks([])
          setLoading(false)
        }
      })
  }, [state, activeProjectId])

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (!state) return null

  const rect = state.getClientRect?.()
  if (!rect) return null

  return (
    <div
      className="absolute z-50 w-64 max-h-48 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg"
      style={{ top: rect.top - 4, left: rect.left }}
    >
      {loading && (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          Searching tasks...
        </div>
      )}
      {!loading && tasks.length === 0 && (
        <div className="px-3 py-2 text-sm text-muted-foreground">
          No tasks found
        </div>
      )}
      {!loading && tasks.length > 0 && (
        <div ref={listRef}>
          {tasks.map((task, i) => (
            <button
              key={task.id}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm",
                i === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(task)
              }}
            >
              <ClipboardList className="size-3.5 shrink-0" />
              <span className="truncate flex-1">{task.title}</span>
              <span
                className={cn(
                  "text-xs px-1.5 py-0.5 rounded",
                  TASK_STATUS_COLORS[
                    task.status as keyof typeof TASK_STATUS_COLORS
                  ]
                )}
              >
                {
                  TASK_STATUS_LABELS[
                    task.status as keyof typeof TASK_STATUS_LABELS
                  ]
                }
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
