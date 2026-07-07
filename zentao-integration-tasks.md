# 禅道集成任务分解

## 现状摘要

| 模块 | 状态 |
|------|------|
| DB Entity（禅道字段：zentao_id, zentao_type, zentao_sync_status 等） | ✅ 已实现 |
| DB Service（CRUD + list_by_zentao_sync_status） | ✅ 已实现 |
| Rust Commands 含禅道字段（project/task CRUD 透传） | ✅ 已实现 |
| Web Handlers 含禅道字段 | ✅ 已实现 |
| 前端 types / api（禅道字段定义） | ✅ 已实现 |
| 前端 i18n（`zentaoConfig` 一个 key） | ✅ 已实现 |
| Rust 禅道 API 客户端 (`integration/zentao.rs`) | ❌ 未实现 |
| 禅道双向同步核心逻辑（pull/push/映射/冲突检测） | ❌ 未实现 |
| 禅道 Rust 命令层（sync_pull / sync_push / test_connection） | ❌ 未实现 |
| 禅道 Web handlers（同步端点） | ❌ 未实现 |
| 项目详情-禅道配置标签页（目前 disabled placeholder） | ❌ 未实现 |
| 全局禅道设置页面（API 地址 / Token 配置） | ❌ 未实现 |
| 同步操作 UI（按钮 / 进度 / 状态） | ❌ 未实现 |
| 冲突解决面板 | ❌ 未实现 |
| 前端 hooks (use-zentao-sync / use-zentao-config) | ❌ 未实现 |
| 禅道集成测试 | ❌ 未实现 |

---

## 任务列表

### Phase 0 — 基础设施与密钥管理（1 任务）

#### T0-1: Zentao Token 密钥管理集成
- **优先级**: P0 · **预估**: 0.5天
- **类型**: feature
- **描述**: 利用 CodeG 现有的 `keyring_store` 基础设施存储禅道 API Token。桌面模式用 OS 密钥环，服务器模式用文件加密存储。`platform_credential` 表只记录关联关系（credential_type + keyring 中的 account_id），不存储明文。
- **涉及文件**:
  - `src-tauri/src/platform/integration/mod.rs`（新建 — 模块入口）
  - `src-tauri/src/platform/integration/credential.rs`（新建 — 封装 get/set/delete）
  - `platform_credential_service.rs`（已有，直接使用）
- **验收标准**:
  - 能 `set_token("zentao", token)` / `get_token("zentao")` / `delete_token("zentao")` API
  - Token 不出现明文存储，不落 SQLite
  - `cargo check` 通过

---

### Phase 1 — 后端核心（3 任务）

#### T1-1: 禅道企业版 REST API 客户端
- **优先级**: P0 · **预估**: 2天
- **类型**: feature
- **描述**: 实现 `src-tauri/src/platform/integration/zentao.rs`，封装禅道企业版 REST API 调用。
- **具体内容**:
  - 基础 HTTP 客户端（reqwest + Token 认证，base URL 来自全局/项目配置）
  - API 端点封装：
    - `GET /api.php/v1/projects` — 获取项目列表
    - `GET /api.php/v1/products` — 获取产品列表
    - `GET /api.php/v1/executions` — 获取执行列表
    - `GET /api.php/v1/stories` — 获取 Story 列表（支持分页/筛选）
    - `POST /api.php/v1/stories` — 创建 Story
    - `PUT /api.php/v1/stories/{id}` — 更新 Story
    - `GET /api.php/v1/tasks` — 获取 Task 列表
    - `POST /api.php/v1/tasks` — 创建 Task
    - `PUT /api.php/v1/tasks/{id}` — 更新 Task
    - `GET /api.php/v1/bugs` — 获取 Bug 列表
    - `POST /api.php/v1/bugs` — 创建 Bug
    - `PUT /api.php/v1/bugs/{id}` — 更新 Bug
  - 请求/响应类型定义（`ZentaoProject`, `ZentaoStory`, `ZentaoBug`, `ZentaoTask` 等）
  - 错误处理：网络错误、API 错误码、认证失败统一为 `ZentaoError`
  - 分页支持：禅道 API 使用 page/pageSize 分页
- **涉及文件**:
  - `src-tauri/src/platform/integration/zentao.rs`（新建）
  - `src-tauri/src/platform/integration/mod.rs`（新建/修改）
- **验收标准**:
  - 单元测试覆盖主要 API 调用（使用 mock HTTP 或 test fixture）
  - 能从禅道测试实例成功获取项目/产品列表
  - `cargo test` 通过

