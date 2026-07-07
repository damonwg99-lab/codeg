# DecompositionCard 渲染逻辑详细分析

## 1. 渲染流水线总览

```
AI 响应（文本中包含 ```task_decomposition_json fence）
    │
    ▼
adaptMessageTurn()                       ← ai-elements-adapter.ts
    │  合并连续 text block
    │  → expandDecompositionText(mergedText)
    │
    ├── 成功 → AdaptedDecompositionPart[]
    │         → ContentPartsRenderer → <DecompositionCard>
    │
    └── 失败（返回 null）→ 退回 adaptContentBlock()
                           每个 text block 当作普通 <p> 渲染
                           → 用户看到原始 ```task_decomposition_json 文本
```

---

## 2. 核心函数：expandDecompositionText

**位置**: `src/lib/adapters/ai-elements-adapter.ts:511-557`

### 2.1 完整 fence 处理路径

```typescript
function expandDecompositionText(text: string): AdaptedContentPart[] | null {
  // Step 1: 解析完整 fence
  const segments = extractDecompositionSegments(text)
  if (segments) {
    // 成功 → 构造交替 text/decomposition part 数组
  }

  // Step 2: 无完整 fence → 检查不完整 fence（streaming）
  const incompletePattern = /```task_decomposition_json(?:\s*\n|\s*$)/
  const incompleteMatch = incompletePattern.exec(text)
  if (incompleteMatch) {
    // 返回 streaming placeholder
  }

  return null  // ← 完全无匹配，退回普通文本渲染
}
```

### 2.2 完整 Fence 解析

**调用链**: `extractDecompositionSegments()` → `tryParseSubTasksJson()`

**正则**: `/```task_decomposition_json\s*\n([\s\S]*?)\n\s*```/g`

**关键要求**:
| 条件 | 说明 |
|---|---|
| opening 必须是 `` ```task_decomposition_json `` | 反引号 + lang + 换行 |
| content 后必须紧跟 `\n` + 闭合 ` ``` `` | 换行 + 闭合 fence |
| JSON 必须合法 | `tryParseSubTasksJson` 内部 `JSON.parse` |
| JSON 必须有非空 `subTasks` 数组 | 接受 `{subTasks:[...]}` 或裸 `[...]` |
| 每个 entry 必须有非空 `title` | `normalizeEntry` 过滤空 title |

### 2.3 不完整 Fence（Streaming）检测

