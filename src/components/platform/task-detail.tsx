"use client"

import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { AgentType } from "@/lib/types"
import {
  Loader2,
  Save,
  ArrowRight,
  ArrowLeft,
  Pencil,
  X,
  MessageSquare,
  FileText,
  Upload,
  Trash2,
  Eye,
} from "lucide-react"
import {
  getTask,
  updateTask,
  updateTaskStatus,
  listTaskConversations,
  createConversationForTask,
  uploadTaskAttachment,
  uploadTaskAiIntermediateDoc,
  listKnowledgeDocs,
  deleteKnowledgeDoc,
  unlinkConversation,
  deleteTask,
} from "@/lib/platform/api"
import { deleteConversation } from "@/lib/api"
import type {
  TaskDetail as TaskDetailType,
  TaskConversationInfo,
  TaskStatus,
  TaskPriority,
  KnowledgeDocInfo,
} from "@/lib/platform/types"
import {
  TASK_STATUS_LIST,
  TASK_STATUS_COLORS,
  TASK_PRIORITY_COLORS,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { usePlatform } from "@/contexts/platform-context"
import { useTabContext, makeConversationTabId } from "@/contexts/tab-context"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { ContextInjectPanel } from "@/components/platform/context-inject-panel"
import {
  optionToReferenceAttrs,
  type ContextInjectPayload,
} from "@/components/platform/context-inject-panel-utils"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

/** Format an ISO timestamp into a date string (same format as kanban: YYYY/MM/DD). */
function formatShortDate(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`
}

/** Resolve task status label using i18n.
 *  next-intl requires static keys at compile time; this does an explicit lookup
 *  with a raw-value fallback. */
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

/** Compute a path relative to the folder root from a KB doc's filePath.
 *  KB docs store filePath relative to the _knowledge/ directory (e.g. "docs/arch.md").
 *  To open in the file panel via openFilePreview (which uses folderPath as root),
 *  we need the path relative to the folder root: "_knowledge/docs/arch.md".
 *  For custom kbLocalDir outside the folder root, we can't use openFilePreview
 *  (it requires a relative path) — return null to signal this case. */
function kbDocRelPath(
  kbLocalDir: string | null,
  rootDir: string,
  folderPath: string | null,
  filePath: string
): string | null {
  // Normalize everything to forward slashes for consistent comparison.
  // On Windows, kbLocalDir and rootDir may contain backslashes from
  // PathBuf::to_string_lossy(); filePath may also have backslashes
  // from the scanner's strip_prefix + to_string_lossy.
  const kbDir = (
    kbLocalDir ?? `${rootDir.replace(/\\/g, "/")}/_knowledge`
  ).replace(/\\/g, "/")
  const fp = folderPath?.replace(/\\/g, "/") ?? ""
  const normalizedFilePath = filePath.replace(/\\/g, "/")
  if (!fp) return null // No folder context → can't compute relative path
  if (kbDir.startsWith(fp + "/") || kbDir === fp + "/_knowledge") {
    const kbRel = kbDir.slice(fp.length + 1) // "_knowledge"
    return `${kbRel}/${normalizedFilePath}`
  }
  // KB dir is outside folder root — can't open via openFilePreview
  // (it requires path relative to folderPath, rejects absolute paths)
  return null
}

export function TaskDetail({ taskId }: { taskId: number }) {
  const t = useTranslations("Platform")
  const { setRoute, routeParams, fromRoute, fromParams, openConversations } =
    useWorkbenchRoute()
  const { activeProject } = usePlatform()
  const { openTab, setPendingInitialDraft, closeConversationTab } =
    useTabContext()
  const { conversations: allConversations, refreshConversations } =
    useAppWorkspace()
  const { openFilePreview } = useWorkspaceContext()
  const { activeFolder } = useActiveFolder()
  // Import makeConversationTabId to compute the tab's id for pendingInitialDraft
  // (keyed by tabId instead of conversationId to prevent badge leaking across tabs)
  const [detail, setDetail] = useState<TaskDetailType | null>(null)
  const [conversations, setConversations] = useState<TaskConversationInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [contextPanelKey, setContextPanelKey] = useState(0)
  const [creatingConversation, setCreatingConversation] = useState(false)

  // Attachments state
  const [attachments, setAttachments] = useState<KnowledgeDocInfo[]>([])
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] =
    useState<KnowledgeDocInfo | null>(null)
  const [deletingAttachment, setDeletingAttachment] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

  // AI intermediate docs state
  const [aiIntermediateDocs, setAiIntermediateDocs] = useState<
    KnowledgeDocInfo[]
  >([])
  const [deleteAiDocTarget, setDeleteAiDocTarget] =
    useState<KnowledgeDocInfo | null>(null)
  const [deletingAiDoc, setDeletingAiDoc] = useState(false)
  const [uploadingAiDoc, setUploadingAiDoc] = useState(false)

  // Delete conversation dialog state
  const [deleteConvTarget, setDeleteConvTarget] =
    useState<TaskConversationInfo | null>(null)
  const [deletingConversation, setDeletingConversation] = useState(false)

  // Delete sub-task dialog state
  const [deleteSubTarget, setDeleteSubTarget] = useState<number | null>(null)

  // Delete task handler — uses routeParams.projectId as fallback so
  // the hook can run before the detail early-return.
  const projectIdForDelete = Number(
    routeParams.projectId ?? detail?.task.projectId ?? 0
  )
  const handleDeleteTask = useCallback(async () => {
    if (projectIdForDelete === 0) return
    try {
      await deleteTask(taskId)
      toast.success(t("task.taskDeleted" as never))
      setRoute("task-kanban", { projectId: projectIdForDelete })
    } catch {
      toast.error(t("task.deleteTaskFailed" as never))
    }
  }, [taskId, projectIdForDelete, setRoute, t])

  // Delete sub-task handler (reloads detail after sub-task removal)
  const handleDeleteSubTask = useCallback(
    async (subTaskId: number) => {
      try {
        await deleteTask(subTaskId)
        toast.success(t("task.taskDeleted" as never))
        const d = await getTask(taskId)
        setDetail(d)
      } catch {
        toast.error(t("task.deleteTaskFailed" as never))
      }
    },
    [taskId]
  )

  // KB docs + skills state (lazy loaded when context panel opens)
  const [kbDocs, setKbDocs] = useState<KnowledgeDocInfo[]>([])
  const [kbLoading, setKbLoading] = useState(false)

  // Edit form state
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editTaskType, setEditTaskType] = useState("")
  const [editPriority, setEditPriority] = useState("")
  const [editAssignee, setEditAssignee] = useState("")

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const d = await getTask(taskId)
        if (!cancelled) {
          setDetail(d)
          setAttachments(d.attachments)
          setAiIntermediateDocs(d.aiIntermediateDocs ?? [])
          setEditTitle(d.task.title)
          setEditDescription(d.task.description ?? "")
          setEditTaskType(d.task.taskType)
          setEditPriority(d.task.priority ?? "")
          setEditAssignee(d.task.assignee ?? "")
          setLoading(false)
        }
        const convs = await listTaskConversations(taskId)
        if (!cancelled) setConversations(convs)
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [taskId])

  // ─── Reload attachments (used after upload/delete) ───
  const loadAttachments = useCallback(async () => {
    try {
      const d = await getTask(taskId)
      setDetail(d)
      setAttachments(d.attachments)
    } catch (e) {
      console.error("Failed to reload attachments:", e)
    }
  }, [taskId])

  // ─── Reload AI intermediate docs (used after upload/delete) ───
  const loadAiIntermediateDocs = useCallback(async () => {
    if (!activeProject) return
    try {
      const d = await getTask(taskId)
      setAiIntermediateDocs(d.aiIntermediateDocs ?? [])
    } catch (e) {
      console.error("Failed to reload AI intermediate docs:", e)
    }
  }, [activeProject, taskId])

  // Attachments are now loaded via getTask detail (find_by_task_id),
  // so we no longer need the separate listKnowledgeDocs call here.

  // ─── Load KB docs when context panel opens ───
  useEffect(() => {
    if (!contextPanelOpen || !activeProject) return
    let cancelled = false
    setKbLoading(true)
    async function loadKB() {
      try {
        const allDocs = await listKnowledgeDocs({
          projectId: activeProject!.id,
        })
        if (!cancelled) {
          setKbDocs(allDocs.filter((d) => d.docType !== "task_attachment"))
          setKbLoading(false)
        }
      } catch {
        if (!cancelled) setKbLoading(false)
      }
    }
    void loadKB()
    return () => {
      cancelled = true
    }
  }, [contextPanelOpen, activeProject])

  // ─── Upload attachment ───
  const handleUploadAttachment = useCallback(
    async (file: File) => {
      if (!activeProject) return
      setUploadingAttachment(true)
      try {
        await uploadTaskAttachment({
          projectId: activeProject.id,
          taskId,
          file,
        })
        await loadAttachments()
      } catch (e) {
        console.error("Attachment upload failed:", e)
      }
      setUploadingAttachment(false)
    },
    [activeProject, taskId, loadAttachments]
  )

  // ─── Upload AI intermediate doc ───
  const handleUploadAiIntermediateDoc = useCallback(
    async (file: File) => {
      if (!activeProject) return
      setUploadingAiDoc(true)
      try {
        await uploadTaskAiIntermediateDoc({
          projectId: activeProject.id,
          taskId,
          file,
        })
        await loadAiIntermediateDocs()
      } catch (e) {
        console.error("AI doc upload failed:", e)
      }
      setUploadingAiDoc(false)
    },
    [activeProject, taskId, loadAiIntermediateDocs]
  )

  // ─── Delete attachment ───
  const handleDeleteAttachment = useCallback(async () => {
    if (!deleteAttachmentTarget) return
    setDeletingAttachment(true)
    try {
      await deleteKnowledgeDoc(deleteAttachmentTarget.id)
      setDeleteAttachmentTarget(null)
      await loadAttachments()
    } catch (e) {
      console.error("Delete attachment failed:", e)
    }
    setDeletingAttachment(false)
  }, [deleteAttachmentTarget, loadAttachments])

  // ─── Delete AI intermediate doc ───
  const handleDeleteAiDoc = useCallback(async () => {
    if (!deleteAiDocTarget) return
    setDeletingAiDoc(true)
    try {
      await deleteKnowledgeDoc(deleteAiDocTarget.id)
      setDeleteAiDocTarget(null)
      await loadAiIntermediateDocs()
    } catch (e) {
      console.error("Delete AI doc failed:", e)
    }
    setDeletingAiDoc(false)
  }, [deleteAiDocTarget, loadAiIntermediateDocs])

  // ─── Delete linked conversation ───
  // If the conversation still exists (not soft-deleted), delete it entirely
  // (removing from sidebar and closing any tab). If it's already gone
  // (soft-deleted but the link still remains), just unlink the stale link.
  const handleDeleteConversation = useCallback(async () => {
    if (!deleteConvTarget || !detail) return
    setDeletingConversation(true)
    try {
      const conv = allConversations.find(
        (c) => c.id === deleteConvTarget!.conversationId
      )
      if (conv) {
        // Conversation is alive — delete it entirely (backend also cleans
        // task-conversation links via delete_conversation_with_cleanup_core)
        await deleteConversation(deleteConvTarget.conversationId)
        closeConversationTab(conv.folder_id, conv.id, conv.agent_type)
      } else {
        // Conversation is already soft-deleted but the stale link remains.
        // Just unlink the task-conversation association so it stops showing.
        await unlinkConversation({
          taskId: detail.task.id,
          conversationId: deleteConvTarget.conversationId,
        })
      }
      setDeleteConvTarget(null)
      await refreshConversations()
      const convs = await listTaskConversations(detail.task.id)
      setConversations(convs)
    } catch (e) {
      console.error("Delete conversation failed:", e)
    }
    setDeletingConversation(false)
  }, [
    deleteConvTarget,
    detail,
    allConversations,
    closeConversationTab,
    refreshConversations,
  ])

  const handleSave = useCallback(async () => {
    if (!detail) return
    setSaving(true)
    try {
      const updated = await updateTask({
        id: detail.task.id,
        title: editTitle,
        description: editDescription || undefined,
        taskType: editTaskType || undefined,
        priority: editPriority || undefined,
        assignee: editAssignee || undefined,
      })
      setDetail((prev) => (prev ? { ...prev, task: updated } : null))
      setEditing(false)
    } catch (e) {
      console.error("Save failed:", e)
    }
    setSaving(false)
  }, [
    detail,
    editTitle,
    editDescription,
    editTaskType,
    editPriority,
    editAssignee,
  ])

  const handleCancelEdit = useCallback(() => {
    if (!detail) return
    setEditTitle(detail.task.title)
    setEditDescription(detail.task.description ?? "")
    setEditTaskType(detail.task.taskType)
    setEditPriority(detail.task.priority ?? "")
    setEditAssignee(detail.task.assignee ?? "")
    setEditing(false)
  }, [detail])

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (!detail) return
      try {
        const updated = await updateTaskStatus(detail.task.id, newStatus)
        setDetail((prev) => (prev ? { ...prev, task: updated } : null))
      } catch (e) {
        console.error("Status change failed:", e)
      }
    },
    [detail]
  )

  const handleCreateConversation = useCallback(
    async (payload: ContextInjectPayload, agentType: AgentType) => {
      if (!detail) return
      setCreatingConversation(true)
      try {
        const result = await createConversationForTask({
          taskId: detail.task.id,
          injectedDocsJson: payload.injectedDocsJson,
          agentType,
        })
        setConversations((prev) => [result.link, ...prev])
        setContextPanelOpen(false)
        openConversations()
        openTab(
          result.folderId,
          result.conversationId,
          result.agentType,
          false,
          result.title
        )
        // Pre-fill the new conversation's composer with context badges
        // (stored as JSON of ReferenceAttrs[] for badge insertion).
        // Key by tabId instead of conversationId to prevent badge leaking
        // across tabs — only the target tab's MessageInput will consume it.
        if (payload.options.length > 0) {
          const refs = payload.options.map(optionToReferenceAttrs)
          const tabId = makeConversationTabId(
            result.folderId,
            result.agentType,
            result.conversationId
          )
          setPendingInitialDraft(tabId, JSON.stringify(refs))
        }
      } catch (e) {
        console.error("Create task conversation failed:", e)
      } finally {
        setCreatingConversation(false)
      }
    },
    [detail, openConversations, openTab, setPendingInitialDraft]
  )

  const getNextStatus = useCallback((current: string): string | null => {
    const idx = TASK_STATUS_LIST.indexOf(current as TaskStatus)
    if (idx >= 0 && idx < TASK_STATUS_LIST.length - 1) {
      return TASK_STATUS_LIST[idx + 1]
    }
    return null
  }, [])

  if (loading) {
    return (
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            Loading…
          </div>
        </div>
      </ScrollArea>
    )
  }

  if (!detail) {
    return (
      <ScrollArea className="h-full">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
          <div className="flex items-center justify-center py-16 text-destructive">
            Task not found
          </div>
        </div>
      </ScrollArea>
    )
  }

  const { task, subTasks } = detail
  const projectId = Number(routeParams.projectId ?? task.projectId)

  // Compute the KB directory path relative to the project root, for
  // prefixing doc filePaths in inject context (filePath is stored relative
  // to _knowledge dir; the agent needs project-root-relative paths).
  const kbDirPrefix = (() => {
    const kbDir = (
      activeProject?.kbLocalDir ??
      `${activeProject?.rootDir.replace(/\\/g, "/") ?? ""}/_knowledge`
    ).replace(/\\/g, "/")
    const fp = activeFolder?.path?.replace(/\\/g, "/") ?? ""
    if (!fp) return "_knowledge" // fallback: standard dir name
    if (kbDir.startsWith(fp + "/") || kbDir === fp + "/_knowledge") {
      return kbDir.slice(fp.length + 1) // e.g., "_knowledge"
    }
    return "_knowledge" // fallback for external KB dirs
  })()

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (fromRoute) {
                  setRoute(fromRoute, fromParams)
                } else {
                  setRoute("task-kanban", { projectId })
                }
              }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-semibold">{task.title}</h2>
          </div>
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEdit}
                  disabled={saving}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  {t("project.cancel")}
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-3.5 w-3.5" />
                  )}
                  {t("project.save")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {t("task.deleteTask" as never)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  {t("project.edit")}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ─── Status Management ─── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[0.9375rem]">
              {t("task.statusManagement")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {TASK_STATUS_LIST.map((status) => (
                <Button
                  key={status}
                  variant={task.status === status ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "text-[0.75rem]",
                    task.status === status && TASK_STATUS_COLORS[status]
                  )}
                  onClick={() => handleStatusChange(status)}
                >
                  {resolveStatusLabel(t, status)}
                </Button>
              ))}
              {getNextStatus(task.status) && (
                <Button
                  variant="default"
                  size="sm"
                  className="ml-2 text-[0.75rem]"
                  onClick={() =>
                    handleStatusChange(getNextStatus(task.status)!)
                  }
                >
                  <ArrowRight className="mr-1 h-3.5 w-3.5" />
                  {t("task.moveTo", {
                    status: resolveStatusLabel(t, getNextStatus(task.status)!),
                  })}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ─── Basic Info ─── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[0.9375rem]">
              {t("task.basicInfo")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {editing ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("task.title")}</Label>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("task.description")}</Label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("task.taskType")}</Label>
                  <Select value={editTaskType} onValueChange={setEditTaskType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bug">
                        {t("task.taskTypeOptions.bug")}
                      </SelectItem>
                      <SelectItem value="feature">
                        {t("task.taskTypeOptions.feature")}
                      </SelectItem>
                      <SelectItem value="task">
                        {t("task.taskTypeOptions.task")}
                      </SelectItem>
                      <SelectItem value="improvement">
                        {t("task.taskTypeOptions.improvement")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("task.priority")}</Label>
                  <Select value={editPriority} onValueChange={setEditPriority}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">
                        {t("task.priorityOptions.low")}
                      </SelectItem>
                      <SelectItem value="medium">
                        {t("task.priorityOptions.medium")}
                      </SelectItem>
                      <SelectItem value="high">
                        {t("task.priorityOptions.high")}
                      </SelectItem>
                      <SelectItem value="urgent">
                        {t("task.priorityOptions.urgent")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("task.assignee")}</Label>
                  <Input
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] text-muted-foreground">
                    {t("task.title")}
                  </span>
                  <span className="text-[0.875rem]">{task.title}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] text-muted-foreground">
                    {t("task.statusLabel")}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      TASK_STATUS_COLORS[task.status as TaskStatus] ?? ""
                    )}
                  >
                    {resolveStatusLabel(t, task.status)}
                  </Badge>
                </div>
                {task.description && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">
                      {t("task.description")}
                    </span>
                    <span className="text-[0.875rem]">{task.description}</span>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="text-[0.75rem] text-muted-foreground">
                    {t("task.taskType")}
                  </span>
                  <Badge variant="outline">
                    {resolveTypeLabel(t, task.taskType)}
                  </Badge>
                </div>
                {task.priority && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">
                      {t("task.priority")}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        TASK_PRIORITY_COLORS[task.priority as TaskPriority] ??
                          ""
                      )}
                    >
                      {resolvePriorityLabel(t, task.priority)}
                    </Badge>
                  </div>
                )}
                {task.assignee && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">
                      {t("task.assignee")}
                    </span>
                    <span className="text-[0.875rem]">{task.assignee}</span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* ─── Attachments ─── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-[0.9375rem]">
              {t("kb.attachments")}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={uploadingAttachment}
              onClick={() => {
                const input = document.createElement("input")
                input.type = "file"
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0]
                  if (f) void handleUploadAttachment(f)
                }
                input.click()
              }}
            >
              {uploadingAttachment ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              {uploadingAttachment
                ? t("kb.uploadingAttachment")
                : t("kb.addAttachment")}
            </Button>
          </CardHeader>
          <CardContent className={attachments.length === 0 ? "pb-3" : ""}>
            {attachments.length === 0 ? (
              <p className="text-[0.75rem] text-muted-foreground">
                {t("kb.noAttachments")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-2 rounded-md border p-2"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[0.875rem] font-medium truncate">
                        {att.title}
                      </span>
                      <span className="text-[0.75rem] text-muted-foreground truncate">
                        {att.filePath}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation()
                          const relPath = kbDocRelPath(
                            activeProject?.kbLocalDir ?? null,
                            activeProject?.rootDir ?? "",
                            activeFolder?.path ?? null,
                            att.filePath
                          )
                          if (relPath) void openFilePreview(relPath)
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteAttachmentTarget(att)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── AI Intermediate Docs ─── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-[0.9375rem]">
              {t("kb.aiIntermediateDocs")}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={uploadingAiDoc}
              onClick={() => {
                const input = document.createElement("input")
                input.type = "file"
                input.onchange = (e) => {
                  const f = (e.target as HTMLInputElement).files?.[0]
                  if (f) void handleUploadAiIntermediateDoc(f)
                }
                input.click()
              }}
            >
              {uploadingAiDoc ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="mr-1 h-3.5 w-3.5" />
              )}
              {uploadingAiDoc ? t("kb.uploadingAiDoc") : t("kb.addAiDoc")}
            </Button>
          </CardHeader>
          <CardContent
            className={aiIntermediateDocs.length === 0 ? "pb-3" : ""}
          >
            {aiIntermediateDocs.length === 0 ? (
              <p className="text-[0.75rem] text-muted-foreground">
                {t("kb.noAiIntermediateDocs")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {aiIntermediateDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 rounded-md border p-2"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[0.875rem] font-medium truncate">
                        {doc.title}
                      </span>
                      <span className="text-[0.75rem] text-muted-foreground truncate">
                        {doc.filePath}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation()
                          const relPath = kbDocRelPath(
                            activeProject?.kbLocalDir ?? null,
                            activeProject?.rootDir ?? "",
                            activeFolder?.path ?? null,
                            doc.filePath
                          )
                          if (relPath) void openFilePreview(relPath)
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteAiDocTarget(doc)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Linked Conversations ─── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-[0.9375rem]">
              {t("task.conversations")}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setContextPanelKey((k) => k + 1)
                setContextPanelOpen(true)
              }}
              disabled={creatingConversation}
            >
              {creatingConversation ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquare className="mr-1 h-3.5 w-3.5" />
              )}
              {t("task.newConversation")}
            </Button>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t("task.noConversations")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {[...conversations]
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime()
                  )
                  .map((conv) => {
                    // Look up actual conversation title from sidebar data
                    const convSummary = allConversations.find(
                      (c) => c.id === conv.conversationId
                    )
                    const convTitle =
                      convSummary?.title ||
                      conv.summary ||
                      t("task.untitledConversation")
                    return (
                      <div
                        key={conv.id}
                        className="flex items-center gap-2 rounded-md border p-2 hover:bg-accent/50"
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-[0.875rem] font-medium truncate min-w-0">
                          {convTitle}
                        </span>
                        <span className="text-[0.625rem] text-muted-foreground shrink-0">
                          {formatShortDate(conv.createdAt)}
                        </span>
                        <div className="flex items-center gap-1 shrink-0 ml-auto">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-[0.625rem] px-2"
                            onClick={() => {
                              if (convSummary) {
                                openTab(
                                  convSummary.folder_id,
                                  convSummary.id,
                                  convSummary.agent_type
                                )
                                // Must switch to conversations view — openTab
                                // only changes the active tab, but the workbench
                                // route stays on the platform page unless we
                                // explicitly navigate to conversations.
                                openConversations()
                              } else {
                                openConversations()
                              }
                            }}
                          >
                            {t("task.continueConversation")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteConvTarget(conv)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── Sub Tasks ─── */}
        {subTasks.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[0.9375rem]">
                {t("task.subTasks")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2">
                {[...subTasks]
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() -
                      new Date(a.createdAt).getTime()
                  )
                  .map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent"
                      onClick={() =>
                        setRoute(
                          "task-detail",
                          { taskId: sub.id, projectId },
                          {
                            routeId: "task-detail",
                            params: { taskId: task.id, projectId },
                          }
                        )
                      }
                    >
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[0.625rem]",
                          TASK_STATUS_COLORS[sub.status as TaskStatus] ?? ""
                        )}
                      >
                        {resolveStatusLabel(t, sub.status)}
                      </Badge>
                      <span className="text-[0.875rem] truncate min-w-0">
                        {sub.title}
                      </span>
                      <span className="text-[0.625rem] text-muted-foreground shrink-0">
                        {formatShortDate(sub.createdAt)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive ml-auto"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteSubTarget(sub.id)
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        <ContextInjectPanel
          key={contextPanelKey}
          open={contextPanelOpen}
          onOpenChange={setContextPanelOpen}
          task={detail.task}
          conversations={conversations}
          kbDocs={kbDocs}
          attachments={attachments}
          kbLoading={kbLoading}
          submitting={creatingConversation}
          kbDirPrefix={kbDirPrefix}
          defaultAgentType={
            activeProject?.defaultAgentType as AgentType | null | undefined
          }
          onConfirm={handleCreateConversation}
        />

        {/* ─── Delete Attachment Confirm ─── */}
        <AlertDialog
          open={deleteAttachmentTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteAttachmentTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("kb.deleteDoc")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("kb.deleteConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("project.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleDeleteAttachment()}
                disabled={deletingAttachment}
              >
                {deletingAttachment ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("kb.deleteDoc")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ─── Delete AI Doc Confirm ─── */}
        <AlertDialog
          open={deleteAiDocTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteAiDocTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("kb.deleteDoc")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("kb.deleteConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("project.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleDeleteAiDoc()}
                disabled={deletingAiDoc}
              >
                {deletingAiDoc ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("kb.deleteDoc")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ─── Delete Conversation Confirm ─── */}
        <AlertDialog
          open={deleteConvTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteConvTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("task.deleteConversation")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("task.deleteConversationConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("project.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleDeleteConversation()}
                disabled={deletingConversation}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletingConversation ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t("task.deleteConversation")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ─── Delete Task Confirm ─── */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("task.deleteTask" as never)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("task.deleteTaskConfirm" as never)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("project.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleDeleteTask()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("task.deleteTask" as never)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ─── Delete Sub-Task Confirm ─── */}
        <AlertDialog
          open={deleteSubTarget !== null}
          onOpenChange={(open) => {
            if (!open) setDeleteSubTarget(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("task.deleteTask" as never)}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("task.deleteTaskConfirm" as never)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("project.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (deleteSubTarget !== null) {
                    void handleDeleteSubTask(deleteSubTarget)
                    setDeleteSubTarget(null)
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("task.deleteTask" as never)}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ScrollArea>
  )
}
