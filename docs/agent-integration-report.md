# CodeG 多智能体集成实现报告

## 整体架构分层

CodeG 通过**五层架构**实现七种智能体的统一集成：

| 层级 | 说明 |
|------|------|
| **ACP 协议层** | JSON-RPC over stdio，`sacp-tokio` crate 提供类型化的请求/响应 |
| **连接管理层** | `ConnectionManager` 仲裁并发会话（去重、空闲回收、配置漂移检测） |
| **事件总线** | 每个连接 + 进程级 `InternalEventBus`，分发事件给 DB 持久化、宠物动画、聊天频道 |
| **解析器层** | 每个 agent 一套解析器，将原生会话文件（JSONL / SQLite / JSON 树）转成统一 `ConversationDetail` |
| **前端状态层** | `AcpConnectionsContext` 管理连接机状态机，`DelegationContext` 管理父子委托绑定 |

### 技术栈

- **桌面运行时**: Tauri 2（Rust 后端 + webview 前端）
- **服务器运行时**: 独立 Rust 二进制（Axum HTTP + WebSocket）
- **前端**: Next.js 16（静态导出）+ React 19 + TypeScript（strict）
- **数据库**: SeaORM + SQLite
- **包管理器**: pnpm
- **ACP 协议**: `sacp` / `sacp-tokio`（Serialized Agent Client Protocol）

### 双模式运行

所有业务逻辑通过 `_core` 函数同时供给 Tauri 命令和 Axum handler，`EventEmitter` 枚举区分桌面/服务端事件发射：

```rust
pub enum EventEmitter {
    Tauri(AppHandle),
    WebOnly(Arc<WebEventBroadcaster>),
}
```

---

## 1. ACP (Agent Client Protocol) 核心实现

**位置：** `src-tauri/src/acp/`（22 个文件）

| 文件 | 职责 |
|------|------|
| `types.rs` | 661 行，所有 `AcpEvent` 变体（~30 种事件） |
| `connection.rs` | 2373+ 行，agent 进程启动、ACP 事件循环、MCP server 注入 |
| `manager.rs` | 1108+ 行，`ConnectionManager`：spawn 去重、prompt 路由、配置指纹 |
| `session_state.rs` | 1088+ 行，每个连接权威状态（`SessionState`） |
| `lifecycle.rs` | 1182+ 行，后台生命周期订阅者（事件 → DB 写入） |
| `delegation/companion.rs` | 2200 行，MCP 伴生进程的 JSON-RPC 双工通信 |

### 连接生命周期

```
acp_connect (前端)
  → ConnectionManager::spawn_agent()
    → spawn_agent_connection()
      → build_agent() 解析 registry 元数据 → 启动 CLI
      → inject_codeg_mcp() 注入 codeg-mcp 伴生进程
      → run_connection() 后台 ACP 事件循环
    → 插入 connections 映射 → SessionStarted 去重信号
  → 返回 connection_id
```

### 核心类型：AgentConnection

```rust
pub struct AgentConnection {
    pub id: String,
    pub agent_type: AgentType,
    pub status: ConnectionStatus,
    pub owner_window_label: String,
    pub cmd_tx: mpsc::Sender<ConnectionCommand>,
    pub state: Arc<RwLock<SessionState>>,
    pub emitter: EventEmitter,
    pub prompt_lock: Arc<tokio::sync::Mutex<()>>,
    pub config_fingerprint: String,
    pub last_observed_fingerprint: String,
}
```

### 连接命令枚举

```rust
pub enum ConnectionCommand {
    Prompt { blocks: Vec<PromptInputBlock>, user_message: Option<...> },
    SetMode { mode_id: String },
    SetConfigOption { config_id: String, value_id: String },
    Cancel,
    RespondPermission { request_id: String, option_id: String },
    Fork { reply: oneshot::Sender<...> },
    Disconnect,
}
```

---

## 2. 支持的 Agent 注册表

**位置：** `src-tauri/src/acp/registry.rs`

