"use client"

import { useTranslations } from "next-intl"

export function TaskListTable({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      {t("task.list")} — Project: {projectId} (Step 6)
    </div>
  )
}
