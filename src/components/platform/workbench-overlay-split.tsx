"use client"

import { useCallback } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

import { cn } from "@/lib/utils"
import { WorkbenchRoutePage } from "@/components/workbench/workbench-content"
import {
  useWorkspaceActions,
  useWorkspaceFileTabs,
  useWorkspaceView,
} from "@/contexts/workspace-context"
import { FileWorkspaceTabBar } from "@/components/files/file-workspace-tab-bar"
import { FileWorkspaceHeader } from "@/components/files/file-workspace-header"
import { FileWorkspacePanel } from "@/components/files/file-workspace-panel"

/** The panel group id for the workbench route + file column split. */
const WORKBENCH_OVERLAY_PANEL_GROUP_ID = "workspace-overlay-panel-group"

/**
 * [ai-platform] The full-screen workbench route's body: the route fills the
 * overlay, or — when files are open on the route (e.g. a task detail with
 * previewed docs) — a split keeps the route on the left and reuses the
 * workspace file column (tab strip + header + panel) on the right, so the
 * detail stays visible while the file is inspected.
 *
 * Extracted from layout.tsx's WorkspaceContent as a single-line seam so
 * upstream edits to the workspace body cannot collide with it. The file
 * column here mirrors the fusion column's markup (WorkspaceContent keeps its
 * own copy, unchanged); pane activation is rebuilt from context — see the
 * fusion branch's note there.
 */
export function WorkbenchOverlaySplit() {
  const { fileTabs } = useWorkspaceFileTabs()
  const { mode, filesMaximized, conversationMaximized } = useWorkspaceView()
  const { setActivePane } = useWorkspaceActions()

  const markFileActive = useCallback(() => {
    if (mode !== "fusion" || conversationMaximized) return
    setActivePane("files")
  }, [mode, conversationMaximized, setActivePane])

  // The file column: tab strip + header + panel, shared markup with the
  // fusion split's column (see WorkspaceContent).
  const fileColumnSection = (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-10 shrink-0 items-stretch bg-muted ws-transparent-bg">
        <div className="flex min-w-0 flex-1 items-stretch">
          <FileWorkspaceTabBar />
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        onPointerDownCapture={markFileActive}
        onFocusCapture={markFileActive}
      >
        <FileWorkspaceHeader />
        <div className="flex-1 min-h-0 overflow-hidden">
          <FileWorkspacePanel />
        </div>
      </div>
    </section>
  )

  if (fileTabs.length === 0) {
    return (
      <div className="min-h-0 flex-1">
        <WorkbenchRoutePage />
      </div>
    )
  }

  return (
    /* Kept mounted and switched with CSS (like the conversation+files split
       in WorkspaceContent): maximize overlays the file column across the
       whole split area instead of tearing down / remounting the panel group
       and the detail route — unmounting the route (e.g. a heavy task detail)
       on every toggle is what made the button feel laggy. The `relative`
       wrapper anchors the file column's `absolute inset-0`. */
    <div className="relative min-h-0 flex-1">
      <ResizablePanelGroup
        direction="horizontal"
        className="min-h-0 flex-1"
        id={WORKBENCH_OVERLAY_PANEL_GROUP_ID}
      >
        <ResizablePanel
          defaultSize={60}
          minSize={30}
          className={cn(filesMaximized && "invisible")}
        >
          <WorkbenchRoutePage />
        </ResizablePanel>
        <ResizableHandle
          withHandle
          className={cn(filesMaximized && "invisible")}
        />
        <ResizablePanel defaultSize={40} minSize={20}>
          {/* When maximized the file column overlays the whole split area
              (anchored by the `relative` wrapper) — visibility instead of
              unmount keeps both panes mounted so toggling never tears down
              the detail route. */}
          <div
            className={cn(
              "h-full min-h-0",
              filesMaximized &&
                "absolute inset-0 z-30 bg-background ws-transparent-bg"
            )}
          >
            {fileColumnSection}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
