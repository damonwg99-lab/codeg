import type { GitStatusEntry } from "@/lib/types"
import type {
  BranchRow,
  BranchStateInfo,
  EnvKey,
  ProjectInfo,
  ProjectRepoInfo,
  RemoteState,
} from "./types"

/**
 * Returns the effective branch name for an environment: the repo-level
 * override wins when present, else the project-level default.
 */
export function resolveEffectiveEnv(
  repo: ProjectRepoInfo,
  project: ProjectInfo,
  env: EnvKey
): string | null {
  const repoVal =
    env === "dev"
      ? repo.devBranch
      : env === "uat"
        ? repo.uatBranch
        : repo.prdBranch
  if (repoVal && repoVal.trim().length > 0) return repoVal.trim()

  const projVal =
    env === "dev"
      ? project.devBranch
      : env === "uat"
        ? project.uatBranch
        : project.prdBranch
  if (projVal && projVal.trim().length > 0) return projVal.trim()

  return null
}

/** Whether the branch has been merged into all environments configured for it. */
export function isFullyMerged(row: BranchRow): boolean {
  if (row.envs.length === 0) return false
  return row.envs.every((e) => e.merged)
}

/**
 * Maps the backend remote state to a localization key. Note that `diverged` and
 * `unknown` is deliberately distinct from `synced`.
 */
export function remoteStatusKey(state: RemoteState): string {
  switch (state) {
    case "no_remote":
      return "task.remoteLocalOnly"
    case "unpublished":
      return "task.unpublished"
    case "synced":
      return "task.remoteSynced"
    case "ahead":
      return "task.needsPush"
    case "behind":
      return "task.needsPull"
    case "diverged":
      return "task.diverged"
    case "unknown":
    default:
      return "task.remoteUnknown"
  }
}

/**
 * Compact ahead/behind suffix for a remote-state label, e.g. `↑2`, `↓3`,
 * `↑2 ↓3`. Empty when there is nothing to report, so callers can append it
 * unconditionally. Arrows rather than words, so it needs no translation.
 */
export function remoteCountsLabel(
  row: Pick<BranchRow, "ahead" | "behind">
): string {
  const parts: string[] = []
  if (row.ahead > 0) parts.push(`↑${row.ahead}`)
  if (row.behind > 0) parts.push(`↓${row.behind}`)
  return parts.join(" ")
}

export interface BranchFilterOptions {
  archived: boolean
  onlyUnmerged: boolean
  keyword?: string
  /** Restrict to branches whose `env` is configured (or all). */
  env?: EnvKey | "all"
  /** With a specific `env`, restrict to merged / unmerged. */
  status?: "all" | "merged" | "unmerged"
  onlyNeedsPush?: boolean
  /** Restrict to branches whose remote has commits the local copy lacks. */
  onlyNeedsPull?: boolean
  /** Restrict to the branch currently checked out in its repo. */
  onlyCurrent?: boolean
}

/** Filter rows by archive flag, merge state, env, push state and keyword. */
export function filterRows(
  rows: BranchRow[],
  stateOf: (branch: string) => BranchStateInfo | undefined,
  opts: BranchFilterOptions
): BranchRow[] {
  const kw = opts.keyword?.trim().toLowerCase() ?? ""
  const env = opts.env ?? "all"
  const status = opts.status ?? "all"
  return rows.filter((row) => {
    const state = stateOf(row.branch)
    const archived = state?.isArchived ?? false
    if (opts.archived !== archived) return false
    if (
      opts.onlyUnmerged &&
      row.envs.length > 0 &&
      !row.envs.some((e) => !e.merged)
    )
      return false
    if (opts.onlyCurrent && !row.isCurrent) return false
    if (opts.onlyNeedsPush && !row.needsPush) return false
    if (opts.onlyNeedsPull && !row.needsPull) return false
    if (env !== "all") {
      const e = row.envs.find((x) => x.env === env)
      if (!e) return false
      if (status === "merged" && !e.merged) return false
      if (status === "unmerged" && e.merged) return false
    }
    if (kw) {
      const matchBranch = row.branch.toLowerCase().includes(kw)
      const matchDesc = state?.description?.toLowerCase().includes(kw) ?? false
      const matchAuthor = row.createdBy?.toLowerCase().includes(kw) ?? false
      if (!matchBranch && !matchDesc && !matchAuthor) return false
    }
    return true
  })
}

