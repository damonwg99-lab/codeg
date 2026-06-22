"use client"

import { useTranslations } from "next-intl"

export function TaskDetail({ taskId }: { taskId: number }) {
  const t = useTranslations("Platform")
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      {t("task.detail")} — ID: {taskId} (Step 7)
    </div>
  )
}
