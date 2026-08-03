/**
 * Platform-custom tab slice — pending task-link + composer pre-fill for the
 * task→conversation flow (Cluster A/B).
 *
 * This is a standalone zustand store, deliberately SEPARATE from main's
 * `tab-store.ts`. Per D32 (解耦优先元原则), main files stay untouched; the
 * platform layer owns its own state and publishes a narrow hook surface.
 *
 * State:
 *   - `pendingInitialDrafts` — reference attrs to insert into the composer when
 *     a task-created conversation tab is first opened. Keyed by tabId.
 *     Writers: `task-detail.tsx` (on conversation creation).
 *     Consumer: `message-input.tsx` effect (insertReference + clear on mount).
 *
 *   - `pendingTaskLink` — pending task link intent for draft tabs, stored when
 *     the user selects a task in the Popover before the conversation exists,
 *     auto-executed after creation, keyed by tabId. Used by:
 *     `conversation-detail-panel.tsx`, `task-context-popover.tsx` (writers)
 *     and `conversation-detail-panel.tsx` reader on send
 *     (binds platform_task_conversation record).
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
  /** Reference attrs to auto-insert into the composer when a task-created
   *  conversation tab is first opened. JSON-serialized so zustand detects
   *  the change (Map.get(key) returns a new string → re-render). Keyed by
   *  tabId. Consumers call `insertReference(ref).insertContent(" ").run()`
   *  for each ref, then clear the draft. */
  pendingInitialDrafts: Map<string, string>

  /** Pending task link intent for draft tabs. Stored when user selects a task
   *  in the Popover before the conversation is created. Auto-executed after
   *  conversation creation. Keyed by tabId. */
  pendingTaskLink: Map<string, PendingTaskLink | null>

  setPendingInitialDraft: (tabId: string, refsJson: string) => void
  clearPendingInitialDraft: (tabId: string) => void

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
  | "setPendingInitialDraft"
  | "clearPendingInitialDraft"
  | "setPendingTaskLink"
  | "clearPendingTaskLink"
> {
  return {
    pendingInitialDrafts: new Map<string, string>(),
    pendingTaskLink: new Map<string, PendingTaskLink | null>(),
  }
}

export const usePlatformTabSlice = create<PlatformTabSliceState>()((set) => ({
  ...initialPlatformTabSliceState(),

  setPendingInitialDraft: (tabId, refsJson) => {
    set((s) => {
      const next = new Map(s.pendingInitialDrafts)
      next.set(tabId, refsJson)
      return { pendingInitialDrafts: next }
    })
  },
  clearPendingInitialDraft: (tabId) => {
    set((s) => {
      const next = new Map(s.pendingInitialDrafts)
      next.delete(tabId)
      return { pendingInitialDrafts: next }
    })
  },

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