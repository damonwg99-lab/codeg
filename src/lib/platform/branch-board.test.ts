import { describe, it, expect } from "vitest"
import type { GitStatusEntry } from "@/lib/types"
import {
  canMerge,
  envCellLabel,
  envCellState,
  envCellTooltip,
  filterRows,
  isFullyMerged,
  isResidualTempWorktreePath,
  remoteCountsLabel,
  remoteStatusKey,
  resolveEffectiveEnv,
} from "./branch-board"
import type {
  BranchRow,
  BranchStateInfo,
  ProjectInfo,
  ProjectRepoInfo,
} from "./types"

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
  isCurrent: false,
  lastCommitAt: null,
  createdBy: null,
  upstream: null,
  hasRemote: false,
  remoteState: "no_remote",
  ahead: 0,
  behind: 0,
  needsPush: false,
  needsPull: false,
  envs: [
    {
      env: "uat",
      merged: true,
      mergeVia: "merge",
      mergeDate: "2026-09-01T00:00:00Z",
    },
  ],
}

describe("envCellState", () => {
  it("merged carries the merge date", () => {
    const s = envCellState(baseRow, "uat")
    expect(s.kind).toBe("merged")
    expect(s.mergeDate).toBe("2026-09-01T00:00:00Z")
  })

  it("fast-forward merges carry mergeVia=fast_forward", () => {
    const row = {
      ...baseRow,
      envs: [{ ...baseRow.envs[0], mergeVia: "fast_forward" as const }],
    }
    const s = envCellState(row, "uat")
    expect(s.kind).toBe("merged")
    expect(s.mergeVia).toBe("fast_forward")
  })

  it("unmerged", () => {
    const row = {
      ...baseRow,
      envs: [
        {
          env: "uat" as const,
          merged: false,
          mergeVia: null,
          mergeDate: null,
        },
      ],
    }
    expect(envCellState(row, "uat").kind).toBe("unmerged")
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

describe("envCellLabel", () => {
  const labels = {
    notConfigured: "NOT_CONFIGURED",
    unmerged: "UNMERGED",
    merged: "MERGED",
    fastForward: "FF",
  }

  it("renders each non-merged kind from the supplied labels", () => {
    expect(envCellLabel({ kind: "env" }, labels)).toBe("—")
    expect(envCellLabel({ kind: "unconfigured" }, labels)).toBe(
      "NOT_CONFIGURED"
    )
    expect(envCellLabel({ kind: "unmerged" }, labels)).toBe("UNMERGED")
  })

  it("compact mode shows the date alone, full mode qualifies it", () => {
    const cell = {
      kind: "merged" as const,
      mergeVia: "merge" as const,
      mergeDate: "2026-09-01T12:34:56Z",
    }
    expect(envCellLabel(cell, labels, true)).toBe("2026-09-01")
    expect(envCellLabel(cell, labels)).toBe("MERGED · 2026-09-01")
  })

  it("a fast-forward merge reads like any merge; the how goes to the tooltip", () => {
    expect(
      envCellLabel(
        {
          kind: "merged",
          mergeVia: "fast_forward",
          mergeDate: "2026-09-01T00:00:00Z",
        },
        labels
      )
    ).toBe("MERGED · 2026-09-01")
    // Previously rendered as "— (FF)" / bare "FF", which hid the date the user
    // actually cares about ("when did it land?").
    expect(
      envCellLabel(
        { kind: "merged", mergeVia: "fast_forward", mergeDate: null },
        labels
      )
    ).toBe("MERGED")
  })

  it("only fast-forward merges trade the extra word for a tooltip", () => {
    expect(
      envCellTooltip(
        {
          kind: "merged",
          mergeVia: "fast_forward",
          mergeDate: "2026-09-01T00:00:00Z",
        },
        labels
      )
    ).toBe("FF")
    expect(
      envCellTooltip(
        { kind: "merged", mergeVia: "merge", mergeDate: null },
        labels
      )
    ).toBeUndefined()
  })

  it("falls back to the merged label when no date is known", () => {
    expect(
      envCellLabel(
        { kind: "merged", mergeVia: "merge", mergeDate: null },
        labels
      )
    ).toBe("MERGED")
  })

  it("board and panel agree on every cell kind", () => {
    // The two call sites used to rebuild this chain independently and had
    // already drifted apart; only `compact` may differ between them.
    const cells = [
      { kind: "env" as const },
      { kind: "unconfigured" as const },
      { kind: "unmerged" as const },
      { kind: "merged" as const, mergeVia: "merge" as const, mergeDate: null },
    ]
    for (const cell of cells) {
      expect(envCellLabel(cell, labels, true)).toBe(
        envCellLabel(cell, labels, false)
      )
    }
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
    expect(
      filterRows(rows, stateOf, { archived: false, onlyUnmerged: false }).map(
        (r) => r.branch
      )
    ).toEqual(["feat/a", "feat/b"])
    expect(
      filterRows(rows, stateOf, { archived: true, onlyUnmerged: false }).map(
        (r) => r.branch
      )
    ).toEqual(["old/c"])
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

  it("matches the note and the author, not just the branch name", () => {
    const noted: BranchRow[] = [
      { ...baseRow, branch: "feat/one", createdBy: "Alice" },
      { ...baseRow, branch: "feat/two", createdBy: "Bob" },
      { ...baseRow, branch: "feat/three", createdBy: null },
    ]
    const notes = new Map<string, BranchStateInfo>([
      [
        "feat/three",
        {
          branch: "feat/three",
          description: "payment refactor",
        } as unknown as BranchStateInfo,
      ],
    ])
    const noteOf = (b: string) => notes.get(b)
    const search = (keyword: string) =>
      filterRows(noted, noteOf, {
        archived: false,
        onlyUnmerged: false,
        keyword,
      }).map((r) => r.branch)

    expect(search("alice")).toEqual(["feat/one"])
    expect(search("payment")).toEqual(["feat/three"])
    // Still matches the branch name, and matching is case-insensitive.
    expect(search("TWO")).toEqual(["feat/two"])
    expect(search("nothing-matches")).toEqual([])
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

  it("filters by env + status", () => {
    const rows: BranchRow[] = [
      {
        ...baseRow,
        branch: "feat/uat-merged",
        envs: [
          {
            env: "uat",
            merged: true,
            mergeVia: "merge",
            mergeDate: null,
          },
          {
            env: "prd",
            merged: false,
            mergeVia: null,
            mergeDate: null,
          },
        ],
      },
      {
        ...baseRow,
        branch: "feat/uat-open",
        envs: [
          {
            env: "uat",
            merged: false,
            mergeVia: null,
            mergeDate: null,
          },
        ],
      },
      { ...baseRow, branch: "feat/no-env", envs: [] },
    ]
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        env: "uat",
        status: "merged",
      }).map((r) => r.branch)
    ).toEqual(["feat/uat-merged"])
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        env: "uat",
        status: "unmerged",
      }).map((r) => r.branch)
    ).toEqual(["feat/uat-open"])
    // env filter excludes branches that don't have that env at all
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        env: "prd",
      }).map((r) => r.branch)
    ).toEqual(["feat/uat-merged"])
  })

  it("filters to only-needs-pull", () => {
    const rows: BranchRow[] = [
      { ...baseRow, branch: "feat/current", needsPull: false },
      { ...baseRow, branch: "feat/stale", needsPull: true },
    ]
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        onlyNeedsPull: true,
      }).map((r) => r.branch)
    ).toEqual(["feat/stale"])
  })

  it("needs-push and needs-pull are independent filters", () => {
    const rows: BranchRow[] = [
      { ...baseRow, branch: "feat/push", needsPush: true, needsPull: false },
      { ...baseRow, branch: "feat/pull", needsPush: false, needsPull: true },
      { ...baseRow, branch: "feat/both", needsPush: true, needsPull: true },
    ]
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        onlyNeedsPush: true,
        onlyNeedsPull: true,
      }).map((r) => r.branch)
    ).toEqual(["feat/both"])
  })

  it("filters to only-needs-push", () => {
    const rows: BranchRow[] = [
      { ...baseRow, branch: "feat/pushed", needsPush: false },
      { ...baseRow, branch: "feat/dirty", needsPush: true },
    ]
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        onlyNeedsPush: true,
      }).map((r) => r.branch)
    ).toEqual(["feat/dirty"])
  })

  it("filters to only-current", () => {
    const rows: BranchRow[] = [
      { ...baseRow, branch: "feat/checked-out", isCurrent: true },
      { ...baseRow, branch: "feat/other", isCurrent: false },
    ]
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        onlyCurrent: true,
      }).map((r) => r.branch)
    ).toEqual(["feat/checked-out"])
  })
})

