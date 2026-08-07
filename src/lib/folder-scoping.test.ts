import { describe, expect, it } from "vitest"
import {
  computeScopedTopLevelFolders,
  normalizeFolderPath,
} from "@/lib/folder-scoping"
import type { FolderDetail } from "@/lib/types"

function folder(
  partial: Omit<Partial<FolderDetail>, "kind"> &
    Pick<FolderDetail, "id" | "name"> & { kind?: string }
): FolderDetail {
  const { kind, ...rest } = partial
  const base: FolderDetail = {
    path: `/repo/${rest.name}`,
    git_branch: null,
    default_agent_type: null,
    last_opened_at: "",
    sort_order: 0,
    color: "",
    parent_id: null,
    kind: "regular",
    alias: null,
    ...rest,
  }
  // Folders backed by a platform repo carry a kind the narrow TS union does
  // not enumerate (`platform_repo`), but which the runtime/DB can produce.
  base.kind = (kind ?? "regular") as FolderDetail["kind"]
  return base
}

describe("normalizeFolderPath", () => {
  it("trims whitespace", () => {
    expect(normalizeFolderPath("  /repo/foo  ")).toBe("/repo/foo")
  })

  it("strips trailing separators", () => {
    expect(normalizeFolderPath("/repo/foo/")).toBe("/repo/foo")
    expect(normalizeFolderPath("/repo/foo\\")).toBe("/repo/foo")
  })

  it("case-folds", () => {
    expect(normalizeFolderPath("/Repo/Foo")).toBe("/repo/foo")
  })

  it("returns empty string for null/undefined", () => {
    expect(normalizeFolderPath(null)).toBe("")
    expect(normalizeFolderPath(undefined)).toBe("")
  })
})

describe("computeScopedTopLevelFolders", () => {
  it("falls back to top-level non-chat repos when no project is active", () => {
    const chatFolder = folder({ id: 1, name: "chat-a", kind: "chat" })
    const worktree = folder({ id: 2, name: "repo-wt", parent_id: 9 })
    const repo = folder({ id: 3, name: "repo" })
    const result = computeScopedTopLevelFolders({
      folders: [chatFolder, worktree, repo],
      allFolders: [chatFolder, worktree, repo],
      activeProject: null,
      activeProjectRepos: [],
    })
    expect(result.map((f) => f.id)).toEqual([3])
  })

  it("excludes hidden platform_repo sub-repos from the unscoped fallback", () => {
    const repo = folder({ id: 3, name: "repo" })
    const hidden = folder({ id: 4, name: "repo-sub", kind: "platform_repo" })
    const result = computeScopedTopLevelFolders({
      folders: [repo, hidden],
      allFolders: [repo, hidden],
      activeProject: null,
      activeProjectRepos: [],
    })
    expect(result.map((f) => f.id)).toEqual([3])
  })

  it("scopes to the project root folder and its sub-repos", () => {
    const root = folder({ id: 10, name: "root" })
    const subA = folder({ id: 11, name: "sub-a", kind: "platform_repo" })
    const subB = folder({ id: 12, name: "sub-b", kind: "platform_repo" })
    const unrelated = folder({ id: 13, name: "other" })
    const result = computeScopedTopLevelFolders({
      folders: [root, unrelated],
      allFolders: [root, subA, subB, unrelated],
      activeProject: { folderId: 10 },
      activeProjectRepos: [{ folderId: 11 }, { folderId: 12 }],
    })
    expect(result.map((f) => f.id)).toEqual([10, 11, 12])
  })

  it("dedups the same directory surfaced under two folder ids (case + trailing slash)", () => {
    const root = folder({
      id: 10,
      name: "root",
      path: "/Repo/MyProject/",
    })
    const dup = folder({
      id: 11,
      name: "root-sub",
      kind: "platform_repo",
      path: "/repo/myproject",
    })
    const result = computeScopedTopLevelFolders({
      folders: [root, dup],
      allFolders: [root, dup],
      activeProject: { folderId: 10 },
      activeProjectRepos: [{ folderId: 11 }],
    })
    expect(result.map((f) => f.id)).toEqual([10])
  })

  it("dedups by id even when paths differ", () => {
    const root = folder({ id: 10, name: "root", path: "/repo/a" })
    const dup = folder({ id: 10, name: "root", path: "/repo/b" })
    const result = computeScopedTopLevelFolders({
      folders: [root, dup],
      allFolders: [root, dup],
      activeProject: { folderId: 10 },
      activeProjectRepos: [{ folderId: 10 }],
    })
    expect(result.map((f) => f.id)).toEqual([10])
  })

  it("skips sub-repos without a folder id", () => {
    const root = folder({ id: 10, name: "root" })
    const result = computeScopedTopLevelFolders({
      folders: [root],
      allFolders: [root],
      activeProject: { folderId: 10 },
      activeProjectRepos: [{ folderId: null }],
    })
    expect(result.map((f) => f.id)).toEqual([10])
  })
})
