import type { GitLogFileChange } from "@/lib/types"

// Split a unified diff (as returned by git_diff_with_branch) into per-file
// sections so the diff tab can show a file tree and reveal one file's diff on
// click — mirroring the commit-history tab. Pure + unit-tested.

export interface DiffFileSection {
  change: GitLogFileChange
  text: string
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

function pathFromHeader(header: string): string {
  // `diff --git a/<old> b/<new>` — greedy first group so paths with spaces work
  // and the trailing ` b/` wins for renames.
  const match = header.match(/^diff --git a\/(.*) b\/(.*)$/)
  return match ? match[2] : ""
}

export function parseDiffFileSections(diffText: string): DiffFileSection[] {
  if (!diffText) return []

  const lines = diffText.split("\n")
  const sections: DiffFileSection[] = []
  let block: string[] | null = null

  const flush = () => {
    if (!block || block.length === 0) return
    const text = block.join("\n")
    const header = block[0]

    let status = "M"
    let path = ""

    for (const line of block.slice(1)) {
      if (line.startsWith("@@")) break
      if (line.startsWith("new file mode")) {
        status = "A"
      } else if (line.startsWith("deleted file mode")) {
        status = "D"
      } else if (line.startsWith("rename to ")) {
        status = "R"
        path = line.slice("rename to ".length).trim()
      } else if (line.startsWith("rename from ")) {
        status = "R"
      } else if (line.startsWith("+++ ")) {
        const value = line.slice(4).trim()
        if (value !== "/dev/null") path = stripPrefix(value, "b/")
      } else if (line.startsWith("--- ") && !path) {
        const value = line.slice(4).trim()
        if (value !== "/dev/null") path = stripPrefix(value, "a/")
      }
    }

    if (!path) path = pathFromHeader(header)
    if (!path) return

    let additions = 0
    let deletions = 0
    for (const line of block) {
      if (line.startsWith("+") && !line.startsWith("+++ ")) additions++
      else if (line.startsWith("-") && !line.startsWith("--- ")) deletions++
    }

    sections.push({
      change: { path, status, additions, deletions },
      text,
    })
  }

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush()
      block = [line]
    } else if (block) {
      block.push(line)
    }
  }
  flush()

  return sections
}
