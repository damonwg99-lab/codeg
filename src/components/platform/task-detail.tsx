"use client"

import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
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
  listKnowledgeDocs,
  deleteKnowledgeDoc,
} from "@/lib/platform/api"
import type {
  TaskDetail as TaskDetailType,
  TaskConversationInfo,
  TaskStatus,
  KnowledgeDocInfo,
} from "@/lib/platform/types"
import {
  TASK_STATUS_LIST,
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
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
import { useTabContext } from "@/contexts/tab-context"
import { ContextInjectPanel } from "@/components/platform/context-inject-panel"
import type { ContextInjectPayload } from "@/components/platform/context-inject-panel-utils"
import { KnowledgeDocDetailDialog } from "@/components/platform/knowledge-doc-detail-dialog"
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

export function TaskDetail({ taskId }: { taskId: number }) {
  const t = useTranslations("Platform")
  const { setRoute, routeParams, openConversations } = useWorkbenchRoute()
  const { activeProject, activeProjectRepos } = usePlatform()
  const { openTab, setPendingInitialDraft } = useTabContext()
  const [detail, setDetail] = useState<TaskDetailType | null>(null)
  const [conversations, setConversations] = useState<TaskConversationInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [creatingConversation, setCreatingConversation] = useState(false)

  // Attachments state
  const [attachments, setAttachments] = useState<KnowledgeDocInfo[]>([])
  const [selectedAttachment, setSelectedAttachment] =
    useState<KnowledgeDocInfo | null>(null)
  const [deleteAttachmentTarget, setDeleteAttachmentTarget] =
    useState<KnowledgeDocInfo | null>(null)
  const [deletingAttachment, setDeletingAttachment] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)

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

  // ─── Load attachments ───
  const loadAttachments = useCallback(async () => {
    if (!activeProject) return
    try {
      const allDocs = await listKnowledgeDocs({
        projectId: activeProject.id,
        docTypeFilter: "task_attachment",
      })
      setAttachments(allDocs.filter((d) => d.taskId === taskId))
    } catch (e) {
      console.error("Failed to load attachments:", e)
    }
  }, [activeProject, taskId])

  useEffect(() => {
    void loadAttachments()
  }, [loadAttachments])

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
    async (payload: ContextInjectPayload) => {
      if (!detail) return
      setCreatingConversation(true)
      try {
        const result = await createConversationForTask({
          taskId: detail.task.id,
          injectedDocsJson: payload.injectedDocsJson,
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
        // Pre-fill the new conversation's composer with the context prefix
        if (payload.prefix) {
          setPendingInitialDraft(result.conversationId, payload.prefix)
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

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setRoute("task-kanban", { projectId })}
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t("project.edit")}
              </Button>
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
                  {TASK_STATUS_LABELS[status]}
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
                    status:
                      TASK_STATUS_LABELS[
                        getNextStatus(task.status)! as TaskStatus
                      ],
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
                    {TASK_STATUS_LABELS[task.status as TaskStatus] ??
                      task.status}
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
                  <Badge variant="outline">{task.taskType}</Badge>
                </div>
                {task.priority && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.75rem] text-muted-foreground">
                      {t("task.priority")}
                    </span>
                    <Badge variant="outline">{task.priority}</Badge>
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
                        onClick={() => setSelectedAttachment(att)}
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

        {/* ─── Linked Conversations ─── */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-[0.9375rem]">
              {t("task.conversations")}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setContextPanelOpen(true)}
              disabled={creatingConversation}
            >
              {creatingConversation ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquare className="mr-1 h-3.5 w-3.5" />
              )}
              New conversation
            </Button>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t("task.noConversations")}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent"
                    onClick={() => openConversations()}
                  >
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[0.875rem] font-medium truncate">
                        Conversation #{conv.conversationId}
                      </span>
                      <span className="text-[0.75rem] text-muted-foreground">
                        Role: {conv.conversationRole}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[0.625rem] shrink-0"
                    >
                      {conv.conversationRole}
                    </Badge>
                  </div>
                ))}
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
                {subTasks.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent"
                    onClick={() =>
                      setRoute("task-detail", {
                        taskId: sub.id,
                        projectId,
                      })
                    }
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[0.625rem]",
                        TASK_STATUS_COLORS[sub.status as TaskStatus] ?? ""
                      )}
                    >
                      {TASK_STATUS_LABELS[sub.status as TaskStatus] ??
                        sub.status}
                    </Badge>
                    <span className="text-[0.875rem] truncate">
                      {sub.title}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <ContextInjectPanel
          open={contextPanelOpen}
          onOpenChange={setContextPanelOpen}
          task={detail.task}
          project={activeProject}
          repos={activeProjectRepos}
          conversations={conversations}
          submitting={creatingConversation}
          onConfirm={handleCreateConversation}
        />

        {/* ─── Attachment Detail Dialog ─── */}
        {selectedAttachment && (
          <KnowledgeDocDetailDialog
            doc={selectedAttachment}
            projectId={projectId}
            open={selectedAttachment !== null}
            onClose={() => setSelectedAttachment(null)}
            onDeleted={() => {
              setSelectedAttachment(null)
              void loadAttachments()
            }}
            onUpdated={() => {
              void loadAttachments()
            }}
          />
        )}

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
      </div>
    </ScrollArea>
  )
}
