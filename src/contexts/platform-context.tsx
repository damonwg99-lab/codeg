"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type SidebarTab = "chat" | "project"
export type ViewMode = "kanban" | "list"
export type PlatformView =
  | "home"
  | "project-detail"
  | "task-detail"
  | "create-project"
  | "create-task"

interface PlatformContextValue {
  // Sidebar tab
  sidebarTab: SidebarTab
  setSidebarTab: (tab: SidebarTab) => void

  // Current project
  activeProjectId: number | null
  setActiveProjectId: (id: number | null) => void

  // Task view mode
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void

  // Platform content view
  platformView: PlatformView
  setPlatformView: (view: PlatformView) => void

  // Current task
  selectedTaskId: number | null
  setSelectedTaskId: (id: number | null) => void
}

const PlatformContext = createContext<PlatformContextValue | null>(null)

export function usePlatformContext() {
  const ctx = useContext(PlatformContext)
  if (!ctx) {
    throw new Error(
      "usePlatformContext must be used within PlatformProvider",
    )
  }
  return ctx
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("chat")
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("kanban")
  const [platformView, setPlatformView] = useState<PlatformView>("home")
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)

  const value = useMemo(
    () =>
      ({
        sidebarTab,
        setSidebarTab,
        activeProjectId,
        setActiveProjectId,
        viewMode,
        setViewMode,
        platformView,
        setPlatformView,
        selectedTaskId,
        setSelectedTaskId,
      }) as PlatformContextValue,
    [
      sidebarTab,
      activeProjectId,
      viewMode,
      platformView,
      selectedTaskId,
    ],
  )

  return (
    <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
  )
}
