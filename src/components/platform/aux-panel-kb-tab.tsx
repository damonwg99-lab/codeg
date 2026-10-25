"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Search,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { toErrorMessage } from "@/lib/app-error"
import { usePlatformOptional } from "@/contexts/platform-context"
import { useTabContext } from "@/contexts/tab-context"
import { useAuxPanelContext } from "@/contexts/aux-panel-context"
import { useTerminalContext } from "@/contexts/terminal-context"
import { useWorkspaceActions } from "@/contexts/workspace-context"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePlatformKbDocs } from "@/hooks/use-platform-kb-docs"
import { deleteKnowledgeDoc, searchKnowledgeDocsFts } from "@/lib/platform/api"
import { openInCode } from "@/lib/api"
import type {
  KnowledgeDocFtsResult,
  KnowledgeDocInfo,
} from "@/lib/platform/types"
import type { ReferenceAttrs } from "@/components/chat/composer/types"
import { revealItemInDir } from "@/lib/platform"
import { isDesktop, isRemoteDesktopMode } from "@/lib/transport"
import { kbDocAbsPath } from "@/lib/kb-doc-path"
import { getRelativeDocPath } from "@/components/platform/kb-tree-picker"
import { emitInjectKbRefsToSession } from "@/lib/platform/kb-reference-events"
import { RowMoreButton } from "@/components/layout/row-more-button"
import { FileTreeCopySubContent } from "@/components/layout/file-tree-copy-menu"
import { OpenInSubContent } from "@/components/layout/open-in-menu"

/** Directory node of the KB doc tree (built from doc relative paths). */
interface KbDirNode {
  /** Last path segment ("" for the implicit root). */
  name: string
  /** Joined relative dir path ("" for the root). */
  dirPath: string
  dirs: KbDirNode[]
  docs: KnowledgeDocInfo[]
}

function collectDocIds(node: KbDirNode, acc: number[] = []): number[] {
  for (const d of node.docs) acc.push(d.id)
  for (const c of node.dirs) collectDocIds(c, acc)
  return acc
}

function collectKbDirDocs(
  node: KbDirNode,
  acc: KnowledgeDocInfo[] = []
): KnowledgeDocInfo[] {
  for (const d of node.docs) acc.push(d)
  for (const c of node.dirs) collectKbDirDocs(c, acc)
  return acc
}

function buildKbTree(docs: KnowledgeDocInfo[]): KbDirNode {
  const root: KbDirNode = { name: "", dirPath: "", dirs: [], docs: [] }
  const dirMap = new Map<string, KbDirNode>([["", root]])
  const ensureDir = (segments: string[]): KbDirNode => {
    let node = root
    let path = ""
    for (const seg of segments) {
      path = path ? `${path}/${seg}` : seg
      let child = dirMap.get(path)
      if (!child) {
        child = { name: seg, dirPath: path, dirs: [], docs: [] }
        node.dirs.push(child)
        dirMap.set(path, child)
      }
      node = child
    }
    return node
  }
  for (const doc of docs) {
    const rel = getRelativeDocPath(doc.filePath).replace(/^\/+/, "")
    const parts = rel.split("/").filter(Boolean)
    ensureDir(parts.slice(0, -1)).docs.push(doc)
  }
  const sortNode = (n: KbDirNode) => {
    n.dirs.sort((a, b) => a.name.localeCompare(b.name))
    n.docs.sort((a, b) => a.title.localeCompare(b.title))
    n.dirs.forEach(sortNode)
  }
  sortNode(root)
  return root
}

function docFileName(doc: KnowledgeDocInfo): string {
  return doc.filePath.split(/[\\/]/).pop() ?? doc.filePath
}