#### T1-2: 禅道双向同步核心逻辑
- **优先级**: P0 · **预估**: 3天
- **类型**: feature
- **描述**: 在 `integration/zentao.rs` 中实现同步引擎，包含 pull、push、状态映射、字段映射、冲突检测。
- **具体内容**:
  - **pull_from_zentao()**:
    - 从禅道拉取 Story/Task/Bug（按项目/产品过滤）
    - 与本地 task 记录匹配（zentao_id 匹配）
    - 新增：禅道有但本地没有的，创建本地 task + 写入 zentao_id + zentao_sync_status = synced
    - 更新：禅道有且本地有的，检测 updated_at 差异 → 无冲突则更新本地，有冲突则标记冲突
    - 删除（可选）：本地有但禅道没有的，标记为 zentao_sync_status = pending_push（考虑同步方向策略）
  - **push_to_zentao()**:
    - 本地待推送的 task（zentao_sync_status = pending_push 或 push_failed）
    - 禅道无对应记录的（zentao_id 为空）→ 调用 create API
    - 禅道有对应记录的 → 调用 update API
    - 成功后设为 zentao_sync_status = synced
  - **状态双向映射**:
    - `backlog` ↔ `story/wait`（或 `task/wait`）
    - `confirmed` ↔ `story/activated`（或 `task/confirmed`）
    - `in_progress` ↔ `task/doing` | `bug/active`
    - `done` ↔ `task/done` | `bug/fixed`
    - `released` ↔ `story/closed`
  - **字段映射规则**:
    - 核心字段（双向）：标题、描述、类型、状态、优先级、指派
    - 禅道扩展字段（禅道→本地单向）：截止日期、预估工时、已消耗工时、所属模块
    - 本地 AI 字段（仅本地不推送到禅道）：kb_refs_json、affected_repos_json、delegation_config
  - **冲突检测机制**:
    - 对比本地和禅道的 updated_at
    - 如果两边都有修改，冲突标记到每个字段级别
    - 冲突数据暂存，不自动覆盖
    - 提供 `resolve_conflicts(task_id, resolutions)` 方法进行冲突解决
  - **支持按项目同步**（同步某个项目所有关联禅道记录）和**按单个任务同步**
- **涉及文件**:
  - `src-tauri/src/platform/integration/zentao.rs`（修改/扩充）
- **验收标准**:
  - 能用禅道测试实例跑通完整双向同步流程
  - 新建项目→拉取禅道任务→修改标题→推送回禅道→确认禅道已更新
  - 冲突场景能正确检测并返回冲突详情
  - 同步结果包含计数（新增/更新/冲突/失败）

#### T1-3: 禅道同步 Rust 命令层 + Web Handlers
- **优先级**: P0 · **预估**: 1天
- **类型**: feature
- **描述**: 新增 Tauri 命令和 Axum Web handlers 暴露禅道同步功能。
- **具体内容**:
  - 新增命令（`src-tauri/src/commands/zentao.rs`）：
    - `zentao_sync_pull(project_id, task_id?)` → 返回 SyncResult
    - `zentao_sync_push(project_id, task_id?)` → 返回 SyncResult
    - `zentao_test_connection()` → 返回 boolean + 错误信息
    - `zentao_list_projects()` → 返回禅道项目列表
    - `zentao_list_products(project_id?)` → 返回禅道产品列表
    - `zentao_get_task_type_mappings(project_id)` → 返回类型映射列表
    - `zentao_resolve_conflicts(task_id, resolutions_json)` → 应用冲突解决方案
  - 新增 Web handlers（`src-tauri/src/web/handlers/zentao.rs`）：
    - `POST /api/platform/zentao/sync-pull`
    - `POST /api/platform/zentao/sync-push`
    - `POST /api/platform/zentao/test-connection`
    - `GET /api/platform/zentao/projects`
    - `GET /api/platform/zentao/products`
    - `GET /api/platform/zentao/type-mappings?project_id=X`
    - `POST /api/platform/zentao/resolve-conflicts`
  - 注册到集成点：
    - `commands/mod.rs`（末尾追加 `pub mod zentao;`）
    - `web/handlers/mod.rs`（末尾追加 `pub mod zentao;`）
    - `web/router.rs`（末尾追加路由块）
    - `lib.rs`（末尾追加命令注册到 invoke_handler）
  - 请求/响应 DTO 类型定义：`SyncRequest`, `SyncResult`, `SyncConflictItem`, `ConnectionTestResult`
