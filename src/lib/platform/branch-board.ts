import type { GitStatusEntry } from "@/lib/types"
import type {
  BranchRow,
  BranchStateInfo,
  EnvKey,
  ProjectInfo,
  ProjectRepoInfo,
} from "./types"

/** Repo env-branch override wins; else the project default. */
export function resolveEffectiveEnv(
  repo: ProjectRepoInfo,
  project: ProjectInfo,
  env: EnvKey
): string | null {
  const key =
    env === "dev" ? "devBranch" : env === "uat" ? "uatBranch" : "prdBranch"
  const repoVal = repo[key]?.trim()
  if (repoVal) return repoVal
  const projVal = project[key]?.trim()
  return projVal || null
}

export interface EnvCellState {
  kind: "env" | "merged" | "unmerged" | "unconfigured"
  mergeVia?: "merge" | "fast_forward" | null
  mergeDate?: string | null
}

/** Presentation state for one branch × one environment cell. */
export function envCellState(row: BranchRow, env: EnvKey): EnvCellState {
  const e = row.envs.find((x) => x.env === env)
  if (!e) return { kind: "unconfigured" }
  if (row.isEnvBranch) return { kind: "env" }
  if (e.merged) {
    return { kind: "merged", mergeVia: e.mergeVia, mergeDate: e.mergeDate }
  }
  return { kind: "unmerged" }
}

/** True if the branch has landed on every configured environment. */
export function isFullyMerged(row: BranchRow): boolean {
  return row.envs.length > 0 && row.envs.every((e) => e.merged)
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
    if (opts.onlyUnmerged && !row.envs.some((e) => !e.merged)) return false
    if (opts.onlyNeedsPush && !row.needsPush) return false
    if (env !== "all") {
      const e = row.envs.find((x) => x.env === env)
      if (!e) return false
      if (status === "merged" && !e.merged) return false
      if (status === "unmerged" && e.merged) return false
    }
    if (kw && !row.branch.toLowerCase().includes(kw)) return false
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