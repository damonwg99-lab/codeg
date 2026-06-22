# DevPlatform 集成方案 — Phase 1 实施计划

## 架构决策摘要

| 决策项 | 选择 |
|--------|------|
| 适配方案 | Plan A：增量扩展现有架构 |
| Project 与 Folder | Project 包含 Folder（一个项目可有多个 workspace/folder） |
| Task 与 Conversation | 一对多关系，通过 `task_agent` 关联 |
| Folder 独立性 | Folder 保持独立，Project 为可选上层组织 |
| 项目根目录 | Project 有 root_directory，扫描子目录中所有 git 仓库作为 Folder |
| CI/CD & 禅道 | Phase 1 预留数据模型和 API 接口，不做 UI |
| UI 风格 | 适配 CodeG 现有 shadcn/ui + Tailwind 风格 |
| 运行模式 | Phase 1 仅支持 Desktop 模式 |

---

## 参考资料

- Paseo DevPlatform 设计文档：`D:\Work\Study\AI\PROJECTS\paseo\project-knowledge\design\dev-platform-design.md`
- CodeG AGENTS.md：`D:\Work\Study\AI\PROJECTS\CodeG\AGENTS.md`

---

## Phase 1 数据模型（5 个新表 + 1 个新列）

### 1. `project` 表

```rust
// src-tauri/src/db/entities/project.rs
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "project")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,                          // 项目名称
    pub description: Option<String>,            // 项目描述
    pub root_directory: String,                 // 根目录路径（唯一）
    #[sea_orm(unique)]
    pub default_agent_type: Option<String>,     // 默认 agent
    pub color: Option<String>,                  // UI 颜色
    pub sort_order: i32,                        // 排序
    pub archived_at: Option<DateTimeUtc>,       // 归档时间（软删除）
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}
```

**关系：** `has_many Folder`（通过 `folder.project_id`）

### 2. `task` 表

```rust
// src-tauri/src/db/entities/task.rs
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "task")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub project_id: i32,                        // FK -> project.id
    pub folder_id: Option<i32>,                 // FK -> folder.id（可选，关联具体工作区）
    pub title: String,
    pub description: Option<String>,
    pub task_type: String,                      // requirement/design/development/bug/testing/documentation/deployment
    pub priority: i32,                          // 0=urgent, 1=high, 2=medium, 3=low
    pub status: String,                         // todo/in_progress/review/done/blocked/merge_conflict/archived
    pub branch_name: Option<String>,            // Git 分支名
    pub parent_task_id: Option<i32>,            // 自引用父任务
    pub sort_order: i32,
    pub archived_at: Option<DateTimeUtc>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    // Phase 1 预留字段
    pub zentao_task_id: Option<i32>,            // 禅道任务 ID（预留）
    pub sync_to_zentao: bool,                   // 是否同步到禅道（预留）
    pub deployment_status: Option<String>,      // 部署状态（预留）
    pub build_status: Option<String>,           // 构建状态（预留）
}
```

**关系：** `belongs_to Project`，`belongs_to Folder`，`has_many TaskAgent`

### 3. `task_agent` 表

```rust
// src-tauri/src/db/entities/task_agent.rs
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "task_agent")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub task_id: i32,                           // FK -> task.id
    pub conversation_id: Option<i32>,           // FK -> conversation.id（可选，关联对话）
    pub agent_type: String,                     // claude_code/codex/open_code/gemini/open_claw/cline/hermes
    pub is_active: bool,                        // 是否为当前活跃 agent
    pub status: String,                         // idle/running/completed/failed
    pub branch_name: Option<String>,            // agent 工作的分支
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}
```

**关系：** `belongs_to Task`，`belongs_to Conversation`

### 4. `project_git_repo` 表

```rust
// src-tauri/src/db/entities/project_git_repo.rs
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "project_git_repo")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub project_id: i32,                        // FK -> project.id
    pub folder_id: Option<i32>,                 // FK -> folder.id（关联到 workspace folder）
    pub path: String,                           // git 仓库相对路径
    pub name: String,                           // 显示名称
    pub remote_url: Option<String>,             // 远程仓库 URL
    pub last_scanned_at: Option<DateTimeUtc>,   // 上次扫描时间
    pub created_at: DateTimeUtc,
}
```

**关系：** `belongs_to Project`，`belongs_to Folder`

### 5. `task_dependency` 表

