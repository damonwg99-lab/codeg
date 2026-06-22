# Phase 1a 详细实施规格

> 目标：DB迁移 + Entity + Service + Command + Model + Web Handler + 集成点注册
> 完成标准：`cargo check` + `cargo test --features test-utils` 通过

---

## 一、DB迁移

### 1.1 迁移文件

共3个迁移文件，使用`_platform_`独立编号空间：

| 文件 | 内容 |
|------|------|
| `m20260622_platform_000001_create_core_tables.rs` | platform_project + platform_project_repo + platform_task + platform_task_type_mapping + platform_task_conversation + platform_task_decomposition |
| `m20260622_platform_000002_create_config_tables.rs` | platform_global_config + platform_credential |
| `m20260622_platform_000003_create_activity_log.rs` | platform_activity_log（仅建表，Phase 2实现CRUD） |

### 1.2 表结构定义

#### platform_project

```sql
CREATE TABLE platform_project (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT,
  client_name   TEXT,
  status        TEXT NOT NULL DEFAULT 'planning',  -- planning/developing/delivered/maintaining
  root_dir      TEXT NOT NULL,
  folder_id     INTEGER,                            -- 关联CodeG Folder（虚拟项目Folder）
  zentao_project_id INTEGER,
  zentao_product_id INTEGER,
  jenkins_url   TEXT,
  kb_repo_url   TEXT,
  kb_local_dir  TEXT,
  default_agent_type TEXT,
  delegation_config TEXT,                            -- JSON, 项目级委托配置
  agent_config_json  TEXT,                           -- JSON, per-task-type agent绑定
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  deleted_at    TIMESTAMP WITH TIME ZONE            -- 软删除
);

CREATE INDEX idx_platform_project_status ON platform_project(status);
CREATE INDEX idx_platform_project_folder ON platform_project(folder_id);

-- Foreign key: folder_id → folder.id
ALTER TABLE platform_project ADD CONSTRAINT fk_platform_project_folder
  FOREIGN KEY (folder_id) REFERENCES folder(id) ON DELETE SET NULL ON UPDATE CASCADE;
```

#### platform_project_repo

```sql
CREATE TABLE platform_project_repo (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL,
  name          TEXT NOT NULL,          -- 仓库名/服务名
  git_url       TEXT NOT NULL,
  local_dir     TEXT NOT NULL,          -- 相对路径或绝对路径
  branch        TEXT,
  has_claude_md BOOLEAN NOT NULL DEFAULT FALSE,
  folder_id     INTEGER,                -- 关联CodeG Folder
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_platform_project_repo_project ON platform_project_repo(project_id);

ALTER TABLE platform_project_repo ADD CONSTRAINT fk_project_repo_project
  FOREIGN KEY (project_id) REFERENCES platform_project(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE platform_project_repo ADD CONSTRAINT fk_project_repo_folder
  FOREIGN KEY (folder_id) REFERENCES folder(id) ON DELETE SET NULL ON UPDATE CASCADE;
```

#### platform_task

```sql
CREATE TABLE platform_task (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL,
  parent_task_id  INTEGER,                -- 父任务（需求拆解）
  title           TEXT NOT NULL,
  description     TEXT,
  task_type       TEXT NOT NULL,           -- 本地细粒度类型
  status          TEXT NOT NULL DEFAULT 'backlog',  -- backlog/confirmed/in_progress/done/released
  priority        TEXT,                    -- high/medium/low
  assignee        TEXT,
  -- 禅道同步字段
  zentao_id       INTEGER,
  zentao_type     TEXT,                    -- story/task/bug
  zentao_sync_status TEXT DEFAULT 'none',  -- none/synced/pending_push/push_failed
  -- 禅道扩展字段
  deadline        TIMESTAMP WITH TIME ZONE,
  estimated_hours REAL,
  consumed_hours  REAL,
  zentao_module   TEXT,
  -- 项目/知识库关联
  kb_refs_json    TEXT,                    -- JSON数组
  affected_repos_json TEXT,                -- JSON数组
  -- Delegation配置
  delegation_config TEXT,                  -- JSON, per-task覆盖
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  deleted_at      TIMESTAMP WITH TIME ZONE  -- 软删除
);

CREATE INDEX idx_platform_task_project ON platform_task(project_id);
CREATE INDEX idx_platform_task_status ON platform_task(status);
CREATE INDEX idx_platform_task_parent ON platform_task(parent_task_id);
CREATE INDEX idx_platform_task_zentao ON platform_task(zentao_id);

ALTER TABLE platform_task ADD CONSTRAINT fk_task_project
  FOREIGN KEY (project_id) REFERENCES platform_project(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE platform_task ADD CONSTRAINT fk_task_parent
  FOREIGN KEY (parent_task_id) REFERENCES platform_task(id) ON DELETE SET NULL ON UPDATE CASCADE;
```

