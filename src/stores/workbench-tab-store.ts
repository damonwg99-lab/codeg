/**
 * Workbench tab slice — project/task/release page tabs that coexist with the
 * main conversation tabs on a single unified strip.
 *
 * This is a standalone zustand store, deliberately SEPARATE from main's
 * `tab-store.ts` (which owns conversation tabs). Per D32 (解耦优先元原则), main
 * files stay untouched; the platform layer owns its own state and publishes a
 * narrow hook surface. `workbench-route-context.tsx` becomes a thin facade over
 * this store so every existing `setRoute(...)` call site keeps working.
 *
 * Tabs are identified by a deterministic key of `routeId + sorted params`, so
 * opening the same view twice dedups to a single tab (browser-like). Tab ids
 * are NOT persisted and there is no cross-client sync (mirrors the file-tab
 * pattern in workspace-context, not the conversation tab-store).
 *
 * State:
 *   - `tabs` — open workbench page tabs (project-list, task-detail, …).
 *   - `activeTabId` — the active workbench tab. `null` means no workbench
 *     page is focused (the right zone falls back to the file layer).
 *   - `layer` — which right-zone layer the user last touched: the workbench
 *     (project/task pages) or the file workspace. The two layers are mutually
 *     exclusive with no switch tabs; "last opened" wins (see
 *     `workbench-right-zone.tsx` for the empty-layer fallback rules).
 *
 * Titles are derived at render time by the tab bar from the route's i18n
 * labels; a page may override with `setTabTitle(id, title)` (e.g. a real
 * project/task name) once it has loaded its data.
 *
 * In-tab navigation: a tab may carry a `backRoute`/`backParams` origin so a
 * list → detail drill replaces the list in place instead of stacking tabs.
 * `navigateTab` swaps the tab's route (browser-like), recording the back
 * target; `back()` pops to it and clears the record.
 */

import { create } from "zustand"
import { registerBackendScopedStoreReset } from "@/stores/backend-scoped-store-reset"
import type { WorkbenchRouteId } from "@/contexts/workbench-route-context"

export type WorkbenchLayer = "file" | "workbench"

export interface WorkbenchTabBack {
  routeId: WorkbenchRouteId
  params?: Record<string, string | number>
}

export interface WorkbenchTab {
  id: string
  routeId: WorkbenchRouteId
  params: Record<string, string | number>
  /** Optional override (e.g. a real project/task name) set by the page. */
  title?: string
  /** Origin for the back button; set by in-tab navigation, cleared on pop. */
  backRoute: WorkbenchRouteId | null
  backParams: Record<string, string | number>
}

export interface WorkbenchTabStoreState {
  tabs: WorkbenchTab[]
  /** Active workbench tab id. `null` = no workbench page is focused. */
  activeTabId: string | null
  /** Which right-zone layer the user last interacted with. */
  layer: WorkbenchLayer
  /** Open (or focus, if already open) a workbench page. */
  openTab: (
    routeId: WorkbenchRouteId,
    params?: Record<string, string | number>
  ) => void
  /**
   * Navigate the given tab in place to a new route, recording the back
   * target. The tab's title is PRESERVED (the resolved i18n label was frozen
   * by the tab bar), so an in-tab list → detail drill never makes the strip
   * text jump.
   */
  navigateTab: (
    tabId: string,
    routeId: WorkbenchRouteId,
    params?: Record<string, string | number>,
    back?: WorkbenchTabBack | null
  ) => void
  /** Activate a workbench tab, or pass `null` to focus nothing. */
  switchTab: (tabId: string | null) => void
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
  /** Apply a new tab order (from drag-to-reorder in the tab bar). */
  reorderTabs: (ordered: WorkbenchTab[]) => void
  setTabTitle: (tabId: string, title: string) => void
  setLayer: (layer: WorkbenchLayer) => void
  /** Whether the workbench layer fills the whole workspace area. */
  maximized: boolean
  toggleMaximized: () => void
}

