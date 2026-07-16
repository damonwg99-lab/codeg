# 任务、会话、知识库优化 — 调研与设计方案

> 日期：2026-07-16
> 状态：已评审，待实现

---

## 一、需求概要

1. **会话关联 Task 时提示词包含 Task ID**：希望提示词中能包含 task 的 id，使会话中产生的与任务相关的文件能存入 task 对应的具体任务文件夹（附件、AI 生成文档），任务明细页除附件外也显示 AI 产生的文件（查看、删除等操作）
2. **知识库规则写入系统提示词**：将知识库规则自动注入系统提示词，避免每次提醒 AI 保存位置

---

## 二、当前架构调研

### 2.1 任务系统 (Task)

| 层 | 关键文件 | 说明 |
|---|---|---|
| DB Entity | `src-tauri/src/db/entities/platform_task.rs` | `platform_task` 表，含 `kb_refs_json`（未消费）、`delegation_config` 等字段 |
| Domain Model | `src-tauri/src/models/platform_task.rs` | `TaskInfo`、`TaskDetail`、`TaskConversationInfo` |
| DB Service | `src-tauri/src/db/service/platform_task_service.rs` | CRUD + 查询 |
| Commands | `src-tauri/src/commands/task.rs:227-278` | `create_conversation_for_task_core` — 创建会话并关联任务，存储 `injected_docs_json` |
| Web Handlers | `src-tauri/src/web/handlers/task.rs` | Axum HTTP 端点 |
| TS Types | `src/lib/platform/types.ts:115-181` | `TaskInfo`、`TaskDetail`、`TaskConversationInfo` |
| 前端页面 | `src/components/platform/task-detail.tsx` | 任务详情页（状态、基本信息、附件、关联会话、子任务） |

**`get_task_core` 当前逻辑** (`src-tauri/src/commands/task.rs:64-92`)：
- 通过 `find_by_task_id` 查询所有 `doc_type` 的 KnowledgeDoc
- 现有 `TaskDetail.attachments` 包含所有 `task_id` 匹配的记录（不区分 doc_type）

### 2.2 会话系统 (Conversation)

| 层 | 关键文件 | 说明 |
|---|---|---|
| DB Entity | `src-tauri/src/db/entities/conversation.rs` | `conversation` 表 |
| 连接表 | `src-tauri/src/db/entities/platform_task_conversation.rs` | `platform_task_conversation` — 含 `injected_docs_json`、`conversation_role` |
| Commands | `src-tauri/src/commands/conversations.rs:950-969` | `create_conversation_core` — 新建会话记录 |
| ACP Manager | `src-tauri/src/acp/manager.rs:782-1074` | `send_prompt_linked_with_message_id` — 关联会话并发送提示词 |
| ACP Connection | `src-tauri/src/acp/connection.rs:3789-3858` | 接收提示词并转发给 agent |

**关键发现**：`send_prompt_linked_with_message_id` 当前**不查询** `platform_task_conversation` 表，完全不知道会话是否关联了任务。注入逻辑需要新增此查询。

**首次 prompt 判断**：函数入口处通过 `s.conversation_id.is_some()` 计算 `already_linked` 标志（`manager.rs:838-841`）。`conversation_id` 由 `ConversationLinked` 事件设置（`session_state.rs:744-751`），首次 prompt 时 `already_linked = false`，后续为 `true`。注入应在此条件分支内执行。

### 2.3 提示词构建（关键发现）

**当前无系统提示词机制** — 整个提示词就是用户的**第一条消息**：

```
用户输入 (composer) → docToPromptBlocks() → PromptInputBlock[] → acp_prompt → send_prompt_linked_with_message_id
```

- `src/components/chat/message-input.tsx:2593-2652` — `buildDraft()` 构建 PromptInputBlock[]
- `src/components/chat/composer/to-prompt-blocks.ts:37-40` — 将 ProseMirror 文档序列化为文本块
- `src/components/chat/composer/reference-text.ts:135-143` — 上下文徽章转为行内文本（如 `Task: xx\nDescription: xx`）
- `src/components/platform/context-inject-panel-utils.ts:163-316` — 构建注入选项和 `injectedDocsJson`

**注入方式**：在 `send_prompt_linked_with_message_id` 中向 `blocks: Vec<PromptInputBlock>` 头部插入 `PromptInputBlock::Text` 块，然后原样传给 `send_prompt_inner` → agent。不涉及 agent 原生 system prompt 修改。

