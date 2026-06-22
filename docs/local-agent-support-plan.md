# 本机 Agent 支持方案：ACP 桥接 + 一键 CLI 移交 + Live Watch

> 目标：让 Codeg UI 支持本机 CLI 近乎全部功能，同时实现一键启动本机 CLI 继续同一会话。

## 当前状况与差距

### 当前 ACP 模式的限制

Codeg 通过 ACP（Agent Client Protocol）统一与所有 agent 通信。ACP 是一个标准化 JSON-RPC 协议，但只定义了"对话 + 工具调用 + 权限管理"核心循环，不支持 CLI 的完整功能集：

| 功能 | ACP 支持 | 说明 |
|------|---------|------|
| Slash 命令 (`/init`, `/review`, `/memory`, `/cost`) | ❌ | ACP 协议根本没定义 |
| MCP server 动态注入 | ❌ | 不支持运行时注入 |
| 模型切换 | ⚠️ 部分 | 只支持 ACP 定义的模式类型 |
| Thinking/Effort 控制 | ⚠️ 部分 | 只支持 ACP 定义的字段 |
| 流式输出 | ✅ | ContentDelta |
| 权限审批 | ✅ | PermissionRequest |
| 子代理/fork | ✅ | 通过 delegation broker |
| 反馈注入 | ✅ | check_user_feedback |

### Paseo 的做法（对比参考）

Paseo **直接调用本机 agent**，每个 agent 用其原生协议通信：

| Agent | Paseo 通信协议 | 关键代码 |
|-------|---------------|---------|
| Claude Code | Anthropic Agent SDK（进程内 SDK 调用） | `resolveClaudeBinary()` → `ClaudeQueryFactory` → `claudeQuery()` |
| Codex CLI | 自定义 JSON-RPC over stdio | `spawnAppServer()` → `CodexAppServerClient` → ndjson 流 |
| OpenCode | HTTP REST API | `opencode serve --port {port}` → HTTP `http://127.0.0.1:{port}` |

原生协议支持的功能更丰富：

| 功能 | Claude Agent SDK | Codex JSON-RPC | OpenCode HTTP |
|------|-----------------|---------------|--------------|
| Slash 命令 | ✅ `listCommands()` | ✅ `skills/list` | ✅ |
| MCP 注入 | ✅ `mcpServers` | ✅ | ✅ `mcp.add` |
| 模型切换 | ✅ `setModel()` | ✅ | ✅ |
| 模式切换 | ✅ `setPermissionMode()` | ✅ `collaborationMode` | ✅ |
| Thinking 控制 | ✅ | ✅ `effort` | ✅ |

### 各 Agent 本机 ACP 支持情况

5/7 的 agent 本机 binary 就支持 ACP 模式（不需要桥接），只有 Claude Code 和 Codex 需要：

| Agent | 本机是否支持 ACP | 当前 Codeg 启动方式 | 本机模式启动方式 |
|-------|-----------------|-------------------|----------------|
| **OpenCode** | ✅ `opencode --acp` | Binary 下载 → `opencode acp` | PATH 上本机 `opencode` + `--acp` |
| **Gemini** | ✅ `gemini --acp --skip-trust` | `npx @google/gemini-cli --acp` | 本机 `gemini` + `--acp --skip-trust` |
| **OpenClaw** | ✅ `openclaw acp` | `npx openclaw acp` | 本机 `openclaw` + `acp` |
| **Cline** | ✅ `cline --acp` | `npx cline --acp` | 本机 `cline` + `--acp` |
| **Hermes** | ✅ `hermes acp` | `uvx` 或 `system_cmd` fallback | 已有 `system_cmd` fallback |
| **Claude Code** | ❌ | `npx claude-agent-acp@0.47.0` | **需 ACP 桥接适配器** |
| **Codex** | ❌ | `codex-acp` binary 下载 | **需 ACP 桥接适配器** |

---

