"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus, Loader2 } from "lucide-react"
import { listTasks, createTask } from "@/lib/platform/api"
import type { TaskInfo, TaskStatus } from "@/lib/platform/types"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export function TaskListTable({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  const router = useRouter()
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [filterType, setFilterType] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("all")

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const list = await listTasks(projectId)
        if (!cancelled) {
          setTasks(list)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [projectId])

  const handleCreateTask = useCallback(async () => {
    setCreating(true)
    try {
      const task = await createTask({
        projectId,
        title: "New task",
        taskType: "bug",
      })
      router.push(`/platform?view=task-detail&id=${task.id}`)
    } catch (e) {
      console.error("Create task failed:", e)
    }
    setCreating(false)
  }, [projectId, router])

  const filteredTasks = tasks.filter((task) => {
    if (filterType !== "all" && task.taskType !== filterType) return false
    if (filterStatus !== "all" && task.status !== filterStatus) return false
    return true
  })

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-muted-foreground">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("task.list")}</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/platform?view=kanban&projectId=${projectId}`)}
          >
            {t("task.kanban")}
          </Button>
          <Button
            size="sm"
            disabled={creating}
            onClick={handleCreateTask}
          >
            {creating ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            {t("task.create")}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by type..."
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="h-7 w-[120px] text-[0.8125rem]"
        />
        <Input
          placeholder="Filter by status..."
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="h-7 w-[120px] text-[0.8125rem]"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[0.8125rem]">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="py-2 pr-2 text-left font-medium">#</th>
              <th className="py-2 pr-2 text-left font-medium">{t("task.title")}</th>
              <th className="py-2 pr-2 text-left font-medium">{t("task.taskType")}</th>
              <th className="py-2 pr-2 text-left font-medium">{t("task.statusManagement")}</th>
              <th className="py-2 pr-2 text-left font-medium">{t("task.priority")}</th>
              <th className="py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted-foreground">
                  {t("task.noTasks")}
                </td>
              </tr>
            ) : (
              filteredTasks.map((task, index) => (
                <tr
                  key={task.id}
                  className="border-b hover:bg-accent/50 cursor-pointer"
                  onClick={() => router.push(`/platform?view=task-detail&id=${task.id}`)}
                >
                  <td className="py-2 pr-2">{index + 1}</td>
                  <td className="py-2 pr-2 font-medium">{task.title}</td>
                  <td className="py-2 pr-2">
                    <Badge variant="outline" className="text-[0.625rem]">{task.taskType}</Badge>
                  </td>
                  <td className="py-2 pr-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[0.625rem]",
                        TASK_STATUS_COLORS[task.status as TaskStatus] ?? "",
                      )}
                    >
                      {TASK_STATUS_LABELS[task.status as TaskStatus] ?? task.status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-2">
                    {task.priority ? (
                      <Badge variant="outline" className="text-[0.625rem]">{task.priority}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[0.75rem]"
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/platform?view=task-detail&id=${task.id}`)
                      }}
                    >
                      {t("task.detail")}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
