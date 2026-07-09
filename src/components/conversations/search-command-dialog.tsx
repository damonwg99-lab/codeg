"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { formatDistanceToNow } from "date-fns"
import { enUS, zhCN, zhTW } from "date-fns/locale"
import { File, Folder } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { useAppWorkspaceStore } from "@/stores/app-workspace-store"
import { useTabActions } from "@/contexts/tab-context"
import { useWorkbenchRoute } from "@/contexts/workbench-route-context"
import { useWorkspaceActions } from "@/contexts/workspace-context"
import { listAllConversations } from "@/lib/api"
import { isDesktop } from "@/lib/transport"
import type {
  AgentType,
  ContentSearchBatch,
  ConversationStatus,
  DbConversationSummary,
  FileContentMatch,
} from "@/lib/types"
import { useFileTree, type FlatFileEntry } from "@/hooks/use-file-tree"
import { AGENT_LABELS, compareAgentType } from "@/lib/types"
import { AgentIcon } from "@/components/agent-icon"
import { ConversationStatusDot } from "@/components/conversations/conversation-status-dot"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import { cn, randomUUID } from "@/lib/utils"
import { formatConversationTitle } from "@/lib/conversation-title"

type SearchTab = "conversations" | "files"

interface SearchCommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchCommandDialog({
  open,
  onOpenChange,
}: SearchCommandDialogProps) {
  const t = useTranslations("Folder.search")
  const locale = useLocale()
  const dateFnsLocale =
    locale === "zh-CN" ? zhCN : locale === "zh-TW" ? zhTW : enUS
  const { activeFolder: folder, activeFolderId } = useActiveFolder()
  const allConversations = useAppWorkspaceStore((s) => s.conversations)
  const folderId = activeFolderId ?? 0
  const conversations = useMemo(
    () =>
      activeFolderId == null
        ? []
        : allConversations.filter((c) => c.folder_id === activeFolderId),
    [allConversations, activeFolderId]
  )
  const { openTab } = useTabActions()
  const { openConversations } = useWorkbenchRoute()
  const { openFilePreview } = useWorkspaceActions()
  const { revealInFileTree } = useAuxPanelContext()

  const [activeTab, setActiveTab] = useState<SearchTab>("conversations")
  const [query, setQuery] = useState("")
  const [agentFilter, setAgentFilter] = useState<AgentType | null>(null)
  const [results, setResults] = useState<DbConversationSummary[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [contentResults, setContentResults] = useState<FileContentMatch[]>([])
  const [contentSearching, setContentSearching] = useState(false)
  const contentDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const contentAbortRef = useRef<AbortController | null>(null)
  const contentUnsubRef = useRef<(() => void) | null>(null)

  const folderPath = folder?.path ?? ""

  // File search via shared hook (lazy-loaded when files tab is active)
  const {
    allFiles,
    loading: filesLoading,
    reset: resetFileTree,
  } = useFileTree({
    folderPath: folderPath || undefined,
    enabled: activeTab === "files",
  })

  // Compute which agent types exist in current folder
  const availableAgents = Array.from(
    new Set(conversations.map((c) => c.agent_type))
  ).sort(compareAgentType)

  // Filter files by query using pre-computed lowercase fields
  const filteredFiles = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      return allFiles
        .filter((f) => !f.name.startsWith(".") && !f.relativePath.startsWith("."))
        .filter((f) => !f.name.endsWith(".json"))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 100)
    }
    const lower = trimmed.toLowerCase()
    const matched: FlatFileEntry[] = []
    for (const f of allFiles) {
      if (f.lowerName.includes(lower) || f.lowerPath.includes(lower)) {
        matched.push(f)
        if (matched.length >= 100) break
      }
    }
    return matched
  }, [allFiles, query])

  const doSearch = useCallback(
    async (q: string, agent: AgentType | null) => {
      if (!q.trim() && !agent) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      try {
        const data = await listAllConversations({
          folder_ids: folderId > 0 ? [folderId] : null,
          search: q.trim() || null,
          agent_type: agent,
        })
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    },
    [folderId]
  )

  // Debounced search on query change (conversations tab only)
  useEffect(() => {
    if (activeTab !== "conversations") return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      doSearch(query, agentFilter)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, agentFilter, doSearch, activeTab])

  const doContentSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (!trimmed || trimmed.length < 2 || !folderPath) {
        setContentResults([])
        setContentSearching(false)
        return
      }

      contentAbortRef.current?.abort()
      const controller = new AbortController()
      contentAbortRef.current = controller

      setContentSearching(true)
      setContentResults([])

      if (isDesktop()) {
        const searchId = randomUUID()
        contentUnsubRef.current?.()
        contentUnsubRef.current = null
        try {
          const { invoke } = await import("@tauri-apps/api/core")
          const transport = (await import("@/lib/transport")).getTransport()
          const unsub = await transport.subscribe<ContentSearchBatch>(
            "search_files_content:results",
            (payload) => {
              if (controller.signal.aborted) return
              if (payload.searchId !== searchId) return
              setContentResults((prev) => [...prev, ...payload.matches])
              if (payload.done) {
                setContentSearching(false)
                contentUnsubRef.current?.()
                contentUnsubRef.current = null
              }
            }
          )
          contentUnsubRef.current = unsub
          await invoke("search_files_content_streaming", {
            searchId,
            basePath: folderPath,
            keyword: trimmed,
            maxResults: 100,
          })
        } catch (err) {
          if (!controller.signal.aborted) {
            console.warn("[ContentSearch] search failed:", err)
            setContentResults([])
            setContentSearching(false)
            contentUnsubRef.current?.()
            contentUnsubRef.current = null
          }
        }
      } else {
        try {
          const transport = (await import("@/lib/transport")).getTransport()
          const data: FileContentMatch[] = await transport.call(
            "search_files_content",
            { basePath: folderPath, keyword: trimmed, maxResults: 100 }
          )
          if (!controller.signal.aborted) {
            setContentResults(data)
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            console.warn("[ContentSearch] search failed:", err)
            setContentResults([])
          }
        } finally {
          if (!controller.signal.aborted) {
            setContentSearching(false)
          }
        }
      }
    },
    [folderPath]
  )

  // Debounced content search on query change (files tab only)
  useEffect(() => {
    if (activeTab !== "files") return
    if (contentDebounceRef.current)
      clearTimeout(contentDebounceRef.current)

    const trimmed = query.trim()
    if (trimmed.length >= 2) {
      setContentSearching(true)
    }

    contentDebounceRef.current = setTimeout(() => {
      doContentSearch(query)
    }, 400)
    return () => {
      if (contentDebounceRef.current)
        clearTimeout(contentDebounceRef.current)
    }
  }, [query, doContentSearch, activeTab])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("")
      setAgentFilter(null)
      setResults([])
      setActiveTab("conversations")
      resetFileTree()
      setContentResults([])
      setContentSearching(false)
      contentAbortRef.current?.abort()
      contentUnsubRef.current?.()
      contentUnsubRef.current = null
    }
  }, [open, resetFileTree])

  const handleSelectConversation = useCallback(
    (conv: DbConversationSummary) => {
      // Leave any workbench route (e.g. Automations) so the picked conversation
      // isn't stranded behind the route overlay — covers re-selecting the
      // already-active tab, which doesn't change activeTabId.
      openConversations()
      openTab(conv.folder_id, conv.id, conv.agent_type, true)
      onOpenChange(false)
    },
    [openTab, onOpenChange, openConversations]
  )

  const handleSelectFile = useCallback(
    (entry: FlatFileEntry) => {
      if (entry.kind === "dir") {
        revealInFileTree(entry.relativePath)
      } else {
        // Reveal parent directory in file tree, then open the file
        const lastSlash = entry.relativePath.lastIndexOf("/")
        if (lastSlash > 0) {
          revealInFileTree(entry.relativePath.slice(0, lastSlash))
        }
        openFilePreview(entry.relativePath)
      }
      onOpenChange(false)
    },
    [revealInFileTree, openFilePreview, onOpenChange]
  )

  const handleSelectContentMatch = useCallback(
    (match: FileContentMatch) => {
      const lastSlash = match.relativePath.lastIndexOf("/")
      if (lastSlash > 0) {
        revealInFileTree(match.relativePath.slice(0, lastSlash))
      }
      openFilePreview(match.relativePath, { line: match.lineNumber })
      onOpenChange(false)
    },
    [revealInFileTree, openFilePreview, onOpenChange]
  )

  const placeholder =
    activeTab === "conversations" ? t("placeholder") : t("filePlaceholder")

  return (
    <CommandDialog
      title={
        folder
          ? t("dialogTitleWithFolder", { name: folder.name })
          : t("dialogTitle")
      }
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={activeTab === "conversations"}
    >
      {/* Folder context header */}
      {folder && (
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Folder className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">
            {t("dialogTitleWithFolder", { name: folder.name })}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b px-3">
        <button
          onClick={() => setActiveTab("conversations")}
          className={cn(
            "relative h-9 px-3 text-sm font-medium transition-colors",
            activeTab === "conversations"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("tabConversations")}
          {activeTab === "conversations" && (
            <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-foreground rounded-full" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={cn(
            "relative h-9 px-3 text-sm font-medium transition-colors",
            activeTab === "files"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("tabFiles")}
          {activeTab === "files" && (
            <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-foreground rounded-full" />
          )}
        </button>
      </div>

      <CommandInput
        placeholder={placeholder}
        value={query}
        onValueChange={setQuery}
      />

      {/* Agent filter (conversations tab only) */}
      {activeTab === "conversations" && availableAgents.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-2 border-b">
          <button
            onClick={() => setAgentFilter(null)}
            className={cn(
              "h-6 text-xs px-2 rounded-md transition-colors",
              agentFilter === null
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t("allAgents")}
          </button>
          {availableAgents.map((at) => (
            <button
              key={at}
              onClick={() => setAgentFilter(at)}
              className={cn(
                "flex items-center gap-1.5 h-6 text-xs px-2 rounded-md transition-colors",
                agentFilter === at
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <AgentIcon agentType={at} className="w-3.5 h-3.5" />
              {AGENT_LABELS[at]}
            </button>
          ))}
        </div>
      )}

      <CommandList className="min-h-96">
        {/* Conversations tab */}
        {activeTab === "conversations" && (
          <>
            <CommandEmpty>
              {searching
                ? t("searching")
                : !query.trim() && !agentFilter
                  ? t("typeToSearch")
                  : t("noResults")}
            </CommandEmpty>
            {results.length > 0 && (
              <CommandGroup>
                {results.map((conv) => (
                  <CommandItem
                    key={conv.id}
                    value={`${conv.id}-${formatConversationTitle(conv.title)}`}
                    onSelect={() => handleSelectConversation(conv)}
                  >
                    <ConversationStatusDot
                      status={conv.status as ConversationStatus}
                    />
                    <span className="flex-1 truncate">
                      {formatConversationTitle(conv.title) ||
                        t("untitledConversation")}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {AGENT_LABELS[conv.agent_type]}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDistanceToNow(new Date(conv.created_at), {
                        addSuffix: true,
                        locale: dateFnsLocale,
                      })}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}

        {/* Files tab */}
        {activeTab === "files" && (
          <>
            <CommandEmpty>
              {filesLoading
                ? t("searching")
                : !query.trim()
                  ? t("typeToSearchFiles")
                  : filteredFiles.length === 0 &&
                      contentResults.length === 0
                    ? t("noResults")
                    : contentSearching
                      ? t("searching")
                      : t("noResults")}
            </CommandEmpty>
            {filteredFiles.length > 0 && (
              <CommandGroup heading={t("fileNameMatches")}>
                {filteredFiles.map((entry) => (
                  <CommandItem
                    key={`file-${entry.relativePath}`}
                    value={entry.relativePath}
                    onSelect={() => handleSelectFile(entry)}
                  >
                    {entry.kind === "dir" ? (
                      <Folder className="w-4 h-4 shrink-0 text-blue-500" />
                    ) : (
                      <File className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{entry.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 truncate max-w-48">
                      {entry.relativePath}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {contentSearching || contentResults.length > 0 ? (
              <CommandGroup heading={t("contentMatches")}>
                {contentSearching ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t("searching")}
                  </div>
                ) : (
                  contentResults.map((match, i) => (
                    <CommandItem
                      key={`content-${match.relativePath}-${match.lineNumber}-${i}`}
                      value={`content-${match.relativePath}-${match.lineNumber}`}
                      onSelect={() => handleSelectContentMatch(match)}
                    >
                      <File className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm">
                          {match.relativePath}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {match.lineContent.trimStart()}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        :{match.lineNumber}
                      </span>
                    </CommandItem>
                  ))
                )}
              </CommandGroup>
            ) : null}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