```rust
// src-tauri/src/db/entities/task_dependency.rs
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "task_dependency")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub task_id: i32,                           // FK -> task.id
    pub depends_on_task_id: i32,                // FK -> task.id（被依赖的任务）
    pub created_at: DateTimeUtc,
}
```

**关系：** `belongs_to Task`（双向）

### 6. `folder.project_id` 新增列

```rust
// 在 folder entity 中添加
pub project_id: Option<i32>,  // FK -> project.id
```

---

## Phase 1 迁移文件

**文件：** `src-tauri/src/db/migration/m20260619_000001_dev_platform.rs`

```rust
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 1. project 表
        manager.create_table(
            Table::create()
                .table(Project::Table)
                .col(ColumnDef::new(Project::Id).integer().not_null().auto_increment().primary_key())
                .col(ColumnDef::new(Project::Name).string().not_null())
                .col(ColumnDef::new(Project::Description).text().null())
                .col(ColumnDef::new(Project::RootDirectory).string().not_null())
                .col(ColumnDef::new(Project::DefaultAgentType).string().null())
                .col(ColumnDef::new(Project::Color).string().null())
                .col(ColumnDef::new(Project::SortOrder).integer().not_null().default(0))
                .col(ColumnDef::new(Project::ArchivedAt).timestamp_time_zone().null())
                .col(ColumnDef::new(Project::CreatedAt).timestamp_time_zone().not_null())
                .col(ColumnDef::new(Project::UpdatedAt).timestamp_time_zone().not_null())
                .to_owned(),
        ).await?;

        // 2. task 表
        manager.create_table(
            Table::create()
                .table(Task::Table)
                .col(ColumnDef::new(Task::Id).integer().not_null().auto_increment().primary_key())
                .col(ColumnDef::new(Task::ProjectId).integer().not_null())
                .col(ColumnDef::new(Task::FolderId).integer().null())
                .col(ColumnDef::new(Task::Title).string().not_null())
                .col(ColumnDef::new(Task::Description).text().null())
                .col(ColumnDef::new(Task::TaskType).string().not_null())
                .col(ColumnDef::new(Task::Priority).integer().not_null().default(2))
                .col(ColumnDef::new(Task::Status).string().not_null().default("todo"))
                .col(ColumnDef::new(Task::BranchName).string().null())
                .col(ColumnDef::new(Task::ParentTaskId).integer().null())
                .col(ColumnDef::new(Task::SortOrder).integer().not_null().default(0))
                .col(ColumnDef::new(Task::ArchivedAt).timestamp_time_zone().null())
                .col(ColumnDef::new(Task::ZentaoTaskId).integer().null())
                .col(ColumnDef::new(Task::SyncToZentao).boolean().not_null().default(false))
                .col(ColumnDef::new(Task::DeploymentStatus).string().null())
                .col(ColumnDef::new(Task::BuildStatus).string().null())
                .col(ColumnDef::new(Task::CreatedAt).timestamp_time_zone().not_null())
                .col(ColumnDef::new(Task::UpdatedAt).timestamp_time_zone().not_null())
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_task_project")
                        .from(Task::Table, Task::ProjectId)
                        .to(Project::Table, Project::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_task_folder")
                        .from(Task::Table, Task::FolderId)
                        .to(Folder::Table, Folder::Id)
                        .on_delete(ForeignKeyAction::SetNull),
                )
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_task_parent")
                        .from(Task::Table, Task::ParentTaskId)
                        .to(Task::Table, Task::Id)
                        .on_delete(ForeignKeyAction::SetNull),
                )
                .to_owned(),
        ).await?;

        // 3. task_agent 表
        manager.create_table(
            Table::create()
                .table(TaskAgent::Table)
                .col(ColumnDef::new(TaskAgent::Id).integer().not_null().auto_increment().primary_key())
                .col(ColumnDef::new(TaskAgent::TaskId).integer().not_null())
                .col(ColumnDef::new(TaskAgent::ConversationId).integer().null())
                .col(ColumnDef::new(TaskAgent::AgentType).string().not_null())
                .col(ColumnDef::new(TaskAgent::IsActive).boolean().not_null().default(false))
                .col(ColumnDef::new(TaskAgent::Status).string().not_null().default("idle"))
                .col(ColumnDef::new(TaskAgent::BranchName).string().null())
                .col(ColumnDef::new(TaskAgent::CreatedAt).timestamp_time_zone().not_null())
                .col(ColumnDef::new(TaskAgent::UpdatedAt).timestamp_time_zone().not_null())
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_task_agent_task")
                        .from(TaskAgent::Table, TaskAgent::TaskId)
                        .to(Task::Table, Task::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_task_agent_conversation")
                        .from(TaskAgent::Table, TaskAgent::ConversationId)
                        .to(Conversation::Table, Conversation::Id)
                        .on_delete(ForeignKeyAction::SetNull),
                )
                .to_owned(),
        ).await?;

        // 4. project_git_repo 表
        manager.create_table(
            Table::create()
                .table(ProjectGitRepo::Table)
                .col(ColumnDef::new(ProjectGitRepo::Id).integer().not_null().auto_increment().primary_key())
                .col(ColumnDef::new(ProjectGitRepo::ProjectId).integer().not_null())
                .col(ColumnDef::new(ProjectGitRepo::FolderId).integer().null())
                .col(ColumnDef::new(ProjectGitRepo::Path).string().not_null())
                .col(ColumnDef::new(ProjectGitRepo::Name).string().not_null())
                .col(ColumnDef::new(ProjectGitRepo::RemoteUrl).string().null())
                .col(ColumnDef::new(ProjectGitRepo::LastScannedAt).timestamp_time_zone().null())
                .col(ColumnDef::new(ProjectGitRepo::CreatedAt).timestamp_time_zone().not_null())
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_git_repo_project")
                        .from(ProjectGitRepo::Table, ProjectGitRepo::ProjectId)
                        .to(Project::Table, Project::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_git_repo_folder")
                        .from(ProjectGitRepo::Table, ProjectGitRepo::FolderId)
                        .to(Folder::Table, Folder::Id)
                        .on_delete(ForeignKeyAction::SetNull),
                )
                .to_owned(),
        ).await?;

        // 5. task_dependency 表
        manager.create_table(
            Table::create()
                .table(TaskDependency::Table)
                .col(ColumnDef::new(TaskDependency::Id).integer().not_null().auto_increment().primary_key())
                .col(ColumnDef::new(TaskDependency::TaskId).integer().not_null())
                .col(ColumnDef::new(TaskDependency::DependsOnTaskId).integer().not_null())
                .col(ColumnDef::new(TaskDependency::CreatedAt).timestamp_time_zone().not_null())
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_dep_task")
                        .from(TaskDependency::Table, TaskDependency::TaskId)
                        .to(Task::Table, Task::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .foreign_key(
                    ForeignKey::create()
                        .name("fk_dep_depends_on")
                        .from(TaskDependency::Table, TaskDependency::DependsOnTaskId)
                        .to(Task::Table, Task::Id)
                        .on_delete(ForeignKeyAction::Cascade),
                )
                .index(Index::create().unique().col(TaskDependency::TaskId).col(TaskDependency::DependsOnTaskId))
                .to_owned(),
        ).await?;

        // 添加 folder.project_id 列
        manager.alter_table(
            Table::alter()
                .table(Folder::Table)
                .add_column(ColumnDef::new(Folder::ProjectId).integer().null())
                .add_foreign_key(
                    ForeignKey::create()
                        .name("fk_folder_project")
                        .from(Folder::Table, Folder::ProjectId)
                        .to(Project::Table, Project::Id)
                        .on_delete(ForeignKeyAction::SetNull),
                )
                .to_owned(),
        ).await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 按逆序删除
        manager.drop_table(Table::drop().table(TaskDependency::Table).to_owned()).await?;
        manager.drop_table(Table::drop().table(ProjectGitRepo::Table).to_owned()).await?;
        manager.drop_table(Table::drop().table(TaskAgent::Table).to_owned()).await?;
        manager.drop_table(Table::drop().table(Task::Table).to_owned()).await?;
        manager.drop_table(Table::drop().table(Project::Table).to_owned()).await?;

        // 移除 folder.project_id
        manager.alter_table(
            Table::alter()
                .table(Folder::Table)
                .drop_column(Folder::ProjectId)
                .to_owned(),
        ).await?;

        Ok(())
    }
}
```

