"use client"

import { useMemo, useState } from "react"
import { ClipboardList, Link, Search, X } from "lucide-react"
import { useTranslations } from "next-intl"
import type {
  ContextInjectPayload,
  OptionId,
  InjectOption,
  InjectOptionGroup,
} from "@/components/platform/context-inject-panel-utils"
import {
  buildInjectOptions,
  buildProjectOptions,
  buildPayloadFromOptions,
  resolveTaskTypeLabel,
  type InjectI18nFn,
} from "@/components/platform/context-inject-panel-utils"
import type {
  KnowledgeDocInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"
import type { PendingTaskLink } from "@/contexts/tab-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { listTasks } from "@/lib/platform/api"
import { InjectOptionList } from "@/components/platform/inject-option-list"

interface ProjectResourcePickerProps {
  conversationId: number | null
  /** Already-linked task info (null = no link). */
  linkedTaskInfo: TaskConversationInfo | null
  linkedTask: TaskInfo | null
  /** Callbacks from the host component. */
  onInject: (payload: ContextInjectPayload) => void
  onLink: (
    taskId: number,
    role: string,
    taskInfo?: { title: string; taskType: string }
  ) => Promise<void>
  onUnlink: () => Promise<void>
  /** Active project ID for task search. */
  activeProjectId: number | null
  /** KB data — loaded lazily by the host when popover opens. */
  kbDocs: KnowledgeDocInfo[]
  attachments: KnowledgeDocInfo[]
  /** Linked conversations for the current task. */
  linkedConversations?: TaskConversationInfo[]
  /** Whether KB data is still loading. */
  kbLoading?: boolean
  /** KB directory path relative to the project root (e.g., "_knowledge").
   *  Used to prefix doc filePaths so they become project-root-relative. */
  kbDirPrefix?: string
  /** Pending task link (for new conversations without a DB ID yet). */
  pendingTask?: PendingTaskLink | null
  /** Clear the pending task link intent. */
  onClearPendingLink?: () => void
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

/** Visible groups for Mode A (linked task inject). Attachments placed
 *  immediately after task info (basic) rather than after KB docs. */
const VISIBLE_GROUPS_A: InjectOptionGroup[] = [
  "basic",
  "attachments",
  "conversations",
  "kb_docs",
]

/** Visible groups for Mode B/C (no linked task). Attachments before KB docs. */
const VISIBLE_GROUPS_BC: InjectOptionGroup[] = ["attachments", "kb_docs"]

function inferRole(taskType: string): string {
  return TASK_TYPE_ROLE_MAP[taskType] ?? "discussion"
}

export function ProjectResourcePicker({
  linkedTaskInfo,
  linkedTask,
  onInject,
  onLink,
  onUnlink,
  activeProjectId,
  kbDocs,
  attachments,
  linkedConversations,
  kbLoading,
  kbDirPrefix,
  pendingTask,
  onClearPendingLink,
}: ProjectResourcePickerProps) {
  const t = useTranslations("Platform.inject")

  // ─── Mode A: Linked task + inject ───
  const linkedOptions = useMemo<InjectOption[]>(() => {
    if (!linkedTask) return []
    return buildInjectOptions(
      linkedTask,
      kbDocs,
      attachments,
      linkedConversations ?? [],
      t as InjectI18nFn,
      kbDirPrefix
    )
  }, [linkedTask, kbDocs, attachments, linkedConversations, t, kbDirPrefix])

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

  const [kbDocSearchQuery, setKbDocSearchQuery] = useState("")

  // Filter kb_docs by search query
  const filteredLinkedOptions = useMemo(() => {
    if (!kbDocSearchQuery) return linkedOptions
    const q = kbDocSearchQuery.toLowerCase()
    return linkedOptions.filter(
      (opt) =>
        opt.group !== "kb_docs" ||
        opt.label.toLowerCase().includes(q) ||
        opt.description.toLowerCase().includes(q)
    )
  }, [kbDocSearchQuery, linkedOptions])

  const groupLabelResolver = (group: InjectOptionGroup) =>
    t(`groupLabel.${group}`)

  // ─── Mode B/C: Project resources (no linked task) ───
  const projectOptions = useMemo<InjectOption[]>(
    () =>
      buildProjectOptions(
        kbDocs,
        attachments,
        [],
        t as InjectI18nFn,
        kbDirPrefix
      ),
    [kbDocs, attachments, t, kbDirPrefix]
  )

  const projectDefaultIds = useMemo(
    () =>
      new Set<OptionId>(
        projectOptions
          .filter((option) => option.defaultChecked)
          .map((option) => option.id)
      ),
    [projectOptions]
  )
  const [projectChecked, setProjectChecked] =
    useState<Set<OptionId>>(projectDefaultIds)

  useMemo(() => {
    setProjectChecked(projectDefaultIds)
  }, [projectDefaultIds])

  function projectToggle(id: OptionId, value: boolean) {
    setProjectChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const [projectKbDocSearchQuery, setProjectKbDocSearchQuery] = useState("")

  const filteredProjectOptions = useMemo(() => {
    if (!projectKbDocSearchQuery) return projectOptions
    const q = projectKbDocSearchQuery.toLowerCase()
    return projectOptions.filter(
      (opt) =>
        opt.group !== "kb_docs" ||
        opt.label.toLowerCase().includes(q) ||
        opt.description.toLowerCase().includes(q)
    )
  }, [projectKbDocSearchQuery, projectOptions])

  // ─── Task search (for linking) ───
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<TaskInfo[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [linking, setLinking] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [injecting, setInjecting] = useState(false)
  const [showTaskSearch, setShowTaskSearch] = useState(false)

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
      await onLink(
        taskId,
        role,
        task ? { title: task.title, taskType: task.taskType } : undefined
      )
      setShowTaskSearch(false)
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

  async function handleProjectInject() {
    setInjecting(true)
    try {
      const payload = buildPayloadFromOptions(projectOptions, projectChecked)
      onInject(payload)
    } finally {
      setInjecting(false)
    }
  }

  // ─── Render ───

  if (linkedTask && linkedTaskInfo) {
    // Mode A: Already linked — show task summary + KB files
    return (
      <ScrollArea className="max-h-[480px]">
        <div className="flex flex-col gap-2 p-2">
          {/* Task summary — only show title, no status/priority */}
          <div className="rounded-md border bg-muted/30 p-2.5">
            <div className="truncate text-sm font-medium">
              📌 {linkedTask.title}
            </div>
          </div>

          {/* Inject options */}
          {kbLoading ? (
            <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
              {t("loading")}
            </div>
          ) : (
            <InjectOptionList
              options={filteredLinkedOptions}
              checked={linkedChecked}
              onToggle={linkedToggle}
              variant="compact"
              visibleGroups={VISIBLE_GROUPS_A}
              groupLabelResolver={groupLabelResolver}
              emptyMessages={{
                kb_docs: t("noDocs"),
                attachments: t("noAttachments"),
              }}
              kbDocSearchQuery={kbDocSearchQuery}
              onKbDocSearchChange={setKbDocSearchQuery}
            />
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleInject}
              disabled={injecting || linkedChecked.size === 0}
              className="flex-1"
            >
              <ClipboardList className="mr-1 h-3.5 w-3.5" />
              {injecting ? t("injecting") : t("injectContext")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleUnlink}
              disabled={unlinking}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              {t("unlink")}
            </Button>
          </div>
        </div>
      </ScrollArea>
    )
  }

  // Mode B/C: No linked task — show KB files + optional task linking
  return (
    <ScrollArea className="max-h-[480px]">
      <div className="flex flex-col gap-2 p-2">
        {/* KB file selection */}
        {kbLoading ? (
          <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
            {t("loading")}
          </div>
        ) : (
          <InjectOptionList
            options={filteredProjectOptions}
            checked={projectChecked}
            onToggle={projectToggle}
            variant="compact"
            visibleGroups={VISIBLE_GROUPS_BC}
            groupLabelResolver={groupLabelResolver}
            emptyMessages={{
              kb_docs: t("noDocs"),
            }}
            kbDocSearchQuery={projectKbDocSearchQuery}
            onKbDocSearchChange={setProjectKbDocSearchQuery}
          />
        )}

        {/* Inject button */}
        <Button
          size="sm"
          onClick={handleProjectInject}
          disabled={injecting || projectChecked.size === 0 || kbLoading}
          className="flex-1"
        >
          <ClipboardList className="mr-1 h-3.5 w-3.5" />
          {injecting ? t("injecting") : t("injectContext")}
        </Button>

        {/* Pending task link indicator */}
        {pendingTask && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
            <span className="text-xs font-medium">📌 {pendingTask.title}</span>
            <span className="text-[0.625rem] text-muted-foreground">
              {t("willAutoLink")}
            </span>
            {onClearPendingLink && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onClearPendingLink}
                className="shrink-0"
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {/* Link task — always available, collapsible search */}
        {!pendingTask && (
          <>
            {!showTaskSearch ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowTaskSearch(true)
                  void fetchSearchResults()
                }}
                className="w-full"
              >
                <Link className="mr-1 h-3.5 w-3.5" />
                {t("linkTask")}
              </Button>
            ) : (
              <div className="flex flex-col gap-1.5 rounded-md border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{t("linkTask")}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setShowTaskSearch(false)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-7 pl-7 text-xs"
                    placeholder={t("searchTasks")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <ScrollArea className="max-h-[160px]">
                  {searchLoading ? (
                    <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                      {t("loading")}
                    </div>
                  ) : filteredTasks.length === 0 ? (
                    <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                      {t("noTasksFound")}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {filteredTasks.map((task) => (
                        <button
                          key={task.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md border p-1.5 text-left",
                            "hover:bg-accent/50 cursor-pointer"
                          )}
                          onClick={() => handleLink(task.id)}
                          disabled={linking}
                        >
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[0.625rem]"
                          >
                            {resolveTaskTypeLabel(
                              task.taskType,
                              t as InjectI18nFn
                            )}
                          </Badge>
                          <span className="min-w-0 truncate text-xs font-medium">
                            {task.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  )
}

// Keep the old name as an alias for backward compatibility during transition
export { ProjectResourcePicker as TaskContextPopover }