- **涉及文件**:
  - `src-tauri/src/commands/zentao.rs`（新建）
  - `src-tauri/src/web/handlers/zentao.rs`（新建）
  - `src-tauri/src/commands/mod.rs`（修改）
  - `src-tauri/src/web/handlers/mod.rs`（修改）
  - `src-tauri/src/web/router.rs`（修改）
  - `src-tauri/src/lib.rs`（修改）
  - `src-tauri/src/models/platform_zentao.rs`（新建，存放 SyncResult 等 DTO）
- **验收标准**:
  - `cargo check` 编译通过
  - 通过 curl/postman 调用 Web 端点能正常响应
  - 命令在桌面模式下通过 invoke 正常调用

---

### Phase 2 — 前端（5 任务）

#### T2-1: 全局禅道设置页面
- **优先级**: P2 · **预估**: 1天
- **类型**: feature
- **描述**: 在 CodeG Settings 页面新增"禅道集成"配置区。
- **具体内容**:
  - 全局禅道配置组件（`zentao-global-settings.tsx`）
  - API 地址输入框（URL 格式校验）
  - Token 输入框（type=password，不显示明文）
  - "测试连接"按钮 → 调用 `testConnection` API，显示成功/失败
  - "保存"按钮 → 保存到 `platform_global_config` + `platform_credential`
  - 从 Settings 页导航进入（类似现有的其他设置项）
- **涉及文件**:
  - `src/components/platform/zentao-global-settings.tsx`（新建）
  - `src/app/settings/page.tsx` 或 settings 相关路由（修改，添加入口）
  - `src/i18n/messages/en.json` + `zh-CN.json`（修改，添加 keys）
- **验收标准**:
  - 能填入 API 地址和 Token，点击测试连接正常返回
  - Token 不显示明文
  - 保存后刷新页面，配置仍然保留

#### T2-2: 项目禅道配置标签页（启用 + 完善）
- **优先级**: P1 · **预估**: 2天
- **类型**: feature
- **描述**: 启用当前 disabled 的"禅道配置"tab，实现完整的项目级禅道配置界面。
- **具体内容**:
  - **禅道项目/产品映射**：
    - 禅道项目 ID 输入（整数，下拉选择框从禅道拉取项目列表）
    - 禅道产品 ID 输入（整数，下拉选择框从禅道拉取产品列表）
    - 项目级 API URL 覆盖（可选，不覆盖时使用全局配置）
  - **任务类型映射配置**：
    - 显示现有映射列表（从 platform_task_type_mapping 获取）
    - 支持增删改：选择本地类型 + 禅道类型 + 可选禅道模块
    - 默认映射预填充：requirement→story, prd→story, coding→task, bug→bug 等
  - **同步操作区域**：
    - "从禅道同步"按钮（调用 syncPull）
    - "推送到禅道"按钮（调用 syncPush）
    - 上次同步时间显示
- **涉及文件**:
  - `src/components/platform/project-detail.tsx`（修改，替换 zentao tab 内容）
  - `src/components/platform/zentao-project-config.tsx`（新建，配置表单组件）
  - `src/components/platform/zentao-type-mapping-editor.tsx`（新建，类型映射编辑器）
  - i18n 补充
- **验收标准**:
  - "禅道配置"tab 不再 disabled，显示完整配置界面
  - 能保存和读取禅道项目/产品 ID 映射
  - 任务类型映射增删改正常

#### T2-3: 禅道同步操作 UI + 同步状态展示
- **优先级**: P1 · **预估**: 2天
- **类型**: feature
- **描述**: 同步触发按钮、进度反馈、状态标签在项目/任务视图中的集成。
- **具体内容**:
  - **同步操作按钮**：
    - 项目详情页的"从禅道同步" / "推送到禅道" 按钮
    - 任务详情页的"同步此任务"按钮
    - 任务列表/看板的批量同步操作
  - **同步进度反馈**：
    - 同步进行中：loading spinner + "正在同步第 X/Y 条..."
    - 同步完成：toast 通知 + 结果摘要（新增 N / 更新 N / 冲突 N / 失败 N）
    - 同步失败：错误提示 + 重试按钮
  - **同步状态标签**：
    - 任务卡片/行中显示同步状态徽标
    - `none` = 灰色 "未同步"
    - `synced` = 绿色 "已同步"
    - `pending_push` = 蓝色 "待推送"
    - `push_failed` = 红色 "推送失败"
    - 鼠标悬停显示详情（最后同步时间、失败原因）
