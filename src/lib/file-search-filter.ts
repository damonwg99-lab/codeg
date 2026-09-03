import type { FlatFileEntry } from "@/hooks/use-file-tree"

/**
 * The file-list strategy for the search dialog's Files tab (fork behavior —
 * main ranks matches via `rankFileMatches`; this fork prefers a deterministic
 * filter so a freshly opened tab doubles as a mini browser):
 *
 * - Empty query: top-level browse — dotfiles and `.json` entries excluded,
 *   sorted by name, capped at `limit` so the list stays scannable.
 * - Non-empty query: fast substring match against the pre-computed lowercase
 *   name/path fields, first `limit` matches in file order.
 *
 * Lives outside the dialog so main's component refactors never touch it.
 */
export function filterFileEntriesForSearch(
  query: string,
  allFiles: readonly FlatFileEntry[],
  limit = 100
): FlatFileEntry[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return allFiles
      .filter((f) => !f.name.startsWith(".") && !f.relativePath.startsWith("."))
      .filter((f) => !f.name.endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit)
  }
  const lower = trimmed.toLowerCase()
  const matched: FlatFileEntry[] = []
  for (const f of allFiles) {
    if (f.lowerName.includes(lower) || f.lowerPath.includes(lower)) {
      matched.push(f)
      if (matched.length >= limit) break
    }
  }
  return matched
}