---

## Phase 1 命令模块

### 新增文件清单

```
src-tauri/src/commands/
  mod.rs                     -- 添加 pub mod projects; pub mod tasks;
  projects.rs                -- 项目 CRUD（仅 desktop 模式）
  tasks.rs                   -- 任务 CRUD + task_agent 管理

src-tauri/src/db/
  entities/
    project.rs               -- SeaORM entity
    task.rs                  -- SeaORM entity
    task_agent.rs            -- SeaORM entity
    project_git_repo.rs      -- SeaORM entity
    task_dependency.rs       -- SeaORM entity
    mod.rs                   -- 添加新模块声明
  service/
    project_service.rs       -- 项目业务逻辑
    task_service.rs          -- 任务业务逻辑

src-tauri/src/models/
  project.rs                 -- 项目 DTO
  task.rs                    -- 任务 DTO
  mod.rs                     -- 添加新模块声明
```

### `commands/projects.rs` 关键接口

```rust
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_project(
    db: tauri::State<'_, AppDatabase>,
    name: String,
    root_directory: String,
    description: Option<String>,
    default_agent_type: Option<String>,
) -> Result<ProjectDetail, AppCommandError> {
    create_project_core(&db.conn, name, root_directory, description, default_agent_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_projects(
    db: tauri::State<'_, AppDatabase>,
    include_archived: Option<bool>,
) -> Result<Vec<ProjectSummary>, AppCommandError> {
    list_projects_core(&db.conn, include_archived.unwrap_or(false)).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_project(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
) -> Result<ProjectDetail, AppCommandError> {
    get_project_core(&db.conn, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_project(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
    name: Option<String>,
    description: Option<String>,
    default_agent_type: Option<String>,
    color: Option<String>,
) -> Result<ProjectDetail, AppCommandError> {
    update_project_core(&db.conn, project_id, name, description, default_agent_type, color).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_project(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
) -> Result<(), AppCommandError> {
    delete_project_core(&db.conn, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn scan_project_git_repos(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
) -> Result<Vec<ProjectGitRepoInfo>, AppCommandError> {
    scan_project_git_repos_core(&db.conn, project_id).await
}
```