### 2.4 知识库系统 (Knowledge Base)

| 层 | 关键文件 | 说明 |
|---|---|---|
| 目录结构 | `src-tauri/src/platform/knowledge/init.rs` | 初始化 `_knowledge/`，含 `docs/`、`templates/`、`requirements/`、`.private/` |
| 子目录 | `.private/ai-intermediate/`、`.private/personal-notes/` | 但 **无 `.private/tasks/{id}/ai_intermediate/`** |
| DB Entity | `src-tauri/src/db/entities/platform_knowledge_doc.rs` | `doc_type` 含 `tech_doc`、`template`、`skill`、`requirement`、`ai_intermediate`、`task_attachment` |
| Scanner | `src-tauri/src/platform/knowledge/scanner.rs` | 递归扫描 KB 目录，推断 `doc_type` 和 `task_id` |
| 技能发现 | `src-tauri/src/platform/knowledge/skill_discovery.rs` | 解析 `skill.yaml`，`trigger_task_type` 和 `inject` 字段**未被消费**（本期暂不处理） |
| Commands | `src-tauri/src/commands/knowledge.rs` | CRUD + Scanner + 上传附件 |
| TS Types | `src/lib/platform/types.ts:204-269` | `KbDocType`、`KnowledgeDocInfo`、目录映射 |
| 前端管理页 | `src/components/platform/knowledge-manager.tsx` | 知识库管理页面 |

### 2.5 当前流程缺陷总结

| # | 问题 | 影响 |
|---|---|---|
| 1 | Task ID 不在提示词中，AI 不知任务目录 | AI 生成文件存到项目根目录而非任务目录 |
| 2 | 无系统提示词注入机制 | 无法自动添加项目级规则指令 |
| 3 | 无 AI 生成文档注册机制 | AI 产物无法关联任务展示 |
| 4 | 任务详情页只显示 `task_attachment` 类型 | AI 生成文档不可见 |

---

## 三、设计方案

### 3.1 需求 1：Task 上下文自动注入 + AI 文件目录

#### 3.1a 后端自动注入 Task 上下文

**修改位置**：`src-tauri/src/acp/manager.rs` — `send_prompt_linked_with_message_id`

**注入触发条件**：`already_linked == false`（即当前连接的首次 prompt），而非 `message_count == 0`。原因：
- `message_count` 由 parser 在 `TurnComplete` 后才更新，prompt 发送时无法反映真实轮次
- `already_linked` 在内存中判断 `s.conversation_id.is_some()`，首次 prompt 为 false，`ConversationLinked` 事件 emit 后才变为 true，无需额外 DB 查询
- agent 断连重建后 `already_linked` 重新为 false → 自动重新注入（此时 `RULES.md` 可能已被用户更新）

**Task 关联查询**（当前 `send_prompt_linked_with_message_id` 中不存在，需新增）：

在确定最终 `conversation_id` 后（即 linking 分支执行完毕、`state.conversation_id` 已有值），通过 `platform_task_conversation_service::get_by_conversation` 查询是否有 task 关联。

**注入逻辑**（仅在 `already_linked == false` 时执行）：

1. 查询 `platform_task_conversation` 获取 `task_id`
2. 通过 `task_id` 查询 task 获取 `title`、`task_type`
3. 通过 task 的 `project_id` → 获取 `kb_local_dir`（用于拼出绝对路径）
4. 向 `blocks` 头部插入：

```
=== Task Context ===
Task ID: {id}
Task Title: {title}
Task Type: {task_type}
Task Directory: {project_root_dir}/_knowledge/.private/tasks/{id}/
  ├── attachments/       # 用户上传的附件，请勿修改
  └── ai_intermediate/   # 你生成的文档保存到这里
=== End Task Context ===
```

注意：路径为**绝对路径**，从 `project.root_dir` + `kb_local_dir` 拼接（fallback：`{root_dir}/_knowledge`），确保 agent 无论当前 cwd 如何都能正确写入。

**数据流**：
```
用户 send → acp_prompt → send_prompt_linked_with_message_id
                                    ↓ (already_linked == false)
                         查询 platform_task_conversation → 有 task? → 注入 Task Context Text block
                                    ↓
                         send_prompt_inner → 转发 agent
```

#### 3.1b 增强任务目录结构

KB 初始化新增 `.private/tasks/{task_id}/ai_intermediate/` 子目录（与 doc_type 命名一致）：