| Agent | 分发方式 | 命令 | 版本 |
|-------|---------|------|------|
| Claude Code | Npx | `claude-agent-acp` | 0.49.0 |
| Codex CLI | Binary | `codex-acp` | 0.16.0 |
| Gemini CLI | Npx | `gemini --acp` | 0.47.0 |
| OpenClaw | Npx | `openclaw acp` | 2026.6.9 |
| Cline | Npx | `cline --acp` | 3.0.29 |
| OpenCode | Binary | `opencode acp` | 1.17.9 |
| Hermes Agent | Uvx | `hermes-acp` | 0.16.0 |

三种分发类型：

- **`AgentDistribution::Npx`** — Node.js npx 启动（Claude Code、Gemini、OpenClaw、Cline）
- **`AgentDistribution::Binary`** — GitHub Releases 预编译二进制（Codex、OpenCode）
- **`AgentDistribution::Uvx`** — Python agents 通过 `uvx`（Hermes，固定 `--python 3.13`）

---

## 3. Agent 事件流

### AcpEvent 枚举（~30 种事件变体）

| 事件 | 触发时机 |
|------|---------|
| `ContentDelta` | 流式文本增量 |
| `Thinking` | agent 推理内容 |
| `ToolCall` / `ToolCallUpdate` | 工具调用 + 进度 |
| `PermissionRequest` / `PermissionResolved` | 用户审批流 |
| `TurnComplete` | Turn 结束（含 stop_reason） |
| `SessionStarted` | agent 分配了 session ID |
| `ConversationLinked` | 连接绑定到 DB 行 |
| `DelegationStarted` / `DelegationCompleted` | 多 agent 委托 |
| `QuestionRequest` / `QuestionResolved` | 阻塞性 agent 提问 |
| `PlanUpdate` | agent 计划条目更新 |
| `UsageUpdate` | 上下文窗口用量 |
| `FeedbackSubmitted` / `FeedbackConsumed` | 实时用户引导 |
| `SessionConfigStale` | "请重启以生效"提示 |
| `UserMessage` / `UserPromptSent` | 跨客户端用户消息同步 |
| `ModeChanged` | 会话模式切换 |

### 事件传播路径

```
emit_with_state()
  ├─ 1. write-lock SessionState
  ├─ 2. apply_event() 更新状态
  ├─ 3. seq++
  ├─ 4. push 到 recent_events ring buffer
  ├─ 5. 广播到 per-connection ConnectionEventStream
  └─ 6. 发送到 InternalEventBus（全局）
       └─ 订阅者:
          ├─ Lifecycle 订阅者（DB 写入：SessionStarted / TurnComplete / Disconnected）
          ├─ Pet 状态映射器（宠物动画状态）
          └─ 聊天频道订阅者
```

### SessionState 结构

```rust
pub struct SessionState {
    // 身份信息
    pub connection_id: String,
    pub conversation_id: Option<i64>,
    pub external_id: Option<String>,
    pub agent_type: AgentType,
    pub working_dir: Option<String>,
    // 实时 Turn 数据
    pub live_message: Option<MessageTurn>,
    pub active_tool_calls: Vec<ActiveToolCall>,
    pub pending_permission: Option<PermissionRequest>,
    // 能力声明
    pub modes: Vec<SessionMode>,
    pub config_options: Vec<SessionConfigOption>,
    pub prompt_capabilities: PromptCapabilities,
    pub fork_supported: bool,
    pub available_commands: Vec<String>,
    // 委托追踪
    pub active_delegations: HashMap<String, ActiveDelegation>,
    // 实时反馈
    pub feedback: Vec<FeedbackEntry>,
    pub pending_question: Option<QuestionRequest>,
    // 流式
    pub event_stream: broadcast::Sender<EventEnvelope>,
    pub recent_events: VecDeque<EventEnvelope>,
}
```

---

## 4. Agent 解析器（从原生会话文件读取历史）

**位置：** `src-tauri/src/parsers/`

### 统一 Trait

