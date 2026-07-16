# 知识库索引自动刷新方案设计

## 概述

当前知识库索引需要用户在项目明细知识库页面手动点击"刷新索引"按钮。本文档设计了一套自动刷新机制，当知识库目录中的文件发生变化时，自动触发索引扫描，保持索引数据与文件系统同步。

---

## 现状分析

### 手动触发流程

```
用户点击"刷新索引" → scanKnowledgeRepo() → scan_knowledge_repo_core()
  → scanner::scan_kb_dir() 遍历目录 + 解析 frontmatter
  → platform_knowledge_doc_service::upsert_by_path() upsert 每条记录
  → 软删除已不存在的文件
  → 返回 ScanResultInfo { new_count, updated_count, deleted_count }
  → 前端 loadDocs() 刷新列表
```

### 已存在的文件监听基础设施

- **notify crate**: 已引入 `Cargo.toml`，版本 6
- **workspace_state 监听器**: 在 `src-tauri/src/workspace_state/mod.rs` 中，使用 `notify::recommended_watcher` 递归监听整个项目根目录
  - 300ms 去抖 + 1.5s 最大批处理窗口
  - 当前用途：仅更新工作区文件树展示（`folder://workspace-state-event`）
  - **未触发知识库索引刷新**

### 前端事件订阅机制

使用 `getTransport().subscribe<T>(event, handler)` 或 Tauri 原生 `listen()` 订阅后端事件（参考 `src/app/pet/_hooks/usePetState.ts`）。

---

## 方案设计：轻量独立 KB 监听器

### 核心思路

摒弃"修改 workspace_state 监听器"的方案（架构耦合度高），改为创建独立的 KB 目录监听器，复用 `notify` crate，但只监听知识库目录本身。

### 架构总览

```
用户编辑/创建/删除 KB 文件
    ↓ (OS 文件系统事件)
notify::RecommendedWatcher (只监听 _knowledge/ 目录)
    ↓ (mpsc::channel)
去抖 2s (tokio::time::timeout)
    ↓
scan_knowledge_repo_core(&db, project_id) 全量扫描
    ↓ (返回 ScanResultInfo)
emit_event(emitter, "knowledge://index-changed", result)
    ↓ (WebSocket / Tauri 事件)
前端 knowledge-manager.tsx 事件处理
    ↓
setScanResult(result) + loadDocs() 刷新列表
```

### 文件变更清单

#### 1. 新增: `src-tauri/src/platform/knowledge/watcher.rs`

核心模块，包含：

**全局静态注册表**（类似 `WORKSPACE_STREAMS`）:

```rust
static KB_WATCHERS: LazyLock<Mutex<HashMap<i32, KbManagedWatcher>>> = LazyLock::new(|| {
    Mutex::new(HashMap::new())
});
```

**`KbManagedWatcher`** 结构体:

```rust
struct KbManagedWatcher {
    _watcher: notify::RecommendedWatcher,  // 文件系统监听器，保持存活
    _task: tokio::task::JoinHandle<()>,    // 异步事件循环任务
}
```

**`pub fn start_kb_watcher(project_id, kb_dir, db, emitter)`**:

1. 停止同 `project_id` 的旧 watcher（如有）
2. 创建 `notify::recommended_watcher`，通过 `mpsc::channel` 传递事件
3. `tokio::spawn` 事件循环：
   - 接收 `notify::Event` 事件
   - 去抖 2s（`tokio::time::timeout` 模式，参考 workspace watcher）
   - 去抖结束后调用 `scan_knowledge_repo_core(&db, project_id)`
   - 通过 `emit_event` 发送 `knowledge://index-changed` 事件
4. 将 watcher 存入 `KB_WATCHERS` 注册表

**`pub fn stop_kb_watcher(project_id)`**:
- 从注册表移除并 abort 对应 task

**去抖逻辑**（伪代码）:

```rust
loop {
    match event_rx.recv().await {
        Some(_) => { /* 首次事件，进入去抖阶段 */ }
        None => break, // 通道关闭
    }

    // 去抖：等待 KB_WATCH_DEBOUNCE_MS 静默期
    match tokio::time::timeout(debounce, event_rx.recv()).await {
        Ok(Some(_)) => continue, // 又有新事件，重置去抖
        Ok(None) => break,
        Err(_) => { /* 去抖超时 → 触发扫描 */ }
    }

    // 扫描
    match scan_knowledge_repo_core(&db, project_id).await {
        Ok(result) => emit_event(&emitter, "knowledge://index-changed", &result),
        Err(err) => tracing::error!("[kb-watcher] auto-scan failed: {err}"),
    }
}
```

#### 2. 修改: `src-tauri/src/platform/knowledge/mod.rs`

```diff
  pub mod scanner;
  pub mod skill_discovery;
  pub mod init;
+ pub mod watcher;
```

#### 3. 修改: `src-tauri/src/commands/knowledge.rs`

添加辅助函数 `ensure_kb_watcher`（在扫描后启动 watcher）:

```rust
/// 为项目启动 KB 自动监听（内部解析 kb_dir）。
pub async fn ensure_kb_watcher(
    db: &AppDatabase,
    emitter: &EventEmitter,
    project_id: i32,
) -> Result<(), AppCommandError> {
    let kb_dir = ensure_kb_dir(db, project_id).await?;
    watcher::start_kb_watcher(project_id, &kb_dir, db.clone(), emitter.clone())
        .map_err(|e| AppCommandError::io_error("Failed to start KB watcher")
            .with_detail(e.to_string()))?;
    Ok(())
}
```

修改 Tauri 命令 `scan_knowledge_repo`，注入 `AppHandle`:

