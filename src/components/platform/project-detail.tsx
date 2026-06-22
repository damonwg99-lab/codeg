"use client"

import { useTranslations } from "next-intl"

export function ProjectDetail({ projectId }: { projectId: number }) {
  const t = useTranslations("Platform")
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      {t("project.detail")} — ID: {projectId} (Step 5)
    </div>
  )
}