#### platform_task_type_mapping

```sql
CREATE TABLE platform_task_type_mapping (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  local_type    TEXT NOT NULL,
  zentao_type   TEXT NOT NULL,
  zentao_module TEXT,
  project_id    INTEGER,                  -- NULL=全局默认
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_task_type_mapping_project ON platform_task_type_mapping(project_id);
```

#### platform_task_conversation

```sql
CREATE TABLE platform_task_conversation (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL,
  conversation_id INTEGER NOT NULL,
  conversation_role TEXT NOT NULL DEFAULT 'discussion',  -- analysis/implementation/review/test/discussion
  summary         TEXT,
  injected_docs_json TEXT,                  -- JSON数组，注入的文档路径列表
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE UNIQUE INDEX idx_task_conversation_unique ON platform_task_conversation(task_id, conversation_id);

ALTER TABLE platform_task_conversation ADD CONSTRAINT fk_task_conv_task
  FOREIGN KEY (task_id) REFERENCES platform_task(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE platform_task_conversation ADD CONSTRAINT fk_task_conv_conversation
  FOREIGN KEY (conversation_id) REFERENCES conversation(id) ON DELETE CASCADE ON UPDATE CASCADE;
```

#### platform_task_decomposition

```sql
CREATE TABLE platform_task_decomposition (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source_task_id   INTEGER NOT NULL,
  ai_generated     BOOLEAN NOT NULL DEFAULT FALSE,
  decomposition_json TEXT,                  -- AI拆解分析
  created_at       TIMESTAMP WITH TIME ZONE NOT NULL
);

ALTER TABLE platform_task_decomposition ADD CONSTRAINT fk_decomposition_task
  FOREIGN KEY (source_task_id) REFERENCES platform_task(id) ON DELETE CASCADE ON UPDATE CASCADE;
```

#### platform_global_config

```sql
CREATE TABLE platform_global_config (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  config_type   TEXT NOT NULL,  -- zentao/gitlab/jenkins/general
  config_json   TEXT NOT NULL,  -- 非敏感配置JSON
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE UNIQUE INDEX idx_global_config_type ON platform_global_config(config_type);
```

#### platform_credential

```sql
CREATE TABLE platform_credential (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER,                  -- NULL=全局, 非空=项目级覆盖
  credential_type TEXT NOT NULL,            -- zentao/gitlab/jenkins
  credential_key  TEXT NOT NULL,            -- keyring_store中的key
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_credential_type_project ON platform_credential(credential_type, project_id);
```

#### platform_activity_log

```sql
CREATE TABLE platform_activity_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL,
  task_id       INTEGER,
  action        TEXT NOT NULL,    -- task_status_changed/conversation_linked/zentao_synced/...
  actor         TEXT,
  detail_json   TEXT,             -- 操作详情JSON
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_activity_log_project ON platform_activity_log(project_id);
CREATE INDEX idx_activity_log_task ON platform_activity_log(task_id);
CREATE INDEX idx_activity_log_action ON platform_activity_log(action);
```

---

## 二、Entity层

### 2.1 文件清单

| 文件路径 | 对应表 |
|----------|--------|
| `src-tauri/src/db/entities/platform_project.rs` | platform_project |
| `src-tauri/src/db/entities/platform_project_repo.rs` | platform_project_repo |
| `src-tauri/src/db/entities/platform_task.rs` | platform_task |
| `src-tauri/src/db/entities/platform_task_type_mapping.rs` | platform_task_type_mapping |
| `src-tauri/src/db/entities/platform_task_conversation.rs` | platform_task_conversation |
| `src-tauri/src/db/entities/platform_task_decomposition.rs` | platform_task_decomposition |
| `src-tauri/src/db/entities/platform_global_config.rs` | platform_global_config |
| `src-tauri/src/db/entities/platform_credential.rs` | platform_credential |
| `src-tauri/src/db/entities/platform_activity_log.rs` | platform_activity_log |

### 2.2 Entity定义模式

所有Entity严格遵循现有模式（`DeriveEntityModel` + `DeriveRelation` + `Related<T>` + `ActiveModelBehavior`）：

