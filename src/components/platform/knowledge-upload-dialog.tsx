"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Upload } from "lucide-react"
import { uploadKbDoc } from "@/lib/platform/api"
import type { KbDocType } from "@/lib/platform/types"
import { KB_DOC_TYPE_DIRS } from "@/lib/platform/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** Uploadable doc types (excludes task_attachment which has its own flow) */
const UPLOAD_DOC_TYPES: KbDocType[] = [
  "tech_doc",
  "template",
  "requirement",
  "ai_intermediate",
]

/** Resolve KB doc type label using i18n for the upload dialog. */
function resolveTypeLabel(t: (key: never) => string, type: KbDocType): string {
  const keyMap: Record<KbDocType, string> = {
    tech_doc: "kb.typeTechDoc",
    template: "kb.typeTemplate",
    skill: "kb.typeSkill",
    requirement: "kb.typeRequirement",
    ai_intermediate: "kb.typeAiIntermediate",
    task_attachment: "kb.typeTaskAttachment",
  }
  return t(keyMap[type] as never)
}

interface KnowledgeUploadDialogProps {
  projectId: number
  open: boolean
  onClose: () => void
  onUploaded: () => void
}

export function KnowledgeUploadDialog({
  projectId,
  open,
  onClose,
  onUploaded,
}: KnowledgeUploadDialogProps) {
  const t = useTranslations("Platform")

  const [docType, setDocType] = useState<KbDocType>("tech_doc")
  const [subDir, setSubDir] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derive target directory from doc type + optional sub-dir
  const targetDir = subDir.trim()
    ? `${KB_DOC_TYPE_DIRS[docType]}/${subDir.trim()}`
    : KB_DOC_TYPE_DIRS[docType]

  const handleUpload = useCallback(async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await uploadKbDoc({
        projectId,
        targetDir,
        file,
      })
      // Reset form
      setDocType("tech_doc")
      setSubDir("")
      setFile(null)
      onUploaded()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg || t("kb.uploadFailed"))
    }
    setUploading(false)
  }, [file, projectId, targetDir, onUploaded, t])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("kb.uploadTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* File type */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("kb.fileType")}</Label>
            <Select
              value={docType}
              onValueChange={(v) => setDocType(v as KbDocType)}
            >
              <SelectTrigger className="h-7 text-[0.8125rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UPLOAD_DOC_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {resolveTypeLabel(t, type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Target directory preview */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("kb.targetDir")}</Label>
            <span className="text-[0.875rem] text-muted-foreground">
              {targetDir}
            </span>
          </div>

          {/* Sub-directory (optional) */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("kb.subDir")}</Label>
            <Input
              className="h-7 text-[0.8125rem]"
              placeholder={t("kb.subDirPlaceholder")}
              value={subDir}
              onChange={(e) => setSubDir(e.target.value)}
            />
          </div>

          {/* File selection */}
          <div className="flex flex-col gap-1.5">
            <Label>{t("kb.selectFile")}</Label>
            <Input
              className="h-7 text-[0.8125rem]"
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setFile(f ?? null)
              }}
            />
            {file && (
              <span className="text-[0.75rem] text-muted-foreground">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </span>
            )}
          </div>

          {/* Error message */}
          {error && (
            <p className="text-[0.8125rem] text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={uploading}>
            {t("project.cancel")}
          </Button>
          <Button
            onClick={() => void handleUpload()}
            disabled={!file || uploading}
          >
            {uploading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1 h-3.5 w-3.5" />
            )}
            {uploading ? t("kb.uploading") : t("kb.upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
