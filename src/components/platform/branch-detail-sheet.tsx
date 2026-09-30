"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import {
  GitBranch,
  GitCommit,
  GitMerge,
  FileDiff,
  FolderPen,
  type LucideIcon,
} from "lucide-react"
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  SIDE_PANEL_CONTENT_CLASS,
} from "@/components/ui/drawer"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { gitLog, gitDiffWithBranch, gitStatus, gitListAllBranches } from "@/lib/api"
import { envCellState, resolveEffectiveEnv } from "@/lib/platform/branch-board"
import type {
  BranchRow,
  BranchStateInfo,
  EnvKey,
  ProjectInfo,
  ProjectRepoInfo,
} from "@/lib/platform/types"
import type { GitLogEntry, GitStatusEntry } from "@/lib/types"

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

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5 text-[0.75rem] font-medium">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        {title}
      </div>
      <div className="p-3">{children}</div>
    </section>
  )
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

  const changedFiles = useMemo(() => {
    if (!diffText) return 0
    return diffText.split("\n").filter((l) => l.startsWith("diff --git ")).length
  }, [diffText])

  const isCheckedOut =
    currentBranch != null && row != null && currentBranch === row.branch

  // Remote chip mirrors the board's remote column.
  const remoteChip = (() => {
    if (!row) return null
    const cls = "inline-flex h-5 items-center rounded-md px-1.5 text-[0.625rem] font-medium"
    if (!row.hasRemote)
      return <span className={`${cls} bg-muted text-muted-foreground`}>{t("task.remoteLocalOnly")}</span>
    if (row.needsPush && row.needsPull)
      return <span className={`${cls} bg-destructive/10 text-destructive`}>{t("task.diverged")}</span>
    if (row.needsPush)
      return <span className={`${cls} bg-orange-500/10 text-orange-600 dark:text-orange-400`}>{t("task.needsPush")}</span>
    if (row.needsPull)
      return <span className={`${cls} bg-blue-500/10 text-blue-600 dark:text-blue-400`}>{t("task.needsPull")}</span>
    return <span className={`${cls} bg-green-500/10 text-green-600 dark:text-green-400`}>{t("task.remoteSynced")}</span>
  })()

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <DrawerContent className={SIDE_PANEL_CONTENT_CLASS}>
        <DrawerHeader className="shrink-0 gap-0 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3 pr-8">
            <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40 text-foreground">
              <GitBranch className="size-[1.125rem] text-muted-foreground" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-start gap-2">
                <DrawerTitle className="min-w-0 break-words font-mono text-[0.9375rem] font-semibold leading-5">
                  {row?.branch ?? ""}
                </DrawerTitle>
                <span className="flex h-5 shrink-0 items-center">{remoteChip}</span>
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

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-4 px-5 py-4">
            {envs.length > 0 && (
              <Section icon={GitMerge} title={t("task.detailOverview")}>
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
                        className="flex items-center justify-between py-1.5 text-[0.8125rem] first:pt-0 last:pb-0"
                      >
                        <span className="text-muted-foreground">
                          {t(`task.env${e[0].toUpperCase()}${e.slice(1)}` as never)}
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
              </Section>
            )}

            <Section icon={FolderPen} title={t("task.detailWorkingTree")}>
              {!isCheckedOut ? (
                <p className="text-[0.75rem] text-muted-foreground">
                  {t("task.detailNotCheckedOut")}
                </p>
              ) : status && status.length > 0 ? (
                <div className="flex flex-col divide-y divide-border/60">
                  {status.map((s) => (
                    <div
                      key={s.file}
                      className="flex items-center gap-2 py-1.5 text-[0.75rem] first:pt-0 last:pb-0"
                    >
                      <span className="inline-flex h-5 w-6 shrink-0 items-center justify-center rounded bg-muted font-mono text-[0.625rem] text-muted-foreground">
                        {s.status}
                      </span>
                      <span className="min-w-0 truncate font-mono">{s.file}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[0.75rem] text-muted-foreground">
                  {t("task.detailNoChanges")}
                </p>
              )}
            </Section>

            {envs.length > 0 && (
              <Section icon={FileDiff} title={t("task.detailDiff")}>
                <div className="flex items-center gap-2">
                  <Select
                    value={diffEnv}
                    onValueChange={(v) => void loadDiff(v as EnvKey)}
                  >
                    <SelectTrigger size="sm" className="w-[150px] text-[0.8125rem]">
                      <SelectValue placeholder={t("task.mergeTo")} />
                    </SelectTrigger>
                    <SelectContent>
                      {envs.map((e) => (
                        <SelectItem key={e} value={e}>
                          {t(`task.env${e[0].toUpperCase()}${e.slice(1)}` as never)}
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
                  <p className="mt-2 text-[0.75rem] text-muted-foreground">
                    {t("task.loading")}
                  </p>
                ) : diffText != null ? (
                  diffText.trim() ? (
                    <pre className="mt-2 max-h-[40vh] overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[0.6875rem] leading-relaxed">
                      {diffText}
                    </pre>
                  ) : (
                    <p className="mt-2 text-[0.75rem] text-muted-foreground">
                      {t("task.detailNoDiff")}
                    </p>
                  )
                ) : null}
              </Section>
            )}

            <Section icon={GitCommit} title={t("task.detailCommits")}>
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
                      className="flex flex-col gap-0.5 border-b border-border/60 py-2 first:pt-0 last:border-0 last:pb-0"
                    >
                      <span className="truncate text-[0.8125rem]">
                        {c.message.split("\n")[0]}
                      </span>
                      <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                        {c.hash.slice(0, 8)} · {c.author} · {c.date.slice(0, 10)}
                      </span>
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
            </Section>
          </div>
        </ScrollArea>
      </DrawerContent>
    </Drawer>
  )
}