describe("remoteStatusKey", () => {
  it("maps every remote state to a distinct user-facing label", () => {
    expect(remoteStatusKey("no_remote")).toBe("task.remoteLocalOnly")
    expect(remoteStatusKey("unpublished")).toBe("task.unpublished")
    expect(remoteStatusKey("synced")).toBe("task.remoteSynced")
    expect(remoteStatusKey("ahead")).toBe("task.needsPush")
    expect(remoteStatusKey("behind")).toBe("task.needsPull")
    expect(remoteStatusKey("diverged")).toBe("task.diverged")
    expect(remoteStatusKey("unknown")).toBe("task.remoteUnknown")
  })

  it("never renders unknown as synced", () => {
    expect(remoteStatusKey("unknown")).not.toBe(remoteStatusKey("synced"))
  })
})

describe("filterRows remote semantics", () => {
  it("includes unpublished branches in only-needs-push", () => {
    const rows: BranchRow[] = [
      {
        ...baseRow,
        branch: "feat/published",
        remoteState: "synced",
        needsPush: false,
      },
      {
        ...baseRow,
        branch: "feat/new",
        remoteState: "unpublished",
        needsPush: true,
      },
      {
        ...baseRow,
        branch: "feat/unknown",
        remoteState: "unknown",
        needsPush: false,
      },
    ]
    expect(
      filterRows(rows, () => undefined, {
        archived: false,
        onlyUnmerged: false,
        onlyNeedsPush: true,
      }).map((r) => r.branch)
    ).toEqual(["feat/new"])
  })
})

