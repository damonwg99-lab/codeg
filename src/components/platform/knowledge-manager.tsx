"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useTranslations } from "next-intl"
import {
  Loader2,
  RefreshCw,
  Upload,
  FolderOpen,
  Search,
  FileText,
  X,
} from "lucide-react"
import {
  scanKnowledgeRepo,
  listKnowledgeDocs,
  searchKnowledgeDocs,
  searchKnowledgeDocsFts,
  initKnowledgeRepo,
  deleteKnowledgeDoc,
} from "@/lib/platform/api"
import type {
  KnowledgeDocInfo,
  KnowledgeDocFtsResult,
  ScanResultInfo,
  KbDocType,
  ProjectInfo,
} from "@/lib/platform/types"
import { KB_DOC_TYPE_LABELS, KB_SKIP_FILENAMES } from "@/lib/platform/types"
import { cn } from "@/lib/utils"
import { getRelativeDocPath } from "./kb-tree-picker"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardHeader } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { KnowledgeUploadDialog } from "./knowledge-upload-dialog"
import { KbDocPreview } from "./kb-doc-preview"
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

type DocTypeFilter = KbDocType | "all"

const FILTER_DOC_TYPES: KbDocType[] = [
  "tech_doc",
  "template",
  "skill",
  "requirement",
  "ai_intermediate",
]

function resolveKbDocTypeLabel(
  t: (key: never) => string,
  type: KbDocType
): string {
  const keyMap: Record<KbDocType, string> = {
    tech_doc: "kb.typeTechDoc",
    template: "kb.typeTemplate",
    skill: "kb.typeSkill",
    requirement: "kb.typeRequirement",
    ai_intermediate: "kb.typeAiIntermediate",
    task_attachment: "kb.typeTaskAttachment",
  }
  return t(keyMap[type] as never) ?? KB_DOC_TYPE_LABELS[type]
}

