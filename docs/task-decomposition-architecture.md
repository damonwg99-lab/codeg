# Task Decomposition (任务拆分) Architecture

## 1. Overview

任务拆分功能允许用户请求 AI 将复杂任务自动拆解为结构化子任务。整个流程从前端用户输入 → AI 响应解析 → 覆盖层编辑确认 → 后端持久化，闭环运作。

---

## 2. Data Flow

```
User types: "帮我分解这个任务"
    │
    ▼
[1. Intent Detection & Instruction Injection]
    use-decomposition-sender.ts :: wrapDecompositionDraft()
    │  - hasDecompositionIntent(text) 检测 13 个中英文关键词
    │  - 匹配成功 → 用 sentinel 包裹追加 DECOMPOSITION_INSTRUCTION
    ▼
[2. AI 响应]
    conversation-detail-panel.tsx :: handleSend()
    │  在发送扼流点用 wrapped draft 替换原始 draft
    ▼
[3. 解析与渲染]
    ai-elements-adapter.ts :: adaptMessageTurn()
    │  - 合并连续 text block → expandDecompositionText()
    │  - 提取 ```task_decomposition_json fence → JSON 解析
    │  - 生成 AdaptedDecompositionPart { type: "decomposition", tasks, isStreaming }
    │  - 未完成 fence → 渲染 streaming 占位
    ▼
[4. 组件渲染]
    content-parts-renderer.tsx
    │  渲染 <DecompositionCard tasks={...} isStreaming={...} />
    ▼
[5. 状态管理]
    use-decomposition-detector.ts
    │  从 localTurns 自动检测 proposal → 管理 overlay 生命周期
    ▼
[6. 覆盖层编辑 & 确认]
    DecompositionOverlay dialog
    │  用户编辑 → 点击 "Confirm & Create"
    ▼
[7. 后端持久化]
    message-list-view.tsx :: handleDecompConfirm()
    │  1. createDecomposition() 写入 audit 记录
    │  2. createTask() 批量创建子任务
    │  3. confirmDecomp() 更新本地状态
    ▼
    Toast "已创建 X 个任务" ✓
```

---

## 3. Key Implementation Details

### 3.1 Intent Detection

- **File**: `src/lib/platform/decomposition-parser.ts`
- **Keywords**: 13 个中英文关键词（如 "分解", "拆解", "break down", "sub-task" 等）
- **Algorithm**: 大小写不敏感的 `includes()` 子串匹配
- **Chokepoint**: `conversation-detail-panel.tsx` 中 `handleSend()` 是唯一的注入点，所有消息必经此路

### 3.2 Instruction Injection

- **Instruction text**: 仅一句中文系统指令，要求 AI 在回复末尾输出 ` ```task_decomposition_json` fence
- **Sentinel 包裹**: `⟦codeg:decomp-instruction⟧` 标记指令范围
- **Stripping 机制**: `stripFeedbackReminder()` 在展示前用 sentinel 标记清除指令文本，保证用户看不到被注入的指令
- **好处**: 轻量、非侵入，不改变 agent 的多轮对话结构

### 3.3 JSON Parsing（双策略）

| Strategy | Pattern | 说明 |
|---|---|---|
| Primary | ` ```task_decomposition_json ... ``` ` | 专有 fence，精确匹配 |
| Fallback | ` ```json { "subTasks": [...] } ``` ` | 兼容通用 JSON 格式 |