```rust
// platform_project.rs 示例
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_project")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub client_name: Option<String>,
    #[sea_orm(column_type = "Text", default_value = "planning")]
    pub status: String,
    pub root_dir: String,
    pub folder_id: Option<i32>,
    pub zentao_project_id: Option<i32>,
    pub zentao_product_id: Option<i32>,
    pub jenkins_url: Option<String>,
    pub kb_repo_url: Option<String>,
    pub kb_local_dir: Option<String>,
    pub default_agent_type: Option<String>,
    pub delegation_config: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub agent_config_json: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub deleted_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::platform_project_repo::Entity")]
    ProjectRepos,
    #[sea_orm(has_many = "super::platform_task::Entity")]
    Tasks,
    #[sea_orm(
        belongs_to = "super::folder::Entity",
        from = "Column::FolderId",
        to = "super::folder::Column::Id"
    )]
    Folder,
}

impl Related<super::platform_project_repo::Entity> for Entity {
    fn to() -> RelationDef { Relation::ProjectRepos.def() }
}

impl Related<super::platform_task::Entity> for Entity {
    fn to() -> RelationDef { Relation::Tasks.def() }
}

impl Related<super::folder::Entity> for Entity {
    fn to() -> RelationDef { Relation::Folder.def() }
}

impl ActiveModelBehavior for ActiveModel {}
```

**关键约束**：
- 所有`*_json`字段使用 `#[sea_orm(column_type = "Text")]`，因为SeaORM默认String映射VARCHAR(255)，JSON可能超长
- 软删除字段 `deleted_at: Option<DateTimeUtc>`
- `status`字段使用 `#[sea_orm(default_value = "...")]` 设置默认值
- Relation的`belongs_to`方向指向现有核心Entity（folder）时，用`super::folder::Entity`

### 2.3 `entities/mod.rs` 注册（末尾追加）

```rust
// ─── Platform entities (末尾追加) ───
pub mod platform_project;
pub mod platform_project_repo;
pub mod platform_task;
pub mod platform_task_type_mapping;
pub mod platform_task_conversation;
pub mod platform_task_decomposition;
pub mod platform_global_config;
pub mod platform_credential;
pub mod platform_activity_log;
```

### 2.4 `entities/prelude.rs` 注册（末尾追加）

```rust
// ─── Platform ───
pub use super::platform_project::Entity as PlatformProject;
pub use super::platform_project_repo::Entity as PlatformProjectRepo;
pub use super::platform_task::Entity as PlatformTask;
pub use super::platform_task_type_mapping::Entity as PlatformTaskTypeMapping;
pub use super::platform_task_conversation::Entity as PlatformTaskConversation;
pub use super::platform_task_decomposition::Entity as PlatformTaskDecomposition;
pub use super::platform_global_config::Entity as PlatformGlobalConfig;
pub use super::platform_credential::Entity as PlatformCredential;
pub use super::platform_activity_log::Entity as PlatformActivityLog;
```

---

## 三、Service层

### 3.1 文件清单

| 文件路径 | 对应Entity |
|----------|-----------|
| `src-tauri/src/db/service/platform_project_service.rs` | platform_project |
| `src-tauri/src/db/service/platform_project_repo_service.rs` | platform_project_repo |
| `src-tauri/src/db/service/platform_task_service.rs` | platform_task |
| `src-tauri/src/db/service/platform_task_type_mapping_service.rs` | platform_task_type_mapping |
| `src-tauri/src/db/service/platform_task_conversation_service.rs` | platform_task_conversation |
| `src-tauri/src/db/service/platform_task_decomposition_service.rs` | platform_task_decomposition |
| `src-tauri/src/db/service/platform_global_config_service.rs` | platform_global_config |
| `src-tauri/src/db/service/platform_credential_service.rs` | platform_credential |

> **注意**：platform_activity_log暂不创建service（Phase 2实现CRUD）

### 3.2 Service函数定义

每个service遵循现有模式：`pub async fn` + `&DatabaseConnection` + `Result<T, DbError>` + 私有`to_*` DTO转换。

#### platform_project_service.rs

```rust
// CRUD
pub async fn list(conn: &DatabaseConnection) -> Result<Vec<ProjectInfo>, DbError>
  // 查询所有未删除项目，按updated_at DESC排序

pub async fn get_by_id(conn: &DatabaseConnection, id: i32) -> Result<Option<ProjectInfo>, DbError>
  // 查询单个项目（含软删除过滤）

pub async fn get_by_folder_id(conn: &DatabaseConnection, folder_id: i32) -> Result<Option<ProjectInfo>, DbError>
  // 通过folder_id查找关联的项目（前端识别项目Folder用）

pub async fn create(conn: &DatabaseConnection, name: &str, root_dir: &str, ...) -> Result<ProjectInfo, DbError>
  // 创建项目，status默认"planning"

pub async fn update(conn: &DatabaseConnection, id: i32, ...) -> Result<ProjectInfo, DbError>
  // 部分更新：只修改传入的字段（类似conversation_service的update模式）

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError>
  // 软删除：设置deleted_at = Some(Utc::now())

// 特殊查询
pub async fn list_by_status(conn: &DatabaseConnection, status: &str) -> Result<Vec<ProjectInfo>, DbError>
```

#### platform_project_repo_service.rs

