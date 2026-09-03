import { CommandGroup, CommandItem } from "@/components/ui/command"
import { File } from "lucide-react"
import type { FileContentMatch } from "@/lib/types"

interface ContentSearchResultsProps {
  searching: boolean
  results: FileContentMatch[]
  /** Group heading (i18n-resolved by the caller). */
  headingLabel: string
  /** Rendered inside the group while a search is in flight. */
  searchingLabel: string
  onSelect: (match: FileContentMatch) => void
}

/**
 * The "content matches" group of the search dialog's Files tab — a fork
 * feature with no main-side counterpart. Renders the in-flight spinner or the
 * match rows (path, trimmed line preview, line number); nothing else. Kept as
 * its own component so the dialog keeps only a thin mount point.
 */
export function ContentSearchResults({
  searching,
  results,
  headingLabel,
  searchingLabel,
  onSelect,
}: ContentSearchResultsProps) {
  if (!searching && results.length === 0) return null
  return (
    <CommandGroup heading={headingLabel}>
      {searching ? (
        <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
          <svg
            className="w-3 h-3 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {searchingLabel}
        </div>
      ) : (
        results.map((match, i) => (
          <CommandItem
            key={`content-${match.relativePath}-${match.lineNumber}-${i}`}
            value={`content-${match.relativePath}-${match.lineNumber}`}
            onSelect={() => onSelect(match)}
          >
            <File className="w-4 h-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="truncate text-sm">{match.relativePath}</div>
              <div className="truncate text-xs text-muted-foreground">
                {match.lineContent.trimStart()}
              </div>
            </div>
            <span className="text-xs text-muted-foreground shrink-0">
              :{match.lineNumber}
            </span>
          </CommandItem>
        ))
      )}
    </CommandGroup>
  )
}
