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
  label: string
  sub?: string
}

/** Presentation state for one branch × one environment cell. */
export function envCellState(row: BranchRow, env: EnvKey): EnvCellState {
  const e = row.envs.find((x) => x.env === env)
  if (!e) return { kind: "unconfigured", label: "未配置" }
  if (row.isEnvBranch) return { kind: "env", label: "—" }
  if (e.merged) {
    if (e.mergeVia === "fast_forward") {
      return { kind: "merged", label: "—（FF）" }
    }
    const date = e.mergeDate ? e.mergeDate.slice(0, 10) : ""
    return { kind: "merged", label: date || "已合并" }
  }
  return { kind: "unmerged", label: `+${e.ahead}`, sub: `-${e.behind}` }
}

/** True if the branch has landed on every configured environment. */
export function isFullyMerged(row: BranchRow): boolean {
  return row.envs.length > 0 && row.envs.every((e) => e.merged)
}

export interface BranchFilterOptions {
  archived: boolean
  onlyUnmerged: boolean
  keyword?: string
}

/** Filter rows by archive flag, merge state and a branch-name keyword. */
export function filterRows(
  rows: BranchRow[],
  stateOf: (branch: string) => BranchStateInfo | undefined,
  opts: BranchFilterOptions
): BranchRow[] {
  const kw = opts.keyword?.trim().toLowerCase() ?? ""
  return rows.filter((row) => {
    const state = stateOf(row.branch)
    const archived = state?.isArchived ?? false
    if (opts.archived !== archived) return false
    if (opts.onlyUnmerged && !row.envs.some((e) => !e.merged)) return false
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