### `commands/tasks.rs` 关键接口

```rust
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_task(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
    title: String,
    task_type: String,
    description: Option<String>,
    priority: Option<i32>,
    folder_id: Option<i32>,
    parent_task_id: Option<i32>,
    agent_types: Option<Vec<String>>,
) -> Result<TaskDetail, AppCommandError> {
    create_task_core(&db.conn, project_id, title, task_type, description, priority, folder_id, parent_task_id, agent_types).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_tasks(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
    status: Option<String>,
    task_type: Option<String>,
) -> Result<Vec<TaskSummary>, AppCommandError> {
    list_tasks_core(&db.conn, project_id, status, task_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_task(
    db: tauri::State<'_, AppDatabase>,
    task_id: i32,
) -> Result<TaskDetail, AppCommandError> {
    get_task_core(&db.conn, task_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_task_status(
    db: tauri::State<'_, AppDatabase>,
    task_id: i32,
    status: String,
) -> Result<TaskDetail, AppCommandError> {
    update_task_status_core(&db.conn, task_id, status).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn assign_agent_to_task(
    db: tauri::State<'_, AppDatabase>,
    task_id: i32,
    agent_type: String,
    conversation_id: Option<i32>,
) -> Result<TaskAgentInfo, AppCommandError> {
    assign_agent_to_task_core(&db.conn, task_id, agent_type, conversation_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn start_task_conversation(
    db: tauri::State<'_, AppDatabase>,
    task_id: i32,
    agent_type: String,
) -> Result<DbConversationSummary, AppCommandError> {
    // 自动创建 conversation 并关联到 task_agent
    start_task_conversation_core(&db.conn, task_id, agent_type).await
}
```

---

## Phase 1 前端

### 新增文件清单

```
src/lib/
  types.ts                  -- 添加新类型定义

src/lib/api.ts              -- 添加项目/任务 API 函数

src/contexts/
  project-context.tsx       -- 项目状态管理

src/components/
  projects/
    project-switcher.tsx    -- 侧边栏项目切换器
    project-settings.tsx    -- 项目设置页面
    project-sidebar.tsx     -- 项目任务列表
    task-card.tsx           -- 任务卡片
    task-kanban-view.tsx    -- 看板视图
    task-detail-panel.tsx   -- 任务详情面板
    task-create-dialog.tsx  -- 创建任务对话框
```

### TypeScript 类型定义

