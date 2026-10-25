import type { GitLogFileChange } from "@/lib/types"

// Build a directory tree out of a commit's changed files, mirroring the
// right-side git-log tab (single-child directory chains are compressed).

export type CommitFileTreeDirNode = {
  kind: "dir"
  name: string
  path: string
  children: CommitFileTreeNode[]
  fileCount: number
}

export type CommitFileTreeFileNode = {
  kind: "file"
  name: string
  path: string
  change: GitLogFileChange
}

export type CommitFileTreeNode = CommitFileTreeDirNode | CommitFileTreeFileNode

interface MutableCommitFileTreeDirNode {
  kind: "dir"
  name: string
  path: string
  children: Map<string, MutableCommitFileTreeDirNode | CommitFileTreeFileNode>
}

function normalizePathSegments(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!normalized) return []
  return normalized.split("/").filter(Boolean)
}

function toSortedTreeNodes(
  dir: MutableCommitFileTreeDirNode
): CommitFileTreeNode[] {
  return Array.from(dir.children.values())
    .map<CommitFileTreeNode>((node) => {
      if (node.kind === "file") return node
      return {
        kind: "dir" as const,
        fileCount: 0,
        name: node.name,
        path: node.path,
        children: toSortedTreeNodes(node),
      }
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    })
}

function compressAndAnnotateDir(
  node: CommitFileTreeDirNode
): CommitFileTreeDirNode {
  const compressedChildren: CommitFileTreeNode[] = node.children.map(
    (child) => {
      if (child.kind === "file") return child
      return compressAndAnnotateDir(child)
    }
  )

  let nextNode: CommitFileTreeDirNode = {
    ...node,
    children: compressedChildren,
    fileCount: compressedChildren.reduce(
      (count, child) => count + (child.kind === "file" ? 1 : child.fileCount),
      0
    ),
  }

  // Merge "dir/dir/dir" chains where each directory has only one directory child.
  while (
    nextNode.children.length === 1 &&
    nextNode.children[0].kind === "dir"
  ) {
    const onlyChild = nextNode.children[0]
    nextNode = {
      kind: "dir",
      name: `${nextNode.name}/${onlyChild.name}`,
      path: onlyChild.path,
      children: onlyChild.children,
      fileCount: onlyChild.fileCount,
    }
  }

  return {
    ...nextNode,
    fileCount: nextNode.children.reduce(
      (count, child) => count + (child.kind === "file" ? 1 : child.fileCount),
      0
    ),
  }
}

export function buildCommitFileTree(
  files: GitLogFileChange[]
): CommitFileTreeNode[] {
  const root: MutableCommitFileTreeDirNode = {
    kind: "dir",
    name: "",
    path: "",
    children: new Map(),
  }

  for (const change of files) {
    const segments = normalizePathSegments(change.path)
    if (segments.length === 0) continue

    let current = root
    for (const [index, segment] of segments.entries()) {
      const nodePath = segments.slice(0, index + 1).join("/")
      const isLeaf = index === segments.length - 1

      if (isLeaf) {
        current.children.set(`file:${nodePath}`, {
          kind: "file",
          name: segment,
          path: nodePath,
          change,
        })
        continue
      }

      const dirKey = `dir:${nodePath}`
      const existing = current.children.get(dirKey)
      if (existing && existing.kind === "dir") {
        current = existing
        continue
      }

      const nextDir: MutableCommitFileTreeDirNode = {
        kind: "dir",
        name: segment,
        path: nodePath,
        children: new Map(),
      }
      current.children.set(dirKey, nextDir)
      current = nextDir
    }
  }

  return toSortedTreeNodes(root).map((node) =>
    node.kind === "file" ? node : compressAndAnnotateDir(node)
  )
}

export function collectExpandedDirectoryPaths(
  nodes: CommitFileTreeNode[],
  expanded = new Set<string>()
): Set<string> {
  for (const node of nodes) {
    if (node.kind !== "dir") continue
    expanded.add(node.path)
    collectExpandedDirectoryPaths(node.children, expanded)
  }
  return expanded
}
