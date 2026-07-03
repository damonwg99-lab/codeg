"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

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
  const [routeId, setRouteId] = useState<WorkbenchRouteId>("conversations")
  const [routeParams, setRouteParams] = useState<
    Record<string, string | number>
  >({})
  const [fromRoute, setFromRoute] = useState<WorkbenchRouteId | null>(null)
  const [fromParams, setFromParams] = useState<Record<string, string | number>>(
    {}
  )

  const setRoute = useCallback(
    (
      id: WorkbenchRouteId,
      params?: Record<string, string | number>,
      from?: {
        routeId: WorkbenchRouteId
        params?: Record<string, string | number>
      }
    ) => {
      setRouteId(id)
      setRouteParams(params ?? {})
      if (from) {
        setFromRoute(from.routeId)
        setFromParams(from.params ?? {})
      } else {
        setFromRoute(null)
        setFromParams({})
      }
    },
    []
  )

  const openConversations = useCallback(() => {
    setRouteId("conversations")
    setRouteParams({})
    setFromRoute(null)
    setFromParams({})
  }, [])

  const value = useMemo<WorkbenchRouteContextValue>(
    () => ({
      routeId,
      routeParams,
      fromRoute,
      fromParams,
      isConversations: routeId === "conversations",
      setRoute,
      openConversations,
    }),
    [routeId, routeParams, fromRoute, fromParams, setRoute, openConversations]
  )

  return (
    <WorkbenchRouteContext.Provider value={value}>
      {children}
    </WorkbenchRouteContext.Provider>
  )
}
