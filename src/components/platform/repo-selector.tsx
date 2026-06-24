"use client"

import { useMemo, useCallback } from "react"
import { useTranslations } from "next-intl"
import { FolderGit2, ChevronDown } from "lucide-react"
import { usePlatform } from "@/contexts/platform-context"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface RepoOption {
  id: string
  name: string
  folderId: number | null | undefined
}

export function RepoSelector() {
  const t = useTranslations("Platform")
  const { activeProjectId, activeProject, activeProjectRepos } = usePlatform()
  const {
    activeFolderId,
    setActiveFolderId,
    addFolderToWorkspaceById,
    allFolders,
  } = useAppWorkspace()

  // Build option list: [Project root] + [all repos]
  // Must call hooks before any early return (react-hooks/rules-of-hooks)
  const options = useMemo<RepoOption[]>(() => {
    if (!activeProject) return []
    const rootOption: RepoOption = {
      id: "root",
      name: activeProject.name,
      folderId: activeProject.folderId ?? undefined,
    }
    const repoOptions: RepoOption[] = activeProjectRepos.map((r) => ({
      id: String(r.id),
      name: r.name,
      folderId: r.folderId ?? undefined,
    }))
    // Only include repos that have a folder (backend auto-creates them)
    return [rootOption, ...repoOptions]
  }, [activeProject, activeProjectRepos])

  // Determine current selection: match activeFolderId to an option
  const current = useMemo(
    () => options.find((o) => o.folderId === activeFolderId) ?? options[0],
    [options, activeFolderId]
  )

  const handleSelect = useCallback(
    async (folderId: number) => {
      // Ensure the folder is in the workspace before activating it
      const isAlreadyOpen = allFolders.some((f) => f.id === folderId)
      if (!isAlreadyOpen) {
        await addFolderToWorkspaceById(folderId)
      }
      setActiveFolderId(folderId)
    },
    [allFolders, addFolderToWorkspaceById, setActiveFolderId]
  )

  // No project context → hide entirely
  if (!activeProjectId || !activeProject) return null

  // No options at all → hide
  if (options.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[0.8125rem]"
        >
          <FolderGit2 className="h-3.5 w-3.5" />
          <span className="truncate max-w-[120px]">
            {current?.name ?? t("repoSelector.placeholder")}
          </span>
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((opt) => {
          const isSelected = opt.folderId === activeFolderId
          const canSwitch = opt.folderId != null && opt.folderId != undefined
          return (
            <DropdownMenuItem
              key={opt.id}
              className={cn(isSelected && "bg-accent")}
              disabled={!canSwitch}
              onClick={() => {
                if (opt.folderId) handleSelect(opt.folderId)
              }}
            >
              {opt.id === "root" ? t("repoSelector.root") : opt.name}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
