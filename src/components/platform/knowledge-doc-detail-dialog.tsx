"use client"

import { useEffect, useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Trash2, Eye } from "lucide-react"
import { readKbDocContent, deleteKnowledgeDoc } from "@/lib/platform/api"
import type { KnowledgeDocInfo, KbDocType } from "@/lib/platform/types"
import { KB_DOC_TYPE_LABELS } from "@/lib/platform/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

interface KnowledgeDocDetailDialogProps {
  doc: KnowledgeDocInfo
  projectId: number
  open: boolean
  onClose: () => void
  onDeleted: () => void
  onUpdated: () => void
}

export function KnowledgeDocDetailDialog({
  doc,
  projectId,
  open,
  onClose,
  onDeleted,
  onUpdated: _onUpdated,
}: KnowledgeDocDetailDialogProps) {
  const t = useTranslations("Platform")

  const [content, setContent] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)

  // Delete state
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ── Load content when doc changes ──
  useEffect(() => {
    if (!open || !doc) return
    let cancelled = false
    async function loadContent() {
      setContentLoading(true)
      setContentError(null)
      try {
        const text = await readKbDocContent(doc.id)
        if (!cancelled) {
          setContent(text)
          setContentLoading(false)
        }
      } catch {
        if (!cancelled) {
          setContentError(t("kb.contentFailed"))
          setContentLoading(false)
        }
      }
    }
    void loadContent()
    return () => {
      cancelled = true
    }
  }, [open, doc, t])

  // ── Delete handler ──
  const handleDelete = useCallback(async () => {
    setDeleting(true)
    try {
      await deleteKnowledgeDoc(doc.id)
      setConfirmDeleteOpen(false)
      onDeleted()
    } catch (e) {
      console.error("Delete failed:", e)
    }
    setDeleting(false)
  }, [doc.id, onDeleted])

  // Parse tags
  const tags = doc.tagsJson ? (JSON.parse(doc.tagsJson) as string[]) : null

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-[540px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              {doc.title}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            {/* ── Metadata ── */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[0.75rem] text-muted-foreground">
                  {t("kb.docType")}:
                </span>
                <Badge variant="outline" className="text-[0.625rem]">
                  {KB_DOC_TYPE_LABELS[doc.docType as KbDocType] ?? doc.docType}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.75rem] text-muted-foreground">
                  {t("kb.docPath")}:
                </span>
                <span className="text-[0.8125rem]">{doc.filePath}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.75rem] text-muted-foreground">
                  {t("kb.docShared")}:
                </span>
                <span className="text-[0.8125rem]">
                  {doc.isShared ? "✓" : "—"}
                </span>
              </div>
              {doc.description && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[0.75rem] text-muted-foreground">
                    {t("kb.description")}:
                  </span>
                  <span className="text-[0.8125rem]">{doc.description}</span>
                </div>
              )}
              {tags && tags.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[0.625rem]"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* ── Content preview ── */}
            {contentLoading ? (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("kb.contentLoading")}
              </div>
            ) : contentError ? (
              <p className="text-[0.8125rem] text-destructive py-4 text-center">
                {contentError}
              </p>
            ) : content ? (
              <pre className="text-[0.8125rem] whitespace-pre-wrap break-words bg-muted/50 rounded-md p-3 max-h-[400px] overflow-y-auto">
                {content}
              </pre>
            ) : null}

            <Separator />

            {/* ── Actions ── */}
            <div className="flex items-center justify-between">
              <span className="text-[0.75rem] text-muted-foreground">
                ID: {doc.id} · Project: {projectId}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                {t("kb.deleteDoc")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
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
    </>
  )
}
