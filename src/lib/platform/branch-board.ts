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

/** Environments this branch has NOT been merged into yet (merge targets). */
export function unmergedEnvs(row: BranchRow): EnvKey[] {
  return row.envs.filter((e) => !e.merged).map((e) => e.env)
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

export type CellKind = "env" | "unconfigured" | "unmerged" | "merged"

export interface CellState {
  kind: CellKind
  label: string
  mergeVia?: "merge" | "fast_forward" | null
  mergeDate?: string | null
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
    return { kind: "env", label: "—" }
  }
  const status = row.envs.find((e) => e.env === env)
  if (!status) {
    return { kind: "unconfigured", label: "task.notConfigured" }
  }
  if (!status.merged) {
    return { kind: "unmerged", label: "task.envUnmerged" }
  }
  return {
    kind: "merged",
    label: "task.envMerged",
    mergeVia: status.mergeVia,
    mergeDate: status.mergeDate,
  }
}