```rust
pub async fn list_by_project(conn: &DatabaseConnection, project_id: i32) -> Result<Vec<ProjectRepoInfo>, DbError>
pub async fn get_by_id(conn: &DatabaseConnection, id: i32) -> Result<Option<ProjectRepoInfo>, DbError>
pub async fn create(conn: &DatabaseConnection, project_id: i32, name: &str, git_url: &str, local_dir: &str, ...) -> Result<ProjectRepoInfo, DbError>
pub async fn update(conn: &DatabaseConnection, id: i32, ...) -> Result<ProjectRepoInfo, DbError>
pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError>
  // 真删除（project_repo没有软删除字段）

pub async fn find_by_folder_id(conn: &DatabaseConnection, folder_id: i32) -> Result<Option<ProjectRepoInfo>, DbError>
  // 通过folder_id查找关联的仓库（用于桥接现有Folder）
```

#### platform_task_service.rs

```rust
// CRUD
pub async fn list_by_project(conn: &DatabaseConnection, project_id: i32) -> Result<Vec<TaskInfo>, DbError>
  // 查询项目下所有未删除任务，按status+priority排序

pub async fn get_by_id(conn: &DatabaseConnection, id: i32) -> Result<Option<TaskInfo>, DbError>
pub async fn create(conn: &DatabaseConnection, project_id: i32, title: &str, task_type: &str, ...) -> Result<TaskInfo, DbError>
pub async fn update(conn: &DatabaseConnection, id: i32, ...) -> Result<TaskInfo, DbError>
pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError>
  // 软删除

// 特殊查询
pub async fn list_by_status(conn: &DatabaseConnection, project_id: i32, status: &str) -> Result<Vec<TaskInfo>, DbError>
pub async fn list_sub_tasks(conn: &DatabaseConnection, parent_task_id: i32) -> Result<Vec<TaskInfo>, DbError>
pub async fn list_by_zentao_sync_status(conn: &DatabaseConnection, status: &str) -> Result<Vec<TaskInfo>, DbError>
  // 查询需要禅道同步的任务（pending_push/push_failed）

pub async fn update_status(conn: &DatabaseConnection, id: i32, status: &str) -> Result<TaskInfo, DbError>
  // 单独更新状态（常用操作，单独提供）
```

#### platform_task_conversation_service.rs

```rust
pub async fn list_by_task(conn: &DatabaseConnection, task_id: i32) -> Result<Vec<TaskConversationInfo>, DbError>
pub async fn get_by_conversation(conn: &DatabaseConnection, conversation_id: i32) -> Result<Option<TaskConversationInfo>, DbError>
  // 通过conversation_id查找关联（反向查询：对话属于哪个任务）

pub async fn create(conn: &DatabaseConnection, task_id: i32, conversation_id: i32, role: &str, ...) -> Result<TaskConversationInfo, DbError>
pub async fn update_summary(conn: &DatabaseConnection, id: i32, summary: &str) -> Result<TaskConversationInfo, DbError>
pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError>
pub async fn delete_by_task_and_conversation(conn: &DatabaseConnection, task_id: i32, conversation_id: i32) -> Result<(), DbError>
  // 解除任务-对话关联
```

#### platform_global_config_service.rs

```rust
pub async fn get_by_type(conn: &DatabaseConnection, config_type: &str) -> Result<Option<GlobalConfigInfo>, DbError>
pub async fn set(conn: &DatabaseConnection, config_type: &str, config_json: &str) -> Result<GlobalConfigInfo, DbError>
  // 如果已存在则update，否则insert（upsert语义）
```

#### platform_credential_service.rs

```rust
pub async fn list_by_type(conn: &DatabaseConnection, credential_type: &str) -> Result<Vec<CredentialInfo>, DbError>
pub async fn get_by_type_and_project(conn: &DatabaseConnection, credential_type: &str, project_id: Option<i32>) -> Result<Option<CredentialInfo>, DbError>
  // 查找全局或项目级凭证记录

pub async fn create(conn: &DatabaseConnection, credential_type: &str, credential_key: &str, project_id: Option<i32>) -> Result<CredentialInfo, DbError>
  // 在platform_credential表创建记录，同时调用keyring_store存储Token

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError>
  // 删除记录，同时调用keyring_store删除Token

// 密钥存取辅助（封装keyring_store）
pub fn store_token(credential_key: &str, token: &str) -> Result<(), String>
  // 调用 crate::keyring_store::set_token

pub fn retrieve_token(credential_key: &str) -> Option<String>
  // 调用 crate::keyring_store::get_token

pub fn remove_token(credential_key: &str) -> Result<(), String>
  // 调用 crate::keyring_store::delete_token
```

### 3.3 `service/mod.rs` 注册（末尾追加）

