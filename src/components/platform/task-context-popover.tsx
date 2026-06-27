"use client"

import { useMemo, useState } from "react"
import { ClipboardList, Plus, Search, X } from "lucide-react"
import type {
  ContextInjectPayload,
  OptionId,
  InjectOption,
} from "@/components/platform/context-inject-panel-utils"
import {
  buildInjectOptions,
  buildPayloadFromOptions,
  optionGroupLabel,
} from "@/components/platform/context-inject-panel-utils"
import type {
  ProjectInfo,
  ProjectRepoInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { listTasks } from "@/lib/platform/api"

interface TaskContextPopoverProps {
  conversationId: number | null
  /** Current active project (for repo/CLAUDE.md context). */
  project: ProjectInfo | null
  repos: ProjectRepoInfo[]
  /** Already-linked task info (null = no link). */
  linkedTaskInfo: TaskConversationInfo | null
  linkedTask: TaskInfo | null
  loading: boolean
  /** Callbacks from the host component. */
  onInject: (payload: ContextInjectPayload) => void
  onLink: (taskId: number, role: string) => Promise<void>
  onUnlink: () => Promise<void>
  /** Active project ID for task search — always uses current project. */
  activeProjectId: number | null
}

const TASK_TYPE_ROLE_MAP: Record<string, string> = {
  bug: "implementation",
  feature: "implementation",
  improvement: "implementation",
  task: "implementation",
  testing: "test",
  test: "test",
  review: "review",
  design: "analysis",
  requirement: "analysis",
}

function inferRole(taskType: string): string {
  return TASK_TYPE_ROLE_MAP[taskType] ?? "discussion"
}

export function TaskContextPopover({
  project,
  repos,
  linkedTaskInfo,
  linkedTask,
  onInject,
  onLink,
  onUnlink,
  activeProjectId,
}: TaskContextPopoverProps) {
  // ─── Mode A: Linked task + inject ───
  const linkedOptions = useMemo<InjectOption[]>(() => {
    if (!linkedTask) return []
    return buildInjectOptions(linkedTask, project, repos, [])
  }, [linkedTask, project, repos])

  const linkedDefaultIds = useMemo(
    () =>
      new Set<OptionId>(
        linkedOptions
          .filter((option) => option.defaultChecked)
          .map((option) => option.id)
      ),
    [linkedOptions]
  )
  const [linkedChecked, setLinkedChecked] =
    useState<Set<OptionId>>(linkedDefaultIds)

  // Reset checked when linked task changes
  useMemo(() => {
    setLinkedChecked(linkedDefaultIds)
  }, [linkedDefaultIds])

  function linkedToggle(id: OptionId, value: boolean) {
    setLinkedChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const linkedGrouped = useMemo(
    () =>
      linkedOptions.reduce<Record<InjectOption["group"], InjectOption[]>>(
        (acc, option) => {
          acc[option.group].push(option)
          return acc
        },
        { basic: [], project: [], repos: [], conversations: [] }
      ),
    [linkedOptions]
  )

  // ─── Mode B: Search + link ───
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<TaskInfo[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [injecting, setInjecting] = useState(false)

  const fetchSearchResults = useMemo(() => {
    return async () => {
      if (!activeProjectId) {
        setSearchResults([])
        return
      }
      setSearchLoading(true)
      try {
        const tasks = await listTasks(activeProjectId)
        setSearchResults(tasks)
      } catch {
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }
  }, [activeProjectId])

  // Load on mount and when project changes
  useMemo(() => {
    void fetchSearchResults()
  }, [fetchSearchResults])

  const filteredTasks = useMemo(() => {
    if (!searchQuery) return searchResults
    const q = searchQuery.toLowerCase()
    return searchResults.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
    )
  }, [searchResults, searchQuery])

  // ─── Handlers ───

  async function handleLink(taskId: number) {
    setLinking(true)
    try {
      const task = searchResults.find((t) => t.id === taskId)
      const role = task ? inferRole(task.taskType) : "discussion"
      await onLink(taskId, role)
    } finally {
      setLinking(false)
    }
  }

  async function handleUnlink() {
    setUnlinking(true)
    try {
      await onUnlink()
    } finally {
      setUnlinking(false)
    }
  }

  async function handleInject() {
    if (!linkedTask) return
    setInjecting(true)
    try {
      const payload = buildPayloadFromOptions(linkedOptions, linkedChecked)
      onInject(payload)
    } finally {
      setInjecting(false)
    }
  }

  // ─── Render ───

  if (linkedTask && linkedTaskInfo) {
    // Mode A: Already linked
    return (
      <div className="flex flex-col gap-3 p-2">
        {/* Task summary */}
        <div className="rounded-md border bg-muted/30 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                📌 {linkedTask.title}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {linkedTask.taskType} / {linkedTask.status}
              </div>
            </div>
            {linkedTask.priority && (
              <Badge variant="outline" className="shrink-0 text-[0.625rem]">
                {linkedTask.priority}
              </Badge>
            )}
          </div>
        </div>

        {/* Inject checkboxes */}
        {(["basic", "project", "repos"] as const).map((group) => {
          const items = linkedGrouped[group]
          if (items.length === 0) return null
          return (
            <section key={group} className="space-y-1.5">
              <h3 className="text-[0.6875rem] font-medium uppercase text-muted-foreground">
                {optionGroupLabel(group)}
              </h3>
              <div className="space-y-1">
                {items.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md border p-2",
                      "hover:bg-accent/50 text-[0.8125rem]"
                    )}
                  >
                    <Checkbox
                      checked={linkedChecked.has(option.id)}
                      onCheckedChange={(value) =>
                        linkedToggle(option.id, value === true)
                      }
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {option.label}
                      </span>
                      <span className="block text-[0.6875rem] text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )
        })}

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleInject}
            disabled={injecting || linkedChecked.size === 0}
            className="flex-1"
          >
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            {injecting ? "Injecting…" : "Inject context"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUnlink}
            disabled={unlinking}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Unlink
          </Button>
        </div>
      </div>
    )
  }

  // Mode B: Not linked — search and link (always within active project)
  return (
    <div className="flex flex-col gap-3 p-2">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-7 pl-7 text-xs"
          placeholder="Search tasks…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Task list */}
      <ScrollArea className="max-h-[200px]">
        {searchLoading ? (
          <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
            Loading…
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
            No tasks found
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {filteredTasks.map((task) => (
              <button
                key={task.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border p-2 text-left",
                  "hover:bg-accent/50 cursor-pointer"
                )}
                onClick={() => handleLink(task.id)}
                disabled={linking}
              >
                <Badge variant="outline" className="shrink-0 text-[0.625rem]">
                  {task.taskType}
                </Badge>
                <span className="min-w-0 truncate text-xs font-medium">
                  {task.title}
                </span>
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                  {task.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Create new task */}
      <Button variant="outline" size="sm" className="w-full" disabled>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Create new task
      </Button>
    </div>
  )
}
