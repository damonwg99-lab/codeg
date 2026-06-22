"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  Funnel,
  MessageSquare,
  FolderKanban,
  Search,
  SquarePen,
} from "lucide-react"
import { useTranslations } from "next-intl"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useSidebarContext } from "@/contexts/sidebar-context"
import { useTabContext } from "@/contexts/tab-context"
import { useSearchDialog } from "@/contexts/search-dialog-context"
import type { SidebarTab } from "@/contexts/platform-context"
import {
  SidebarConversationList,
  type SidebarConversationListHandle,
} from "@/components/conversations/sidebar-conversation-list"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { useIsMac } from "@/hooks/use-is-mac"
import { useShortcutSettings } from "@/hooks/use-shortcut-settings"
import { formatShortcutLabel } from "@/lib/keyboard-shortcuts"
import {
  loadShowCompleted,
  loadSortMode,
  saveShowCompleted,
  saveSortMode,
  type SidebarSortMode,
} from "@/lib/sidebar-view-mode-storage"
import { cn } from "@/lib/utils"

// Keyboard-shortcut hint at the trailing edge of the New chat / Search rows.
// Mirrors the folder count badge exactly — same chip (0.9375rem height,
// 0.3125rem radius, bg-primary/10, text-primary, 0.625rem text) per the request
// to match it. That pairing is also solidly legible (text-primary on
// primary/10 ≈ 14:1 light / 11:1 dark), unlike the muted-on-muted kbd it
// replaces (4.34:1). Revealed only on hover / keyboard focus of its row (each
// row is a `group`); font-mono renders the shortcut glyphs cleanly.
const SHORTCUT_BADGE_CLASS = cn(
  "ml-auto inline-flex h-[0.9375rem] shrink-0 items-center justify-center",
  "rounded-[0.3125rem] bg-primary/10 px-[0.25rem]",
  "font-mono text-[0.625rem] font-medium leading-none text-primary",
  "opacity-0 transition-opacity duration-150",
  "group-hover:opacity-100 group-focus-visible:opacity-100"
)

interface SidebarProps {
  /** Which tab is active. When "project", the sidebar renders children instead
   *  of the conversation list and hides chat-specific actions. */
  tab?: SidebarTab
  /** Content to render when tab="project". Ignored when tab="chat" (or unset). */
  children?: ReactNode
}