```typescript
const incompletePattern = /```task_decomposition_json(?:\s*\n|\s*$)/
```

**匹配场景**:
| Pattern | 示例文本结尾 | 匹配 |
|---|---|---|
| 后跟换行 | `` ```task_decomposition_json\n{"sub `` | ✅ |
| 文本结尾无换行 | `` ```task_decomposition_json`` | ✅ |
| 后跟空格非换行 | `` ```task_decomposition_json `` | ❌（`\s*` 匹配空格后必须 `\n` 或 `$`） |

**匹配后行为**:
- `match.index` 之前的内容作为 text part 保留
- `match.index` 及之后的部分被抑制 → 不渲染原始 JSON
- 插入 `{ type: "decomposition", tasks: [], isStreaming: true }` 占位

---

## 3. text block 合并逻辑

**位置**: `src/lib/adapters/ai-elements-adapter.ts:1638-1650`

```typescript
if (turn.role === "assistant" && block.type === "text") {
  let mergedText = block.text
  let mergeEnd = index
  while (
    mergeEnd + 1 < turn.blocks.length &&
    turn.blocks[mergeEnd + 1].type === "text"
  ) {
    mergeEnd++
    mergedText += "\n" + turn.blocks[mergeEnd].text
  }
```

**作用**: ACP streaming 可能将一段文本切割成多个连续的 text block。合并后确保 `` ```task_decomposition_json `` 的 opening 和 closing 即使在不同 chunk 中也能被正则匹配到。

**局限**: 只合并 **连续** 的 text block。如果有其他类型 block（如 `tool_use`、`thinking`）插入在中间，则合并被打断，fence 被截断。

---

## 4. 优先级排序

**位置**: `src/lib/adapters/ai-elements-adapter.ts:1652-1683`

```
1. Goal Update 展开（expandGoalUpdateText）
2. Inline Tool Result 展开（expandInlineToolText）
3. Decomposition 展开（expandDecompositionText） ← 本功能
4. 退回 adaptContentBlock（普通文本渲染）
```

**问题**: 如果 AI 的文本同时匹配 Goal Update 或 Inline Tool Result，decomposition 永远不会被检查。

---

## 5. 渲染组件链

### 5.1 ContentPartsRenderer

**位置**: `src/components/message/content-parts-renderer.tsx:2726-2734`

```typescript
if (part.type === "decomposition") {
  return (
    <DecompositionCard
      key={`decomp-${keyId}`}
      tasks={part.tasks}
      isStreaming={part.isStreaming}
    />
  )
}
```

### 5.2 DecompositionCard

**位置**: `src/components/message/decomposition-card.tsx:168-268`

**关键渲染路径**:

```typescript
export const DecompositionCard = memo(function DecompositionCard({
  tasks, isStreaming = false
}) {
  // ─── 前置条件 ───
  if (!isStreaming && tasks.length === 0) return null  // ← 不渲染

  // ─── 确定是否为最新 proposal ───
  const cardKey = proposalKey(tasks)
  const isLatest = cardKey !== null && cardKey === overlayCtx?.currentProposalKey
  const effectiveStatus = isLatest ? (overlayCtx?.overlayStatus ?? "none") : "none"

  // ─── 渲染 ───
  return (
    <div className="...">
      <div className="...">
        <ListChecks />
        <span>{t("decompositionCardTitle")}</span>
        {isStreaming ? <Loader2 spin /> : <Badge>{tasks.length}</Badge>}
      </div>
      {isStreaming ? (
        <div className="animate-pulse">{t("decompositionStreaming")}</div>
      ) : (
        <ScrollArea>
          {tasks.map(...)}
        </ScrollArea>
      )}
    </div>
  )
})
```

**不渲染的条件**: `!isStreaming && tasks.length === 0` → return null

---

## 6. 渲染失败的场景分析

以下场景会导致 `expandDecompositionText` 返回 `null`，DecompositionCard 不出现，用户看到原始 `` ```task_decomposition_json `` 文本：

### 场景 A：正则不匹配完整 fence

| 原因 | 示例（不可见 · 表示空格） |
|---|---|
| AI 使用 ````json` 而不是 ````task_decomposition_json` | ````json\n{"subTasks":[...]}\n```` |
| closing fence 前没有换行 | `` ```task_decomposition_json\n{"subTasks":[...]}```` |
| closing fence 前有 trailing space | `` ```task_decomposition_json\n{"subTasks":[...]}\n·```` |
| AI 使用 ~~~ 代替 ``` | `~~~task_decomposition_json\n...\n~~~` |
| AI 在 fence 后添加了多余内容未闭合 | `` 开头命中 streaming, 但生成完整后没闭合 `` |
| JSON 内包含反引号序列 | `` ```task_decomposition_json\n...`````` 被误认为 closing |

**例外**: 只要 opening ````task_decomposition_json` 存在且后跟换行或 EOL，**至少**会匹配 streaming pattern，渲染 "Generating…" 占位（不会显示原始文本）。

### 场景 B：JSON 解析失败

| 原因 | 影响 |
|---|---|
| `JSON.parse` 抛出异常 | `tryParseSubTasksJson` catch → return null |
| JSON 结构不是 `{ subTasks: [...] }` 或 `[...]` | `tryParseSubTasksJson` return null |
| `subTasks` 数组为空 | return null |
| 所有 entry 都没有 title | `normalizeEntry` 全部过滤 → return null |

**细节**: `extractDecompositionSegments` 中，如果 `tryParseSubTasksJson` 失败，该 segment 被当作 **text** 处理（保留原始 fence 文本），而不是直接丢弃。

### 场景 C：合并被打断 — 最可能的原因

```
// ACP streaming 到达：
block[0] = text("我来分解这个任务：\n```task_decomposition_json\n{\"subTasks\"")
block[1] = tool_use(...)   // ← 打断了连续 text 合并
block[2] = text("]}\n```")
```

合并循环只会合并 **连续** text block。block[1] 的 `tool_use` 中途插入会导致：
- 第一次迭代（index=0）: `mergedText = "我来分解这个任务：\n\`\`\`task_decomposition_json\n{\"subTasks\""` → 匹配 **streaming** pattern ✅ → 渲染 "Generating…"
- 后续迭代在 `tool_use` 之后，block[2] 的 `"]}\n\`\`\`"` 作为独立 text block 处理 → 退化为普通文本渲染 → 用户看到 `` ]}\n``` `` 或类似残余文字

**更坏的情况**（如果 AI 的文本格式更复杂）：
```
block[0] = text("我来分解这个任务：\n```task_decomposition_json\n{\"subTasks\":[")
block[1] = thinking("让我想想...")   // 不连续 text
block[2] = text("{\"title\":\"任务1\"}]}\n```")
```
→ 两个部分分别匹配 streaming pattern → 但 stream 最终完成后，第二部分 text 无法被识别为 fence（缺少 opening）→ 只能渲染为普通文本

### 场景 D：优先级抢占

如果 `mergeText` 同时匹配 Goal Update 或 Inline Tool Result 的正则，decomposition 检测**永远不会执行**。这种情况相对少见，但可能在某些 AI 的特殊输出格式下发生。

### 场景 E：DecompositionCard 自身跳出不渲染

即使 `expandDecompositionText` 返回了 `{ type: "decomposition", tasks: [] }`，以下条件也可能导致 UI 为空：

```typescript
if (!isStreaming && tasks.length === 0) return null  // ← line 207
```

这意味着：如果 `tryParseSubTasksJson` 解析出空数组（比如 `subTasks` 为空列表），`expandDecompositionText` 生成 `{type:"decomposition", tasks:[], isStreaming:false}`，但 `DecompositionCard` 会在 line 207 跳过渲染。

---

## 7. 关键正则对比

| 用途 | 正则 | 文件 |
|---|---|---|
| 完整 fence 分割 | `` /```task_decomposition_json\s*\n([\s\S]*?)\n\s*```/g `` | decomposition-parser.ts:156 |
| streaming 检测 | `` /```task_decomposition_json(?:\s*\n|\s*$)/ `` | ai-elements-adapter.ts:539 |
| 显式 fence 提取 | 动态构建 `` ```{lang}\s*\n([\s\S]*?)\n\s*``` `` | decomposition-parser.ts:204-206 |

**关键差异**:
- `extractDecompositionSegments` 的完整正则要求 closing 端必须有 `\n\s*\`\`\``（换行+空格+闭合）—— 缺少换行或 trailing 空格都会导致不匹配
- streaming 正则只检查 opening + 换行/EOL，不检查 closing

---

## 8. 调试建议

如果 DecompositionCard 不出现，按以下顺序排查：

1. **检查合并结果**: 在 `expandDecompositionText` 入口打印 `mergedText`
2. **检查正则匹配**:
   - `extractDecompositionSegments` 是否返回非 null
   - 如果否，streaming pattern 是否匹配
   - 如果都否 → 退回普通文本（场景 A）
3. **检查 JSON 解析**:
   - `tryParseSubTasksJson` 是否返回非空数组
   - 如果否 → 场景 B
4. **检查 block 序列**:
   - 在 `adaptMessageTurn` 中遍历 `turn.blocks`，打印每个 block 的 type 和 text 前 50 字符
   - 如果有非 text block 插入在中间 → 场景 C
5. **检查优先级抢占**: 将 decomposition 检测移到 Goal Update 和 Inline Tool Result 之前，看是否解决问题
6. **检查 final `tasks.length`**: DecompositionCard line 207 的 `!isStreaming && tasks.length === 0` 是否跳过
