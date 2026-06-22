"use client"

import { useTranslations } from "next-intl"

export function TaskKanban({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      {t("task.kanban")} — Project: {projectId} (Step 6)
    </div>
  )
}