```typescript
// src/lib/types.ts 添加

export interface ProjectSummary {
  id: number
  name: string
  description: string | null
  root_directory: string
  default_agent_type: string | null
  color: string | null
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
  folder_count: number
  task_count: number
}

export interface ProjectDetail extends ProjectSummary {
  git_repos: ProjectGitRepoInfo[]
}

export interface ProjectGitRepoInfo {
  id: number
  project_id: number
  folder_id: number | null
  path: string
  name: string
  remote_url: string | null
  last_scanned_at: string | null
}

export interface TaskSummary {
  id: number
  project_id: number
  folder_id: number | null
  title: string
  description: string | null
  task_type: TaskType
  priority: TaskPriority
  status: TaskStatus
  branch_name: string | null
  parent_task_id: number | null
  sort_order: number
  agents: TaskAgentInfo[]
  created_at: string
  updated_at: string
}

export interface TaskDetail extends TaskSummary {
  dependencies: number[]  // depends_on task ids
  zentao_task_id: number | null
  sync_to_zentao: boolean
  deployment_status: string | null
  build_status: string | null
}

export interface TaskAgentInfo {
  id: number
  task_id: number
  conversation_id: number | null
  agent_type: AgentType
  is_active: boolean
  status: "idle" | "running" | "completed" | "failed"
  branch_name: string | null
}

export type TaskType = "requirement" | "design" | "development" | "bug" | "testing" | "documentation" | "deployment"
export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked" | "merge_conflict" | "archived"
export type TaskPriority = 0 | 1 | 2 | 3  // urgent/high/medium/low
```

### API 函数

```typescript
// src/lib/api.ts 添加

export async function createProject(params: {
  name: string
  root_directory: string
  description?: string | null
  default_agent_type?: string | null
}): Promise<ProjectDetail> {
  return getTransport().call("create_project", {
    name: params.name,
    rootDirectory: params.root_directory,
    description: params.description ?? null,
    defaultAgentType: params.default_agent_type ?? null,
  })
}

export async function listProjects(params?: {
  include_archived?: boolean | null
}): Promise<ProjectSummary[]> {
  return getTransport().call("list_projects", {
    includeArchived: params?.include_archived ?? false,
  })
}

export async function getProject(projectId: number): Promise<ProjectDetail> {
  return getTransport().call("get_project", { projectId })
}

export async function updateProject(params: {
  project_id: number
  name?: string | null
  description?: string | null
  default_agent_type?: string | null
  color?: string | null
}): Promise<ProjectDetail> {
  return getTransport().call("update_project", {
    projectId: params.project_id,
    name: params.name ?? null,
    description: params.description ?? null,
    defaultAgentType: params.default_agent_type ?? null,
    color: params.color ?? null,
  })
}

export async function deleteProject(projectId: number): Promise<void> {
  return getTransport().call("delete_project", { projectId })
}

export async function scanProjectGitRepos(projectId: number): Promise<ProjectGitRepoInfo[]> {
  return getTransport().call("scan_project_git_repos", { projectId })
}

export async function createTask(params: {
  project_id: number
  title: string
  task_type: TaskType
  description?: string | null
  priority?: number | null
  folder_id?: number | null
  parent_task_id?: number | null
  agent_types?: string[] | null
}): Promise<TaskDetail> {
  return getTransport().call("create_task", {
    projectId: params.project_id,
    title: params.title,
    taskType: params.task_type,
    description: params.description ?? null,
    priority: params.priority ?? null,
    folderId: params.folder_id ?? null,
    parentTaskId: params.parent_task_id ?? null,
    agentTypes: params.agent_types ?? null,
  })
}

export async function listTasks(params: {
  project_id: number
  status?: string | null
  task_type?: string | null
}): Promise<TaskSummary[]> {
  return getTransport().call("list_tasks", {
    projectId: params.project_id,
    status: params.status ?? null,
    taskType: params.task_type ?? null,
  })
}

export async function getTask(taskId: number): Promise<TaskDetail> {
  return getTransport().call("get_task", { taskId })
}

export async function updateTaskStatus(taskId: number, status: string): Promise<TaskDetail> {
  return getTransport().call("update_task_status", { taskId, status })
}

export async function assignAgentToTask(params: {
  task_id: number
  agent_type: string
  conversation_id?: number | null
}): Promise<TaskAgentInfo> {
  return getTransport().call("assign_agent_to_task", {
    taskId: params.task_id,
    agentType: params.agent_type,
    conversationId: params.conversation_id ?? null,
  })
}

export async function startTaskConversation(params: {
  task_id: number
  agent_type: string
}): Promise<DbConversationSummary> {
  return getTransport().call("start_task_conversation", {
    taskId: params.task_id,
    agentType: params.agent_type,
  })
}
```

