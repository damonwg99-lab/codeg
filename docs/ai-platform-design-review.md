# AI研发平台设计方案评审

> 评审对象：`docs/ai-platform-design.md`
> 评审日期：2026-06-22
> 评审性质：基于 CodeG 现有项目架构的二次改造方案评估

---

## 一、方案亮点（已充分考虑）

| 方面 | 评价 |
|------|------|
| 模块隔离策略 | 集成点表格定义清晰，降低升级冲突的措施具体可行 |
| 任务-对话关系 | "一任务多对话（并列）"设计合理，自由对话可随时关联任务 |
| 知识库设计 | 目录结构合理，索引机制（自动扫描+增量+frontmatter解析）完整 |
| 📋 浮动面板 | 三层结构设计（推荐注入/任务详情/更多文档）交互具体 |
| CLAUDE.md 策略 | 复用仓库已有文件存储技术栈信息，避免重复存储 |
| 分阶段计划 | 5 个 Phase 有渐进性，MVP 定位合理 |

---

## 二、关键遗漏与风险

按严重程度排列：🔴 高优先级 / 🟡 中优先级 / ⚪ 低优先级

---

### 🔴 2.1 未利用现有 Delegation 系统

**问题**：CodeG 最核心的差异化能力是 `codeg-mcp` + `DelegationBroker` 组成的多智能体委托系统（`src-tauri/src/acp/delegation/`）。文档完全未提及如何利用此能力。

**场景示例**：
- coding 任务：启动子 agent 做实现 → 父 agent 自动做 code review
- 需求拆解：父 agent 分析需求 → 派生子 agent 并行生成多个子任务的 PRD

**建议**：
- `platform_project` 增加 `default_delegation_config` 字段，控制项目级委托行为
- `platform_task` 增加 `delegation_config` 字段，支持 per-task 覆盖
- 📋 注入面板增加"启动此任务时派生子 agent"选项
- 利用 `DelegationBroker` 的 `delegate()` API，而非另起一套委托机制

---

### 🔴 2.2 与现有 Skills/Experts 系统的关系不明确

**问题**：CodeG 已有 14 个 bundled experts（`src-tauri/experts/skills/`），每个 expert 有 `SKILL.md` 元数据、i18n display name、触发规则。文档提出的 `skill.yaml` + `template.md` 机制与现有系统是什么关系？

**冲突点**：

| 维度 | 现有 Experts 系统 | 文档提议的 Skill 系统 |
|------|------------------|---------------------|
| 元数据格式 | `SKILL.md` + `experts.toml` | `skill.yaml` + `template.md` |
| 存储位置 | `~/.codeg/skills/` | 知识库 git 仓库 `skills/` 目录 |
| 触发机制 | 手动选择 | 任务类型自动匹配 |

**建议**：
- 明确两个系统的关系：是共存、替代还是桥接？
- 推荐方案：知识库 `skills/` 目录作为**团队级 Skill 仓库**，与 CodeG 个人级 `~/.codeg/skills/` 并行存在
- 📋 面板推荐注入时，**同时考虑** expert skills 和 knowledge base skills
- `platform_knowledge_doc` 的 `skill_name` 字段应兼容关联到现有 expert 的 name

---

### 🔴 2.3 "项目 Folder" 概念与现有 Folder 系统冲突

**问题**：文档 §5.3 提出"项目 Folder"，让一个 Folder 同时关联多个 git 仓库。但现有 Folder 模型（`src-tauri/src/db/entities/folder.rs`）设计是**一对一目录映射**——`folder.path` 是单一路径，`folder.git_branch` 是单个分支。

**技术债务**：
- 文件树组件（`src/components/files/`）基于单 Folder 工作
- Git 面板（`src/components/layout/aux-panel.tsx`）针对单仓库
- 如果强行创建"多根 Folder"，需要重写文件树虚拟文件系统抽象
- 对话归属规则依赖 `folder_id`，多根场景下归属逻辑会混乱

**建议**：
- **不创建"项目 Folder"**，改为**逻辑聚合层**：项目作为一个独立实体，内部 `project_repo` 列表关联到多个独立 Folder
- 文件树多根视图：在前端做聚合渲染（从多个 Folder 拉取文件树），不修改 Folder 数据模型
- 对话归属：对话仍属于各自仓库的 Folder，在 Project 页签中按 `project_repo.folder_id` 做关联查询

---

### 🔴 2.4 Sidebar Tab 切换实现复杂度被低估

**问题**：文档 §5.1 提出在 Title Bar 区域添加 Chat / Project 页签切换器。但现有 workspace 布局（`src/app/workspace/layout.tsx`，873行）结构如下：

