/**
 * Platform-custom tab slice — pending draft / task-link state for the
 * task→conversation flow.
 *
 * This is a standalone zustand store, deliberately SEPARATE from the main
 * `tab-store.ts`, so that upstream changes to the tab store's `TabStoreState`
 * interface, `initialTabState`, action bodies, and `useTabActions` selector
 * don't conflict with this secondary-development state. `tab-context.tsx`
 * merges both stores into the backwards-compatible `useTabContext` /
 * `useTabActions` API, so consumers don't change.
 *
 * State:
 *   - `pendingInitialDrafts` — pre-fill content for newly created conversation
 *     tabs (task→conversation flow context prefix), keyed by tabId.
 *   - `pendingTaskLink` — pending task link intent for draft tabs, stored when
 *     the user selects a task in the Popover before the conversation exists,
 *     auto-executed after creation, keyed by tabId.
 *
 * Both use `Map` values with copy-on-write immutable updates (same pattern as
 * the original useState-based implementation) so zustand's shallow selector
 * stays stable across unrelated writes.
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
  /** Pending initial content for newly created conversation tabs. Used by
   *  the task→conversation flow to pre-fill the composer with a context
   *  prefix. Keyed by tabId to prevent badge drafts leaking across tabs. */
  pendingInitialDrafts: Map<string, string>
  /** Pending task link intent for draft tabs. Stored when user selects a task
   *  in the Popover before the conversation is created. Auto-executed after
   *  conversation creation. Keyed by tabId. */
  pendingTaskLink: Map<string, PendingTaskLink | null>

  setPendingInitialDraft: (tabId: string, content: string) => void
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

  setPendingInitialDraft: (tabId, content) => {
    set((s) => {
      const next = new Map(s.pendingInitialDrafts)
      next.set(tabId, content)
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
