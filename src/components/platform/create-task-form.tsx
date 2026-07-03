"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Loader2, ArrowLeft, X, FileText } from "lucide-react"
import {
  createTask,
  updateTaskStatus,
  uploadTaskAttachment,
} from "@/lib/platform/api"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"

export function CreateTaskForm({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  const { setRoute } = useWorkbenchRoute()

  // Form state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [taskType, setTaskType] = useState<string>("task")
  const [priority, setPriority] = useState<string>("medium")
  const [status, setStatus] = useState<string>("backlog")
  const [assignee, setAssignee] = useState("")

  // Create state
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Staged attachment files
  const [stagedFiles, setStagedFiles] = useState<File[]>([])
  const [attachmentUploading, setAttachmentUploading] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!title) return
    setCreating(true)
    setCreateError(null)
    try {
      const task = await createTask({
        projectId,
        title,
        taskType,
        description: description || undefined,
        priority: priority || undefined,
        assignee: assignee || undefined,
      })
      // Set the initial status if not "backlog" (createTask defaults to backlog)
      if (status !== "backlog") {
        await updateTaskStatus(task.id, status)
      }
      // Upload staged attachments
      if (stagedFiles.length > 0) {
        setAttachmentUploading(true)
        for (const file of stagedFiles) {
          try {
            await uploadTaskAttachment({ projectId, taskId: task.id, file })
          } catch (e) {
            console.error("Attachment upload failed:", file.name, e)
          }
        }
        setAttachmentUploading(false)
      }
      setRoute(
        "task-detail",
        { taskId: task.id },
        { routeId: "create-task", params: { projectId } }
      )
    } catch (e) {
      setCreateError(String(e))
    }
    setCreating(false)
  }, [
    projectId,
    title,
    description,
    taskType,
    priority,
    status,
    assignee,
    stagedFiles,
    setRoute,
  ])

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setRoute("task-kanban", { projectId })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{t("task.create")}</h1>
        </div>

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-title">{t("task.title")}</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("task.title")}
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-description">{t("task.description")}</Label>
          <Textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>

        {/* Task Type */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("task.taskType")}</Label>
          <Select value={taskType} onValueChange={setTaskType}>
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

        {/* Priority */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("task.priority")}</Label>
          <Select value={priority} onValueChange={setPriority}>
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

        {/* Status */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("task.statusLabel")}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="backlog">
                {t("task.statusOptions.backlog")}
              </SelectItem>
              <SelectItem value="confirmed">
                {t("task.statusOptions.confirmed")}
              </SelectItem>
              <SelectItem value="in_progress">
                {t("task.statusOptions.inProgress")}
              </SelectItem>
              <SelectItem value="done">
                {t("task.statusOptions.done")}
              </SelectItem>
              <SelectItem value="released">
                {t("task.statusOptions.released")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Assignee */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-assignee">{t("task.assignee")}</Label>
          <Input
            id="task-assignee"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          />
        </div>

        {/* Staged attachments */}
        <div className="flex flex-col gap-1.5">
          <Label>{t("kb.attachments")}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="file"
              className="h-8"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setStagedFiles((prev) => [...prev, f])
                  e.target.value = ""
                }
              }}
            />
          </div>
          {stagedFiles.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="text-[0.75rem] text-muted-foreground">
                {t("kb.stagedFiles")} ({stagedFiles.length})
              </span>
              {stagedFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className="flex items-center gap-2 rounded-md border p-1.5"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[0.8125rem] font-medium truncate">
                    {file.name}
                  </span>
                  <span className="text-[0.75rem] text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      setStagedFiles((prev) => prev.filter((_, i) => i !== idx))
                    }
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create button */}
        {createError && (
          <p className="text-[0.8125rem] text-destructive">
            {t("task.createFailed")}: {createError}
          </p>
        )}
        <Button
          disabled={!title || creating || attachmentUploading}
          onClick={() => void handleCreate()}
          className="w-full"
        >
          {creating || attachmentUploading ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : null}
          {attachmentUploading
            ? t("kb.uploadingAttachment")
            : creating
              ? t("task.creating")
              : t("task.create")}
        </Button>
      </div>
    </ScrollArea>
  )
}