```rust
pub trait AgentParser {
    fn list_conversations(&self) -> Result<Vec<ConversationSummary>, ParseError>;
    fn get_conversation(&self, conversation_id: &str) -> Result<ConversationDetail, ParseError>;
}
```

### 各 Agent 实现

| Agent | 源路径 | 格式 | 行数 | 特殊处理 |
|-------|--------|------|------|---------|
| Claude Code | `~/.claude/projects/<hash>/` | JSONL | 2243 | 剥离系统 XML 注入，重构斜杠命令 |
| Codex CLI | `~/.codex/sessions/` | JSONL | 2438 | 从用户消息提取标题候选 |
| OpenCode | `~/.opencode/opencode.db` | SQLite | 1039 | 只读 SQL 查询 JSON 编码字段 |
| Gemini CLI | `~/.gemini/chats/` | JSON/JSONL | 1212 | 合并 JSONL delta，解析 `.project_root` |
| Cline | `~/.cline/data/` | JSON | 651 | 读取 task + 会话历史 |
| OpenClaw | `~/.openclaw/agents/` | JSONL 树 | 1393 | 构建 JTree 处理分支/分叉 |
| Hermes | `~/.hermes/state.db` | SQLite | 927 | 处理回退消息（`active=0`） |

### 共享工具函数

- `fold_reference_links()` — 将 Markdown 链接截断为纯标签（用于标题提取）
- `truncate_str()` — 安全的 UTF-8 字符截断
- `compute_session_stats()` — 聚合所有 Turn 的 token 用量
- `infer_context_window_max_tokens()` — 已知模型容量（Claude: 200K, Gemini: 1M, GPT-5: 258K）
- `relocate_orphaned_tool_results()` — 将游离的 tool result 移回所属 tool_use
- `structurize_read_tool_output()` — 去除 Read 工具输出的行号前缀
- `resolve_patch_line_numbers()` — 从磁盘文件解析 `@@` hunk header

---

## 5. 统一数据模型

**位置：** `src-tauri/src/models/`（15 个文件）

### AgentType 枚举

```rust
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    ClaudeCode,
    Codex,
    OpenCode,
    Gemini,
    OpenClaw,
    Cline,
    Hermes,
}
```

前端镜像：`src/lib/types.ts`（2226 行）中 TypeScript `type AgentType`，与 Rust 模型严格一致。

### ConversationSummary / ConversationDetail

```rust
pub struct ConversationSummary {
    pub id: String,
    pub agent_type: AgentType,
    pub folder_path: Option<String>,
    pub title: Option<String>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub message_count: u32,
    pub model: Option<String>,
    pub git_branch: Option<String>,
    pub parent_id: Option<String>,
    pub parent_tool_use_id: Option<String>,
    pub delegation_call_id: Option<String>,
}

pub struct ConversationDetail {
    pub summary: ConversationSummary,
    pub turns: Vec<MessageTurn>,
    pub session_stats: Option<SessionStats>,
}
```

### ContentBlock 变体

```rust
pub enum ContentBlock {
    Text { text: String },
    Image { data: String, mime_type: String, uri: Option<String> },
    ImageGeneration { revised_prompt: Option<String>, image: Option<ImageData> },
    ToolUse { tool_use_id: String, tool_name: String, input_preview: Value, meta: Option<ToolUseMeta> },
    ToolResult { tool_use_id: String, output_preview: Option<String>, is_error: bool, agent_stats: Option<AgentExecutionStats> },
    Thinking { text: String },
}
```

### AgentExecutionStats

```rust
pub struct AgentExecutionStats {
    pub agent_type: Option<String>,
    pub status: Option<String>,
    pub total_duration_ms: Option<u64>,
    pub total_tokens: Option<u64>,
    pub tool_calls: Vec<AgentToolCall>,
    pub read_count: Option<u32>,
    pub search_count: Option<u32>,
    pub bash_count: Option<u32>,
    pub edit_file_count: Option<u32>,
    pub lines_added: Option<u32>,
    pub lines_removed: Option<u32>,
}
```

---

