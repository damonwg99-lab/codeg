# 知识库索引自动刷新方案设计

## 概述

当前知识库索引需要在项目知识库页签手动点击"刷新索引"按钮。本文档设计自动刷新机制：**打开 KB 页签即自动扫描 + 启动文件监听，离开页签 / 切换项目自动停止监听**，无需任何手动操作。

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
  - 两阶段去抖循环：空 batch 阻塞等待首事件 → 非空 batch 时 `tokio::time::timeout` 去抖 + `try_recv` 排空队列 + max_batch_window 硬上限
  - 当前用途：仅更新工作区文件树展示（`folder://workspace-state-event`）
  - **未触发知识库索引刷新**
- **Transport.subscribe**: 前端通过 `getTransport().subscribe<T>(event, handler)` 或 Tauri `listen()` 订阅后端事件

---

## 方案设计

### 核心思路

**Watcher 生命周期 = 前端组件挂载/卸载**：
- `KnowledgeManager` 组件挂载 → 启动 watcher + 初始扫描（索引可能过期）
- `KnowledgeManager` 组件卸载 → 停止 watcher
- 文件变更 → watcher 检测 → 去抖 → 全量扫描 → 事件推送 → 前端自动刷新

### 先扫描再监听

组件挂载时先执行一次全量扫描（距离上次打开可能已有文件变化），再启动 watcher 监听后续变更。这样用户打开页签就能看到最新索引，无需手动点击。

### 性能考量

| 措施 | 说明 |
|------|------|
| 同时仅一个 watcher | 组件挂载启动、卸载停止；切换项目时旧 watcher 自动清理 |
| 2s 去抖 | 连续保存文件合并为一次全量扫描 |
| 过滤无关事件 | 仅响应 Create/Modify(Data,Name)/Remove，忽略 Access |
| 全量扫描 | 知识库文件量通常百级，全量扫描开销可忽略；`upsert_by_path` 幂等，无副作用 |
| Server 模式无订阅者 | `WebEventBroadcaster::send` 在 `receiver_count()==0` 时跳过序列化，零开销 |

### 架构总览

```
用户打开 KB 页签
    ↓
KnowledgeManager mount
    ↓
start_kb_watch_core()  ← 初始扫描 + 启动 watcher
    │
    ├─ scan_knowledge_repo_core()  初始全量扫描
    ├─ 返回 ScanResultInfo
    ├─ notify::RecommendedWatcher 启动（监听 _knowledge/ 目录）
    └─ 前端收到结果 → setScanResult + loadDocs

    ...（用户可能在 KB 页签，也可能切到其他页签）
    ...（后台 watcher 继续监听当前项目）

文件变更（OS 事件）
    ↓
watcher 检测到 Create/Modify/Remove（过滤 Access）
    ↓
去抖 2s
    ↓
scan_knowledge_repo_core()  再次全量扫描
    ↓
emit_event("knowledge://index-changed", result)
    ↓
前端订阅回调 → setScanResult + loadDocs  自动刷新列表

用户切到其他项目 / 离开页签
    ↓
KnowledgeManager unmount
    ↓
stop_kb_watch_core()  → watcher 停止
```

---

## 文件变更清单

### 1. 新增: `src-tauri/src/platform/knowledge/watcher.rs`

