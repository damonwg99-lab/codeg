/**
 * Shared utilities for context inject panels (Dialog and Popover variants).
 * Extracted from context-inject-panel.tsx so both components can reuse
 * the same option-building and payload-construction logic.
 */

import type {
  KnowledgeDocInfo,
  TaskConversationInfo,
  TaskInfo,
} from "@/lib/platform/types"
import { KB_SKIP_FILENAMES } from "@/lib/platform/types"
import type { ReferenceAttrs } from "@/components/chat/composer/types"

/** Check whether a KB doc's filePath ends with a filename that should be skipped
 *  (e.g. README.md, .gitignore). These files are project-level metadata, not
 *  meaningful knowledge docs. */
function isSkippedKbDoc(doc: KnowledgeDocInfo): boolean {
  const filename = doc.filePath.replace(/\\/g, "/").split("/").pop() ?? ""
  return KB_SKIP_FILENAMES.has(filename)
}

/** Known task types that have i18n labels under Platform.inject.taskTypeLabel. */
const KNOWN_TASK_TYPES = ["bug", "feature", "task", "improvement"] as const

/** Known task statuses that have i18n labels under Platform.inject.taskStatusLabel. */
const KNOWN_TASK_STATUSES = [
  "backlog",
  "confirmed",
  "in_progress",
  "done",
  "released",
] as const

/**
 * Resolve a task type to its localized label.
 * next-intl requires static keys at compile time; dynamic template keys fail type check.
 * This helper does an explicit key lookup with a raw-value fallback.
 */
export function resolveTaskTypeLabel(
  taskType: string,
  t?: InjectI18nFn
): string {
  if (
    KNOWN_TASK_TYPES.includes(taskType as (typeof KNOWN_TASK_TYPES)[number])
  ) {
    return t?.(`taskTypeLabel.${taskType}`) ?? taskType
  }
  return taskType
}

/**
 * Resolve a task status to its localized label.
 * next-intl requires static keys at compile time; dynamic template keys fail type check.
 * This helper does an explicit key lookup with a raw-value fallback.
 */
export function resolveTaskStatusLabel(
  status: string,
  t?: InjectI18nFn
): string {
  if (
    KNOWN_TASK_STATUSES.includes(status as (typeof KNOWN_TASK_STATUSES)[number])
  ) {
    return t?.(`taskStatusLabel.${status}`) ?? status
  }
  return status
}

/** Known conversation roles that have i18n labels under Platform.task.conversationRoleLabels. */
const KNOWN_CONVERSATION_ROLES = [
  "implementation",
  "test",
  "review",
  "analysis",
  "discussion",
] as const

/**
 * Resolve a conversation role to its localized label.
 * next-intl requires static keys at compile time; dynamic template keys fail type check.
 * This helper does an explicit key lookup with a raw-value fallback.
 * `t` is a function resolving keys under `Platform.task.*` namespace.
 */
export function resolveConversationRoleLabel(
  role: string,
  t?: InjectI18nFn
): string {
  if (
    KNOWN_CONVERSATION_ROLES.includes(
      role as (typeof KNOWN_CONVERSATION_ROLES)[number]
    )
  ) {
    return t?.(`task.conversationRoleLabels.${role}`) ?? role
  }
  return role
}

export type OptionId =
  | "taskDescription"
  | `conversation:${number}`
  | `kbDoc:${number}`
  | `attachment:${number}`

export type InjectOptionGroup =
  | "basic"
  | "conversations"
  | "kb_docs"
  | "attachments"

export interface InjectOption {
  id: OptionId
  label: string
  description: string
  defaultChecked: boolean
  group: InjectOptionGroup
  docPath?: string
  prefixLine?: string
  /** KB doc ID — for kb_docs and attachment options. */
  kbDocId?: number
}

export interface ContextInjectPayload {
  /** Selected options (each becomes a context badge in the editor). */
  options: InjectOption[]
  /** JSON string of [{type, docId, path, label}] for KB docs and attachments
   *  (consumed by createConversationForTask backend API). */
  injectedDocsJson: string
}

/**
 * Translation resolver for inject option labels and descriptions.
 * Components pass their `useTranslations("Platform.inject")` function.
 */
export type InjectI18nFn = (
  key: string,
  params?: Record<string, unknown>
) => string

/**
 * Convert an InjectOption to a ReferenceAttrs for insertion as a context badge
 * in the TipTap composer. Each option becomes an inline `refType: "context"` atom.
 */
export function optionToReferenceAttrs(option: InjectOption): ReferenceAttrs {
  return {
    refType: "context",
    id: String(option.id),
    label: option.label,
    uri: null,
    meta: {
      injectGroup: option.group,
      injectPrefix: option.prefixLine ?? undefined,
      injectDocPath: option.docPath ?? undefined,
      injectDocId: option.kbDocId ?? undefined,
    },
  }
}

