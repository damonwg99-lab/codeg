import { describe, it, expect } from "vitest"
import type { GitStatusEntry } from "@/lib/types"
import {
  canMerge,
  envCellState,
  filterRows,
  isFullyMerged,
  remoteStatusKey,
  resolveEffectiveEnv,
  unmergedEnvs,
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
      ahead: 0,
      behind: 2,
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
          ahead: 3,
          behind: 1,
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

describe("unmergedEnvs", () => {
  it("only lists environments the branch is not merged into", () => {
    const row: BranchRow = {
      ...baseRow,
      envs: [
        {
          env: "dev",
          merged: false,
          mergeVia: null,
          mergeDate: null,
          ahead: 0,
          behind: 0,
        },
        {
          env: "uat",
          merged: true,
          mergeVia: "merge",
          mergeDate: null,
          ahead: 0,
          behind: 0,
        },
        {
          env: "prd",
          merged: true,
          mergeVia: "merge",
          mergeDate: null,
          ahead: 0,
          behind: 0,
        },
      ],
    }
    expect(unmergedEnvs(row)).toEqual(["dev"])
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
            ahead: 0,
            behind: 0,
          },
          {
            env: "prd",
            merged: false,
            mergeVia: null,
            mergeDate: null,
            ahead: 1,
            behind: 0,
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
            ahead: 2,
            behind: 0,
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