```rust
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use notify::event::{EventKind, ModifyKind};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use crate::commands::knowledge::scan_knowledge_repo_core;
use crate::db::AppDatabase;
use crate::web::event_bridge::{emit_event, EventEmitter};

const KB_WATCH_DEBOUNCE_MS: u64 = 2_000;
const KB_WATCH_CHANNEL_CAPACITY: usize = 256;

static KB_WATCHERS: LazyLock<Mutex<HashMap<i32, KbManagedWatcher>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct KbManagedWatcher {
    _watcher: RecommendedWatcher,
    _task: tokio::task::JoinHandle<()>,
}

/// 启动 KB 文件监听。如果同 project_id 已有 watcher，先停旧再启新。
pub fn start_kb_watcher(
    project_id: i32,
    kb_dir: &str,
    db: AppDatabase,
    emitter: EventEmitter,
) -> Result<(), anyhow::Error> {
    // 1. 停止旧 watcher
    stop_kb_watcher(project_id);

    // 2. 创建 channel 和 watcher
    let (tx, rx) = mpsc::channel(KB_WATCH_CHANNEL_CAPACITY);
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            let _ = tx.blocking_send(res);
        },
        notify::Config::default().with_poll_interval(Duration::from_secs(2)),
    )?;
    watcher.watch(kb_dir.as_ref(), RecursiveMode::Recursive)?;

    // 3. 启动事件循环
    let handle = tokio::spawn(kb_watch_loop(rx, db, emitter, project_id));

    // 4. 注册
    let mut guard = KB_WATCHERS.lock().unwrap();
    guard.insert(project_id, KbManagedWatcher {
        _watcher: watcher,
        _task: handle,
    });

    Ok(())
}

/// 停止 KB 文件监听。
pub fn stop_kb_watcher(project_id: i32) {
    let mut guard = KB_WATCHERS.lock().unwrap();
    if let Some(entry) = guard.remove(&project_id) {
        entry._task.abort();
        // watcher drop → 停止监听；task drop → JoinHandle 清理
    }
}

// ─── 事件循环 ───

fn is_relevant_kb_event(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Remove(_)
    )
}

async fn kb_watch_loop(
    mut event_rx: mpsc::Receiver<notify::Result<Event>>,
    db: AppDatabase,
    emitter: EventEmitter,
    project_id: i32,
) {
    let debounce = Duration::from_millis(KB_WATCH_DEBOUNCE_MS);
    let mut dirty = false;

    loop {
        // ── Phase 1: 阻塞等待首个相关事件 ──
        if !dirty {
            match wait_next_relevant(&mut event_rx).await {
                Some(_) => dirty = true,
                None => break,
            }
        }

        // ── Phase 2: 去抖 ──
        match tokio::time::timeout(debounce, wait_next_relevant(&mut event_rx)).await {
            Ok(Some(_)) => {
                // 静默期内又有新事件，重置去抖
                continue;
            }
            Ok(None) => {
                // channel 关闭，执行最后一次扫描后退出
                do_scan(&db, &emitter, project_id).await;
                break;
            }
            Err(_elapsed) => {
                // 去抖超时，触发扫描
                do_scan(&db, &emitter, project_id).await;
                dirty = false;
            }
        }
    }
}

async fn wait_next_relevant(
    rx: &mut mpsc::Receiver<notify::Result<Event>>,
) -> Option<Event> {
    loop {
        match rx.recv().await {
            Some(Ok(event)) if is_relevant_kb_event(&event) => return Some(event),
            Some(Ok(_)) => continue,   // Access 等无关事件，跳过
            Some(Err(e)) => {
                tracing::warn!("[kb-watcher] notify error: {e}");
                continue;
            }
            None => return None,
        }
    }
}

async fn do_scan(db: &AppDatabase, emitter: &EventEmitter, project_id: i32) {
    match scan_knowledge_repo_core(db, project_id).await {
        Ok(result) => {
            emit_event(emitter, "knowledge://index-changed", &result);
        }
        Err(err) => {
            tracing::error!("[kb-watcher] auto-scan project={project_id} failed: {err}");
        }
    }
}
```

### 2. 修改: `src-tauri/src/platform/knowledge/mod.rs`

```diff
  pub mod scanner;
  pub mod skill_discovery;
  pub mod init;
+ pub mod watcher;
```

### 3. 修改: `src-tauri/src/commands/knowledge.rs`

新增 `start_kb_watch_core` / `stop_kb_watch_core`：

```rust
use crate::platform::knowledge::watcher;
use crate::web::event_bridge::EventEmitter;

/// 启动 KB 监听 + 执行初始扫描。返回扫描结果供前端展示。
/// 如果 watcher 已存在则先停旧再启新。
pub async fn start_kb_watch_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    project_id: i32,
) -> Result<ScanResultInfo, AppCommandError> {
    // 1. 先执行一次全量扫描（距离上次打开可能已有文件变化）
    let result = scan_knowledge_repo_core(db, project_id).await?;

    // 2. 启动 watcher 监听后续变更
    let kb_dir = ensure_kb_dir(db, project_id).await?;
    watcher::start_kb_watcher(project_id, &kb_dir, db.clone(), emitter.clone())
        .map_err(|e| {
            AppCommandError::io(format!("Failed to start KB watcher: {e}"))
        })?;

    Ok(result)
}

/// 停止 KB 监听。
pub fn stop_kb_watch_core(project_id: i32) {
    watcher::stop_kb_watcher(project_id);
}
```

新增 Tauri 命令（在已有 `#[cfg(feature = "tauri-runtime")]` 块中）：

```rust
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn start_kb_watch(
    app: tauri::AppHandle,
    db: State<'_, AppDatabase>,
    project_id: i32,
) -> Result<ScanResultInfo, AppCommandError> {
    let emitter = EventEmitter::Tauri(app);
    start_kb_watch_core(&db, &emitter, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub fn stop_kb_watch(project_id: i32) {
    stop_kb_watch_core(project_id);
}
```

