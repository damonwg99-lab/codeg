import type { KnowledgeDocInfo } from "@/lib/platform/types"
import { KB_SKIP_FILENAMES } from "@/lib/platform/types"
import type { SuggestionItem } from "@/components/chat/composer/suggestion/types"
import type { ReferenceAttrs } from "@/components/chat/composer/types"

/** Check whether a KB doc should be skipped from suggestions (metadata files) */
export function isSkippedKbDoc(doc: KnowledgeDocInfo): boolean {
  const filename = doc.filePath.replace(/\\/g, "/").split("/").pop() ?? ""
  return KB_SKIP_FILENAMES.has(filename)
}

/**
 * Parse tags from tagsJson safely.
 */
export function parseDocTags(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return []
  try {
    const parsed = JSON.parse(tagsJson)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Convert a KnowledgeDocInfo into a ReferenceAttrs representation.
 * Compatible with the platform context injection system (refType: "context").
 */
export function kbDocToReferenceAttrs(
  doc: KnowledgeDocInfo,
  kbDirPrefix: string = "_knowledge"
): ReferenceAttrs {
  const normFilePath = doc.filePath.replace(/\\/g, "/")
  const fullPath = kbDirPrefix ? `${kbDirPrefix}/${normFilePath}` : normFilePath

  return {
    refType: "context",
    id: `kbDoc:${doc.id}`,
    label: doc.title,
    uri: null,
    meta: {
      injectGroup: "kb_docs",
      injectPrefix: `Knowledge doc: ${doc.title} (${fullPath})`,
      injectDocPath: fullPath,
      injectDocId: doc.id,
      category: doc.docType,
      message: doc.description ?? undefined,
    },
  }
}

/**
 * Knowledge base doc -> SuggestionItem for the composer's `@` panel.
 */
export function kbDocToSuggestion(
  doc: KnowledgeDocInfo,
  kbDirPrefix: string = "_knowledge"
): SuggestionItem {
  const tags = parseDocTags(doc.tagsJson)
  const normFilePath = doc.filePath.replace(/\\/g, "/")
  const tagString = tags.length > 0 ? tags.map((t) => `#${t}`).join(" ") : ""
  const keywords = `${doc.title} ${normFilePath} ${doc.description ?? ""} ${tagString} ${doc.docType} kb`

  // Detail display string: show relative path + optional tag summary
  const tagDisplay = tags.length > 0 ? ` [${tags.join(", ")}]` : ""
  const detail = `${normFilePath}${tagDisplay}`

  return {
    reference: kbDocToReferenceAttrs(doc, kbDirPrefix),
    detail,
    keywords,
  }
}

/**
 * Pure matcher: check whether a KB doc matches the user's query string.
 * Supports matching on title, path, tags, and description.
 */
export function matchesKbDoc(
  doc: KnowledgeDocInfo,
  lowerQuery: string
): boolean {
  if (!lowerQuery) return true
  if (doc.title.toLowerCase().includes(lowerQuery)) return true
  if (doc.filePath.toLowerCase().includes(lowerQuery)) return true
  if (doc.description && doc.description.toLowerCase().includes(lowerQuery))
    return true
  if (doc.docType.toLowerCase().includes(lowerQuery)) return true
  if (doc.tagsJson && doc.tagsJson.toLowerCase().includes(lowerQuery))
    return true
  return false
}