```
_knowledge/.private/
├── ai-intermediate/                      # 无任务关联的会话产生的 AI 文件
│                                         #   doc_type: ai_intermediate, task_id: null
└── tasks/{task_id}/
    ├── attachments/                      # 用户上传的附件（已有）
    │                                     #   doc_type: task_attachment, task_id: {id}
    └── ai_intermediate/                  # 关联任务的 AI 生成的文档（新增）
                                          #   doc_type: ai_intermediate, task_id: {id}
```

**Scanner 扩展**：识别 `.private/tasks/{task_id}/ai_intermediate/` 路径：
- 该路径下的文件设置 `doc_type = "ai_intermediate"`，`task_id = {task_id}`
- 已有的 `infer_task_id_from_path` 支持 path 模式 `.private/tasks/{id}/...`，可直接复用
- `.private/ai-intermediate/`（根级别，无 task 关联）的文件 `task_id = null`

**AI 文档注册**：
- 方案 A（本期实现）：用户手工上传（`upload_task_ai_intermediate_doc` API，类似附件上传）
- 方案 B（后续迭代）：会话结束后自动扫描任务目录注册，或用户在会话文件列表中勾选后一键注册

#### 3.1c 任务详情页显示 AI 生成文档

**修改 `get_task_core`**（`src-tauri/src/commands/task.rs:64-92`）：

`find_by_task_id` 返回所有 doc_type 的记录，在组装 `TaskDetail` 时按 `doc_type` 分组：

```rust
let all_docs = platform_knowledge_doc_service::find_by_task_id(conn, id).await?;

let attachments: Vec<_> = all_docs.iter()
    .filter(|d| d.doc_type == "task_attachment")
    .cloned()
    .collect();

let ai_intermediate_docs: Vec<_> = all_docs.iter()
    .filter(|d| d.doc_type == "ai_intermediate")
    .cloned()
    .collect();
```

**修改 `TaskDetail` 模型**（`src-tauri/src/models/platform_task.rs`）：

```rust
pub struct TaskDetail {
    pub task: TaskInfo,
    pub conversations: Vec<TaskConversationInfo>,
    pub sub_tasks: Vec<TaskInfo>,
    pub attachments: Vec<KnowledgeDocInfo>,              // doc_type = "task_attachment"
    pub ai_intermediate_docs: Vec<KnowledgeDocInfo>,     // doc_type = "ai_intermediate"（新增）
}
```

TypeScript 镜像 `src/lib/platform/types.ts` 同步新增 `aiIntermediateDocs` 字段。

**前端修改**（`src/components/platform/task-detail.tsx`）：

当前 Attachments 卡片拆为两个卡片：

1. **附件** (`doc_type === "task_attachment"`) — 现有上传、预览、删除逻辑不变
2. **AI 中间产物** (`doc_type === "ai_intermediate"`) — 新增区域：
   - 上传按钮（调 `uploadTaskAiIntermediateDoc`）
   - 文件列表（图标、文件名、路径、预览/删除按钮）
   - 空状态

### 3.2 需求 2：KB 规则注入系统提示词

#### 3.2a 新增 `_knowledge/RULES.md` 约定

KB 初始化时创建默认 `RULES.md`（`src-tauri/src/platform/knowledge/init.rs`），内容首次创建后由用户自由编辑：

```markdown
# Project Rules

## File Storage Convention
- AI 生成的任务相关文档 → `.private/tasks/{task_id}/ai_intermediate/`
- AI 生成的非任务相关文档 → `.private/ai-intermediate/`
- 架构/设计文档 → `docs/`
- 所有任务相关文件必须保存在 `.private/tasks/{task_id}/` 对应子目录下

## Code Style
(可自定义)

## Architecture Decisions
(可自定义)
```

Scanner 对 `RULES.md` 的处理：
- `RULES.md` 不在 `SKIP_FILES` 列表中，会被扫描入库
- 在 KB 管理页可见、可编辑
- 注入时读取的是**磁盘文件最新内容**，不从 DB 读

#### 3.2b 后端自动注入规则

**修改位置**：`src-tauri/src/acp/manager.rs` — `send_prompt_linked_with_message_id`（与 3.1a 同一位置）

**逻辑**（仅在 `already_linked == false` 时执行）：