```
ResizablePanelGroup
  ├── ResizablePanel(sidebar)
  │     └── Sidebar()           // 267 行，含 conversation list、搜索、筛选
  ├── ResizablePanel(main)
  │     └── chat/main content
  └── ResizablePanel(aux)
```

**风险**：
- 在 Title Bar 插入页签切换器并非简单"添加一个组件"，而是需要重写 workspace layout 布局逻辑
- 切换页签时 sidebar 内容完全替换（conversation list ↔ project nav），这涉及 React 组件树的挂载/卸载
- 静态导出模式（`next.config.ts` 设置 `output: "export"`）不支持动态路由 `[param]`，路由切换只能用 query parameter
- 现有 `sidebar.tsx` 已经与多个 Context（`SidebarContext`, `ActiveFolderContext`, `TabContext` 等）深度耦合

**建议**：
- MVP 阶段：**不在顶层加页签切换**，而是在 sidebar 内部添加一个"项目视图切换按钮"（类似现有的筛选/排序按钮）
- 或者在 sidebar 底部添加"切换到项目模式"的展开面板
- Phase 2+ 再考虑完整的页签切换 UI，此时对 workspace layout 的重写要作为独立工作项

---

### 🔴 2.5 MCP 集成机会被完全忽略

**问题**：CodeG 有完善的 MCP server 管理系统（`src-tauri/src/commands/mcp.rs`，4415 行），支持 MCP marketplace、per-agent MCP 注入、自动发现等。文档中的外部系统集成完全走自定义 REST API 调用。

**对比**：

| 集成对象 | 文档方案 | MCP 方案的优势 |
|---------|---------|---------------|
| 禅道 | 独立 `integration/zentao` 模块 | 禅道 MCP Server → agent 直接通过工具操作禅道 |
| GitLab | 独立 REST 调用 | GitLab MCP Server → agent 自主管理仓库/MR |
| Jenkins | 独立 REST 调用 | Jenkins MCP Server → agent 触发构建/查看状态 |

**MCP 方案的核心价值**：
- agent 可以**自主决策**何时调用外部系统（比如 review 完成后自动触发 Jenkins 构建）
- 不需要前端专门为每个外部系统写操作 UI
- 利用 CodeG 现有的 MCP 配置 UI 和管理生命周期
- 新外部系统的接入更标准化

**建议**：
- 将"禅道/GitLab/Jenkins MCP Server"作为独立项目开发
- `project` 模型增加 `mcp_server_ids: Vec<i32>` 字段，关联到项目启用的 MCP servers
- 📋 注入上下文时，同时注入可用的 MCP server 信息

---

### 🔴 2.6 系统上下文注入与现有 Pipeline 的集成复杂度

**问题**：现有 `ConversationRuntimeContext`（`src/contexts/conversation-runtime-context.tsx`）已有自己的 system prompt 构建逻辑。📋 面板注入的上下文需要桥接到这个 pipeline，但文档对此的描述过于简化为"作为 system 上下文发送给 AI"。

**实现细节**：
- 需要理解 system prompt 在哪个环节、以何种方式组装
- 📋 勾选的文档可能在 conversation 创建时注入（自动），也可能在对话中途增减（手动）
- 多个文档的 context window 管理：超出限制如何截断/摘要？
- 不同 agent 的 system prompt 格式不同——注入内容如何适配？
- 注入的文档是否需要和普通消息一样持久化到数据库？

**建议**：
- 设计一个 `ContextInjector` 服务层，封装注入逻辑：
  1. 收集阶段：从知识库、CLAUDE.md、Skill 模板收集内容
  2. 压缩阶段：根据目标 agent 的 context window 做摘要/截断
  3. 格式化阶段：按 agent 类型格式化 system prompt
  4. 注入阶段：写入 `conversation.system_prompt` 或作为首条 system 消息
- 记录 `injected_docs_json` 到 `platform_task_conversation` 表，便于追溯

---

### 🟡 2.7 密钥安全存储

**问题**：文档将禅道 Token、GitLab Token、Jenkins Token 存储在 `platform_global_config.config_json` 中（明文 JSON 字符串），这是安全风险。

**现有基础设施**：
- `src-tauri/src/keyring_store.rs`：桌面模式下使用 OS 密钥环（`keyring::Entry`），服务器模式下使用文件级加密
- 已有 `set_token/get_token/delete_token` 统一接口