/**
 * Hard pre-merge gate: the source (and target) working tree must be clean.
 * Returns the dirty paths so the UI can list them and refuse to merge.
 */
export function canMerge(entries: GitStatusEntry[]): {
  ok: boolean
  dirtyPaths: string[]
} {
  const dirtyPaths = entries.map((e) => e.file)
  return { ok: dirtyPaths.length === 0, dirtyPaths }
}

/**
 * Whether `path` is one of codeg's leftover merge worktrees (`.codeg-wt-*`).
 * Merges used to create such a worktree silently and delete it on success —
 * but a leftover one keeps the environment branch checked out, so every new
 * merge into that environment is dirty-gated with no visible way out. We only
 * match the directory NAME, so a user's own worktree named like the repo is
 * never offered for cleanup.
 */
export function isResidualTempWorktreePath(
  path: string | null | undefined
): boolean {
  if (!path) return false
  const base =
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? ""
  return base.startsWith(".codeg-wt-")
}

export type CellKind = "env" | "unconfigured" | "unmerged" | "merged"

export interface CellState {
  kind: CellKind
  mergeVia?: "merge" | "fast_forward" | null
  mergeDate?: string | null
}

export interface EnvCellLabels {
  notConfigured: string
  unmerged: string
  merged: string
  /** Marker for a branch merged by fast-forward (no merge commit). */
  fastForward: string
}

/**
 * The single source of truth for an environment cell's text. Both the board
 * table and the detail panel render through this, so the two can no longer
 * drift apart (they previously each rebuilt the same ternary chain and had
 * already diverged on how a merged-with-date cell reads).
 *
 * A fast-forward merge reads like any other merge: the user's question is
 * "did it land, and when", not "how". The how (a fast-forward leaves no merge
 * commit) is offered as a hover hint instead — see [`envCellTooltip`].
 *
 * `compact` drops the "merged" word when a date is available, for the narrow
 * table column where the date alone carries the meaning.
 */
export function envCellLabel(
  cell: CellState,
  labels: EnvCellLabels,
  compact = false
): string {
  if (cell.kind === "env") return "—"
  if (cell.kind === "unconfigured") return labels.notConfigured
  if (cell.kind === "unmerged") return labels.unmerged
  const date = cell.mergeDate ? cell.mergeDate.slice(0, 10) : null
  if (!date) return labels.merged
  return compact ? date : `${labels.merged} · ${date}`
}

/**
 * Hover hint for a cell, for the nuance the label no longer carries: a
 * fast-forward merge means no merge commit exists in the environment history.
 */
export function envCellTooltip(
  cell: CellState,
  labels: EnvCellLabels
): string | undefined {
  return cell.mergeVia === "fast_forward" ? labels.fastForward : undefined
}

/**
 * Determine a cell's presentation for an environment column. Configuration and
 * merge status are derived from `row.envs`: the backend only emits an
 * `EnvMergeStatus` entry for each env configured for the repo, so an env that
 * is absent from `row.envs` means "not configured" (the branch's own env
 * column short-circuits earlier).
 */
export function envCellState(row: BranchRow, env: EnvKey): CellState {
  if (row.isEnvBranch) {
    return { kind: "env" }
  }
  const status = row.envs.find((e) => e.env === env)
  if (!status) {
    return { kind: "unconfigured" }
  }
  if (!status.merged) {
    return { kind: "unmerged" }
  }
  return {
    kind: "merged",
    mergeVia: status.mergeVia,
    mergeDate: status.mergeDate,
  }
}
