# 项目资源选择器重构 + KB Skills 移除

## Context

当前的"任务上下文注入"（TaskContextPopover）有多个设计问题：

1. **任务是强制前置条件**：必须先 link 一个任务才能看到 KB 文件/Skills。用户只想选几个 KB 文件时没有入口
2. **新建会话被完全挡住**：draft tab 没有 conversationId → popover 显示 "needConversation"，连任务搜索都看不到
3. **CLAUDE.md 作为手动勾选选项**：冗余（ACP agent cwd 设在项目根目录，Claude Code 自动读取 CLAUDE.md）
4. **项目信息出现在选择器中**：用户已经在项目工作区，不需要手动注入项目名称/根目录
5. **KB Skills（skill.yaml）是半成品**：没有创建 UI 入口、inject 文件不自动注入、ACP 模式下自然语言触发不可靠
6. **注入方式粗暴**：所有内容 prependMarkdown 到编辑器正文，跟用户 prompt 混在一起不可区分
7. **概念混淆**：全局专家 Skills（Settings 管理）和项目 KB Skills（skill.yaml）都叫 Skill，但机制完全不同

用户核心诉求：**方便快捷选择当前项目相关文件**——可以按任务开展会话，可以按需求文档头脑风暴，可以不关联任何任务。

### 关键技术发现

- **CLAUDE.md 自动读取**：ACP 连接时 agent 的 cwd 设为项目根目录，Claude Code 自动扫描并读取 cwd 下 CLAUDE.md，不需要手动注入
- **全局专家 Skills 已有完整链路**：Settings → SkillAgentMatrix link/unlink → symlink 到 ~/.claude/skills/ → Claude Code 自动扫描 → composer `/skill-name` 触发 → ComposerInjectContent 注入完整 SKILL.md
- **项目 KB Skills 是半成品**：skill.yaml 没有创建 UI、inject 文件不自动读取、自然语言提示触发不可靠
- **ACP 模式下 `/skill-name` 机制已存在**：通过 ComposerInjectContent 实现，不需要改底层

---

## Step 1: 移除 KB Skills（skill.yaml）

### 前端改动（9 个文件）

**`src/components/platform/knowledge-manager.tsx`**：
- 移除 Skills tab（`<TabsTrigger value="skills">` 和 `<TabsContent value="skills">`）
- 移除 `skills` state、`loadSkills` callback、`listSkills` import、`SkillInfo` import
- `handleScan` 和 `handleInit` 中移除 `await loadSkills()`
- Tab 列表只剩 Documents

**`src/components/platform/context-inject-panel-utils.ts`**：
- 移除 `InjectOptionGroup` 中的 `"skills"`
- 移除 `OptionId` 中的 `` `skill:${string}` ``
- `buildInjectOptions` 移除 skills 参数和 skills 选项构建循环
- `buildPayloadFromOptions` 移除 skills 组的 docs 构建分支
- `optionGroupLabel` 移除 `"skills"` case

**`src/components/platform/inject-option-list.tsx`**：
- `ALL_GROUPS` 中移除 `"skills"`
- `optionIcon` 移除 skills icon 分支（`Wand2`）

**`src/components/platform/task-context-popover.tsx`**：
- 移除 `skills` prop（`SkillInfo[]`）
- 移除 `SkillInfo` import
- `VISIBLE_GROUPS_A` 移除 `"skills"`
- `buildInjectOptions` 调用移除 skills 参数
- `emptyMessages` 移除 `skills: t("noSkills")`

**`src/components/chat/message-input.tsx`**：
- 移除 `popoverSkills` state 和 `SkillInfo` import
- KB 数据加载 effect 中移除 `listSkills` 调用和 skills 相关逻辑
- `<TaskContextPopover>` 移除 `skills={popoverSkills}` prop

**`src/components/platform/context-inject-panel.tsx`**（Dialog 版本，任务明细页创建会话时使用）：
- 移除 `skills` prop（`SkillInfo[]`）和 `SkillInfo` import
- `buildInjectOptions` 调用移除 skills 参数
- `emptyMessages` 移除 `skills: t("noSkills")`

**`src/components/platform/task-detail.tsx`**（任务明细页面）：
- 移除 `skillsList` state 和 `SkillInfo` import
- `loadKB` effect 移除 `listSkills` 调用和 `skills` 解构
- `Promise.all` 只剩 `[listKnowledgeDocs]`
- `<ContextInjectPanel>` 移除 `skills={skillsList}` prop

**`src/lib/platform/types.ts`**：
- 保留 `SkillInfo` 接口（全局专家 Skills 还需要），但注释说明它是全局专家用的，不是 KB skills

**`src/lib/platform/api.ts`**：
- 保留 `listSkills` API（全局专家还需要），但前端 KB 页面不再调用

### i18n（10 个语言文件）

