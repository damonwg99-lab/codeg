"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react"
import { useWorkbenchTabStore } from "@/stores/workbench-tab-store"
import { useIsMobile } from "@/hooks/use-mobile"

/**
 * The view occupying the main content region. `"conversations"` is the default
 * workspace (folder/conversation tabs); every other id is a full-page "route"
 * rendered in place of it (see WORKBENCH_ROUTES in workbench-content.tsx).
 *
 * To add a future left-sidebar route: extend this union, register a page
 * component in WORKBENCH_ROUTES, and add a SidebarNavButton that calls
 * `setRoute("<id>")`. Nothing else needs to change.
 */
export type WorkbenchRouteId =
  | "conversations"
  | "automations"
  | "project-list"
  | "project-detail"
  | "create-project"
  | "task-kanban"
  | "task-detail"
  | "create-task"
  | "release-list"
  | "release-detail"
  | "create-release"
  | "archive-view"

interface WorkbenchRouteContextValue {
  routeId: WorkbenchRouteId
  /** Route params (id, projectId, taskId, etc.) for the active route. */
  routeParams: Record<string, string | number>
  /** The route the user navigated FROM (for back-button logic).
   *  Null means no recorded origin — fall back to default. */
  fromRoute: WorkbenchRouteId | null
  /** Params of the origin route (e.g. { projectId } for task-kanban). */
  fromParams: Record<string, string | number>
  /** Convenience for the common branch — `routeId === "conversations"`. */
  isConversations: boolean
  /**
   * Navigate to a workbench route.
   *  - Passing `from` navigates the ACTIVE tab in place (list → detail drill
   *    replaces the list; the back button returns to `from`).
   *  - Without `from`, opens (or focuses) a top-level tab — a fresh, separate
   *    page tab like the sidebar entries.
   */
  setRoute: (
    id: WorkbenchRouteId,
    params?: Record<string, string | number>,
    from?: {
      routeId: WorkbenchRouteId
      params?: Record<string, string | number>
    }
  ) => void
  /** Sugar for returning to the conversation workspace. */
  openConversations: () => void
  /** Pop the active tab back to its recorded origin (no-op if none). */
  back: () => void
}

const WorkbenchRouteContext = createContext<WorkbenchRouteContextValue | null>(
  null
)

/**
 * Drives which view fills the main content region. This mirrors the codebase's
 * lifted-state idiom (search-dialog-context): the trigger lives in the sidebar
 * (which unmounts when collapsed) while the content swap is owned by
 * WorkspaceContent — both read this single source of truth.
 *
 * State is in-memory only: a reload lands back on the conversation workspace.
 * That is deliberate; static export rules out URL route segments, and the
 * established pattern here is in-memory context rather than query params.
 */
export function useWorkbenchRoute() {
  const ctx = useContext(WorkbenchRouteContext)
  if (!ctx) {
    throw new Error(
      "useWorkbenchRoute must be used within WorkbenchRouteProvider"
    )
  }
  return ctx
}

export function WorkbenchRouteProvider({ children }: { children: ReactNode }) {
  // Thin facade over the workbench tab store: the active workbench tab (if any)
  // drives which route fills the main region; when none is active the
  // conversation workspace shows. Public API (routeId/routeParams/setRoute/
  // openConversations/isConversations) is unchanged so all platform call sites
  // keep working untouched. `fromRoute`/`fromParams`/`back` are backed by the
  // active tab's in-tab navigation record.
  const activeTab = useWorkbenchTabStore((s) =>
    s.tabs.find((tab) => tab.id === s.activeTabId)
  )
  const openTab = useWorkbenchTabStore((s) => s.openTab)
  const switchTab = useWorkbenchTabStore((s) => s.switchTab)
  const navigateTab = useWorkbenchTabStore((s) => s.navigateTab)

  const isMobile = useIsMobile()

  const openConversations = useCallback(() => {
    // Desktop: the conversation column and the workbench right zone coexist —
    // focusing a conversation must NOT clear the focused workbench tab (that
    // would fall the right zone back to the empty "open a file or diff" hint).
    // Mobile is single-pane: a conversation focus hides the workbench overlay.
    if (isMobile) switchTab(null)
  }, [isMobile, switchTab])

  const setRoute = useCallback(
    (
      id: WorkbenchRouteId,
      params?: Record<string, string | number>,
      from?: {
        routeId: WorkbenchRouteId
        params?: Record<string, string | number>
      }
    ) => {
      if (id === "conversations") {
        openConversations()
        return
      }
      if (from && activeTab) {
        navigateTab(activeTab.id, id, params, from)
        return
      }
      openTab(id, params)
    },
    [openTab, navigateTab, openConversations, activeTab]
  )

  const back = useCallback(() => {
    if (!activeTab?.backRoute) return
    navigateTab(
      activeTab.id,
      activeTab.backRoute,
      activeTab.backParams ?? {},
      null
    )
  }, [activeTab, navigateTab])

  const value = useMemo<WorkbenchRouteContextValue>(
    () => ({
      routeId: activeTab?.routeId ?? "conversations",
      routeParams: activeTab?.params ?? {},
      fromRoute: activeTab?.backRoute ?? null,
      fromParams: activeTab?.backParams ?? {},
      isConversations: !activeTab,
      setRoute,
      openConversations,
      back,
    }),
    [activeTab, setRoute, openConversations, back]
  )

  return (
    <WorkbenchRouteContext.Provider value={value}>
      {children}
    </WorkbenchRouteContext.Provider>
  )
}
