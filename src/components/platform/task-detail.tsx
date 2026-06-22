"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Loader2,
  Pencil,
  Save,
  X,
  ArrowRight,
  MessageSquare,
} from "lucide-react"
import {
  getTask,
  updateTask,
  updateTaskStatus,
  listTaskConversations,
} from "@/lib/platform/api"
import type {
  TaskDetail as TaskDetailType,
  TaskConversationInfo,
  TaskStatus,
} from "@/lib/platform/types"
import {
  TASK_STATUS_LIST,
  TASK_STATUS_LABELS,
  TASK_STATUS_COLORS,
} from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function TaskDetail({ taskId }: { taskId: number }) {
  const t = useTranslations("Platform")
  const router = useRouter()
  const [detail, setDetail] = useState<TaskDetailType | null>(null)
  const [conversations, setConversations] = useState<TaskConversationInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Edit state
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
        // Also load conversations
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

  // Get the next status in the flow
  const getNextStatus = useCallback((current: string): string | null => {
    const idx = TASK_STATUS_LIST.indexOf(current as TaskStatus)
    if (idx >= 0 && idx < TASK_STATUS_LIST.length - 1) {
      return TASK_STATUS_LIST[idx + 1]
    }
    return null
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex items-center justify-center py-16 text-destructive">
        Task not found
      </div>
    )
  }

  const { task, subTasks } = detail

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{task.title}</h2>
        <div className="flex items-center gap-1">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
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
                onClick={() => handleStatusChange(getNextStatus(task.status)!)}
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
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("task.taskType")}</Label>
                <Input
                  value={editTaskType}
                  onChange={(e) => setEditTaskType(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t("task.priority")}</Label>
                <Input
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                />
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

      {/* ─── Linked Conversations ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[0.9375rem]">
            {t("task.conversations")}
          </CardTitle>
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
                  onClick={() =>
                    router.push(
                      `/workspace?conversationId=${conv.conversationId}`
                    )
                  }
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
                  <Badge variant="outline" className="text-[0.625rem] shrink-0">
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
                    router.push(`/platform?view=task-detail&id=${sub.id}`)
                  }
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[0.625rem]",
                      TASK_STATUS_COLORS[sub.status as TaskStatus] ?? ""
                    )}
                  >
                    {TASK_STATUS_LABELS[sub.status as TaskStatus] ?? sub.status}
                  </Badge>
                  <span className="text-[0.875rem] truncate">{sub.title}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
