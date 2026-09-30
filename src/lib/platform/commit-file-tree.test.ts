import { describe, it, expect } from "vitest"
import {
  buildCommitFileTree,
  collectExpandedDirectoryPaths,
  type CommitFileTreeNode,
} from "./commit-file-tree"
import type { GitLogFileChange } from "@/lib/types"

function f(path: string): GitLogFileChange {
  return { path, status: "M", additions: 1, deletions: 0 }
}

function names(nodes: CommitFileTreeNode[]): string[] {
  return nodes.map((n) => `${n.kind}:${n.name}`)
}

describe("buildCommitFileTree", () => {
  it("nests files under directories", () => {
    const tree = buildCommitFileTree([f("src/a.ts"), f("src/b.ts")])
    expect(names(tree)).toEqual(["dir:src"])
    const dir = tree[0]
    if (dir.kind !== "dir") throw new Error("expected dir")
    expect(dir.fileCount).toBe(2)
    expect(names(dir.children)).toEqual(["file:a.ts", "file:b.ts"])
  })

  it("compresses single-child directory chains", () => {
    const tree = buildCommitFileTree([f("a/b/c/file.ts")])
    expect(names(tree)).toEqual(["dir:a/b/c"])
  })

  it("normalizes backslashes", () => {
    const tree = buildCommitFileTree([f("a\\b\\file.ts")])
    expect(names(tree)).toEqual(["dir:a/b"])
  })

  it("collects all directory paths", () => {
    const tree = buildCommitFileTree([f("a/b/file.ts"), f("c/d.ts")])
    const paths = collectExpandedDirectoryPaths(tree)
    expect(paths.has("a/b")).toBe(true)
    expect(paths.has("c")).toBe(true)
  })
})