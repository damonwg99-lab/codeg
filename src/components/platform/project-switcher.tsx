"use client"

import { useTranslations } from "next-intl"
import { Briefcase, ChevronDown } from "lucide-react"
import { usePlatform } from "@/contexts/platform-context"
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
 * - No projects: hidden (returns null).
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

  // Hide when no projects exist — the sidebar empty-state already provides
  // a "Create project" entry point.
  if (!hasProjects) {
    return null
  }

  const handleSelect = (id: number) => {
    if (id === activeProjectId) return
    // Route navigation is handled by useProjectSwitchCoordinator
    // (via the onSwitch callback in FolderTitleBar) — it redirects
    // project-specific pages to their list/kanban views on project switch.
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
