"use client"

import { useTranslations } from "next-intl"
import { usePlatform } from "@/contexts/platform-context"
import { useProjectSwitchCoordinator } from "@/hooks/use-project-switch-coordinator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

function projectInitials(name: string | null | undefined): string {
  const label = (name ?? "").trim()
  if (!label) return "?"
  const parts = label.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/**
 * Project switcher rendered in the title bar next to RepoSelector.
 * Uses DropdownMenu style to match RepoSelector.
 * - No projects: hidden (returns null).
 * - Projects exist: shows a dropdown with project names.
 *
 * Switching goes through `useProjectSwitchCoordinator`, so the active tab is
 * retargeted to the new project's root folder (same unified workspace state the
 * folder picker below the chat input drives) and a bottom-right toast confirms
 * the switch — keeping top and bottom switching consistent.
 */
export function ProjectSwitcher() {
  const t = useTranslations("Platform.switcher")
  const { activeProjectId, activeProject, projects, hasProjects } =
    usePlatform()
  const { switchProject } = useProjectSwitchCoordinator()

  // Hide when no projects exist — the sidebar empty-state already provides
  // a "Create project" entry point.
  if (!hasProjects) {
    return null
  }

  const handleSelect = (id: number) => {
    if (id === activeProjectId) return
    switchProject(id)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={activeProject?.name ?? t("placeholder")}
          aria-label={activeProject?.name ?? t("placeholder")}
        >
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-[0.625rem] bg-primary/10 text-primary">
              {projectInitials(activeProject?.name)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            className={p.id === activeProjectId ? "bg-accent" : ""}
            onClick={() => handleSelect(p.id)}
          >
            <Avatar className="h-4 w-4">
              <AvatarFallback className="text-[0.5rem] bg-muted text-muted-foreground">
                {projectInitials(p.name)}
              </AvatarFallback>
            </Avatar>
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