1. 通过收到的 `folder_id` 查 `folder` 表获取项目路径
2. 通过 `folder` 路径反查 `platform_project`（`folder_id` 匹配），获取 `kb_local_dir`
3. 解析 `RULES.md` 绝对路径：`{kb_dir}/RULES.md`（或 fallback `{root_dir}/_knowledge/RULES.md`）
4. 检查文件是否存在，若存在则用 `fs::read_to_string` 读取最新内容
5. 注入到 blocks 最前面

**不缓存**：每次注入前现场 `fs::read`，确保用户编辑后的最新规则生效。文件很小，I/O 成本可忽略。

**容错**：无 KB 目录、无 RULES.md → 静默跳过，不影响正常 prompt 发送。

#### 3.2c 两个注入块的顺序

```
=== Project Knowledge Base Rules ===  ← 最前（项目级，最通用）
{RULES.md 内容}
=== End of Rules ===

=== Task Context ===                   ← 第二（任务级，更具体）
Task ID: {id}
Task Title: {title}
Task Directory: {absolute_path}/_knowledge/.private/tasks/{id}/
=== End Task Context ===

{用户输入的消息}                        ← 最后
```

### 3.3 数据流总图

```
create_conversation_for_task
  ↓
创建 conversation + platform_task_conversation 记录
  ↓
前端打开会话 Tab，显示 composer
  ↓
用户输入消息 → 点击发送
  ↓
acp_prompt(blocks, conversation_id, folder_id)
  ↓
send_prompt_linked_with_message_id
  ├→ already_linked? → false（首次）
  │   ├→ 查 platform_task_conversation → 有 task？
  │   │   └→ 查 task + project → 注入 Task Context block
  │   ├→ 查 RULES.md? → 存在？
  │   │   └→ fs::read → 注入 Rules block（最前）
  │   └→ already_linked? → true（后续）→ 跳过注入
  └→ send_prompt_inner → agent
```

### 3.4 文件变更清单

#### Rust 后端

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src-tauri/src/acp/manager.rs` | 修改 | `send_prompt_linked_with_message_id`：首次 prompt 时查询 task 关联、读取 RULES.md、注入 Text blocks |
| `src-tauri/src/commands/task.rs` | 修改 | `get_task_core` 按 doc_type 分组，返回 `ai_intermediate_docs` |
| `src-tauri/src/commands/knowledge.rs` | 新增 | `upload_task_ai_intermediate_doc_core`、`read_kb_rules_core` |
| `src-tauri/src/models/platform_task.rs` | 修改 | `TaskDetail` 新增 `ai_intermediate_docs` 字段 |
| `src-tauri/src/platform/knowledge/init.rs` | 修改 | 初始化 `RULES.md`；新增 `tasks/{id}/ai_intermediate/` 子目录创建逻辑 |
| `src-tauri/src/platform/knowledge/scanner.rs` | 修改 | 识别 `.private/tasks/{id}/ai_intermediate/` 路径，设 `doc_type: ai_intermediate` + `task_id` |
| `src-tauri/src/db/service/platform_task_conversation_service.rs` | 确认 | `get_by_conversation` 是否已实现（用于按 conversation_id 反查 task） |

#### 前端

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `src/components/platform/task-detail.tsx` | 修改 | 拆分为"附件"卡片和"AI 中间产物"卡片 |
| `src/lib/platform/types.ts` | 修改 | `TaskDetail` 新增 `aiIntermediateDocs` 字段 |
| `src/lib/platform/api.ts` | 新增 | `uploadTaskAiIntermediateDoc` API |
| `src/lib/api.ts` / `src/lib/tauri.ts` | 修改 | 确保 `acpPrompt` 传递 `folderId`（当前已有） |

---

## 四、设计决策记录

1. **注入触发条件**：使用内存 `already_linked` 标志（`s.conversation_id.is_some()`），不用 `message_count` 字段
2. **RULES.md 不缓存**：每次注入前现场 `fs::read`，保证用户编辑后最新内容生效
3. **doc_type 复用**：AI 生成文件复用现有 `ai_intermediate` 类型，不新增 doc_type。通过 `task_id` 区分归属（null = 全局，非 null = 关联任务）
4. **目录命名统一**：`ai_intermediate` 与 doc_type 一致
5. **注入路径**：使用绝对路径，从 `project.root_dir` + `kb_local_dir` 拼接
6. **技能注入**：本期不实现 `trigger_task_type` / `inject` 自动注入，后续迭代
7. **AI 文档注册**：本期先实现手工上传，后续迭代自动扫描
8. **RULES.md 位置**：`_knowledge/RULES.md`（KB 根目录，独立文件）
