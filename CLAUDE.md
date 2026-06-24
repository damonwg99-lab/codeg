# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Codeg（Code Generation）是一个多智能体编码工作台，它将多个智能体（Claude Code、Codex CLI、OpenCode、Gemini CLI、OpenClaw、Cline、Hermes 等）统一到一个工作区中，支持会话聚合和多智能体协作，支持桌面安装，服务器/Docker 部署。

## 技术栈

- **桌面运行时**: Tauri 2（Rust 后端 + webview 前端）
- **服务器运行时**: 独立 Rust 二进制（Axum HTTP + WebSocket）
- **前端**: Next.js 16（静态导出模式）+ React 19 + TypeScript（strict）
- **样式**: Tailwind CSS v4 + shadcn/ui（radix-maia 风格）
- **国际化**: next-intl（10 种语言）
- **数据库**: SeaORM + SQLite
- **包管理器**: pnpm

## 开发与运行命令

### 前端

```bash
pnpm install                    # 安装依赖（含 monaco-editor postinstall 复制）
pnpm dev                        # Next.js dev server（Turbopack，无 Rust）
pnpm build                      # 静态导出到 out/

# 测试
pnpm test                       # vitest 全跑（CI 用同一条命令）
pnpm test -- src/lib/path-utils.test.ts   # 跑单个测试文件
pnpm test:watch                 # 增量重跑
pnpm test:coverage              # 覆盖率报告 → coverage/index.html

# Lint
pnpm eslint .                   # ESLint（next/core-web-vitals + typescript + prettier）
```

### 桌面应用（Tauri）

```bash
pnpm tauri dev                  # 全栈开发（自动构建 codeg-mcp sidecar）
pnpm tauri build                # release 桌面安装包（含 sidecar 打包）
CODEG_SKIP_SIDECAR=1 pnpm tauri dev  # 跳过 sidecar 构建，前端快速迭代
pnpm tauri:prepare-sidecars     # 仅构建 codeg-mcp → src-tauri/binaries/
```

### 服务器模式

```bash
pnpm server:dev                 # cargo run（开发模式，含 Axum 热重载）
pnpm server:build               # release 二进制 → src-tauri/target/release/codeg-server
```

### Rust 检查与测试（在 `src-tauri/` 下执行）

```bash
# 桌面模式
cargo check
cargo test --features test-utils
cargo clippy --all-targets --features test-utils -- -D warnings

# 服务器模式
cargo check --no-default-features --bin codeg-server
cargo test --no-default-features --bin codeg-server --lib

# codeg-mcp
cargo check --no-default-features --bin codeg-mcp
cargo clippy --no-default-features --bin codeg-mcp -- -D warnings

# 解析器快照
cargo insta review                                    # 评审快照变化
INSTA_UPDATE=auto cargo test --features test-utils    # 自动写新 .snap
```

Rust 集成测试在 `src-tauri/tests/*.rs`，需 `--features test-utils` 才能访问 test scaffolding（`AppState::new_for_test` 等）。

## 架构

### 三种二进制

| Binary | Feature | 用途 |
|--------|---------|------|
| `codeg` | `tauri-runtime`（默认） | 完整桌面应用 |
| `codeg-server` | 无 feature | 独立 Axum HTTP + WebSocket 服务器 |
| `codeg-mcp` | 无 feature | per-launch stdio MCP 伴生进程，向代理 CLI 暴露异步子智能体委托工具 |

`codeg-mcp` 通过 UDS/named pipe 连接主进程的 `DelegationBroker`。运行时必须与主二进制同目录，或通过 `CODEG_MCP_BIN` 环境变量指定路径。

### 共享核心与双模式桥接

`AppState` 是共享状态结构（db、连接管理器、终端管理器、事件广播器、委托 broker、聊天频道管理器等）。两种运行模式通过 `EventEmitter` 枚举区分事件发射方式：

- `EventEmitter::Tauri(AppHandle)` — 桌面模式，通过 Tauri 事件系统推送
- `EventEmitter::WebOnly(Arc<WebEventBroadcaster>)` — 服务器模式，通过 broadcast channel 推送，WebSocket 订阅者消费

`_core` 后缀函数 — 接受普通引用参数（`&AppDatabase`、`&EventEmitter`），供 Web handlers 和 Tauri 命令共用。`#[cfg_attr(feature = "tauri-runtime", tauri::command)]` 标记的函数始终可用，仅在桌面模式注册为 Tauri 命令。

### Rust 后端（`src-tauri/src/`）

