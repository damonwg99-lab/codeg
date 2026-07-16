"use client"

import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import {
  Loader2,
  RefreshCw,
  Upload,
  Eye,
  Trash2,
  FolderOpen,
  Search,
  FileText,
} from "lucide-react"
import {
  scanKnowledgeRepo,
  listKnowledgeDocs,
  searchKnowledgeDocs,
  initKnowledgeRepo,
  deleteKnowledgeDoc,
} from "@/lib/platform/api"
import type {
  KnowledgeDocInfo,
  ScanResultInfo,
  KbDocType,
  ProjectInfo,
} from "@/lib/platform/types"
import { KB_DOC_TYPE_LABELS, KB_SKIP_FILENAMES } from "@/lib/platform/types"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useActiveFolder } from "@/contexts/active-folder-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { KnowledgeUploadDialog } from "./knowledge-upload-dialog"
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

/** Doc types shown in the KB manager filter dropdown (excludes task_attachment) */
const FILTER_DOC_TYPES: KbDocType[] = [
  "tech_doc",
  "template",
  "skill",
  "requirement",
  "ai_intermediate",
]

/** Resolve KB doc type label using i18n. Each key is explicitly mapped
 *  to satisfy next-intl's strict type-safe `t()` function. */
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
  // Cast the resolved key to bypass next-intl's strict NamespacedMessageKeys
  // — the keys are guaranteed to exist in the message files.
  return t(keyMap[type] as never) ?? KB_DOC_TYPE_LABELS[type]
}

/** Compute KB doc path relative to the folder root for openFilePreview.
 *  KB docs store filePath relative to the _knowledge/ directory.
 *  Returns null when the path can't be resolved (no folder context or
 *  KB dir outside project root). */
function kbDocRelPath(
  kbLocalDir: string | null,
  rootDir: string,
  folderPath: string | null,
  filePath: string
): string | null {
  const kbDir = (
    kbLocalDir ?? `${rootDir.replace(/\\/g, "/")}/_knowledge`
  ).replace(/\\/g, "/")
  const fp = folderPath?.replace(/\\/g, "/") ?? ""
  const normFilePath = filePath.replace(/\\/g, "/")
  if (!fp) return null
  if (kbDir.startsWith(fp + "/") || kbDir === fp + "/_knowledge") {
    const kbRel = kbDir.slice(fp.length + 1)
    return `${kbRel}/${normFilePath}`
  }
  return null
}

export function KnowledgeManager({
  projectId,
  project,
}: {
  projectId: number
  project: ProjectInfo
}) {
  const t = useTranslations("Platform")
  const { openFilePreview } = useWorkspaceContext()
  const { activeFolder } = useActiveFolder()

  // ─── State ───
  const [docs, setDocs] = useState<KnowledgeDocInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResultInfo | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [docTypeFilter, setDocTypeFilter] = useState<DocTypeFilter>("all")
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
      setDeleteTarget(null)
      await loadDocs()
    } catch (e) {
      console.error("Delete failed:", e)
    }
    setDeleting(false)
  }, [deleteTarget, loadDocs])

  // ─── Search ───
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      await loadDocs()
      return
    }
    try {
      const result = await searchKnowledgeDocs({
        projectId,
        query: searchQuery.trim(),
      })
      setDocs(result)
    } catch (e) {
      console.error("Search failed:", e)
    }
  }, [projectId, searchQuery, loadDocs])

  // ─── Filter ───
  const filteredDocs =
    docTypeFilter === "all"
      ? docs.filter(
          (d) =>
            !KB_SKIP_FILENAMES.has(
              d.filePath.replace(/\\/g, "/").split("/").pop() ?? ""
            )
        )
      : docs.filter(
          (d) =>
            d.docType === docTypeFilter &&
            !KB_SKIP_FILENAMES.has(
              d.filePath.replace(/\\/g, "/").split("/").pop() ?? ""
            )
        )

  // ─── Doc counts by type ───
  const docCounts = filteredDocs.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.docType] = (acc[doc.docType] ?? 0) + 1
    return acc
  }, {})

  // Normalize to forward slashes for consistent display and comparison
  const kbPath = (
    project.kbLocalDir ?? `${project.rootDir.replace(/\\/g, "/")}/_knowledge`
  ).replace(/\\/g, "/")

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Status Section ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[0.9375rem]">
              {t("project.knowledgeBase")}
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleScan}
                disabled={scanning}
              >
                {scanning ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                )}
                {t("kb.refreshIndex")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleInit}>
                <FolderOpen className="mr-1 h-3.5 w-3.5" />
                {t("kb.initKB")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {/* KB Path */}
          <div className="flex flex-col gap-1">
            <span className="text-[0.75rem] text-muted-foreground">
              {t("kb.path")}
            </span>
            <span className="text-[0.875rem]">{kbPath}</span>
          </div>

          {/* Scan result notification */}
          {scanResult && (
            <p className="text-[0.8125rem] text-green-600 dark:text-green-400">
              {t("kb.scanSuccess", {
                new: scanResult.newCount,
                updated: scanResult.updatedCount,
                deleted: scanResult.deletedCount,
              })}
            </p>
          )}

          {/* Doc type count badges */}
          {docs.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {(Object.entries(docCounts) as [KbDocType, number][]).map(
                ([type, count]) => (
                  <Badge
                    key={type}
                    variant="outline"
                    className="text-[0.625rem]"
                  >
                    {count} {resolveKbDocTypeLabel(t, type)}
                  </Badge>
                )
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Documents Card ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1 max-w-[200px]">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-7 text-[0.8125rem] py-2"
                  placeholder={t("kb.search")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSearch()
                  }}
                />
              </div>
              <Select
                value={docTypeFilter}
                onValueChange={(v) => setDocTypeFilter(v as DocTypeFilter)}
              >
                <SelectTrigger className="h-7 w-[140px] text-[0.8125rem]">
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
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              {t("kb.upload")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filteredDocs.length === 0 ? (
            <p className="text-[0.75rem] text-muted-foreground">
              {t("kb.noDocs")}
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[0.875rem] font-medium truncate">
                      {doc.title}
                    </span>
                    <span className="text-[0.75rem] text-muted-foreground truncate">
                      {doc.filePath}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[0.625rem] shrink-0 ml-1"
                  >
                    {resolveKbDocTypeLabel(t, doc.docType as KbDocType) ??
                      doc.docType}
                  </Badge>
                  <div className="flex items-center gap-1 shrink-0 ml-auto">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation()
                        const relPath = kbDocRelPath(
                          project.kbLocalDir,
                          project.rootDir,
                          activeFolder?.path ?? null,
                          doc.filePath
                        )
                        if (relPath) void openFilePreview(relPath)
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(doc)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Upload Dialog ── */}
      <KnowledgeUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => {
          setUploadOpen(false)
          void loadDocs()
        }}
      />

      {/* ── Delete Confirm ── */}
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
            <AlertDialogCancel>{t("project.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              disabled={deleting}
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