describe("remoteCountsLabel", () => {
  it("reports each direction, and nothing when in sync", () => {
    expect(remoteCountsLabel({ ahead: 0, behind: 0 })).toBe("")
    expect(remoteCountsLabel({ ahead: 2, behind: 0 })).toBe("↑2")
    expect(remoteCountsLabel({ ahead: 0, behind: 3 })).toBe("↓3")
    expect(remoteCountsLabel({ ahead: 2, behind: 3 })).toBe("↑2 ↓3")
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

describe("isResidualTempWorktreePath", () => {
  it("matches codeg's .codeg-wt- directories in either separator style", () => {
    expect(isResidualTempWorktreePath("D:/repos/.codeg-wt-api-dev-123")).toBe(
      true
    )
    expect(isResidualTempWorktreePath("D:\\repos\\.codeg-wt-prd-9")).toBe(true)
    expect(isResidualTempWorktreePath("/repos/.codeg-wt-frontend-uat-1")).toBe(
      true
    )
  })

  it("rejects real worktrees, normal paths and empty input", () => {
    expect(isResidualTempWorktreePath("D:\\repos\\api-dev")).toBe(false)
    expect(isResidualTempWorktreePath("D:\\repos\\api\\feature-wt")).toBe(false)
    expect(isResidualTempWorktreePath("")).toBe(false)
    expect(isResidualTempWorktreePath(null)).toBe(false)
    expect(isResidualTempWorktreePath(undefined)).toBe(false)
  })
})
