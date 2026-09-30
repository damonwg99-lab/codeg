"use client"

import { useEffect, useMemo, useState, type ReactElement } from "react"
import { useTranslations } from "next-intl"
import {
  GitBranch,
  GitCommit,
  GitMerge,
  FileDiff,
  FolderPen,
} from "lucide-react"
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  SIDE_PANEL_CONTENT_CLASS,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
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
  gitDiffWithBranch,
  gitStatus,
  gitListAllBranches,
} from "@/lib/api"
import { envCellState, resolveEffectiveEnv } from "@/lib/platform/branch-board"
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
import type {
  GitLogEntry,
  GitLogFileChange,
  GitStatusEntry,
} from "@/lib/types"

const ENVS: EnvKey[] = ["dev", "uat", "prd"]
const PAGE = 50

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  repo: ProjectRepoInfo | null
  repoPath: string | null
  row: BranchRow | null
  project: ProjectInfo | null
  state?: BranchStateInfo
}

function MetaDot() {
  return <span className="text-muted-foreground/50">·</span>
}

export function BranchDetailSheet({
  open,
  onOpenChange,
  repo,
  repoPath,
  row,
  project,
  state: _state,
}: Props) {
  const t = useTranslations("Platform")
  const path = repoPath ?? ""

  const [entries, setEntries] = useState<GitLogEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingLog, setLoadingLog] = useState(false)
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatusEntry[] | null>(null)
  const [diffEnv, setDiffEnv] = useState<EnvKey | "">("")
  const [diffText, setDiffText] = useState<string | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  // Commit detail (git-log style: click a commit -> files -> per-file diff).
  const [openCommit, setOpenCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<GitLogFileChange[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [fileDiff, setFileDiff] = useState<{ file: string; text: string } | null>(
    null
  )

  const envs = useMemo<EnvKey[]>(() => {
    if (!repo || !project) return []
    return ENVS.filter((e) => resolveEffectiveEnv(repo, project, e) != null)
  }, [repo, project])

  useEffect(() => {
    if (!open || !path || !row) return
    let cancelled = false
    setEntries([])
    setHasMore(false)
    setDiffEnv("")
    setDiffText(null)
    setStatus(null)
    setCurrentBranch(null)
    setOpenCommit(null)
    setCommitFiles([])
    setFileDiff(null)
    setLoadingLog(true)
    gitLog(path, PAGE, row.branch)
      .then((res) => {
        if (cancelled) return
        const list = res.entries ?? []
        setEntries(list)
        setHasMore(list.length >= PAGE)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingLog(false)
      })
    gitListAllBranches(path)
      .then((l) => {
        if (!cancelled) setCurrentBranch(l.main_worktree_branch)
      })
      .catch(() => {})
    gitStatus(path)
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, path, row])

  const loadMore = async () => {
    if (!path || !row) return
    setLoadingLog(true)
    try {
      const res = await gitLog(path, PAGE, row.branch, undefined, entries.length)
      const list = res.entries ?? []
      setEntries((prev) => [...prev, ...list])
      setHasMore(list.length >= PAGE)
    } catch {
      /* ignore */
    } finally {
      setLoadingLog(false)
    }
  }

  const loadDiff = async (env: EnvKey) => {
    if (!repo || !project || !path) return
    const envBranch = resolveEffectiveEnv(repo, project, env)
    if (!envBranch) return
    setDiffEnv(env)
    setLoadingDiff(true)
    try {
      setDiffText(await gitDiffWithBranch(path, envBranch))
    } catch {
      setDiffText("")
    } finally {
      setLoadingDiff(false)
    }
  }

  const toggleCommit = async (fullHash: string) => {
    if (openCommit === fullHash) {
      setOpenCommit(null)
      return
    }
    setOpenCommit(fullHash)
    setCommitFiles([])
    setFileDiff(null)
    setLoadingFiles(true)
    try {
      setCommitFiles(await gitCommitFiles(path, fullHash))
    } catch {
      /* ignore */
    } finally {
      setLoadingFiles(false)
    }
  }

  const openFile = async (fullHash: string, file: string) => {
    setFileDiff({ file, text: "" })
    try {
      const text = await gitShowDiff(path, fullHash, file)
      setFileDiff({ file, text })
    } catch {
      /* ignore */
    }
  }

  const changedFiles = useMemo(() => {
    if (!diffText) return 0
    return diffText.split("\n").filter((l) => l.startsWith("diff --git ")).length
  }, [diffText])

  const isCheckedOut =
    currentBranch != null && row != null && currentBranch === row.branch

  const remoteChip = (() => {
    if (!row) return null
    const cls =
      "inline-flex h-5 items-center rounded-md px-1.5 text-[0.625rem] font-medium"
    if (!row.hasRemote)
      return (
        <span className={`${cls} bg-muted text-muted-foreground`}>
          {t("task.remoteLocalOnly")}
        </span>
      )
    if (row.needsPush && row.needsPull)
      return (
        <span className={`${cls} bg-destructive/10 text-destructive`}>
          {t("task.diverged")}
        </span>
      )
    if (row.needsPush)
      return (
        <span className={`${cls} bg-orange-500/10 text-orange-600 dark:text-orange-400`}>
          {t("task.needsPush")}
        </span>
      )
    if (row.needsPull)
      return (
        <span className={`${cls} bg-blue-500/10 text-blue-600 dark:text-blue-400`}>
          {t("task.needsPull")}
        </span>
      )
    return (
      <span className={`${cls} bg-green-500/10 text-green-600 dark:text-green-400`}>
        {t("task.remoteSynced")}
      </span>
    )
  })()

  const renderCommitTree = (nodes: CommitFileTreeNode[]): ReactElement[] =>
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
            {renderCommitTree(node.children)}
          </FileTreeFolder>
        )
      }
      const file = node.change
      return (
        <FileTreeFile
          key={`${openCommit}:${file.path}`}
          className="w-full min-w-0 cursor-pointer"
          name={node.name}
          path={node.path}
          title={file.path}
          onClick={() => {
            if (openCommit) void openFile(openCommit, file.path)
          }}
        >
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <span className="shrink-0 font-mono text-[0.625rem]">
            <span className="text-green-600 dark:text-green-400">
              +{file.additions}
            </span>{" "}
            <span className="text-destructive">-{file.deletions}</span>
          </span>
        </FileTreeFile>
      )
    })

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent className={SIDE_PANEL_CONTENT_CLASS}>
        <DrawerHeader className="shrink-0 gap-0 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-foreground">
              <GitBranch
                className="size-[1.125rem] text-muted-foreground"
                aria-hidden="true"
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-start gap-2">
                <DrawerTitle className="min-w-0 break-words font-mono text-[0.9375rem] font-semibold leading-5">
                  {row?.branch ?? ""}
                </DrawerTitle>
                <span className="flex h-5 shrink-0 items-center">
                  {remoteChip}
                </span>
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
          </div>
          <DrawerDescription className="sr-only">
            {t("task.detailOverview")}
          </DrawerDescription>
        </DrawerHeader>

        <Tabs
          defaultValue="overview"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="shrink-0 px-5 pt-3">
            <TabsList className="w-full">
              <TabsTrigger value="overview" className="gap-1">
                <GitMerge className="size-3.5" />
                {t("task.detailOverview")}
              </TabsTrigger>
              <TabsTrigger value="working" className="gap-1">
                <FolderPen className="size-3.5" />
                {t("task.detailWorkingTree")}
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
              <div className="px-5 py-4">
                {envs.length === 0 ? (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.notConfigured")}
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-border/60">
                    {envs.map((e) => {
                      const cell = row
                        ? envCellState(row, e)
                        : { kind: "unconfigured" as const }
                      const label =
                        cell.kind === "merged"
                          ? cell.mergeVia === "fast_forward"
                            ? "—（FF）"
                            : cell.mergeDate
                              ? `${t("task.envMerged")} · ${cell.mergeDate.slice(0, 10)}`
                              : t("task.envMerged")
                          : cell.kind === "unmerged"
                            ? t("task.envUnmerged")
                            : cell.kind === "env"
                              ? "—"
                              : t("task.notConfigured")
  return (
                        <div
                          key={e}
                          className="flex items-center justify-between py-2 text-[0.8125rem] first:pt-0 last:pb-0"
                        >
                          <span className="text-muted-foreground">
                            {t(
                              `task.env${e[0].toUpperCase()}${e.slice(1)}` as never
                            )}
                          </span>
                          <span
                            className={
                              cell.kind === "merged"
                                ? "text-green-600 dark:text-green-400"
                                : "text-muted-foreground"
                            }
                          >
                            {label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Uncommitted changes */}
          <TabsContent
            value="working"
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            <ScrollArea className="h-full">
              <div className="px-5 py-4">
                {!isCheckedOut ? (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.detailNotCheckedOut")}
                  </p>
                ) : status && status.length > 0 ? (
                  <div className="flex flex-col divide-y divide-border/60">
                    {status.map((s) => (
                      <div
                        key={s.file}
                        className="flex items-center gap-2 py-2 text-[0.75rem] first:pt-0 last:pb-0"
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
                ) : (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.detailNoChanges")}
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Diff vs env */}
          <TabsContent
            value="diff"
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-3 px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] text-muted-foreground">
                    {t("task.detailCompareTo")}
                  </span>
                  <Select
                    value={diffEnv}
                    onValueChange={(v) => void loadDiff(v as EnvKey)}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-[140px] text-[0.8125rem]"
                    >
                      <SelectValue placeholder={t("task.detailDiff")} />
                    </SelectTrigger>
                    <SelectContent>
                      {envs.map((e) => (
                        <SelectItem key={e} value={e}>
                          {t(
                            `task.env${e[0].toUpperCase()}${e.slice(1)}` as never
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {diffText != null && (
                    <span className="text-[0.75rem] text-muted-foreground">
                      {t("task.detailChangedFiles", { count: changedFiles })}
                    </span>
                  )}
                </div>
                {loadingDiff ? (
                  <p className="text-[0.75rem] text-muted-foreground">
                    {t("task.loading")}
                  </p>
                ) : diffText != null ? (
                  diffText.trim() ? (
                    <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[0.6875rem] leading-relaxed">
                      {diffText}
                    </pre>
                  ) : (
                    <p className="text-[0.75rem] text-muted-foreground">
                      {t("task.detailNoDiff")}
                    </p>
                  )
                ) : null}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Commits */}
          <TabsContent
            value="commits"
            className="mt-0 min-h-0 flex-1 overflow-hidden"
          >
            <ScrollArea className="h-full">
              <div className="px-5 py-4">
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
                          className="w-full rounded px-1 py-2 text-left hover:bg-accent/40"
                          onClick={() => void toggleCommit(c.full_hash)}
                        >
                          <span className="block truncate text-[0.8125rem]">
                            {c.message.split("\n")[0]}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-muted-foreground">
                            {c.hash.slice(0, 8)} · {c.author} ·{" "}
                            {c.date.slice(0, 10)}
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
                                      {renderCommitTree(treeNodes)}
                                    </FileTree>
                                  )
                                })()}
                                {fileDiff && (
                                  <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[0.6875rem] leading-relaxed">
                                    {fileDiff.text || t("task.detailNoDiff")}
                                  </pre>
                                )}
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
      </DrawerContent>
    </Drawer>
  )
}