- **`app_state.rs`** — 共享状态
- **`acp/`** — Agent Client Protocol：连接管理（`ConnectionManager`）、生命周期、事件流、反馈、权限请求、会话 fork
- **`acp/delegation/`** — 多智能体委托核心：`DelegationBroker`、UDS listener、companion spawner、live reply、depth 追踪、meta writer
- **`chat_channel/`** — 聊天频道子系统（Telegram、Lark/飞书、iLink/微信）：manager、session bridge、command dispatcher、webhook、i18n
- **`commands/`** — 业务逻辑，部分模块仅桌面模式编译（`#[cfg(feature = "tauri-runtime")]`）
- **`parsers/`** — 每个智能体一个解析器（claude、cline、codex、gemini、hermes、openclaw、opencode）
- **`models/`** — 共享数据结构
- **`db/`** — SeaORM entities + 迁移（`migration/mYYYYMMDD_NNNNNN_*.rs`）
- **`web/`** — Axum 路由、HTTP handlers、WebSocket、auth 中间件、静态文件服务、event bridge

### 前端（`src/`）

- **`lib/transport/`** — Transport 抽象层：三种实现（`TauriTransport`/`WebTransport`/`RemoteDesktopTransport`），自动检测环境切换。`RemoteDesktopTransport` 用于桌面客户端连接远程 codeg-server
- **`lib/adapters/`** — AI 响应 → UI 组件的适配器
- **`lib/types.ts`** — Rust 模型的 TypeScript 镜像
- **`lib/api.ts`** — 主 API 客户端（通过 `getTransport()` 调用）
- **`hooks/`** — React hooks（ACP 连接、代理专家、文件树、终端、消息队列等）
- **`components/chat/composer/`** — TipTap 富文本编辑器 + slash command / mention 建议
- **`components/ai-elements/`** — Markdown 渲染（rehype/remark 插件链）、代码块、tool call、terminal 输出
- **`i18n/`** — next-intl 消息文件在 `i18n/messages/`，10 种语言 JSON

### 数据流

```
桌面：invoke() → Tauri command → _core 业务逻辑 → 返回数据
服务器：fetch() → Axum handler → 同一 _core 业务逻辑 → 返回 JSON
远程桌面：invoke() → RemoteDesktopTransport → 远端 Axum handler → 返回
实时：后端事件 → EventEmitter → Tauri 事件 / WebSocket broadcast → 前端
委托：agent CLI → codeg-mcp（stdio MCP） → UDS → DelegationBroker → 主进程
```

### 条件编译约定

- `#[cfg(feature = "tauri-runtime")]` — 仅桌面模式编译（Tauri 窗口、通知、`tauri::State`、file_io、remote_proxy 等）
- `#[cfg_attr(feature = "tauri-runtime", tauri::command)]` — 函数始终可用，仅在桌面模式标记为 Tauri 命令
- `_core` 后缀函数 — 接受普通引用参数，两种模式共用

## 关键约束

- **仅支持静态导出**：`next.config.ts` 设置 `output: "export"`，不支持动态路由（`[param]`），必须使用查询参数替代
- **路径别名**：`@/*` 映射到 `./src/*`，导入写法为 `@/lib/utils`、`@/components/ui/button`
- **vitest globals**：测试中 `describe/it/expect` 全局可用（配置了 `globals: true`），setup 文件 `src/test-setup.ts`
- **测试文件命名**：前端 `*.test.{ts,tsx}`，Rust parser 快照用 insta（`.snap` 文件）
- **服务器部署环境变量**：`CODEG_PORT`、`CODEG_HOST`、`CODEG_TOKEN`、`CODEG_DATA_DIR`、`CODEG_STATIC_DIR`、`CODEG_MCP_BIN`、`CODEG_SKIP_SIDECAR`

## 代码风格

- Prettier：无分号、尾逗号（es5）、2 空格缩进、80 字符宽度
- ESLint：next/core-web-vitals + typescript + prettier（`prettier/prettier: error`）
- TypeScript：strict + `noUnusedLocals` + `noUnusedParameters`
- Rust：2021 edition，`thiserror` 定义错误类型，clippy `-D warnings`

## 业务规则（勿反复确认）

- **项目仓库（platform_repo kind Folder）不在 sidebar 文件夹列表中显示**：仓库 Folder 只用于 git/文件树切换（RepoSelector + BranchDropdown），不在会话分组中出现。只有项目根目录（Regular kind Folder）才出现在 sidebar
- **新建会话归属项目根 Folder**：项目上下文激活时，Ctrl+N / sidebar 新建会话一律归到项目根 Folder（`activeProject.folderId`），不归到当前选中的 repo Folder
- **项目切换需要显式操作**：创建项目不隐式切换（不调用 `setActiveProjectId`）；只有项目列表的 Check 按钮才切换项目
- **项目切换后根 Folder 必须进入 workspace**：`setActiveProjectId` → `loadDetail` → 必须 `addFolderToWorkspaceById(rootFolderId)` + `setActiveFolderId(rootFolderId)`，否则 sidebar 无会话分组、BranchDropdown 不显示、RepoSelector 无数据源
- **后端创建 Folder 必须发 `folder://changed` 事件**：`create_project_core` 和 `add_project_repo_core` 创建 Folder 后需 emit `folder://changed`（用 `emit_folder_upsert`），否则前端 workspace 无法自动感知新 Folder
