"use client"

import type { ReactNode } from "react"

import { PlatformProvider } from "@/contexts/platform-context"

/**
 * [ai-platform] Mounts the platform project context around the workspace
 * shell: the sidebar (project section), the aux panel (knowledge-base tab)
 * and every workbench route consume it.
 *
 * History note (D31): this used to wrap the whole provider tree in
 * layout.tsx, OUTSIDE ConversationRuntimeProvider, so that mounting a
 * platform page could never spawn an ACP session. ConversationRuntimeProvider
 * has since become a passthrough shim (runtime state lives in the zustand
 * store), so the old constraint is moot — the provider now wraps the shell's
 * children instead. Kept as a standalone wrapper so layout.tsx carries a
 * single-line seam that upstream edits inside the shell cannot collide with.
 */
export function PlatformShellProvider({ children }: { children: ReactNode }) {
  return <PlatformProvider>{children}</PlatformProvider>
}