```rust
// ─── Platform services (末尾追加) ───
pub mod platform_project_service;
pub mod platform_project_repo_service;
pub mod platform_task_service;
pub mod platform_task_type_mapping_service;
pub mod platform_task_conversation_service;
pub mod platform_task_decomposition_service;
pub mod platform_global_config_service;
pub mod platform_credential_service;
```

---

## 四、Model层（DTO）

### 4.1 文件

| 文件 | 内容 |
|------|------|
| `src-tauri/src/models/platform_project.rs` | ProjectInfo, ProjectDetail |
| `src-tauri/src/models/platform_task.rs` | TaskInfo, TaskDetail, TaskConversationInfo, TaskTypeMappingInfo, TaskDecompositionInfo |
| `src-tauri/src/models/platform_config.rs` | GlobalConfigInfo, CredentialInfo |

### 4.2 DTO定义

遵循现有模式：`#[derive(Debug, Clone, Serialize)]`，使用`DateTime<Utc>`（chrono），字段全部pub。

```rust
// platform_project.rs
use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub client_name: Option<String>,
    pub status: String,
    pub root_dir: String,
    pub folder_id: Option<i32>,
    pub zentao_project_id: Option<i32>,
    pub zentao_product_id: Option<i32>,
    pub jenkins_url: Option<String>,
    pub kb_repo_url: Option<String>,
    pub kb_local_dir: Option<String>,
    pub default_agent_type: Option<String>,
    pub delegation_config: Option<String>,
    pub agent_config_json: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: ProjectInfo,
    pub repos: Vec<ProjectRepoInfo>,
    pub task_count_by_status: TaskCountByStatus,  // 各状态任务数统计
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCountByStatus {
    pub backlog: i32,
    pub confirmed: i32,
    pub in_progress: i32,
    pub done: i32,
    pub released: i32,
}

// platform_task.rs
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: i32,
    pub project_id: i32,
    pub parent_task_id: Option<i32>,
    pub title: String,
    pub description: Option<String>,
    pub task_type: String,
    pub status: String,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub zentao_id: Option<i32>,
    pub zentao_type: Option<String>,
    pub zentao_sync_status: Option<String>,
    pub deadline: Option<DateTime<Utc>>,
    pub estimated_hours: Option<f64>,
    pub consumed_hours: Option<f64>,
    pub zentao_module: Option<String>,
    pub kb_refs_json: Option<String>,
    pub affected_repos_json: Option<String>,
    pub delegation_config: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConversationInfo {
    pub id: i32,
    pub task_id: i32,
    pub conversation_id: i32,
    pub conversation_role: String,
    pub summary: Option<String>,
    pub injected_docs_json: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// ... TaskDetail, TaskTypeMappingInfo, TaskDecompositionInfo 类似结构
```

### 4.3 `models/mod.rs` 注册（末尾追加）

```rust
// ─── Platform models (末尾追加) ───
pub mod platform_project;
pub mod platform_task;
pub mod platform_config;
pub use platform_project::{ProjectInfo, ProjectDetail, ProjectRepoInfo, TaskCountByStatus};
pub use platform_task::{TaskInfo, TaskDetail, TaskConversationInfo, TaskTypeMappingInfo, TaskDecompositionInfo};
pub use platform_config::{GlobalConfigInfo, CredentialInfo};
```

---

## 五、Command层（Tauri命令 + _core函数）

### 5.1 文件

| 文件 | 内容 |
|------|------|
| `src-tauri/src/commands/project.rs` | 项目+仓库+全局配置+凭证的命令 |
| `src-tauri/src/commands/task.rs` | 任务+对话关联+类型映射+拆解的命令 |

### 5.2 Command函数清单

**两层模式**：`*_core` 函数（runtime-agnostic）+ `#[cfg_attr(feature = "tauri-runtime", tauri::command)]` 包装

#### project.rs

