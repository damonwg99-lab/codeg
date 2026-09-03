"use client"

import { useMemo } from "react"
import { usePlatform } from "@/contexts/platform-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { computeScopedTopLevelFolders } from "@/lib/folder-scoping"
import { FolderPicker } from "@/components/chat/conversation-context-bar"
import type { FolderPickerProps } from "@/components/chat/conversation-context-bar"

/**
 * The folder list the below-input picker should offer, resolved from the
 * platform context: when an active project exists the list is SCOPED to that
 * project's repos (root folder + sub-repos, path-deduped); otherwise it falls
 * back to main's default top-level non-chat repos with hidden platform repos
 * excluded. All scoping logic lives in `@/lib/folder-scoping` so main's
 * component refactors never touch it.
 */
function useScopedPickerFolders() {
  const { activeProject, activeProjectRepos } = usePlatform()
  const folders = useAppWorkspaceStore((s) => s.folders)
  const allFolders = useAppWorkspaceStore((s) => s.allFolders)
  return useMemo(
    () =>
      computeScopedTopLevelFolders({
        folders,
        allFolders,
        activeProject,
        activeProjectRepos,
      }),
    [folders, allFolders, activeProject, activeProjectRepos]
  )
}

export type ScopedFolderPickerProps = Omit<FolderPickerProps, "folders">

/**
 * Platform wrapper around main's `FolderPicker` for the below-composer
 * conversation context row. Owns the two platform deltas so the upstream
 * component keeps main's exact shape:
 *
 * 1. the scoped folder list (see {@link useScopedPickerFolders}), and
 * 2. the visibility rule — the picker renders only when at least one folder
 *    exists to switch to. (A scoped single-repo project that surfaces two rows
 *    for the same directory collapses to one after path-dedup, but the dropdown
 *    must stay so the folder list AND the pinned "no-folder / chat mode" footer
 *    remain reachable — dedup must never hide the picker.)
 *
 * Everything else (current folder display, chat-mode state, the select
 * handlers) flows through verbatim — main owns that behavior and evolves it.
 */
export function ScopedFolderPicker(props: ScopedFolderPickerProps) {
  const folders = useScopedPickerFolders()
  if (folders.length < 1) return null
  return <FolderPicker {...props} folders={folders} />
}