export function Sidebar({ tab = "chat", children }: SidebarProps) {
  const t = useTranslations("Folder.sidebar")
  const pt = useTranslations("Platform.sidebar")
  const isProjectTab = tab === "project"
  const { isOpen, toggle } = useSidebarContext()
  const { activeFolder } = useActiveFolder()
  const { openNewConversationTab, openChatModeTab } = useTabContext()
  const { setOpen: setSearchOpen } = useSearchDialog()
  const isMac = useIsMac()
  const { shortcuts } = useShortcutSettings()
  const isMobile = useIsMobile()
  const listRef = useRef<SidebarConversationListHandle>(null)

  const [showCompleted, setShowCompleted] = useState(false)
  const [sortMode, setSortMode] = useState<SidebarSortMode>("created")
  const [allExpanded, setAllExpanded] = useState(true)
  const searchShortcutLabel = formatShortcutLabel(
    shortcuts.toggle_search,
    isMac
  )
  const newConversationShortcutLabel = formatShortcutLabel(
    shortcuts.new_conversation,
    isMac
  )
  const filterOptionsLabel = `${t("showCompleted")} / ${t("sortBy")}`
  const toggleExpandLabel = allExpanded
    ? t("collapseAllGroups")
    : t("expandAllGroups")

  useEffect(() => {
    // Hydrate from localStorage after mount to keep SSR/CSR markup consistent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowCompleted(loadShowCompleted())
    setSortMode(loadSortMode())
  }, [])

  const handleSetShowCompleted = useCallback((value: boolean) => {
    setShowCompleted(value)
    saveShowCompleted(value)
  }, [])

  const handleSetSortMode = useCallback((value: string) => {
    const mode: SidebarSortMode = value === "updated" ? "updated" : "created"
    setSortMode(mode)
    saveSortMode(mode)
  }, [])

  const handleToggleExpandAll = useCallback(() => {
    if (allExpanded) {
      listRef.current?.collapseAll()
      setAllExpanded(false)
    } else {
      listRef.current?.expandAll()
      setAllExpanded(true)
    }
  }, [allExpanded])

  const handleNewConversation = useCallback(() => {
    // Defense-in-depth: with no active folder (e.g. a cold start that recovered
    // to nothing, or all folders closed) fall back to folderless chat mode
    // rather than no-op, so this entry point is never a dead end.
    if (!activeFolder) {
      openChatModeTab()
      return
    }
    openNewConversationTab(activeFolder.id, activeFolder.path)
  }, [activeFolder, openChatModeTab, openNewConversationTab])

  if (!isOpen) return null

  return (
    <aside className="@container/sidebar flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground select-none">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* ── Slot: Tab toggle ── */}
          <div className="flex items-center rounded-md bg-muted p-0.5">
            <button
              type="button"
              onClick={() => {
                if (isProjectTab) {
                  // Navigate to /workspace (chat mode)
                  window.location.href = "/workspace"
                }
              }}
              className={cn(
                "flex h-6 items-center justify-center rounded-sm px-2 text-[0.75rem] font-medium transition-all",
                !isProjectTab
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={pt("chatTab")}
            >
              <MessageSquare className="h-3 w-3 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (!isProjectTab) {
                  // Navigate to /platform (project mode)
                  window.location.href = "/platform"
                }
              }}
              className={cn(
                "flex h-6 items-center justify-center rounded-sm px-2 text-[0.75rem] font-medium transition-all",
                isProjectTab
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={pt("projectTab")}
            >
              <FolderKanban className="h-3 w-3 shrink-0" />
            </button>
          </div>
          <h2 className="truncate text-[0.875rem] font-bold tracking-[-0.00625rem] text-sidebar-foreground">
            {t("title")}
          </h2>
        </div>
        <div className="flex items-center gap-0.5">
          {/* ── Chat-only action buttons (hidden on Project tab) ── */}
          {!isProjectTab && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground"
                onClick={() => listRef.current?.scrollToActive()}
                title={t("locateActiveConversation")}
                aria-label={t("locateActiveConversation")}
              >
                <Crosshair aria-hidden="true" className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground"
                onClick={handleToggleExpandAll}
                title={toggleExpandLabel}
                aria-label={toggleExpandLabel}
              >
                {allExpanded ? (
                  <ChevronsDownUp aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5" />
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground"
                    title={filterOptionsLabel}
                    aria-label={filterOptionsLabel}
                  >
                    <Funnel aria-hidden="true" className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuCheckboxItem
                    checked={showCompleted}
                    onCheckedChange={handleSetShowCompleted}
                  >
                    {t("showCompleted")}
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t("sortBy")}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={sortMode}
                    onValueChange={handleSetSortMode}
                  >
                    <DropdownMenuRadioItem value="created">
                      {t("sortByCreatedAt")}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="updated">
                      {t("sortByUpdatedAt")}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {/* ── Slot: Chat-only fixed actions (hidden on Project tab) ── */}
      {!isProjectTab && (
        <div className="flex shrink-0 flex-col gap-0.5 px-1.5 pt-1.5">
          <button
            type="button"
            onClick={handleNewConversation}
            title={t("newChat")}
            className={cn(
              "group flex h-8 w-full items-center gap-[0.4375rem] rounded-full pl-[0.4375rem] pr-1.5",
              "text-[0.875rem] text-sidebar-foreground outline-none",
              "transition-colors duration-150 hover:bg-sidebar-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            )}
          >
            <SquarePen className="h-[0.875rem] w-[0.875rem] shrink-0 text-muted-foreground" />
            <span className="truncate">{t("newChat")}</span>
            {newConversationShortcutLabel ? (
              <kbd className={SHORTCUT_BADGE_CLASS}>
                {newConversationShortcutLabel}
              </kbd>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            title={t("search")}
            className={cn(
              "group flex h-8 w-full items-center gap-[0.4375rem] rounded-full pl-[0.4375rem] pr-1.5",
              "text-[0.875rem] text-sidebar-foreground outline-none",
              "transition-colors duration-150 hover:bg-sidebar-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            )}
          >
            <Search className="h-[0.875rem] w-[0.875rem] shrink-0 text-muted-foreground" />
            <span className="truncate">{t("search")}</span>
            {searchShortcutLabel ? (
              <kbd className={SHORTCUT_BADGE_CLASS}>{searchShortcutLabel}</kbd>
            ) : null}
          </button>
        </div>
      )}

      {/* ── Slot: Scrollable content area ──
          - Chat tab (default): renders SidebarConversationList
          - Project tab: renders children prop */}
      <div
        className="flex flex-col flex-1 min-h-0 overflow-hidden pt-1.5"
        onClick={
          isMobile && !isProjectTab
            ? (e) => {
                const target = e.target as HTMLElement
                if (target.closest("[data-conversation-id]")) {
                  toggle()
                }
              }
            : undefined
        }
      >
        {isProjectTab && children ? (
          children
        ) : (
          <SidebarConversationList
            ref={listRef}
            showCompleted={showCompleted}
            sortMode={sortMode}
          />
        )}
      </div>
    </aside>
  )
}