> 原有 `scan_knowledge_repo` 命令保持不变，作为手动刷新按钮的 fallback（仅扫描，不启停 watcher）。

### 4. 修改: `src-tauri/src/web/handlers/knowledge.rs`

新增两个 handler（放在现有 handler 之后）：

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartKbWatchParams {
    pub project_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopKbWatchParams {
    pub project_id: i32,
}

pub async fn start_kb_watch(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<StartKbWatchParams>,
) -> Result<Json<ScanResultInfo>, AppCommandError> {
    let result = knowledge_commands::start_kb_watch_core(
        &state.db,
        &state.emitter,
        params.project_id,
    )
    .await?;
    Ok(Json(result))
}

pub async fn stop_kb_watch(
    Json(params): Json<StopKbWatchParams>,
) -> impl IntoResponse {
    knowledge_commands::stop_kb_watch_core(params.project_id);
    StatusCode::OK
}
```

在 `router.rs` 中注册路由：
```rust
.route("/start_kb_watch", post(knowledge::start_kb_watch))
.route("/stop_kb_watch", post(knowledge::stop_kb_watch))
```

### 5. 修改: `src-tauri/src/db/mod.rs`

`tokio::spawn` 需要 `AppDatabase: Send + 'static`。`DatabaseConnection` 内部是 `Arc`，添加 Clone 即可（Clone 只是增加引用计数）：

```diff
+ #[derive(Clone)]
  pub struct AppDatabase {
      pub conn: DatabaseConnection,
  }
```

### 6. 修改: `src/lib/platform/api.ts`

新增两个 API 函数：

```typescript
export async function startKbWatch(
  projectId: number
): Promise<ScanResultInfo> {
  return getTransport().call("start_kb_watch", { projectId })
}

export async function stopKbWatch(projectId: number): Promise<void> {
  return getTransport().call("stop_kb_watch", { projectId })
}
```

### 7. 修改: `src/components/platform/knowledge-manager.tsx`

核心变更：**挂载时自动启动 watcher + 初始扫描，卸载时停止 watcher**。同时保持手动刷新按钮作为 fallback。

```tsx
useEffect(() => {
  let cancelled = false
  let unsub: (() => void) | null = null

  async function init() {
    // ── 1. 启动监听 + 初始扫描 ──
    try {
      const result = await startKbWatch(projectId)
      if (!cancelled) {
        setScanResult(result)
      }
    } catch (e) {
      console.error("[kb-watch] start failed:", e)
    }

    // ── 2. 加载文档列表 ──
    try {
      const docList = await listKnowledgeDocs({ projectId })
      if (!cancelled) {
        setDocs(docList)
        setLoading(false)
      }
    } catch {
      if (!cancelled) setLoading(false)
    }

    // ── 3. 订阅文件变更事件 ──
    try {
      const { getTransport, isDesktop } = await import("@/lib/transport")
      if (isDesktop()) {
        const { listen } = await import("@tauri-apps/api/event")
        unsub = await listen<ScanResultInfo>(
          "knowledge://index-changed",
          (event) => {
            setScanResult(event.payload)
            void loadDocs()
          }
        )
      } else {
        unsub = await getTransport().subscribe<ScanResultInfo>(
          "knowledge://index-changed",
          (payload) => {
            setScanResult(payload)
            void loadDocs()
          }
        )
      }
    } catch (e) {
      console.error("[kb-watch] subscribe failed:", e)
    }
  }

  void init()

  return () => {
    cancelled = true
    unsub?.()
    // 卸载 / 切换项目时停止 watcher
    stopKbWatch(projectId).catch((e) =>
      console.error("[kb-watch] stop failed:", e)
    )
  }
}, [projectId]) // projectId 变化 = 切换项目，清理旧 watcher 后启动新 watcher
```

> 原有的 `handleScan` 手动刷新按钮保留不变（调用 `scanKnowledgeRepo`，仅扫描不启停 watcher），作为 watcher 出错或用户想立即刷新的 fallback。

---

## 生命周期

| 事件 | 行为 |
|------|------|
| 打开项目 A 的 KB 页签 | `startKbWatch(A)` → 扫描 + 启动 watcher → 显示结果 |
| 在项目 A 内切换到其他页签 | TabsContent hidden，watcher 继续运行（后台监听 A） |
| 从项目 A 切到项目 B 的 KB 页签 | `useEffect` cleanup → `stopKbWatch(A)` → 新 `useEffect` → `startKbWatch(B)` |
| 关闭项目详情 / 导航到其他页面 | 组件卸载 → `stopKbWatch(projectId)` → watcher 停止 |
| 应用退出 | 进程结束 → tokio runtime 关闭 → watcher + task 自动清理 |

---

## 数据流

```
┌─ KnowledgeManager mount ─────────────────────────────────┐
│                                                           │
│  start_kb_watch_core()                                   │
│    ├─ scan_knowledge_repo_core()   初始全量扫描            │
│    │    └─ 返回 ScanResultInfo → 前端 setScanResult       │
│    ├─ watcher::start_kb_watcher()  启动文件监听            │
│    │    │                                                 │
│    │    ▼  （后台持续运行）                               │
│    │  notify::RecommendedWatcher                          │
│    │    ├─ 过滤: Create / Modify(Data,Name) / Remove      │
│    │    ├─ 忽略: Access                                   │
│    │    ├─ 去抖: 2s                                       │
│    │    └─ 超时 → scan_knowledge_repo_core()              │
│    │          └─ emit_event("knowledge://index-changed")   │
│    │               └─ 前端 loadDocs()  自动刷新列表        │
│    │                                                      │
│  loadDocs()  加载文档列表                                 │
│  subscribe("knowledge://index-changed")  订阅自动更新      │
│                                                           │
└───────────────────────────────────────────────────────────┘

┌─ KnowledgeManager unmount ────────────────────────────────┐
│                                                           │
│  unsubscribe()                                            │
│  stop_kb_watch_core(projectId)                            │
│    └─ watcher::stop_kb_watcher()                          │
│         ├─ task.abort()                                   │
│         └─ watcher drop → 停止文件监听                     │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

---

## upload 与 watcher 的交互

KB 文件上传（`upload_kb_doc_core`、`upload_task_attachment_core`）直接写入文件系统 → watcher 检测到文件变更 → 触发全量扫描。`upload_*_core` 内部已调用 `upsert_by_path` 写入 DB 记录，watcher 触发的 `scan_knowledge_repo_core` 会再次 `upsert_by_path`（幂等操作），两次写入相同数据，**不影响正确性**。由于 KB 文件量通常在百级，额外开销可忽略。

---

## 边界情况

| 场景 | 行为 |
|------|------|
| 连续快速保存文件 | 去抖 2s，合并为一次扫描 |
| 批量复制/删除多个文件 | 同上 |
| KB 目录不存在 | `ensure_kb_dir` 自动创建，watcher 监听新创建的目录 |
| KB 目录在监听中被删除 | 下一次扫描时 `ensure_kb_dir` 重建；watcher 检测到变化后重扫 |
| watcher 创建失败 | 记录 error 日志，不影响现有文档列表展示；手动刷新按钮仍可用 |
| notify channel 关闭 | 执行最后一次扫描后退出，不丢失已变更 |
| Access 事件（编辑器读取文件） | 过滤忽略，不触发扫描 |
| notify 返回错误事件 | 记录 warn 日志，跳过该事件 |
| Server 模式无 WS 订阅者 | `receiver_count()==0` 时跳过序列化，无性能损耗 |
| 组件因 TabsContent hidden 而非 unmount | watcher 继续运行（同项目，预期行为） |
| 组件受 React StrictMode 双重挂载 | useEffect cleanup 会停止第一次的 watcher，第二次正常启动 |
| 用户想立即刷新 | 点击手动"刷新索引"按钮 → `scanKnowledgeRepo`（纯扫描，不影响 watcher） |

---

## 不涉及的文件

- `src-tauri/src/workspace_state/mod.rs`
- `src-tauri/src/app_state.rs`
- `src-tauri/src/platform/knowledge/scanner.rs`
- `src-tauri/src/platform/knowledge/init.rs`
- `src-tauri/src/platform/knowledge/skill_discovery.rs`
- `src-tauri/src/models/`（`ScanResultInfo` 已存在）
- 数据库 schema / migration
- 前端 store

---

## 待确认事项

1. **路由注册**：确认 `router.rs` 的正确插入位置。
2. **Tauri 命令注册**：确认 `lib.rs` 中 Tauri command handler 注册列表（通常 `generate_handler!` 宏），需添加 `start_kb_watch` / `stop_kb_watch`。
3. **项目删除清理**：确认项目删除 handler 中需插入 `stop_kb_watch_core`（当前不影响，watcher 下次扫描时会发现项目已删除并报错，但资源未释放）。
4. **`knowledge://index-changed` 事件名**：确认不与现有事件冲突。