export function AuxPanelKbTab() {
  const platform = usePlatformOptional()
  const activeProject = platform?.activeProject ?? null
  const { tabs, activeTabId } = useTabContext()
  const { setOpen: setAuxOpen } = useAuxPanelContext()
  const { createTerminalInDirectory } = useTerminalContext()
  const { openFilePreview } = useWorkspaceActions()
  const isMobile = useIsMobile()
  const { kbDocs, loading, reload } = usePlatformKbDocs({
    projectId: activeProject?.id ?? null,
  })

  const [searchQuery, setSearchQuery] = useState("")
  const [ftsResults, setFtsResults] = useState<KnowledgeDocFtsResult[]>([])
  const [ftsLoading, setFtsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocInfo | null>(
    null
  )
  const [deleting, setDeleting] = useState(false)

  const activeSessionTabId = useMemo(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    if (!activeTab || activeTab.kind !== "conversation") return null
    return activeTab.id
  }, [tabs, activeTabId])

  // Debounced FTS search over title/tags/description/content. Local
  // title/path matching below stays as a fallback so docs missing from the
  // FTS index (e.g. created before it existed) are still findable.
  useEffect(() => {
    const q = searchQuery.trim()
    if (!q || !activeProject) return
    const timer = setTimeout(async () => {
      setFtsLoading(true)
      try {
        const results = await searchKnowledgeDocsFts({
          projectId: activeProject.id,
          query: q,
        })
        setFtsResults(results)
      } catch (e) {
        console.warn("[aux-panel-kb-tab] fts search failed:", e)
        setFtsResults([])
      } finally {
        setFtsLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, activeProject])

  // Docs shown in the tree: everything, or the search merge of FTS hits
  // (with content snippets) and local title/path matches.
  const visibleDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return kbDocs
    const byId = new Map<number, { doc: KnowledgeDocInfo; snippet?: string }>()
    for (const r of ftsResults) {
      byId.set(r.doc.id, { doc: r.doc, snippet: r.snippet })
    }
    for (const d of kbDocs) {
      if (byId.has(d.id)) continue
      if (
        d.title.toLowerCase().includes(q) ||
        d.filePath.toLowerCase().includes(q)
      ) {
        byId.set(d.id, { doc: d })
      }
    }
    return Array.from(byId.values()).map((v) => v.doc)
  }, [kbDocs, searchQuery, ftsResults])

  const snippetsById = useMemo(() => {
    const q = searchQuery.trim()
    if (!q) return new Map<number, string>()
    const m = new Map<number, string>()
    for (const r of ftsResults) m.set(r.doc.id, r.snippet)
    return m
  }, [ftsResults, searchQuery])

  const tree = useMemo(() => buildKbTree(visibleDocs), [visibleDocs])

  const toggleDoc = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleDir = useCallback((node: KbDirNode) => {
    const ids = collectDocIds(node)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [])

  const toggleAllVisible = useCallback(() => {
    const ids = visibleDocs.map((d) => d.id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [visibleDocs])

  const buildKbRefs = useCallback(
    (docs: KnowledgeDocInfo[]): ReferenceAttrs[] => {
      const rootDir = activeProject?.rootDir ?? ""
      const kbLocalDir = activeProject?.kbLocalDir ?? null
      return docs.map((doc) => ({
        refType: "context",
        label: doc.title,
        uri: `context://${encodeURIComponent(doc.filePath)}`,
        id: `kb:${doc.id}`,
        meta: {
          injectGroup: "kb_doc",
          injectDocPath: kbDocAbsPath(kbLocalDir, rootDir, doc.filePath),
          injectDocId: doc.id,
        },
      }))
    },
    [activeProject]
  )

  const handleInject = useCallback(() => {
    if (!activeSessionTabId || selectedIds.size === 0) return
    const refs = buildKbRefs(kbDocs.filter((d) => selectedIds.has(d.id)))
    // Success / duplicate-skip feedback comes from usePlatformInjectHandler,
    // which dedupes by uri — no toast here.
    emitInjectKbRefsToSession({ tabId: activeSessionTabId, refs })
    setSelectedIds(new Set())
  }, [activeSessionTabId, buildKbRefs, kbDocs, selectedIds])

  const injectSingleDoc = useCallback(
    (doc: KnowledgeDocInfo) => {
      if (!activeSessionTabId) return
      emitInjectKbRefsToSession({
        tabId: activeSessionTabId,
        refs: buildKbRefs([doc]),
      })
    },
    [activeSessionTabId, buildKbRefs]
  )

  // Click a doc row → open it exactly like the Files tab does: a preview tab
  // slides out in the center area (works for both the project `_knowledge`
  // folder and an external KB directory — the abs path is read directly).
  const openKbDocPreview = useCallback(
    (doc: KnowledgeDocInfo) => {
      const absPath = kbDocAbsPath(
        activeProject?.kbLocalDir ?? null,
        activeProject?.rootDir ?? "",
        doc.filePath
      )
      void openFilePreview(absPath)
      // On mobile the aux panel is a Drawer overlay — close it so the opened
      // tab is visible in the main pane (same as the file tree).
      if (isMobile) setAuxOpen(false)
    },
    [activeProject, isMobile, openFilePreview, setAuxOpen]
  )

  const handleRevealInDir = useCallback(async (absPath: string) => {
    try {
      await revealItemInDir(absPath)
    } catch (error) {
      toast.error("打开所在目录失败", { description: toErrorMessage(error) })
    }
  }, [])

  const handleOpenInCode = useCallback(async (absPath: string) => {
    try {
      await openInCode(absPath)
    } catch (error) {
      toast.error("在编辑器中打开失败", { description: toErrorMessage(error) })
    }
  }, [])

  const handleOpenInTerminal = useCallback(
    async (dirAbsPath: string, title?: string) => {
      try {
        await createTerminalInDirectory(dirAbsPath, title)
      } catch (error) {
        toast.error("在终端中打开失败", { description: toErrorMessage(error) })
      }
    },
    [createTerminalInDirectory]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteKnowledgeDoc(deleteTarget.id)
      toast.success("文档已删除")
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(deleteTarget.id)
        return next
      })
      setDeleteTarget(null)
      void reload()
    } catch (e) {
      console.error("[aux-panel-kb-tab] delete doc failed:", e)
      toast.error("删除失败")
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, reload])

  if (!activeProject) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <BookOpen className="size-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">知识库</p>
        <p className="text-xs text-muted-foreground">
          请先在平台中选择一个项目，再查看项目知识库
        </p>
      </div>
    )
  }

  const rootDir = activeProject.rootDir
  const kbLocalDir = activeProject.kbLocalDir
  // Same rule the file tree uses: browser and remote-desktop windows live on
  // another host, so "reveal in file manager" and copy-the-file-itself are
  // not rendered / are disabled there.
  const webMode = !isDesktop() || isRemoteDesktopMode()

  const isAllVisibleSelected =
    visibleDocs.length > 0 && visibleDocs.every((d) => selectedIds.has(d.id))

  const renderDirNode = (node: KbDirNode, depth: number): ReactNode => {
    const isCollapsed = collapsedDirs.has(node.dirPath)
    const ids = collectDocIds(node)
    const selectedCount = ids.filter((id) => selectedIds.has(id)).length
    const dirChecked =
      ids.length > 0 && selectedCount === ids.length
        ? true
        : selectedCount > 0
          ? "indeterminate"
          : false
    const dirAbsPath = kbDocAbsPath(kbLocalDir, rootDir, node.dirPath)
    const indent = (node.dirPath ? depth + 1 : depth) * 14 + 4

    const renderDocRow = (doc: KnowledgeDocInfo) => {
      const isSelected = selectedIds.has(doc.id)
      const snippet = snippetsById.get(doc.id)
      const absPath = kbDocAbsPath(kbLocalDir, rootDir, doc.filePath)
      return (
        <ContextMenu key={doc.id}>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "group cursor-pointer rounded-md pr-2 select-none hover:bg-accent/60",
                isSelected && "bg-primary/10 hover:bg-primary/10"
              )}
              style={{ paddingLeft: `${indent}px` }}
              onClick={() => openKbDocPreview(doc)}
            >
              <div className="flex h-7 min-w-0 items-center gap-1">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleDoc(doc.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="size-3.5 shrink-0"
                />
                <FileText className="size-3.5 shrink-0 text-sky-500" />
                <span
                  className="min-w-0 flex-1 truncate text-xs"
                  title={getRelativeDocPath(doc.filePath)}
                >
                  {docFileName(doc)}
                </span>
                <RowMoreButton className="group-hover:opacity-100" />
              </div>
              {snippet && (
                <p
                  className="line-clamp-2 pb-1.5 pr-1 text-[0.625rem] leading-snug text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: snippet }}
                />
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => openKbDocPreview(doc)}>
              打开文件
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() => injectSingleDoc(doc)}
              disabled={!activeSessionTabId}
            >
              注入当前会话
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>打开方式</ContextMenuSubTrigger>
              <OpenInSubContent
                explorerLabel="在文件管理器中显示"
                terminalLabel="在终端中打开"
                codeLabel="在编辑器中打开"
                explorerDisabled={webMode}
                onOpenExplorer={() => void handleRevealInDir(absPath)}
                onOpenTerminal={() =>
                  void handleOpenInTerminal(
                    absPath.slice(0, Math.max(absPath.lastIndexOf("/"), 0)),
                    docFileName(doc)
                  )
                }
                onOpenCode={() => void handleOpenInCode(absPath)}
              />
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>复制</ContextMenuSubTrigger>
              <FileTreeCopySubContent
                name={docFileName(doc)}
                relativePath={getRelativeDocPath(doc.filePath)}
                absolutePath={absPath}
                kind="file"
                remote={webMode}
              />
            </ContextMenuSub>
            <ContextMenuItem
              variant="destructive"
              onSelect={() => setDeleteTarget(doc)}
            >
              删除文档
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }

    return (
      <div key={node.dirPath || "__root__"}>
        {node.dirPath ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                onClick={() =>
                  setCollapsedDirs((prev) => {
                    const next = new Set(prev)
                    if (next.has(node.dirPath)) next.delete(node.dirPath)
                    else next.add(node.dirPath)
                    return next
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ")
                    e.currentTarget.click()
                }}
                className="group flex h-7 cursor-pointer items-center gap-1 rounded-md pr-2 select-none hover:bg-accent/60"
                style={{ paddingLeft: `${depth * 14 + 4}px` }}
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <Checkbox
                  checked={dirChecked}
                  onCheckedChange={() => toggleDir(node)}
                  onClick={(e) => e.stopPropagation()}
                  className="size-3.5 shrink-0"
                />
                {isCollapsed ? (
                  <Folder className="size-3.5 shrink-0 text-amber-500" />
                ) : (
                  <FolderOpen className="size-3.5 shrink-0 text-amber-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {node.name}
                </span>
                <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                  {selectedCount > 0
                    ? `${selectedCount}/${ids.length}`
                    : ids.length}
                </span>
                <RowMoreButton className="group-hover:opacity-100" />
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  const docs = collectKbDirDocs(node)
                  if (!activeSessionTabId || docs.length === 0) return
                  emitInjectKbRefsToSession({
                    tabId: activeSessionTabId,
                    refs: buildKbRefs(docs),
                  })
                }}
                disabled={!activeSessionTabId || ids.length === 0}
              >
                注入整个目录 ({ids.length})
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>打开方式</ContextMenuSubTrigger>
                <OpenInSubContent
                  explorerLabel="在文件管理器中显示"
                  terminalLabel="在终端中打开"
                  codeLabel="在编辑器中打开"
                  explorerDisabled={webMode}
                  onOpenExplorer={() => void handleRevealInDir(dirAbsPath)}
                  onOpenTerminal={() =>
                    void handleOpenInTerminal(dirAbsPath, node.name)
                  }
                  onOpenCode={() => void handleOpenInCode(dirAbsPath)}
                />
              </ContextMenuSub>
              <ContextMenuSub>
                <ContextMenuSubTrigger>复制</ContextMenuSubTrigger>
                <FileTreeCopySubContent
                  name={node.name}
                  relativePath={node.dirPath}
                  absolutePath={dirAbsPath}
                  kind="dir"
                  remote={webMode}
                />
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
        ) : null}
        {!isCollapsed && (
          <>
            {node.dirs.map((child) =>
              renderDirNode(child, node.dirPath ? depth + 1 : depth)
            )}
            {node.docs.map(renderDocRow)}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: search over title / path / doc content */}
      <div className="shrink-0 space-y-1.5 border-b px-2 py-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <BookOpen className="size-3.5 shrink-0 text-primary" />
            <span className="text-xs font-semibold">知识库</span>
            <Badge variant="outline" className="h-4 px-1 text-[0.625rem]">
              {kbDocs.length}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[0.6875rem] text-muted-foreground"
            disabled={visibleDocs.length === 0}
            onClick={toggleAllVisible}
          >
            {isAllVisibleSelected ? "取消全选" : "全选"}
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索标题、路径或文档内容…"
            className="h-7 bg-background pl-7 pr-7 text-xs"
          />
          {ftsLoading ? (
            <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Tree body */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              正在加载知识库文档…
            </div>
          ) : visibleDocs.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              {searchQuery.trim() ? "未找到匹配的文档" : "知识库中暂无文档"}
            </div>
          ) : (
            renderDirNode(tree, 0)
          )}
        </div>
      </ScrollArea>

      {/* Footer: selection summary + inject action */}
      <div className="flex shrink-0 items-center gap-2 border-t bg-muted/20 px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {selectedIds.size > 0
            ? `已选 ${selectedIds.size} 篇文档`
            : !activeSessionTabId
              ? "当前没有活跃会话"
              : "勾选文档后可注入当前会话"}
        </span>
        {selectedIds.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => setSelectedIds(new Set())}
          >
            清空
          </Button>
        )}
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={selectedIds.size === 0 || !activeSessionTabId}
          onClick={handleInject}
        >
          注入会话 ({selectedIds.size})
        </Button>
      </div>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认从知识库中删除此文档？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.title
                ? `「${deleteTarget.title}」将被移除，此操作不可撤销。`
                : "此操作不可撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
            >
              {deleting ? "删除中…" : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