```diff
  pub async fn scan_knowledge_repo(
+     app: tauri::AppHandle,
      db: State<'_, AppDatabase>,
      project_id: i32,
  ) -> Result<ScanResultInfo, AppCommandError> {
-     scan_knowledge_repo_core(&db, project_id).await
+     let result = scan_knowledge_repo_core(&db, project_id).await?;
+     let emitter = EventEmitter::Tauri(app);
+     let _ = ensure_kb_watcher(&db, &emitter, project_id).await;
+     Ok(result)
  }
```

#### 4. 修改: `src-tauri/src/web/handlers/knowledge.rs`

修改 Web Handler `scan_knowledge_repo`:

```diff
  pub async fn scan_knowledge_repo(
      Extension(state): Extension<Arc<AppState>>,
      Json(params): Json<ScanKnowledgeRepoParams>,
  ) -> Result<Json<ScanResultInfo>, AppCommandError> {
-     Ok(Json(knowledge_commands::scan_knowledge_repo_core(&state.db, params.project_id).await?))
+     let result = knowledge_commands::scan_knowledge_repo_core(&state.db, params.project_id).await?;
+     let _ = crate::commands::knowledge::ensure_kb_watcher(
+         &state.db, &state.emitter, params.project_id,
+     ).await;
+     Ok(Json(result))
  }
```

#### 5. 修改: `src-tauri/src/db/mod.rs`

需要 `#[derive(Clone)]`，因为 watcher 的 tokio task 需要持有 `AppDatabase` 的所有权来调用 `scan_knowledge_repo_core`。

```diff
+ #[derive(Clone)]
  pub struct AppDatabase {
      pub conn: DatabaseConnection,
  }
```

`DatabaseConnection` 内部是 `Arc<ConnectionManager>`，Clone 只是复制引用计数，零开销、无副作用。

#### 6. 修改: `src/components/platform/knowledge-manager.tsx`

添加事件订阅（参考 `usePetState.ts` 的模式）:

```tsx
useEffect(() => {
  let unsub: (() => void) | null = null

  async function subscribe() {
    const { getTransport, isDesktop } = await import("@/lib/transport")
    try {
      if (isDesktop()) {
        const { listen } = await import("@tauri-apps/api/event")
        const off = await listen<ScanResultInfo>(
          "knowledge://index-changed",
          (event) => {
            setScanResult(event.payload)
            void loadDocs()
          }
        )
        unsub = off
      } else {
        const off = await getTransport().subscribe<ScanResultInfo>(
          "knowledge://index-changed",
          (payload) => {
            setScanResult(payload)
            void loadDocs()
          }
        )
        unsub = off
      }
    } catch (e) {
      console.error("KB auto-refresh subscription failed:", e)
    }
  }
  void subscribe()
  return () => { unsub?.() }
}, [projectId, loadDocs])
```

---

## 边界情况处理

| 场景 | 行为 |
|------|------|
| 连续快速保存文件 | 去抖 2s，只在静默期后触发一次扫描 |
| 批量复制/删除多个文件 | 同上，合并为一次扫描 |
| KB 目录被删除 | 扫描时 `ensure_kb_dir` 会重建目录 |
| 用户首次打开 KB 页面 | 手动点击"刷新索引"后 watcher 自动激活 |
| 通过上传功能添加文件 | 文件写入磁盘 → watcher 检测到 → 自动索引 |
| 应用关闭 | 进程退出，tokio task 自动清理 |
| watcher 创建失败 | 记录错误日志，不影响手动扫描能力 |
| 同一项目重复扫描 | `start_kb_watcher` 会先停止旧 watcher 再创建新的 |

---

## 数据流示意

```
┌─────────────────────────────────────────────────────────┐
│ 后端 (Rust)                                             │
│                                                         │
│  scan_knowledge_repo_core()                             │
│    │ 首次手动扫描成功                                    │
│    ▼                                                    │
│  watcher::start_kb_watcher()                            │
│    │                                                    │
│    ├─ notify::RecommendedWatcher (监听 _knowledge/)      │
│    │   │                                                │
│    │   ▼  (文件变更事件 via mpsc channel)                │
│    ├─ 去抖 2s  ←─────────────────────────────────────   │
│    │   │                                                │
│    │   ▼  (超时)                                        │
│    ├─ scan_knowledge_repo_core()                        │
│    │   │                                                │
│    │   ▼  (ScanResultInfo)                              │
│    └─ emit_event("knowledge://index-changed")            │
│         │                                                │
│         ▼ (WebSocket / Tauri 事件)                      │
│                                                         │
│ ┌─────────── 事件通道 ──────────────────────────────────┐│
│                                                         │
│ 前端 (React/TypeScript)                                  │
│                                                         │
│  subscribe("knowledge://index-changed")                  │
│    │                                                    │
│    ▼                                                    │
│  setScanResult(result)  ← 显示扫描结果通知               │
│  loadDocs()              ← 自动刷新文档列表              │
└─────────────────────────────────────────────────────────┘
```

---

## 不涉及的文件

以下文件无需修改：

- `src-tauri/src/workspace_state/mod.rs` — 保持原样
- `src-tauri/src/app_state.rs` — 使用全局注册表而非 AppState 字段
- `src-tauri/src/platform/knowledge/scanner.rs` — 扫描逻辑无变化
- `src-tauri/src/platform/knowledge/init.rs` — 初始化逻辑无变化
- `src-tauri/src/platform/knowledge/skill_discovery.rs` — 无变化
- 数据库 schema/migration — 无变化
- 前端 store/ — 纯事件驱动，无需修改状态管理