```rust
// ─── Project CRUD ───
pub async fn list_projects_core(db: &AppDatabase) -> Result<Vec<ProjectInfo>, AppCommandError>
pub async fn get_project_core(db: &AppDatabase, id: i32) -> Result<ProjectDetail, AppCommandError>
pub async fn create_project_core(db: &AppDatabase, emitter: &EventEmitter, name: &str, root_dir: &str, ...) -> Result<ProjectInfo, AppCommandError>
  // 创建项目 + 自动创建虚拟Folder + 关联folder_id
  // 创建后发射 platform_project_changed 事件

pub async fn update_project_core(db: &AppDatabase, emitter: &EventEmitter, id: i32, ...) -> Result<ProjectInfo, AppCommandError>
pub async fn delete_project_core(db: &AppDatabase, emitter: &EventEmitter, id: i32) -> Result<(), AppCommandError>
  // 软删除项目，发射事件

// ─── Project Repo ───
pub async fn list_project_repos_core(db: &AppDatabase, project_id: i32) -> Result<Vec<ProjectRepoInfo>, AppCommandError>
pub async fn add_project_repo_core(db: &AppDatabase, emitter: &EventEmitter, project_id: i32, ...) -> Result<ProjectRepoInfo, AppCommandError>
pub async fn remove_project_repo_core(db: &AppDatabase, emitter: &EventEmitter, id: i32) -> Result<(), AppCommandError>
pub async fn scan_git_repos_core(db: &AppDatabase, root_dir: &str) -> Result<Vec<GitRepoScanResult>, AppCommandError>
  // 扫描根目录下的git仓库，返回候选列表

// ─── Global Config ───
pub async fn get_global_config_core(db: &AppDatabase, config_type: &str) -> Result<Option<GlobalConfigInfo>, AppCommandError>
pub async fn set_global_config_core(db: &AppDatabase, emitter: &EventEmitter, config_type: &str, config_json: &str) -> Result<GlobalConfigInfo, AppCommandError>

// ─── Credential ───
pub async fn save_credential_core(db: &AppDatabase, emitter: &EventEmitter, credential_type: &str, token: &str, project_id: Option<i32>) -> Result<CredentialInfo, AppCommandError>
  // 1. 生成credential_key (格式: "platform:{credential_type}:{project_id_or_global}")
  // 2. 调用 keyring_store::set_token 存储Token
  // 3. 在platform_credential表创建记录

pub async fn get_credential_token_core(db: &AppDatabase, credential_type: &str, project_id: Option<i32>) -> Result<Option<String>, AppCommandError>
  // 从keyring_store检索Token（不返回明文给前端，仅内部使用）

pub async fn delete_credential_core(db: &AppDatabase, emitter: &EventEmitter, id: i32) -> Result<(), AppCommandError>
```

**Tauri command包装**（每个_core函数一个，模式同现有代码）：
```rust
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_projects(db: tauri::State<'_, AppDatabase>) -> Result<Vec<ProjectInfo>, AppCommandError> {
    list_projects_core(&db).await
}
```

#### task.rs

```rust
// ─── Task CRUD ───
pub async fn list_tasks_core(db: &AppDatabase, project_id: i32) -> Result<Vec<TaskInfo>, AppCommandError>
pub async fn get_task_core(db: &AppDatabase, id: i32) -> Result<TaskDetail, AppCommandError>
pub async fn create_task_core(db: &AppDatabase, emitter: &EventEmitter, project_id: i32, ...) -> Result<TaskInfo, AppCommandError>
pub async fn update_task_core(db: &AppDatabase, emitter: &EventEmitter, id: i32, ...) -> Result<TaskInfo, AppCommandError>
pub async fn update_task_status_core(db: &AppDatabase, emitter: &EventEmitter, id: i32, status: &str) -> Result<TaskInfo, AppCommandError>
pub async fn delete_task_core(db: &AppDatabase, emitter: &EventEmitter, id: i32) -> Result<(), AppCommandError>

// ─── Task Conversation ───
pub async fn link_conversation_core(db: &AppDatabase, emitter: &EventEmitter, task_id: i32, conversation_id: i32, role: &str) -> Result<TaskConversationInfo, AppCommandError>
pub async fn unlink_conversation_core(db: &AppDatabase, emitter: &EventEmitter, task_id: i32, conversation_id: i32) -> Result<(), AppCommandError>
pub async fn list_task_conversations_core(db: &AppDatabase, task_id: i32) -> Result<Vec<TaskConversationInfo>, AppCommandError>
pub async fn get_task_by_conversation_core(db: &AppDatabase, conversation_id: i32) -> Result<Option<TaskConversationInfo>, AppCommandError>

// ─── Task Type Mapping ───
pub async fn list_task_type_mappings_core(db: &AppDatabase, project_id: Option<i32>) -> Result<Vec<TaskTypeMappingInfo>, AppCommandError>
pub async fn create_task_type_mapping_core(db: &AppDatabase, ...) -> Result<TaskTypeMappingInfo, AppCommandError>
pub async fn update_task_type_mapping_core(db: &AppDatabase, id: i32, ...) -> Result<TaskTypeMappingInfo, AppCommandError>
pub async fn delete_task_type_mapping_core(db: &AppDatabase, id: i32) -> Result<(), AppCommandError>

// ─── Task Decomposition ───
pub async fn create_decomposition_core(db: &AppDatabase, source_task_id: i32, ai_generated: bool, decomposition_json: Option<String>) -> Result<TaskDecompositionInfo, AppCommandError>
```

### 5.3 `commands/mod.rs` 注册（末尾追加）

```rust
pub mod project;
pub mod task;
```

### 5.4 `lib.rs` 注册

在 `tauri_app` 模块的 `use` 块中追加：
```rust
use crate::commands::{
    // ... 现有模块 ...
    project as project_commands,
    task as task_commands,
};
```