## 方案架构：三能力组合

```
                    ┌─────────────────────────────┐
                    │         Codeg UI            │
                    │                             │
                    │  ┌─ Bridge 适配器 ─────────┐ │ ← 日常对话，覆盖 ~85% CLI 功能
                    │  │  (Agent SDK / JSON-RPC)  │ │    Slash 命令当 prompt 发
                    │  │  → MCP 注入、模型切换等   │ │    对外仍是 ACP，Codeg 不改
                    │  └─────────────────────────┘ │
                    │                             │
                    │  ┌─ Handoff 按钮 ───────────┐ │ ← 需要完整 CLI 功能时一键移交
                    │  │  "Continue in Terminal"  │ │    claude --resume <session-id>
                    │  │  断开 ACP → 打开终端      │ │    同一 session 无缝接续
                    │  └─────────────────────────┘ │
                    │                             │
                    │  ┌─ Live Watch ─────────────┐ │ ← CLI 操作时 UI 实时可见
                    │  │  Parser + notify watcher │ │    监听 JSONL/SQLite 变化
                    │  │  → 新消息 → UI 刷新      │ │    单向：CLI → UI
                    │  └─────────────────────────┘ │
                    └─────────────────────────────┘
```

### 能力 1：ACP 桥接适配器

核心思路：**Codeg 不动，桥接进程对外暴露 ACP 协议（stdin/stdout），对内用原生协议连本机 agent。**

```
当前模式 (ACP Adapter):
  Codeg ← ACP stdin/stdout → claude-agent-acp npm 包 (内部调 Claude API)

本地模式 (ACP Bridge):
  Codeg ← ACP stdin/stdout → claude-local-bridge ← Agent SDK → 本机 claude
  Codeg ← ACP stdin/stdout → codex-local-bridge ← JSON-RPC → 本机 codex-app-server

本机直连 (无需桥接):
  Codeg ← ACP stdin/stdout → 本机 opencode --acp  (只是换成 PATH 上的 binary)
  Codeg ← ACP stdin/stdout → 本机 gemini --acp    (同上)
```

**注册表改动**：在 `AgentDistribution` 加 `Local` 和 `LocalBridge` 变体：

```rust
pub enum AgentDistribution {
    Npx { ... },        // 当前：npx ACP 适配器包
    Binary { ... },     // 当前：下载 ACP 适配器 binary
    Uvx { ... },        // 当前：uvx ACP 适配器包
    Local {             // 新增：本机 agent，直接走 PATH（本机支持 ACP 的）
        cmd: &'static str,
        args: &'static [&'static str],
        env: &'static [(&'static str, &'static str)],
    },
    LocalBridge {       // 新增：本机 agent + ACP 桥接适配器（本机不支持 ACP 的）
        bridge_cmd: &'static str,
        bridge_args: &'static [&'static str],
        env: &'static [(&'static str, &'static str)],
    },
}
```

`get_agent_meta` 根据配置切换 distribution：

```rust
// 配置可全局或 per-agent：
// agent_launch_mode = "acp"    → 全走当前 ACP 适配器
// agent_launch_mode = "local"  → 能直连的走 Local，需要桥的走 LocalBridge
// [agents.claude_code] launch_mode = "local"
// [agents.opencode]   launch_mode = "acp"

AgentType::ClaudeCode => match launch_mode {
    "acp"   => AgentDistribution::Npx { package: "@agentclientprotocol/claude-agent-acp@0.47.0", ... },
    "local" => AgentDistribution::LocalBridge { bridge_cmd: "claude-local-bridge", ... },
},
AgentType::Gemini => match launch_mode {
    "acp"   => AgentDistribution::Npx { package: "@google/gemini-cli@0.46.0", args: &["--acp"], ... },
    "local" => AgentDistribution::Local { cmd: "gemini", args: &["--acp", "--skip-trust"], ... },
},
```

