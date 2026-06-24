"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { listProjects, getProject } from "@/lib/platform/api"
import { useAppWorkspace } from "@/contexts/app-workspace-context"
import type {
  ProjectInfo,
  ProjectDetail,
  ProjectRepoInfo,
} from "@/lib/platform/types"

const STORAGE_KEY = "platform:activeProjectId"

export type ViewMode = "kanban" | "list"

interface PlatformContextValue {
  // Project context — always requires a selected project
  activeProjectId: number | null
  setActiveProjectId: (id: number | null) => void
  activeProject: ProjectInfo | null
  /** Repos for the active project (loaded from ProjectDetail) */
  activeProjectRepos: ProjectRepoInfo[]
  /** All folder IDs associated with the active project (project folder only — root) */
  activeFolderIds: number[]
  projects: ProjectInfo[]
  loadProjects: () => Promise<void>
  /** Reload the active project detail (repos, folderIds) — call after repo mutations */
  loadProjectDetail: () => Promise<void>
  hasProjects: boolean
  loadingProjects: boolean

  // Task view mode
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

const PlatformContext = createContext<PlatformContextValue | null>(null)

export function usePlatformContext() {
  const ctx = useContext(PlatformContext)
  if (!ctx) {
    throw new Error("usePlatformContext must be used within PlatformProvider")
  }
  return ctx
}

/** Alias for convenience — shorter name used in sidebar and nav buttons. */
export const usePlatform = usePlatformContext

export function PlatformProvider({ children }: { children: ReactNode }) {
  const {
    addFolderToWorkspaceById,
    setActiveFolderId: setWorkspaceActiveFolderId,
  } = useAppWorkspace()
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [activeProject, setActiveProject] = useState<ProjectInfo | null>(null)
  const [activeProjectRepos, setActiveProjectRepos] = useState<
    ProjectRepoInfo[]
  >([])
  const [activeFolderIds, setActiveFolderIds] = useState<number[]>([])
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>("kanban")

  // Hydrate activeProjectId from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = Number(stored)
      if (!Number.isNaN(parsed) && parsed > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveProjectId(parsed)
      }
    }
  }, [])

  // Persist activeProjectId to localStorage when it changes
  useEffect(() => {
    if (activeProjectId !== null) {
      localStorage.setItem(STORAGE_KEY, String(activeProjectId))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [activeProjectId])

  // Load projects list on mount
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingProjects(true)
      try {
        const list = await listProjects()
        if (!cancelled) {
          setProjects(list)
          setLoadingProjects(false)
        }
      } catch {
        if (!cancelled) setLoadingProjects(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // When activeProjectId changes, load the full project info + folder IDs
  useEffect(() => {
    if (activeProjectId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveProject(null)
      setActiveProjectRepos([])
      setActiveFolderIds([])
      return
    }
    const projectId = activeProjectId // capture for async closure
    let cancelled = false
    async function loadDetail() {
      try {
        const detail: ProjectDetail = await getProject(projectId)
        if (!cancelled) {
          setActiveProject(detail.project)
          setActiveProjectRepos(detail.repos)
          // Only root folder's id for conversation filtering
          const folderIds: number[] = []
          if (detail.project.folderId != null) {
            folderIds.push(detail.project.folderId)
          }
          setActiveFolderIds(folderIds)

          // Auto-open root folder + set it as the active folder in workspace.
          // This ensures the sidebar shows a conversation group, BranchDropdown
          // renders, and RepoSelector resolves folderId correctly.
          if (detail.project.folderId != null) {
            addFolderToWorkspaceById(detail.project.folderId).catch(() => {})
            setWorkspaceActiveFolderId(detail.project.folderId)
          }
        }
      } catch {
        if (!cancelled) {
          setActiveProject(null)
          setActiveProjectRepos([])
          setActiveFolderIds([])
        }
      }
    }
    void loadDetail()
    return () => {
      cancelled = true
    }
  }, [activeProjectId, addFolderToWorkspaceById, setWorkspaceActiveFolderId])

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const list = await listProjects()
      setProjects(list)
      setLoadingProjects(false)
    } catch {
      setLoadingProjects(false)
    }
  }, [])

  const loadProjectDetail = useCallback(async () => {
    if (activeProjectId === null) return
    try {
      const detail: ProjectDetail = await getProject(activeProjectId)
      setActiveProject(detail.project)
      setActiveProjectRepos(detail.repos)
      const folderIds: number[] = []
      if (detail.project.folderId != null) {
        folderIds.push(detail.project.folderId)
      }
      setActiveFolderIds(folderIds)

      // Auto-open root folder + set as active (belt-and-suspenders with backend event)
      if (detail.project.folderId != null) {
        addFolderToWorkspaceById(detail.project.folderId).catch(() => {})
        setWorkspaceActiveFolderId(detail.project.folderId)
      }
    } catch {
      // Keep stale data on error — better than wiping state
    }
  }, [activeProjectId, addFolderToWorkspaceById, setWorkspaceActiveFolderId])

  const hasProjects = projects.length > 0

  const value = useMemo<PlatformContextValue>(
    () =>
      ({
        activeProjectId,
        setActiveProjectId,
        activeProject,
        activeProjectRepos,
        activeFolderIds,
        projects,
        loadProjects,
        loadProjectDetail,
        hasProjects,
        loadingProjects,
        viewMode,
        setViewMode,
      }) as PlatformContextValue,
    [
      activeProjectId,
      activeProject,
      activeProjectRepos,
      activeFolderIds,
      projects,
      loadProjects,
      loadProjectDetail,
      hasProjects,
      loadingProjects,
      viewMode,
    ]
  )

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  )
}
