"use client"

import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { Reorder } from "motion/react"
import { Maximize2, Minimize2, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { useWorkspaceView } from "@/contexts/workspace-context"
import type { WorkbenchRouteId } from "@/contexts/workbench-route-context"
import { useIsCoarsePointer } from "@/hooks/use-is-coarse-pointer"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  useWorkbenchTabStore,
  type WorkbenchTab,
} from "@/stores/workbench-tab-store"
import { cn, handleMiddleClickClose } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

/** i18n label for a workbench route. Frozen into the store by the tab bar so
 *  an in-tab list → detail drill never makes the strip text jump. */
function resolveRouteTitle(
  t: (key: never) => string,
  routeId: WorkbenchRouteId
): string {
  switch (routeId) {
    case "project-list":
    case "project-detail":
      return t("nav.projectList" as never)
    case "create-project":
      return t("nav.createProject" as never)
    case "task-kanban":
      return t("nav.taskKanban" as never)
    case "task-detail":
    case "create-task":
      return t("task.taskDetail" as never)
    case "release-list":
    case "release-detail":
      return t("task.releaseManagement" as never)
    case "create-release":
      return t("task.createRelease" as never)
    case "archive-view":
      return t("task.archivedTasks" as never)
    default:
      return "Automations"
  }
}

export function WorkbenchTabBar() {
  const t = useTranslations("Platform")
  const fileT = useTranslations("Folder.fileWorkspace")
  const { mode } = useWorkspaceView()
  const isMobile = useIsMobile()
  const {
    tabs,
    activeTabId,
    maximized,
    switchTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    reorderTabs,
    setTabTitle,
    toggleMaximized,
  } = useWorkbenchTabStore()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isCoarsePointer = useIsCoarsePointer()

  // Freeze resolved route titles into the store so they survive in-tab
  // navigation (navigateTab preserves `title`). Pages may later override with
  // a real project/task name via setTabTitle.
  useEffect(() => {
    for (const tab of tabs) {
      if (tab.title == null) {
        setTabTitle(tab.id, resolveRouteTitle(t, tab.routeId))
      }
    }
  }, [tabs, t, setTabTitle])

  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return
    const el = scrollRef.current.querySelector(
      `[data-workbench-tab-id="${activeTabId}"]`
    )
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activeTabId])

  const handleReorder = useCallback(
    (nextTabs: WorkbenchTab[]) => {
      reorderTabs(nextTabs)
    },
    [reorderTabs]
  )

  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId)
  const lastTabActive = activeIndex >= 0 && activeIndex === tabs.length - 1

  if (tabs.length === 0) return null

  return (
    <Reorder.Group
      as="div"
      ref={scrollRef}
      role="tablist"
      axis="x"
      values={tabs}
      onReorder={handleReorder}
      className="pt-1.5 pl-2 flex h-full min-w-0 flex-1 items-stretch gap-0 overflow-hidden"
    >
      {tabs.map((tab, index) => (
        <WorkbenchTabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          adjacentActive={
            activeIndex < 0
              ? undefined
              : index === activeIndex - 1
                ? "before"
                : index === activeIndex + 1
                  ? "after"
                  : undefined
          }
          closeLabel={fileT("closeFileTab")}
          closeText={fileT("close")}
          closeOthersText={fileT("closeOthers")}
          closeAllText={fileT("closeAll")}
          isCoarsePointer={isCoarsePointer}
          onSwitch={switchTab}
          onClose={closeTab}
          onCloseOthers={closeOtherTabs}
          onCloseAll={closeAllTabs}
        />
      ))}
      {/* Trailing area mirrors the file tab bar: a window-drag spacer fills the
          leftover row and, in fusion, a maximize/restore button sits flush right.
          They are the group's own trailing children but NOT Reorder.Items. */}
      <div
        data-adjacent-active={lastTabActive ? "after" : undefined}
        className="relative flex h-full flex-1 items-stretch ws-strip-line"
      >
        <div data-tauri-drag-region className="h-full min-w-10 flex-1" />
        {mode === "fusion" && !isMobile && (
          <button
            type="button"
            onClick={toggleMaximized}
            className={cn(
              "mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
              maximized && "text-primary"
            )}
            aria-label={maximized ? fileT("restore") : fileT("maximize")}
            aria-pressed={maximized}
            title={maximized ? fileT("restore") : fileT("maximize")}
          >
            {maximized ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    </Reorder.Group>
  )
}

interface WorkbenchTabItemProps {
  tab: WorkbenchTab
  active: boolean
  adjacentActive?: "before" | "after"
  closeLabel: string
  closeText: string
  closeOthersText: string
  closeAllText: string
  isCoarsePointer: boolean
  onSwitch: (tabId: string | null) => void
  onClose: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseAll: () => void
}

const WorkbenchTabItem = memo(function WorkbenchTabItem({
  tab,
  active,
  adjacentActive,
  closeLabel,
  closeText,
  closeOthersText,
  closeAllText,
  isCoarsePointer,
  onSwitch,
  onClose,
  onCloseOthers,
  onCloseAll,
}: WorkbenchTabItemProps) {
  const handleSwitch = useCallback(() => {
    onSwitch(tab.id)
  }, [onSwitch, tab.id])

  const whileDrag = useMemo(() => ({ scale: 1.03 }), [])

  return (
    <Reorder.Item
      as="div"
      value={tab}
      data-workbench-tab-id={tab.id}
      drag="x"
      dragListener={!isCoarsePointer}
      whileDrag={whileDrag}
      data-tab-item
      data-active={active ? "true" : undefined}
      data-adjacent-active={adjacentActive}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        "browser-tab-item min-w-0 grow-0 shrink basis-48 data-[active=true]:z-10"
      )}
    >
      <span aria-hidden className="browser-tab-seat" />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="tab"
            aria-selected={active}
            onClick={handleSwitch}
            onMouseDown={(event) =>
              handleMiddleClickClose(event, () => onClose(tab.id))
            }
            className={cn(
              "browser-tab-content group/wbtab relative flex w-full min-w-0 h-full cursor-pointer select-none items-center gap-1.5 overflow-hidden rounded-t-lg px-2 pb-1.5 text-xs transition-colors",
              active
                ? "bg-background ws-transparent-bg text-foreground"
                : "isolate browser-tab-hover text-muted-foreground hover:text-foreground ws-strip-line"
            )}
          >
            <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap browser-tab-label">
              {tab.title ?? ""}
            </span>
            <button
              type="button"
              className={cn(
                "absolute right-2 top-0 bottom-1.5 my-auto flex h-4 w-4 items-center justify-center rounded-md hover:bg-foreground/10",
                active
                  ? "opacity-100"
                  : "opacity-0 pointer-events-none group-hover/wbtab:opacity-100 group-hover/wbtab:pointer-events-auto"
              )}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
              aria-label={closeLabel}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onClose(tab.id)}>
            {closeText}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCloseOthers(tab.id)}>
            {closeOthersText}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onCloseAll}>
            {closeAllText}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </Reorder.Item>
  )
})
