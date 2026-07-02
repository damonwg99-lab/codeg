# CodeG 启动指南

## 环境要求

| 依赖项 | 版本要求 |
|--------|----------|
| Node.js | >= 22 (推荐 24) |
| pnpm | >= 10 (锁定 11.9.0) |
| Rust stable | 2021 edition |
| Tauri 2 构建依赖 | 仅桌面模式需要 |

**Linux 额外依赖:**
```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

## 初始化

```bash
pnpm install
```

---

## 启动方式

### 方式 1: 仅前端 (Next.js 开发服务器)

```bash
pnpm dev
```

访问 `http://localhost:3000`，无需 Rust 环境，使用 Turbopack 热更新。

> **注意：** 此模式只启动前端，后端未运行，API 请求会失败。需要同时启动后端服务器。

```bash
# 终端 1: 启动后端
pnpm server:dev

# 终端 2: 启动前端
pnpm dev
```

### 方式 2: 桌面应用 (Tauri)

```bash
pnpm tauri dev          # 开发模式，带热更新
pnpm tauri build        # 构建安装包
```

**跳过 sidecar 构建 (快速前端迭代):**
```bash
CODEG_SKIP_SIDECAR=1 pnpm tauri dev
```

> **推荐：** `pnpm tauri dev` 会同时启动前后端，无需手动分别启动。

### 方式 3: 独立服务器 (无 GUI)

```bash
# 开发模式
pnpm server:dev

# 生产构建
pnpm server:build
CODEG_STATIC_DIR=../out ./src-tauri/target/release/codeg-server
```

### 方式 4: 一键安装

**Linux/macOS:**
```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash
```

**Windows PowerShell:**
```powershell
irm https://raw.githubusercontent.com/xintaofei/codeg/main/install.ps1 | iex
```

### 方式 5: Docker

```bash
# 使用 docker-compose
docker compose up -d

# 或手动运行
docker run -d -p 3080:3080 -v codeg-data:/data ghcr.io/xintaofei/codeg:latest
```

### 方式 6: 下载预编译二进制

从 [GitHub Releases](https://github.com/xintaofei/codeg/releases) 下载对应平台的 `codeg-server` 压缩包。

---

## 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CODEG_PORT` | `3080` | HTTP 端口 |
| `CODEG_HOST` | `0.0.0.0` | 绑定地址 |
| `CODEG_TOKEN` | (随机生成) | 认证 token |
| `CODEG_DATA_DIR` | `~/.local/share/codeg` | 数据库目录 |
| `CODEG_STATIC_DIR` | `./web` 或 `./out` | 前端静态文件目录 |
| `CODEG_SKIP_SIDECAR` | - | 设为 `1` 跳过 sidecar 构建 |

---

## 代码检查与测试

### 前端

```bash
pnpm eslint .              # lint
pnpm test                  # 运行所有测试
pnpm test:watch            # 监听模式
pnpm test:coverage         # 覆盖率报告
pnpm build                 # 静态导出构建
```

### Rust (在 `src-tauri/` 目录下)

```bash
# 桌面模式
cargo check
cargo test --features test-utils
cargo clippy --all-targets --features test-utils -- -D warnings

# 服务器模式
cargo check --no-default-features --bin codeg-server
cargo test --no-default-features --bin codeg-server --lib

# MCP 伴生进程
cargo check --no-default-features --bin codeg-mcp
```

---

## 三种二进制说明

| 二进制 | 用途 | 特性标志 |
|--------|------|----------|
| `codeg` | 完整桌面应用 | `tauri-runtime` (默认) |
| `codeg-server` | 独立 HTTP/WS 服务器 | 无特性 (`--no-default-features`) |
| `codeg-mcp` | 多智能体委托 MCP 伴生进程 | 无特性 (`--no-default-features`) |

---

## 快速启动对照表

| 场景 | 命令 | 前端 | 后端 |
|------|------|------|------|
| 只看前端页面 | `pnpm dev` | ✅ | ❌ |
| 完整开发 (推荐) | `pnpm tauri dev` | ✅ | ✅ |
| 服务器部署 | `pnpm server:dev` | ❌ | ✅ |
| 生产部署 | `docker compose up -d` | ✅ | ✅ |

---

## 常见问题

### Q: 3080 端口的页面不是最新的？

**原因：** 3080 端口（codeg-server）使用的是构建后的静态文件，修改代码后需要重新构建。

**解决方法：**

```bash
# 重新构建前端
pnpm build
```

然后**刷新浏览器**即可，不需要重启 server。

> **提示：** 开发模式（debug profile）下，服务器自动禁用缓存，build 后刷新即可看到最新内容。

### Q: 3000 和 3080 端口有什么区别？

| 端口 | 服务 | 说明 |
|------|------|------|
| `localhost:3000` | Next.js dev server | 纯前端，无后端 API，有热更新 |
| `localhost:3080` | codeg-server | 前后端一体，生产级，无热更新 |

- **开发调试 UI**：用 3000（需同时启动后端 `pnpm server:dev`）
- **完整功能测试**：用 3080（改完代码后 `pnpm build` + 刷新浏览器）

### Q: `pnpm tauri dev` 启动后，3080 端口怎么启用？

桌面模式下，web server 需要在 Settings > Web Service > Auto-start 中启用。

或者直接启动独立服务器：

```bash
pnpm server:dev
```
