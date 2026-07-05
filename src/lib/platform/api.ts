import { getTransport } from "@/lib/transport"
import { getCodegToken } from "@/lib/transport/web-auth"
import type {
  ProjectInfo,
  ProjectDetail,
  ProjectRepoInfo,
  GitRepoScanResult,
  TaskInfo,
  TaskDetail,
  TaskConversationInfo,
  TaskConversationLaunchInfo,
  TaskTypeMappingInfo,
  TaskDecompositionInfo,
  GlobalConfigInfo,
  CredentialInfo,
  KnowledgeDocInfo,
  ScanResultInfo,
  SkillInfo,
  KbInitResult,
  KbDocType,
} from "./types"

// ─── Project ───

export async function listProjects(): Promise<ProjectInfo[]> {
  return getTransport().call("list_projects", {})
}

export async function getProject(id: number): Promise<ProjectDetail> {
  return getTransport().call("get_project", { id })
}

export async function createProject(params: {
  name: string
  rootDir: string
  description?: string
  clientName?: string
  defaultAgentType?: string
}): Promise<ProjectInfo> {
  return getTransport().call("create_project", {
    name: params.name,
    rootDir: params.rootDir,
    description: params.description ?? null,
    clientName: params.clientName ?? null,
    defaultAgentType: params.defaultAgentType ?? null,
  })
}

export async function updateProject(params: {
  id: number
  name?: string
  description?: string
  clientName?: string
  status?: string
  folderId?: number | null
  zentaoProjectId?: number | null
  zentaoProductId?: number | null
  jenkinsUrl?: string | null
  kbRepoUrl?: string | null
  kbLocalDir?: string | null
  defaultAgentType?: string | null
  delegationConfig?: string | null
  agentConfigJson?: string | null
}): Promise<ProjectInfo> {
  return getTransport().call("update_project", {
    id: params.id,
    name: params.name ?? null,
    description: params.description ?? null,
    clientName: params.clientName ?? null,
    status: params.status ?? null,
    folderId: params.folderId ?? null,
    zentaoProjectId: params.zentaoProjectId ?? null,
    zentaoProductId: params.zentaoProductId ?? null,
    jenkinsUrl: params.jenkinsUrl ?? null,
    kbRepoUrl: params.kbRepoUrl ?? null,
    kbLocalDir: params.kbLocalDir ?? null,
    defaultAgentType: params.defaultAgentType ?? null,
    delegationConfig: params.delegationConfig ?? null,
    agentConfigJson: params.agentConfigJson ?? null,
  })
}

export async function deleteProject(id: number): Promise<void> {
  return getTransport().call("delete_project", { id })
}

// ─── Project Repo ───

export async function listProjectRepos(
  projectId: number
): Promise<ProjectRepoInfo[]> {
  return getTransport().call("list_project_repos", { projectId })
}

export async function addProjectRepo(params: {
  projectId: number
  name: string
  gitUrl: string
  localDir: string
  branch?: string
  hasClaudeMd: boolean
  folderId?: number | null
}): Promise<ProjectRepoInfo> {
  return getTransport().call("add_project_repo", {
    projectId: params.projectId,
    name: params.name,
    gitUrl: params.gitUrl,
    localDir: params.localDir,
    branch: params.branch ?? null,
    hasClaudeMd: params.hasClaudeMd,
    folderId: params.folderId ?? null,
  })
}

export async function removeProjectRepo(id: number): Promise<void> {
  return getTransport().call("remove_project_repo", { id })
}

// ─── Git Scan ───

export async function scanGitRepos(
  rootDir: string
): Promise<GitRepoScanResult[]> {
  return getTransport().call("scan_git_repos", { rootDir })
}

// ─── Task ───

export async function listTasks(projectId: number): Promise<TaskInfo[]> {
  return getTransport().call("list_tasks", { projectId })
}

export async function getTask(id: number): Promise<TaskDetail> {
  return getTransport().call("get_task", { id })
}

export async function createTask(params: {
  projectId: number
  title: string
  taskType: string
  description?: string
  priority?: string
  assignee?: string
  parentTaskId?: number | null
}): Promise<TaskInfo> {
  return getTransport().call("create_task", {
    projectId: params.projectId,
    title: params.title,
    taskType: params.taskType,
    description: params.description ?? null,
    priority: params.priority ?? null,
    assignee: params.assignee ?? null,
    parentTaskId: params.parentTaskId ?? null,
  })
}