在 `tauri::generate_handler![]` 中追加（末尾）：
```rust
// ─── Platform ───
project_commands::list_projects,
project_commands::get_project,
project_commands::create_project,
project_commands::update_project,
project_commands::delete_project,
project_commands::list_project_repos,
project_commands::add_project_repo,
project_commands::remove_project_repo,
project_commands::scan_git_repos,
project_commands::get_global_config,
project_commands::set_global_config,
project_commands::save_credential,
project_commands::delete_credential,
task_commands::list_tasks,
task_commands::get_task,
task_commands::create_task,
task_commands::update_task,
task_commands::update_task_status,
task_commands::delete_task,
task_commands::link_conversation,
task_commands::unlink_conversation,
task_commands::list_task_conversations,
task_commands::get_task_by_conversation,
task_commands::list_task_type_mappings,
task_commands::create_task_type_mapping,
task_commands::update_task_type_mapping,
task_commands::delete_task_type_mapping,
task_commands::create_decomposition,
```

---

## 六、Web Handler层

### 6.1 文件

| 文件 | 对应Command |
|------|------------|
| `src-tauri/src/web/handlers/project.rs` | project命令的Web版 |
| `src-tauri/src/web/handlers/task.rs` | task命令的Web版 |

### 6.2 Handler模式

遵循现有模式：`Extension(state): Extension<Arc<AppState>>` + `Json(params): Json<ParamsType>` + 调用`_core`函数 + `Result<Json<T>, AppCommandError>`

每个handler对应一个_core函数，Param struct用`#[derive(Deserialize)]` + `#[serde(rename_all = "camelCase")]`

**注意**：credential相关handler不暴露Token到前端（`get_credential_token`仅内部使用，不设Web handler）。前端只需知道"凭证是否存在"，提供`check_credential_exists` handler。

### 6.3 `handlers/mod.rs` 注册（末尾追加）

```rust
pub mod project;
pub mod task;
```

### 6.4 `router.rs` 注册（在`.fallback(api_not_found)`之前追加）

```rust
// ─── Platform ───
.route("/platform/list_projects", post(handlers::project::list_projects))
.route("/platform/get_project", post(handlers::project::get_project))
.route("/platform/create_project", post(handlers::project::create_project))
.route("/platform/update_project", post(handlers::project::update_project))
.route("/platform/delete_project", post(handlers::project::delete_project))
.route("/platform/list_project_repos", post(handlers::project::list_project_repos))
.route("/platform/add_project_repo", post(handlers::project::add_project_repo))
.route("/platform/remove_project_repo", post(handlers::project::remove_project_repo))
.route("/platform/scan_git_repos", post(handlers::project::scan_git_repos))
.route("/platform/get_global_config", post(handlers::project::get_global_config))
.route("/platform/set_global_config", post(handlers::project::set_global_config))
.route("/platform/save_credential", post(handlers::project::save_credential))
.route("/platform/delete_credential", post(handlers::project::delete_credential))
.route("/platform/check_credential_exists", post(handlers::project::check_credential_exists))
.route("/platform/list_tasks", post(handlers::task::list_tasks))
.route("/platform/get_task", post(handlers::task::get_task))
.route("/platform/create_task", post(handlers::task::create_task))
.route("/platform/update_task", post(handlers::task::update_task))
.route("/platform/update_task_status", post(handlers::task::update_task_status))
.route("/platform/delete_task", post(handlers::task::delete_task))
.route("/platform/link_conversation", post(handlers::task::link_conversation))
.route("/platform/unlink_conversation", post(handlers::task::unlink_conversation))
.route("/platform/list_task_conversations", post(handlers::task::list_task_conversations))
.route("/platform/get_task_by_conversation", post(handlers::task::get_task_by_conversation))
.route("/platform/list_task_type_mappings", post(handlers::task::list_task_type_mappings))
.route("/platform/create_task_type_mapping", post(handlers::task::create_task_type_mapping))
.route("/platform/update_task_type_mapping", post(handlers::task::update_task_type_mapping))
.route("/platform/delete_task_type_mapping", post(handlers::task::delete_task_type_mapping))
.route("/platform/create_decomposition", post(handlers::task::create_decomposition))
```

---

## 七、Platform模块入口

### 7.1 文件结构

```
src-tauri/src/platform/
  ├── mod.rs              ← 模块入口，pub mod声明
  ├── project/
  │   ├── mod.rs
  │   ├── manager.rs      ← PlatformManager（Phase 1a用简单版）
  │   └── git_scan.rs     ← git仓库扫描逻辑
  └── task/
      ├── mod.rs
      └── mod.rs           ← 任务子模块入口
```

### 7.2 PlatformManager（Phase 1a简单版）

Phase 1a的PlatformManager只需要一个极简版本，因为所有操作都是DB CRUD，不需要复杂状态管理。Phase 1b才会需要管理"当前选中项目"等UI状态。