**Bridge 功能覆盖度**（通过原生协议 + ACP 翻译）：

| 功能 | Bridge 能否支持 | 实现方式 |
|------|----------------|---------|
| Slash 命令 (`/init`, `/review`) | ✅ | 作为 prompt 发送，agent 内部处理 |
| MCP 注入 | ✅ | SDK 的 `mcpServers` 参数 / Codex 的 MCP 协议 |
| 模型切换 | ✅ | `setModel()` → 翻译为 ACP SetSessionConfigOption |
| 模式切换 | ✅ | `setPermissionMode()` → 翻译为 ACP SetSessionMode |
| Thinking/Effort | ✅ | SDK 参数 → 翻译为 ACP 配置 |
| 流式输出 | ✅ | SDK 流式 → ACP ContentDelta |
| 权限审批 | ✅ | SDK `canUseTool` → ACP PermissionRequest |
| 会话恢复 | ✅ | SDK `resume: sessionId` → ACP LoadSession |
| `/memory` 交互编辑 | ❌ | 需全屏终端交互，无法映射到 UI |
| `/cost` 实时面板 | ❌ | CLI 专用 UI，无法映射 |
| 键盘快捷键 (`Ctrl+R`) | ❌ | 终端专用 |

**约 85% CLI 功能可通过 Bridge 在 UI 中使用，剩余 15% 需要移交到 CLI。**

### 能力 2：一键 CLI 移交（Handoff）

Codeg 已有 `open_external_terminal_impl`（`commands/acp.rs:5051`），能在 macOS Terminal.app / Windows cmd / Linux gnome-terminal 中打开外部终端执行命令。

**Handoff 流程**：

```
1. 用户在 Codeg UI 与 Claude Code 对话
2. 点击 "Continue in Terminal" 按钮
3. 后端从 SessionState 取出 session_id + working_dir
4. 断开 ACP/Bridge 连接
5. 构建 CLI resume 命令：claude --resume <session-id>
6. 调用 open_external_terminal_impl(command, working_dir)
7. 外部终端打开，Claude Code CLI 接续同一会话
8. 用户在 CLI 完成操作后返回 Codeg
9. Parser 重新导入更新的 JSONL，会话历史完整保留
```

每个 agent 的 CLI resume 命令：

| Agent | CLI resume 命令 | 会话文件格式 |
|-------|---------------|------------|
| Claude Code | `claude --resume <session-id>` | JSONL append-only |
| Codex | `codex --resume <thread-id>` | JSON |
| OpenCode | `opencode --session <id>` | SQLite DB |

### 能力 3：Live Watch（CLI → UI 实时可见）

CLI 活着时，Codeg 的 Parser 通过文件监听实时更新 UI：

```
1. 用户在 CLI 终端中操作 Claude Code
2. CLI 不断向 session-id.jsonl 追加消息
3. Codeg 的 notify watcher 检测到文件变化
4. 触发 Parser 重新读取该 JSONL（只读新增部分）
5. 解析出的新消息通过 EventEmitter 推送到前端
6. Codeg UI 近实时显示 CLI 正在发生的事情
```

**这是单向的**（CLI → UI），不是双向同时共享。大多数 agent 不支持两个进程同时写同一个 session。

---

## 会话共享模型对比

| 模型 | 可行性 | 用户体验 | 说明 |
|------|--------|---------|------|
| **Handoff（移交）** | ✅ 完全可行 | UI ↔ CLI 无缝切换，同一会话 | UI 断开 → CLI resume → Parser 重导入 |
| **Live Watch（单向实时）** | ✅ 可行 | CLI 操作时 UI 近实时可见 | Parser + notify 监听 JSONL 变化 |
| **双向同时共享** | ❌ 不可行 | — | Agent session 锁定机制不支持双进程并发写 |

**推荐组合**：Handoff（主要交互）+ Live Watch（辅助可见性）。

