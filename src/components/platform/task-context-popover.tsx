"use client"

import { useMemo, useState } from "react"
import { ClipboardList, ChevronDown, ChevronRight, Search } from "lucide-react"
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
  buildTaskOptions,
  buildPayloadFromOptions,
  resolveTaskTypeLabel,
  type InjectI18nFn,
} from "@/components/platform/context-inject-panel-utils"
import type {
  KnowledgeDocInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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

/** Visible groups for Mode A (linked task inject). */
const VISIBLE_GROUPS_A: InjectOptionGroup[] = [
  "basic",
  "attachments",
  "conversations",
  "kb_docs",
]

/** Visible groups for Mode B/C (no linked task). KB docs only. */
const VISIBLE_GROUPS_BC: InjectOptionGroup[] = ["kb_docs"]

function inferRole(taskType: string): string {
  return TASK_TYPE_ROLE_MAP[taskType] ?? "discussion"
}

export function ProjectResourcePicker({
  linkedTaskInfo,
  linkedTask,
  onInject,
  onLink,
  activeProjectId,
  kbDocs,
  attachments,
  linkedConversations,
  kbLoading,
  kbDirPrefix,
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
    () => buildProjectOptions(kbDocs, [], [], t as InjectI18nFn, kbDirPrefix),
    [kbDocs, t, kbDirPrefix]
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

  // ─── Task list (accordion) ───
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null)
  const [taskSearchQuery, setTaskSearchQuery] = useState("")
  const [allTasks, setAllTasks] = useState<TaskInfo[]>([])
  const [taskLoading, setTaskLoading] = useState(false)
  const [injecting, setInjecting] = useState(false)

  // Fetch task list when popover opens
  useMemo(() => {
    if (!activeProjectId) {
      setAllTasks([])
      return
    }
    setTaskLoading(true)
    listTasks(activeProjectId)
      .then((tasks) => {
        setAllTasks(tasks)
        setTaskLoading(false)
      })
      .catch(() => {
        setAllTasks([])
        setTaskLoading(false)
      })
  }, [activeProjectId])

  const filteredTasks = useMemo(() => {
    if (!taskSearchQuery) return allTasks
    const q = taskSearchQuery.toLowerCase()
    return allTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(q) ||
        (task.description ?? "").toLowerCase().includes(q)
    )
  }, [allTasks, taskSearchQuery])

  // Generate inject options for the expanded task
  const expandedTask = useMemo(
    () => allTasks.find((task) => task.id === expandedTaskId) ?? null,
    [allTasks, expandedTaskId]
  )

  const expandedTaskAttachments = useMemo(() => {
    if (!expandedTask) return []
    return attachments.filter((d) => d.taskId === expandedTask.id)
  }, [expandedTask, attachments])

  const expandedTaskOptions = useMemo<InjectOption[]>(() => {
    if (!expandedTask) return []
    return [
      ...buildTaskOptions(expandedTask, t as InjectI18nFn),
      ...buildProjectOptions(
        [],
        expandedTaskAttachments,
        [],
        t as InjectI18nFn,
        kbDirPrefix
      ),
    ]
  }, [expandedTask, expandedTaskAttachments, t, kbDirPrefix])

  // Checked state for expanded task options
  const expandedTaskDefaultIds = useMemo(
    () =>
      new Set<OptionId>(
        expandedTaskOptions
          .filter((option) => option.defaultChecked)
          .map((option) => option.id)
      ),
    [expandedTaskOptions]
  )

  const [expandedTaskChecked, setExpandedTaskChecked] = useState<Set<OptionId>>(
    expandedTaskDefaultIds
  )

  useMemo(() => {
    setExpandedTaskChecked(expandedTaskDefaultIds)
  }, [expandedTaskDefaultIds])

  function expandedTaskToggle(id: OptionId, value: boolean) {
    setExpandedTaskChecked((prev) => {
      const next = new Set(prev)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // ─── Handlers ───

  async function handleModeAInject() {
    if (!linkedTask) return
    setInjecting(true)
    try {
      const payload = buildPayloadFromOptions(linkedOptions, linkedChecked)
      onInject(payload)
    } finally {
      setInjecting(false)
    }
  }

  async function handleModeBCInject() {
    setInjecting(true)
    try {
      // Combine project KB options + expanded task options
      const allChecked = new Set<OptionId>([
        ...projectChecked,
        ...expandedTaskChecked,
      ])
      const allOptions = [...projectOptions, ...expandedTaskOptions]
      const payload = buildPayloadFromOptions(allOptions, allChecked)
      onInject(payload)

      // Auto-link: set pendingTaskLink for new conversations
      if (expandedTaskId) {
        const task = allTasks.find((t) => t.id === expandedTaskId)
        if (task) {
          await onLink(expandedTaskId, inferRole(task.taskType), {
            title: task.title,
            taskType: task.taskType,
          })
        }
      }
    } finally {
      setInjecting(false)
    }
  }

  // ─── Render ───

  if (linkedTask && linkedTaskInfo) {
    // Mode A: Already linked — show task summary + KB files
    return (
      <div className="flex flex-col">
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
        </div>

        {/* Fixed bottom action bar */}
        <div className="shrink-0 border-t p-2">
          <Button
            size="sm"
            onClick={handleModeAInject}
            disabled={injecting || linkedChecked.size === 0}
            className="w-full h-8"
          >
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            {injecting ? t("adding") : t("addToChat")}
          </Button>
        </div>
      </div>
    )
  }

  // Mode B/C: No linked task — show KB docs + accordion task list
  return (
    <div className="flex flex-col">
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

        {/* Pending tasks section (accordion) */}
        {activeProjectId && (
          <section className="mt-2">
            <h3 className="text-[0.6875rem] font-medium uppercase text-muted-foreground mb-1.5">
              {t("pendingTasks")}
            </h3>

            {/* Task search input */}
            <div className="relative mb-1.5">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-7 pl-7 text-xs"
                placeholder={t("searchTasks")}
                value={taskSearchQuery}
                onChange={(e) => setTaskSearchQuery(e.target.value)}
              />
            </div>

            {/* Task list with max height */}
            <div className="max-h-[200px] overflow-y-auto">
              {taskLoading ? (
                <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                  {t("loading")}
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                  {t("noTasksFound")}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredTasks.map((task) => {
                    const isExpanded = expandedTaskId === task.id
                    return (
                      <div
                        key={task.id}
                        className={cn(
                          "rounded-md border",
                          isExpanded && "bg-muted/20"
                        )}
                      >
                        {/* Task row header */}
                        <button
                          className={cn(
                            "flex items-center gap-2 p-1.5 text-left w-full",
                            "hover:bg-accent/50 cursor-pointer"
                          )}
                          onClick={() =>
                            setExpandedTaskId(isExpanded ? null : task.id)
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
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

                        {/* Expanded content: description + attachments */}
                        {isExpanded && expandedTaskOptions.length > 0 && (
                          <div className="px-1.5 pb-1.5 space-y-0.5">
                            {expandedTaskOptions.map((option) => (
                              <label
                                key={option.id}
                                className={cn(
                                  "flex cursor-pointer items-start rounded-md border",
                                  "hover:bg-accent/50 gap-2 p-1.5"
                                )}
                              >
                                <Checkbox
                                  checked={expandedTaskChecked.has(option.id)}
                                  onCheckedChange={(value) =>
                                    expandedTaskToggle(
                                      option.id,
                                      value === true
                                    )
                                  }
                                  className="mt-0.5 h-3.5 w-3.5"
                                />
                                <span className="min-w-0">
                                  <span className="block truncate font-medium text-[0.8125rem]">
                                    {option.label}
                                  </span>
                                  <span className="mt-0.5 block text-muted-foreground text-[0.6875rem]">
                                    {option.description}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Fixed bottom action bar */}
      <div className="shrink-0 border-t p-2">
        <Button
          size="sm"
          onClick={handleModeBCInject}
          disabled={
            injecting ||
            (projectChecked.size === 0 && expandedTaskChecked.size === 0) ||
            kbLoading
          }
          className="w-full h-8"
        >
          <ClipboardList className="mr-1 h-3.5 w-3.5" />
          {injecting ? t("adding") : t("addToChat")}
        </Button>
      </div>
    </div>
  )
}

// Keep the old name as an alias for backward compatibility during transition
export { ProjectResourcePicker as TaskContextPopover }
