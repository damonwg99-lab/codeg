"use client"

import { useEffect, useMemo, useRef } from "react"
import { useWorkspaceFileTabs } from "@/contexts/workspace-context"
import {
  useWorkbenchTabStore,
  type WorkbenchLayer,
} from "@/stores/workbench-tab-store"
import { cn } from "@/lib/utils"
import { FileWorkspaceHeader } from "@/components/files/file-workspace-header"
import { FileWorkspacePanel } from "@/components/files/file-workspace-panel"
import { FileWorkspaceTabBar } from "@/components/files/file-workspace-tab-bar"
import { WorkbenchTabBar } from "@/components/workbench/workbench-tab-bar"
import { WorkbenchRoutePage } from "@/components/workbench/workbench-content"

/**
 * The right zone hosts two MUTUALLY EXCLUSIVE layers with no switch tabs:
 * the file workspace and the workbench (project/task pages). Which layer is
 * shown is decided by "last opened" (`layer` in the workbench tab store),
 * with auto-fallback when the current layer empties:
 *   - workbench layer needs an ACTIVE workbench tab; otherwise fall to file.
 *   - file layer needs open file tabs; otherwise fall to workbench.
 *   - both empty → `null` (the panel collapses to conversation only).
 */

export type EffectiveLayer = WorkbenchLayer | null

export function useEffectiveLayer(): EffectiveLayer {
  const layer = useWorkbenchTabStore((s) => s.layer)
  const workbenchCount = useWorkbenchTabStore((s) => s.tabs.length)
  const workbenchActiveId = useWorkbenchTabStore((s) => s.activeTabId)
  const fileCount = useWorkspaceFileTabs().fileTabs.length

  return useMemo(() => {
    const workbenchActive = workbenchCount > 0 && workbenchActiveId != null
    if (layer === "workbench") {
      if (workbenchActive) return "workbench"
      if (fileCount > 0) return "file"
      return null
    }
    if (fileCount > 0) return "file"
    if (workbenchActive) return "workbench"
    return null
  }, [layer, workbenchCount, workbenchActiveId, fileCount])
}

/** Tab strip for whichever right-zone layer is effective. */
export function WorkbenchRightZoneTabBars() {
  const layer = useEffectiveLayer()
  return (
    <>
      {layer === "file" && <FileWorkspaceTabBar />}
      {layer === "workbench" && <WorkbenchTabBar />}
    </>
  )
}

/**
 * Body for whichever right-zone layer is effective.
 *
 * BOTH layers stay mounted and are toggled by CSS visibility (mirroring main's
 * always-mounted conversation/files panels). Unmounting the inactive layer
 * would destroy the workbench page's component state — closing a file would
 * remount task-detail/project-detail and trigger a full refetch ("页面刷新一遍")
 * plus lose in-tab navigation and scroll. `hidden` (display:none) keeps the
 * inactive layer alive.
 */
export function WorkbenchRightZoneContent() {
  const layer = useEffectiveLayer()
  return (
    <>
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          layer !== "file" && "hidden"
        )}
      >
        <FileWorkspaceHeader />
        <div className="flex-1 min-h-0 overflow-hidden">
          <FileWorkspacePanel />
        </div>
      </div>
      <div
        className={cn(
          "flex-1 min-h-0 overflow-hidden",
          layer !== "workbench" && "hidden"
        )}
      >
        <WorkbenchRoutePage />
      </div>
    </>
  )
}

/**
 * Supplementary layer sync: the PRIMARY file-layer flip happens inside
 * `activateFilePane` (workspace-context) so it fires even when re-opening the
 * already-active file tab (where neither activePane nor activeFileTabId change
 * and no reactive signal exists). This watcher additionally catches file tabs
 * activated without going through that path (e.g. cross-client reveals).
 * Workbench activation is set inside the store actions themselves.
 */
export function WorkbenchLayerSync() {
  const { activeFileTabId } = useWorkspaceFileTabs()
  const setLayer = useWorkbenchTabStore((s) => s.setLayer)
  const prevRef = useRef(activeFileTabId)
  useEffect(() => {
    if (prevRef.current === activeFileTabId) return
    prevRef.current = activeFileTabId
    if (activeFileTabId != null) setLayer("file")
  }, [activeFileTabId, setLayer])
  return null
}
