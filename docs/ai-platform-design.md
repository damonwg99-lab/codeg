# AI研发平台设计方案——基于CodeG二次改造

## Context

**问题背景**：一家快消行业TPM（Trade Promotion Management）管理系统软件公司，有成熟的标准产品，项目以二次开发为主（50%+定制逻辑）。技术主管希望搭建公司AI研发体系，覆盖需求→PRD→任务→设计→开发→测试→发版→文档全流程。

**核心定位**：
- 先本地个人版验证，再扩展团队服务器版
- AI辅助、人工主导（AI提供草案和建议，人做决策和确认）
- 基于CodeG现有项目二次改造，但**新模块必须与核心代码隔离**，保证未来CodeG升级时能快速合并

**团队规模**：1-5人（MVP阶段无需复杂权限体系）

---

## 一、整体架构

### 1.1 模块隔离策略（最关键的设计决策）

**核心原则**：新业务模块（项目管理、任务管理、知识库）不修改CodeG核心文件，只通过**明确定义的集成点**接入。

采用"插件式模块"架构：

```
CodeG 核心（上游升级时直接 merge）
  ├── 现有功能（ACP、Conversation、Folder、Terminal...）
  └── 集成点（固定的扩展插槽）
        ├── 集成点1: AppState 新字段
        ├── 集成点2: sidebar 导航插槽
        ├── 集成点3: lib.rs 模块声明 + command 注册
        ├── 集成点4: web/router 路由插槽
        ├── 集成点5: DB migration 注册
        └── 集成点6: Composer 区域扩展（📋上下文按钮）

研发平台模块（独立目录，独立维护）
  ├── src-tauri/src/platform/          ← 全部新Rust代码在这里
  │     ├── mod.rs                     ← 模块入口
  │     ├── project/                   ← 项目管理
  │     ├── task/                      ← 任务管理
  │     ├── knowledge/                 ← 知识库
  │     ├── integration/               ← 外部系统集成(禅道/GitLab/Jenkins)
  │     └── ai_workflow/               ← AI研发流程编排
  ├── src/app/platform/                ← 全部新前端页面在这里
  │     ├── projects/                  ← 项目列表/详情页
  │     ├── tasks/                     ← 任务列表/详情页
  │     └── knowledge/                 ← 知识库管理页
  ├── src/components/platform/         ← 全部新前端组件在这里
  ├── src/hooks/platform/              ← 全部新hooks在这里
  ├── src/lib/platform/                ← 全部新lib工具在这里
  └── src-tauri/src/db/
        ├── entities/platform_*        ← 新DB实体
        ├── migration/m*_platform_*    ← 新迁移文件
        ├── service/platform_*         ← 新service
        ├── models/platform_*          ← 新DTO模型
```

**集成点策略**：

| 集成点 | 文件 | 改动方式 | 升级冲突风险 |
|--------|------|----------|-------------|
| AppState | `app_state.rs` | 添加 `platform_*_manager` 字段 | 低（只加字段） |
| 模块声明 | `lib.rs` | 添加 `pub mod platform;` | 低（只加一行） |
| 命令注册 | `lib.rs` invoke_handler | 添加 platform 命令组 | 中（注册列表会变） |
| 路由 | `web/router.rs` | 添加 platform 路由块 | 中（路由列表会变） |
| Sidebar | `sidebar.tsx` | 添加项目选择下拉 + 任务看板入口 + 会话列表切换 | 中 |
| Composer | `composer/` 相关组件 | 添加 📋 上下文注入按钮+浮动面板 | 中 |
| AuxPanel | `aux-panel*.tsx` | 添加项目多根/任务聚焦文件树 + 项目Git聚合视图 | 中 |
| 前端路由 | `app/workspace/layout.tsx` | 添加 platform 页面路由 | 中 |
| DB注册 | `db/entities/mod.rs` | 添加 `pub mod platform_*` | 低 |
| Migration | `db/migration/mod.rs` | 添加迁移注册 | 低 |

**模块启用方式**：采用渐进策略——**Phase 1先用运行时开关**（代码始终编译，UI可通过设置隐藏/显示研发平台模块），后续如果升级冲突严重再切换到Feature Gate（`#[cfg(feature = "platform")]`门控）。

**降低冲突的具体措施**：
1. 所有新 `pub mod` 声明放在文件**末尾**，减少与上游新增模块的位置冲突
2. 所有新命令注册放在 `invoke_handler![]` **末尾**
3. 所有新路由注册放在 `router.rs` **末尾**
4. Sidebar 修改采用"插槽模式"——只添加一个 `<PlatformNavSlot />` 组件占位，所有新导航项都在这个组件内部
5. Composer 修改采用"扩展按钮模式"——只添加一个 `<PlatformContextButton />` 组件，浮动面板内容全在 platform 目录下
6. 定期从上游 `main` 分支合并更新，在冲突少的时候解决

### 1.2 数据流架构

```
┌─────────────────────────────────────────────────────────────┐
│                     CodeG 研发平台                            │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ 项目管理  │  │ 任务管理  │  │ 知识库    │                  │
│  │          │  │          │  │          │                  │
│  │ 项目信息  │←→│ 任务列表  │←→│ 文档模板  │                  │
│  │ Git仓库  │  │ 任务类型  │  │ Skill    │                  │
│  │ CI/CD   │  │ 状态流转  │  │ Prompt   │                  │
│  │ 禅道映射  │  │ 禅道同步  │  │ 需求材料  │                  │
│  └──────────┘  └──────────┘  └──────────┘                  │
│        │              │              │                        │
│        └──────────────┴──────────────┘                       │
│                         │                                    │
│                         ↓                                    │
│              ┌──────────────────┐                            │
│              │  外部系统集成     │                            │
│              │  (禅道/GitLab/   │                            │
│              │   Jenkins)       │                            │
│              └──────────────────┘                            │
│                         │                                    │
│                         ↓                                    │
│              ┌──────────────────┐                            │
│              │  CodeG 核心       │                            │
│              │  Conversation ←──│── 任务通过📋按钮注入上下文   │
│              │  (ACP/Delegation │                            │
│              │   /Composer)     │                            │
│              └──────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

**核心交互模式**：任务不独立执行AI操作，而是通过**会话页面**完成任务。开发者选中任务→跳转到会话页面→通过Composer的📋按钮注入任务上下文→与AI对话完成任务。

---

## 二、数据模型设计

### 2.1 项目（Project）

```rust
// platform_project
pub struct Model {
    pub id: i32,
    pub name: String,                    // 项目名称
    pub description: Option<String>,     // 项目描述
    pub client_name: Option<String>,     // 客户名称（二次开发场景）
    pub status: String,                  // 项目状态: planning/developing/delivered/maintaining
    pub root_dir: String,                // 本地根目录（扫描git仓库的基础）
    pub folder_id: Option<i32>,          // 关联到CodeG的Folder（虚拟项目Folder，见§5.3）
    pub zentao_project_id: Option<i32>,  // 禅道项目ID映射
    pub zentao_product_id: Option<i32>,  // 禅道产品ID映射
    pub jenkins_url: Option<String>,     // Jenkins地址
    pub kb_repo_url: Option<String>,     // 知识库GitLab仓库地址（可选）
    pub kb_local_dir: Option<String>,    // 知识库本地目录（默认: root_dir/_kb/）
    pub default_agent_type: Option<String>, // 项目默认Agent类型
    pub delegation_config: Option<String>, // 项目级委托配置(JSON)，控制DelegationBroker行为
                                           // 如: {max_depth: 2, auto_delegate: true, sub_agent_types: ["claude_code"]}
    pub agent_config_json: Option<String>, // per-task-type agent绑定配置(JSON)
                                           // 如: {prd: "claude_code", coding: "claude_code", review: "open_code"}
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub deleted_at: Option<DateTimeUtc>,
}

