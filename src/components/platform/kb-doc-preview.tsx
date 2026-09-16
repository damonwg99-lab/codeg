"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { useTranslations } from "next-intl"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { BundledLanguage } from "shiki"
import {
  ExternalLink,
  Trash2,
  Copy,
  Check,
  Loader2,
  Calendar,
  Tag,
  Sparkles,
  BookOpen,
  FileSpreadsheet,
  Braces,
  ListTree,
  FileCode,
  FileText,
} from "lucide-react"
import { readKbDocContent } from "@/lib/platform/api"
import type {
  KnowledgeDocInfo,
  ProjectInfo,
  KbDocType,
} from "@/lib/platform/types"
import { KB_DOC_TYPE_LABELS } from "@/lib/platform/types"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { kbDocAbsPath } from "@/lib/kb-doc-path"
import { splitAbsPath } from "@/lib/file-open-target"
import { isOfficePreviewable, languageFromPath } from "@/lib/language-detect"
import { OfficePreview } from "@/components/files/office-preview"
import { JsonTreeView } from "@/components/ai-elements/json-tree"
import { CodeBlock } from "@/components/ai-elements/code-block"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface KbDocPreviewProps {
  doc: KnowledgeDocInfo | null
  project: ProjectInfo
  onDelete: (doc: KnowledgeDocInfo) => void
}

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