export function KnowledgeManager({
  projectId,
  project,
}: {
  projectId: number
  project: ProjectInfo
}) {
  const t = useTranslations("Platform")

  // ─── State ───
  const [docs, setDocs] = useState<KnowledgeDocInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResultInfo | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [ftsResults, setFtsResults] = useState<KnowledgeDocFtsResult[] | null>(
    null
  )
  const [searching, setSearching] = useState(false)
  const [docTypeFilter, setDocTypeFilter] = useState<DocTypeFilter>("all")
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDocInfo | null>(
    null
  )
  const [deleting, setDeleting] = useState(false)

  // ─── Data loading ───
  const loadDocs = useCallback(async () => {
    try {
      const result = await listKnowledgeDocs({ projectId })
      setDocs(result)
    } catch (e) {
      console.error("Failed to load KB docs:", e)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    let unsub: (() => void) | null = null

    async function init() {
      setLoading(true)
      try {
        const docList = await listKnowledgeDocs({ projectId })
        if (!cancelled) {
          setDocs(docList)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }

      try {
        const { getTransport, isDesktop } = await import("@/lib/transport")
        if (isDesktop()) {
          const { listen } = await import("@tauri-apps/api/event")
          unsub = await listen<ScanResultInfo>(
            "knowledge://index-changed",
            (event) => {
              setScanResult(event.payload)
              void loadDocs()
            }
          )
        } else {
          unsub = await getTransport().subscribe<ScanResultInfo>(
            "knowledge://index-changed",
            (payload) => {
              setScanResult(payload)
              void loadDocs()
            }
          )
        }
      } catch (e) {
        console.error("[kb-watch] subscribe failed:", e)
      }
    }

    void init()

    return () => {
      cancelled = true
      unsub?.()
    }
  }, [projectId, loadDocs])

  // Select first document automatically once docs loaded if none selected
  useEffect(() => {
    if (docs.length > 0 && selectedDocId === null) {
      setSelectedDocId(docs[0].id)
    }
  }, [docs, selectedDocId])

  // ─── FTS Search ───
  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed) {
      setFtsResults(null)
      setSearching(false)
      return
    }

    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const results = await searchKnowledgeDocsFts({
          projectId,
          query: trimmed,
        })
        setFtsResults(results)
        if (
          results.length > 0 &&
          (!selectedDocId || !results.some((r) => r.doc.id === selectedDocId))
        ) {
          setSelectedDocId(results[0].doc.id)
        }
      } catch (e) {
        console.warn("FTS search failed, falling back to LIKE:", e)
        try {
          const fallback = await searchKnowledgeDocs({
            projectId,
            query: trimmed,
          })
          const transformed = fallback.map((d) => ({
            doc: d,
            snippet: d.description || d.title,
            rank: 999,
          }))
          setFtsResults(transformed)
          if (
            transformed.length > 0 &&
            (!selectedDocId ||
              !transformed.some((r) => r.doc.id === selectedDocId))
          ) {
            setSelectedDocId(transformed[0].doc.id)
          }
        } catch (err) {
          console.error("Search failed completely:", err)
        }
      } finally {
        setSearching(false)
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [projectId, searchQuery, selectedDocId])

  // ─── Scan ───
  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await scanKnowledgeRepo(projectId)
      setScanResult(result)
      await loadDocs()
    } catch (e) {
      console.error("Scan failed:", e)
      setScanResult(null)
    }
    setScanning(false)
  }, [projectId, loadDocs])

  // ─── Init KB ───
  const handleInit = useCallback(async () => {
    try {
      await initKnowledgeRepo(projectId)
      await loadDocs()
    } catch (e) {
      console.error("Init failed:", e)
    }
  }, [projectId, loadDocs])

  // ─── Delete ───
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteKnowledgeDoc(deleteTarget.id)
      if (selectedDocId === deleteTarget.id) {
        setSelectedDocId(null)
      }
      setDeleteTarget(null)
      await loadDocs()
    } catch (e) {
      console.error("Delete failed:", e)
    }
    setDeleting(false)
  }, [deleteTarget, selectedDocId, loadDocs])

  // Filter docs
  const filteredDocs = useMemo(() => {
    return docs.filter((d) => {
      const filename = d.filePath.replace(/\\/g, "/").split("/").pop() ?? ""
      if (KB_SKIP_FILENAMES.has(filename)) return false

      if (docTypeFilter !== "all" && d.docType !== docTypeFilter) {
        return false
      }

      if (selectedTag) {
        if (!d.tagsJson) return false
        try {
          const tags: string[] = JSON.parse(d.tagsJson)
          if (!tags.includes(selectedTag)) return false
        } catch {
          return false
        }
      }

      return true
    })
  }, [docs, docTypeFilter, selectedTag])

  // Extract all tags
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const doc of docs) {
      if (doc.tagsJson) {
        try {
          const parsed = JSON.parse(doc.tagsJson)
          if (Array.isArray(parsed)) {
            parsed.forEach((t) => set.add(String(t)))
          }
        } catch {}
      }
    }
    return Array.from(set).slice(0, 15)
  }, [docs])

  // Currently selected doc
  const selectedDoc = useMemo(() => {
    if (!selectedDocId) return null
    return docs.find((d) => d.id === selectedDocId) ?? null
  }, [docs, selectedDocId])

  const kbPath = (
    project.kbLocalDir ?? `${project.rootDir.replace(/\\/g, "/")}/_knowledge`
  ).replace(/\\/g, "/")

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载知识库…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ─── Status & Action Bar ─── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-muted-foreground leading-none mb-1">
                  {t("kb.path")}
                </span>
                <span className="text-xs font-mono truncate max-w-xl">
                  {kbPath}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={handleScan}
                disabled={scanning}
              >
                {scanning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {t("kb.refreshIndex")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={handleInit}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {t("kb.initKB")}
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={() => setUploadOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" />
                {t("kb.upload")}
              </Button>
            </div>
          </div>

          {/* Scan result notification */}
          {scanResult && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-2">
              {t("kb.scanSuccess", {
                new: scanResult.newCount,
                updated: scanResult.updatedCount,
                deleted: scanResult.deletedCount,
              })}
            </p>
          )}
        </CardHeader>
      </Card>

      {/* ─── Double Column Master-Detail Layout ─── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 h-[calc(100vh-280px)] min-h-[580px]">
        {/* Left Column: Navigator, FTS Search & Filters */}
        <div className="md:col-span-4 xl:col-span-4 flex flex-col border rounded-lg bg-card overflow-hidden">
          {/* Search Header */}
          <div className="p-3 border-b flex flex-col gap-2 shrink-0 bg-muted/20">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 pr-7 h-8 text-xs bg-background"
                placeholder="全文检索（标题、标签、正文）…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : searching ? (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : null}
            </div>

            {/* Filters Row (when not in search mode) */}
            {!searchQuery && (
              <div className="flex items-center gap-2">
                <Select
                  value={docTypeFilter}
                  onValueChange={(v) => setDocTypeFilter(v as DocTypeFilter)}
                >
                  <SelectTrigger className="h-7 text-xs bg-background">
                    <SelectValue placeholder={t("kb.filterType")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("kb.allTypes")}</SelectItem>
                    {FILTER_DOC_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {resolveKbDocTypeLabel(t, type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="text-[0.6875rem] text-muted-foreground shrink-0 ml-auto font-mono">
                  {filteredDocs.length} 篇
                </div>
              </div>
            )}

            {/* Tag Filter Pills */}
            {!searchQuery && allTags.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar">
                {selectedTag && (
                  <button
                    type="button"
                    onClick={() => setSelectedTag(null)}
                    className="inline-flex items-center gap-1 rounded bg-destructive/10 text-destructive text-[0.625rem] px-1.5 py-0.5"
                  >
                    <span>清除标签</span>
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setSelectedTag(selectedTag === tag ? null : tag)
                    }
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[0.625rem] font-medium transition-colors shrink-0",
                      selectedTag === tag
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80 text-muted-foreground"
                    )}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* List Area */}
          <ScrollArea className="flex-1 p-2">
            {ftsResults ? (
              // FTS Search Results with snippets
              <div className="flex flex-col gap-1.5">
                <div className="text-[0.6875rem] font-medium text-muted-foreground px-2 py-0.5">
                  全文检索命中 {ftsResults.length} 条记录
                </div>
                {ftsResults.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">
                    未检索到匹配的知识库文档
                  </div>
                ) : (
                  ftsResults.map((item) => {
                    const isSelected = selectedDocId === item.doc.id
                    return (
                      <button
                        key={item.doc.id}
                        type="button"
                        onClick={() => setSelectedDocId(item.doc.id)}
                        className={cn(
                          "flex flex-col gap-1 rounded-md p-2.5 text-left transition-all border",
                          isSelected
                            ? "border-primary/50 bg-accent text-accent-foreground shadow-xs"
                            : "border-transparent hover:bg-muted/50 text-foreground"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-semibold truncate leading-tight">
                            {item.doc.title}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-[0.5625rem] shrink-0 font-normal px-1 py-0"
                          >
                            {item.doc.docType}
                          </Badge>
                        </div>
                        <div
                          className="text-[0.6875rem] text-muted-foreground line-clamp-2 leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: item.snippet }}
                        />
                        <div className="text-[0.625rem] text-muted-foreground font-mono truncate opacity-70 mt-0.5">
                          {getRelativeDocPath(item.doc.filePath) ||
                            item.doc.filePath}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            ) : (
              // Regular Filtered List
              <div className="flex flex-col gap-1">
                {filteredDocs.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">
                    {t("kb.noDocs")}
                  </div>
                ) : (
                  filteredDocs.map((doc) => {
                    const isSelected = selectedDocId === doc.id
                    const relPath =
                      getRelativeDocPath(doc.filePath) || doc.filePath
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => setSelectedDocId(doc.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-md p-2 text-left transition-all border",
                          isSelected
                            ? "border-primary/50 bg-accent text-accent-foreground font-medium shadow-xs"
                            : "border-transparent hover:bg-muted/50 text-foreground"
                        )}
                      >
                        <FileText
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isSelected
                              ? "text-primary"
                              : "text-muted-foreground"
                          )}
                        />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs truncate leading-snug font-medium">
                            {doc.title}
                          </span>
                          <span className="text-[0.625rem] text-muted-foreground font-mono truncate">
                            {relPath}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[0.5625rem] shrink-0 font-normal px-1 py-0 ml-1"
                        >
                          {resolveKbDocTypeLabel(t, doc.docType as KbDocType) ??
                            doc.docType}
                        </Badge>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </ScrollArea>

          {/* Bottom Summary */}
          <div className="px-3 py-1.5 border-t bg-muted/10 flex items-center justify-between text-[0.6875rem] text-muted-foreground shrink-0">
            <span>总计 {docs.length} 篇文档</span>
            <span>SQLite FTS5 引擎</span>
          </div>
        </div>

        {/* Right Column: Markdown Live Preview & Metadata */}
        <div className="md:col-span-8 xl:col-span-8 flex flex-col border rounded-lg bg-card overflow-hidden">
          <KbDocPreview
            doc={selectedDoc}
            project={project}
            onDelete={setDeleteTarget}
          />
        </div>
      </div>

      {/* ─── Upload Dialog ─── */}
      <KnowledgeUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false)
          void loadDocs()
        }}
      />

      {/* ─── Delete Confirm ─── */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kb.deleteDoc")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("kb.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel" as never) || "取消"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("kb.deleteDoc")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
