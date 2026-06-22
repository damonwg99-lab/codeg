"use client"

import { useTranslations } from "next-intl"

export function CreateProjectForm() {
  const t = useTranslations("Platform")
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      {t("project.create")} (Step 4)
    </div>
  )
}
