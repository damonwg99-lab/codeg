"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { RefreshCw } from "lucide-react"

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
import { BranchDetailPanel } from "@/components/platform/branch-detail-panel"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ConflictDialog } from "@/components/layout/conflict-dialog"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
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
  gitDeleteBranchRemote,
  gitFetch,
  openWorktreeFolder,
  openPushWindow,
  resolveWorktreeFolder,
} from "@/lib/api"
import { useGitCredential } from "@/contexts/git-credential-context"
import { errorText } from "@/lib/platform/errors"
import {
  canMerge,
  envCellLabel,
  envCellState,
  filterRows,
  remoteCountsLabel,
  remoteStatusKey,
  resolveEffectiveEnv,
} from "@/lib/platform/branch-board"
import type {
  BranchRow,
  BranchStateInfo,
  EnvKey,
  ProjectRepoInfo,
  RemoteState,
  RepoBranchMatrix,
} from "@/lib/platform/types"
import type { GitConflictInfo } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  projectId: number
  /**
   * Whether the board's tab is currently showing.
   *
   * The parent keeps the board mounted (`forceMount`) so filters, pagination
   * and the split layout survive tab switches. Without this flag that also
   * meant the full multi-repo git scan ran on page load for users who never
   * open the tab, while users who opened it an hour later saw that stale first
   * snapshot. Defaults to `true` for standalone use.
   */
  active?: boolean
}

/** How long a matrix snapshot stays good while the tab is hidden. */
const STALE_AFTER_MS = 60_000

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

/**
 * Whether a failed `git branch -d` is the "has unmerged commits" refusal, the
 * only one a `-D` retry can get past.
 */
function isUnmergedDeleteError(e: unknown): boolean {
  return /not fully merged/i.test(errorText(e))
}

/** Text colour for a remote-state chip, matching the detail panel. */
function remoteTone(state: RemoteState): string {
  switch (state) {
    case "synced":
      return "text-green-600 dark:text-green-400"
    case "ahead":
      return "text-orange-600 dark:text-orange-400"
    case "behind":
      return "text-blue-600 dark:text-blue-400"
    case "diverged":
      return "text-destructive"
    default:
      return "text-muted-foreground"
  }
}