/** Stable per-view key: `routeId` + sorted `params`. Equal keys dedup. */
export function workbenchTabKey(
  routeId: WorkbenchRouteId,
  params: Record<string, string | number>
): string {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join("&")
  return sorted ? `${routeId}?${sorted}` : routeId
}

function initialWorkbenchTabStoreState(): Pick<
  WorkbenchTabStoreState,
  "tabs" | "activeTabId" | "layer" | "maximized"
> {
  return {
    tabs: [],
    activeTabId: null,
    layer: "file",
    maximized: false,
  }
}

export const useWorkbenchTabStore = create<WorkbenchTabStoreState>()(
  (set, get) => ({
    ...initialWorkbenchTabStoreState(),

    openTab: (routeId, params = {}) => {
      const id = workbenchTabKey(routeId, params)
      const { tabs } = get()
      const existing = tabs.find((tab) => tab.id === id)
      if (existing) {
        // Focus the existing tab and nothing else. The tab may have been
        // in-place navigated to a detail route (a list → detail drill keeps
        // its original id): re-opening the list must NOT yank the user off the
        // detail page, and clearing backRoute would leave the back button dead.
        set({ activeTabId: id, layer: "workbench" })
        return
      }
      const tab: WorkbenchTab = {
        id,
        routeId,
        params,
        backRoute: null,
        backParams: {},
      }
      set({ tabs: [...tabs, tab], activeTabId: id, layer: "workbench" })
    },

    navigateTab: (tabId, routeId, params = {}, back) => {
      set((s) => ({
        tabs: s.tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                routeId,
                params,
                backRoute: back?.routeId ?? null,
                backParams: back?.params ?? {},
              }
            : tab
        ),
        activeTabId: tabId,
        layer: "workbench",
      }))
    },

    switchTab: (tabId) => {
      set(() =>
        tabId != null
          ? { activeTabId: tabId, layer: "workbench" }
          : // Returning to conversations: mirror the file workspace, which
            // clears its maximize state when the conversation pane activates.
            { activeTabId: null, maximized: false }
      )
    },

    closeTab: (tabId) => {
      const { tabs, activeTabId } = get()
      const index = tabs.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      const next = tabs.filter((tab) => tab.id !== tabId)
      let nextActive: string | null = activeTabId
      if (activeTabId === tabId) {
        // Activate the tab to the left, else the first remaining, else none
        // (back to conversations).
        nextActive = next[index - 1]?.id ?? next[0]?.id ?? null
      }
      // Mirror the file workspace: closing the last tab resets the layer's
      // maximized state so a later re-open returns to the split layout.
      set((s) => ({
        tabs: next,
        activeTabId: nextActive,
        maximized: next.length === 0 ? false : s.maximized,
      }))
    },

    closeOtherTabs: (tabId) => {
      const { activeTabId } = get()
      const keep = get().tabs.filter((tab) => tab.id === tabId)
      set((s) => ({
        tabs: keep,
        activeTabId: activeTabId === tabId ? tabId : (keep[0]?.id ?? null),
        maximized: keep.length === 0 ? false : s.maximized,
      }))
    },

    closeAllTabs: () => {
      set({ tabs: [], activeTabId: null, maximized: false })
    },

    reorderTabs: (ordered) => {
      set({ tabs: ordered })
    },

    setTabTitle: (tabId, title) => {
      set((s) => ({
        tabs: s.tabs.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
      }))
    },

    setLayer: (layer) => {
      set({ layer })
    },

    toggleMaximized: () => {
      set((s) => ({ maximized: !s.maximized }))
    },
  })
)

/**
 * Restore pristine state. Used by tests, and by the backend-scoped reset
 * registry if a realm's backend identity ever changes (see
 * `backend-scoped-store-reset.ts`).
 */
export function resetWorkbenchTabStore(): void {
  useWorkbenchTabStore.setState(initialWorkbenchTabStoreState())
}

registerBackendScopedStoreReset(resetWorkbenchTabStore)
