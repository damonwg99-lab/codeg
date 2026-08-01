/**
 * Platform-custom tab slice — pending task-link state for the task→conversation
 * flow (Cluster A/B).
 *
 * This is a standalone zustand store, deliberately SEPARATE from main's
 * `tab-store.ts`. Per D32 (解耦优先元原则), main files stay untouched; the
 * platform layer owns its own state and publishes a narrow hook surface.
 *
 * State:
 *   - `pendingTaskLink` — pending task link intent for draft tabs, stored when
 *     the user selects a task in the Popover before the conversation exists,
 *     auto-executed after creation, keyed by tabId. Used by:
 *     `conversation-detail-panel.tsx`, `task-context-popover.tsx` (writers)
 *     and `conversation-detail-panel.tsx` reader on send
 *     (binds platform_task_conversation record).
 *
 * Note on pendingInitialDrafts: the二开 originally kept a parallel
 * `pendingInitialDrafts` map here, but the D4 decision routes task→conversation
 * composer pre-fill through main's `message-input-draft` v2 store
 * (`saveMessageInputDraftV2` / `buildNewConversationDraftStorageKey`) so the
 * draft survives a restart and hydrates through main's composer via
 * `from-prompt-blocks`. Phase 4 wires the writer; nothing of that lives here.
 */

import { create } from "zustand"
import { registerBackendScopedStoreReset } from "@/stores/backend-scoped-store-reset"

export interface PendingTaskLink {
  taskId: number
  role: string
  title: string
  taskType: string
}

export interface PlatformTabSliceState {
  /** Pending task link intent for draft tabs. Stored when user selects a task
   *  in the Popover before the conversation is created. Auto-executed after
   *  conversation creation. Keyed by tabId. */
  pendingTaskLink: Map<string, PendingTaskLink | null>

  setPendingTaskLink: (
    tabId: string,
    taskId: number,
    role: string,
    title: string,
    taskType: string
  ) => void
  clearPendingTaskLink: (tabId: string) => void
}

function initialPlatformTabSliceState(): Omit<
  PlatformTabSliceState,
  "setPendingTaskLink" | "clearPendingTaskLink"
> {
  return {
    pendingTaskLink: new Map<string, PendingTaskLink | null>(),
  }
}

export const usePlatformTabSlice = create<PlatformTabSliceState>()((set) => ({
  ...initialPlatformTabSliceState(),

  setPendingTaskLink: (tabId, taskId, role, title, taskType) => {
    set((s) => {
      const next = new Map(s.pendingTaskLink)
      next.set(tabId, { taskId, role, title, taskType })
      return { pendingTaskLink: next }
    })
  },
  clearPendingTaskLink: (tabId) => {
    set((s) => {
      const next = new Map(s.pendingTaskLink)
      next.delete(tabId)
      return { pendingTaskLink: next }
    })
  },
}))

/**
 * Restore pristine state. Used by tests, and by the backend-scoped reset
 * registry if a realm's backend identity ever changes (see
 * `backend-scoped-store-reset.ts` — same invariant note as the main tab store).
 */
export function resetPlatformTabSlice(): void {
  usePlatformTabSlice.setState(initialPlatformTabSliceState())
}

registerBackendScopedStoreReset(resetPlatformTabSlice)