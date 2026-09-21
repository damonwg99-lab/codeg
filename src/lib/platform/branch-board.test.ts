import { describe, it, expect } from "vitest"
import type { GitStatusEntry } from "@/lib/types"
import {
  canMerge,
  envCellState,
  filterRows,
  isFullyMerged,
  resolveEffectiveEnv,
} from "./branch-board"
import type { BranchRow, BranchStateInfo, ProjectInfo, ProjectRepoInfo } from "./types"

const repo = {
  devBranch: null,
  uatBranch: "release/uat",
  prdBranch: null,
} as unknown as ProjectRepoInfo

const project = {
  devBranch: "develop",
  uatBranch: "uat",
  prdBranch: "master",
} as unknown as ProjectInfo

describe("resolveEffectiveEnv", () => {
  it("prefers repo over project", () => {
    expect(resolveEffectiveEnv(repo, project, "uat")).toBe("release/uat")
    expect(resolveEffectiveEnv(repo, project, "dev")).toBe("develop")
    expect(resolveEffectiveEnv(repo, project, "prd")).toBe("master")
  })

  it("returns null when neither is set", () => {
    const empty = { devBranch: null, uatBranch: null, prdBranch: null }
    expect(
      resolveEffectiveEnv(
        empty as unknown as ProjectRepoInfo,
        empty as unknown as ProjectInfo,
        "dev"
      )
    ).toBeNull()
  })
})

const baseRow: BranchRow = {
  branch: "feat/a",
  createdAt: null,
  createdAtSource: null,
  isEnvBranch: false,
  lastCommitAt: null,
  envs: [
    {
      env: "uat",
      merged: true,
      mergeVia: "merge",
      mergeDate: "2026-09-01T00:00:00Z",
      ahead: 0,
      behind: 2,
    },
  ],
}

describe("envCellState", () => {
  it("shows the merge date when merged", () => {
    const s = envCellState(baseRow, "uat")
    expect(s.kind).toBe("merged")
    expect(s.label).toBe("2026-09-01")
  })

  it("shows —（FF） for fast-forward merges", () => {
    const row = {
      ...baseRow,
      envs: [{ ...baseRow.envs[0], mergeVia: "fast_forward" as const }],
    }
    expect(envCellState(row, "uat").label).toBe("—（FF）")
  })

  it("shows +ahead when unmerged", () => {
    const row = {
      ...baseRow,
      envs: [
        {
          env: "uat" as const,
          merged: false,
          mergeVia: null,
          mergeDate: null,
          ahead: 3,
          behind: 1,
        },
      ],
    }
    const s = envCellState(row, "uat")
    expect(s.kind).toBe("unmerged")
    expect(s.label).toBe("+3")
  })

  it("marks the env branch itself", () => {
    expect(envCellState({ ...baseRow, isEnvBranch: true }, "uat").kind).toBe(
      "env"
    )
  })

  it("marks unconfigured environments", () => {
    expect(envCellState(baseRow, "prd").kind).toBe("unconfigured")
  })
})

describe("isFullyMerged", () => {
  it("true only when every env is merged", () => {
    expect(isFullyMerged(baseRow)).toBe(true)
    const partial = {
      ...baseRow,
      envs: [
        baseRow.envs[0],
        {
          env: "prd" as const,
          merged: false,
          mergeVia: null,
          mergeDate: null,
          ahead: 1,
          behind: 0,
        },
      ],
    }
    expect(isFullyMerged(partial)).toBe(false)
    expect(isFullyMerged({ ...baseRow, envs: [] })).toBe(false)
  })
})

describe("filterRows", () => {
  const rows: BranchRow[] = [
    baseRow,
    { ...baseRow, branch: "feat/b" },
    { ...baseRow, branch: "old/c" },
  ]
  const states = new Map<string, BranchStateInfo>([
    [
      "old/c",
      { branch: "old/c", isArchived: true } as unknown as BranchStateInfo,
    ],
  ])
  const stateOf = (b: string) => states.get(b)

  it("filters by archive flag", () => {
    expect(filterRows(rows, stateOf, { archived: false, onlyUnmerged: false }).map((r) => r.branch)).toEqual([
      "feat/a",
      "feat/b",
    ])
    expect(filterRows(rows, stateOf, { archived: true, onlyUnmerged: false }).map((r) => r.branch)).toEqual(["old/c"])
  })

  it("filters by keyword", () => {
    expect(
      filterRows(rows, stateOf, {
        archived: false,
        onlyUnmerged: false,
        keyword: "b",
      }).map((r) => r.branch)
    ).toEqual(["feat/b"])
  })

  it("filters to only-unmerged", () => {
    const mixed: BranchRow[] = [
      baseRow,
      {
        ...baseRow,
        branch: "feat/x",
        envs: [
          {
            env: "uat",
            merged: false,
            mergeVia: null,
            mergeDate: null,
            ahead: 1,
            behind: 0,
          },
        ],
      },
    ]
    const out = filterRows(mixed, () => undefined, {
      archived: false,
      onlyUnmerged: true,
    })
    expect(out.map((r) => r.branch)).toEqual(["feat/x"])
  })
})

describe("canMerge", () => {
  it("blocks on a dirty tree", () => {
    const entries: GitStatusEntry[] = [{ status: "M", file: "a.ts" }]
    const res = canMerge(entries)
    expect(res.ok).toBe(false)
    expect(res.dirtyPaths).toEqual(["a.ts"])
  })

  it("allows a clean tree", () => {
    expect(canMerge([]).ok).toBe(true)
  })
})