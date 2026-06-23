"use client"

import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { usePlatform } from "@/contexts/platform-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Project switcher rendered in the sidebar header area.
 * - When no projects exist: shows a "Create your first project" button.
 * - When projects exist: shows a dropdown to select the active project.
 */
export function ProjectSwitcher() {
  const t = useTranslations("Platform.switcher")
  const { activeProjectId, setActiveProjectId, projects, hasProjects } =
    usePlatform()
  const { setRoute } = useWorkbenchRoute()

  if (!hasProjects) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-8 flex-1 text-[0.8125rem]"
        onClick={() => setRoute("create-project")}
      >
        <Plus className="mr-1 h-3.5 w-3.5" />
        {t("createFirst")}
      </Button>
    )
  }

  return (
    <Select
      value={activeProjectId != null ? String(activeProjectId) : ""}
      onValueChange={(v) => setActiveProjectId(Number(v))}
    >
      <SelectTrigger className="h-8 flex-1 text-[0.875rem]">
        <SelectValue placeholder={t("placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