export function BranchBoard({ projectId, active = true }: Props) {
  const t = useTranslations("Platform")
  const { activeProject, activeProjectRepos } = usePlatform()
  const { withCredentialRetry } = useGitCredential()

  const [matrices, setMatrices] = useState<RepoBranchMatrix[]>([])
  const [states, setStates] = useState<Map<string, BranchStateInfo>>(new Map())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [repoFilter, setRepoFilter] = useState<string>("all")
  const [archived, setArchived] = useState(false)
  const [onlyUnmerged, setOnlyUnmerged] = useState(false)
  const [envFilter, setEnvFilter] = useState<"all" | EnvKey>("all")
  const [statusFilter, setStatusFilter] = useState<
    "all" | "merged" | "unmerged"
  >("all")
  const [onlyNeedsPush, setOnlyNeedsPush] = useState(false)
  const [onlyNeedsPull, setOnlyNeedsPull] = useState(false)
  const [onlyCurrent, setOnlyCurrent] = useState(false)
  const [keywordInput, setKeywordInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)

  const [dirtyBlock, setDirtyBlock] = useState<DirtyBlock | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    repo: ProjectRepoInfo
    row: BranchRow
    branch: string
  } | null>(null)
  // Flip to true after a failed (unmerged) delete so the retry uses -D.
  const [forceDelete, setForceDelete] = useState(false)
  // Whether the delete should also remove the branch on the remote.
  const [deleteRemote, setDeleteRemote] = useState(false)
  const [noteEdit, setNoteEdit] = useState<NoteEdit | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [mergeTarget, setMergeTarget] = useState<{
    repo: ProjectRepoInfo
    row: BranchRow
    env: EnvKey
  } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{
    repoId: number
    branch: string
  } | null>(null)
  const [pushPrompt, setPushPrompt] = useState<{
    repo: ProjectRepoInfo
    branch: string
  } | null>(null)
  const [detail, setDetail] = useState<{
    repo: ProjectRepoInfo
    row: BranchRow
  } | null>(null)

  const stateKey = (repoId: number, branch: string) => `${repoId}:${branch}`

  // Set true when a conflict is resolved/aborted so a following dialog close
  // can distinguish "done" from "dismissed without resolving".
  const conflictResolvedRef = useRef(false)

  // When the current snapshot was loaded (0 = never), so becoming visible can
  // decide between reusing it and refetching.
  const loadedAtRef = useRef(0)
  // Whether rows are currently on screen. A ref, not `matrices.length`, so
  // `refresh` keeps a stable identity and the visibility effect below is not
  // re-armed by its own result.
  const hasRowsRef = useRef(false)
  // Guards the visibility effect against firing a second scan while the first
  // is still in flight (the stamp is only written once it succeeds).
  const inFlightRef = useRef(false)

  const refresh = useCallback(
    async (force = false) => {
      if (!projectId) return
      // Only the very first load swaps the whole board to a placeholder;
      // subsequent refreshes keep the DOM (dialogs, scroll position) intact.
      inFlightRef.current = true
      setRefreshing(true)
      setError(null)
      try {
        const [m, s] = await Promise.all([
          getProjectBranchMatrix(projectId, force),
          listBranchStates(projectId),
        ])
        setMatrices(m ?? [])
        hasRowsRef.current = (m ?? []).length > 0
        setStates(
          new Map((s ?? []).map((x) => [stateKey(x.repoId, x.branch), x]))
        )
        // Keep the open detail panel on fresh data; close it when its branch
        // no longer exists (e.g. it was just deleted).
        setDetail((prev) => {
          if (!prev) return null
          const row = (m ?? [])
            .find((x) => x.repoId === prev.repo.id)
            ?.branches.find((b) => b.branch === prev.row.branch)
          return row ? { ...prev, row } : null
        })
        loadedAtRef.current = Date.now()
        setLoading(false)
      } catch (e) {
        const detail = errorText(e)
        setError(detail)
        console.error("branch matrix failed:", e)
        // The inline error only renders on an empty board, so a failure that
        // leaves the previous rows on screen would otherwise show nothing at
        // all beyond the spinner stopping.
        if (hasRowsRef.current) {
          toast.error(t("task.opFailed", { action: t("task.refresh"), detail }))
        }
      } finally {
        inFlightRef.current = false
        setRefreshing(false)
        setLoading(false)
      }
    },
    [projectId, t]
  )

  // Load on first becoming visible, and again when the snapshot has gone stale
  // while the tab was hidden.
  useEffect(() => {
    if (!active || inFlightRef.current) return
    const loadedAt = loadedAtRef.current
    if (loadedAt !== 0 && Date.now() - loadedAt <= STALE_AFTER_MS) return
    void refresh()
  }, [active, refresh])

  const repoById = useMemo(() => {
    const map = new Map<number, ProjectRepoInfo>()
    for (const r of activeProjectRepos) map.set(r.id, r)
    return map
  }, [activeProjectRepos])

  // Absolute repo paths come from the backend matrix (repoPathOf(repo) may be
  // relative to the project root, which git commands would resolve wrongly).
  const pathByRepoId = useMemo(() => {
    const map = new Map<number, string>()
    for (const mat of matrices) map.set(mat.repoId, mat.repoPath)
    return map
  }, [matrices])

  const repoPathOf = useCallback(
    (repo: ProjectRepoInfo) => pathByRepoId.get(repo.id) ?? repo.localDir,
    [pathByRepoId]
  )

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
          // Status filtering is only meaningful with a specific env column;
          // passing "all" keeps the UI selection from silently doing nothing.
          status: envFilter === "all" ? "all" : statusFilter,
          onlyNeedsPush,
          onlyNeedsPull,
          onlyCurrent,
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
    onlyNeedsPull,
    onlyCurrent,
  ])

  const totalPages = Math.max(1, Math.ceil(flatRows.length / PAGE_SIZE))
  const pageRows = useMemo(
    () => flatRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [flatRows, page]
  )

  // Show an env column only when at least one visible repo has it configured.
  const shownEnvs = useMemo(
    () =>
      ENVS.filter((e) =>
        visibleMatrices.some((m) => (m.envs ?? []).includes(e))
      ),
    [visibleMatrices]
  )

  // Repos the backend could not scan — typically not cloned locally. Their
  // branches are simply absent from the table, so without this the user sees a
  // silently incomplete board.
  const repoErrors = useMemo(
    () => visibleMatrices.filter((m) => m.error),
    [visibleMatrices]
  )

  const envLabels = useMemo(
    () => ({
      notConfigured: t("task.notConfigured"),
      unmerged: t("task.envUnmerged"),
      merged: t("task.envMerged"),
      fastForward: t("task.mergedFastForward"),
    }),
    [t]
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
    onlyNeedsPull,
    onlyCurrent,
  ])

  // Keep the current page valid when the data shrinks after a refresh.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  // Drop env/status filters that no longer apply to the visible repos,
  // otherwise rows get hidden with no way to see (or clear) the cause.
  useEffect(() => {
    if (envFilter !== "all" && !shownEnvs.includes(envFilter)) {
      setEnvFilter("all")
      setStatusFilter("all")
    }
  }, [envFilter, shownEnvs])

  // Debounce the search box: only filter after the user stops typing.
  useEffect(() => {
    const id = setTimeout(() => setKeyword(keywordInput), 300)
    return () => clearTimeout(id)
  }, [keywordInput])

  const handleSync = async () => {
    setBusy(true)
    try {
      const targets = visibleMatrices
        .map((m) => repoById.get(m.repoId))
        .filter((r): r is ProjectRepoInfo => r != null)
      const total = targets.length
      const failures: string[] = []
      let ok = 0
      // Small-batch parallel fetch: much faster than one-by-one, but capped so
      // concurrent credential prompts stay manageable.
      const BATCH = 4
      for (let i = 0; i < targets.length; i += BATCH) {
        const batch = targets.slice(i, i + BATCH)
        const results = await Promise.allSettled(
          batch.map((repo) => {
            const path = repoPathOf(repo)
            return withCredentialRetry((creds) => gitFetch(path, creds), {
              folderPath: path,
            }).then(() => repo.name)
          })
        )
        for (let j = 0; j < results.length; j++) {
          const r = results[j]
          if (r.status === "fulfilled") {
            ok += 1
          } else {
            failures.push(`${batch[j].name} (${errorText(r.reason)})`)
          }
        }
      }
      await refresh()
      if (failures.length === 0) {
        toast.success(t("task.syncDone"))
      } else if (ok === 0) {
        toast.error(`${t("task.syncRemote")}: ${failures.join("; ")}`)
      } else {
        toast.warning(
          t("task.syncPartial", {
            ok,
            total,
            detail: failures.join("; "),
          })
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const doPush = (repo: ProjectRepoInfo, branch: string) => {
    if (repo.folderId == null) {
      toast.error(t("task.pushNoFolder"))
      return
    }
    void openPushWindow(repo.folderId, branch)
  }

  const doPull = async (repo: ProjectRepoInfo, branch: string) => {
    setBusy(true)
    try {
      const res = await withCredentialRetry(
        (creds) => pullBranch(repoPathOf(repo), branch, creds),
        { folderPath: repoPathOf(repo) }
      )
      if (res.conflict?.has_conflicts) {
        if (repo.folderId != null) {
          conflictResolvedRef.current = false
          setConflict({
            info: res.conflict,
            repo,
            targetPath: repoPathOf(repo),
            targetFolderId: repo.folderId,
            temp: false,
          })
        } else {
          // No folder handle for the conflict dialog — never swallow this.
          toast.error(
            t("task.opFailed", {
              action: t("task.pull"),
              detail: res.conflict.conflicted_files?.join(", ") ?? "",
            })
          )
        }
        return
      }
      await refresh()
    } catch (e) {
      toast.error(
        t("task.opFailed", {
          action: t("task.pull"),
          detail: errorText(e),
        })
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * Remove a temporary merge worktree. The backend reports a failed removal
   * rather than claiming success. There is nothing to ask the user at these
   * call sites (the merge has already succeeded or failed), so it is not
   * thrown — but a leftover `.codeg-wt-` directory blocks the next merge into
   * this environment, so the user is told where it is.
   */
  const cleanupTempWorktree = async (repoPath: string, tempPath: string) => {
    try {
      await removeTempWorktree(repoPath, tempPath)
    } catch (e) {
      console.warn(`failed to remove temp worktree ${tempPath}:`, e)
      toast.warning(t("task.tempWorktreeCleanupFailed", { path: tempPath }))
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

    // Guard against a push that would be rejected: when the env branch lags
    // its upstream, merging into the stale local copy is wasted (and possibly
    // conflicting) work. Ask the user to pull the env branch first.
    const envRow = (
      matrices.find((m) => m.repoId === repo.id)?.branches ?? []
    ).find((b) => b.branch === envBranch)
    if (envRow?.needsPull) {
      toast.warning(`${envBranch}: ${t("task.needsPull")}`)
      return
    }

    setBusy(true)
    let tempPath: string | null = null
    const repoPath = repoPathOf(repo)
    try {
      // Resolve where the env branch is checked out and reuse that worktree.
      // Only create a temporary worktree when the branch is not checked out
      // anywhere — a branch checked out in a linked worktree cannot be added
      // again, so blindly creating one would fail.
      let targetPath: string
      let targetFolderId: number
      let temp = false
      const resolution = await resolveWorktreeFolder(repoPath, envBranch)
      if (resolution.path) {
        targetPath = resolution.path
        targetFolderId = resolution.folder_id ?? repo.folderId ?? 0
      } else {
        const parent = repoPath.replace(/[\\/][^\\/]*$/, "")
        tempPath = `${parent}/.codeg-wt-${repo.name}-${env}-${Date.now()}`
        await addExistingWorktree(repoPath, tempPath, envBranch)
        const folder = await openWorktreeFolder(tempPath, repo.folderId ?? 0)
        targetPath = tempPath
        targetFolderId = folder.id
        temp = true
      }

      // Hard gate: the actual merge target tree must be clean (unrelated dirt
      // in another worktree must not block this merge).
      const status = await gitStatus(targetPath)
      const gate = canMerge(status)
      if (!gate.ok) {
        if (temp && tempPath) {
          await cleanupTempWorktree(repoPath, tempPath)
        }
        setDirtyBlock({ repoName: repo.name, paths: gate.dirtyPaths })
        return
      }

      const res = await gitMerge(targetPath, row.branch)
      if (res.conflict?.has_conflicts) {
        conflictResolvedRef.current = false
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
        await cleanupTempWorktree(repoPath, tempPath)
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
    } catch (e) {
      if (tempPath) {
        await cleanupTempWorktree(repoPathOf(repo), tempPath)
      }
      toast.error(
        t("task.opFailed", {
          action: t("task.merge"),
          detail: errorText(e),
        })
      )
    } finally {
      setBusy(false)
    }
  }

  // Only a successful resolution/abort removes the temporary worktree this
  // merge created. A plain dialog dismissal keeps it (and the user's conflict
  // edits) so the work can be resumed.
  const handleConflictClose = () => {
    const c = conflict
    setConflict(null)
    if (c?.temp && !conflictResolvedRef.current) {
      toast.warning(t("task.conflictLeftTemp"))
    }
    void refresh()
  }

  const handleConflictResolved = () => {
    const c = conflict
    conflictResolvedRef.current = true
    setConflict(null)
    if (c?.temp) {
      void cleanupTempWorktree(repoPathOf(c.repo), c.targetPath)
    }
    void refresh()
  }

  const toggleArchive = async (repoId: number, branch: string) => {
    const cur = states.get(stateKey(repoId, branch))
    const restoring = cur?.isArchived ?? false
    try {
      const next = await upsertBranchState(repoId, branch, {
        isArchived: !restoring,
      })
      setStates((prev) => {
        const m = new Map(prev)
        m.set(stateKey(next.repoId, next.branch), next)
        return m
      })
    } catch (e) {
      toast.error(
        t("task.opFailed", {
          action: restoring ? t("task.restoreBranch") : t("task.archiveBranch"),
          detail: errorText(e),
        })
      )
    }
  }

  const saveNote = async () => {
    if (!noteEdit) return
    try {
      const next = await upsertBranchState(noteEdit.repoId, noteEdit.branch, {
        // An empty string clears the note. Sending `null`/omitting the field
        // would mean "leave it alone", and must not be used here.
        description: noteEdit.value.trim(),
      })
      setStates((prev) => {
        const m = new Map(prev)
        m.set(stateKey(next.repoId, next.branch), next)
        return m
      })
      setNoteEdit(null)
    } catch (e) {
      toast.error(
        t("task.opFailed", {
          action: t("task.editNote"),
          detail: errorText(e),
        })
      )
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const { repo, row, branch } = deleteTarget
    const path = repoPathOf(repo)
    setBusy(true)
    try {
      // Delete the remote branch FIRST. If that fails (permissions, network,
      // protected branch) nothing local has been touched, so the two never
      // diverge silently; a retry simply tries the remote again. The backend
      // resolves which remote/branch it is, so a branch published without a
      // tracking config is handled too.
      if (deleteRemote && row.hasRemote) {
        await withCredentialRetry(
          (creds) => gitDeleteBranchRemote(path, branch, creds),
          { folderPath: path }
        )
        // Clear the flag: a later force retry must not try to delete a
        // remote branch that is already gone.
        setDeleteRemote(false)
      }
      await gitDeleteBranch(path, branch, forceDelete)
      // Close only after success; a failed delete keeps the confirmation (and
      // the selected branch) so the user can retry.
      setDeleteTarget(null)
      setForceDelete(false)
      setDeleteRemote(false)
      await refresh()
      // refresh() closes the detail panel when the branch is gone; also close
      // it eagerly so stale content never flashes.
      setDetail((prev) =>
        prev?.repo.id === repo.id && prev.row.branch === branch ? null : prev
      )
    } catch (e) {
      // Only an unmerged branch is retriable with force. Offering it for any
      // other failure (checked out in a worktree, no such branch) walks the
      // user into a second, identical failure.
      if (isUnmergedDeleteError(e)) setForceDelete(true)
      toast.error(
        t("task.opFailed", {
          action: t("task.deleteBranch"),
          detail: errorText(e),
        })
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <p className="p-4 text-sm text-muted-foreground">{t("task.loading")}</p>
    )
  }

  // Environment branches this branch has not been merged into yet, for the
  // delete confirmation. Uses the board's own merge data rather than waiting
  // for git's `branch -d` refusal, so the warning names the environment(s).
  const deleteUnmergedEnvs = deleteTarget
    ? deleteTarget.row.envs
        .filter((e) => !e.merged)
        .map((e) =>
          t(`task.env${e.env[0].toUpperCase()}${e.env.slice(1)}` as never)
        )
    : []
  // The branch can be deleted on the remote when it is published there. Keyed
  // on `hasRemote`, not `upstream`: a branch can be published with no tracking
  // config (an adopted same-named remote ref), where `upstream` is null but the
  // remote branch very much exists.
  const canDeleteRemote = deleteTarget?.row.hasRemote ?? false

  return (
    <div className="flex h-full min-h-0 gap-0">
      <ResizablePanelGroup
        direction="horizontal"
        className="h-full min-h-0"
        autoSaveId="branch-board-split"
      >
        <ResizablePanel
          defaultSize={detail ? 62 : 100}
          minSize={30}
          className="min-w-0"
        >
          <div className="flex h-full min-h-0 flex-col gap-3">
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
                  <TabsTrigger value="active">
                    {t("task.activeBranches")}
                  </TabsTrigger>
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
                    <SelectTrigger
                      size="sm"
                      className="w-[110px] text-[0.8125rem]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("task.envAll")}</SelectItem>
                      {shownEnvs.map((e) => (
                        <SelectItem key={e} value={e}>
                          {t(
                            `task.env${e[0].toUpperCase()}${e.slice(1)}` as never
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={statusFilter}
                    onValueChange={(v) =>
                      setStatusFilter(v as "all" | "merged" | "unmerged")
                    }
                    disabled={envFilter === "all"}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-[110px] text-[0.8125rem]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("task.statusAll")}</SelectItem>
                      <SelectItem value="merged">
                        {t("task.envMerged")}
                      </SelectItem>
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

              {/* "Which branches need the latest code" is a primary question
                  this board exists to answer; `needsPull` was computed but had
                  no filter. Reuses the existing `needsPull` label. */}
              <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyNeedsPull}
                  onChange={(e) => setOnlyNeedsPull(e.target.checked)}
                />
                {t("task.needsPull")}
              </label>

              <label className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={onlyCurrent}
                  onChange={(e) => setOnlyCurrent(e.target.checked)}
                />
                {t("task.onlyCurrent")}
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
                <RefreshCw
                  className={cn(
                    "mr-1 h-3.5 w-3.5",
                    (busy || refreshing) && "animate-spin"
                  )}
                />
                {t("task.refresh")}
              </Button>
            </div>

            {/* Repos that could not be scanned — usually not cloned locally.
                Called out so the board is never silently incomplete. */}
            {repoErrors.length > 0 && (
              <div className="shrink-0 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                {repoErrors.map((m) => (
                  <p
                    key={m.repoId}
                    className="truncate text-[0.75rem] text-destructive"
                    title={m.error ?? ""}
                  >
                    {t("task.repoUnavailable", {
                      repo: m.repoName,
                      detail: m.error ?? "",
                    })}
                  </p>
                ))}
              </div>
            )}

            {/* Flat branch list */}
            {flatRows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {error
                  ? t("task.opFailed", {
                      action: t("task.refresh"),
                      detail: error,
                    })
                  : t("task.emptyBranches")}
              </p>
            ) : (
              <ScrollArea
                x="scroll"
                className="flex-1 min-h-0 rounded-lg border"
              >
                <table className="w-full min-w-[900px] text-sm">
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
                          {t(
                            `task.env${e[0].toUpperCase()}${e.slice(1)}` as never
                          )}
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
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ repoId, repoName, row }) => {
                      const repo = repoById.get(repoId)
                      const state = states.get(stateKey(repoId, row.branch))
                      const openDetail = () => repo && setDetail({ repo, row })
                      return (
                        <tr
                          key={`${repoId}:${row.branch}`}
                          className={cn(
                            "border-b last:border-0 hover:bg-accent/40",
                            repo ? "cursor-pointer" : "cursor-not-allowed"
                          )}
                          onClick={openDetail}
                        >
                          <td className="px-3 py-2 font-mono text-[0.8125rem]">
                            <button
                              type="button"
                              className="hover:underline"
                              onClick={openDetail}
                            >
                              {repoName}:{row.branch}
                            </button>
                            {row.isCurrent && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-[0.625rem] text-green-600 dark:text-green-400"
                              >
                                {t("task.currentBranch")}
                              </Badge>
                            )}
                            {row.remoteState === "unpublished" && (
                              <Badge
                                variant="outline"
                                className="ml-2 text-[0.625rem] text-muted-foreground"
                              >
                                {t("task.unpublished")}
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
                            // Compact: the date alone carries the meaning in
                            // this narrow column.
                            const label = envCellLabel(cell, envLabels, true)
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
                            {row.lastCommitAt
                              ? row.lastCommitAt.slice(0, 10)
                              : "—"}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span
                              className={cn(
                                "text-[0.7rem]",
                                remoteTone(row.remoteState)
                              )}
                            >
                              {t(remoteStatusKey(row.remoteState) as never)}
                            </span>
                            {/* How far ahead/behind, not just the direction —
                                the counts were already computed and dropped. */}
                            {remoteCountsLabel(row) && (
                              <span className="ml-1.5 font-mono text-[0.7rem] text-muted-foreground">
                                {remoteCountsLabel(row)}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {state?.description || "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </ScrollArea>
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
                  <AlertDialogTitle>
                    {t("task.pushAfterMergeTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("task.pushAfterMergeBody", {
                      env: pushPrompt?.branch ?? "",
                    })}
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
          </div>
        </ResizablePanel>
        {detail && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={38} minSize={22} className="min-w-0">
              <BranchDetailPanel
                repo={detail.repo}
                repoPath={repoPathOf(detail.repo)}
                row={detail.row}
                project={activeProject}
                state={states.get(stateKey(detail.repo.id, detail.row.branch))}
                busy={busy}
                onMerge={(env) =>
                  setMergeTarget({ repo: detail.repo, row: detail.row, env })
                }
                onPush={() => doPush(detail.repo, detail.row.branch)}
                onPull={() => void doPull(detail.repo, detail.row.branch)}
                onArchive={() => {
                  const st = states.get(
                    stateKey(detail.repo.id, detail.row.branch)
                  )
                  if (st?.isArchived) {
                    void toggleArchive(detail.repo.id, detail.row.branch)
                  } else {
                    setArchiveTarget({
                      repoId: detail.repo.id,
                      branch: detail.row.branch,
                    })
                  }
                }}
                onEditNote={() =>
                  setNoteEdit({
                    repoId: detail.repo.id,
                    branch: detail.row.branch,
                    value:
                      states.get(stateKey(detail.repo.id, detail.row.branch))
                        ?.description ?? "",
                  })
                }
                onDelete={() =>
                  setDeleteTarget({
                    repo: detail.repo,
                    row: detail.row,
                    branch: detail.row.branch,
                  })
                }
                onClose={() => setDetail(null)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

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
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null)
            setForceDelete(false)
            setDeleteRemote(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("task.deleteBranch")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("task.deleteBranchConfirm", {
                branch: deleteTarget?.branch ?? "",
              })}
              {deleteUnmergedEnvs.length > 0 && (
                <>
                  <br />
                  <span className="text-amber-600 dark:text-amber-400">
                    {t("task.deleteUnmergedWarning", {
                      envs: deleteUnmergedEnvs.join(", "),
                    })}
                  </span>
                </>
              )}
              {forceDelete && (
                <>
                  <br />
                  {t("task.deleteForceHint")}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* Only meaningful for a branch with a recorded upstream, and only
              before a force retry (which is local-only by then). */}
          {canDeleteRemote && !forceDelete && (
            <label className="flex items-center gap-2 text-[0.8125rem]">
              <input
                type="checkbox"
                checked={deleteRemote}
                onChange={(e) => setDeleteRemote(e.target.checked)}
              />
              {t("task.deleteRemoteToo")}
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("task.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {forceDelete ? t("task.deleteForce") : t("task.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Note edit */}
      <Dialog
        open={noteEdit !== null}
        onOpenChange={(o) => !o && setNoteEdit(null)}
      >
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
            <Button onClick={() => void saveNote()}>
              {t("task.saveNote")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict resolution (reuses the shared merge tool) */}
      <ConflictDialog
        conflictInfo={conflict?.info ?? null}
        folderId={conflict?.targetFolderId ?? 0}
        folderPath={conflict?.targetPath ?? ""}
        onClose={handleConflictClose}
        onResolved={handleConflictResolved}
      />
    </div>
  )
}
