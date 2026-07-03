// Platform TypeScript types — mirrors Rust models from
// src-tauri/src/models/platform_project.rs, platform_task.rs, platform_config.rs
// Rust serde uses rename_all = "camelCase", so JSON fields are camelCase.
import type { AgentType } from "@/lib/types"

// ─── Project ───

export interface ProjectInfo {
  id: number
  name: string
  description: string | null
  clientName: string | null
  status: string
  rootDir: string
  folderId: number | null
  zentaoProjectId: number | null
  zentaoProductId: number | null
  jenkinsUrl: string | null
  kbRepoUrl: string | null
  kbLocalDir: string | null
  defaultAgentType: string | null
  delegationConfig: string | null
  agentConfigJson: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectDetail {
  project: ProjectInfo
  repos: ProjectRepoInfo[]
  taskCountByStatus: TaskCountByStatus
}

export interface TaskCountByStatus {
  backlog: number
  confirmed: number
  inProgress: number
  done: number
  released: number
}

export interface ProjectRepoInfo {
  id: number
  projectId: number
  name: string
  gitUrl: string
  localDir: string
  branch: string | null
  hasClaudeMd: boolean
  folderId: number | null
  createdAt: string
  updatedAt: string
}

export interface GitRepoScanResult {
  name: string
  localDir: string
  gitUrl: string | null
  hasClaudeMd: boolean
}

// ─── Task ───

export type TaskStatus =
  | "backlog"
  | "confirmed"
  | "in_progress"
  | "done"
  | "released"

export type TaskPriority = "low" | "medium" | "high" | "urgent"

export const TASK_STATUS_LIST: TaskStatus[] = [
  "backlog",
  "confirmed",
  "in_progress",
  "done",
  "released",
]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  confirmed: "Confirmed",
  in_progress: "In Progress",
  done: "Done",
  released: "Released",
}

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  backlog: "bg-muted text-muted-foreground",
  confirmed: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  in_progress:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  released:
    "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
}

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
}

/** Filenames to exclude from KB display and context injection.
 *  These are project-level metadata or VCS config that don't belong as KB docs.
 *  The backend scanner already skips these; this filter ensures they are also
 *  excluded from any stale DB rows that might still exist. */
export const KB_SKIP_FILENAMES: ReadonlySet<string> = new Set([
  "README.md",
  ".gitignore",
])

export interface TaskInfo {
  id: number
  projectId: number
  parentTaskId: number | null
  title: string
  description: string | null
  taskType: string
  status: TaskStatus | string
  priority: TaskPriority | string | null
  assignee: string | null
  zentaoId: number | null
  zentaoType: string | null
  zentaoSyncStatus: string | null
  deadline: string | null
  estimatedHours: number | null
  consumedHours: number | null
  zentaoModule: string | null
  kbRefsJson: string | null
  affectedReposJson: string | null
  delegationConfig: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskDetail {
  task: TaskInfo
  conversations: TaskConversationInfo[]
  subTasks: TaskInfo[]
  attachments: KnowledgeDocInfo[]
}

export interface TaskConversationInfo {
  id: number
  taskId: number
  conversationId: number
  conversationRole: string
  summary: string | null
  injectedDocsJson: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskConversationLaunchInfo {
  conversationId: number
  folderId: number
  agentType: AgentType
  title: string
  link: TaskConversationInfo
}

export interface TaskTypeMappingInfo {
  id: number
  localType: string
  zentaoType: string
  zentaoModule: string | null
  projectId: number | null
  createdAt: string
  updatedAt: string
}

export interface TaskDecompositionInfo {
  id: number
  sourceTaskId: number
  aiGenerated: boolean
  decompositionJson: string | null
  createdAt: string
}

// ─── Config ───

export interface GlobalConfigInfo {
  id: number
  configType: string
  configJson: string
  createdAt: string
  updatedAt: string
}

export interface CredentialInfo {
  id: number
  projectId: number | null
  credentialType: string
  credentialKey: string
  createdAt: string
  updatedAt: string
}

// ─── Knowledge Base ───

export type KbDocType =
  | "tech_doc"
  | "template"
  | "skill"
  | "requirement"
  | "ai_intermediate"
  | "task_attachment"

export interface KnowledgeDocInfo {
  id: number
  projectId: number
  docType: KbDocType | string
  title: string
  filePath: string
  isShared: boolean
  tagsJson: string | null
  description: string | null
  skillName: string | null
  taskId: number | null
  lastScannedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ScanResultInfo {
  projectId: number
  scannedCount: number
  newCount: number
  updatedCount: number
  deletedCount: number
}

export interface SkillInfo {
  name: string
  description: string
  triggerTaskType: string | null
  inject: string[]
  agentHint: string | null
}

export interface KbInitResult {
  kbDir: string
  subDirs: string[]
  gitignoreCreated: boolean
  readmeCreated: boolean
}

/** KB doc type → directory mapping */
export const KB_DOC_TYPE_DIRS: Record<KbDocType, string> = {
  tech_doc: "docs",
  template: "templates",
  skill: "skills",
  requirement: "requirements",
  ai_intermediate: ".private/ai-intermediate",
  task_attachment: ".private/tasks",
}

/** KB doc type → display label (English fallback) */
export const KB_DOC_TYPE_LABELS: Record<KbDocType, string> = {
  tech_doc: "Tech Doc",
  template: "Template",
  skill: "Skill",
  requirement: "Requirement",
  ai_intermediate: "AI Intermediate",
  task_attachment: "Task Attachment",
}

/** KB doc type → i18n key for localized label resolution */
export const KB_DOC_TYPE_I18N_KEYS: Record<KbDocType, string> = {
  tech_doc: "kb.typeTechDoc",
  template: "kb.typeTemplate",
  skill: "kb.typeSkill",
  requirement: "kb.typeRequirement",
  ai_intermediate: "kb.typeAiIntermediate",
  task_attachment: "kb.typeTaskAttachment",
}