/**
 * Build task-related options (description only).
 * Only used when a task is linked.
 * `t` is the `useTranslations("Platform.inject")` function for i18n labels.
 */
export function buildTaskOptions(
  task: TaskInfo,
  t?: InjectI18nFn
): InjectOption[] {
  return [
    {
      id: "taskDescription",
      label: task.title,
      description:
        t?.("optionDesc.taskDescription") ??
        "Include the task title and description inline.",
      defaultChecked: true,
      group: "basic",
      prefixLine: `Task: ${task.title}${task.description ? `\nDescription: ${task.description}` : ""}`,
    },
  ]
}

/**
 * Build project resource options (KB docs, attachments, conversations).
 * Task is not required — this works for any mode.
 * `kbDirPrefix` is the KB directory path relative to the project root
 * (e.g., "_knowledge"). When provided, doc filePaths (which are stored
 * relative to the KB dir root) are prefixed to produce project-root-relative
 * paths the agent can actually read from the filesystem.
 * `t` is the `useTranslations("Platform.inject")` function for i18n labels.
 */
export function buildProjectOptions(
  kbDocs: KnowledgeDocInfo[],
  attachments: KnowledgeDocInfo[],
  conversations: TaskConversationInfo[] = [],
  t?: InjectI18nFn,
  kbDirPrefix?: string
): InjectOption[] {
  const next: InjectOption[] = []

  for (const conversation of conversations) {
    if (!conversation.summary) continue
    next.push({
      id: `conversation:${conversation.id}`,
      label:
        t?.("optionLabel.conversation", { id: conversation.conversationId }) ??
        `Conversation #${conversation.conversationId}`,
      description: conversation.summary,
      defaultChecked: false,
      group: "conversations",
      prefixLine: `Previous conversation summary: ${conversation.summary}`,
    })
  }

  // ─── Knowledge docs ───
  for (const doc of kbDocs) {
    if (isSkippedKbDoc(doc)) continue
    // filePath is relative to _knowledge dir; prepend kbDirPrefix to make
    // it relative to the project root so the agent can read the file.
    const normFilePath = doc.filePath.replace(/\\/g, "/")
    const fullPath = kbDirPrefix
      ? `${kbDirPrefix}/${normFilePath}`
      : normFilePath
    next.push({
      id: `kbDoc:${doc.id}`,
      label: doc.title,
      description:
        doc.description ??
        t?.("optionLabel.knowledgeDocFallback") ??
        "Knowledge doc",
      defaultChecked: false,
      group: "kb_docs",
      docPath: fullPath,
      kbDocId: doc.id,
      prefixLine: `Knowledge doc: ${doc.title} (${fullPath})`,
    })
  }

  // ─── Task attachments ───
  for (const doc of attachments) {
    const normFilePath = doc.filePath.replace(/\\/g, "/")
    const fullPath = kbDirPrefix
      ? `${kbDirPrefix}/${normFilePath}`
      : normFilePath
    next.push({
      id: `attachment:${doc.id}`,
      label: doc.title,
      description:
        doc.description ??
        t?.("optionLabel.taskAttachmentFallback") ??
        "Task attachment",
      defaultChecked: true,
      group: "attachments",
      docPath: fullPath,
      kbDocId: doc.id,
      prefixLine: `Task attachment: ${doc.title} (${fullPath})`,
    })
  }

  return next
}

/**
 * Build the full list of inject options for a linked task + project resources.
 * Convenience function that combines buildTaskOptions + buildProjectOptions.
 */
export function buildInjectOptions(
  task: TaskInfo,
  kbDocs: KnowledgeDocInfo[],
  attachments: KnowledgeDocInfo[],
  conversations: TaskConversationInfo[] = [],
  t?: InjectI18nFn,
  kbDirPrefix?: string
): InjectOption[] {
  return [
    ...buildTaskOptions(task, t),
    ...buildProjectOptions(kbDocs, attachments, conversations, t, kbDirPrefix),
  ]
}

/**
 * Construct the ContextInjectPayload from selected options.
 * Produces injectedDocsJson entries with differentiated types:
 * - "kb_doc" for knowledge base documents
 * - "attachment" for task attachments
 */
export function buildPayloadFromOptions(
  options: InjectOption[],
  checked: Set<OptionId>
): ContextInjectPayload {
  const selected = options.filter((option) => checked.has(option.id))

  // Build injectedDocsJson entries differentiated by group
  const docs: Array<Record<string, unknown>> = []

  for (const option of selected) {
    if (option.group === "kb_docs" && option.docPath) {
      docs.push({
        type: "kb_doc",
        docId: option.kbDocId,
        path: option.docPath,
        label: option.label,
      })
    } else if (option.group === "attachments" && option.docPath) {
      docs.push({
        type: "attachment",
        docId: option.kbDocId,
        path: option.docPath,
        label: option.label,
      })
    }
  }

  return {
    options: selected,
    injectedDocsJson: JSON.stringify(docs),
  }
}
