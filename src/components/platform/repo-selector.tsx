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
  /** Whether this option represents the project root directory */
  isRoot: boolean
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

  // Count total git repos: root (if git) + registered sub-repos with folders.
  // Must call hooks before any early return (react-hooks/rules-of-hooks)
  const gitRepoCount = useMemo(() => {
    if (!activeProject) return 0
    const rootFolder = allFolders.find((f) => f.id === activeProject.folderId)
    const rootIsGit = rootFolder?.git_branch != null ? 1 : 0
    const subRepoCount = activeProjectRepos.filter(
      (r) => r.folderId != null
    ).length
    return rootIsGit + subRepoCount
  }, [activeProject, activeProjectRepos, allFolders])

  // Build option list: root (always first) + all sub-repos.
  // Root is always included when there are ≥2 git repos so the user can
  // navigate back to the project base directory from a sub-repo.
  // Labeled with the actual folder name.
  const options = useMemo<RepoOption[]>(() => {
    if (!activeProject) return []
    const result: RepoOption[] = []

    // Always include root as first option when repos exist
    const rootFolder = allFolders.find((f) => f.id === activeProject.folderId)
    if (rootFolder) {
      result.push({
        id: "root",
        name: rootFolder.name,
        folderId: activeProject.folderId ?? undefined,
        isRoot: true,
      })
    }

    // Add registered repos that have a folder (backend auto-creates them)
    for (const r of activeProjectRepos) {
      if (r.folderId != null) {
        const repoFolder = allFolders.find((f) => f.id === r.folderId)
        result.push({
          id: String(r.id),
          name: repoFolder?.name ?? r.name,
          folderId: r.folderId ?? undefined,
          isRoot: false,
        })
      }
    }

    return result
  }, [activeProject, activeProjectRepos, allFolders])

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

  // Only 1 git repo or none → hide; switching projects suffices
  if (gitRepoCount <= 1) return null

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
              {opt.name}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