用户日常在 UI 中用 Bridge 交互（85% 功能）；需要完整 CLI 时一键移交；CLI 运行时 UI 通过 Live Watch 可见其输出；CLI 完成后回到 UI，会话历史完整。

---

## 桥接适配器规格

### Claude Code 桥接（claude-local-bridge）

| 项 | 规格 |
|----|------|
| 类型 | Node.js npm 包（Agent SDK 是 TypeScript） |
| 对外 | ACP stdin/stdout JSON-RPC（用 sacp-js 或手写） |
| 对内 | Anthropic Agent SDK → `resolveClaudeBinary()` → `claudeQuery()` |
| 会话 | `~/.claude/projects/{cwd}/{session-id}.jsonl` |
| 功能翻译 | ACP Prompt → SDK query, SDK events → ACP ContentDelta/PermissionRequest, ACP SetSessionMode → `setPermissionMode()` |
| Slash 命令 | 作为 prompt 文本直接发送，agent 内部处理 |
| MCP 注入 | SDK `mcpServers` 参数 |
| 估计规模 | ~2000 行 TypeScript |

### Codex 桥接（codex-local-bridge）

| 项 | 规格 |
|----|------|
| 类型 | Rust binary 或 Node.js npm 包 |
| 对外 | ACP stdin/stdout JSON-RPC |
| 对内 | 找本机 `codex-app-server`，spawn 子进程 + 自定义 JSON-RPC over stdio |
| 会话 | `$CODEX_HOME/sessions` JSON |
| 功能翻译 | ACP events ↔ Codex JSON-RPC events, permission 映射 |
| Slash 命令 | `skills/list` + 作为 prompt 发送 |
| 估计规模 | ~1500 行 |

---

## Codeg 内部改动明细

### 不动的部分

| 文件 | 行数 | 说明 |
|------|------|------|
| `acp/connection.rs` | 4663 | `run_connection`、`build_agent` 核心逻辑不动 |
| `acp/manager.rs` | 5177 | `ConnectionManager`、`spawn_agent` 不动 |
| `acp/session_state.rs` | 2932 | SessionState 不动 |
| `acp/lifecycle.rs` | 2879 | 事件持久化不动 |
| `acp/types.rs` | 654 | 事件类型不动 |
| `acp/feedback.rs` | 266 | 反馈机制不动 |
| `acp/question.rs` | 766 | 问答不动 |
| `acp/delegation/` | ~3000 | 委托 broker 不动 |
| `acp/event_stream.rs` | ~200 | 事件流不动 |
| `acp/terminal_runtime.rs` | ~500 | 终端运行时不动 |

**核心连接层 0 行改动。**

### 需改动的部分

| 文件 | 改动内容 | 估计行数 |
|------|---------|---------|
| `acp/registry.rs` | 加 `Local` / `LocalBridge` 变体 + config 切换逻辑 + `cli_resume_command()` | ~80 |
| `acp/connection.rs` | `build_agent()` 加 Local/LocalBridge 分支（找 PATH binary → `AcpAgent::from_args()`） | ~40 |
| `acp/preflight.rs` | 加本机 binary 检查 + Bridge 检查 | ~80 |
| `acp/error.rs` | 加 `BinaryNotFound` 错误类型 | ~10 |
| `commands/acp.rs` | 加 `acp_handoff_to_cli` 命令（取 session_id → 断开 → 调用 `open_external_terminal_impl`） | ~80 |
| `parsers/live_watcher.rs`（新） | notify crate 监听 agent session 目录变化 | ~200 |
| `parsers/claude.rs` | 加增量读取方法 `get_conversation_since(seq)` | ~80 |
| `parsers/opencode.rs` | 加增量读取 | ~40 |
| `models/agent.rs` | 加 `cli_resume_command()` per-agent 方法 | ~30 |
| DB/config | per-agent `launch_mode` 配置字段 | 迁移 + ~20 |
| 前端 | "Continue in Terminal" 按钮 + config UI + i18n | ~60 |
| **总计** | | **~740 行** |

