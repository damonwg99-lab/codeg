"use client"

/**
 * Back-compat `useAppWorkspace` shim for Platform (Cluster A) components.
 *
 * main reorganized the workspace API in two layers:
 *   `useAppWorkspaceStore` (zustand) — folders / activeFolderId / conversations
 *   `AppWorkspaceProvider`     (context)  — sync + event-bridge side-effects
 *
 * 二开 platform code calls a single `useAppWorkspace()` hook that returns
 * `{ activeFolderId, setActiveFolderId, addFolderToWorkspaceById, folders,
 *    allFolders, conversations, refreshConversations, … }` from one source.
 * Rather than re-write every platform component (D32: keep main files untouched
 * and keep二开 surface minimal), this shim forwards to main's store and exposes
 * the same whole-value shape that platform consumers destructure.
 */
import { useShallow } from "zustand/react/shallow"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"

/**
 * Whole-value selector mirroring the二开 hook. New platform consumers should
 * prefer `useAppWorkspaceStore(s => …)` directly. This returns a shallow object
 * so destructure-by-key stays stable across unrelated store writes.
 */
export function useAppWorkspace() {
  return useAppWorkspaceStore(
    useShallow((s) => ({
      folders: s.folders,
      allFolders: s.allFolders,
      activeFolderId: s.activeFolderId,
      setActiveFolderId: s.setActiveFolderId,
      addFolderToWorkspaceById: s.addFolderToWorkspaceById,
      conversations: s.conversations,
      refreshConversations: s.refreshConversations,
    }))
  )
}