export async function updateTask(params: {
  id: number
  title?: string
  description?: string
  taskType?: string
  status?: string
  priority?: string | null
  assignee?: string | null
  parentTaskId?: number | null
  zentaoId?: number | null
  zentaoType?: string | null
  zentaoSyncStatus?: string | null
  deadline?: string | null
  estimatedHours?: number | null
  consumedHours?: number | null
  zentaoModule?: string | null
  kbRefsJson?: string | null
  affectedReposJson?: string | null
  delegationConfig?: string | null
}): Promise<TaskInfo> {
  return getTransport().call("update_task", {
    id: params.id,
    title: params.title ?? null,
    description: params.description ?? null,
    taskType: params.taskType ?? null,
    status: params.status ?? null,
    priority: params.priority ?? null,
    assignee: params.assignee ?? null,
    parentTaskId: params.parentTaskId ?? null,
    zentaoId: params.zentaoId ?? null,
    zentaoType: params.zentaoType ?? null,
    zentaoSyncStatus: params.zentaoSyncStatus ?? null,
    deadline: params.deadline ?? null,
    estimatedHours: params.estimatedHours ?? null,
    consumedHours: params.consumedHours ?? null,
    zentaoModule: params.zentaoModule ?? null,
    kbRefsJson: params.kbRefsJson ?? null,
    affectedReposJson: params.affectedReposJson ?? null,
    delegationConfig: params.delegationConfig ?? null,
  })
}

export async function updateTaskStatus(
  id: number,
  status: string
): Promise<TaskInfo> {
  return getTransport().call("update_task_status", { id, status })
}

export async function deleteTask(id: number): Promise<void> {
  return getTransport().call("delete_task", { id })
}

// ─── Task Conversation ───

export async function linkConversation(params: {
  taskId: number
  conversationId: number
  role: string
}): Promise<TaskConversationInfo> {
  return getTransport().call("link_conversation", {
    taskId: params.taskId,
    conversationId: params.conversationId,
    role: params.role,
  })
}

export async function createConversationForTask(params: {
  taskId: number
  injectedDocsJson?: string | null
  agentType?: string | null
}): Promise<TaskConversationLaunchInfo> {
  return getTransport().call("create_conversation_for_task", {
    taskId: params.taskId,
    injectedDocsJson: params.injectedDocsJson ?? null,
    agentType: params.agentType ?? null,
  })
}

export async function unlinkConversation(params: {
  taskId: number
  conversationId: number
}): Promise<void> {
  return getTransport().call("unlink_conversation", {
    taskId: params.taskId,
    conversationId: params.conversationId,
  })
}

export async function listTaskConversations(
  taskId: number
): Promise<TaskConversationInfo[]> {
  return getTransport().call("list_task_conversations", { taskId })
}

export async function getTaskByConversation(
  conversationId: number
): Promise<TaskConversationInfo | null> {
  return getTransport().call("get_task_by_conversation", { conversationId })
}

// ─── Task Type Mapping ───

export async function listTaskTypeMappings(
  projectId?: number | null
): Promise<TaskTypeMappingInfo[]> {
  return getTransport().call("list_task_type_mappings", {
    projectId: projectId ?? null,
  })
}

export async function createTaskTypeMapping(params: {
  localType: string
  zentaoType: string
  zentaoModule?: string
  projectId?: number | null
}): Promise<TaskTypeMappingInfo> {
  return getTransport().call("create_task_type_mapping", {
    localType: params.localType,
    zentaoType: params.zentaoType,
    zentaoModule: params.zentaoModule ?? null,
    projectId: params.projectId ?? null,
  })
}

export async function updateTaskTypeMapping(params: {
  id: number
  localType?: string
  zentaoType?: string
  zentaoModule?: string | null
}): Promise<TaskTypeMappingInfo> {
  return getTransport().call("update_task_type_mapping", {
    id: params.id,
    localType: params.localType ?? null,
    zentaoType: params.zentaoType ?? null,
    zentaoModule: params.zentaoModule ?? null,
  })
}

export async function deleteTaskTypeMapping(id: number): Promise<void> {
  return getTransport().call("delete_task_type_mapping", { id })
}

// ─── Task Decomposition ───

export async function createDecomposition(params: {
  sourceTaskId: number
  aiGenerated: boolean
  decompositionJson?: string
}): Promise<TaskDecompositionInfo> {
  return getTransport().call("create_decomposition", {
    sourceTaskId: params.sourceTaskId,
    aiGenerated: params.aiGenerated,
    decompositionJson: params.decompositionJson ?? null,
  })
}

// ─── Global Config ───

export async function getGlobalConfig(
  configType: string
): Promise<GlobalConfigInfo | null> {
  return getTransport().call("get_global_config", { configType })
}

export async function setGlobalConfig(params: {
  configType: string
  configJson: string
}): Promise<GlobalConfigInfo> {
  return getTransport().call("set_global_config", {
    configType: params.configType,
    configJson: params.configJson,
  })
}

// ─── Credential ───

export async function saveCredential(params: {
  credentialType: string
  token: string
  projectId?: number | null
}): Promise<CredentialInfo> {
  return getTransport().call("save_credential", {
    credentialType: params.credentialType,
    token: params.token,
    projectId: params.projectId ?? null,
  })
}

export async function deleteCredential(id: number): Promise<void> {
  return getTransport().call("delete_credential", { id })
}

