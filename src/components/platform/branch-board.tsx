"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  RefreshCw,
  Trash2,
  Pencil,
  Archive,
  ArchiveRestore,
  GitMerge,
  Upload,
  Download,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ConflictDialog } from "@/components/layout/conflict-dialog"
import { usePlatform } from "@/contexts/platform-context"

import {
  getProjectBranchMatrix,
  listBranchStates,
  upsertBranchState,
  addExistingWorktree,
  removeTempWorktree,
  pullBranch,
} from "@/lib/platform/api"
import {
  gitStatus,
  gitMerge,
  gitDeleteBranch,
  gitFetch,
  gitListAllBranches,
  openWorktreeFolder,
  openPushWindow,
} from "@/lib/api"
import { useGitCredential } from "@/contexts/git-credential-context"
import {
  canMerge,
  envCellState,
  filterRows,
  isFullyMerged,
  resolveEffectiveEnv,
  unmergedEnvs,
} from "@/lib/platform/branch-board"
import type {
  BranchRow,
  BranchStateInfo,
  EnvKey,
  ProjectRepoInfo,
  RepoBranchMatrix,
} from "@/lib/platform/types"
import type { GitConflictInfo } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  projectId: number
}

interface DirtyBlock {
  repoName: string
  paths: string[]
}

interface ConflictState {
  info: GitConflictInfo
  repo: ProjectRepoInfo
  targetPath: string
  targetFolderId: number
  temp: boolean
}

interface NoteEdit {
  repoId: number
  branch: string
  value: string
}

const ENVS: EnvKey[] = ["dev", "uat", "prd"]
const PAGE_SIZE = 50