---

## Phase 1 UI 适配

### 侧边栏项目切换器

在现有侧边栏顶部（`SidebarHeader` 区域）添加项目切换器：

```
┌─────────────────────────────────────┐
│ [📁 Project ▾]  [🔍] [⚙] [+]     │  ← 项目切换器 + 操作按钮
├─────────────────────────────────────┤
│ 📌 Pinned                          │
│   conversation-1                    │
│   conversation-2                    │
├─────────────────────────────────────┤
│ 📂 Folders                          │
│   ▼ My Project                      │
│     conversation-3                  │
│     conversation-4                  │
│   ▶ Another Project                 │
├─────────────────────────────────────┤
│ 💬 Chats                           │
│   chat-1                            │
└─────────────────────────────────────┘
```

### 看板视图

使用现有的 `Card`、`Badge`、`Button` 组件构建看板：

```
┌──────────┬──────────┬──────────┬──────────┐
│  Todo    │ In Progress│ Review  │  Done    │
├──────────┼──────────┼──────────┼──────────┤
│ ┌──────┐ │ ┌──────┐ │          │ ┌──────┐ │
│ │Task 1│ │ │Task 2│ │          │ │Task 4│ │
│ │ 🔴   │ │ │ 🟡   │ │          │ │ 🟢   │ │
│ └──────┘ │ └──────┘ │          │ └──────┘ │
│ ┌──────┐ │          │          │          │
│ │Task 3│ │          │          │          │
│ │ 🟢   │ │          │          │          │
│ └──────┘ │          │          │          │
└──────────┴──────────┴──────────┴──────────┘
```

### 任务详情面板

使用现有 `Sheet` 或右侧辅助面板展示任务详情：

```
┌─────────────────────────────────────┐
│ Task: Implement Auth     [Edit] [×] │
├─────────────────────────────────────┤
│ Type: Development  Priority: High   │
│ Status: In Progress                 │
│ Branch: feature/auth                │
├─────────────────────────────────────┤
│ Agents:                             │
│   🤖 Claude Code  ● Running         │
│   🤖 Codex        ○ Idle            │
│   [+ Assign Agent]                  │
├─────────────────────────────────────┤
│ Description:                        │
│ Implement JWT authentication...     │
├─────────────────────────────────────┤
│ Dependencies:                       │
│   → Design Auth Flow (Done)         │
│   → Setup DB Schema (In Progress)   │
└─────────────────────────────────────┘
```

---

## 实施顺序

### Step 1: 数据层（后端）
1. 创建 5 个 SeaORM entity 文件
2. 创建迁移文件 `m20260619_000001_dev_platform.rs`
3. 在 `db/entities/mod.rs` 和 `db/migration/mod.rs` 中注册
4. 创建 `db/service/project_service.rs` 和 `db/service/task_service.rs`
5. 在 `models/` 中添加 `project.rs` 和 `task.rs`

### Step 2: 命令层（后端）
1. 创建 `commands/projects.rs`（仅 desktop 模式）
2. 创建 `commands/tasks.rs`（仅 desktop 模式）
3. 在 `commands/mod.rs` 中添加模块声明
4. 在 `lib.rs` 的 `invoke_handler` 中注册新命令

### Step 3: API 层（前端）
1. 在 `src/lib/types.ts` 中添加新类型
2. 在 `src/lib/api.ts` 中添加新 API 函数

### Step 4: UI 层（前端）
1. 创建 `src/contexts/project-context.tsx`
2. 创建 `src/components/projects/` 目录下的组件
3. 修改侧边栏添加项目切换器
4. 添加看板视图入口（作为新的 workspace 视图模式）

### Step 5: 集成测试
1. 验证 migration 正确执行
2. 验证 CRUD 操作正常
3. 验证 UI 交互流畅
4. 验证与现有 Folder/Conversation 功能无冲突

---

## 注意事项

1. **向后兼容**：`folder.project_id` 为 nullable，现有 Folder 不受影响
2. **Desktop 仅**：所有新命令都用 `#[cfg(feature = "tauri-runtime")]` 门控
3. **命名规范**：命令用 snake_case，前端调用用 camelCase（Tauri 自动转换）
4. **错误处理**：使用现有 `AppCommandError` 模式
5. **预留字段**：`zentao_task_id`、`sync_to_zentao`、`deployment_status`、`build_status` 在 Phase 1 仅为数据列，不做 UI
