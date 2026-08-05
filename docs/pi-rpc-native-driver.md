# codeg 原生 pi RPC 驱动实施计划

> 目标：为 codeg 新增第三条 pi 连接路径——直接驱动 `pi --mode rpc`（不走 pi-acp 适配器），并把它作为 PiConfigPanel 的第三个运行时选项。现有 pi-acp 路径原样保留、随时可切回。
>
> 状态：**规划中（待实施）**。本文档含：(A) pi RPC 协议调研成果（实现依据）；(B) 分阶段实施计划。

---

## 目录

- [一、背景与动机](#一背景与动机)
- [二、决策记录](#二决策记录)
- [三、架构总览](#三架构总览)
- [四、pi RPC 协议调研（实现依据）](#四pi-rpc-协议调研实现依据)
  - [0. 传输与 Framing](#0-传输与-framing)
  - [1. 入站命令（RpcCommand，39 种）](#1-入站命令rpccommand39-种)
  - [2. 出站事件（AgentSessionEvent）](#2-出站事件agentsessionevent)
  - [3. Extension UI 子协议](#3-extension-ui-子协议)
  - [4. 工具生命周期](#4-工具生命周期)
  - [5. 会话持久化](#5-会话持久化)
  - [6. 子代理](#6-子代理)
  - [7. MCP](#7-mcp)
  - [8. 其它 CLI flags](#8-其它-cli-flags)
  - [9. 消息类型字段级结构](#9-消息类型字段级结构)
  - [10. 同类开源实现调研](#10-同类开源实现调研)
  - [11. 协议稳定性与升级代价最小化设计](#11-协议稳定性与升级代价最小化设计)
- [五、codeg 现有连接层架构](#五codeg-现有连接层架构)
- [六、改动清单](#六改动清单)
- [七、分阶段实施](#七分阶段实施)
- [八、测试策略](#八测试策略)
- [九、风险与开放问题](#九风险与开放问题)

---

## 一、背景与动机

codeg 目前通过 **pi-acp**（ACP 适配器）驱动 pi：`npx pi-acp@0.0.32` → 内部再 `spawn pi --mode rpc`。这条链路存在固有限制：

1. **MCP 无法注入**：ACP 协议 wire 上的 `mcpServers` 字段被 pi-acp 直接丢弃（codeg 源码 `connection.rs:2392` `agent_delivers_wire_mcp(Pi) = false`），codeg 的 MCP 设置对 pi 无效。
2. **参数不转发**：`--approve`、`-e` 等 pi 参数 pi-acp 不转发。
3. **功能受限**：扩展斜杠命令、部分 TUI 能力在 ACP 子集下不可用。

调研发现 pi 核心本身有完整的 **RPC 模式**（`pi --mode rpc`，stdin/stdout JSONL），是 pi 官方支持的程序化接入方式。因此我们可以绕开 pi-acp，让 codeg 直接驱动 pi RPC，彻底解决 MCP 注入等问题。

**环境事实**：本机 pi 版本 **0.83.0**（`@earendil-works/pi-coding-agent@0.83.0`，全局 npm，`C:\nvm4w\nodejs`）。协议调研基于此版本。另装 `pi-acp@0.0.31`（codeg 用自己 pin 的 0.0.32）。

---

## 二、决策记录

用户确认的三个设计决策：

| 决策 | 选择 | 说明 |
|---|---|---|
| **决策 1**：原生 RPC 与 pi-acp 的关系 | **A** | 原生 RPC 作为 PiConfigPanel 第三个运行时选项（默认 pi / 自定义 pi / **原生 RPC**），保留 pi-acp 兜底，可随时切回 |
| **决策 2**：首版功能范围 | **B** | 全功能对齐：fork/resume、MCP 服务器直通、子代理（pi-subagents 工具透传）、worktree |
| **决策 3**：MCP 怎么接 | **B** | 原生 RPC 驱动直接注册 codeg 的 MCP server 列表给 pi（通过 `--mcp-config`），真正接上之前被 pi-acp 丢弃的 MCP 能力 |

**关键约束**：绝不触碰现有 ACP 路径（其他 agent 都在用）。分流的两个 driver 共享同一套中性外围，只在单一分流点分叉。

---

## 三、架构总览

```
PiConfigPanel 运行时选择 (default | custom | rpc)
        │ 写 env_json: CODEG_PI_RUNTIME_MODE=rpc
        ▼
spawn_agent_connection (connection.rs:1046)
        │ build_agent(:1106) 之前按 mode==rpc 分流
        ├─ 现有路径: build_agent → run_connection (ACP，零改动)
        └─ 新路径:   spawn_pi_rpc_connection
                        ├─ 复用: AgentConnection / ConnectionCommand / AcpEvent /
                        │        EventEmitter / SessionState / ConnectionCleanupGuard
                        └─ 新写: run_pi_rpc_connection (pi RPC 驱动)
                                    ├─ spawn "pi --mode rpc" (+ --mcp-config / --provider / ...)
                                    ├─ stdio JSONL 读写 (手动 split \n, StringDecoder)
                                    ├─ 事件循环: AgentSessionEvent → AcpEvent
                                    ├─ 命令循环: ConnectionCommand → RpcCommand
                                    └─ extension_ui_request → PermissionDialog/QuestionDialog
```

**为什么可行**：
- `AcpEvent`（40 个变体）是 codeg 自己的中性事件模型，前端只认这套。
- `ConnectionManager` / `ConnectionCommand` / `AgentConnection` 也是中性结构。
- 前端会话渲染**零改动**（事件仍走 `acp://event` 通道，agent_type 仍为 `"pi"`）。

---

## 四、pi RPC 协议调研（实现依据）

> 来源：本机 `@earendil-works/pi-coding-agent@0.83.0` 源码（`dist/modes/rpc/rpc-mode.js`、`rpc-types.d.ts`、`rpc-client.js`、`jsonl.js`、`docs/rpc.md` 1576 行）交叉验证。

### 0. 传输与 Framing

- 进程：`pi --mode rpc [options]`（或 `pi-rpc` bin）。stdin/stdout 均为 JSONL，**stderr 保留**（错误/日志，官方 client 收集 stderr 供调试）。
- 分隔符：**仅 LF (`\n`)**。reader 用 `StringDecoder` 手动 split；输入行接受尾随 `\r`（`\r\n` 兼容）。**禁用 readline**（它会 split U+2028/U+2029，破坏 JSON 字符串）。
- 写入走 `takeOverStdout()` + `writeRawStdout()`，带背压控制。
- 启动时**无握手、无初始事件**。首条消息是客户端发命令。
- **`@file` 参数不支持**：RPC 模式拒绝 `@file` 并 exit(1)。
- 关停：stdin 收到 EOF → 自动 `shutdown()`（exit 0）。SIGTERM → exit 143。
- 命令解析错误 → 响应 `{type:"response", command:"parse", success:false, error:"Failed to parse command: ..."}`。
- 收到 `extension_ui_response` 不会被当作命令处理，直接路由到 pending 对话框。

### 1. 入站命令（RpcCommand，39 种）

所有命令带可选 `id`（用于关联响应），响应回传相同 `id`。

| 命令 | 字段 | 响应 data |
|---|---|---|
| `prompt` | `message: string`、`images?: ImageContent[]`、`streamingBehavior?: "steer"\|"followUp"` | 无（成功=已接受/排队） |
| `steer` | `message`、`images?` | 无 |
| `follow_up` | `message`、`images?` | 无 |
| `abort` | — | 无 |
| `new_session` | `parentSession?: string` | `{cancelled: boolean}` |
| `get_state` | — | `RpcSessionState` |
| `set_model` | `provider: string`、`modelId: string` | `Model`（不存在则 error） |
| `cycle_model` | — | `{model, thinkingLevel, isScoped}` 或 `null` |
| `get_available_models` | — | `{models: Model[]}` |
| `set_thinking_level` | `level: ThinkingLevel` | 无 |
| `cycle_thinking_level` | — | `{level}` 或 `null` |
| `get_available_thinking_levels` | — | `{levels: ThinkingLevel[]}` |
| `set_steering_mode` | `mode: "all"\|"one-at-a-time"` | 无 |
| `set_follow_up_mode` | `mode: "all"\|"one-at-a-time"` | 无 |
| `compact` | `customInstructions?: string` | `CompactionResult` |
| `set_auto_compaction` | `enabled: boolean` | 无 |
| `set_auto_retry` | `enabled: boolean` | 无 |
| `abort_retry` | — | 无 |
| `bash` | `command: string`、`excludeFromContext?: boolean` | `BashResult` |
| `abort_bash` | — | 无 |
| `get_session_stats` | — | `SessionStats` |
| `export_html` | `outputPath?: string` | `{path}` |
| `switch_session` | `sessionPath: string` | `{cancelled}` |
| `fork` | `entryId: string` | `{text, cancelled}` |
| `clone` | — | `{cancelled}` |
| `get_fork_messages` | — | `{messages: [{entryId, text}]}` |
| `get_entries` | `since?: string`（entry id 游标） | `{entries: SessionEntry[], leafId}` |
| `get_tree` | — | `{tree: SessionTreeNode[], leafId}` |
| `get_last_assistant_text` | — | `{text: string\|null}` |
| `set_session_name` | `name: string`（空 → error） | 无 |
| `get_messages` | — | `{messages: AgentMessage[]}` |
| `get_commands` | — | `{commands: RpcSlashCommand[]}` |

响应统一形状：

```json
{ "id"?, "type": "response", "command": "<cmd>", "success": true, "data"? }
{ "id"?, "type": "response", "command": "<cmd>", "success": false, "error" }
```

**关键语义**：
- **`prompt`**：响应在 preflight 通过后立刻发出（`preflightResult` 回调），**不是**等 agent 结束。成功后错误通过事件流报告，不会二次发 response。流式中必须带 `streamingBehavior`，否则 error。
- **`prompt` 支持 `/命令`**：`/extension-cmd` 立即执行（即使流式中）；`/skill:name` 与 prompt template 会先展开。
- **`steer`/`follow_up`** 也展开 skill/template，但**拒绝** extension 命令。
- `RpcSlashCommand`：`{name, description?, source: "extension"|"prompt"|"skill", sourceInfo: {path, source, scope, origin, baseDir?}}`。TUI 内置命令（/settings 等）不在此列，经 prompt 发送不会执行。
- `ThinkingLevel`：`"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"`（xhigh/max 仅模型支持时暴露）。

### 2. 出站事件（AgentSessionEvent）

`agent-session.d.ts`：`AgentSessionEvent = Exclude<AgentEvent, {type:"agent_end"}> | (agent_end 变体) | 会话扩展事件`。

流式事件（rpc-mode.js 把所有 `session.subscribe` 事件原样 `output(event)`）：

| 事件 | 字段 |
|---|---|
| `agent_start` | — |
| `agent_end` | `messages: AgentMessage[]`、`willRetry: boolean` |
| `agent_settled` | —（无后续重试/压缩/排队延续） |
| `turn_start` | — |
| `turn_end` | `message`、`toolResults: ToolResultMessage[]` |
| `message_start` / `message_end` | `message: AgentMessage` |
| `message_update` | `message`、`assistantMessageEvent`（delta，见下） |
| `tool_execution_start` | `toolCallId, toolName, args` |
| `tool_execution_update` | `toolCallId, toolName, args, partialResult`（**累积**输出，非增量） |
| `tool_execution_end` | `toolCallId, toolName, result, isError` |
| `bash_execution_update` | `id?`（bash 命令的 id）、`delta`（输出块） |
| `queue_update` | `steering: string[]`、`followUp: string[]` |
| `compaction_start` | `reason: "manual"\|"threshold"\|"overflow"` |
| `compaction_end` | `reason, result?, aborted, willRetry, errorMessage?` |
| `auto_retry_start` | `attempt, maxAttempts, delayMs, errorMessage` |
| `auto_retry_end` | `success, attempt, finalError?` |
| `summarization_retry_scheduled` | `attempt, maxAttempts, delayMs, errorMessage` |
| `summarization_retry_attempt_start` | `source: "branchSummary"` 或 `{source:"compaction", reason}` |
| `summarization_retry_finished` | — |
| `entry_appended` | `entry: SessionEntry`（扩展 appendEntry 时） |
| `session_info_changed` | `name: string\|undefined` |
| `thinking_level_changed` | `level: ThinkingLevel` |
| `extension_error` | `extensionPath, event, error`（rpc-mode.js 的 onError 发射） |

`assistantMessageEvent` delta 类型（`message_update` 内嵌），全部带 `contentIndex` 和 `partial`：

| delta type | 字段 |
|---|---|
| `start` | — |
| `text_start` | — |
| `text_delta` | `delta` |
| `text_end` | `content` |
| `thinking_start` | — |
| `thinking_delta` | `delta` |
| `thinking_end` | — |
| `toolcall_start` | — |
| `toolcall_delta` | `delta`（args 流式） |
| `toolcall_end` | `toolCall` |
| `done` | `reason: stop\|length\|toolUse` + `message` |
| `error` | `reason: aborted\|error` + `error` |

### 3. Extension UI 子协议

**请求（stdout）**，均有 `type:"extension_ui_request"` + 唯一 `id` + `method`：

| method | 字段 | 类别 |
|---|---|---|
| `select` | `title, options: string[], timeout?` | 对话框（阻塞等响应） |
| `confirm` | `title, message, timeout?` | 对话框 |
| `input` | `title, placeholder?, timeout?` | 对话框 |
| `editor` | `title, prefill?` | 对话框（无 timeout 支持） |
| `notify` | `message, notifyType?: "info"\|"warning"\|"error"` | fire-and-forget |
| `setStatus` | `statusKey, statusText: string\|undefined` | fire-and-forget |
| `setWidget` | `widgetKey, widgetLines: string[]\|undefined, widgetPlacement?: "aboveEditor"\|"belowEditor"` | fire-and-forget |
| `setTitle` | `title` | fire-and-forget |
| `set_editor_text` | `text` | fire-and-forget |

**响应（stdin）**：

```json
{ "type": "extension_ui_response", "id": "<reqId>", "value": "<string>" }       // select/input/editor
{ "type": "extension_ui_response", "id": "<reqId>", "confirmed": true|false }    // confirm
{ "type": "extension_ui_response", "id": "<reqId>", "cancelled": true }          // 任意对话框
```

- 对话框带 `timeout` 时 agent 侧到点自动用默认值 resolve（undefined/false），客户端无需计时。
- `ctx.mode === "rpc"`、`ctx.hasUI === true`。
- RPC 中降级/不可用：`custom()`→undefined、`setWorkingMessage/setWorkingIndicator/setFooter/setHeader/setEditorComponent/setToolsExpanded`→no-op、`getEditorText()`→`""`、`getToolsExpanded()`→`false`、`pasteToEditor()`→转发 `set_editor_text`、`getAllThemes()`→`[]`、`getTheme()`→undefined、`setTheme()`→`{success:false,error}`、`onTerminalInput()`→no-op。

### 4. 工具生命周期

- 内置工具定义：
  - `bash`：`{command: string, timeout?: number}`；details `{truncation?, fullOutputPath?}`
  - `read`：`{path: string, offset?: number, limit?: number}`
  - `edit`：`{path: string, edits: [{oldText: string, newText: string}]}`；details `{diff, patch, firstChangedLine?}`
  - `write`：`{path: string, content: string}`
  - `grep`：`{pattern, path?, glob?, ignoreCase?, literal?, context?, limit?}`
  - `find`：`{pattern: string, path?, limit?}`
  - `ls`：`{path?, limit?}`
  - 扩展工具：`{toolName: string, input: Record<string,unknown>}`（即 `CustomToolCallEvent`）
- 默认启用的内置工具：`read, bash, edit, write`（grep/find/ls 只读工具默认关）。`--tools`/`--exclude-tools`/`--no-tools`/`--no-builtin-tools` 可控制。
- 工具执行模式默认 **parallel**（`ToolExecutionMode`）；`tool_execution_end` 按完成顺序，tool-result message 按 assistant 源顺序。
- 扩展可通过 `on("tool_call")` 拦截（`{block?, reason?}` 返回，或原地修改 `event.input`），`on("tool_result")` 修改结果（`{content?, details?, isError?, usage?}`）。
- `ToolCallEvent` union：`BashToolCallEvent | ReadToolCallEvent | EditToolCallEvent | WriteToolCallEvent | GrepToolCallEvent | FindToolCallEvent | LsToolCallEvent | CustomToolCallEvent`，基类 `{type:"tool_call", toolCallId, toolName, input}`。
- `ToolResultEvent` union：同名 + `{type:"tool_result", toolCallId, toolName, input, content, isError, usage?, details}`。

### 5. 会话持久化

- **存储路径**：`<agentDir>/sessions/--<encoded-cwd>--/`，默认 agentDir=`~/.pi/agent`；cwd 编码：去掉首 `/\`，`/` 与 `:` 替换为 `-`，外包 `--`。文件：`<ISO-timestamp(冒号点→-)>_<sessionId>.jsonl`。
- **Session ID**：`uuidv7()`。校验正则：`^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`。
- **Entry ID**：8 hex（`randomUUID().slice(0,8)`），带碰撞检查。
- **文件格式**：JSONL，首行 header `{type:"session", version:3, id, timestamp(ISO), cwd, parentSession?}`，之后每个 entry 一行。
- **Entry 类型**（`SessionEntry` union）：
  - `message`：`{type, id, parentId: string|null, timestamp, message: AgentMessage}`
  - `thinking_level_change`：`{thinkingLevel: string}`
  - `model_change`：`{provider, modelId}`
  - `compaction`：`{summary, firstKeptEntryId, tokensBefore, details?, usage?, fromHook?}`
  - `branch_summary`：`{fromId, summary, details?, usage?, fromHook?}`
  - `custom`：`{customType, data?}`（不参与 LLM 上下文）
  - `custom_message`：`{customType, content, details?, display: boolean}`（**参与** LLM 上下文，转 user 消息）
  - `label`：`{targetId, label: string|undefined}`
  - `session_info`：`{name?}`
- `get_entries` 的 `since` 是持久游标（entry id），跨重启可用；找不到 → `success:false`。
- `get_tree` 返回 `{entry, children, label?, labelTimestamp?}` 节点；孤儿 entry 也作为根出现。
- 会话内消息 `session.messages` 含 `BashExecutionMessage`（`role:"bashExecution"`，字段 `command, output, exitCode, cancelled, truncated, fullOutputPath, timestamp`），下次 prompt 时转成带 `Ran \`cmd\`\n\`\`\`...\`\`\`` 文本的 user 消息。
- CLI 启动相关：`--continue/-c`（最近会话）、`--resume/-r`、`--session <path|id>`、`--session-id <id>`、`--fork <path|id>`、`--session-dir <dir>`、`--no-session`（临时）、`--name/-n`。

### 6. 子代理

- **不在 pi 核心**。pi-subagents 是第三方扩展（`@tintinweb/pi-subagents` 或 `@narumitw/pi-subagents`），本机已装 `pi-subagents`。
- 在 RPC 模式下它注册一个 `Agent` 工具（`subagent_type/prompt/description` 等参数），对 RPC 客户端而言表现为 `CustomToolCallEvent`/`tool_execution_start`（toolName=`Agent`），结果走 `tool_execution_end`。
- 子代理定义用 Markdown frontmatter（`~/.pi/agents/*.md` 或 `.pi/agents/*.md`），字段：`name, description, tools, extensions, model, fallbackModels, thinking, systemPromptMode, inheritProjectContext, inheritSkills, skills, output, defaultReads, defaultProgress, maxSubagentDepth` 等。
- 另有**跨扩展事件总线 RPC**（`pi.events`，仅扩展内部可用）：`subagents:rpc:ping/spawn/stop`。这不属于 stdin/stdout RPC 协议，codeg 无法直接调用。
- **结论**：codeg 如需子代理，只能把 `Agent` 当普通工具调用（由扩展翻译）。这正对应"决策2B 的子代理=工具透传渲染"。

### 7. MCP

- **不在 pi 核心**。MCP 通过 `pi-mcp-adapter`（本机已装）扩展实现。
- 配置文件：`~/.pi/agent/mcp.json`（global）、`~/.pi/mcp.json`（project override）、`.mcp.json`（共享）。本机 `~/.pi/agent/mcp.json`：`{"mcpServers":{"context-mode":{"command":"context-mode"}}}`。
- 该扩展注册 `/mcp` 系列斜杠命令与 CLI flag **`--mcp-config <path>`**（通过扩展 `registerFlag`），用于把 MCP server 配置注入。工具以两种形式出现：
  - **代理工具** `mcp`（`{tool, args, server, ...}` 参数），或
  - **direct tools**（`directTools` 配置提升），此时作为普通工具出现在 `tool_execution_start`/`CustomToolCallEvent`（toolName 为 MCP 工具名）。
- 本机 `~/.pi/agent/mcp-cache.json` 已确认存在，context-mode 的 11 个 ctx_* 工具已缓存注册（`ctx_execute, ctx_execute_file, ctx_index, ctx_search, ctx_fetch_and_index, ctx_batch_execute, ctx_stats, ctx_doctor, ctx_upgrade, ctx_purge, ctx_insight`）。**pi-mcp-adapter 已实际生效**。
- **决策3B 实现方式**：codeg 生成合并后的 mcp.json（codeg 的 MCP server 列表 + 用户已有配置），通过 `--mcp-config <path>` 传给 pi RPC 进程，由 pi-mcp-adapter 加载。

### 8. 其它 CLI flags

RPC 模式下可用的启动 flags：`--provider`、`--model`（支持 `provider/id` 和 `:thinking` 后缀）、`--api-key`、`--system-prompt`、`--append-system-prompt`（可多次）、`--name/-n`、`--session-dir`、`--no-session`、`--session <path|id>`、`--session-id`、`--fork`、`--continue/-c`、`--resume/-r`、`--models`、`--no-tools/-nt`、`--no-builtin-tools/-nbt`、`--tools/-t`、`--exclude-tools/-xt`、`--thinking <level>`、`--extension/-e`（可多次）、`--no-extensions/-ne`、`--skill`、`--no-skills/-ns`、`--prompt-template`、`--no-prompt-templates/-np`、`--theme`、`--no-themes`、`--no-context-files/-nc`、`--offline`、`--verbose`、`--approve/-a`、`--no-approve/-na`。**扩展可注册额外 flags**（如 `--mcp-config`），值经 `parsed.unknownFlags` 传给扩展。

### 9. 消息类型字段级结构

- `TextContent {type:"text", text, textSignature?}`；`ThinkingContent {type:"thinking", thinking, thinkingSignature?, redacted?}`；`ImageContent {type:"image", data: string(base64), mimeType}`；`ToolCall {type:"toolCall", id, name, arguments: Record<string,any>, thoughtSignature?}`。
- `UserMessage {role:"user", content: string | (TextContent|ImageContent)[], timestamp}`。
- `AssistantMessage {role:"assistant", content: (TextContent|ThinkingContent|ToolCall)[], api, provider, model, responseModel?, responseId?, diagnostics?, usage, stopReason, errorMessage?, rawStopReason?, timestamp}`。
- `ToolResultMessage {role:"toolResult", toolCallId, toolName, content, details?, usage?, addedToolNames?, isError, timestamp}`。
- `Usage {input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost:{input,output,cacheRead,cacheWrite,total}}`。
- `StopReason: "pending"|"stop"|"length"|"toolUse"|"error"|"aborted"`。
- `Model {id, name, api, provider, baseUrl, reasoning, thinkingLevelMap?, input:("text"|"image")[], cost:{input,output,cacheRead,cacheWrite,tiers?}, contextWindow, maxTokens, headers?, compat?}`。

### codeg 集成建议（要点）

1. 用 `spawn("pi", ["--mode","rpc", ...])` 或直接 spawn `node dist/cli.js`。100ms 初始化探测。
2. stdout reader 必须手动 split `\n`（StringDecoder），strip 尾 `\r`，**不要用 readline**。
3. 状态机：`prompt` 响应=已接受；结束信号用 `agent_end`（单轮）或 `agent_settled`（完全空闲，含重试/压缩/队列）；流式文本用 `message_update.assistantMessageEvent.type==="text_delta"`；工具进度用 `tool_execution_start/update/end`（update 是累积）。
4. 需要 UI 时实现 `extension_ui_request` 子协议（对话框请求/应答 + fire-and-forget 展示）。
5. 持久化可完全依赖 pi 自身（session.jsonl 树），用 `get_entries`+`since` 游标做增量同步，或用 `--session-id`/`--session` 固定文件。
6. 无 `subscribe` 命令——事件全量推送，客户端自行过滤。

### 10. 同类开源实现调研（2026-07 检索）

已确认存在绕过 ACP、直接驱动 pi 的开源项目，但**全部是"嵌入式 SDK"方式**（Node/TS/Python 进程内 `createAgentSession()`），**没有 Rust spawn `pi --mode rpc` 子进程 + JSONL 的现成实现**。

| 项目 | 语言 | 驱动方式 | 可借鉴点 |
|---|---|---|---|
| **ciconia-w/Sunday** | TS | 嵌入式 SDK | `pi-sidecar/src/bridge/pi-session-bridge.ts`：`createAgentSession()` + `session.prompt()` + `session.subscribe()` 订阅 `AgentSessionEvent`；`text_delta`→message、`tool_execution_start`→tool 的事件归一化逻辑 |
| **tzynb112/pi-agent-desktop** | TS (Electron) | 嵌入式 SDK | `src/main/pi-runtime.ts`：`createAgentSessionFromServices`/`createAgentSessionServices`；完整安全审批（危险命令关键词 `rm`/`kill` 等）、工具白名单、HTTP 代理注入 |
| **Mohwit/pi-mono-sdk** | Python | bridge 二进制 | 内嵌 pi-agent-core + `pi-agent-bridge` 二进制；`text_delta` 流式事件；session_persistence / sync_api 示例 |
| **waitkeeper/pi-desktop** | TS (Electron) | 嵌入式 SDK | `internal/agent-kernel/src/extension-ui-broker.ts`：处理 `extension_ui_request` 的现成实现，与"权限桥接"（Phase 3）直接相关 |
| aannoo/hcom | Rust | argv hooks + 日志解析 | **非 RPC 驱动**：靠 hook 注入 + 读 session jsonl transcript（`src/transcript/pi.rs`）；可借鉴 jsonl 解析 |

**关键结论**：
- 这些实现都是进程内嵌入 pi SDK，因 pi 本身是 Node 包，宿主又是 Node/TS（Electron），进程内调用最省事。
- codeg 后端是 **Rust**，无法内嵌 Node SDK，必须走 **spawn `pi --mode rpc` 子进程 + stdio JSONL**——这是空白地带，**没有现成开源实现可抄**（`nktkt/pi`、`metaphorics/pi-rust` 是"Rust 重写 pi"，方向相反）。
- 高价值参考：(1) **pi 官方自带 `rpc-client.js`**（权威协议参考，我们的 Rust 实现本质是其移植）；(2) **Sunday 的 `pi-session-bridge.ts`**（事件归一化）；(3) **waitkeeper/pi-desktop 的 `extension-ui-broker.ts`**（`extension_ui_request` 处理）。

### 11. 协议稳定性与升级代价最小化设计

pi 会持续升级，RPC 协议也会漂移。**升级代价最小化是本方案的一等设计原则**（而非事后补救），目标：pi 升级时，改动只落在一个文件、且通常是"加一个 case"而非"重构"。

核心策略：**把"协议脆弱点"全部收敛到单一隔离层，并让该层对未知内容宽容**。

#### 11.1 协议层独立 + 版本化（唯一改动点）

`protocol.rs` 是所有 pi 字段结构体的唯一居所，文件头注释标注对应 pi 版本。**升级时只改这一个文件**，driver/前端永远不因协议变更而改。

- 用 serde 声明式结构体，文件头写 `// compatible with pi @earendil-works/pi-coding-agent@0.83.x`。
- 官方 `rpc-client.js` 是协议真相源——升级时以它为准 `diff` 我们的 struct。

#### 11.2 宽容解析：未知字段/未知事件不炸（关键韧性）

pi 加字段、加事件、加枚举值时，**不能**因此断掉整条连接：

- **不开启 `#[serde(deny_unknown_fields)]`**——pi 新增字段会被静默忽略，不破坏反序列化。
- **事件枚举加 `#[serde(other)]` 兜底变体 `PiEvent::Unknown`**：遇到不认识的事件 `type`，记录日志 + 跳过，不终止会话。
- **响应/命令同理**：未知 `command` 的响应 → 忽略（`#[serde(other)]` 或 `flatten` 捕获）。
- **枚举值宽容**：`ThinkingLevel`、`StopReason` 等用 `#[serde(rename_all)]` + `#[serde(other)]`，未知值落到 `Unknown(String)` 变体，而不是反序列化报错。

> **默认取舍（已定）**：未知事件采用**静默跳过 + 日志**，不向前端暴露 Unknown 占位块（避免 UI 噪音）。遇未知事件时打一条 debug 级日志，供升级诊断。

效果：pi 若只**加**字段/事件，我们**零改动**照常运行；只有**破坏性变更**（字段改名、删字段、语义变化）才需改——此类变更官方通常会在 changelog 标注。

#### 11.3 版本探测 + 适配层

- 启动时向 pi 发 `get_state`（或读版本），拿到运行时版本。
- `driver.rs` 里针对**已知破坏性变更**用 `match runtime_version` 做差异处理，适配逻辑按版本号 gate。
- 设一个 `ProtocolCompat` 层：`fn adapt(event, version)`——未来版本差异集中在这里。

#### 11.4 稳定的前端契约（AcpEvent 不变）

前端只认 codeg 自己的 `AcpEvent`。pi 加任何新东西，我们映射到一个已存在的 AcpEvent 变体即可，前端**永远零改动**。这是设计原则：**AcpEvent 是稳定边界，pi 的变化在 protocol.rs→driver.rs 内部消化**。

#### 11.5 升级回归流程（内建，非事后）

把"升级"做成可重复的一等流程：

1. pi 升级 → 跑一个采集脚本（`pi --mode rpc` 的典型交互 dump 成 JSONL fixture）。
2. `cargo test` 看哪些 fixture 解析失败/落入 `Unknown`。
3. 按官方 changelog + `rpc-client.js` diff，更新 `protocol.rs`（加变体/字段）+ `driver.rs`（加映射 case）。
4. 更新 fixture 快照，提交时记录支持的 pi 版本范围。

#### 11.6 fixture 快照回归测试

- 每种事件类型存一个 JSONL fixture 文件（从真实 `pi --mode rpc` 输出采集）。
- 测试断言：所有 fixture 能被解析且无 `Unknown` 泄漏（或 `Unknown` 为预期）。
- 升级后第一时间跑，问题在测试层暴露而非运行时。

#### 11.7 版本门槛（已定默认）

- 设**最低支持版本** `>=0.83.0`（0.83 是协议调研基准）。低于则拒绝连接并提示升级 pi，避免在新旧协议语义错位下静默出错。

---

## 五、codeg 现有连接层架构

（基于对 `src-tauri/src/acp/` 的源码调研）

### 核心事实

1. **连接唯一入口**：`ConnectionManager::spawn_agent`（`manager.rs:400`）→ `spawn_agent_connection`（`connection.rs:1046`）。Tauri 命令入口 `acp_connect`（`commands/acp.rs:8232`）。
2. **构造 ACP 适配器进程**：`build_agent`（`connection.rs:624-1019`），按 `AgentDistribution` 三分支（Npx / Binary / Uvx）全部返回同一个具体类型 `sacp_tokio::AcpAgent`。
3. **驱动循环**：`run_connection`（`connection.rs:2886`，约 1035 行巨型函数），内部 `connect_with`（`:3172`）是驱动闭包；`run_conversation_loop`（`:5524`）是双 select 事件/命令循环。
4. **无 driver trait**：`AcpAgent` 是硬编码具体类型。加 pi RPC 驱动**必须另写平行实现**，无法复用 run_connection。
5. **旁路点干净**：`spawn_agent_connection`（1046）内 `build_agent`（1106）之前按 `agent_type == Pi` 分流即可，完全不动 build_agent/run_connection。
6. **中性可复用外围**：`AgentConnection`（297）、`ConnectionCommand`（227）、`AcpEvent`（`types.rs:63-393`，40 变体）、`ConnectionManager`、`SessionState`、`EventEmitter`、`ConnectionCleanupGuard`、pi 预检辅助（`pi_launch_preflight`、`seed_pi_workspace_trust`，`connection.rs:646-660`）。
7. **权限流程**：ACP `session/request_permission`（`connection.rs:2979`）→ `handle_permission_request`（`:4352`）→ 存 `pending_perms` → 发射 `AcpEvent::PermissionRequest`；用户响应经 `acp_respond_permission` → `ConnectionCommand::RespondPermission` → `Responder::respond`。`PendingPermission`（`manager.rs:1311`）已是两态（`Acp` / `CodexElicitation`），有先例。pi 的 `extension_ui_request` 与 ACP 协议不同但映射逻辑高度相似，可套用 `question.rs`/`plan_approval.rs` 的"阻塞交互+前端卡片"管线。
8. **FS/终端运行时**：`file_system_runtime.rs`、`terminal_runtime.rs` 是 codeg 自己实现的能力，但对外接口是 ACP 类型（`sacp::schema::*Request/*Response`）。pi 自备工具则协议胶水层可丢弃，但 `TerminalRuntime` 的核心（`poll_tracked_terminal_tool_calls`、`release_all_for_session`）是中性逻辑可复用。
9. **delegation**：基于 `ConnectionManager` 的中性层（`ConnectionSpawner` trait），pi 绕开 codeg-mcp 注入（`inject_codeg_mcp`，`:3300`，ACP 专属）。若 pi driver 注册进 ConnectionManager，delegation 对 pi 是可选、不需改动。

### 前端

- 前端是"**类型/形状驱动、agent 无关**"的：`handleMappedEvent` 只看 `e.type` 不看 `agentType`；`buildStreamingTurnsFromLiveMessage` 无 agentType 参数；`adaptContentBlock` 只按 `block.type` 分发。
- 唯一需要改前端的场景是"产生 ACP 无法表达的新事件"或"引入全新命令面"——我们的方案都不涉及。
- 事件线：`AcpEvent`/`EventEnvelope`（含 `seq`/`connection_id`），走 `acp://event`（Tauri）或 WS attach 流（Web）。命令面：`api.ts` 的 `acp_connect`/`acp_prompt`/`acp_cancel`/`acp_respond_permission` 等。
- 展示层：`getAgentLabel`/`getAgentColor`/`getAgentIconUrl` 对 `pi` 已有内置记录（`types.ts:943-971`），无需改动。
- **结论：后端归一化契约满足时前端会话渲染零改动。**

---

## 六、改动清单

### A. 新增 `src-tauri/src/acp/pi_rpc/` 模块（约 1500-2500 行 Rust）

| 文件 | 内容 | 预估 |
|---|---|---|
| `pi_rpc/mod.rs` | 模块导出 + `spawn_pi_rpc_connection` 入口（复用外围、起专用线程、RAII 清理） | ~250 |
| `pi_rpc/protocol.rs` | 协议层：入站命令（prompt/abort/new_session/get_state/set_model/compact/get_messages/get_entries/fork/clone/bash…）、出站事件 union（agent_start/end、message_*、tool_execution_start/update/end、bash_execution_update、queue_update、compaction_*、extension_ui_request、session_info_changed…）、extension_ui 子协议（select/confirm/input/editor + response）、AgentMessage/TextContent/ToolCall/Usage | ~700 |
| `pi_rpc/driver.rs` | 驱动层：spawn 进程、stdio JSONL reader/writer（手动 split `\n`、strip `\r`、不用 readline）、双 select 事件/命令循环、事件归一化到 AcpEvent、权限桥接、会话/fork/resume | ~1200 |
| `pi_rpc/mcp.rs` | MCP 直通：读取 codeg 的 MCP server 列表 → 生成合并 mcp.json → 拼 `--mcp-config` 参数 | ~200 |

### B. 修改现有文件（少量）

| 文件 | 改动 | 预估 |
|---|---|---|
| `src-tauri/src/acp/connection.rs` | `spawn_agent_connection` 里 `build_agent` 前读 agent env 的 `CODEG_PI_RUNTIME_MODE`，==rpc 时走 `pi_rpc::spawn_pi_rpc_connection` | ~20 行 |
| `src-tauri/src/acp/mod.rs` | 声明 `pi_rpc` 模块 | ~2 行 |
| `src-tauri/src/commands/acp.rs` | 可能：`acp_update_pi_config` 透传 rpc 模式 / MCP 列表读取命令 | ~50 行 |
| `src/components/settings/pi-config-panel.tsx` | `PiRuntimeMode` 加 `"rpc"`；RadioGroup 加第三选项；`buildPiRuntimeEnv` 写 `CODEG_PI_RUNTIME_MODE` | ~40 行 |
| `src/i18n/messages/*.json` | 加 `modeRpc`/`modeRpcHint` 等键（10 语言） | 每文件 ~4 行 |

### C. 前端会话渲染

**零改动**（事件仍走 `acp://event` 通道，agent_type 仍为 `"pi"`）。

---

## 七、分阶段实施

### Phase 1 — 协议层（纯 Rust，无集成）

`protocol.rs` 全部 struct + JSONL 反序列化测试。用官方 docs/rpc.md 的示例 JSON 做 fixture。

**本阶段即落地升级设计**：
- 宽容解析：不 `deny_unknown_fields`；`#[serde(other)]` 兜底变体 `PiEvent::Unknown`；枚举未知值 → `Unknown(String)`。
- 版本探测框架：`get_state` 读版本 + 版本门槛校验（`>=0.83.0`）。
- 首个 fixture 采集脚本：`scripts/pi-rpc-dump.*`，从真实 `pi --mode rpc` dump 典型交互为 JSONL fixture。

**验收**：`cargo test --features test-utils` 通过协议解析单测；未知事件 fixture 能优雅降级（无 panic、无会话中断）。

### Phase 2 — 最小驱动（端到端跑通）

spawn + `prompt` + `message_update`(text_delta) → `ContentDelta` + `tool_execution_start/end` → `ToolCall` + `agent_end` → `TurnComplete` + `abort`/`Cancel`。

**本阶段引入** `ProtocolCompat` 适配层雏形（`fn adapt(event, version)`），为后续版本差异留接口。

**验收**：codeg 里 pi 能对话、能执行工具、能中止。

### Phase 3 — 权限/交互桥接

`extension_ui_request`(select/confirm/input) → `AcpEvent::PermissionRequest`/`QuestionRequest` → 用户响应 → `extension_ui_response` 回写。套用现有 `question.rs`/`plan_approval.rs` 的卡片管线。

**验收**：pi 请求选择/确认时 codeg 弹卡片。

### Phase 4 — 会话持久化/fork/resume

session id 分配（`new_session`）、`get_messages` 同步历史、`fork`/`clone`/`switch_session`、断线重连按 session 恢复。

**验收**：对话历史可恢复、可 fork 分支。

### Phase 5 — MCP 直通（决策3B）

`mcp.rs` 生成合并 mcp.json（codeg MCP server 列表 + 用户已有的 context-mode），启动传 `--mcp-config`。

**验收**：codeg 里用原生 RPC 的 pi 能看到并调用 ctx_* 工具。

### Phase 6 — 前端选项

PiConfigPanel 第三 radio + i18n + preflight 适配。

**验收**：`pnpm build` 通过，UI 出现"原生 RPC"选项。

### Phase 7 — 子代理/worktree 验证

pi-subagents 的 `Agent` 工具走 `CustomToolCallEvent`→`tool_execution_*`（决策2B 的"子代理"= 工具透传渲染，非 codeg delegation）；pi-worktree 等扩展同理验证。

**验收**：子代理/worktree 工具在 codeg 正常渲染执行。

---

## 八、测试策略

- **Rust 单测**：`protocol.rs` JSONL 解析/序列化（fixture 驱动）；`driver.rs` 事件归一化（用 JSONL fixture 模拟 pi 输出，不真起进程）。
- **Rust 集成测试**：起一个真实 `pi --mode rpc` 子进程，跑一轮 prompt + 工具执行（需要 API key，标 `#[ignore]` 或走 test-utils feature）。
- **前端 vitest**：`pi-config-panel.test.tsx` 新增 rpc 选项渲染/env 生成断言。
- **升级回归流程**：详见 §11.5——fixture 采集脚本 + 解析回归 + 版本 diff。
- **fixture 快照比对**：见 §11.6——断言所有事件 fixture 无 `Unknown` 泄漏（或为预期）。
- **验收命令**：`cargo test --features test-utils`、`cargo clippy --all-targets --features test-utils -- -D warnings`、`pnpm eslint .`、`pnpm test`、`pnpm build`。

---

## 九、风险与开放问题

1. **RPC 协议漂移**：0.83.0 是当前目标，未来 pi 升级需回归。缓解机制见 §11（完整）：协议层独立版本化、宽容解析、版本门槛 + 门槛拒绝、`ProtocolCompat` 适配层、升级回归流程、fixture 快照比对。核心：只有**破坏性变更**才需改动，且只改 `protocol.rs`/`driver.rs`。
2. **`editor` 对话框映射**：pi 的 `editor` method（多行文本编辑）在 codeg 卡片里较难完美映射，Phase 3 先支持 select/confirm/input，editor 降级为 input。
3. **MCP 合并冲突**：codeg MCP 列表与 `~/.pi/agent/mcp.json` 若都有 context-mode 会重复注册。需定义合并优先级（codeg 生成的临时文件覆盖/叠加）。
4. **服务器模式（Web 端）**：走 WebSocket attach 流，新路径事件经同一条 `acp://event` 通道，理论上零改动，但需在 Phase 2 验证快照/重放。
5. **子代理范围**：决策2B 的"子代理"按"工具透传渲染"理解（pi-subagents 的 Agent 工具）；codeg 的 delegate_to_agent 委托链对 pi 属二期，先不做。
6. **升级相关风险**（补充自 §11 设计）：
   - **宽松解析的副作用**：未知事件静默跳过可能导致功能缺失不可见。缓解：debug 日志记录所有 `Unknown` 降级，便于升级诊断；fixture 快照比对强制暴露"新增但未识别"的事件。
   - **版本门槛过严/过松**：门槛过低会在语义错位下运行；过高会拒绝仍可用的旧版。缓解：门槛 `>=0.83.0` 按需调整，破坏性变更发生时显式提升。
   - **session 文件格式版本（`version:3`）**：独立于 RPC 协议，升级若变更需同步更新解析；同样走 fixture 回归。
7. **待确认点**：
   - 子代理定义（工具透传 vs codeg delegation）——默认按工具透传，delegation 二期。
   - MCP 合并优先级——默认 codeg 生成的临时文件叠加用户配置，冲突时 codeg 优先。
   - 升级相关两个取舍**已定默认**：未知事件静默跳过+日志（§11.2）；版本门槛 `>=0.83.0`（§11.7）。如需调整可再改。
