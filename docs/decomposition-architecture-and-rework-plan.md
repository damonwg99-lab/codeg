# Task Decomposition (任务拆分) — 架构源码分析与改版方案

---

## 目录

1. [Overview](#1-overview)
2. [Data Flow](#2-data-flow)
3. [当前渲染管线源码分析](#3-当前渲染管线源码分析)
4. [渲染失败原因 — Root Cause 分析](#4-渲染失败原因--root-cause-分析)
5. [改版方案对比](#5-改版方案对比)
6. [推荐方案：Turn Builder 合成 Decomposition Block（对应表 A）](#6-推荐方案turn-builder-合成-decomposition-block对应表-a)
7. [影响评估：双路径同步问题](#7-影响评估双路径同步问题)
8. [与现有 DecompositionDetector 的兼容关系](#8-与现有-decompositiondetector-的兼容关系)

---

## 1. Overview

任务拆分功能允许用户请求 AI 将复杂任务自动拆解为结构化子任务。当前实现依赖前端正则解析 AI 响应文本中的 ````task_decomposition_json` code fence，稳定性不足。

### 当前流程

```
用户输入 → Instruction 注入 → AI 回复（含 ```task_decomposition_json fence）
  → adapter 正则解析 → DecompositionCard 渲染 → Overlay 编辑 → 后端持久化
```

---

## 2. Data Flow

```
         ┌─────────────────────────────────────────────────────┐
         │             MessageListView (message-list-view.tsx) │
         │                                                     │
         │  getTimelineTurns() → timelineTurns                 │
         │       ├─ persisted: DB history (detail.turns)       │
         │       ├─ local: session.localTurns                  │
         │       └─ live: buildStreamingTurnsFromLiveMessage() │
         │                                                     │
         │  decompTurns = timelineTurns.map(t => t.turn)       │
         │       │                                             │
         │       ├─→ useDecompositionDetector(decompTurns)     │
         │       │    解析历史 turn 全文 → 检测 sub-tasks      │
         │       │                                             │
         │       └─→ turnAdapter.adapt(allTurns)               │
         │             → adaptMessageTurn()                     │
         │                 → expandDecompositionText() ← 当前渲染入口
         │                                                     │
         │  ↓ adaptedContent[]                                 │
         │    ↓ ContentPartsRenderer → DecompositionCard       │
         └─────────────────────────────────────────────────────┘
```

---

## 3. 当前渲染管线源码分析

### 3.1 流式数据源：`buildStreamingTurnsFromLiveMessage`

**文件**: `src/contexts/conversation-runtime-context.tsx:486-839`

- 输入: `LiveMessage`（ACP streaming 的实时内存状态）
- 输出: `{ turns: MessageTurn[], inProgressToolCallIds }`
- 处理逻辑: 将 `LiveContentBlock[]` 按 text/thinking/plan → tool_call → tool_result 分组，构建 `MessageTurn.blocks`
- 关键操作: `groups` 数组把 streaming content 按轮次切分为多个 `MessageTurn`

**现有 synthetic block 模式**（plan 参考）:

```typescript
// conversation-runtime-context.tsx:645-657
case "plan": {
  // Carries live plan as first-class block, not down-converted to thinking.
  currentBlocks.push({
    type: "plan",
    entries: latestKimiTodoEntries ?? block.entries,
  })
  break
}
```

### 3.2 Adapter 层：`adaptMessageTurn`

**文件**: `src/lib/adapters/ai-elements-adapter.ts:1621-1900`

**输入**: `MessageTurn`, `isStreaming`
**输出**: `AdaptedMessage`（含 `AdaptedContentPart[]`）

核心循环:

```typescript
for (let index = 0; index < turn.blocks.length; index++) {
  const block = turn.blocks[index]

  if (turn.role === "assistant" && block.type === "text") {
    // 合并连续 text block
    let mergedText = block.text
    let mergeEnd = index
    while (mergeEnd + 1 < turn.blocks.length &&
           turn.blocks[mergeEnd + 1].type === "text") {
      mergeEnd++
      mergedText += "\n" + turn.blocks[mergeEnd].text
    }

    // 优先级 1: Goal Update
    // 优先级 2: Inline Tool Result
    // 优先级 3: Decomposition ← 在此
    const decompExpanded = expandDecompositionText(mergedText)
    if (decompExpanded) {
      adaptedContent.push(...decompExpanded)
      index = mergeEnd
      continue
    }
  }
  // 未匹配 → 退回 adaptContentBlock（普通文本渲染）
  // block 中的 ```task_decomposition_json 作为普通文字展示
}
```

### 3.3 核心函数：`expandDecompositionText`

**文件**: `src/lib/adapters/ai-elements-adapter.ts:511-557`

```typescript
function expandDecompositionText(text: string): AdaptedContentPart[] | null {
  // Step 1: 完整 fence 匹配
  const segments = extractDecompositionSegments(text)
  if (segments) {
    // → 生成 { type: "decomposition", tasks, isStreaming: false }
    return parts
  }

  // Step 2: 不完整 fence（streaming）匹配
  const incompletePattern = /```task_decomposition_json(?:\s*\n|\s*$)/
  const incompleteMatch = incompletePattern.exec(text)
  if (incompleteMatch) {
    // → 生成 { type: "decomposition", tasks: [], isStreaming: true }
    //   "Generating task breakdown…"
    return parts
  }

  return null  // ← 退回普通文本
}
```

### 3.4 完整 Fence 解析函数：`extractDecompositionSegments`

**文件**: `src/lib/platform/decomposition-parser.ts:151-197`

```typescript
const pattern = /```task_decomposition_json\s*\n([\s\S]*?)\n\s*```/g
```

要求:
- opening: 精确 ````task_decomposition_json`
- 必须有 `\n` 后接 JSON 内容
- 必须有 `\n\s*\`\`\`` 闭合（换行 + 空格 + 三个反引号）

### 3.5 Streaming 检测正则

```typescript
const incompletePattern = /```task_decomposition_json(?:\s*\n|\s*$)/
```

匹配: ````task_decomposition_json\n` 或 ````task_decomposition_json` 在文本结尾

### 3.6 渲染组件

**DecompositionCard**: `src/components/message/decomposition-card.tsx:168-268`

```typescript
// 关键条件：不渲染的情况
if (!isStreaming && tasks.length === 0) return null
```

---

## 4. 渲染失败原因 — Root Cause 分析

### 4.1 根本原因：Sliding Window 合并被打断

**问题不在正则本身，而在合并范围**。

当前 `adaptMessageTurn` 做的是 **Sliding Window** 合并：

```
每次 streaming 更新时，turn.blocks 状态：

blocks = [
  text("我来分解这个任务：\n```task_decomposition_json\n{\"subTasks\":"),  ← block[0]
  tool_use("create_file"),                                               ← block[1]
  text("{\"title\":\"任务1\"}]}\n```")                                   ← block[2]
]

处理顺序：
  index=0: text block
    └─ mergedText = block[0]  // 只能连续合并 → 只有 block[0]，block[1] 是 tool_use 打断
    └─ expandDecompositionText(mergedText)
         └─ 无完整 fence → 匹配 streaming pattern → 渲染 "Generating…" ✅
    └─ index = 0 (mergeEnd = 0)

  index=1: tool_use → 工具卡片

  index=2: text block
    └─ mergedText = block[2]  // "{\"title\":\"任务1\"}]}\n```"
    └─ expandDecompositionText(mergedText)
         └─ 无 ```task_decomposition_json 开头 → return null
    └─ 退回 adaptContentBlock → 渲染为普通文本 "{\"title\":\"任务1\"}]}```"
    └─ ❌ 用户看到普通文本，不是 DecompositionCard
```

**关键问题**: block[2] 到达时，block[0] 已经被消费并生成了 streaming 占位。block[2] 作为独立 text block，不包含 ````task_decomposition_json` 开头，`expandDecompositionText` 直接返回 null。**closing 永远无法和 opening 在同一个 mergedText 中出现**。

### 4.2 其他失败场景

| 场景 | 原因 | 表现 |
|---|---|---|
| **非 text block 插入** | tool_use/thinking 打断连续 text 合并 | 用户看到原始文本碎片 |
| **正则不匹配** | AI 格式不符（缺换行、用 ~~~、用 ```json） | 整个 fence 显示为代码块 |
| **JSON 解析失败** | AI 输出的 JSON 不合法 | fence 转为普通文本显示 |
| **tasks 为空** | `tryParseSubTasksJson` 返回空数组 | `isStreaming=false, tasks=[]` → DecompositionCard 不渲染 |

### 4.3 为什么 Plan Block 没有这个问题

`plan` block 是 **原生 ACP 事件**（`PlanUpdate`），不经过 text block 和正则：

```
ACP PlanUpdate event → 前端 reducer → LiveContentBlock { type: "plan", entries }
  → turn builder 直接 { type: "plan" } → adapter case "plan" → PlanCard
```

整个链路没有 text block 合并、没有正则、没有 streaming 窗口问题。

---

## 5. 改版方案对比

| 方案 | 核心思路 | 涉及文件数 | 改动量 | 可靠性 | Rust 改动 |
|:--:|---|---|:--:|:--:|:--:|
| **A. Turn Builder 合成 block** | 在 `buildStreamingTurnsFromLiveMessage` 中扫描全 turn text → 合成 `decomposition` block | 5 | ~120 行 | ★★★★ | ❌ |
| **B. Turn 级全文扫描** | 在 `adaptMessageTurn` 外层 post-loop 拼接所有 text part → 一次匹配 | 1 | ~80 行 | ★★★ | ❌ |
| **C. ACP 端到端自定义类型** | ACP 协议层加 `DecompositionUpdate` 事件 + 全链路 | 12+ | ~400 行 | ★★★★★ | ✅ |

### 方案 A 与方案 B 的关键差异

| 差异点 | 方案 A（推荐） | 方案 B（备选） |
|---|---|---|
| 修改位置 | `conversation-runtime-context.tsx` turn builder | `ai-elements-adapter.ts` adapter 层 |
| 是否新增 ContentBlock | ✅ `{ type: "decomposition", tasks }` | ❌ 不新增 block type |
| 适配 plan 模式 | ✅ 完全一致 | ❌ adapter 层继续特殊处理 |
| 历史重播 | 需额外处理（或要求后端预解析） | ✅ adapter 自动处理 |
| 可扩展性 | ✅ 未来可加 ACP 事件源 | ❌ 仍然是 text-in-band |

---

## 6. 推荐方案：Turn Builder 合成 Decomposition Block（对应表 A）

### 6.1 核心思路

在 `buildStreamingTurnsFromLiveMessage` 的 Phase 2 末尾，**扫描当前 turn 的所有 text block**，拼接后运行 `parseDecompositionFromText`：

```
turn builder 每次 streaming 更新都重新执行
       │
       ▼
Phase 2: 构建 groups（当前已有代码）
       │
       ▼
groups 构建完成后，检查每个 group：
  1. 收集 group 中所有 type="text" 的 block，拼接全文
  2. 运行 parseDecompositionFromText(fullText)
  3. ✅ 有完整 fence → 解析 JSON，从 group 中移除相关 text 片段，插入
     { type: "decomposition", tasks: [...] }
  4. ❌ 无完整 fence → 不做任何操作
       │
       ▼
group 转为 MessageTurn → adapter 层直接 case "decomposition"
```

### 6.2 改动点列表

#### A1. `src/lib/types.ts` — 新增 ContentBlock 变体

```typescript
// 在 plan 变体后添加（≈line 179）
| { type: "decomposition"; tasks: ProposedSubTask[] }
```

需要 import `ProposedSubTask` 到 types.ts，或在 types.ts 中定义对应类型。

#### A2. `src/contexts/conversation-runtime-context.tsx` — Turn Builder 扫描 + 注入

**位置**: `buildStreamingTurnsFromLiveMessage` 函数尾端，groups 构建完成后（≈line 823）

```typescript
// ── Phase 3: Decomposition detection ──
for (const blocks of groups) {
  // 收集所有 text block 的全文
  const allText = blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")

  const subTasks = parseDecompositionFromText(allText)
  if (subTasks && subTasks.length > 0) {
    // 从 blocks 中移除被提取的 text fragment
    // 移除包含 ```task_decomposition_json 的 text block
    // 插入合成 block
    const filtered = blocks.filter((b) => {
      if (b.type !== "text") return true
      // 跳过包含 fence 标记的 text block（内容已解析）
      return !b.text.includes("```task_decomposition_json")
    })
    blocks.length = 0
    blocks.push(...filtered)
    blocks.push({ type: "decomposition" as const, tasks: subTasks })
  }
}
```

#### A3. `src/lib/adapters/ai-elements-adapter.ts` — expandDecompositionText 降级 + adapter route

**改动 1**: `adaptContentBlock` 新增 case（≈line 1071-1076）

```typescript
case "decomposition":
  return {
    type: "decomposition",
    tasks: block.tasks,
    isStreaming,
  }
```

**改动 2**: `expandDecompositionText` 降级为历史路径 fallback（保留，仅对 non-live turn 生效）

#### A4. `src/components/message/content-parts-renderer.tsx` — 已有代码无需改动

```typescript
// ≈line 2726-2734 — 已经处理 type === "decomposition"
if (part.type === "decomposition") {
  return <DecompositionCard tasks={part.tasks} isStreaming={part.isStreaming} />
}
```

---

## 7. 影响评估：双路径同步问题

### 两套渲染路径

| 路径 | 数据源 | 是否需要 decomposition block |
|---|---|---|
| **Live path** | `buildStreamingTurnsFromLiveMessage` | ✅ turn builder 合成 |
| **Historical path** | DB detail.turns（JSONL 回放） | ❌ block 不持久化，需要 adapter fallback |

### 历史路径处理

`plan` block 的处理方式（不作为参考）：

```
历史 plan → tool_use TodoWrite → adaptMessageTurn 中识别为 plan-like tool
  → 转换 { type: "plan", entries } → PlanCard
```

decomposition 的历史路径：

```
方案 A1：保留 expandDecompositionText 作为 adapter fallback
  只对 non-streaming turn 生效（isStreaming = false）
  → 历史回放时，所有 text block 已完整 → 正则匹配到完整 fence → DecompositionCard

方案 A2：后端持久化时预解析
  用户确认分解后 → 后端存储 platform_task_decomposition
  历史回放时从 DB 取 → 直接注入 decomposition block
  → 需要 Rust 侧改动，更彻底
```

**推荐**: 方案 A1（保留 adapter fallback），历史路径只在 turn 完结后跑一次，不存在 streaming 窗口问题。

### 合并对 timeline 的影响

`MessageListView` 中 `timelineTurns` = `persistedTurns + localTurns + liveTurns`：

```
persistedTurns → 走 adapter fallback（历史路径，expandDecompositionText）
localTurns     → 走 adapter fallback（同历史）
liveTurns      → 走 turn builder（合成 block）≠ adapter → 实时
```

**一致性保证**: `useDecompositionDetector` 扫描 `decompTurns` 的全文，不受 block 类型影响，始终能检测到 sub-tasks。

---

## 8. 与现有 DecompositionDetector 的兼容关系

### 两个独立检测路径

| 路径 | 作用 | 数据源 | 处理内容 |
|---|---|---|---|
| **`useDecompositionDetector`** | 检测 proposal 状态（是否已 dismiss/confirm） | `timelineTurns` 的 `turn.blocks` 全文 | 用 `parseDecompositionFromText` 提取 sub-tasks 用于 overlay 状态管理 |
| **`expandDecompositionText`**（当前）→ **turn builder**（改后） | UI 渲染 DecompositionCard | 当前 turn 的 text blocks | 生成 `AdaptedDecompositionPart` |

### 改版后

- `useDecompositionDetector` **不需任何改动** — 它仍从 `decompTurns` 全文解析，与 block type 无关
- 渲染路径从 adapter 正则改为 turn builder 合成 block
- 两者各自独立，互不影响

---

## 附录：全部涉及文件清单

| 文件 | 当前职责 | 改版后变化 |
|---|---|---|
| `src/lib/types.ts` | `ContentBlock` 类型定义 | +1 行：`{ type: "decomposition"; tasks }` |
| `src/contexts/conversation-runtime-context.tsx` | `buildStreamingTurnsFromLiveMessage` turn 分组 | +~50 行：Phase 3 扫描 + 合成 |
| `src/lib/adapters/ai-elements-adapter.ts` | adapter 层分解 + 渲染 | -~50 行：删 `expandDecompositionText` 主体 |
| `src/lib/platform/decomposition-parser.ts` | 正则解析 + 指令定义 | 提供纯函数供 turn builder 和 detector 共用 |
| `src/components/message/decomposition-card.tsx` | DecompositionCard 渲染 | 不需改动 |
| `src/components/message/content-parts-renderer.tsx` | part 类型分发 | 不需改动 |
| `src/hooks/use-decomposition-detector.ts` | proposal 状态管理 | 不需改动 |
