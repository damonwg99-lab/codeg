"use client"

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import { useTranslations } from "next-intl"
import {
  GitBranch,
  GitCommit,
  GitMerge,
  FileDiff,
  X,
  CloudCheck,
  CloudOff,
  CircleHelp,
  Upload,
  Download,
  Archive,
  ArchiveRestore,
  Trash2,
  Pencil,
} from "lucide-react"
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree"
import {
  CommitFileInfo,
  CommitFileStatus,
  CommitFileIcon,
  CommitFilePath,
  CommitFileChanges,
  CommitFileAdditions,
  CommitFileDeletions,
} from "@/components/ai-elements/commit"
import { Button } from "@/components/ui/button"
import { UnifiedDiffPreview } from "@/components/diff/unified-diff-preview"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  gitLog,
  gitCommitFiles,
  gitShowDiff,
  gitStatus,
  resolveWorktreeFolder,
} from "@/lib/api"
import {
  getBranchDiffFile,
  getBranchDiffFiles,
  getBranchOwnCommits,
} from "@/lib/platform/api"
import {
  envCellLabel,
  envCellState,
  envCellTooltip,
  remoteCountsLabel,
  remoteStatusKey,
  resolveEffectiveEnv,
  type CellState,
} from "@/lib/platform/branch-board"
import {
  buildCommitFileTree,
  collectExpandedDirectoryPaths,
  type CommitFileTreeNode,
} from "@/lib/platform/commit-file-tree"
import type {
  BranchRow,
  BranchStateInfo,
  EnvKey,
  ProjectInfo,
  ProjectRepoInfo,
} from "@/lib/platform/types"
import type { GitLogEntry, GitLogFileChange, GitStatusEntry } from "@/lib/types"

const ENVS: EnvKey[] = ["dev", "uat", "prd"]
const PAGE = 50

interface Props {
  repo: ProjectRepoInfo | null
  repoPath: string | null
  row: BranchRow | null
  project: ProjectInfo | null
  state?: BranchStateInfo
  busy?: boolean
  onMerge: (env: EnvKey) => void
  onPush: () => void
  onPull: () => void
  onArchive: () => void
  onEditNote: () => void
  onDelete?: () => void
  onClose?: () => void
}

function MetaDot() {
  return <span className="text-muted-foreground/50">·</span>
}

/**
 * Which commits the Commits tab lists: the branch's OWN commits (not yet in any
 * environment — what is waiting to be released), or its full ancestry. A plain
 * `git log <branch>` is the latter, and for a feature branch that is mostly the
 * environment's history from before it was cut.
 */
type CommitScope = "own" | "all"

/** One page of commits for the chosen scope. */
async function fetchCommitPage(
  scope: CommitScope,
  path: string,
  branch: string,
  envBranches: string[],
  skip: number
): Promise<GitLogEntry[]> {
  if (scope === "own") {
    const res = await getBranchOwnCommits(path, branch, envBranches, skip, PAGE)
    return res.entries ?? []
  }
  // withFiles=false: per-commit file lists are loaded on expand, not per page.
  const res = await gitLog(
    path,
    PAGE,
    branch,
    undefined,
    skip || undefined,
    undefined,
    undefined,
    false
  )
  return res.entries ?? []
}

function mapFileStatus(
  status: string
): "added" | "modified" | "deleted" | "renamed" {
  switch (status.toUpperCase().charAt(0)) {
    case "A":
      return "added"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    default:
      return "modified"
  }
}