## 6. 前端 Agent 状态管理

### Transport 抽象层

**位置：** `src/lib/transport/`

```typescript
interface Transport {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>
  subscribe<T>(event: string, handler: (payload: T) => void): Promise<UnsubscribeFn>
  isDesktop(): boolean
  eventStream?(): EventStream  // Per-connection subscribe-with-snapshot
}
```

实现：`TauriTransport`（桌面 `invoke()`）、`WebTransport`（服务器 `fetch()`）、`RemoteDesktopTransport`（WebSocket 中继）。

### AcpConnectionsContext

**位置：** `src/contexts/acp-connections-context.tsx`（4011 行）

核心前端状态机：

```typescript
interface ConnectionState {
  connectionId: string
  agentType: AgentType
  status: ConnectionStatus
  liveMessage: LiveMessage | null
  pendingPermission: PendingPermission | null
  pendingUserMessage: PendingUserMessage | null
  pendingAskQuestion: PendingQuestionState | null
  activeDelegations: ActiveDelegationState[]
  selectorsReady: boolean
  modes: SessionModeStateInfo | null
  configOptions: SessionConfigOptionInfo[] | null
  lastAppliedSeq: number
  // ...
}
```

Reducer action 类型（~20+ 种）：

```
CONNECTION_CREATED | HYDRATE_FROM_SNAPSHOT | CONTENT_DELTA | THINKING
TOOL_CALL | TOOL_CALL_UPDATE | PERMISSION_REQUEST | PERMISSION_RESOLVED
TURN_COMPLETE | SESSION_STARTED | MODE_CHANGED | PLAN_UPDATE
USAGE_UPDATE | DELEGATION_STARTED | DELEGATION_COMPLETED
QUESTION_REQUEST | QUESTION_RESOLVED | FEEDBACK_SUBMITTED | FEEDBACK_CONSUMED
```

### DelegationContext

**位置：** `src/contexts/delegation-context.tsx`（224 行）

```typescript
interface DelegationBinding {
  parentConnectionId: string
  parentToolUseId: string
  childConnectionId: string
  childConversationId: number
  agentType: AgentType
  status: "running" | "ok" | "err"
  errorCode?: string
}
```

监听 `delegation_started` / `delegation_completed` 事件，维护内存中的父子绑定映射，2 秒宽限期后清理子连接状态。

---

## 7. 委托系统（多 Agent 协作）

### 流程

```
Parent Agent 调用 delegate_to_agent（通过 codeg-mcp MCP 工具）
  → Companion JSON-RPC → DelegationBroker
    → spawn_agent() 创建子连接
    → DB 行通过 parent_id + parent_tool_use_id + delegation_call_id 链接
    → Lifecycle 订阅者监听 TurnComplete，路由结果回 broker
    → broker 在父连接流上发射 DelegationStarted / DelegationCompleted
  → 前端 DelegationContext 维护实时绑定
  → 用户可点击 "View Session" 导航到子对话
```

### codeg-mcp 伴生进程

**MCP 协议：** Agent CLI (stdio) ↔ codeg-mcp (MCP server) ↔ UDS/socket ↔ DelegationBroker（codeg 主进程）

**注入时机：** `spawn_agent_connection()` 中的 `inject_codeg_mcp()` 函数：
1. 检查已启用的 feature（delegation、feedback、ask、sessions）
2. 定位 `codeg-mcp` 二进制（通过 `CODEG_MCP_BIN` env / exe 同级目录 / PATH）
3. 在 `TokenRegistry` 中注册 per-launch token
4. 创建 `McpServerStdio` 条目，名为 `"codeg-mcp"`，参数：
   - `--parent-connection-id <uuid>`
   - `--socket-path <uds_path>`
   - `--token <uuid>`（per-launch 认证）
   - `--parent-pid <pid>`（看门狗清理）
   - `--features <comma-separated>`（暴露哪些工具）
5. 将 MCP server 条目附加到 ACP `NewSessionRequest`

**暴露的 MCP 工具（6 个，由 `--features` 门控）：**

