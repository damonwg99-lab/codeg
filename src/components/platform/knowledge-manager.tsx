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
  Wrench,
  FileText,
} from "lucide-react"
import {
  scanKnowledgeRepo,
  listKnowledgeDocs,
  searchKnowledgeDocs,
  listSkills,
  initKnowledgeRepo,
  deleteKnowledgeDoc,
} from "@/lib/platform/api"
import type {
  KnowledgeDocInfo,
  ScanResultInfo,
  SkillInfo,
  KbDocType,
  ProjectInfo,
} from "@/lib/platform/types"
import { KB_DOC_TYPE_LABELS } from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { KnowledgeDocDetailDialog } from "./knowledge-doc-detail-dialog"

type DocTypeFilter = KbDocType | "all"

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
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResultInfo | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [docTypeFilter, setDocTypeFilter] = useState<DocTypeFilter>("all")
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocInfo | null>(null)
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

  const loadSkills = useCallback(async () => {
    try {
      const result = await listSkills(projectId)
      setSkills(result)
    } catch (e) {
      console.error("Failed to load skills:", e)
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const docList = await listKnowledgeDocs({ projectId })
        const skillList = await listSkills(projectId)
        if (!cancelled) {
          setDocs(docList)
          setSkills(skillList)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [projectId])

  // ─── Scan ───
  const handleScan = useCallback(async () => {
    setScanning(true)
    try {
      const result = await scanKnowledgeRepo(projectId)
      setScanResult(result)
      await loadDocs()
      await loadSkills()
    } catch (e) {
      console.error("Scan failed:", e)
      setScanResult(null)
    }
    setScanning(false)
  }, [projectId, loadDocs, loadSkills])

  // ─── Init KB ───
  const handleInit = useCallback(async () => {
    try {
      await initKnowledgeRepo(projectId)
      await loadDocs()
      await loadSkills()
    } catch (e) {
      console.error("Init failed:", e)
    }
  }, [projectId, loadDocs, loadSkills])

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
      ? docs
      : docs.filter((d) => d.docType === docTypeFilter)

  // ─── Doc counts by type ───
  const docCounts = docs.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.docType] = (acc[doc.docType] ?? 0) + 1
    return acc
  }, {})

  const kbPath = project.kbLocalDir ?? `${project.rootDir}/_knowledge`

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
                    {count} {KB_DOC_TYPE_LABELS[type]}
                  </Badge>
                )
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Content Tabs ── */}
      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">
            <FileText className="mr-1 h-3.5 w-3.5" />
            {t("kb.documents")}
          </TabsTrigger>
          <TabsTrigger value="skills">
            <Wrench className="mr-1 h-3.5 w-3.5" />
            {t("kb.skills")}
          </TabsTrigger>
        </TabsList>

        {/* ── Documents Tab ── */}
        <TabsContent value="documents">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="relative flex-1 max-w-[200px]">
                    <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="h-7 pl-7 text-[0.8125rem]"
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
                      {(
                        Object.entries(KB_DOC_TYPE_LABELS) as [
                          KbDocType,
                          string,
                        ][]
                      ).map(([type, label]) => (
                        <SelectItem key={type} value={type}>
                          {label}
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
                <p className="text-[0.8125rem] text-muted-foreground py-4 text-center">
                  {t("kb.noDocs")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[0.8125rem]">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-1.5 pr-2 text-left font-medium">
                          {t("kb.docTitle")}
                        </th>
                        <th className="py-1.5 pr-2 text-left font-medium">
                          {t("kb.docType")}
                        </th>
                        <th className="py-1.5 pr-2 text-left font-medium">
                          {t("kb.docShared")}
                        </th>
                        <th className="py-1.5 pr-2 text-left font-medium">
                          {t("kb.docPath")}
                        </th>
                        <th className="py-1.5 text-right font-medium">
                          {t("kb.docActions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDocs.map((doc) => (
                        <tr
                          key={doc.id}
                          className="border-b hover:bg-accent/50 cursor-pointer"
                          onClick={() => setSelectedDoc(doc)}
                        >
                          <td className="py-1.5 pr-2 font-medium truncate max-w-[200px]">
                            {doc.title}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Badge
                              variant="outline"
                              className="text-[0.625rem]"
                            >
                              {KB_DOC_TYPE_LABELS[doc.docType as KbDocType] ??
                                doc.docType}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-2">
                            {doc.isShared ? "✓" : "—"}
                          </td>
                          <td className="py-1.5 pr-2 text-muted-foreground truncate max-w-[200px]">
                            {doc.filePath}
                          </td>
                          <td className="py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedDoc(doc)
                                }}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteTarget(doc)
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Skills Tab ── */}
        <TabsContent value="skills">
          <Card>
            <CardContent className="pt-4">
              {skills.length === 0 ? (
                <p className="text-[0.8125rem] text-muted-foreground py-4 text-center">
                  {t("kb.noSkills")}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {skills.map((skill) => (
                    <div
                      key={skill.name}
                      className="rounded-md border p-3 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-muted-foreground" />
                        <span className="text-[0.875rem] font-medium">
                          {skill.name}
                        </span>
                      </div>
                      {skill.triggerTaskType && (
                        <span className="text-[0.75rem] text-muted-foreground">
                          {t("kb.skillTrigger", {
                            type: skill.triggerTaskType,
                          })}
                        </span>
                      )}
                      {skill.inject.length > 0 && (
                        <span className="text-[0.75rem] text-muted-foreground">
                          {t("kb.skillInject", {
                            items: skill.inject.join(", "),
                          })}
                        </span>
                      )}
                      {skill.description && (
                        <span className="text-[0.8125rem]">
                          {skill.description}
                        </span>
                      )}
                      {skill.agentHint && (
                        <span className="text-[0.75rem] text-muted-foreground italic">
                          💡 {skill.agentHint}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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

      {/* ── Doc Detail Dialog ── */}
      {selectedDoc && (
        <KnowledgeDocDetailDialog
          doc={selectedDoc}
          projectId={projectId}
          open={selectedDoc !== null}
          onClose={() => setSelectedDoc(null)}
          onDeleted={() => {
            setSelectedDoc(null)
            void loadDocs()
          }}
          onUpdated={() => {
            void loadDocs()
          }}
        />
      )}

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
