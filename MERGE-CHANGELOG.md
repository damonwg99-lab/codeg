# Merge Changelog: `main` → `release/ai-platform-merge`

## P3-Version: 版本升级至 1.0.2

| 文件 | 操作 |
|---|---|
| `package.json` | `"version": "1.0.2"` |
| `src-tauri/Cargo.toml` | `version = "1.0.2"` |
| `src-tauri/tauri.conf.json` | `"version": "1.0.2"` |
| `src-tauri/Cargo.lock` | regenerated |

---

## P1-Provider: Provider 层合并

### `src/contexts/app-workspace-context.tsx`
- **策略**: 取 main 版本
- main 已将 `AppWorkspaceProvider` 重写为调用 `useAppWorkspaceStore` 的薄层；HEAD 侧的 `getBranch`/`setBranch`/`upsertFolder` 死代码不再需要

### `src/contexts/conversation-runtime-context.tsx`
- **策略**: 取 main 版本
- main 已将文件重写为 `conversation-runtime-store` 的 re-export 薄层（`buildStreamingTurnsFromLiveMessage` 等直接 re-export）

### `src/app/workspace/layout.tsx`
- **保留** HEAD 侧的 `<PlatformProvider>` 包裹
- **移除** HEAD 侧的 `</ActiveFolderProvider>` 闭合标签（main 已移除该 provider）
- 导入 `PlatformProvider from @/contexts/platform-context` 已保留

---

## P0-Core: Store 层合并（关键改动）

### `src/stores/conversation-runtime-store.ts`

在 `buildStreamingTurnsFromLiveMessage` 中植入分解检测逻辑，移植自 HEAD 的 `conversation-runtime-context.tsx`：

1. **导入新增**:
   - `ContentBlock` from `@/lib/types`
   - `extractDecompositionSegments`, `parseDecompositionToolInput` from `@/lib/platform/decomposition-parser`

2. **Phase 2 — tool_call 分支**（after kimiTodoWriteEntries, before generic tool_use）:
   ```typescript
   // create_task_decomposition MCP tool call → synthetic decomposition block
   const decompTasks = parseDecompositionToolInput(block.info.raw_input)
   if (decompTasks) {
     currentBlocks.push({
       type: "decomposition",
       tasks: decompTasks,
       isStreaming: false,
     })
     break
   }
   ```

3. **Phase 3 — 文本 fence 检测**（after Phase 2 循环, before timestamp）:
   - A) 完整 fence `\`\`\`task_decomposition_json` → `extractDecompositionSegments` 解析 → 合成 `decomposition` block + 纯文本 segments
   - B) 不完整 fence（streaming）→ 占位 `decomposition` block（`isStreaming: true`）
   - 组重建逻辑：替换 group 中所有 text blocks 为合成 blocks，保持非 text blocks 位置不变

### `src/stores/tab-store.ts`

移植 HEAD 的 `pendingTaskLink`/`pendingInitialDrafts` 状态到 zustand store：

1. **新增类型导出**:
   ```typescript
   export interface PendingTaskLink {
     taskId: number
     role: string
     title: string
     taskType: string
   }
   ```

2. **StoreState 新增字段**:
   - `pendingInitialDrafts: Map<string, string>`
   - `pendingTaskLink: Map<string, PendingTaskLink | null>`

3. **StoreState 新增动作**:
   - `setPendingInitialDraft(tabId, content)`
   - `clearPendingInitialDraft(tabId)`
   - `setPendingTaskLink(tabId, taskId, role, title, taskType)`
   - `clearPendingTaskLink(tabId)`

4. **初始状态 + 实现**: 使用 `new Map()` 初始化，set 通过 `set((s) => { ... })` 实现不可变更新

5. **`useTabActions` 扩展**: 新增 4 个 action 的浅引用导出

6. **`platform_repo` 过滤**: 在 `makeReplacementDraftTab` 中将 `platform_repo` 与 `chat` 同等对待（fallback 和 preferredIsChat 判断）

### `src/stores/app-workspace-store.ts`

- **`upsertFolder` 方法**: `upsertFolder` 中黑名单新增 `platform_repo` 类型，与 `chat` 一样仅进入 `allFolders` 而不进入 `folders`（不显示在侧边栏）：
  ```typescript
  // Before:
  ...(detail.kind !== "chat" ? { folders: upsert(folders) } : {}),
  // After:
  ...(detail.kind !== "chat" && detail.kind !== "platform_repo" ? { folders: upsert(folders) } : {}),
  ```

---

## P0-Core: 兼容层扩展

### `src/contexts/tab-context.tsx`

以 main 版本为基础，扩展 `TabContextValue` 接口和 `useTabContext` 钩子：

1. **导入新增**: `type PendingTaskLink from @/stores/tab-store`
2. **`TabContextValue` 接口扩展**:
   - `pendingInitialDrafts: Map<string, string>`
   - `setPendingInitialDraft(tabId, content)`
   - `clearPendingInitialDraft(tabId)`
   - `pendingTaskLink: Map<string, PendingTaskLink | null>`
   - `setPendingTaskLink(tabId, taskId, role, title, taskType)`
   - `clearPendingTaskLink(tabId)`
3. **`useTabContext` 钩子扩展**: 对应的 6 个属性从 store 读取

---

## P2-Components: 8 个消费者组件合并

| 组件文件 | 策略 |
|---|---|
| `conversation-context-bar.tsx` | 保留 HEAD 的 `usePlatform` + `useProjectSwitchCoordinator`，接受 main 的 `useAppWorkspaceStore` + `useTabActions` + `useTabStore` |
| `conversation-detail-panel.tsx` | `useTabContext()` → `useTabActions()` for `pendingTaskLink`/`clearPendingTaskLink` |
| `sidebar-conversation-list.tsx` | `useTabContext()` → `useTabActions()`，保留 `setRoute` from `useWorkbenchRoute()` (HEAD) |
| `clone-dialog.tsx` | `useAppWorkspaceStore` for `openFolder` (main)，保留 `autoCreateProject` (HEAD) |
| `folder-title-bar.tsx` | 两个冲突：store 模式 (`useAppWorkspaceStore` for `openFolder`/`allFolders`, `useTabActions` for `openNewConversationTab`, `useTabStore` for `tabs`/`activeTabId`) + 保留 `usePlatform` (HEAD) |
| `new-folder-dropdown.tsx` | 两个冲突：`useAppWorkspaceStore` (main) + 保留 `useAutoCreateProject` (HEAD) |
| `sidebar.tsx` | `useTabContext()` → `useTabActions()`，保留 `usePlatform` + `useAppWorkspace` 平台功能 |
| `message-list-view.tsx` | `useConversationRuntimeStore` (main's store pattern) for `session`，保留 `tDecomp` translation (HEAD) |

---

## 测试修复

### `src/components/conversations/sidebar-conversation-list.test.tsx`

- **问题**: HEAD 侧新增的 `sidebar-conversation-list.tsx` 中使用 `useAutoCreateProject()` 钩子，该钩子内部调用 `usePlatformContext()`，但测试未提供 `PlatformProvider`
- **修复**: 新增 mock：
  ```typescript
  vi.mock("@/hooks/use-auto-create-project", () => ({
    useAutoCreateProject: () => ({ autoCreateProject: () => {} }),
  }))
  ```

---

## 验证结果

| 检查项 | 结果 |
|---|---|
| ESLint | 0 errors on modified files |
| Test suite | 2187 passed, 0 failed (16 个之前失败的测试已修复) |
| Unmerged files | 0 个未合并路径 |