**建议**：
- 集成 Token 使用 `keyring_store` 存储，不在 SQLite 中明文保存
- `platform_global_config` 只存非敏感配置
- 增加 `platform_credential` 表（或复用现有 keyring 机制）：
  ```rust
  pub struct Model {
      pub id: i32,
      pub project_id: Option<i32>,  // NULL=全局, 非空=项目级覆盖
      pub credential_type: String,  // zentao/gitlab/jenkins
      pub credential_key: String,   // keyring 中的 account_id
      pub created_at: DateTimeUtc,
  }
  ```

---

### 🟡 2.8 远程工作区场景

**问题**：文档所有路径假设都是本地文件系统（`root_dir`、`local_dir` 等）。但 CodeG 支持 `remote_workspace` 连接（`src-tauri/src/commands/remote_workspace.rs`），服务器部署模式下项目目录可能在远程主机上。

**影响范围**：
- 项目根目录 `root_dir` 在远程场景下不可直接访问
- git 操作（扫描仓库、查看状态）需要远程代理或通过 WebSocket 转发
- 知识库文件浏览/编辑需流式传输
- 终端工作目录在远程主机上

**建议**：
- `root_dir` 和 `local_dir` 字段的语义需要明确：是**服务端路径**还是**客户端路径**？
- 文件操作抽象层：通过 `AppState` 中的 `workspace_transfer` 或 `remote_workspace` 模块代理
- 项目创建时支持：`local`（本地目录）/ `remote`（通过 remote_workspace 连接）两种模式

---

### 🟡 2.9 多 Agent 适配

**问题**：CodeG 支持 7 种 agent 类型（Claude Code、Codex、OpenCode、Gemini、OpenClaw、Cline、Hermes），但文档只提到 `default_agent_type` 一个字段。

**未被考虑的差异**：

| Agent | System Prompt 格式 | Context Window | MCP 支持 | 适用场景 |
|-------|-------------------|---------------|---------|---------|
| Claude Code | 纯文本 instruction | ~200K tokens | ✅ | 大型代码任务 |
| Codex CLI | TOML config | ~128K tokens | ❌ | VS Code 生态 |
| OpenCode | SQLite DB | ~128K tokens | ✅ | 通用 |
| Gemini CLI | markdown 指令 | ~1M tokens | ✅ | 超长文档分析 |

**建议**：
- `platform_project` 增加 `agent_config_json` 字段（per-task-type agent 绑定）
- 📋 注入时按目标 agent 的 context window 自适应调整注入量
- 不同 agent 的 system prompt 格式化通过 adapter 模式处理

---

### 🟡 2.10 缺少活动日志/审计

**实际团队使用中，以下场景需要 audit log**：
- "谁什么时候把任务从处理中改回了待办？"
- "这个对话是什么时候关联到任务的？"
- "上次禅道同步是什么时候，同步了哪些字段？"

**建议**：新增 `platform_activity_log` 表：
```rust
pub struct Model {
    pub id: i32,
    pub project_id: i32,
    pub task_id: Option<i32>,
    pub action: String,       // task_status_changed / task_assigned / conversation_linked / zentao_synced / doc_published
    pub actor: Option<String>,  // 操作人（单机模式下可以为空）
    pub detail_json: Option<String>,
    pub created_at: DateTimeUtc,
}
```

---

### 🟡 2.11 Phase 1 范围过大

文档 Phase 1 列出约 30+ 个新文件、15+ 个修改点，覆盖 DB + Rust 命令层 + 前端组件 + 禅道同步 + Composer 集成 + 任务关联。对于 1-5 人团队，2-3 周非常紧张。

**建议拆分 Phase 1 为三个子阶段**：

| 子阶段 | 内容 | 预估 |
|--------|------|------|
| **Phase 1a** | DB 迁移 + Entity + Service + Rust 命令 + Model 层（Project/Task CRUD） | ~1 周 |
| **Phase 1b** | 前端页面 + Sidebar 集成 + 任务列表/详情 + 项目创建流程 | ~1 周 |
| **Phase 1c** | 禅道同步 + Composer 📋 浮动面板 + 任务关联 + 自由对话关联 | ~1-2 周 |

每个子阶段结束时 `cargo check` + `pnpm build` 通过。

---

### 🟡 2.12 缺少测试策略

只在"验证方案"中提到跑 `cargo check` 和 `cargo test`，对新模块的测试没有设计。

**建议**：

**Rust 测试**：
- 每个 service 层函数应有单元测试（使用 `test-utils` feature 的 `test_helpers`）
- 禅道同步逻辑需要有 mock server 测试（`wiremock` 或自定义 mock handler）
- 集成点冲突检测：写一个 `cargo test --test integration_points` 验证集成点文件格式