```rust
// platform/project/manager.rs
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct PlatformManager {
    inner: Arc<Inner>,
}

struct Inner {
    // Phase 1a: 空壳，Phase 1b会添加 active_project_id 等字段
}

impl PlatformManager {
    pub fn new() -> Self {
        Self { inner: Arc::new(Inner {}) }
    }
    pub fn clone_ref(&self) -> Self {
        Self { inner: self.inner.clone() }
    }
}

impl Default for PlatformManager {
    fn default() -> Self { Self::new() }
}
```

### 7.3 git_scan.rs — 仓库扫描逻辑

```rust
pub struct GitRepoScanResult {
    pub name: String,           // 目录名（如 "order-service"）
    pub local_dir: String,      // 相对于root_dir的路径
    pub git_url: Option<String>, // 从.git/config解析的remote URL
    pub has_claude_md: bool,    // 是否存在CLAUDE.md
}

pub async fn scan_root_dir(root_dir: &str) -> Result<Vec<GitRepoScanResult>, AppCommandError>
  // 1. 遍历root_dir下的所有子目录
  // 2. 检查每个子目录是否包含 .git/ 目录
  // 3. 尝试解析 .git/config 获取remote URL
  // 4. 检查是否存在 CLAUDE.md 文件
  // 5. 返回候选仓库列表
```

---

## 八、集成点注册

### 8.1 注册清单

| 文件 | 改动 | 位置 |
|------|------|------|
| `lib.rs` | `pub mod platform;` | 顶层模块声明区域（末尾） |
| `lib.rs` | `project as project_commands, task as task_commands` | tauri_app的use块（末尾） |
| `lib.rs` | 所有platform命令注册 | generate_handler![]（末尾） |
| `lib.rs` | `.manage(PlatformManager::new())` | Tauri builder chain |
| `app_state.rs` | `pub platform_manager: PlatformManager,` | AppState结构体（末尾） |
| `app_state.rs` | `default_platform_manager()` | helper函数区域 |
| `app_state.rs` | `platform_manager: default_platform_manager()` | new_for_test() |
| `commands/mod.rs` | `pub mod project; pub mod task;` | 末尾追加 |
| `db/entities/mod.rs` | 9个platform模块声明 | 末尾追加 |
| `db/entities/prelude.rs` | 9个Entity重导出 | 末尾追加 |
| `db/service/mod.rs` | 8个platform service声明 | 末尾追加 |
| `db/migration/mod.rs` | 3个platform migration注册 | migrations()列表末尾 |
| `models/mod.rs` | 3个platform model声明+re-export | 末尾追加 |
| `web/handlers/mod.rs` | `pub mod project; pub mod task;` | 末尾追加 |
| `web/router.rs` | platform路由块 | `.fallback(api_not_found)`之前 |

---

## 九、项目Folder关联逻辑

`create_project_core`函数的关键逻辑：

```
用户选择本地目录（如 /workspace/tpm-client-A/）作为项目根目录
  ↓
检查该目录是否已经是CodeG Folder
  ↓
是 → 直接关联 project.folder_id = 该Folder.id
否 → 调用CodeG现有的"打开目录"逻辑创建Folder → 关联 project.folder_id = 新Folder.id
  ↓
Folder的path = 项目根目录，default_agent_type = 项目默认agent，git_branch = null（项目根目录通常不是独立git仓库）
```

这是普通Folder，和你平时在CodeG里打开目录创建的Folder完全一样。唯一区别：前端通过关联查询识别到这个Folder关联了项目，文件树和Git面板切换为多根/聚合视图。

---

## 十、错误处理

所有platform命令使用`AppCommandError`（与现有代码一致）：
- DB操作失败 → `DbError` → `.map_err(AppCommandError::from)`
- Git扫描失败 → `AppCommandError::io_error("...").with_detail(...)`
- keyring_store失败 → `AppCommandError::io_error("Failed to save credential").with_detail(...)`

事件发射使用`EventEmitter`（与现有代码一致），新事件类型：
- `platform_project_changed` — 项目创建/更新/删除
- `platform_task_changed` — 任务创建/更新/删除/状态变更
- `platform_task_conversation_changed` — 任务-对话关联变更

---

## 十一、验证标准

Phase 1a完成后必须通过：

1. `cargo check` — 无编译错误
2. `cargo test --features test-utils` — 所有现有测试仍然通过
3. DB migration运行成功 — `AppState::new_for_test()`能正确创建所有platform表
4. 手动验证CRUD — 通过Web API（POST请求）测试项目/任务的创建、查询、更新、删除
5. Folder关联 — 创建项目后能正确创建Folder并关联folder_id
6. keyring_store集成 — credential的存/取/删能正确调用keyring_store