移除 KB skills 相关 key：
- `Platform.inject.groupLabel.skills`
- `Platform.inject.noSkills`
- `Platform.kb.skills`
- `Platform.kb.noSkills`
- `Platform.kb.skillTrigger`
- `Platform.kb.skillInject`

### 后端不动

- `skill_discovery.rs` 保留（全局专家扫描逻辑不变）
- `list_skills` 命令保留（全局专家还需要），但前端 KB 页面不再调用
- `_knowledge/skills/` 目录可保留在磁盘上，不影响功能

---

## Step 2: 重构 TaskContextPopover → 项目资源选择器

### 核心设计变更

从"必须先选任务 → 再选文件"改为"直接选文件 + 任务可选关联"：

- **不关联任务时**：直接展示 KB 文件、附件（如果有已 link 任务）等资源
- **关联任务时**：任务描述+附件自动出现，KB 文件仍然可选
- **新建会话也能用**：基于 `activeProjectId` 而不是 `conversationId`

### 改名

`TaskContextPopover` → `ProjectResourcePicker`（或类似名称）

### 去掉的内容

- **CLAUDE.md 选项**：agent cwd 在项目根目录，自动读取，不需要手动选择
- **项目信息选项**：用户已在工作区，不需要手动注入 `Project: xxx / Client: xxx`
- **Skills 选项**：Step 1 已移除 KB Skills；全局专家 Skills 通过 Settings 管理

### 新的三种模式

**Mode A：已关联任务**
- 任务摘要卡片（📌 标题 + 类型/状态）
- KB 文件列表（当前项目的所有 KB docs，可搜索）
- 附件列表（当前任务的附件）
- 之前会话摘要（如果有 linked conversations）
- Unlink 按钮

**Mode B：未关联任务，有 conversationId**
- KB 文件列表（当前项目的所有 KB docs，可搜索）
- "关联任务"可选区域（搜索+link）
- 注入按钮

**Mode C：新建会话（无 conversationId）**
- KB 文件列表（基于 `activeProjectId` 加载）
- "关联任务"可选区域
- 注入按钮

### `buildInjectOptions` 重构

拆分为两个函数：
- `buildTaskOptions(task)` → 只返回任务描述+状态（仅在关联任务时使用）
- `buildProjectOptions(project, repos, kbDocs, attachments, conversations)` → 返回 KB 文件+附件+会话摘要

不再需要 `task` 作为必须参数。

### 去掉的组

- `"basic"` → 仅在关联任务时出现（taskDescription + taskStatus）
- `"project"` → 去掉
- `"repos"` → 去掉（CLAUDE.md 自动处理）
- `"skills"` → 去掉（Step 1）

保留的组：
- `"kb_docs"` → 始终显示
- `"attachments"` → 关联任务时显示
- `"conversations"` → 有 linked conversations 时显示

### 影响的文件

- `src/components/platform/task-context-popover.tsx` → 重写为 `ProjectResourcePicker`
- `src/components/platform/context-inject-panel-utils.ts` → 重构 buildInjectOptions
- `src/components/platform/context-inject-panel.tsx` → 同步重构（任务明细页 Dialog 版本）
- `src/components/chat/message-input.tsx` → 更新 Popover 调用
- `src/components/platform/task-detail.tsx` → 更新 Dialog 调用
- `src/components/platform/inject-option-list.tsx` → 更新组列表

---

## Step 3: 改进注入方式

### 当前问题

所有选中项的 `prefixLine` 拼成 `[Task Context] ... ---` 然后 prependMarkdown 到编辑器正文，跟用户 prompt 混在一起。

### 改进方向

将注入内容作为**独立的上下文块**，与用户编辑的 prompt 文本分离：

- 在编辑器里插入一个特殊的上下文区块（类似 skill invocation badge，但展示为折叠式上下文卡片）
- 发送时序列化为独立的 payload 部分，不污染用户 prompt 正文
- 具体实现需要结合 TipTap editor 的 node extension

此 Step 可以先简化为：
- 不再使用 `[Task Context] ... ---` 的 prepend 方式
- 而是在编辑器开头插入一个不可编辑的上下文提示行（类似 skill badge）
- 发送时仍然将 prefix 作为 prompt 的开头部分，但 UI 上与用户文本有视觉分离

---

## 实施顺序

```
Step 1: 移除 KB Skills（前端 9 个文件 + i18n 10 个语言）
Step 2: 重构 TaskContextPopover → ProjectResourcePicker
Step 3: 改进注入方式（上下文块与 prompt 分离）
```

## 验证

每个 Step 完成后：
1. `pnpm eslint` 相关文件 — ESLint 通过
2. `pnpm tauri dev` 运行验证交互：
   - 新建会话 → 打开资源选择器 → 能看到 KB 文件列表
   - 不关联任务 → 直接选 KB 文件 → 注入成功
   - 关联任务后 → 任务描述+附件出现
   - CLAUDE.md / 项目信息不再出现
   - Skills 组不再出现
   - 注入内容与 prompt 有视觉分离