export function BranchDetailPanel({
  repo,
  repoPath,
  row,
  project,
  state,
  busy,
  onMerge,
  onPush,
  onPull,
  onArchive,
  onEditNote,
  onDelete,
  onClose,
}: Props) {
  const t = useTranslations("Platform")
  const tLog = useTranslations("Folder.gitLogTab")
  const path = repoPath ?? ""

  const [entries, setEntries] = useState<GitLogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingLog, setLoadingLog] = useState(false)
  const [worktreePath, setWorktreePath] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatusEntry[] | null>(null)
  const [statusError, setStatusError] = useState(false)
  const [diffEnv, setDiffEnv] = useState<EnvKey | "">("")
  // Env diff, loaded lazily: the file LIST first (names + counts, cheap), then
  // one file's patch only when it is opened. `null` files = not loaded yet.
  const [diffFiles, setDiffFiles] = useState<GitLogFileChange[] | null>(null)
  const [diffError, setDiffError] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [diffPatch, setDiffPatch] = useState<{
    file: string
    // null = the load failed (shown as an error, not as "no changes").
    text: string | null
    loading: boolean
  } | null>(null)

  // Monotonic token so responses for a previously selected branch/commit/file
  // can never overwrite the current selection.
  const requestSeq = useRef(0)
  const diffSeq = useRef(0)
  const diffPatchSeq = useRef(0)
  const commitSeq = useRef(0)
  const fileDiffSeq = useRef(0)
  // Own token for the commit list: switching scope must drop an in-flight page
  // without also discarding the worktree status guarded by `requestSeq`.
  const logSeq = useRef(0)

  // Which branch + scope the commit list is for. The branch is part of the
  // value so the log effect can tell "scope chosen for THIS branch" from the
  // stale value left over from the previously selected one.
  const [commitView, setCommitView] = useState<{
    branch: string
    scope: CommitScope
  } | null>(null)
  // True when "own commits" came back empty and the list fell back to the
  // full history, so the user is told why instead of seeing an unexplained
  // switch.
  const [scopeFallback, setScopeFallback] = useState(false)

  // Commit detail (git-log style: click a commit -> files -> per-file diff).
  const [openCommit, setOpenCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitLogFileChange[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [fileDiff, setFileDiff] = useState<{
    file: string
    text: string | null
  } | null>(null)

  // Controlled active tab so switching branches never leaves the panel on a
  // tab whose content belongs to the previous branch (blank diff etc.).
  const [activeTab, setActiveTab] = useState("overview")

  const envs = useMemo<EnvKey[]>(() => {
    if (!repo || !project) return []
    return ENVS.filter((e) => resolveEffectiveEnv(repo, project, e) != null)
  }, [repo, project])

  const envLabels = useMemo(
    () => ({
      notConfigured: t("task.notConfigured"),
      unmerged: t("task.envUnmerged"),
      merged: t("task.envMerged"),
      fastForward: t("task.mergedFastForward"),
    }),
    [t]
  )

  // Names of the environment branches this repo is configured with — the
  // baseline "own commits" are measured against.
  const envBranches = useMemo<string[]>(() => {
    if (!repo || !project) return []
    return envs
      .map((e) => resolveEffectiveEnv(repo, project, e))
      .filter((b): b is string => b != null)
  }, [envs, repo, project])

  // The log effect reads these through refs so a change in the environment
  // configuration does not re-fetch the list; they are refreshed (below, before
  // the effects that read them) on every render.
  const envBranchesRef = useRef<string[]>([])
  const defaultScopeRef = useRef<CommitScope>("all")
  useEffect(() => {
    envBranchesRef.current = envBranches
    // An environment branch's own "unreleased" commits are meaningless, and
    // with no environment configured there is no baseline to measure against.
    defaultScopeRef.current =
      envBranches.length > 0 && !row?.isEnvBranch ? "own" : "all"
  })

  // Keyed on the branch NAME, not the `row` object: the board rebuilds every
  // row object on each refresh (so the panel shows fresh merge/remote state),
  // and depending on object identity made every refresh re-run the log, the
  // worktree probe and `git status` — and snap the user back to the overview
  // tab, discarding the diff they were reading. Only a genuine branch change
  // should reset the panel.
  const branchName = row?.branch ?? null

  useEffect(() => {
    if (!path || !branchName) return
    let cancelled = false
    const seq = ++requestSeq.current
    // Invalidate any in-flight diff/file-diff responses from the previous row.
    diffSeq.current++
    diffPatchSeq.current++
    fileDiffSeq.current++
    commitSeq.current++
    logSeq.current++
    setEntries([])
    setHasMore(false)
    setActiveTab("overview")
    setDiffEnv("")
    setDiffFiles(null)
    setDiffError(false)
    setLoadingDiff(false)
    setDiffPatch(null)
    setStatus(null)
    setStatusError(false)
    setWorktreePath(null)
    setOpenCommit(null)
    setCommitFiles([])
    setFileDiff(null)
    setScopeFallback(false)
    // The commit list itself is loaded by the effect below, which reacts to
    // this value.
    setCommitView({ branch: branchName, scope: defaultScopeRef.current })
    // Resolve the worktree that actually owns the selected branch, then read
    // that checkout's status — never the main worktree's when a different
    // branch is checked out there.
    void (async () => {
      try {
        const res = await resolveWorktreeFolder(path, branchName)
        if (cancelled || seq !== requestSeq.current) return
        const wt = res.path
        setWorktreePath(wt)
        if (!wt) return
        try {
          const s = await gitStatus(wt)
          if (!cancelled && seq === requestSeq.current) setStatus(s)
        } catch {
          if (!cancelled && seq === requestSeq.current) setStatusError(true)
        }
      } catch {
        if (!cancelled && seq === requestSeq.current) setWorktreePath(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, branchName])

  // Loads the first page of commits for the selected branch + scope.
  useEffect(() => {
    if (!path || !branchName || !commitView) return
    // Still the previous branch's value; the reset effect is about to replace it.
    if (commitView.branch !== branchName) return

    let cancelled = false
    const seq = ++logSeq.current
    const { scope } = commitView
    setEntries([])
    setHasMore(false)
    setLoadingLog(true)

    void (async () => {
      let switchedScope = false
      try {
        const list = await fetchCommitPage(
          scope,
          path,
          branchName,
          envBranchesRef.current,
          0
        )
        if (cancelled || seq !== logSeq.current) return
        if (scope === "own" && list.length === 0) {
          // Everything on the branch is already in an environment: an empty
          // list would read as "failed to load", so show the history instead
          // and say why.
          switchedScope = true
          setScopeFallback(true)
          setCommitView({ branch: branchName, scope: "all" })
          return
        }
        setEntries(list)
        setHasMore(list.length >= PAGE)
      } catch {
        if (cancelled || seq !== logSeq.current) return
        if (scope === "own") {
          // e.g. none of the environment branches exist in this clone.
          switchedScope = true
          setCommitView({ branch: branchName, scope: "all" })
        }
      } finally {
        if (!switchedScope && !cancelled && seq === logSeq.current) {
          setLoadingLog(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [path, branchName, commitView])

  const changeScope = (scope: CommitScope) => {
    if (!branchName || commitView?.scope === scope) return
    // A manual choice clears the "fell back" explanation.
    setScopeFallback(false)
    commitSeq.current++
    fileDiffSeq.current++
    setOpenCommit(null)
    setCommitFiles([])
    setFileDiff(null)
    setCommitView({ branch: branchName, scope })
  }

  const loadMore = async () => {
    if (!path || !row || !commitView) return
    // Guard against a row or scope switch while this page is in flight:
    // appending a stale list's second page to the new one must never happen.
    const seq = logSeq.current
    setLoadingLog(true)
    try {
      const list = await fetchCommitPage(
        commitView.scope,
        path,
        row.branch,
        envBranches,
        entries.length
      )
      if (seq !== logSeq.current) return
      setEntries((prev) => [...prev, ...list])
      setHasMore(list.length >= PAGE)
    } catch {
      /* ignore */
    } finally {
      if (seq === logSeq.current) setLoadingLog(false)
    }
  }

  const loadDiff = async (env: EnvKey) => {
    if (!repo || !project || !path || !row) return
    const envBranch = resolveEffectiveEnv(repo, project, env)
    if (!envBranch) return
    const seq = ++diffSeq.current
    diffPatchSeq.current++
    setDiffEnv(env)
    setDiffFiles(null)
    setDiffError(false)
    setDiffPatch(null)
    setLoadingDiff(true)
    try {
      const files = await getBranchDiffFiles(path, row.branch, envBranch)
      if (seq === diffSeq.current) setDiffFiles(files)
    } catch {
      // Previously swallowed into an empty diff, which read as "no changes".
      if (seq === diffSeq.current) setDiffError(true)
    } finally {
      if (seq === diffSeq.current) setLoadingDiff(false)
    }
  }

  const openDiffFile = async (file: string) => {
    if (!repo || !project || !path || !row || diffEnv === "") return
    const envBranch = resolveEffectiveEnv(repo, project, diffEnv)
    if (!envBranch) return
    const seq = ++diffPatchSeq.current
    setDiffPatch({ file, text: "", loading: true })
    try {
      const text = await getBranchDiffFile(path, row.branch, envBranch, file)
      if (seq === diffPatchSeq.current)
        setDiffPatch({ file, text, loading: false })
    } catch {
      if (seq === diffPatchSeq.current)
        setDiffPatch({ file, text: null, loading: false })
    }
  }

  // The environment worth showing first: one this branch still has to be
  // merged into, since that is what "compare" is for. Falls back to the first.
  const defaultDiffEnv = useMemo<EnvKey | null>(() => {
    if (envs.length === 0) return null
    const unmerged = row
      ? envs.find((e) => envCellState(row, e).kind === "unmerged")
      : undefined
    return unmerged ?? envs[0]
  }, [envs, row])

  // The status was read once when the branch was selected; commit something,
  // come back to the overview, and it would still claim the old changes.
  const reloadStatus = async () => {
    if (!worktreePath) return
    const seq = requestSeq.current
    try {
      const s = await gitStatus(worktreePath)
      if (seq !== requestSeq.current) return
      setStatus(s)
      setStatusError(false)
    } catch {
      if (seq === requestSeq.current) setStatusError(true)
    }
  }

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    if (value === "overview") void reloadStatus()
    // Opening the diff tab with nothing selected used to show a blank pane
    // until the user found the dropdown.
    if (value === "diff" && diffEnv === "" && defaultDiffEnv) {
      void loadDiff(defaultDiffEnv)
    }
  }

  const toggleCommit = async (fullHash: string) => {
    if (openCommit === fullHash) {
      setOpenCommit(null)
      return
    }
    const seq = ++commitSeq.current
    setOpenCommit(fullHash)
    setCommitFiles([])
    setFileDiff(null)
    setLoadingFiles(true)
    try {
      const files = await gitCommitFiles(path, fullHash)
      if (seq === commitSeq.current) setCommitFiles(files)
    } catch {
      /* ignore */
    } finally {
      if (seq === commitSeq.current) setLoadingFiles(false)
    }
  }

  const openFile = async (fullHash: string, file: string) => {
    // Own token (not commitSeq): opening a second file must cancel the first
    // without disturbing the open commit's file-list loading state.
    const seq = ++fileDiffSeq.current
    setFileDiff({ file, text: "" })
    try {
      const text = await gitShowDiff(path, fullHash, file)
      if (seq === fileDiffSeq.current) setFileDiff({ file, text })
    } catch {
      // text: null renders as an explicit load failure instead of a bogus
      // "no changes" message.
      if (seq === fileDiffSeq.current) setFileDiff({ file, text: null })
    }
  }

  const diffTree = useMemo(
    () => buildCommitFileTree(diffFiles ?? []),
    [diffFiles]
  )
  const changedFiles = diffFiles?.length ?? 0

  const isCheckedOut = worktreePath != null

  const remoteChip = (() => {
    if (!row) return null
    const cls =
      "inline-flex h-5 items-center rounded-md px-1.5 text-[0.625rem] font-medium"
    const state = row.remoteState
    const tone =
      state === "synced"
        ? "bg-green-500/10 text-green-600 dark:text-green-400"
        : state === "ahead"
          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
          : state === "behind"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : state === "diverged"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground"
    const counts = remoteCountsLabel(row)
    return (
      <span className={`${cls} ${tone}`}>
        {t(remoteStatusKey(state) as never)}
        {counts && <span className="ml-1 font-mono">{counts}</span>}
      </span>
    )
  })()

  const pushMeta = (pushed: boolean | null) => {
    if (pushed === true) {
      return {
        Icon: CloudCheck,
        cls: "text-emerald-500",
        label: tLog("pushStatus.pushed"),
      }
    }
    if (pushed === false) {
      return {
        Icon: CloudOff,
        cls: "text-amber-500",
        label: tLog("pushStatus.notPushed"),
      }
    }
    return {
      Icon: CircleHelp,
      cls: "text-muted-foreground",
      label: tLog("pushStatus.unknown"),
    }
  }

  const renderFileTree = (
    nodes: CommitFileTreeNode[],
    onFileClick: (file: GitLogFileChange) => void
  ): ReactElement[] =>
    nodes.map((node) => {
      if (node.kind === "dir") {
        return (
          <FileTreeFolder
            key={node.path}
            path={node.path}
            name={node.name}
            suffix={`(${node.fileCount})`}
            suffixClassName="text-muted-foreground/45"
            title={node.path}
          >
            {renderFileTree(node.children, onFileClick)}
          </FileTreeFolder>
        )
      }
      const file = node.change
      return (
        <FileTreeFile
          key={file.path}
          className="w-full min-w-0 cursor-pointer"
          name={node.name}
          path={node.path}
          title={file.path}
          onClick={() => onFileClick(file)}
        >
          <span className="size-4 shrink-0" />
          <CommitFileInfo className="min-w-0 flex-1 gap-1.5">
            <CommitFileStatus status={mapFileStatus(file.status)}>
              {file.status}
            </CommitFileStatus>
            <CommitFileIcon />
            <CommitFilePath title={file.path}>{node.name}</CommitFilePath>
          </CommitFileInfo>
          <CommitFileChanges>
            <CommitFileAdditions count={file.additions} />
            <CommitFileDeletions count={file.deletions} />
          </CommitFileChanges>
        </FileTreeFile>
      )
    })

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-foreground">
          <GitBranch
            className="size-[1.125rem] text-muted-foreground"
            aria-hidden="true"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-start gap-2">
            <h2 className="min-w-0 break-words font-mono text-[0.9375rem] font-semibold leading-5">
              {row?.branch ?? ""}
            </h2>
            <span className="flex h-5 shrink-0 items-center">{remoteChip}</span>
            {state?.isArchived && (
              <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[0.625rem] font-medium text-muted-foreground">
                <Archive className="size-3" aria-hidden />
                {t("task.archivedBranches")}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.6875rem] leading-none text-muted-foreground">
            {repo?.name && <span className="truncate">{repo.name}</span>}
            {row?.createdBy && (
              <>
                <MetaDot />
                <span className="truncate">
                  {t("task.colAuthor")}: {row.createdBy}
                </span>
              </>
            )}
            {row?.createdAt && (
              <>
                <MetaDot />
                <span>{row.createdAt.slice(0, 10)}</span>
              </>
            )}
            {row?.lastCommitAt && (
              <>
                <MetaDot />
                <span>
                  {t("task.colLastCommit")}: {row.lastCommitAt.slice(0, 10)}
                </span>
              </>
            )}
          </div>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 px-5 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="gap-1">
              <GitMerge className="size-3.5" />
              {t("task.detailOverview")}
            </TabsTrigger>
            {envs.length > 0 && (
              <TabsTrigger value="diff" className="gap-1">
                <FileDiff className="size-3.5" />
                {t("task.detailDiff")}
              </TabsTrigger>
            )}
            <TabsTrigger value="commits" className="gap-1">
              <GitCommit className="size-3.5" />
              {t("task.detailCommits")}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Overview */}
        <TabsContent
          value="overview"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-5 px-5 py-4">
              {/* Sync */}
              <section className="flex flex-col gap-2">
                <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("task.detailSync")}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy || !repo || repo.folderId == null}
                    onClick={onPush}
                  >
                    <Upload className="size-3.5" />
                    {t("task.push")}
                  </Button>
                  {row?.hasRemote && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      // Pull is allowed whenever a remote exists — not only
                      // right after the last matrix snapshot flagged needsPull
                      // (the user may want to fetch fresh data on demand).
                      disabled={busy}
                      onClick={onPull}
                    >
                      <Download className="size-3.5" />
                      {t("task.pull")}
                    </Button>
                  )}
                </div>
              </section>

              {/* Uncommitted changes. Shown only when there is something to say:
                  these are NOT part of a merge, which is easy to forget when a
                  branch looks finished. (The merge gate checks the TARGET
                  environment's worktree, not this one.) */}
              {isCheckedOut &&
                (statusError || (status && status.length > 0)) && (
                  <section className="flex flex-col gap-2">
                    <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("task.detailWorkingTree")}
                      {status && status.length > 0 && (
                        <span className="ml-1.5 normal-case tracking-normal">
                          ·{" "}
                          {t("task.detailChangedFiles", {
                            count: status.length,
                          })}
                        </span>
                      )}
                    </h3>
                    {statusError ? (
                      <p className="text-[0.75rem] text-destructive">
                        {t("task.detailStatusError")}
                      </p>
                    ) : (
                      <>
                        <p className="text-[0.75rem] text-amber-600 dark:text-amber-400">
                          {t("task.workingChangesNotMerged")}
                        </p>
                        <details className="group rounded-md border border-border/60">
                          <summary className="cursor-pointer select-none px-2.5 py-1.5 text-[0.75rem] text-muted-foreground">
                            {t("task.detailChangedFiles", {
                              count: status?.length ?? 0,
                            })}
                          </summary>
                          <div className="flex max-h-56 flex-col divide-y divide-border/60 overflow-auto border-t border-border/60 px-2.5">
                            {status?.map((s) => (
                              <div
                                key={s.file}
                                className="flex items-center gap-2 py-1.5 text-[0.75rem]"
                              >
                                <span className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded bg-muted font-mono text-[0.625rem] text-muted-foreground">
                                  {s.status}
                                </span>
                                <span className="min-w-0 truncate font-mono">
                                  {s.file}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </>
                    )}
                  </section>
                )}

              {/* Merge to env */}
              <section className="flex flex-col gap-2">
                <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("task.mergeTo")}
                </h3>
                {envs.length === 0 ? (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.notConfigured")}
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border/60">
                    {envs.map((e) => {
                      const cell: CellState = row
                        ? envCellState(row, e)
                        : { kind: "unconfigured" }
                      const label = envCellLabel(cell, envLabels)
                      const canMergeEnv =
                        row != null &&
                        !row.isEnvBranch &&
                        cell.kind === "unmerged"
                      return (
                        <div
                          key={e}
                          className="flex items-center justify-between gap-2 py-2 text-[0.8125rem] first:pt-0 last:pb-0"
                        >
                          <span className="text-muted-foreground">
                            {t(
                              `task.env${e[0].toUpperCase()}${e.slice(1)}` as never
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              title={envCellTooltip(cell, envLabels)}
                              className={
                                cell.kind === "merged"
                                  ? "text-green-600 dark:text-green-400"
                                  : "text-muted-foreground"
                              }
                            >
                              {label}
                            </span>
                            {canMergeEnv && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 gap-1 px-2 text-[0.6875rem]"
                                disabled={busy}
                                onClick={() => onMerge(e)}
                              >
                                <GitMerge className="size-3" />
                                {t("task.merge")}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Note */}
              <section className="flex flex-col gap-2">
                <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("task.colNote")}
                </h3>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[0.8125rem] text-muted-foreground">
                    {state?.description || "—"}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    title={t("task.editNote")}
                    disabled={busy}
                    onClick={onEditNote}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </section>

              {/* Manage */}
              <section className="flex flex-col gap-2">
                <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("task.detailManage")}
                </h3>
                <div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={busy}
                    onClick={onArchive}
                  >
                    {state?.isArchived ? (
                      <ArchiveRestore className="size-3.5" />
                    ) : (
                      <Archive className="size-3.5" />
                    )}
                    {state?.isArchived
                      ? t("task.restoreBranch")
                      : t("task.archiveBranch")}
                  </Button>
                </div>
              </section>

              {/* Danger */}
              {row && !row.isEnvBranch && onDelete && (
                <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
                  <h3 className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                    {t("task.detailDanger")}
                  </h3>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={busy}
                      onClick={onDelete}
                    >
                      <Trash2 className="size-3.5" />
                      {t("task.deleteBranch")}
                    </Button>
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Diff vs env */}
        <TabsContent
          value="diff"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-3">
              <span className="text-[0.75rem] text-muted-foreground">
                {t("task.detailCompareTo")}
              </span>
              <Select
                value={diffEnv}
                onValueChange={(v) => void loadDiff(v as EnvKey)}
              >
                <SelectTrigger size="sm" className="w-[140px] text-[0.8125rem]">
                  <SelectValue placeholder={t("task.detailDiff")} />
                </SelectTrigger>
                <SelectContent>
                  {envs.map((e) => (
                    <SelectItem key={e} value={e}>
                      {t(`task.env${e[0].toUpperCase()}${e.slice(1)}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {diffFiles != null && (
                <span className="text-[0.75rem] text-muted-foreground">
                  {t("task.detailChangedFiles", { count: changedFiles })}
                </span>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-5 py-4">
                {loadingDiff ? (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.loading")}
                  </p>
                ) : diffError ? (
                  <p className="text-[0.75rem] text-destructive">
                    {t("task.detailStatusError")}
                  </p>
                ) : diffFiles != null ? (
                  diffFiles.length === 0 ? (
                    <p className="text-[0.75rem] text-muted-foreground">
                      {t("task.detailNoDiff")}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <FileTree
                        key={diffEnv}
                        defaultExpanded={collectExpandedDirectoryPaths(
                          diffTree
                        )}
                        className="rounded-md border-border/60 bg-transparent text-xs [&>div]:p-1"
                      >
                        {renderFileTree(
                          diffTree,
                          (f) => void openDiffFile(f.path)
                        )}
                      </FileTree>
                      {diffPatch && (
                        <div className="overflow-hidden rounded-md border border-border/60">
                          <div className="truncate border-b border-border/60 px-3 py-1.5 font-mono text-[0.6875rem] text-muted-foreground">
                            {diffPatch.file}
                          </div>
                          {diffPatch.loading ? (
                            <p className="px-3 py-2 text-[0.75rem] text-muted-foreground">
                              {t("task.loading")}
                            </p>
                          ) : diffPatch.text === null ? (
                            <p className="px-3 py-2 text-[0.75rem] text-destructive">
                              {t("task.detailStatusError")}
                            </p>
                          ) : diffPatch.text.trim() ? (
                            <UnifiedDiffPreview
                              diffText={diffPatch.text}
                              embedded
                              hideViewToggle
                            />
                          ) : (
                            // Previously a file that produced no patch text
                            // (e.g. a mode-only change) gave no feedback at all.
                            <p className="px-3 py-2 text-[0.75rem] text-muted-foreground">
                              {t("task.detailNoDiff")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                ) : null}
              </div>
            </ScrollArea>
          </div>
        </TabsContent>

        {/* Commits */}
        <TabsContent
          value="commits"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <ScrollArea className="h-full">
            <div className="px-5 py-4">
              {/* Scope switch: only meaningful for a non-environment branch with
                  an environment configured (there is nothing to exclude from
                  otherwise). */}
              {envBranches.length > 0 && !row?.isEnvBranch && (
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-md border border-border p-0.5">
                    <Button
                      variant={
                        commitView?.scope === "own" ? "secondary" : "ghost"
                      }
                      size="sm"
                      className="h-6 px-2 text-[0.6875rem]"
                      onClick={() => changeScope("own")}
                    >
                      {t("task.commitsOwnOnly")}
                    </Button>
                    <Button
                      variant={
                        commitView?.scope === "all" ? "secondary" : "ghost"
                      }
                      size="sm"
                      className="h-6 px-2 text-[0.6875rem]"
                      onClick={() => changeScope("all")}
                    >
                      {t("task.commitsAllHistory")}
                    </Button>
                  </div>
                  {scopeFallback && (
                    <span className="text-[0.6875rem] text-muted-foreground">
                      {t("task.commitsAllMerged")}
                    </span>
                  )}
                </div>
              )}
              {loadingLog && entries.length === 0 ? (
                <p className="text-[0.75rem] text-muted-foreground">
                  {t("task.loading")}
                </p>
              ) : entries.length === 0 ? (
                <p className="text-[0.75rem] text-muted-foreground">
                  {t("task.detailEmptyCommits")}
                </p>
              ) : (
                <div className="flex flex-col">
                  {entries.map((c) => (
                    <div
                      key={c.full_hash}
                      className="border-b border-border/60 last:border-0"
                    >
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded px-1 py-2 text-left hover:bg-accent/40"
                        onClick={() => void toggleCommit(c.full_hash)}
                      >
                        {(() => {
                          const m = pushMeta(c.pushed)
                          const Icon = m.Icon
                          return (
                            <span
                              className={`mt-0.5 flex shrink-0 ${m.cls}`}
                              title={m.label}
                              aria-label={m.label}
                              role="img"
                            >
                              <Icon className="size-4" aria-hidden />
                            </span>
                          )
                        })()}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[0.8125rem]">
                            {c.message.split("\n")[0]}
                          </span>
                          <span className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted-foreground">
                            {c.hash.slice(0, 8)} · {c.author} ·{" "}
                            {c.date.slice(0, 10)}
                          </span>
                        </span>
                      </button>
                      {openCommit === c.full_hash && (
                        <div className="flex flex-col gap-2 pb-3">
                          {loadingFiles ? (
                            <p className="px-1 text-[0.75rem] text-muted-foreground">
                              {t("task.loading")}
                            </p>
                          ) : commitFiles.length === 0 ? (
                            <p className="px-1 text-[0.75rem] text-muted-foreground">
                              {t("task.detailNoDiff")}
                            </p>
                          ) : (
                            <>
                              {(() => {
                                const treeNodes =
                                  buildCommitFileTree(commitFiles)
                                const dirPaths =
                                  collectExpandedDirectoryPaths(treeNodes)
                                return (
                                  <FileTree
                                    key={c.full_hash}
                                    defaultExpanded={dirPaths}
                                    className="max-h-[32rem] overflow-auto rounded-md border-border/60 bg-transparent text-xs [&>div]:p-1"
                                  >
                                    {renderFileTree(treeNodes, (f) => {
                                      if (openCommit)
                                        void openFile(openCommit, f.path)
                                    })}
                                  </FileTree>
                                )
                              })()}
                              {fileDiff &&
                                (fileDiff.text === null ? (
                                  <p className="text-[0.75rem] text-destructive">
                                    {t("task.detailStatusError")}
                                  </p>
                                ) : fileDiff.text.trim() ? (
                                  <UnifiedDiffPreview
                                    diffText={fileDiff.text}
                                    embedded
                                    hideViewToggle
                                  />
                                ) : (
                                  <p className="text-[0.75rem] text-muted-foreground">
                                    {t("task.detailNoDiff")}
                                  </p>
                                ))}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {hasMore && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 self-start"
                      disabled={loadingLog}
                      onClick={() => void loadMore()}
                    >
                      {t("task.detailLoadMore")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
