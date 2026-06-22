// Platform TypeScript types — mirrors Rust models from
// src-tauri/src/models/platform_project.rs, platform_task.rs, platform_config.rs
// Rust serde uses rename_all = "camelCase", so JSON fields are camelCase.

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