### 新增外部项目

| 项目 | 类型 | 估计行数 |
|------|------|---------|
| `claude-local-bridge` | npm 包（TypeScript） | ~2000 |
| `codex-local-bridge` | binary 或 npm 包 | ~1500 |

---

## 技术障碍与风险

| 障碍 | 严重程度 | 解决方案 |
|------|---------|---------|
| **session_id 跨进程兼容** | ⚠️ 中 | 验证 ACP/Bridge 创建的 session ID 是否能被 `claude --resume` 使用。如果格式不同，需要在 Bridge 中做映射 |
| **Claude Agent SDK 无 Rust binding** | ❌ 无法绕过 | Bridge 必须用 Node.js 写（SDK 只有 TypeScript 版），类似 Paseo 的 provider 实现 |
| **Codex JSON-RPC 协议非公开标准** | ⚠️ 中 | 协议可能随版本变化，需要逆向或参考 Codex 源码，建议保持与 Codex 版本同步 |
| **双向同时共享** | ❌ 不可能 | 大多数 agent session 锁定机制不支持双进程并发写，只能用 Handoff 或单向 Live Watch |
| **Bridge 维护成本** | ⚠️ 中 | 每次原生协议变更都需要更新 Bridge，类似维护 ACP 适配器的成本 |
| **本机 agent 版本不一致** | ⚠️ 低 | 用户本机版本可能与 Bridge 预期版本不同，建议 Bridge 尽量兼容多版本 |

---

## 实施路线图

### Phase 1：本机直连 + Handoff（最小可用）

优先支持已经有 ACP 的 agent（OpenCode、Gemini、OpenClaw、Cline、Hermes）+ 一键 CLI 移交：

1. `AgentDistribution::Local` 变体 + `build_agent()` 分支
2. per-agent config toggle（`launch_mode`）
3. Preflight 加本机 binary 检查
4. `acp_handoff_to_cli` 命令 + 前端 "Continue in Terminal" 按钮
5. per-agent `cli_resume_command()` 映射

**交付后**：5/7 agent 可选本机模式运行，所有 agent 可一键移交到 CLI。

### Phase 2：Bridge 适配器（Claude Code + Codex 本机支持）

6. 开发 `claude-local-bridge` npm 包（Agent SDK ↔ ACP 翻译）
7. 开发 `codex-local-bridge`（JSON-RPC ↔ ACP 翻译）
8. `AgentDistribution::LocalBridge` 变体 + 注册表配置
9. Bridge 支持 Slash 命令、MCP 注入、模型切换等增强功能

**交付后**：7/7 agent 可选本机模式运行，Bridge 覆盖 ~85% CLI 功能。

### Phase 3：Live Watch（CLI → UI 实时可见）

10. `parsers/live_watcher.rs` — notify crate 文件监听
11. Parser 增量读取方法
12. 事件推送 → UI 实时刷新

**交付后**：CLI 运行时 UI 近实时可见其输出。

---

## 与"重写 ACP 层"方案对比

| 维度 | 本方案（Bridge + Handoff） | 重写方案（原生协议替代 ACP） |
|------|--------------------------|--------------------------|
| Codeg 核心层改动 | 0 行 | ~12000-17000 行 |
| Codeg 总改动 | ~740 行 | ~12000-17000 行 |
| 新增外部代码 | ~3500 行（Bridge 适配器） | ~3000-5000 行（per-agent 适配器） |
| ACP 兼容性 | ✅ 两种模式并存，随时切换 | ❌ 完全放弃 ACP |
| 新增 agent 成本 | 只需加 registry 条目 | 每个新 agent 都需要写完整适配器 |
| 风险 | 低（核心层不动） | 高（全量重写） |
| 开发周期 | Phase 1 ~2 周，全部 ~6 周 | ~8-12 周 |