| MCP 工具 | Feature | 用途 |
|----------|---------|------|
| `delegate_to_agent` | delegation | 生成子 agent，返回 task_id ack |
| `get_delegation_status` | delegation | 轮询/长轮询任务状态 |
| `cancel_delegation` | delegation | 取消运行中的任务 |
| `check_user_feedback` | feedback | 拉取用户的实时引导笔记 |
| `ask_user_question` | ask | 阻塞多选提问卡片 |
| `get_session_info` | sessions | 按 id 解析会话元数据 |

---

## 8. 关键 UI 组件

| 组件 | 文件路径 | 用途 |
|------|----------|------|
| `AgentSelector` | `components/chat/agent-selector.tsx` | Agent 类型选择器（标签栏） |
| `AgentPlanOverlay` | `components/chat/agent-plan-overlay.tsx` | Plan 叠加层显示 |
| `SubAgentOverlay` | `components/chat/sub-agent-overlay.tsx` | 内联子 agent 委托卡片 |
| `AgentToolCall` | `components/message/agent-tool-call.tsx` | 工具调用卡片（消息流中） |
| `SubAgentSessionDialog` | `components/message/sub-agent-session-dialog.tsx` | 子会话详情弹窗 |
| `AgentIcon` | `components/agent-icon.tsx` | Agent 图标 |
| `AcpAgentSettings` | `components/settings/acp-agent-settings.tsx` | Agent 配置面板 |
| `DelegationAgentDefaults` | `components/settings/delegation-agent-defaults.tsx` | 委托默认值配置 |

### 其他前端模块

| 模块 | 路径 | 用途 |
|------|------|------|
| `api.ts` | `lib/api.ts` | 所有后端命令的 TypeScript 绑定 |
| `types.ts` | `lib/types.ts` | Rust 模型的完整 TypeScript 镜像（2226 行） |
| `delegation-card.ts` | `lib/delegation-card.ts` | 从工具调用解析委托元数据 |
| `delegation-status.ts` | `lib/delegation-status.ts` | 解析委托轮询结果 |
| `delegation-seed.ts` | `lib/delegation-seed.ts` | 从快照重建委托绑定 |
| `snapshot-denormalize.ts` | `lib/snapshot-denormalize.ts` | 将网络快照转为客户端状态 |
| `tool-call-normalization.ts` | `lib/tool-call-normalization.ts` | 标准化工具调用名称 |
| `agent-modes.ts` | `lib/agent-modes.ts` | Agent 模式/配置辅助函数 |
| `branch-tree.ts` | `lib/branch-tree.ts` | 会话分支可视化 |

---

## 9. 会话聚合

### 外部会话源

| Agent | 源路径 | 类型 |
|-------|--------|------|
| Claude Code | `~/.claude/projects/` | 目录 |
| Codex CLI | `~/.codex/sessions/` | 目录 |
| Gemini CLI | `~/.gemini/`（tmp/、history/、projects.json） | 目录（过滤后） |
| Cline | `~/.cline/data/` | 目录 |
| OpenCode | `~/.opencode/opencode.db` | SQLite 文件 |
| Hermes | `~/.hermes/state.db` | SQLite 文件 |
| OpenClaw | `~/.openclaw/agents/` | 目录 |

### 聚合流程

```
前端请求 listConversations
  → Command 层
    → 遍历每个 agent 类型:
      → 实例化对应解析器（CodexParser / ClaudeParser / ...）
      → parser.list_conversations()
    → 合并所有结果为统一 Vec<ConversationSummary>
    → 按参数过滤/排序（agent_type、folder_path、search）
  → 返回前端

前端请求 getConversation(agentType, conversationId)
  → 实例化对应解析器
  → parser.get_conversation(conversationId)
  → 返回 ConversationDetail { summary, turns, session_stats }
```

### 侧边栏聚合

`get_sidebar_data` 返回 `SidebarData`：
- `folders: Vec<FolderInfo>` — 每个文件夹的路径、名称、有哪些 agent 的会话、计数
- `stats: AgentStats` — 总会话数/消息数，按 agent 类型拆分

