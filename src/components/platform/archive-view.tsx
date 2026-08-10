"use client"

import { useEffect, useState, useMemo } from "react"
import { useTranslations } from "next-intl"
import type { TaskInfo, TaskStatus } from "@/lib/platform/types"
import { listTasks } from "@/lib/platform/api"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { TASK_STATUS_COLORS } from "@/lib/platform/types"

interface Props {
  projectId: number
  searchKeyword: string
  filterType: string
  filterPriority: string
}

export function ArchiveView({
  projectId,
  searchKeyword,
  filterType,
  filterPriority,
}: Props) {
  const t = useTranslations("Platform")
  const { setRoute } = useWorkbenchRoute()
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [releaseCodeFilter, setReleaseCodeFilter] = useState("")

  useEffect(() => {
    if (!projectId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    listTasks(projectId, undefined, undefined, undefined, "archived")
      .then((all) => {
        setTasks(all)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [projectId])

  const filtered = useMemo(() => {
    return tasks.filter((task) => {
      if (
        searchKeyword &&
        !task.title.toLowerCase().includes(searchKeyword.toLowerCase())
      )
        return false
      if (filterType !== "all" && task.taskType !== filterType)
        return false
      if (filterPriority !== "all" && task.priority !== filterPriority)
        return false
      if (
        releaseCodeFilter &&
        (!task.archivedReleaseCode ||
          !task.archivedReleaseCode
            .toLowerCase()
            .includes(releaseCodeFilter.toLowerCase()))
      )
        return false
      return true
    })
  }, [tasks, searchKeyword, filterType, filterPriority, releaseCodeFilter])

  const resolveStatusLabel = (status: string) => {
    const keyMap: Record<string, string> = {
      backlog: "task.status.backlog",
      confirmed: "task.status.confirmed",
      in_progress: "task.status.in_progress",
      pending: "task.status.pending",
      done: "task.status.done",
      archived: "task.status.archived",
    }
    const key = keyMap[status]
    return key ? (t(key as never) ?? status) : status
  }

  const resolveTypeLabel = (taskType: string) => {
    const keyMap: Record<string, string> = {
      bug: "task.taskTypeOptions.bug",
      feature: "task.taskTypeOptions.feature",
      task: "task.taskTypeOptions.task",
      improvement: "task.taskTypeOptions.improvement",
    }
    const key = keyMap[taskType]
    return key ? (t(key as never) ?? taskType) : taskType
  }

  if (loading) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {t("task.loading")}
      </p>
    )
  }

  return (
    <div className="h-full overflow-auto px-4 pb-4 pt-4">
      <div className="mb-3">
        <Input
          placeholder={t("task.archiveRelease")}
          value={releaseCodeFilter}
          onChange={(e) => setReleaseCodeFilter(e.target.value)}
          className="max-w-[240px]"
        />
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("task.noArchivedTasks")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[0.75rem] text-muted-foreground">
                <th className="pb-2 font-medium">
                  {t("task.title")}
                </th>
                <th className="pb-2 font-medium">
                  {t("task.taskType")}
                </th>
                <th className="pb-2 font-medium">
                  {t("task.statusLabel")}
                </th>
                <th className="pb-2 font-medium">
                  {t("task.branchesCount")}
                </th>
                <th className="pb-2 font-medium">
                  {t("task.scriptsCount")}
                </th>
                <th className="pb-2 font-medium">
                  {t("task.archiveRelease")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((task) => (
                <tr
                  key={task.id}
                  className="border-b hover:bg-accent/50"
                >
                  <td className="py-2 pr-4">
                    <button
                      className="text-left hover:underline text-[0.875rem]"
                      onClick={() =>
                        setRoute(
                          "task-detail",
                          { taskId: task.id, projectId },
                          { routeId: "task-kanban", params: { projectId, tab: "archive" } }
                        )
                      }
                    >
                      {task.title}
                    </button>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant="outline">
                      {resolveTypeLabel(task.taskType)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={
                        TASK_STATUS_COLORS[task.status as TaskStatus] ?? ""
                      }
                    >
                      {resolveStatusLabel(task.status)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {task.branchCount ?? 0}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {task.dbScriptCount ?? 0}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {task.archivedReleaseCode ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