// platform_project_repo — 项目关联的git仓库（多仓库聚合）
pub struct Model {
    pub id: i32,
    pub project_id: i32,                 // 所属项目
    pub name: String,                    // 仓库名/服务名（如 "frontend", "order-service"）
    pub git_url: String,                 // GitLab仓库地址
    pub local_dir: String,               // 本地目录（相对于项目root_dir）
    pub branch: Option<String>,          // 当前工作分支
    pub has_claude_md: bool,             // 是否检测到CLAUDE.md文件
    pub folder_id: Option<i32>,          // 关联到CodeG的Folder（桥接现有功能）
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

// platform_task_type_mapping — 任务类型映射表
pub struct Model {
    pub id: i32,
    pub local_type: String,              // 本地细粒度类型
    pub zentao_type: String,             // 禅道原生类型: story/task/bug
    pub zentao_module: Option<String>,   // 禅道模块名（可选）
    pub project_id: Option<i32>,         // 项目级映射（NULL=全局默认）
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

// platform_global_config — 全局配置（禅道/GitLab/Jenkins等）
// ⚠️ 只存非敏感配置，Token/密钥通过keyring_store存储（见§2.4）
// 策略: 全局默认+项目级可覆盖
pub struct Model {
    pub id: i32,
    pub config_type: String,             // 配置类型: zentao/gitlab/jenkins/general
    pub config_json: String,             // 配置内容(JSON)（不含Token）
                                          // zentao: {api_url, default_project_id, ...}
                                          // gitlab: {api_url, default_group, ...}
                                          // jenkins: {api_url, ...}
                                          // general: {default_agent_type, ...}
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

// platform_credential — 凭证管理（Token/密钥走keyring_store，此表记录关联关系）
pub struct Model {
    pub id: i32,
    pub project_id: Option<i32>,         // NULL=全局凭证, 非空=项目级覆盖
    pub credential_type: String,         // 凭证类型: zentao/gitlab/jenkins
    pub credential_key: String,          // keyring_store中的account_id/key
                                          // 通过keyring_store的get_token/set_token接口存取
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}
```

**技术栈信息方案**：不在数据库中单独存储tech_stack_json，而是**利用项目仓库中已有的CLAUDE.md文件**：
- 创建项目扫描git仓库时，自动检测每个仓库是否有CLAUDE.md文件（记录到 `has_claude_md` 字段）
- 注入任务上下文时，自动包含相关仓库的CLAUDE.md内容（AI已经知道如何使用CLAUDE.md）
- 开发者在项目根目录可以维护一个项目级的CLAUDE.md（覆盖所有仓库的通用约定）
- 如果某个仓库没有CLAUDE.md，项目详情页可以提示"建议创建CLAUDE.md"
```

### 2.2 任务（Task）—— 一任务多对话（并列）

**关键设计决策**：一个任务可以关联多个Conversation，每个Conversation是一次独立的"尝试"。任务状态由人手动更新，不自动随对话结束而改变。

```rust
// platform_task
pub struct Model {
    pub id: i32,
    pub project_id: i32,                 // 所属项目
    pub parent_task_id: Option<i32>,     // 父任务（需求拆解为子任务时的关联）
    pub title: String,                   // 任务标题
    pub description: Option<String>,     // 任务详细描述
    pub task_type: String,               // 本地任务类型
    pub status: String,                  // 任务状态: backlog/confirmed/in_progress/done/released
    pub priority: Option<String>,        // 优先级: high/medium/low
    pub assignee: Option<String>,        // 负责人
    // 禅道同步字段
    pub zentao_id: Option<i32>,          // 禅道任务ID（同步后填入）
    pub zentao_type: Option<String>,     // 禅道类型: story/task/bug
    pub zentao_sync_status: Option<String>, // 同步状态: none/synced/pending_push/push_failed
    // 禅道扩展字段
    pub deadline: Option<DateTimeUtc>,   // 截止日期（从禅道同步）
    pub estimated_hours: Option<f64>,    // 预估工时（从禅道同步）
    pub consumed_hours: Option<f64>,     // 已消耗工时（从禅道同步）
    pub zentao_module: Option<String>,   // 禅道所属模块
    // 项目/知识库关联字段
    pub kb_refs_json: Option<String>,    // 常用知识库文档引用(JSON)
    pub affected_repos_json: Option<String>, // 影响的仓库列表(JSON)
    // Delegation配置（可覆盖项目级配置）
    pub delegation_config: Option<String>, // per-task委托配置(JSON)
                                           // 如: {delegate: true, sub_agent_type: "claude_code", max_depth: 1}
                                           // NULL时使用项目级delegation_config
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub deleted_at: Option<DateTimeUtc>,
}

// platform_task_conversation — 任务与对话的关联表（一任务多对话）
pub struct Model {
    pub id: i32,
    pub task_id: i32,                    // 所属任务
    pub conversation_id: i32,            // CodeG Conversation ID
    pub conversation_role: String,       // 对话角色: analysis/implementation/review/test/discussion
    pub summary: Option<String>,         // 对话结果摘要（人填写或AI自动总结）
    pub injected_docs_json: Option<String>, // 注入的文档列表(JSON)，便于追溯
                                           // 如: ["_kb/docs/architecture/product-arch.md", "/path/to/CLAUDE.md"]
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

// platform_task_decomposition — 任务拆解记录（需求自动拆解场景）
pub struct Model {
    pub id: i32,
    pub source_task_id: i32,             // 被拆解的源任务
    pub ai_generated: bool,              // 是否由AI自动拆解生成
    pub decomposition_json: Option<String>, // AI拆解分析(JSON)
    pub created_at: DateTimeUtc,
}
```

**任务-对话关系示意**：

```
Task: 订单服务改造 (#coding, 处理中)
├── Conv#1 (analysis)   — 6/21 分析现有代码，了解结构
├── Conv#2 (implementation) — 6/22 实现API改造，修改3个服务
└── Conv#3 (review)     — 6/23 代码审查，发现2个问题
│
├── Conv#4 (自由对话→后来关联) — 6/20 先自由聊的，后来关联到此任务
│
每个对话是独立的尝试，都属于同一个任务。
对话之间不是继承关系，而是并列的"尝试记录"。
任务状态由人手动更新。
```

**自由对话→关联任务**：

对话可以独立存在（自由聊天），也可以随时关联到任务：
- 开发者自由对话时，通过Composer的📋按钮或对话列表的"关联任务"功能，将当前对话关联到一个已有任务
- 也可以从当前对话创建一个新任务（"这个对话很重要，我要把它变成一个任务跟踪")
- 关联后，对话的上下文自动包含任务信息
- 解除关联后对话依然存在（只是不再有任务上下文）

### 2.3 知识库（Knowledge）

**知识库git仓库目录结构**（按文档类型分顶层目录，底层自由组织）：

```
kb-repo/                              ← 知识库git仓库根目录
├── docs/                             ← 技术文档
│   ├── architecture/                 ← 架构文档（开发者自由创建子目录）
│   │   ├── product-arch.md
│   │   └── microservice-overview.md
│   ├── api/                          ← API文档
│   │   ├── order-service-api.md
│   │   └── promotion-api.md
│   └── database/                     ← 数据库文档
│       ├── tpm-table-design.md
│       └── migration-guide.md
├── templates/                        ← 产品模板/代码模板
│   ├── spring-boot-service/
│   │   ├── template.md              ← 模板文件
│   │   └── template.yaml            ← 模板配置
│   └── react-component/
│       ├── template.md
│       └── template.yaml
├── skills/                           ← AI Skill定义（目录式）
│   ├── generate-prd/                ← 每个Skill是一个目录
│   │   ├── skill.yaml               ← Skill元数据+触发规则
│   │   └── template.md              ← Prompt模板
│   ├── code-review/
│   │   ├── skill.yaml
│   │   └── template.md
│   └── db-design/
│   │   ├── skill.yaml
│   │   └── template.md
├── requirements/                     ← 需求原始材料
│   ├── client-a-requirement.md      ← 客户需求文档
│   ├── zentao-export/               ← 禅道导出的需求文档
│   │   ├── story-1234.md
│   │   ├── bug-5678.md
├── .private/                         ← 本地私有区（git忽略）
│   ├── ai-intermediate/             ← AI生成的中间产物
│   │   ├── prd-draft-20260621.md    ← AI生成的PRD草案
│   │   ├── design-draft-20260622.md ← AI生成的设计方案
│   ├── personal-notes/              ← 个人笔记
│   │   ├── debug-log.md
├── .gitignore                        ← 忽略 .private/ 目录
└── README.md                         ← 知识库说明文档
```

**Skill目录格式**（skill.yaml + template.md）：

```yaml
# skills/generate-prd/skill.yaml
name: generate-prd
description: 基于需求生成PRD文档
trigger:                                ← 触发规则
  task_type: prd                        ← 当任务类型为prd时触发
inject:                                 ← 自动推荐注入的文档
  - docs/architecture/product-arch.md
  - templates/prd-template.md
agent_hint: "请基于以下上下文生成PRD文档，按照PRD模板的结构组织内容"
```

```markdown
# skills/generate-prd/template.md
## PRD生成Prompt模板

请根据以下信息生成PRD文档：

1. 需求描述：{{task_description}}
2. 客户信息：{{project_client_name}}
3. 产品架构：参考注入的产品架构文档

PRD文档应包含以下章节：
- 需求背景
- 功能描述
- 技术方案
- 数据影响
- 接口设计
- 测试要点
```

**Markdown文件的frontmatter格式**（自动扫描时解析）：

```markdown
---
tags: [order, api, core, tpm]
description: 订单服务核心API接口文档，包含订单创建、查询、修改等接口定义
auto_inject: coding                    ← 在coding类型任务中自动推荐注入
---

# 订单服务API文档

## 订单创建接口
POST /api/v1/orders
...
```

**数据库索引表**（platform_knowledge_doc）：

```rust
// platform_knowledge_doc — 知识库文档索引（元数据层）
pub struct Model {
    pub id: i32,
    pub project_id: i32,                 // 所属项目
    pub doc_type: String,                // 文档类型: tech_doc/template/skill/prompt_template/requirement/ai_intermediate
    pub title: String,                   // 文档标题（从frontmatter或文件名提取）
    pub file_path: String,               // 知识库仓库中的文件路径（相对于仓库根目录）
    pub is_shared: bool,                 // 是否共享（git追踪 vs .private/私有）
    pub tags_json: Option<String>,       // 标签(JSON数组): ["order", "api", "core"]
    pub description: Option<String>,     // 文档摘要/描述（从frontmatter提取或手动补充）
    pub auto_inject: Option<String>,     // 在哪些任务类型中自动推荐注入(JSON数组): ["coding", "code_review"]
                                          // NULL表示不自动推荐，需手动选择
    pub skill_name: Option<String>,      // 关联的Skill名称（如果是Skill相关文档）
    pub last_scanned_at: DateTimeUtc,    // 最后扫描时间（用于增量扫描）
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}
```

**索引机制**：
- **自动扫描**：每次同步知识库时扫描git仓库文件，自动创建/更新索引记录
  - 自动提取：路径、类型（从目录推断）、标题（从文件名或frontmatter提取）
  - frontmatter解析：从Markdown文件的YAML frontmatter自动提取tags、description、auto_inject
  - 非Markdown文件：只提取路径和类型，元数据在CodeG UI中手动补充
- **增量扫描**：只扫描 `last_scanned_at` 之后变化的文件，避免全量扫描
- **Skill发现**：扫描 `skills/` 目录下的 `skill.yaml` 文件，解析触发规则和注入列表

**AI中间产物流程**：
```
AI生成文档 → 自动保存到 .private/ai-intermediate/ → 自动索引到platform_knowledge_doc(is_shared=false)
  ↓
开发者审核 → 确认后可"发布" → 文件移动到共享目录 → 更新索引(is_shared=true)
  ↓
发布后其他团队成员通过git也能看到此文档
```

**Skill触发与📋浮动面板联动**：
```
任务类型 = coding
  ↓ 自动匹配 skills/code-review/（如果trigger.task_type包含coding）
  ↓
📋浮动面板中自动勾选:
  ✅ 代码模板库 (auto_inject: coding, 从frontmatter)
  ✅ API文档    (auto_inject: coding, 从frontmatter)
  ✅ Code Review Skill Prompt (从skill.yaml的inject列表)
  ⬜ 测试规范   (auto_inject: unit_test, 不匹配当前类型)
  ↓
开发者确认/调整 → 注入上下文 → AI基于丰富上下文执行任务
```

### 2.4 活动日志与密钥安全

**密钥安全策略**：Token/密钥不存储在SQLite数据库中，而是利用CodeG现有的`keyring_store`基础设施：
- 桌面模式：使用OS密钥环（`keyring::Entry`）
- 服务器模式：使用文件级加密存储
- `platform_credential`表只记录关联关系（credential_type + keyring中的account_id），不存储明文
- `platform_global_config`只存非敏感配置（API地址、默认项目ID等），不含Token

**活动日志**（Phase 2实现）：

```rust
// platform_activity_log — 操作审计日志
pub struct Model {
    pub id: i32,
    pub project_id: i32,                 // 所属项目
    pub task_id: Option<i32>,            // 关联任务（可选）
    pub action: String,                  // 操作类型: task_status_changed/task_assigned/
                                          //   conversation_linked/zentao_synced/doc_published/
                                          //   delegation_triggered/agent_config_changed
    pub actor: Option<String>,           // 操作人（单机模式可为空）
    pub detail_json: Option<String>,     // 操作详情(JSON)
                                          // 如: {from: "in_progress", to: "done"}
                                          // 或: {synced_tasks: [1,2,3], direction: "pull"}
    pub created_at: DateTimeUtc,
}
```

**DB Migration命名规范**：使用独立编号空间，避免与上游CodeG新迁移冲突：
```
m20260620_platform_000001_create_project_and_task
m20260620_platform_000002_create_credential_and_log
```
日期使用预计merge日期，`_platform_`前缀做区分。

### 3.1 禅道双向同步

**架构**：独立的 `integration/zentao` 模块，通过禅道企业版 REST API 操作。

**同步时机**：手动触发，双向同步
- **从禅道同步到本地**：开发者点击"从禅道同步"按钮，拉取禅道任务列表到本地
- **从本地同步到禅道**：开发者点击"推送禅道"按钮，将本地创建/修改的任务推送到禅道

**字段映射范围**：
- **核心字段**（双向同步）：标题、描述、类型、状态、优先级、指派
- **禅道扩展字段**（禅道→本地单向同步）：截止日期、预估工时、已消耗工时、所属模块
- **本地AI字段**（仅本地）：kb_refs_json、affected_repos_json、任务对话关联

**冲突处理**：当本地和禅道的数据冲突时（两边都修改了同一个字段），弹出冲突解决面板让开发者手动选择保留本地版本、禅道版本或手动合并。

```
状态双向映射:
  本地 backlog   ↔ 禅道 story/wait
  本地 confirmed  ↔ 禅道 story/activated
  本地 in_progress ↔ 禅道 task/doing 或 bug/active
  本地 done       ↔ 禅道 task/done 或 bug/fixed
  本地 released   ↔ 禅道 story/closed
```

**关键配置**：
- 禅道 API 地址和 Token
- 禅道项目ID / 产品ID映射
- 任务类型映射规则（`platform_task_type_mapping`表）
- 同步方向控制（哪些字段本地→禅道，哪些禅道→本地）

### 3.2 GitLab集成

- 通过GitLab REST API：获取仓库信息、分支列表、创建MR、查看commit
- 不替代git本地操作，而是作为**远程仓库管理补充**
- 关键功能：创建任务分支、MR创建、分支策略管理

### 3.3 Jenkins集成

- 通过Jenkins REST API：触发构建、查看构建状态、获取构建日志
- 任务状态"待发版"→触发Jenkins构建流水线

### 3.4 MCP增强路径（Phase 4+）

当前采用自定义REST方案实现外部系统集成（人可控、开发量可控）。但CodeG有完善的MCP server管理系统（`src-tauri/src/commands/mcp.rs`），Phase 4+可评估将禅道/GitLab/Jenkins的集成方式从自定义REST迁移到MCP Server：
- 禅道MCP Server → agent直接通过工具操作禅道（自主决策何时同步）
- GitLab MCP Server → agent自主管理仓库/MR
- Jenkins MCP Server → agent触发构建/查看状态
- `platform_project`增加`mcp_server_ids`字段，关联项目启用的MCP servers

MCP方案的核心价值：agent可以自主决策调用外部系统，不需要前端专门为每个外部系统写操作UI。但MCP Server本身是独立项目需开发，Phase 4+再评估可行性。

---

## 四、AI研发流程设计

### 4.1 核心交互流程

**AI执行不在任务页面，而在会话页面**：

```
┌─────────── 任务模式 ───────────┐      ┌─────────── 聊天模式 ───────────┐
│                                │      │                                │
│  1. 选中任务                    │      │  5. 在会话中与AI对话完成任务      │
│  2. 点击"开始对话"              │ ──→  │  6. 通过📋按钮注入任务上下文     │
│     → 自动创建/跳转到会话       │      │  7. 人与AI交互，逐步完成任务      │
│  3. 查看任务的历史对话列表       │      │  8. 完成后手动更新任务状态        │
│  4. 管理任务信息/状态            │      │                                │
│                                │      │  或者:                          │
│                                │      │  先自由聊天→后关联/创建任务       │
└────────────────────────────────┘      └────────────────────────────────┘
```

### 4.2 Delegation多智能体委托集成

CodeG最核心的差异化能力是`codeg-mcp` + `DelegationBroker`组成的多智能体委托系统（`src-tauri/src/acp/delegation/`）。研发平台模块需利用此能力，而非另起一套委托机制。

**Delegation在任务场景中的应用**：

- **coding任务**：父agent做实现 → 自动派生子agent做code review
- **需求拆解**：父agent分析需求 → 派生子agent并行生成多个子任务的PRD
- **测试任务**：父agent写测试 → 派生子agent运行测试并分析结果
- **agent根据任务复杂度自动判断**是否需要派生子agent

**配置层级**：
1. **项目级**（`platform_project.delegation_config`）：设定项目默认委托行为，如最大深度、自动委托开关、默认子agent类型
2. **任务级**（`platform_task.delegation_config`）：per-task覆盖项目级配置，如某任务明确需要深度委托或不需要委托

**📋注入面板集成**：确认注入时可选勾选"启动此任务时派生子agent"，配置子agent类型和深度，利用`DelegationBroker`的`delegate()` API执行委托。

**Skills/Experts共存策略**：知识库`skills/`目录作为**团队级Skill仓库**，与CodeG个人级`~/.codeg/skills/`的bundled experts并存：
- 📋面板推荐注入时，同时考虑两边的skill
- 知识库Skill主要起**团队同步**作用（团队共享的Prompt模板和触发规则）
- 核心执行仍用CodeG现有Skills系统（bundled experts + 用户个人skills）
- `platform_knowledge_doc.skill_name`字段兼容关联到现有expert的name

```
┌─ 会话输入框 (Composer) ────────────────────────────────────┐
│                                                            │
│  [输入消息...]                              [📎] [📋] [发送] │
│                               ↑ 任务上下文按钮              │
└────────────────────────────────────────────────────────────┘

点击 📋 后弹出浮动面板：

┌─ 📋 任务上下文 ──────────────────────────────────────┐
│                                                      │
│  ─── 当前任务 ────                                    │
│  📌 订单服务改造 (#coding, 处理中)                     │
│  项目: TPM-A项目                                      │
│                                                      │
│  ─── 推荐注入 ──── (AI根据任务类型自动推荐)             │
│  ✅ 项目技术栈信息 (Java/Spring Boot/MySQL)            │
│  ✅ 订单服务API文档                                   │
│  ✅ 代码模板库 (Spring Boot Service模板)               │
│  ⬜ 测试规范                                          │
│  ⬜ 数据库设计文档                                    │
│                                                      │
│  ─── 任务详情 ────                                    │
│  ✅ 任务描述 (自动注入)                                │
│  ⬜ 父任务需求 (优惠规则配置的详细需求)                  │
│  ⬜ 禅道原始需求文档                                   │
│                                                      │
│  ─── 更多文档 ──── [+ 添加]                           │
│                                                      │
│  [✓ 确认注入]  [✕ 取消]                               │
│                                                      │
│  注入方式: 简短内容作为用户消息发送，长文档只给路径让AI读取 │
└──────────────────────────────────────────────────────┘
```

**浮动面板分四块**：
1. **推荐注入**：AI按任务类型自动推荐知识库文档和现有Experts Skills，默认勾选相关度高的
2. **任务详情**：当前任务描述（自动勾选）+ 可选父任务需求和禅道原文
3. **更多文档**：手动搜索添加知识库中的其他文档
4. **Delegation选项**：勾选"启动此任务时派生子agent"，配置子agent类型和深度

**关键特性**：
- 开发者随时可以打开/关闭📋按钮增减上下文
- **上下文注入方式**：简短内容（任务描述、Skill提示词）作为用户消息inline发送；长内容（文档、CLAUDE.md）只给文件路径，让agent自己按需读取
- 注入的文档列表记录到`platform_task_conversation.injected_docs_json`，便于追溯
- 📋面板推荐注入时，同时考虑现有Experts Skills和知识库Skills（两者共存）
- 自由对话模式下，📋按钮也可以用来"关联/创建任务"
- 确认注入后，会话自动关联到 `platform_task_conversation` 表

### 4.3 自由对话→任务创建流程

```
开发者自由对话 → 点击📋按钮 → 选择"关联已有任务"或"创建新任务"
                                                  ↓
                              关联已有任务: 选择任务列表中的任务 → 对话自动关联
                              创建新任务: 弹出简表(标题/类型/项目) → 创建后自动关联
```

### 4.4 任务详情页设计（纯信息管理，不执行AI）

```
┌──────────────────────────────────────────────────────┐
│  任务详情                                              │
│  ┌─ 基本信息 ──────────────────────────────────────┐ │
│  │ 标题: 订单服务改造                                │ │
│  │ 类型: coding | 状态: 处理中 | 优先级: 高          │ │
│  │ 禅道: #1234 (已同步) | 父任务: 优惠规则配置        │ │
│  │ 指派: 张三                                        │ │
│  │ 描述: [查看/编辑任务描述]                          │ │
│  └──────────────────────────────────────────────────│ │
│                                                      │
│  ┌─ 关联对话 ──────────────────────────────────────┐ │
│  │ 💬 Conv#1: 分析现有代码        (6/21)  [打开对话] │ │
│  │ 💬 Conv#2: 实现API改造         (6/22)  [打开对话] │ │
│  │ 💬 Conv#3: 代码审查            (6/23)  [打开对话] │ │
│  │                                                 │ │
│  │ [+ 新建对话]  → 跳转到会话页面，自动注入任务上下文 │ │
│  └──────────────────────────────────────────────────│ │
│                                                      │
│  ┌─ 关联仓库 ──────────────────────────────────────┐ │
│  │ 📦 order-service  (分支: feature/order-refactor) │ │
│  │ 📦 frontend       (分支: feature/order-ui)       │ │
│  │ 📦 gateway        (分支: main)                    │ │
│  └──────────────────────────────────────────────────│ │
│                                                      │
│  ┌─ 状态管理 ──────────────────────────────────────┐ │
│  │ [← 待办] [已确认 →] [处理中 →] [完成 →] [待发版 →]│ │
│  │                                                 │ │
│  │ [同步禅道]  [推送到禅道]                          │ │
│  └──────────────────────────────────────────────────│ │
└──────────────────────────────────────────────────────┘
```

### 4.5 任务类型的AI行为适配

| 本地类型 | 禅道映射 | AI行为 | 推荐注入上下文 |
|---------|---------|--------|-----------|
| requirement | story | 分析需求，提取关键信息 | 需求模板、客户信息 |
| prd | story | 生成PRD文档草案 | 需求原文、PRD模板、产品架构文档 |
| design | task | 生成技术设计方案 | 架构文档、技术栈信息、相关API文档 |
| db_design | task | 生成数据库设计 | DB规范、现有表结构文档 |
| coding | task | 生成代码实现 | 代码模板、组件库、API文档、技术规范 |
| code_review | task | 审查代码质量 | 代码规范、审查清单 |
| unit_test | task | 生成单元测试 | 测试规范、被测代码 |
| integration_test | task | 生成集成测试 | 测试规范、接口文档 |
| doc_generation | task | 生成文档 | 文档模板、源代码 |
| release | story | 发版操作 | CI/CD配置、发版清单 |
| bug | bug | 定位修复Bug | Bug描述、相关代码、历史修复记录 |

---

## 五、前端UI设计

### 5.1 侧边栏设计（双页签：Chat + Project）

**核心原则**：Chat页签完全保留现有侧边栏功能，不做任何修改。Project页签是新增的独立内容区域。通过页签切换器在两种模式间切换。

```
┌─ 页签切换器（在Title Bar区域顶部）───┐
│  💬 Chat  |  📋 Project              │ ← 新增页签行，替代原Title Bar位置
├──────────────────────────────────────┤
│                                      │
│  === Chat页签（现有功能完全不变）===   │
│                                      │
│  [CodeG标题] [🔍] [展开] [筛选]      │ ← 现有Title Bar操作按钮保留
│  [New Chat]  [Search]               │ ← 现有固定按钮保留
│                                      │
│  ▸ Pinned                           │ ← 现有分组完全不变
│  ▸ Folder1 (3 convos)               │ ← 现有Folder会话列表不变
│  ▸ Folder2 (1 convo)                │
│  ▸ Chats                            │
│                                      │
│  ⚠️ 以上所有内容与现有CodeG完全相同    │
│  ⚠️ 不修改任何现有组件                │
│                                      │
│  === Project页签（新增内容）===        │
│                                      │
│  [选择项目... ▼]                     │ ← 项目下拉选择器
│                                      │
│  📋 任务看板                         │ ← 点击→中间区域显示看板
│                                      │
│  ┌─ 会话列表（项目视角） ──────────┐ │
│  │                                 │ │
│  │ 📋 订单改造 ← 任务:开发         │ │ ← 关联了任务（有任务标签）
│  │ 📋 代码审查 ← 任务:审查         │ │ ← 关联了任务
│  │ 💬 分析前端代码  [📋关联]        │ │ ← 在仓库Folder，未关联任务
│  │ 💬 调试Bug     [📋关联]         │ │ ← 未关联任务，可随时关联
│  │                                 │ │
│  │ 统一列表：                       │ │
│  │ - 所有项目关联仓库下的对话       │ │
│  │ - 所有任务关联的对话             │ │
│  │ - 已关联任务的对话显示任务标签   │ │
│  │ - 未关联的对话显示"📋关联"按钮   │ │
│  │ - 按时间排序                    │ │
│  │                                 │ │
│  └──────────────────────────────── │ │
│                                      │
│  [新建任务对话]  [新建自由对话]        │ ← 两种新建入口
│                                      │
└──────────────────────────────────────┘
```

**关键设计要点**：
1. Chat页签中所有内容（Title Bar按钮、New Chat/Search按钮、Pinned/Folders/Chats分组、Conversation卡片）**与现有CodeG完全相同，不做任何修改**
2. 页签切换器是唯一新增的UI元素，放在原Title Bar的位置
3. Chat页签时，原有的Title Bar操作按钮（crosshair/展开折叠/筛选）保留在页签下方
4. Project页签时，项目下拉选择器替代Title Bar区域
5. 页签切换不影响主面板内容——两种页签下的对话都能在主面板中打开

### 5.2 任务看板（中间区域）

点击侧边栏"任务看板"→中间区域切换到看板视图：

```
┌─ 任务看板 ───────────────────────────────────────────────────────┐
│                                                                  │
│  [看板视图] | [列表视图] ← 可切换两种视图                          │
│                                                                  │
│  ─── 看板视图 ────                                                │
│                                                                  │
│  ┌─── 待办(3) ──┐  ┌─── 已确认(1) ──┐  ┌─── 处理中(2) ──┐      │
│  │              │  │              │  │              │        │
│  │ ▸优惠规则配置 │  │ ▸API接口设计  │  │ ▸订单服务改造 │        │
│  │  requirement │  │  design      │  │  coding      │        │
│  │              │  │              │  │              │        │
│  │ ▸数据迁移    │  │              │  │ ▸Bug排序异常  │        │
│  │  db_design   │  │              │  │  bug         │        │
│  │              │  │              │  │              │        │
│  └─── 可拖动 ───┘  └─── 可拖动 ───┘  └─── 可拖动 ───┘        │
│                                                                  │
│  ┌─── 完成(5) ──┐  ┌─── 待发版(1) ──┐                          │
│  │              │  │              │                                  │
│  │ ▸PRD文档生成 │  │ ▸用户认证模块 │                                │
│  │  doc_gen     │  │  release     │                                  │
│  │              │  │              │                                  │
│  └─── 可拖动 ───┘  └─── 可拖动 ───┘                              │
│                                                                  │
│  拖动任务卡片改变状态（看板视图）                                    │
│  或点击任务卡片进入任务详情页                                       │
│  任务详情页点击"新建对话"→跳转到会话页面                             │
│                                                                  │
│  ─── 列表视图 ────                                                │
│                                                                  │
│  [筛选: 类型▼ 状态▼ 优先级▼]                                      │
│  #1  优惠规则配置   requirement  待办    高   [详情] [新建对话]     │
│  #2  API接口设计    design       已确认   中   [详情] [新建对话]     │
│  #3  订单服务改造   coding       处理中   高   [详情] [新建对话]     │
│  #4  Bug排序异常    bug          处理中   低   [详情] [新建对话]     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 项目Folder与对话归属

**核心概念：项目Folder**

> 项目根目录就是一个普通CodeG Folder。不修改Folder模型，只是在创建项目时把用户选择的目录关联到Folder。

用户创建项目时选择本地目录 → 该目录就是项目Folder。如果目录已经是CodeG Folder则直接关联，否则通过CodeG现有的"打开目录"逻辑创建Folder后关联。`platform_project.folder_id`记录这个关联关系。

```
项目根目录: /workspace/tpm-client-A/
├── order-service/     ← CodeG Folder #1 (仓库Folder，有git)
├── frontend/          ← CodeG Folder #2 (仓库Folder，有git)
├── gateway/           ← CodeG Folder #3 (仓库Folder，有git)
└── (项目根目录本身)    ← CodeG Folder #4 (项目Folder)

"项目Folder"的特点:
  - 就是普通Folder（跟你打开目录创建的Folder完全一样）
  - path = 项目根目录路径
  - git_branch通常为null（项目根目录本身不是独立git仓库）
  - default_agent_type = 项目级默认agent类型
  - 作为所有任务对话的"归属地"
  - 侧边栏中显示项目名称
  - 前端识别到是项目Folder时：文件树切换多根视图、Git面板切换聚合视图
  - ACP连接以项目Folder的path作为cwd → 终端工作目录在项目根目录

对话归属规则:
  - 从任务创建的对话 → 属于项目Folder(folder_id = project.folder_id)
  - 自由对话（在某个仓库里） → 属于仓库Folder，传统模式
  - 自由对话→关联任务 → 仍在仓库Folder，但通过关联在项目会话列表中可见

所有现有机制自然工作:
  - 对话创建: CreateConversationParams需要folder_id → 项目Folder.id
  - ACP连接: 项目Folder的path作为cwd → 终端在项目根目录
  - Agent类型: 项目Folder的default_agent_type → 自动选agent
  - Chat页签: 项目Folder像其他Folder一样出现在侧边栏
```

### 5.4 多仓库Git集成（项目级Git协调）

**保留per-folder基础 + 新增项目级Git协调 + 勾选式批量操作**

```
┌─ AuxPanel Git（项目模式） ─────────────────────┐
│                                                 │
│  [单仓库视图] | [项目聚合视图]                    │ ← 视图切换
│                                                 │
│  ─── 项目聚合视图 ────                           │
│                                                 │
│  📦 order-service  2 changed, 1 staged          │ ← 各仓库状态摘要
│  📦 frontend       5 changed, 0 staged          │
│  📦 gateway         clean                       │
│  ──────────────────────                         │
│  📊 项目总计: 7 changes across 2 repos          │
│                                                 │
│  项目级操作:                                      │
│  [🔄 创建任务分支] ← 在affected_repos创建同名分支 │
│  [📤 项目级Push]  ← 推送所有仓库的任务分支        │
│                                                 │
│  ─── 批量操作面板 ────                            │
│  (详见下方批量Git操作设计)                         │
│                                                 │
│  ─── 单仓库视图（点击某个仓库） ────               │
│  （现有Git Changes/Log tab，针对选定仓库）         │
│                                                 │
└─────────────────────────────────────────────────┘
```

**勾选式批量Git操作**：任务完成后涉及多个仓库，需要批量提交/合并/推送，但不能无脑全提交。

```
┌─ 批量提交 ─────────────────────────────┐
│                                         │
│  选择提交范围:                           │
│  ☑ order-service  (3 changes)           │ ← 默认勾选任务affected_repos
│  ☑ frontend       (2 changes)           │
│  ☐ gateway         (clean)              │ ← 不涉及的仓库，不勾选
│  ☐ shared-lib      (1 change)           │ ← 其他仓库，可手动勾选
│                                         │
│  Commit message:                        │
│  [完成任务: 订单服务改造          ]       │
│                                         │
│  [批量提交选中仓库]  [批量推送选中仓库]     │
└─────────────────────────────────────────┘

┌─ 批量合并到目标分支 ────────────────────┐
│                                         │
│  选择合并范围:                           │
│  ☑ order-service  (branch: feat/123)    │ ← 默认勾选有任务分支的仓库
│  ☑ frontend       (branch: feat/123)    │
│                                         │
│  目标分支: [UAT                    ]     │
│                                         │
│  [批量合并选中仓库到UAT]                  │
└─────────────────────────────────────────┘
```

批量操作要点：
- 默认勾选 = 当前任务的`affected_repos_json`中的仓库
- 用户可手动增减勾选
- 每个仓库旁显示changes数量和当前分支
- 只有勾选的仓库参与批量操作
- 统一commit message（各仓库用同一消息）
- 精细操作：点击单个仓库 → 钻取到单仓库Git面板 → 用现有Git功能

### 5.5 多仓库文件树（项目模式）

**三种视图**：单仓库（经典）/ 项目多根 / 任务聚焦

```
┌─ AuxPanel 文件树 ────────────────────────────────┐
│                                                   │
│  [单仓库] | [项目多根] | [任务聚焦]                  │ ← 视图切换
│                                                   │
│  ─── 项目多根视图 ────                              │
│                                                   │
│  📦 order-service/                                 │ ← 每个仓库是根目录
│    ├── src/main/java/                              │
│    └── pom.xml                                     │
│  📦 frontend/                                      │
│    ├── src/components/                             │
│    └── package.json                                │
│  📦 gateway/                                       │
│    ├── src/                                        │
│    └── config.yml                                  │
│                                                   │
│  ─── 任务聚焦视图（选中任务后自动切换） ────          │
│                                                   │
│  📦 order-service/  ★ (任务涉及)                    │ ← affected_repos展开
│    ├── OrderService.java    ⚡ modified             │ ← 修改的文件高亮
│    ├── OrderController.java ⚡ modified             │
│    └── pom.xml                                     │
│  📦 frontend/  ★ (任务涉及)                         │
│    ├── OrderPage.tsx        ⚡ modified             │
│    └── package.json                                │
│  📦 gateway/  (折叠，未涉及)                         │ ← 不涉及的仓库折叠
│                                                   │
│  ─── 单仓库视图（不选项目时）───                      │
│  （现有文件树行为，显示当前Folder的文件）              │
│                                                   │
└───────────────────────────────────────────────────┘

视图切换规则:
  - 不选项目 → 单仓库视图（和现在完全一样）
  - 选项目但未选任务 → 项目多根视图（默认）
  - 选中任务 → 自动切换到任务聚焦视图
  - 开发者可随时手动切换视图
```

### 5.6 项目创建流程（快速创建+逐步补充+知识库初始化）

```
┌─ 项目创建 ───────────────────────────────────┐
│                                              │
│  Step 1: 快速创建                             │
│  ┌──────────────────────────────────────┐    │
│  │ 项目名称: [TPM-A项目]                  │    │
│  │ 本地根目录: [/workspace/tpm-client-A/] │    │ ← 选择目录后自动扫描git
│  │                                      │    │
│  │ 发现的仓库:                            │    │
│  │ ✅ order-service  (/order-service/)   │    │ ← 自动扫描发现
│  │ ✅ frontend       (/frontend/)        │    │
│  │ ✅ gateway        (/gateway/)         │    │
│  │ ⬜ shared-lib     (/shared/)          │    │ ← 可取消不需要的
│  │                                      │    │
│  │ [+ 手动添加不在根目录下的仓库]           │    │ ← 手动添加
│  │                                      │    │
│  │ 知识库设置:                            │    │
│  │ ⬜ 从GitLab克隆: [gitlab地址...]       │    │ ← 已有KB仓库时
│  │ ⬜ 本地自动初始化                       │    │ ← 没有KB仓库时，自动创建
│  │                                      │    │
│  │ [创建]                                │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  知识库自动初始化（选择"本地自动初始化"时）:      │
│  1. 在项目根目录下创建 _kb/ 子目录              │
│  2. 初始化git仓库                             │
│  3. 创建标准目录结构:                           │
│     docs/, templates/, skills/,               │
│     requirements/, .private/                   │
│  4. 创建 .gitignore (忽略 .private/)           │
│  5. 创建 README.md (项目名称+KB说明)            │
│  6. 创建初始commit                             │
│                                              │
│  知识库GitLab克隆（选择"从GitLab克隆"时）:       │
│  1. 从GitLab clone到项目根目录/_kb/             │
│  2. GitLab仓库名规则: {项目名}-kb               │
│  3. clone后自动扫描建立索引                     │
│                                              │
│  创建后跳转到项目详情页，逐步补充:               │
│  - 禅道项目ID/产品ID映射                       │
│  - CI/CD配置                                  │
│  - 技术栈信息                                  │
│  - KB远程仓库配置（本地初始化的KB可后续添加远程） │
│                                              │
└──────────────────────────────────────────────┘
```

**知识库文件系统位置**：

```
/workspace/tpm-client-A/          ← 项目根目录
  ├── order-service/              ← 代码仓库（git扫描发现）
  ├── frontend/                   ← 代码仓库
  ├── gateway/                    ← 代码仓库
  └── _kb/                        ← 知识库仓库（git扫描排除）
      ├── docs/                   ← 技术文档
      ├── templates/              ← 产品模板
      ├── skills/                 ← AI Skill
      ├── requirements/           ← 需求材料
      ├── .private/               ← 本地私有区(git忽略)
      ├── .gitignore              ← 忽略 .private/
      └── README.md               ← 知识库说明

GitLab远程仓库命名规则: {项目名}-kb
  例如: https://gitlab.company.com/group/tpm-client-a-kb
```

**git扫描排除规则**：扫描项目根目录时，跳过 `_kb/` 目录（知识库仓库）

### 5.7 知识库管理

```
┌─ 项目详情页 - 知识库部分 ──────────────────────┐
│                                                │
│  📚 知识库                                      │
│  ┌──────────────────────────────────────┐      │
│  │ 状态: 已初始化 (本地)                    │      │
│  │ 路径: /workspace/tpm-client-A/_kb/     │      │
│  │ GitLab: 未配置远程 ← [配置远程仓库]      │      │ ← 本地KB可后续添加远程
│  │                                      │      │
│  │ 文档统计:                              │      │
│  │  技术文档: 12 | 模板: 3 | Skill: 4     │      │
│  │  需求材料: 8 | AI产物: 5(私有)          │      │
│  │                                      │      │
│  │ [刷新索引] ← 手动触发扫描知识库文件      │      │
│  │ [打开知识库目录] ← 用外部编辑器打开      │      │
│  │ [推送到GitLab] ← 本地KB推送到远程       │      │
│  │ [从GitLab同步] ← 远程KB拉取到本地       │      │
│  └──────────────────────────────────────┘      │
│                                                │
│  ┌─ 文档浏览 ───────────────────────────┐      │
│  │ (CodeG内浏览，外部编辑)               │      │
│  │                                      │      │
│  │ 📂 docs/                              │      │
│  │   📂 architecture/                    │      │
│  │     📄 product-arch.md ← [查看]       │      │ ← 在CodeG内预览
│  │   📂 api/                             │      │
│  │     📄 order-service-api.md ← [查看]  │      │
│  │ 📂 templates/                         │      │
│  │ 📂 skills/                            │      │
│  │   📂 generate-prd/                    │      │
│  │     📄 skill.yaml ← [查看]            │      │
│  │     📄 template.md ← [查看]           │      │
│  │ 📂 .private/                          │      │ ← 私有区可见但标为私有
│  │   📂 ai-intermediate/                 │      │
│  │     📄 prd-draft.md 🔒 ← [查看/发布]  │      │ ← 可"发布"到共享区
│  │                                      │      │
│  │ [在编辑器中打开] ← 用外部编辑器打开目录  │      │
│  └──────────────────────────────────────┘      │
│                                                │
│  ┌─ AI产物管理 ─────────────────────────┐      │
│  │                                      │      │
│  │ 📄 PRD草案-优惠规则 (6/21) 🔒         │      │ ← 私有，可发布
│  │ 📄 设计方案-订单改造 (6/22) 🔒         │      │ ← 私有，可发布
│  │                                      │      │
│  │ [发布到共享区] → 文件从.private/移动    │      │
│  │                   到docs/或requirements/│      │
│  │                   + 更新索引为is_shared │      │
│  │                                      │      │
│  └──────────────────────────────────────┘      │
│                                                │
└────────────────────────────────────────────────┘
```

### 5.8 禅道同步交互

```
┌─ 禅道同步 ───────────────────────────────────┐
│                                              │
│  [从禅道同步到本地] ← 手动触发拉取              │
│  [从本地同步到禅道] ← 手动触发推送              │
│                                              │
│  同步冲突时弹出选择面板:                        │
│  ┌─ 冲突解决 ─────────────────────────┐      │
│  │                                     │      │
│  │ 任务标题冲突:                        │      │
│  │  本地: "订单服务改造-v2"              │      │
│  │  禅道: "订单服务改造(原始)"            │      │
│  │  [保留本地] [保留禅道] [手动合并]      │      │
│  │                                     │      │
│  │ 状态冲突:                            │      │
│  │  本地: 处理中                         │      │
│  │  禅道: 已关闭                         │      │
│  │  [保留本地] [保留禅道]                │      │
│  │                                     │      │
│  └───────────────────────────────────── │      │
│                                              │
│  同步字段范围:                                 │
│  - 核心字段: 标题、描述、类型、状态、优先级、指派 │
│  - 禅道扩展: 截止日期、预估工时、所属模块        │
│                                              │
└──────────────────────────────────────────────┘
```

---

### 5.9 任务→对话创建流程

**全自动创建+自动注入+跳转**（MVP最简流程）

```
点击“新建对话”后的完整流程:

1. 创建新Conversation
   - folder_id = 项目Folder的ID
   - title = "订单服务改造 #1" (任务标题+序号)
   - agent_type = 项目default_agent_type (如 "claude")

2. 自动注入任务上下文（作为system消息）
   - 任务描述、项目信息
   - 相关仓库的CLAUDE.md内容（如果has_claude_md=true）
   - Skill匹配：如果任务类型匹配某个Skill的trigger，自动注入Skill的Prompt模板
   - 知识库文档：根据auto_inject字段自动勾选推荐文档

3. 跳转到会话页面
   - 活跃对话切换为新创建的对话
   - 主面板显示对话界面
   - 开发者可以开始与AI对话

4. 自动关联任务
   - platform_task_conversation表自动创建关联记录
   - conversation_role = 根据任务类型推断（如coding→implementation）

对话标题规则: 任务标题 + 序号
  同一任务的第一个对话: "订单服务改造 #1"
  同一个任务的第二个对话: "订单服务改造 #2"
  序号从platform_task_conversation表的记录数自动计算
```

### 5.10 需求自动拆解流程

**对话中指令触发 + 弹出确认面板**

```
触发方式: 开发者在对话中对AI说"请帮我拆解这个任务"
  ↓
AI分析当前任务描述和项目上下文
  ↓
AI生成拆解方案（拟创建的子任务列表）
  ↓
弹出确认面板，开发者可以调整:

┌─ AI拆解方案 ──────────────────────────────────┐
│                                                │
│  源任务: 优惠规则配置 (requirement)              │
│                                                │
│  AI建议拆解为以下子任务:                         │
│                                                │
│  ✅ #1 技术设计 (design)                        │ ← 可取消
│     描述: 设计优惠规则的数据库表和服务接口        │ ← 可修改
│  ✅ #2 后端开发 (coding)                        │
│     描述: 实现优惠规则服务API                    │
│  ✅ #3 前端开发 (coding)                        │
│     描述: 开发优惠规则配置页面                   │
│  ⬜ #4 单元测试 (unit_test)                     │ ← 取消
│  ✅ #5 数据库迁移 (db_design)                   │
│     描述: 优惠规则表迁移脚本                    │
│                                                │
│  [+ 添加更多子任务]                              │
│                                                │
│  禅道映射预览:                                   │
│  design → task | coding → task | db_design → task │
│                                                │
│  [确认创建]  [取消]                              │
│                                                │
│  确认后将:                                       │
│  1. 创建4个子任务（父任务=优惠规则配置）          │
│  2. 子任务affected_repos自动填充（基于父任务）   │
│  3. 记录到platform_task_decomposition表          │
│  4. 可选推送到禅道                               │
└────────────────────────────────────────────────┘
```

### 5.11 终端设计

**项目模式：单终端在项目根目录**

```
项目模式下:
  - 终端工作目录 = 项目根目录 (如 /workspace/tpm-client-A/)
  - 开发者可以cd到各子目录 (如 cd order-service/)
  - 和现有CodeG的终端体验完全一致，只是工作目录变了
  - 不选项目时: 终端工作目录 = 当前active Folder (和现在一样)

这是最简方案，后续可以扩展多终端支持。
```

### 5.12 项目详情页设计（标签页分组）

```
┌─ 项目详情页 ────────────────────────────────────────┐
│                                                      │
│  [基本信息] [仓库列表] [禅道配置] [CI/CD] [知识库]    │ ← 5个标签页
│                                                      │
│  ─── 基本信息 标签 ────                               │
│  ┌──────────────────────────────────────────┐        │
│  │ 项目名称: TPM-A项目                       │        │
│  │ 客户名称: XX快消客户                       │        │
│  │ 状态: 开发中                              │        │
│  │ 根目录: /workspace/tpm-client-A/          │        │
│  │ 默认Agent: Claude                        │        │
│  │                                          │        │
│  │ CLAUDE.md检测:                            │        │
│  │ ✅ order-service/CLAUDE.md (已检测)       │        │
│  │ ✅ frontend/CLAUDE.md (已检测)            │        │
│  │ ❌ gateway/ (未检测，建议创建)             │        │
│  │ ✅ 项目根目录/CLAUDE.md (已检测)          │        │
│  │                                          │        │
│  │ [保存]                                   │        │
│  └──────────────────────────────────────────┘        │
│                                                      │
│  ─── 仓库列表 标签 ────                               │
│  ┌──────────────────────────────────────────┐        │
│  │ order-service | git_url | branch | Folder │        │
│  │ frontend      | git_url | branch | Folder │        │
│  │ gateway       | git_url | branch | Folder │        │
│  │                                          │        │
│  │ [+ 手动添加仓库] [重新扫描根目录]          │        │
│  └──────────────────────────────────────────┘        │
│                                                      │
│  ─── 禅道配置 标签 ────                               │
│  ┌──────────────────────────────────────────┐        │
│  │ 全局禅道配置 (Settings页配置):             │        │
│  │ API地址: https://zentao.company.com       │        │
│  │ Token: [已配置(通过keyring_store)]         │        │
│  │                                          │        │
│  │ 项目级禅道映射 (可覆盖全局默认):           │        │
│  │ 禅道项目ID: [42]                          │        │
│  │ 禅道产品ID: [7]                           │        │
│  │ 项目级API覆盖: [不覆盖 / 自定义]           │        │
│  │                                          │        │
│  │ 任务类型映射:                              │        │
│  │ requirement → story                      │        │
│  │ prd → story                              │        │
│  │ coding → task                            │        │
│  │ bug → bug                                │        │
│  │ ...                                      │        │
│  │                                          │        │
│  │ [同步禅道] [推送到禅道]                    │        │
│  └──────────────────────────────────────────┘        │
│                                                      │
│  ─── CI/CD 标签 ────                                 │
│  ┌──────────────────────────────────────────┐        │
│  │ Jenkins地址: http://jenkins.company.com   │        │
│  │ 构建任务: [选择Jenkins任务]               │        │
│  │ 部署环境: 测试/预发/生产                   │        │
│  └──────────────────────────────────────────┘        │
│                                                      │
│  ─── 知识库 标签 ──── ← (见5.7节详细设计)            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**禅道全局配置位置**：
- 全局禅道配置（API地址、Token）在CodeG Settings页面中配置（类似现有的settings页面）
- 项目级禅道映射在项目详情页的"禅道配置"标签中配置
- 配置策略: 全局默认 + 项目级可覆盖

## 六、分阶段落地计划

### Phase 1a: DB迁移 + Rust层（Project/Task CRUD）—— 约1周

**目标**：数据基础设施就绪——所有表、Entity、Service、Command、Web Handler层完成。

**具体内容**：
1. DB迁移（使用`_platform_`编号空间）：platform_project, platform_project_repo, platform_task, platform_task_type_mapping, platform_task_conversation, platform_global_config, platform_credential, platform_activity_log(仅建表)
2. Entity + Service层（所有platform_* 表的CRUD）
3. Rust 命令层（project/task CRUD + Web Handler）
4. 集成点：lib.rs, app_state.rs, commands/mod.rs, db/entities/mod.rs, db/service/mod.rs, db/migration/mod.rs, models/mod.rs, web/handlers/mod.rs, web/router.rs
5. Model层（DTO + 请求/响应类型）

**验证**：`cargo check` + `cargo test --features test-utils` 通过

### Phase 1b: 前端页面 + Sidebar双页签 + 项目/任务交互 —— 约1周

**目标**：UI基础就绪——能创建项目、管理任务、侧边栏切换Chat/Project。

**具体内容**：
1. 前端类型定义（`src/lib/platform/types.ts`，独立维护不膨胀types.ts）
2. 侧边栏双页签（Title Bar区域Chat/Project切换器）+ workspace layout适配
3. Project页签：项目下拉选择器 + 任务看板入口 + 会话列表（统一列表+任务标签）
4. 项目创建流程（快速创建：名称+根目录+扫描 → 详情页补充）
5. 任务列表/详情页（看板视图 + 列表视图切换）
6. 项目详情页（基本信息/仓库列表标签，禅道配置和CI/CD标签后续）
7. 虚拟项目Folder创建逻辑（创建项目时同步创建Folder，关联folder_id）

**验证**：`pnpm dev` 页面正常渲染，项目/任务CRUD UI可用

### Phase 1c: 禅道同步 + Composer📋 + 任务关联 —— 约1-2周

**目标**：最小闭环完成——能从禅道拉取任务，选中任务跳转会话，📋注入上下文，与AI对话完成任务。

**具体内容**：
1. 禅道双向同步（integration/zentao模块 + 禅道API调用 + 冲突解决UI）
2. 密钥管理（keyring_store集成 + platform_credential表关联）
3. Composer 📋按钮 + 任务上下文浮动面板（推荐注入/任务详情/更多文档/Delegation选项）
4. 上下文注入：用户消息+路径引用方案（简短内容inline，长内容只给路径）
5. 任务→对话自动创建+跳转（platform_task_conversation关联 + injected_docs_json记录）
6. 自由对话→关联/创建任务（📋按钮中支持）
7. 对话角色标记（analysis/implementation/review/test/discussion）
8. i18n：MVP只维护en.json + zh-CN.json，其余语言英文fallback

**验证**：完整MVP流程跑通（创建项目→禅道同步→选中任务→📋注入→AI对话→完成任务）

**Phase 1 完整文件清单**：
```
新增：
  src-tauri/src/platform/mod.rs
  src-tauri/src/platform/project/mod.rs, manager.rs, types.rs
  src-tauri/src/platform/task/mod.rs, manager.rs, types.rs
  src-tauri/src/platform/integration/mod.rs, zentao.rs
  src-tauri/src/db/entities/platform_project.rs
  src-tauri/src/db/entities/platform_project_repo.rs
  src-tauri/src/db/entities/platform_task.rs
  src-tauri/src/db/entities/platform_task_type_mapping.rs
  src-tauri/src/db/entities/platform_task_conversation.rs
  src-tauri/src/db/entities/platform_global_config.rs
  src-tauri/src/db/entities/platform_credential.rs
  src-tauri/src/db/entities/platform_activity_log.rs
  src-tauri/src/db/service/platform_project_service.rs
  src-tauri/src/db/service/platform_project_repo_service.rs
  src-tauri/src/db/service/platform_task_service.rs
  src-tauri/src/db/service/platform_task_type_mapping_service.rs
  src-tauri/src/db/service/platform_task_conversation_service.rs
  src-tauri/src/db/service/platform_global_config_service.rs
  src-tauri/src/db/service/platform_credential_service.rs
  src-tauri/src/db/migration/m20260620_platform_000001_create_project_and_task.rs
  src-tauri/src/db/migration/m20260620_platform_000002_create_credential_and_log.rs
  src-tauri/src/models/platform_project.rs
  src-tauri/src/models/platform_task.rs
  src-tauri/src/commands/project.rs
  src-tauri/src/commands/task.rs
  src-tauri/src/web/handlers/project.rs
  src-tauri/src/web/handlers/task.rs
  src/app/platform/projects/page.tsx
  src/app/platform/tasks/page.tsx
  src/components/platform/task-list.tsx
  src/components/platform/task-detail.tsx
  src/components/platform/task-conversation-list.tsx
  src/components/platform/project-selector.tsx
  src/components/platform/tab-switcher.tsx
  src/components/platform/context-inject-panel.tsx     ← 📋浮动面板
  src/components/platform/conversation-task-link.tsx    ← 会话列表的关联按钮
  src/hooks/platform/use-project.ts
  src/hooks/platform/use-task.ts
  src/hooks/platform/use-task-conversation.ts
  src/hooks/platform/use-zentao-sync.ts
  src/hooks/platform/use-context-inject.ts
  src/lib/platform/api.ts
  src/lib/platform/types.ts                            ← 独立类型文件

修改（集成点）：
  src-tauri/src/lib.rs                    ← 添加 pub mod platform; + 命令注册（末尾追加）
  src-tauri/src/app_state.rs              ← 添加 platform managers（末尾追加）
  src-tauri/src/commands/mod.rs           ← 添加 pub mod project; pub mod task;（末尾追加）
  src-tauri/src/db/entities/mod.rs        ← 添加 platform_* 模块声明（末尾追加）
  src-tauri/src/db/service/mod.rs         ← 添加 platform_* 模块声明（末尾追加）
  src-tauri/src/db/migration/mod.rs       ← 添加迁移注册（末尾追加）
  src-tauri/src/models/mod.rs             ← 添加 platform_* 模块声明（末尾追加）
  src-tauri/src/web/handlers/mod.rs       ← 添加 project/task handlers（末尾追加）
  src-tauri/src/web/router.rs             ← 添加 platform 路由块（末尾追加）
  src/components/layout/sidebar.tsx       ← 添加 <PlatformTabSwitcher /> 插槽
  src/components/chat/composer/ 相关      ← 添加 📋 <PlatformContextButton /> + 浮动面板入口
  src/app/workspace/layout.tsx            ← 添加 platform 路由 + 双页签逻辑
  src/i18n/messages/en.json               ← 英文翻译（MVP必须）
  src/i18n/messages/zh-CN.json            ← 中文翻译（MVP必须）
```

### Phase 2: AI流程增强（Delegation + 需求拆解 + agent适配 + 活动日志）—— 约2周

1. Delegation集成：利用DelegationBroker的delegate() API，📋面板增加"派生子agent"选项
2. 需求自动拆解：选中需求→AI分析→自动创建子任务→关联父任务→可选推送到禅道
3. 多Agent适配：per-task-type agent绑定（agent_config_json），📋注入时按目标agent自适应调整
4. AI上下文智能推荐：根据任务类型自动推荐知识库文档+Experts Skills，在📋浮动面板中预勾选
5. 活动日志实现：platform_activity_log表的CRUD + 关键操作触发日志记录
6. Chat Channel通知：task_state_change → chat_channel_broadcast（可选）

### Phase 3: 知识库管理 —— 约2周

1. 知识库git仓库管理（clone、sync、文件浏览）
2. 文档索引和分类（全量扫描 → Phase 4+增量扫描）
3. Markdown frontmatter自动解析（tags/description/auto_inject）
4. 知识库文档编辑器（Markdown编辑+预览）
5. AI中间产物管理（AI生成的PRD草案、设计方案等保存到知识库私有区）
6. Skills模板管理（skill.yaml + template.md）与现有Experts Skills的共存集成

### Phase 4: 外部集成深化（GitLab + Jenkins） + MCP增强路径 —— 约1-2周

1. GitLab集成（REST）：仓库管理、分支策略、MR创建、勾选式批量Git操作
2. Jenkins集成（REST）：构建触发、状态查看
3. 状态触发自动化：任务状态变化→自动创建分支/触发构建
4. MCP增强路径评估：评估禅道/GitLab/Jenkins MCP Server可行性，替代部分REST集成

### Phase 5: 团队扩展 + 远程工作区 —— 后续

1. 多用户支持（服务器模式下的权限和协作）
2. 知识库共享同步（多人协作编辑）
3. 统计和报表（团队效率、AI使用率、任务完成率）
4. 远程工作区支持（remote_workspace场景下的项目目录操作）
5. 文件树增量扫描优化（notify crate + mtime追踪）

---

## 七、验证方案

### MVP验证步骤

1. **创建项目**：通过UI创建一个TPM项目，指定本地根目录，扫描git仓库
2. **禅道同步**：配置禅道API地址和Token，拉取任务列表到本地
3. **任务→对话**：选中一个任务→点击"新建对话"→跳转到会话页面→📋按钮注入上下文→与AI对话
4. **自由对话→关联任务**：先自由对话→通过📋按钮关联/创建任务
5. **状态同步**：本地修改任务状态后，推送回禅道
6. **任务对话列表**：查看任务关联的多个对话记录
7. **运行测试**：
   - `cargo check` 确认编译
   - `cargo test --features test-utils` 确认测试通过
   - 前端 `pnpm dev` 确认UI正常渲染
   - 禅道API调用集成测试

### 升级兼容性验证

1. 从CodeG上游 `main` 分支拉取最新代码
2. 执行 `git merge upstream/main`
3. 验证合并冲突仅在预定义的集成点文件中出现
4. 解决冲突后确认所有功能正常运行