### 委托聚合

委托的子会话通过 DB 中的 `parent_id`、`parent_tool_use_id`、`delegation_call_id` 字段关联。前端通过 `DelegationContext` 维护实时绑定，快照恢复使用 `SessionState.active_delegations` 重建绑定。

### 宠物状态聚合

`pet_state_mapper.rs` 后台任务订阅 `InternalEventBus`，聚合所有活跃连接状态为单一 `PetState`（Idle / Running / Waiting / Failed / Jumping），过滤掉委托子 session（非用户面），处理 4 秒 Failed 恢复定时器。

---

## 10. 后端命令清单

**位置：** `src-tauri/src/commands/`

### ACP 命令（`commands/acp.rs`，7893 行）

| 命令 | 用途 |
|------|------|
| `acp_connect` | 启动 agent 连接（去重） |
| `acp_prompt` | 发送用户消息 |
| `acp_cancel` | 取消当前 Turn |
| `acp_disconnect` | 关闭连接 |
| `acp_set_mode` | 切换会话模式 |
| `acp_set_config_option` | 切换会话配置 |
| `acp_respond_permission` | 响应权限请求 |
| `acp_answer_question` | 回答阻塞问题 |
| `acp_get_session_snapshot` | 获取实时快照 |
| `acp_find_connection_for_conversation` | 查找会话的活跃连接 |
| `acp_touch_connection` | 保活（防止空闲回收） |
| `acp_submit_feedback` | 提交实时引导 |
| `acp_list_agents` | 列出所有注册 agent |
| `acp_get_agent_status` | 获取 agent 可用性 |
| `acp_install_agent` | 安装/更新 agent 二进制 |
| `acp_uninstall_agent` | 卸载 agent 二进制 |
| `acp_probe_agent_options` | 探测会话模式/配置 |
| `acp_list_skills` | 列出 agent 技能 |
| `acp_get_skill_content` | 读取技能文件 |
| `acp_save_skill` | 写入技能文件 |
| `acp_delete_skill` | 删除技能文件 |
| `acp_list_importable_codex_pets` | 列出可导入的 Codex 宠物 |
| `acp_import_codex_pets` | 导入 Codex 宠物 |

### 委托命令（`commands/delegation.rs`）

| 命令 | 用途 |
|------|------|
| `delegation_get_config` / `delegation_set_config` | Broker 配置（启用、深度限制、默认 agent） |
| `delegation_get_agent_defaults` | 每个 agent 的委托默认值（mode、config） |

### 会话命令（`commands/conversations.rs`）

| 命令 | 用途 |
|------|------|
| `list_conversations` | 按 agent_type / folder / search / sort 过滤 |
| `get_conversation` | 完整会话详情含 turns |
| `get_stats` | Agent 维度会话计数 |
| `get_sidebar_data` | 侧边栏所需的文件夹 + 统计 |
| `reimport_conversations` | 重新扫描 agent 会话文件 |

### 会话信息命令（`commands/session_info.rs`）

| 命令 | 用途 |
|------|------|
| `session_info_get` | 解析会话元数据 + 消息（给 get_session_info MCP 工具） |

---

## 核心设计原则总结

1. **编译时无条件集成** — agent 功能不带 feature gate 编译，桌面和服务端都可用
2. **事件驱动** — 所有 agent 状态变化走事件总线（per-connection stream + 全局 InternalEventBus）
3. **去重保护** — 基于 `(agent, working_dir, session_id)` 的 async mutex 防止重复 spawn
4. **类型安全** — Rust 类型化事件 → TypeScript 精确镜像，前后端模型强一致
5. **双模式运行** — `_core` 函数同时供给 Tauri 命令和 Axum handler
6. **解析器模式** — 每个 agent 适配器将原生格式统一为 `ConversationDetail`
7. **MCP 注入** — `codeg-mcp` 伴生进程使 agent 获得委托/反馈/提问等扩展能力