export function BranchBoard({ projectId }: Props) {
  const t = useTranslations("Platform")
  const { activeProject, activeProjectRepos } = usePlatform()
  const { withCredentialRetry } = useGitCredential()

  const [matrices, setMatrices] = useState<RepoBranchMatrix[]>([])
  const [states, setStates] = useState<Map<string, BranchStateInfo>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [repoFilter, setRepoFilter] = useState<string>("all")
  const [archived, setArchived] = useState(false)
  const [onlyUnmerged, setOnlyUnmerged] = useState(false)
  const [envFilter, setEnvFilter] = useState<"all" | EnvKey>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "merged" | "unmerged">(
    "all"
  )
  const [onlyNeedsPush, setOnlyNeedsPush] = useState(false)
  const [keywordInput, setKeywordInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)

  const [dirtyBlock, setDirtyBlock] = useState<DirtyBlock | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    repo: ProjectRepoInfo
    branch: string
  } | null>(null)
  const [noteEdit, setNoteEdit] = useState<NoteEdit | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [mergeTarget, setMergeTarget] = useState<{
    repo: ProjectRepoInfo
    row: BranchRow
    env: EnvKey
  } | null>(null)
  const [mergePick, setMergePick] = useState<{
    repo: ProjectRepoInfo
    row: BranchRow
  } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{
    repoId: number
    branch: string
  } | null>(null)
  const [pushPrompt, setPushPrompt] = useState<{
    repo: ProjectRepoInfo
    branch: string
  } | null>(null)

  const stateKey = (repoId: number, branch: string) => `${repoId}:${branch}`

  const refresh = useCallback(
    async (force = false) => {
      if (!projectId) return
      setLoading(true)
      setError(null)
      try {
        const [m, s] = await Promise.all([
          getProjectBranchMatrix(projectId, force),
          listBranchStates(projectId),
        ])
        setMatrices(m ?? [])
        setStates(
          new Map((s ?? []).map((x) => [stateKey(x.repoId, x.branch), x]))
        )
      } catch (e) {
        const obj = (e ?? {}) as Record<string, unknown>
        const parts = [
          typeof e === "string" ? e : obj.message,
          obj.detail,
          obj.code,
        ].filter(Boolean)
        setError(parts.length ? parts.join(" | ") : JSON.stringify(e))
        console.error("branch matrix failed:", e)
      } finally {
        setLoading(false)
      }
    },
    [projectId]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  const repoById = useMemo(() => {
    const map = new Map<number, ProjectRepoInfo>()
    for (const r of activeProjectRepos) map.set(r.id, r)
    return map
  }, [activeProjectRepos])

  const visibleMatrices = useMemo(
    () =>
      repoFilter === "all"
        ? matrices
        : matrices.filter((m) => String(m.repoId) === repoFilter),
    [matrices, repoFilter]
  )

  const flatRows = useMemo(() => {
    const out: { repoId: number; repoName: string; row: BranchRow }[] = []
    for (const m of visibleMatrices) {
      const rows = filterRows(
        m.branches,
        (b) => states.get(stateKey(m.repoId, b)),
        {
          archived,
          onlyUnmerged,
          keyword,
          env: envFilter,
          status: statusFilter,
          onlyNeedsPush,
        }
      )
      for (const row of rows) {
        out.push({ repoId: m.repoId, repoName: m.repoName, row })
      }
    }
    // Most recent commit first.
    out.sort((a, b) =>
      (b.row.lastCommitAt ?? "").localeCompare(a.row.lastCommitAt ?? "")
    )
    return out
  }, [
    visibleMatrices,
    states,
    archived,
    onlyUnmerged,
    keyword,
    envFilter,
    statusFilter,
    onlyNeedsPush,
  ])

  const totalPages = Math.max(1, Math.ceil(flatRows.length / PAGE_SIZE))
  const pageRows = useMemo(
    () => flatRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [flatRows, page]
  )

  // Show an env column only when at least one visible repo has it configured.
  const shownEnvs = useMemo(
    () =>
      ENVS.filter((e) => visibleMatrices.some((m) => (m.envs ?? []).includes(e))),
    [visibleMatrices]
  )

  useEffect(() => {
    setPage(1)
  }, [
    repoFilter,
    archived,
    onlyUnmerged,
    keyword,
    envFilter,
    statusFilter,
    onlyNeedsPush,
  ])

  // Debounce the search box: only filter after the user stops typing.
  useEffect(() => {
    const id = setTimeout(() => setKeyword(keywordInput), 300)
    return () => clearTimeout(id)
  }, [keywordInput])

  const handleSync = async () => {
    setBusy(true)
    try {
      for (const m of visibleMatrices) {
        const repo = repoById.get(m.repoId)
        if (repo) await gitFetch(repo.localDir).catch(() => {})
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const doPush = (repo: ProjectRepoInfo, branch: string) => {
    if (repo.folderId == null) {
      toast.error(t("task.mergeFailed"))
      return
    }
    void openPushWindow(repo.folderId, branch)
  }

  const doPull = async (repo: ProjectRepoInfo, branch: string) => {
    setBusy(true)
    try {
      const res = await withCredentialRetry(
        (creds) => pullBranch(repo.localDir, branch, creds),
        { folderPath: repo.localDir }
      )
      if (res.conflict?.has_conflicts && repo.folderId != null) {
        setConflict({
          info: res.conflict,
          repo,
          targetPath: repo.localDir,
          targetFolderId: repo.folderId,
          temp: false,
        })
        return
      }
      await refresh()
    } catch {
      toast.error(t("task.pullFailed"))
    } finally {
      setBusy(false)
    }
  }

  const performMerge = async (
    repo: ProjectRepoInfo,
    row: BranchRow,
    env: EnvKey
  ) => {
    if (!activeProject) return
    const envBranch = resolveEffectiveEnv(repo, activeProject, env)
    if (!envBranch) {
      toast.error(t("task.notConfigured"))
      return
    }
    if (envBranch === row.branch) return

    setBusy(true)
    let tempPath: string | null = null
    try {
      // Hard gate: source tree must be clean.
      const status = await gitStatus(repo.localDir)
      const gate = canMerge(status)
      if (!gate.ok) {
        setDirtyBlock({ repoName: repo.name, paths: gate.dirtyPaths })
        return
      }

      const list = await gitListAllBranches(repo.localDir)
      let targetPath = repo.localDir
      let targetFolderId = repo.folderId ?? 0
      let temp = false

      if (list.main_worktree_branch !== envBranch) {
        const parent = repo.localDir.replace(/[\\/][^\\/]*$/, "")
        tempPath = `${parent}/.codeg-wt-${repo.name}-${env}-${Date.now()}`
        await addExistingWorktree(repo.localDir, tempPath, envBranch)
        const folder = await openWorktreeFolder(tempPath, repo.folderId ?? 0)
        targetPath = tempPath
        targetFolderId = folder.id
        temp = true
      }

      const res = await gitMerge(targetPath, row.branch)
      if (res.conflict?.has_conflicts) {
        setConflict({
          info: res.conflict,
          repo,
          targetPath,
          targetFolderId,
          temp,
        })
        return
      }
      if (temp && tempPath) {
        await removeTempWorktree(repo.localDir, tempPath).catch(() => {})
      }
      toast.success(
        res.merged_commits === 0
          ? t("task.mergeNoNewCommits")
          : t("task.mergeSuccess")
      )
      await refresh()
      // Merging into an env branch is local only — offer to push it.
      if (res.merged_commits > 0) {
        setPushPrompt({ repo, branch: envBranch })
      }
    } catch {
      if (tempPath) {
        await removeTempWorktree(repo.localDir, tempPath).catch(() => {})
      }
      toast.error(t("task.mergeFailed"))
    } finally {
      setBusy(false)
    }
  }

  const finishConflict = () => {
    const c = conflict
    setConflict(null)
    if (c?.temp) {
      void removeTempWorktree(c.repo.localDir, c.targetPath).catch(() => {})
    }
    void refresh()
  }

  const toggleArchive = async (repoId: number, branch: string) => {
    const cur = states.get(stateKey(repoId, branch))
    try {
      const next = await upsertBranchState(repoId, branch, {
        isArchived: !(cur?.isArchived ?? false),
      })
      setStates((prev) => {
        const m = new Map(prev)
        m.set(stateKey(next.repoId, next.branch), next)
        return m
      })
    } catch {
      toast.error(t("task.mergeFailed"))
    }
  }

  const saveNote = async () => {
    if (!noteEdit) return
    try {
      const next = await upsertBranchState(noteEdit.repoId, noteEdit.branch, {
        description: noteEdit.value || null,
      })
      setStates((prev) => {
        const m = new Map(prev)
        m.set(stateKey(next.repoId, next.branch), next)
        return m
      })
      setNoteEdit(null)
    } catch {
      toast.error(t("task.mergeFailed"))
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const { repo, branch } = deleteTarget
    setDeleteTarget(null)
    try {
      await gitDeleteBranch(repo.localDir, branch)
      await refresh()
    } catch {
      toast.error(t("task.mergeFailed"))
    }
  }

  if (loading) {
    return (
      <p className="p-4 text-sm text-muted-foreground">{t("task.loading")}</p>
    )
  }

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Select value={repoFilter} onValueChange={setRepoFilter}>
          <SelectTrigger size="sm" className="w-[160px] text-[0.8125rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("task.allRepos")}</SelectItem>
            {activeProjectRepos.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs
          value={archived ? "archived" : "active"}
          onValueChange={(v) => setArchived(v === "archived")}
        >
          <TabsList>
            <TabsTrigger value="active">{t("task.activeBranches")}</TabsTrigger>
            <TabsTrigger value="archived">
              {t("task.archivedBranches")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyUnmerged}
            onChange={(e) => setOnlyUnmerged(e.target.checked)}
          />
          {t("task.onlyUnmerged")}
        </label>

        {shownEnvs.length > 0 && (
          <>
            <Select
              value={envFilter}
              onValueChange={(v) => setEnvFilter(v as "all" | EnvKey)}
            >
              <SelectTrigger size="sm" className="w-[110px] text-[0.8125rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("task.envAll")}</SelectItem>
                {shownEnvs.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t(`task.env${e[0].toUpperCase()}${e.slice(1)}` as never)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as "all" | "merged" | "unmerged")
              }
            >
              <SelectTrigger size="sm" className="w-[110px] text-[0.8125rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("task.statusAll")}</SelectItem>
                <SelectItem value="merged">{t("task.envMerged")}</SelectItem>
                <SelectItem value="unmerged">
                  {t("task.envUnmerged")}
                </SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyNeedsPush}
            onChange={(e) => setOnlyNeedsPush(e.target.checked)}
          />
          {t("task.onlyNeedsPush")}
        </label>

        <Input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          placeholder={t("task.searchBranch")}
          className="h-8 w-[180px] text-[0.8125rem]"
        />

        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleSync()}
          disabled={busy}
        >
          {t("task.syncRemote")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refresh(true)}
          disabled={busy}
        >
          <RefreshCw className={cn("mr-1 h-3.5 w-3.5", busy && "animate-spin")} />
          {t("task.refresh")}
        </Button>
      </div>

      {/* Flat branch list */}
      {flatRows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {error ? `加载分支失败：${error}` : t("task.emptyBranches")}
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[0.75rem] text-muted-foreground">
                <th className="sticky top-0 z-10 bg-background px-3 py-2 font-medium">
                  {t("task.colBranch")}
                </th>
                <th className="sticky top-0 z-10 bg-background px-2 py-2 font-medium">
                  {t("task.colCreated")}
                </th>
                <th className="sticky top-0 z-10 bg-background px-2 py-2 font-medium">
                  {t("task.colAuthor")}
                </th>
                {shownEnvs.map((e) => (
                  <th
                    key={e}
                    className="sticky top-0 z-10 bg-background px-2 py-2 font-medium"
                  >
                    {t(`task.env${e[0].toUpperCase()}${e.slice(1)}` as never)}
                  </th>
                ))}
                <th className="sticky top-0 z-10 bg-background px-2 py-2 font-medium">
                  {t("task.colLastCommit")}
                </th>
                <th className="sticky top-0 z-10 bg-background px-2 py-2 font-medium">
                  {t("task.colRemote")}
                </th>
                <th className="sticky top-0 z-10 bg-background px-2 py-2 font-medium">
                  {t("task.colNote")}
                </th>
                <th className="sticky top-0 z-10 bg-background px-3 py-2 font-medium">
                  {t("task.colActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ repoId, repoName, row }) => {
                const repo = repoById.get(repoId)
                const state = states.get(stateKey(repoId, row.branch))
                return (
                  <tr
                    key={`${repoId}:${row.branch}`}
                    className="border-b last:border-0 hover:bg-accent/40"
                  >
                    <td className="px-3 py-2 font-mono text-[0.8125rem]">
                      {repoName}:{row.branch}
                      {isFullyMerged(row) && (
                        <Badge
                          variant="secondary"
                          className="ml-2 text-[0.625rem]"
                        >
                          {t("task.suggestArchive")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {row.createdAt
                        ? `${row.createdAtSource === "first_commit" ? "~" : ""}${row.createdAt.slice(0, 10)}`
                        : "—"}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {row.createdBy || "—"}
                    </td>
                    {shownEnvs.map((e) => {
                        const cell = envCellState(row, e)
                        const label =
                          cell.kind === "env"
                            ? "—"
                            : cell.kind === "unconfigured"
                              ? t("task.notConfigured")
                              : cell.kind === "unmerged"
                                ? t("task.envUnmerged")
                                : cell.mergeVia === "fast_forward"
                                  ? "—（FF）"
                                  : cell.mergeDate
                                    ? cell.mergeDate.slice(0, 10)
                                    : t("task.envMerged")
                        return (
                          <td key={e} className="px-2 py-2">
                            <span
                              className={cn(
                                "text-[0.75rem]",
                                cell.kind === "merged" &&
                                  "text-green-600 dark:text-green-400",
                                (cell.kind === "unmerged" ||
                                  cell.kind === "env" ||
                                  cell.kind === "unconfigured") &&
                                  "text-muted-foreground"
                              )}
                            >
                              {label}
                            </span>
                          </td>
                        )
                      })}
                    <td className="px-2 py-2 text-muted-foreground">
                      {row.lastCommitAt ? row.lastCommitAt.slice(0, 10) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      {!row.hasRemote ? (
                        <span className="text-[0.7rem] text-muted-foreground">
                          {t("task.remoteLocalOnly")}
                        </span>
                      ) : row.needsPush && row.needsPull ? (
                        <span className="text-[0.7rem] text-destructive">
                          {t("task.diverged")}
                        </span>
                      ) : row.needsPush ? (
                        <span className="text-[0.7rem] text-orange-600 dark:text-orange-400">
                          {t("task.needsPush")}
                        </span>
                      ) : row.needsPull ? (
                        <span className="text-[0.7rem] text-blue-600 dark:text-blue-400">
                          {t("task.needsPull")}
                        </span>
                      ) : (
                        <span className="text-[0.7rem] text-green-600 dark:text-green-400">
                          {t("task.remoteSynced")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">
                      {state?.description || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {!row.isEnvBranch &&
                          repo &&
                          unmergedEnvs(row).length > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              title={t("task.mergeTo")}
                              onClick={() => setMergePick({ repo, row })}
                            >
                              <GitMerge className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        {repo && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title={t("task.push")}
                            disabled={repo.folderId == null}
                            onClick={() => doPush(repo, row.branch)}
                          >
                            <Upload className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {repo && row.hasRemote && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title={t("task.pull")}
                            disabled={!row.needsPull || busy}
                            onClick={() => void doPull(repo, row.branch)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={
                            state?.isArchived
                              ? t("task.restoreBranch")
                              : t("task.archiveBranch")
                          }
                          onClick={() => {
                            if (state?.isArchived) {
                              void toggleArchive(repoId, row.branch)
                            } else {
                              setArchiveTarget({ repoId, branch: row.branch })
                            }
                          }}
                        >
                          {state?.isArchived ? (
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={t("task.editNote")}
                          onClick={() =>
                            setNoteEdit({
                              repoId,
                              branch: row.branch,
                              value: state?.description ?? "",
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {!row.isEnvBranch && repo && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              setDeleteTarget({ repo, branch: row.branch })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {flatRows.length > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-[0.8125rem] shrink-0">
          <span className="text-muted-foreground">
            {page} / {totalPages} · {flatRows.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {t("task.prevPage")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t("task.nextPage")}
          </Button>
        </div>
      )}

      {/* Push after env merge */}
      <AlertDialog
        open={pushPrompt !== null}
        onOpenChange={(o) => !o && setPushPrompt(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.pushAfterMergeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.pushAfterMergeBody", { env: pushPrompt?.branch ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.pushLater")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = pushPrompt
                setPushPrompt(null)
                if (p) doPush(p.repo, p.branch)
              }}
            >
              {t("task.pushNow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirm */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(o) => !o && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.archiveConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.archiveConfirmBody", {
                branch: archiveTarget?.branch ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const a = archiveTarget
                setArchiveTarget(null)
                if (a) void toggleArchive(a.repoId, a.branch)
              }}
            >
              {t("task.archiveBranch")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pick target environment */}
      <Dialog
        open={mergePick !== null}
        onOpenChange={(o) => !o && setMergePick(null)}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>{t("task.mergeTo")}</DialogTitle>
          </DialogHeader>
          <p className="font-mono text-[0.8125rem] text-muted-foreground">
            {mergePick?.row.branch}
          </p>
          <div className="flex flex-col gap-2">
            {(mergePick ? unmergedEnvs(mergePick.row) : []).map((e) => (
              <Button
                key={e}
                variant="outline"
                onClick={() => {
                  const p = mergePick
                  setMergePick(null)
                  if (p) setMergeTarget({ repo: p.repo, row: p.row, env: e })
                }}
              >
                {t("task.mergeTo")}{" "}
                {t(`task.env${e[0].toUpperCase()}${e.slice(1)}` as never)}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge confirm (safety gate) */}
      <AlertDialog
        open={mergeTarget !== null}
        onOpenChange={(o) => !o && setMergeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.mergeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.mergeConfirmBody", {
                branch: mergeTarget?.row.branch ?? "",
                env:
                  mergeTarget && activeProject
                    ? (resolveEffectiveEnv(
                        mergeTarget.repo,
                        activeProject,
                        mergeTarget.env
                      ) ?? mergeTarget.env.toUpperCase())
                    : "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const m = mergeTarget
                setMergeTarget(null)
                if (m) void performMerge(m.repo, m.row, m.env)
              }}
            >
              {t("task.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dirty gate */}
      <AlertDialog
        open={dirtyBlock !== null}
        onOpenChange={(o) => !o && setDirtyBlock(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.dirtyBlockTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.dirtyBlockBody")}
              <br />
              <span className="font-mono text-xs">
                {dirtyBlock?.paths.join(", ")}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.deleteBranch")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.deleteBranchConfirm", { branch: deleteTarget?.branch ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("task.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Note edit */}
      <Dialog open={noteEdit !== null} onOpenChange={(o) => !o && setNoteEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("task.editNote")}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={noteEdit?.value ?? ""}
            onChange={(e) =>
              setNoteEdit((prev) =>
                prev ? { ...prev, value: e.target.value } : prev
              )
            }
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteEdit(null)}>
              {t("task.cancel")}
            </Button>
            <Button onClick={() => void saveNote()}>{t("task.saveNote")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict resolution (reuses the shared merge tool) */}
      <ConflictDialog
        conflictInfo={conflict?.info ?? null}
        folderId={conflict?.targetFolderId ?? 0}
        folderPath={conflict?.targetPath ?? ""}
        onClose={finishConflict}
        onResolved={finishConflict}
      />
    </div>
  )
}