**前端测试**：
- 每个 platform hook 有 `vitest` 测试
- 主要组件（任务列表、📋 面板、项目选择器）有 render 测试
- 使用 `src/test-setup.ts` 中的全局 setup

---

### ⚪ 2.13 Frontmatter 解析器需额外工程

文档要求从 Markdown frontmatter 提取 `tags`、`description`、`auto_inject`，包含两步：

1. 文件扫描/变更检测
2. YAML frontmatter 解析

**工作量参考**：如果使用 `serde_yaml`，解析 frontmatter 本身不复杂，但**增量扫描的文件变更检测**（`notify` crate + 文件 mtime 追踪）需要额外实现。

**建议**：将"增量扫描"标记为 Phase 3 的优化项，Phase 3 初始使用全量扫描（小型知识库完全可接受）。

---

### ⚪ 2.14 Composer 📋 与 TipTap 编辑器集成

现有 Composer 使用 `@tiptap/react` 作为富文本编辑器。📋 按钮需要：

- 在 TipTap 的工具栏扩展点注册
- 浮动面板在编辑器 overlay 层渲染
- 与已有的 slash command、mention 扩展不冲突

**建议**：先阅读 `src/components/chat/composer/` 下的现有 TipTap 扩展代码，理解扩展机制后再设计 📋 按钮的集成方案。

---

## 三、补充建议（微小但重要）

### 3.1 DB Migration 编号策略

CodeG 现有迁移命名：`m20260211_000001_init`（日期 + 序号）。platform 迁移如果使用相同命名空间，可能和上游新迁移冲突。

**建议**：
```
m20260620_platform_000001_create_project_and_task
```
使用独立编号空间，日期使用预计 merge 日期，`_platform_` 前缀做区分。

### 3.2 i18n 覆盖

文档在 Phase 1 文件清单中提到了"添加 platform 相关翻译 key"，但只列了 zh.json。

**实际上需要更新所有 10 个语言文件**：
- `src/i18n/messages/en.json`
- `src/i18n/messages/zh-CN.json`
- `src/i18n/messages/zh-TW.json`
- `src/i18n/messages/ja.json`
- `src/i18n/messages/ko.json`
- `src/i18n/messages/es.json`
- `src/i18n/messages/de.json`
- `src/i18n/messages/fr.json`
- `src/i18n/messages/pt.json`
- `src/i18n/messages/ar.json`

MVP 阶段可以只维护 `en.json` + `zh-CN.json`，其余语言使用英文 fallback。

### 3.3 TypeScript 类型文件位置

`src/lib/types.ts` 已有 2044 行，是 Rust 模型的 TypeScript 镜像。platform 类型如果加在这里会大幅膨胀文件。

**建议**：遵照文档 §1.1 的设计，放在 `src/lib/platform/types.ts`，单独维护。

### 3.4 利用 Chat Channel 做通知

CodeG 支持 Telegram / Lark / WeChat 三个 chat channel 后端（`src-tauri/src/chat_channel/`）。当任务状态变更、禅道同步完成、CI/CD 构建完成时，可以通过 chat channel 推送通知到团队群。

**建议**：Phase 2+ 加入 `task_state_change → chat_channel_broadcast` 的 event subscriber。

### 3.5 严格模式合规

CodeG 前端使用 TypeScript strict 模式，启用 `noUnusedLocals` 和 `noUnusedParameters`。所有新 platform 代码必须遵守。

---

## 四、综合评分与建议

| 维度 | 评分（1-5） | 说明 |
|------|------------|------|
| 模块隔离设计 | ★★★★★ | 集成点规划出色，是最佳部分 |
| 数据模型 | ★★★★☆ | 覆盖完好，缺 audit log |
| 前端交互 | ★★★★☆ | 📋 面板设计好，但 Sidebar 切换复杂度低估 |
| 外部系统集成 | ★★★☆☆ | 忽略了 MCP 路径，安全存储需加强 |
| AI 流程 | ★★★☆☆ | 未利用 Delegation 和 Skills 现有能力 |
| 分阶段计划 | ★★★☆☆ | Phase 1 范围过大，需拆分 |
| 升级策略 | ★★★☆☆ | DB 迁移冲突风险未考虑 |
| 测试设计 | ★★☆☆☆ | 缺少实质的新模块测试策略 |

**总体建议**：方案方向正确，**在"利用现有 CodeG 核心能力"方面有较大提升空间**。最关键的三个改进方向：

1. **拥抱 Delegation 系统**——这是 CodeG 区别于其他工具的核心价值
2. **评估 MCP Server 方案替代独立 REST 集成**——更融入生态
3. **重新审视 Sidebar 页签方案**——现有布局约束下找更轻量的替代方案