- **涉及文件**:
  - `src/components/platform/task-detail.tsx`（修改）
  - `src/components/platform/task-list-table.tsx` 或 `task-kanban.tsx`（修改）
  - `src/components/platform/sync-status-badge.tsx`（新建）
  - `src/components/platform/sync-progress-dialog.tsx`（新建）
  - i18n 补充
- **验收标准**:
  - 点击同步按钮能触发后端同步
  - 同步过程中 UI 正确反映进度
  - 任务列表中的同步状态标签正确显示，颜色区分清晰

#### T2-4: 禅道同步冲突解决面板
- **优先级**: P2 · **预估**: 2天
- **类型**: feature
- **描述**: 同步检测到冲突时弹出模态面板，逐字段选择保留策略。
- **具体内容**:
  - **冲突面板组件**（modal/dialog）：
    - 标题显示 "检测到 N 个冲突"
    - 按字段逐行展示：字段名、本地值、禅道值
    - 每行提供三个选项：
      - "保留本地"（radio，默认选中）
      - "保留禅道"
      - "手动合并"（选中后出现文本输入框）
    - 支持"全部本地" / "全部禅道" 快捷按钮
  - 确认后调用 resolveConflict API，传入每个字段的选择
  - **简化方案**：初次 MVP 可以用"永远保留最新修改"策略，不弹出冲突面板
- **涉及文件**:
  - `src/components/platform/zentao-conflict-resolver.tsx`（新建）
  - 后端 `zentao_resolve_conflicts` 命令（T1-3 已实现）
  - i18n 补充
- **验收标准**:
  - 能模拟冲突场景并正确展示
  - 选择"保留本地"后本地值不变，选择"保留禅道"后本地值更新
  - "手动合并"文本输入正常工作

#### T2-5: 前端 hooks + API 扩展
- **优先级**: P1 · **预估**: 1天
- **类型**: improvement
- **描述**: 扩展前端 API 层和新建 hooks，供 UI 组件调用禅道功能。
- **具体内容**:
  - **API 扩展**（`src/lib/platform/api.ts`）：
    - `syncPull(projectId, taskId?)` — 调用 zentao_sync_pull
    - `syncPush(projectId, taskId?)` — 调用 zentao_sync_push
    - `testConnection()` — 调用 zentao_test_connection
    - `listZentaoProjects()` — 调用 zentao_list_projects
    - `listZentaoProducts()` — 调用 zentao_list_products
    - `getTaskTypeMappings(projectId)` — 获取任务类型映射
    - `resolveConflicts(taskId, resolutions)` — 应用冲突解决
    - `saveGlobalConfig(config)` + `saveCredential(type, token)` — 保存全局配置
    - `saveTypeMapping(config)` — 保存/更新类型映射
  - **前端 hooks**（`src/hooks/platform/`）：
    - `use-zentao-sync.ts`：封装同步操作状态（loading/error/result/conflicts）
      - `useZentaoPull(projectId)` → { pull, pulling, pullError, pullResult }
      - `useZentaoPush(projectId)` → { push, pushing, pushError, pushResult }
      - `useZentaoConflicts(taskId)` → { conflicts, resolve, ... }
    - `use-zentao-config.ts`：封装禅道配置读写
      - `useZentaoGlobalConfig()` → { config, save, testConnection, testing, testResult }
      - `useZentaoProjectConfig(projectId)` → { config, updateProjectId, updateProductId, mappings, ... }
  - **类型定义扩展**（`src/lib/platform/types.ts`）：
    - `SyncResult`，`SyncConflictItem`，`ConflictResolution`
    - `ZentaoProjectInfo`，`ZentaoProductInfo`
    - `ZentaoGlobalConfig`, `ConnectionTestResult`
- **涉及文件**:
  - `src/hooks/platform/use-zentao-sync.ts`（新建）
  - `src/hooks/platform/use-zentao-config.ts`（新建）
  - `src/lib/platform/api.ts`（修改）
  - `src/lib/platform/types.ts`（修改）
- **验收标准**:
  - hooks 能被 UI 组件正常导入和调用
  - API 成功调用后端端点并正确返回数据
  - `pnpm lint` 通过

---

### Phase 3 — i18n 补充（1 任务）