export async function checkCredentialExists(params: {
  credentialType: string
  projectId?: number | null
}): Promise<{ exists: boolean }> {
  return getTransport().call("check_credential_exists", {
    credentialType: params.credentialType,
    projectId: params.projectId ?? null,
  })
}

// ─── Knowledge Base ───

export async function scanKnowledgeRepo(
  projectId: number
): Promise<ScanResultInfo> {
  return getTransport().call("scan_knowledge_repo", { projectId })
}

export async function listKnowledgeDocs(params: {
  projectId: number
  docTypeFilter?: KbDocType | string
}): Promise<KnowledgeDocInfo[]> {
  return getTransport().call("list_knowledge_docs", {
    projectId: params.projectId,
    docTypeFilter: params.docTypeFilter ?? null,
  })
}

export async function searchKnowledgeDocs(params: {
  projectId: number
  query: string
}): Promise<KnowledgeDocInfo[]> {
  return getTransport().call("search_knowledge_docs", {
    projectId: params.projectId,
    query: params.query,
  })
}

export async function getKnowledgeDoc(id: number): Promise<KnowledgeDocInfo> {
  return getTransport().call("get_knowledge_doc", { id })
}

export async function updateKnowledgeDoc(params: {
  id: number
  docType?: string
  title?: string
  isShared?: boolean
  tagsJson?: string | null
  description?: string | null
  skillName?: string | null
  taskId?: number | null
}): Promise<KnowledgeDocInfo> {
  return getTransport().call("update_knowledge_doc", {
    id: params.id,
    docType: params.docType ?? null,
    title: params.title ?? null,
    isShared: params.isShared ?? null,
    tagsJson: params.tagsJson ?? null,
    description: params.description ?? null,
    skillName: params.skillName ?? null,
    taskId: params.taskId ?? null,
  })
}

export async function deleteKnowledgeDoc(id: number): Promise<void> {
  return getTransport().call("delete_knowledge_doc", { id })
}

export async function listSkills(projectId: number): Promise<SkillInfo[]> {
  return getTransport().call("list_skills", { projectId })
}

export async function initKnowledgeRepo(
  projectId: number
): Promise<KbInitResult> {
  return getTransport().call("init_knowledge_repo", { projectId })
}

export async function readKbDocContent(id: number): Promise<string> {
  return getTransport().call("read_kb_doc_content", { id })
}

// ─── KB Upload (multipart — web mode only, desktop uses Tauri invoke) ───

/**
 * Upload a document to the knowledge base via multipart form-data.
 * In desktop mode, use `uploadKbDocTauri` instead (Tauri invoke with bytes).
 */
export async function uploadKbDoc(params: {
  projectId: number
  targetDir: string
  file: File
}): Promise<KnowledgeDocInfo> {
  const transport = getTransport()

  if (transport.isDesktop()) {
    // Desktop: read file as bytes and use Tauri invoke
    const contentBytes = Array.from(
      new Uint8Array(await params.file.arrayBuffer())
    )
    return transport.call("upload_kb_doc", {
      projectId: params.projectId,
      targetDir: params.targetDir,
      filename: params.file.name,
      contentBytes,
    })
  }

  // Web/server: multipart upload
  const formData = new FormData()
  formData.append("project_id", String(params.projectId))
  formData.append("target_dir", params.targetDir)
  formData.append("file", params.file)

  const token = getUploadToken()
  const baseUrl = getUploadBaseUrl()
  const res = await fetch(`${baseUrl}/api/upload_kb_doc`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ message: `HTTP ${res.status}` }))
    throw error
  }
  return res.json()
}

/**
 * Upload a task attachment via multipart form-data.
 * In desktop mode, uses Tauri invoke with bytes.
 */
export async function uploadTaskAttachment(params: {
  projectId: number
  taskId: number
  file: File
}): Promise<KnowledgeDocInfo> {
  const transport = getTransport()

  if (transport.isDesktop()) {
    const contentBytes = Array.from(
      new Uint8Array(await params.file.arrayBuffer())
    )
    return transport.call("upload_task_attachment", {
      projectId: params.projectId,
      taskId: params.taskId,
      filename: params.file.name,
      contentBytes,
    })
  }

  // Web/server: multipart upload
  const formData = new FormData()
  formData.append("project_id", String(params.projectId))
  formData.append("task_id", String(params.taskId))
  formData.append("file", params.file)

  const token = getUploadToken()
  const baseUrl = getUploadBaseUrl()
  const res = await fetch(`${baseUrl}/api/upload_task_attachment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ message: `HTTP ${res.status}` }))
    throw error
  }
  return res.json()
}

// ─── Upload helpers (web mode multipart) ───

/** Get the auth token for multipart uploads (shared with main api.ts). */
function getUploadToken(): string {
  return getCodegToken()
}

/** Get the base URL for multipart uploads (same origin). */
function getUploadBaseUrl(): string {
  return window.location.origin
}