export function KbDocPreview({ doc, project, onDelete }: KbDocPreviewProps) {
  const t = useTranslations("Platform")
  const { openFilePreview } = useWorkspaceContext()

  const [content, setContent] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [jsonViewMode, setJsonViewMode] = useState<
    "formatted" | "tree" | "raw"
  >("formatted")

  // Target paths
  const absPath = useMemo(() => {
    if (!doc) return ""
    return kbDocAbsPath(project.kbLocalDir, project.rootDir, doc.filePath)
  }, [doc, project])

  const io = useMemo(() => {
    if (!absPath) return null
    return splitAbsPath(absPath)
  }, [absPath])

  // File type categorizations
  const isOffice = useMemo(() => {
    if (!doc) return false
    return isOfficePreviewable(doc.filePath)
  }, [doc])

  const ext = useMemo(() => {
    if (!doc) return ""
    return doc.filePath.toLowerCase().split(".").pop() ?? ""
  }, [doc])

  const isJson = ext === "json" || ext === "jsonc"
  const isMarkdown = ext === "md" || ext === "markdown"

  // Parsed and formatted JSON memo
  const parsedJsonResult = useMemo(() => {
    if (!isJson || !content) return null
    try {
      const parsed = JSON.parse(content)
      const formatted = JSON.stringify(parsed, null, 2)
      return { parsed, formatted, error: null }
    } catch (e) {
      return {
        parsed: null,
        formatted: content,
        error: e instanceof Error ? e.message : "Invalid JSON syntax",
      }
    }
  }, [isJson, content])

  // Load document text content (only when not office). State resets run one
  // microtask out of the synchronous effect pass (react-hooks/set-state-in-effect
  // warns on cascade-rendering setState; the fetch below is async anyway).
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      if (!doc) {
        setContent("")
        setError(null)
        return
      }

      if (isOffice) {
        // Office documents are rendered via OfficePreview / officecli watch
        setContent("")
        setLoading(false)
        setError(null)
        return
      }

      setLoading(true)
      setError(null)

      readKbDocContent(doc.id)
        .then((data) => {
          if (!cancelled) {
            setContent(data)
            setLoading(false)
          }
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("Failed to read doc content:", err)
            setError(
              err?.message ||
                t("kb.contentFailed" as never) ||
                "无法读取文件内容"
            )
            setLoading(false)
          }
        })
    })

    return () => {
      cancelled = true
    }
  }, [doc, isOffice, t])

  // Copy handler
  const handleCopy = useCallback(() => {
    let textToCopy = content
    if (isOffice) {
      textToCopy = absPath || doc?.filePath || ""
    } else if (isJson && parsedJsonResult?.parsed) {
      textToCopy = jsonViewMode === "raw" ? content : parsedJsonResult.formatted
    }

    if (!textToCopy) return
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [content, isOffice, isJson, parsedJsonResult, jsonViewMode, absPath, doc])

  // Open in workspace editor
  const handleOpenWorkspace = useCallback(() => {
    if (!absPath) return
    void openFilePreview(absPath)
  }, [absPath, openFilePreview])

  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground select-none">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 mb-3">
          <BookOpen className="h-6 w-6 opacity-60" />
        </div>
        <h4 className="text-[0.9375rem] font-medium text-foreground mb-1">
          {t("kb.documents" as never) || "知识库文档预览"}
        </h4>
        <p className="text-[0.8125rem] max-w-sm">
          在左侧选择文档进行实时预览，或使用搜索框进行正文全文检索
        </p>
      </div>
    )
  }

  // Parse tags
  let tags: string[] = []
  if (doc.tagsJson) {
    try {
      tags = JSON.parse(doc.tagsJson)
    } catch {
      tags = []
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3 border-b p-3.5 shrink-0 bg-card/50">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold truncate leading-tight">
              {doc.title}
            </h3>
            <Badge
              variant="outline"
              className="text-[0.6875rem] shrink-0 font-normal"
            >
              {resolveKbDocTypeLabel(t, doc.docType as KbDocType) ??
                doc.docType}
            </Badge>
            {isOffice && (
              <Badge
                variant="secondary"
                className="text-[0.625rem] gap-1 bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30"
              >
                <FileSpreadsheet className="h-3 w-3" />
                Office 预览
              </Badge>
            )}
            {isJson && (
              <Badge
                variant="secondary"
                className="text-[0.625rem] gap-1 bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30"
              >
                <Braces className="h-3 w-3" />
                JSON
              </Badge>
            )}
            {doc.isShared && (
              <Badge variant="secondary" className="text-[0.625rem] shrink-0">
                Git Shared
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {doc.filePath}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* JSON Format View Switcher */}
          {isJson && parsedJsonResult?.parsed && (
            <div className="flex items-center rounded-md border p-0.5 bg-muted/30 text-xs mr-1">
              <button
                type="button"
                onClick={() => setJsonViewMode("formatted")}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] transition-colors",
                  jsonViewMode === "formatted"
                    ? "bg-background text-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="代码高亮美化格式化"
              >
                <FileCode className="h-3 w-3" />
                <span>格式化</span>
              </button>
              <button
                type="button"
                onClick={() => setJsonViewMode("tree")}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] transition-colors",
                  jsonViewMode === "tree"
                    ? "bg-background text-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="树状层级可折叠结构"
              >
                <ListTree className="h-3 w-3" />
                <span>树形结构</span>
              </button>
              <button
                type="button"
                onClick={() => setJsonViewMode("raw")}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded text-[0.6875rem] transition-colors",
                  jsonViewMode === "raw"
                    ? "bg-background text-foreground font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="原始未格式化内容"
              >
                <FileText className="h-3 w-3" />
                <span>原始文本</span>
              </button>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={handleCopy}
            disabled={(!content && !isOffice) || loading}
            title={
              isOffice
                ? "复制文件绝对路径"
                : isJson
                  ? "复制 JSON 内容"
                  : "复制正文 Markdown"
            }
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">
              {copied
                ? "已复制"
                : isOffice
                  ? "复制路径"
                  : isJson && jsonViewMode !== "raw"
                    ? "复制 JSON"
                    : "复制"}
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-xs"
            onClick={handleOpenWorkspace}
            title="在工作区编辑器中打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">工作区打开</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(doc)}
            title="从知识库中删除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Frontmatter Metadata Bar (if present) */}
      {(tags.length > 0 ||
        doc.description ||
        doc.skillName ||
        doc.updatedAt) && (
        <div className="flex flex-col gap-1.5 px-4 py-2 border-b bg-muted/20 text-xs shrink-0">
          {doc.description && (
            <p className="text-muted-foreground italic leading-relaxed text-[0.75rem]">
              {doc.description}
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap text-muted-foreground">
            {tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Tag className="h-3 w-3 opacity-70" />
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[0.6875rem] font-medium text-primary"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {doc.skillName && (
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-amber-500" />
                <span className="font-mono text-[0.6875rem]">
                  {doc.skillName}
                </span>
              </div>
            )}

            {doc.updatedAt && (
              <div className="flex items-center gap-1 text-[0.6875rem] ml-auto">
                <Calendar className="h-3 w-3 opacity-60" />
                <span>
                  {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {isOffice ? (
        // ─── 1. Office Preview (Excel .xlsx, .xls, .docx, .pptx) ───
        <div className="flex-1 relative min-h-0 bg-muted/10">
          <OfficePreview
            key={doc.id}
            rootPath={io?.rootPath ?? null}
            relPath={io?.ioPath ?? null}
          />
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          <span className="text-xs">
            {t("kb.contentLoading" as never) || "加载文档正文…"}
          </span>
        </div>
      ) : error ? (
        <div className="p-6">
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-center text-xs text-destructive">
            {error}
          </div>
        </div>
      ) : isJson && parsedJsonResult ? (
        // ─── 2. JSON View (Formatted / Tree / Raw) ───
        <div className="flex-1 overflow-auto p-4">
          {parsedJsonResult.error && (
            <div className="mb-3 rounded bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-600 dark:text-amber-400">
              JSON 语法解析警告: {parsedJsonResult.error}
            </div>
          )}

          {jsonViewMode === "tree" && parsedJsonResult.parsed ? (
            <div className="rounded-md border bg-card/60 p-2">
              <JsonTreeView
                value={parsedJsonResult.parsed}
                rawText={parsedJsonResult.formatted}
              />
            </div>
          ) : jsonViewMode === "formatted" && parsedJsonResult.parsed ? (
            <div className="rounded-md border overflow-hidden">
              <CodeBlock
                code={parsedJsonResult.formatted}
                language="json"
                showLineNumbers
              />
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <CodeBlock code={content} language="json" showLineNumbers />
            </div>
          )}
        </div>
      ) : isMarkdown ? (
        // ─── 3. Markdown Preview ───
        <ScrollArea className="flex-1 p-5">
          {content ? (
            <div
              className={
                "prose dark:prose-invert max-w-none text-xs leading-relaxed " +
                "[&_h1]:text-lg [&_h1]:font-bold [&_h1]:border-b [&_h1]:pb-1.5 [&_h1]:mb-3 [&_h1]:mt-4 " +
                "[&_h2]:text-base [&_h2]:font-semibold [&_h2]:border-b [&_h2]:pb-1 [&_h2]:mb-2 [&_h2]:mt-3 " +
                "[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-2.5 " +
                "[&_p]:mb-2.5 [&_p]:leading-normal " +
                "[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2.5 " +
                "[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2.5 " +
                "[&_li]:mb-1 " +
                "[&_code]:font-mono [&_code]:text-[0.75rem] [&_code]:bg-muted/80 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 " +
                "[&_pre]:bg-muted/90 [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:mb-3 " +
                "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
                "[&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground " +
                "[&_table]:w-full [&_table]:border-collapse [&_table]:mb-3 " +
                "[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium " +
                "[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5"
              }
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-xs">
              此文档为空
            </div>
          )}
        </ScrollArea>
      ) : (
        // ─── 4. Plain Text or other Code Files (.yaml, .sql, .ts, etc.) ───
        <div className="flex-1 overflow-auto p-4">
          <div className="rounded-md border overflow-hidden">
            <CodeBlock
              code={content || ""}
              language={
                (languageFromPath(doc.filePath) ||
                  "plaintext") as BundledLanguage
              }
              showLineNumbers
            />
          </div>
        </div>
      )}
    </div>
  )
}
