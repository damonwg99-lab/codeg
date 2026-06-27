"use client"

import { useTranslations } from "next-intl"
import { Briefcase, ChevronDown, Plus } from "lucide-react"
import { usePlatform } from "@/contexts/platform-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

interface ProjectSwitcherProps {
  onSwitch?: (newProjectId: number) => void
}

/**
 * Project switcher rendered in the title bar next to RepoSelector.
 * Uses DropdownMenu style to match RepoSelector.
 * - No projects: shows a "Create project" button.
 * - Projects exist: shows a dropdown with project names.
 */
export function ProjectSwitcher({ onSwitch }: ProjectSwitcherProps) {
  const t = useTranslations("Platform.switcher")
  const {
    activeProjectId,
    setActiveProjectId,
    activeProject,
    projects,
    hasProjects,
  } = usePlatform()
  const { setRoute } = useWorkbenchRoute()

  if (!hasProjects) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 text-[0.8125rem]"
        onClick={() => setRoute("create-project")}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("createFirst")}
      </Button>
    )
  }

  const handleSelect = (id: number) => {
    if (id === activeProjectId) return
    if (onSwitch) {
      onSwitch(id)
    } else {
      setActiveProjectId(id)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[0.8125rem]"
        >
          <Briefcase className="h-3.5 w-3.5" />
          <span className="truncate max-w-[120px]">
            {activeProject?.name ?? t("placeholder")}
          </span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            className={p.id === activeProjectId ? "bg-accent" : ""}
            onClick={() => handleSelect(p.id)}
          >
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