- **Normalization**: 校验 `taskType` 和 `priority` 的合法值，越界时赋默认值
- **Streaming**: 检测不完整 fence（无闭合 ` ``` `），渲染 "Generating task breakdown…" 占位

### 3.4 Frontend State Machine

- **File**: `src/hooks/use-decomposition-detector.ts`
- **Scope**: 以 `convId` 为键，切换对话自动过期
- **State**:
  - `detectedSubTasks` — 从 AI 回复通过 `useMemo` 自动推导
  - `userEdited` — 用户在 overlay 中的手动编辑（内存中）
  - `dismissed` — 持久化到 `localStorage`
  - `confirmed` — 持久化到 `localStorage`
- **Proposal key**: 从子任务 title/type/priority 生成稳定 hash 值，用于检测 proposal 变更；AI 发送新 proposal 时覆盖旧的 dismissal

### 3.5 UI Components

| Component | File | 职责 |
|---|---|---|
| `DecompositionCard` | `src/components/message/decomposition-card.tsx` | 消息流内嵌卡片，显示子任务列表 + 状态 |
| `DecompositionOverlay` | `src/components/chat/decomposition-overlay.tsx` | 全屏对话框，编辑/确认/创建 |
| `DecompositionOverlayContext` | `src/components/chat/decomposition-overlay-context.tsx` | React Context，桥接 MessageListView → DecompositionCard |

### 3.6 Backend Persistence

- **Entity**: `platform_task_decomposition`（SeaORM, SQLite）
- **Core function**: `task_commands::create_decomposition_core()`
- **Dual-mode**: 通过 `_core` 模式，同时在 Tauri 命令和 Axum HTTP handler 中提供服务

### 3.7 API

- **Transport**: 自动检测 Tauri invoke / HTTP fetch（`src/lib/platform/api.ts`）
- **Endpoint**: `create_decomposition`
- **Params**: `{ sourceTaskId, aiGenerated, decompositionJson }`

---

## 4. File Inventory

### Rust Backend

| 文件 | 职责 |
|---|---|
| `src-tauri/src/db/entities/platform_task_decomposition.rs` | SeaORM 实体 |
| `src-tauri/src/db/entities/platform_task.rs` | 父实体，声明 `Decompositions` 关系 |
| `src-tauri/src/db/service/platform_task_decomposition_service.rs` | CRUD 服务 |
| `src-tauri/src/db/migration/m20260622_platform_000001_create_core_tables.rs` | SQLite 迁移 |
| `src-tauri/src/models/platform_task.rs` | 共享模型 `TaskDecompositionInfo` |
| `src-tauri/src/commands/task.rs` | 业务逻辑 `create_decomposition_core` |
| `src-tauri/src/web/handlers/task.rs` | Axum HTTP handler |
| `src-tauri/src/web/router.rs` | 路由注册 |
| `src-tauri/src/lib.rs` | Tauri 命令注册 |

### Frontend

| 文件 | 职责 |
|---|---|
| `src/lib/platform/decomposition-parser.ts` | 核心解析器（检测 + 提取 + 指令） |
| `src/lib/platform/types.ts` | TypeScript 类型 |
| `src/lib/platform/api.ts` | API 客户端 |
| `src/lib/adapters/ai-elements-adapter.ts` | AI 响应 → 组件适配 |
| `src/lib/feedback-reminder.ts` | Sentinel 定义 + stripping |
| `src/hooks/use-decomposition-detector.ts` | Proposal 检测状态机 |
| `src/hooks/use-decomposition-sender.ts` | 发送端指令注入 |
| `src/components/message/decomposition-card.tsx` | 消息流内联卡片 |
| `src/components/message/content-parts-renderer.tsx` | Part 类型分发渲染 |
| `src/components/chat/decomposition-overlay.tsx` | 编辑确认覆盖层 |
| `src/components/chat/decomposition-overlay-context.tsx` | Context 桥接 |
| `src/components/conversations/conversation-detail-panel.tsx` | 发送扼流点 |
| `src/components/message/message-list-view.tsx` | 确认回调 + 批量创建 |

### i18n

`i18n/messages/*.json` 中 10 种语言定义了 `Platform.task` 下的 8 个 decomposition 相关 key。

---

## 5. Design Decisions

1. **Lightweight instruction**: 单句中文字符串，非独立 system message，保持 agent 行为变化最小
2. **Sentinel 剥离**: 用 Unicode 标记包裹注入指令，reload 时从展示文本中完全移除
3. **Conversation-scoped state**: 所有状态以 `convId` 为索引，防止跨对话泄漏
4. **localStorage 持久化**: 关闭/重开 tab 后 dismiss/confirm 状态不丢失
5. **Streaming 韧性**: 未完成 fence 渲染占位符，等待完整 JSON 到达后替换
6. **双后端模式**: `_core` 函数抽象，Tauri desktop 和 Axum server 共享同一逻辑
