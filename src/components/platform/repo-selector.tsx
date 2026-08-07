"use client"

import { useMemo, useCallback, useRef } from "react"
import { useTranslations } from "next-intl"
import { GitBranch, ChevronDown } from "lucide-react"
import { usePlatform } from "@/contexts/platform-context"
import { useAppWorkspace } from "@/contexts/app-workspace-shim"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { gitInit } from "@/lib/api"
import { useGitQuickActions } from "@/hooks/use-git-quick-actions"
import {
  RepoGitOperations,
  RepoGitBranchPanel,
  type RepoGitOperationsHandle,
} from "@/components/platform/repo-git-operations"
import type { FolderDetail } from "@/lib/types"

interface RepoOption {
  id: string
  name: string
  folderId: number | null | undefined
  folderPath: string | null
  /** The folder backing this option (used for branch switching + git ops). */
  folder: FolderDetail | null
  /** Whether this option represents the project root directory */
  isRoot: boolean
  /** Whether the directory is a git repo — only git repos get a git-ops fly-out */
  isGit: boolean
}

/** Normalize a folder path for duplicate detection (case + trailing separators). */
function normalizePath(path: string | null | undefined): string {
  if (!path) return ""
  const p = path
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase()
  return p
}

export function RepoSelector() {
  const t = useTranslations("Platform")
  const { activeProjectId, activeProject, activeProjectRepos } = usePlatform()
  const {
    activeFolderId,
    setActiveFolderId,
    addFolderToWorkspaceById,
    allFolders,
    gitHeads,
  } = useAppWorkspace()

  // Each repo's git-operation host (owns the dialogs) is kept alive OUTSIDE the
  // dropdown menu so opening a dialog doesn't unmount it when the menu closes.
  // Menu rows dispatch through this ref registry.
  const opRefs = useRef(new Map<string, RepoGitOperationsHandle | null>())
  const setOpRef = useCallback(
    (id: string) => (el: RepoGitOperationsHandle | null) => {
      if (el) opRefs.current.set(id, el)
      else opRefs.current.delete(id)
    },
    []
  )

  // Build option list: root (always first) + registered sub-repos.
  // A registered repo can resolve to the SAME directory as the project root
  // (scanning a git-rooted project re-registers the root; the platform_repo
  // folder may be a separate row whose folderId differs from the project's
  // root folderId). Collapse those by folder id AND by normalized path so the
  // root never appears twice.
  const options = useMemo<RepoOption[]>(() => {
    if (!activeProject) return []
    const result: RepoOption[] = []
    const seenPaths = new Set<string>()

    const rootFolderId = activeProject.folderId ?? undefined
    const rootFolder = allFolders.find((f) => f.id === rootFolderId)
    if (rootFolder) {
      const rootPath = normalizePath(rootFolder.path)
      if (rootPath) seenPaths.add(rootPath)
      result.push({
        id: "root",
        name: rootFolder.name,
        folderId: rootFolderId,
        folderPath: rootFolder.path ?? null,
        folder: rootFolder,
        isRoot: true,
        isGit: gitHeads.get(rootFolder.id)?.is_repo === true,
      })
    }

    for (const r of activeProjectRepos) {
      if (r.folderId == null) continue
      // Skip a sub-repo that is actually the project root (same folder id).
      if (rootFolderId != null && r.folderId === rootFolderId) continue
      const repoFolder = allFolders.find((f) => f.id === r.folderId)
      // Skip if this repo's directory already appears as the root (or an
      // earlier repo) — e.g. the root registered under a different folder row.
      const repoPath = normalizePath(repoFolder?.path)
      if (repoPath && seenPaths.has(repoPath)) continue
      if (repoPath) seenPaths.add(repoPath)
      result.push({
        id: String(r.id),
        name: repoFolder?.name ?? r.name,
        folderId: r.folderId,
        folderPath: repoFolder?.path ?? null,
        folder: repoFolder ?? null,
        isRoot: false,
        // Registered project repos are git repos by definition (each carries a
        // gitUrl); `git_branch`/`gitHeads` may not be resolved yet.
        isGit: true,
      })
    }

    return result
  }, [activeProject, activeProjectRepos, allFolders, gitHeads])

  const current = useMemo(
    () => options.find((o) => o.folderId === activeFolderId) ?? options[0],
    [options, activeFolderId]
  )

  // The project root backs the "initialize git repository" action shown when
  // the project has no git repos yet — matching the below-chat-input branch
  // dropdown's non-repo state. Reuses the shared git-task engine so a success
  // refreshes the folder + broadcasts branch-changed, flipping the root to a
  // git repo (and singleGit) right away.
  const rootOption = options.find((o) => o.isRoot) ?? null
  const {
    running: initRunning,
    runGitTask,
    dialogs: gitDialogs,
  } = useGitQuickActions({
    folderId: rootOption?.folderId ?? null,
    folderPath: rootOption?.folderPath ?? null,
  })

  const hasGitRepos = options.some((o) => o.isGit)

  const handleSelect = useCallback(
    async (folderId: number) => {
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

  // When there is exactly one git repo, the dropdown opens straight into its
  // branch/operations panel — no need to pick a repo first then drill down.
  const singleGit =
    options.filter((o) => o.isGit).length === 1
      ? (options.find((o) => o.isGit) ?? null)
      : null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[0.8125rem]"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span className="truncate max-w-[110px]">
              {current?.name ?? t("repoSelector.placeholder")}
            </span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        {singleGit ? (
          <DropdownMenuContent
            align="start"
            className="w-[22rem] p-0 overflow-visible"
          >
            <RepoGitBranchPanel
              host={() => opRefs.current.get(singleGit.id) ?? null}
              folder={singleGit.folder}
            />
          </DropdownMenuContent>
        ) : (
          <DropdownMenuContent align="start" className="min-w-52">
            {options.map((opt) => {
              const isSelected = opt.folderId === activeFolderId
              const canSwitch = opt.folderId != null

              // A non-git directory is kept as a plain switchable target only
              // when the project HAS git repos (so the project root stays
              // selectable beside its sub-repos). With no git repos the root is
              // redundant — the init entry below covers it.
              if (!opt.isGit) {
                if (!hasGitRepos) return null
                return (
                  <DropdownMenuItem
                    key={opt.id}
                    className={cn(isSelected && "bg-accent")}
                    disabled={!canSwitch}
                    onClick={() => {
                      if (opt.folderId) void handleSelect(opt.folderId)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                  </DropdownMenuItem>
                )
              }

              return (
                <DropdownMenuSub key={opt.id}>
                  <DropdownMenuSubTrigger
                    className={cn(isSelected && "bg-accent")}
                    disabled={!canSwitch}
                    onClick={() => {
                      // Click switches the repo. (Radix's SubTrigger select
                      // handler preventDefaults and swallows onSelect, so we
                      // hook the native click instead; hover still opens the
                      // fly-out without switching.)
                      if (opt.folderId) void handleSelect(opt.folderId)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                  </DropdownMenuSubTrigger>
                  {/* No overflow-hidden: the branch list's inner shell clips to
                  the rounding so its right-side action bubble can overflow. */}
                  <DropdownMenuSubContent className="w-[22rem] p-0 overflow-visible">
                    <RepoGitBranchPanel
                      host={() => opRefs.current.get(opt.id) ?? null}
                      folder={opt.folder}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )
            })}
            {/* No git repos yet: offer to initialize the project root as a git
                repo, mirroring the below-chat-input branch dropdown's non-repo
                state so the two stay consistent. */}
            {!hasGitRepos && rootOption?.folderPath && (
              <DropdownMenuItem
                disabled={initRunning}
                onClick={() => {
                  void runGitTask(t("repoSelector.initGitRepo"), () =>
                    gitInit(rootOption.folderPath!)
                  )
                }}
              >
                <GitBranch className="h-4 w-4" />
                <span>{t("repoSelector.initGitRepo")}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        )}
      </DropdownMenu>

      {/* Git-operation hosts + the init task's shared conflict/stash dialogs
          stay mounted here, outside the dropdown, keyed per repo. Only git
          repos mount a host (non-git dirs have no git-ops fly-out). */}
      {gitDialogs}
      {options
        .filter((opt) => opt.isGit)
        .map((opt) => (
          <RepoGitOperations
            key={opt.id}
            ref={setOpRef(opt.id)}
            folder={opt.folder}
          />
        ))}
    </>
  )
}
