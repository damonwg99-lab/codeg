"use client"

import { useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Search,
  Tag,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { InjectOption, OptionId } from "@/components/platform/context-inject-panel-utils"

interface KbTreePickerProps {
  options: InjectOption[]
  checked: Set<OptionId>
  onToggle: (id: OptionId, value: boolean) => void
  variant?: "compact" | "full"
  searchQuery?: string
  onSearchChange?: (query: string) => void
  emptyMsg?: string
  className?: string
}

/** Predefined localized friendly names for common doc categories/types */
const DOC_TYPE_LABELS: Record<string, string> = {
  docs: "技术文档 (docs)",
  "docs/architecture": "架构设计 (architecture)",
  "docs/api": "接口协议 (api)",
  "docs/guide": "开发指南 (guide)",
  templates: "文档模板 (templates)",
  requirements: "需求规范 (requirements)",
  skills: "能力技能 (skills)",
  ".private/tasks": "任务关联文件",
  根目录: "根目录文档 (Root)",
}

/** Helper to strip base directory / knowledge root from docPath to get clean relative path */
export function getRelativeDocPath(docPath?: string): string {
  if (!docPath) return ""
  let p = docPath.replace(/\\/g, "/")

  // 1. If path contains "/_knowledge/", take everything after it
  const kbIdx = p.indexOf("/_knowledge/")
  if (kbIdx !== -1) {
    return p.slice(kbIdx + "/_knowledge/".length)
  }
  if (p.startsWith("_knowledge/")) {
    return p.slice("_knowledge/".length)
  }

  // 2. If path contains common known KB subfolders, slice from that folder
  const commonFolders = [
    "docs",
    "templates",
    "requirements",
    "skills",
    "specs",
    "guides",
    "api",
    "database",
    ".private",
  ]
  for (const folder of commonFolders) {
    const idx = p.indexOf(`/${folder}/`)
    if (idx !== -1) {
      return p.slice(idx + 1)
    }
    if (p.startsWith(`${folder}/`)) {
      return p
    }
  }

  // 3. If it's a Windows drive path (e.g. "D:/.../file.md"), clean it up
  const segments = p.split("/").filter(Boolean)
  if (segments.length > 0 && /^[a-zA-Z]:$/.test(segments[0])) {
    if (segments.length >= 3) {
      return segments.slice(-2).join("/")
    }
    return segments.slice(1).join("/")
  }

  return p
}

/** Extract folder or category key from a docPath */
function getCategoryKey(option: InjectOption): string {
  const relPath = getRelativeDocPath(option.docPath)
  if (!relPath) return "根目录"

  const parts = relPath.split("/").filter(Boolean)
  if (parts.length > 1) {
    return parts.slice(0, -1).join("/")
  }
  return "根目录"
}

export function KbTreePicker({
  options,
  checked,
  onToggle,
  variant = "compact",
  searchQuery = "",
  onSearchChange,
  emptyMsg = "暂无知识库文档",
  className,
}: KbTreePickerProps) {
  const isCompact = variant === "compact"
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set())

  // Collect all available tags across options
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const opt of options) {
      if (opt.description) {
        // Find hashtag markers or words
        const matches = opt.description.match(/#([\w\u4e00-\u9fa5-]+)/g)
        if (matches) {
          matches.forEach((m) => tagSet.add(m.slice(1)))
        }
      }
    }
    return Array.from(tagSet)
  }, [options])

  // Filter options by search query & selected tag
  const filteredOptions = useMemo(() => {
    let list = options
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.description?.toLowerCase().includes(q) ||
          opt.docPath?.toLowerCase().includes(q)
      )
    }
    if (selectedTag) {
      const tagQuery = `#${selectedTag}`.toLowerCase()
      list = list.filter((opt) =>
        opt.description?.toLowerCase().includes(tagQuery)
      )
    }
    return list
  }, [options, searchQuery, selectedTag])

  // Group by category (subfolder or docType)
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, InjectOption[]> = {}
    for (const opt of filteredOptions) {
      const cat = getCategoryKey(opt)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(opt)
    }
    return groups
  }, [filteredOptions])

  const categoryKeys = useMemo(() => Object.keys(groupedByCategory), [groupedByCategory])

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const toggleAllInCategory = (items: InjectOption[], e: React.MouseEvent) => {
    e.stopPropagation()
    const allChecked = items.every((item) => checked.has(item.id))
    items.forEach((item) => {
      onToggle(item.id, !allChecked)
    })
  }

  return (
    <div className={cn("flex flex-col gap-2 min-h-0", className)}>
      {/* Search Input */}
      {onSearchChange && (
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className={cn(
              "pl-8 pr-2 bg-background/80 focus-visible:ring-1",
              isCompact ? "h-7 text-xs" : "h-8 text-sm"
            )}
            placeholder="搜索知识库文档（标题 / 路径 / 标签）..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      )}

      {/* Tag filter pills (if any tags found) */}
      {allTags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar shrink-0">
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6875rem] font-medium transition-colors",
              selectedTag === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80 text-muted-foreground"
            )}
          >
            全部
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={cn(
                "inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[0.6875rem] font-medium transition-colors",
                selectedTag === tag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              )}
            >
              <Tag className="size-2.5" />
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Grouped Tree List */}
      <div
        className={cn(
          "rounded-md border bg-card overflow-y-auto min-h-0 flex-1 divide-y divide-border/40",
          filteredOptions.length === 0 && "p-4 text-center"
        )}
      >
        {filteredOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyMsg}</p>
        ) : (
          categoryKeys.map((catKey) => {
            const items = groupedByCategory[catKey]
            const isCollapsed = collapsedCategories.has(catKey)
            const catLabel = DOC_TYPE_LABELS[catKey] || catKey
            const checkedCount = items.filter((it) => checked.has(it.id)).length
            const isAllChecked = checkedCount === items.length && items.length > 0

            return (
              <div key={catKey} className="group/cat">
                {/* Category Header */}
                <div
                  onClick={() => toggleCategory(catKey)}
                  className="flex items-center justify-between px-2.5 py-1.5 bg-muted/40 hover:bg-muted/60 cursor-pointer select-none text-xs font-medium text-foreground transition-colors"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
                    )}
                    {isCollapsed ? (
                      <Folder className="size-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <FolderOpen className="size-3.5 text-amber-500 shrink-0" />
                    )}
                    <span className="truncate font-medium">{catLabel}</span>
                    <span className="text-[0.6875rem] text-muted-foreground font-normal">
                      ({checkedCount}/{items.length})
                    </span>
                  </div>

                  {/* Batch Select Button */}
                  <button
                    type="button"
                    onClick={(e) => toggleAllInCategory(items, e)}
                    className="text-[0.6875rem] text-muted-foreground hover:text-primary transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
                  >
                    {isAllChecked ? "取消全选" : "全选"}
                  </button>
                </div>

                {/* Category Items */}
                {!isCollapsed && (
                  <div className="p-1 space-y-0.5 bg-background/50">
                    {items.map((option) => {
                      const isItemChecked = checked.has(option.id)
                      const relPath = getRelativeDocPath(option.docPath)
                      return (
                        <label
                          key={option.id}
                          className={cn(
                            "flex cursor-pointer items-start rounded-md border border-transparent p-1.5 transition-colors gap-2 hover:bg-accent/40",
                            isItemChecked && "bg-primary/5 border-primary/20"
                          )}
                        >
                          <Checkbox
                            checked={isItemChecked}
                            onCheckedChange={(val) => onToggle(option.id, val === true)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <FileText className="size-3.5 text-sky-500 shrink-0" />
                              <span className="block truncate font-medium text-xs text-foreground">
                                {option.label}
                              </span>
                            </div>
                            {option.description && (
                              <p className="mt-0.5 line-clamp-2 text-[0.6875rem] text-muted-foreground leading-snug">
                                {option.description}
                              </p>
                            )}
                            {relPath && (
                              <span className="mt-0.5 block truncate text-[0.625rem] text-muted-foreground/70 font-mono">
                                {relPath}
                              </span>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