#### T3-1: 禅道同步相关 i18n 文案
- **优先级**: P2 · **预估**: 0.5天
- **类型**: improvement
- **描述**: 补充禅道集成全部 UI 的中英文翻译，其余语言 fallback 到英文。
- **具体内容**（需要补充的 key 分类）:
  - **同步操作**: `zentao.syncing`, `zentao.syncSuccess`, `zentao.syncFailed`, `zentao.syncResult`, `zentao.syncPull`, `zentao.syncPush`, `zentao.lastSyncTime`
  - **冲突解决**: `zentao.conflictDetected`, `zentao.conflictCount`, `zentao.keepLocal`, `zentao.keepZentao`, `zentao.manualMerge`, `zentao.applyAllLocal`, `zentao.applyAllZentao`
  - **配置**: `zentao.apiUrl`, `zentao.token`, `zentao.projectId`, `zentao.productId`, `zentao.testConnection`, `zentao.testSuccess`, `zentao.testFailed`
  - **状态标签**: `zentao.statusNone`, `zentao.statusSynced`, `zentao.statusPendingPush`, `zentao.statusPushFailed`
  - **类型映射**: `zentao.localType`, `zentao.zentaoType`, `zentao.module`, `zentao.addMapping`, `zentao.typeMapping`
- **涉及文件**:
  - `src/i18n/messages/en.json`（修改）
  - `src/i18n/messages/zh-CN.json`（修改）
  - 其他语言文件（可选，可用英文 fallback）
- **验收标准**:
  - 禅道相关所有 UI 元素都有对应的 i18n key
  - `en.json` 和 `zh-CN.json` 翻译完整
  - 未翻译的语言自动 fallback 到英文

---

### Phase 4 — 测试（1 任务）

#### T4-1: 禅道集成自动化测试
- **优先级**: P2 · **预估**: 1天
- **类型**: test
- **描述**: 编写 Rust 侧单元测试和集成测试，覆盖禅道同步核心逻辑。
- **具体内容**:
  - **单元测试**（`integration/zentao.rs` 内 `#[cfg(test)]`）：
    - Mock HTTP 层测试 API 客户端各端点
    - 测试状态映射逻辑（全量映射表正确性）
    - 测试字段映射和冲突检测
    - 测试同步结果汇总（计数/分类）
  - **集成测试**（`tests/` 目录或 `#[cfg(test)]` integration）：
    - 使用 mock server 测试 pull/push 完整流程
    - 测试冲突场景的检测和解决
    - 测试错误处理（网络超时、认证失败、API 错误码）
  - **测试基础设施**：
    - 创建测试用的 mock HTTP server（可复用 `wiremock` 或 `mockito`）
    - 禅道 API 响应 fixture（JSON fixture 文件）
    - 测试用的内存数据库 fixture
- **涉及文件**:
  - `src-tauri/src/platform/integration/zentao.rs`（添加 test 模块）
  - `src-tauri/tests/zentao_integration_test.rs`（新建，可选）
  - 测试 fixture JSON 文件
- **验收标准**:
  - `cargo test --features test-utils` 全部通过
  - 代码覆盖率：同步核心逻辑 > 80%
  - Mock server 测试覆盖正常流程和异常流程

---

## 实施路线图

```
P0 (3.5天)          P1 (5天)             P2 (4.5天)
┌─────────┐    ┌──────────────┐    ┌─────────────────┐
│ T0-1    │    │ T2-2         │    │ T2-1 (全局设置)   │
│ 密钥管理 │    │ 项目配置tab   │    │                 │
└────┬────┘    └──────┬───────┘    └────────┬────────┘
     │                │                     │
┌────▼────┐    ┌──────▼───────┐    ┌────────▼────────┐
│ T1-1    │    │ T2-3         │    │ T2-4 (冲突面板)  │
│ API客户端│    │ 同步UI+状态   │    │                 │
└────┬────┘    └──────┬───────┘    └────────┬────────┘
     │                │                     │
┌────▼────┐    ┌──────▼───────┐    ┌────────▼────────┐
│ T1-2    │    │ T2-5         │    │ T3-1 (i18n)     │
│ 同步逻辑 │    │ hooks+API    │    │                 │
└────┬────┘    └──────────────┘    └─────────────────┘
     │
┌────▼────┐
│ T1-3    │
│ 命令层   │
└─────────┘
```

**迭代建议**:
1. **P0 完成** → 可以跑通 MVP 流程（从禅道拉取任务 → 在本地处理 → 推送回禅道）
2. **P1 完成** → 完整 UI 交互闭环，多项目配置管理
3. **P2 完成** → 冲突处理精细化和全局配置独立管理
4. 冲突面板（T2-4）MVP 可用"永远保留最新"简化策略替代，推迟到迭代 2
