# 多语言代码定位功能 — 可行性研究

> **首发语言**：Java、Vue (SFC)、React (TSX/JSX)，架构支持扩展到 Python 等。
> **现状**：Monaco 仅作为语法高亮编辑器运行，**所有语言**均无 DefinitionProvider / ReferenceProvider / LSP 集成。

## 背景

在浏览代码文件时，能够通过调用链快速跳转到具体定义（类、方法、字段、组件），提升阅读效率。目前 CodeG 的 Monaco 编辑器仅提供语法高亮，未配置任何语言服务 / LSP 支持。项目需要一套**语言无关**的通用代码定位架构，首发支持 Java、Vue (SFC)、React (TSX/JSX) 三种语言。

## 当前架构

| 层级 | 相关组件 | 能力 |
|------|---------|------|
| **编辑器** | `@monaco-editor/react` v4.7.0 + `monaco-editor` v0.55.1 | 语法高亮、行跳转、选中操作 |
| **语言检测** | `src/lib/language-detect.ts` | `.java` → `"java"`、`.vue` → `"vue"` 已映射 |
| **文件加载** | `workspace-context.tsx` → `openFilePreview()` | 通过 transport 调用后端 `readFileForEdit` |
| **后端文件 API** | `commands/folders.rs` + `web/handlers/files.rs` | 仅文件读写，无代码分析 |
| **后端 LSP** | ❌ 不存在 | 无 LSP 相关代码 |

## 方案对比

### 方案 A：纯前端 DefinitionProvider（推荐 MVP）

| 维度 | 评估 |
|------|------|
| **复杂度** | 低，2-3 天 |
| **精度** | 低 — 基于正则/简单 AST 解析，仅文件内符号 |
| **跨文件** | ❌ 不支持 |
| **启动开销** | 无 |
| **依赖新增** | 无 |

**思路**：在前端注册 `monaco.languages.registerDefinitionProvider` for `java`，利用正则匹配类/方法声明行，返回对应行号作为 `Location`。

```typescript
// 伪代码示意
monaco.languages.registerDefinitionProvider("java", {
  provideDefinition(model, position) {
    const word = model.getWordAtPosition(position)
    // 在当前文件中搜索对应符号的定义位置
    return { uri: model.uri, range: /* 匹配行范围 */ }
  },
})
```

**局限性**：只能跳转到同一文件内的符号；无法解析 import 跨文件引用；无法区分重载。

---

### 方案 B：Rust tree-sitter-java 后端 API

| 维度 | 评估 |
|------|------|
| **复杂度** | 中，1-2 周 |
| **精度** | 中 — AST 精确解析，含 import 解析可跨文件 |
| **跨文件** | ✅ 有限支持（扫描 workspace .java 文件建符号表） |
| **启动开销** | ~6ms/文件解析 |
| **依赖新增** | `tree-sitter` + `tree-sitter-java` |

**架构**：

```
前端 Monaco
  ↓ registerDefinitionProvider → 调用 transport.call("gotoDefinition", { path, line, col })
  ↓
Rust 后端
  ↓ parse 文件 with tree-sitter-java → 查找符号定义
  ↓ 可选：扫描 workspace 同包路径下所有 .java → 跨文件定位
  ↓ 返回 { uri, range } → 前端 Monaco editor.revealRange()
```

**关键依赖**：
- `tree-sitter` — Rust AST 解析框架
- `tree-sitter-java` — Java 语法 grammar（支持方法/类/字段定义、调用、import 语句）

**示例能力**：
```java
import com.example.Foo;  // tree-sitter 可解析 import 节点

Foo.bar();                // 解析方法调用 → 定位到 Foo.java 中 bar() 定义
```

**局限性**：无类型推断（无法解析多态）；无字节码依赖解析；import 解析仅限简单的全限定名。

---

### 方案 C：Rust LSP 客户端 (jdtls)

| 维度 | 评估 |
|------|------|
| **复杂度** | 高，2-3 周 |
| **精度** | **高** — 完整语义分析（类型推断、重载解析、继承链） |
| **跨文件** | ✅ 项目级精准 |
| **启动开销** | 5-30s（JVM + Gradle/Maven 导入） |
| **内存** | 500MB-2GB |
| **依赖新增** | `tower-lsp` 或自建 stdio LSP 客户端 + 用户需安装 JDK 21+ |

**架构**：

```
Rust 后端
  ↓ 通过 stdio 启动 jdtls (Java LSP Server)
  ↓ JSON-RPC 通信 (initialize, textDocument/definition, textDocument/references)
  ↓ 解析结果 → 返回给前端
```

**优势**：完整的 IDE 级语义导航（go-to-definition、find-references、hover、completions、diagnostics）。
**劣势**：启动慢、资源消耗大、需要用户安装 JDK 21+ 和对应构建工具（Gradle/Maven）。

---

## 多语言通用架构

```
                    ┌─────────────────────────────┐
                    │    Monaco Editor (前端)      │
                    │  registerDefinitionProvider  │
                    │  registerReferenceProvider   │
                    └──────────┬──────────────────┘
                               │ transport.call("gotoDefinition", ...)
                    ┌──────────▼──────────────────┐
                    │   code_navigation API       │
                    │   (Rust 后端, 语言无关)       │
                    └──────────┬──────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   tree-sitter-java    tree-sitter-vue    tree-sitter-typescript
   (Java AST)          (Vue SFC AST)      (TSX/JSX AST)
          │                    │                    │
          ▼                    ▼                    ▼
   符号表索引             符号表索引             符号表索引
   (workspace)           (workspace)           (workspace)
```

- **前端 Provider**：每个语言注册独立的 provider，文件内定位各自负责
- **后端 API**：`gotoDefinition` / `findReferences` 接受 `language` 参数，路由到对应 grammar 解析器
- **符号表索引**：统一的数据结构（符号名 → 文件路径 + 行号列号），各语言 grammar 输出同构
- **新增语言**：只需 add grammar crate + 实现 `LanguageParser` trait + 前端注册 provider，无需改框架

## 设计原则

**最小化原有文件改动。** 所有新增功能优先通过新建文件实现，对现有文件的侵入限制在最低必要范围（如注册点、路由挂载、Transport API 入口）。具体约束：

- **前端**：Provider 注册逻辑放在独立文件（如 `src/lib/monaco-java-providers.ts`），在 `handleEditorMount` 中仅加一行 import 调用
- **后端**：`commands/code_navigation.rs` 独立文件，API 路由在 `router.rs` 中加一行挂载
- **TypeScript 类型**：新增类型放在 `src/lib/types.ts` 增量追加，不修改已有类型定义
- **避免**：不修改 Monaco 组件核心渲染逻辑、不修改 workspace-context 数据流、不修改现有 API handler 签名

此原则旨在降低与主分支的合并冲突风险，使功能分支可独立演进。

## 选定方案：A + B 融合路线

> 决策日期：2026-07-09 | 方案 A（纯前端 SymbolProvider）+ 方案 B（tree-sitter 后端 API）
> 首发语言：Java、Vue (SFC)、React (TSX/JSX)

由于 CodeG 是 **AI agent 代码查看工具**，而非 IDE 编辑器，采用**前端 SymbolProvider 即时响应 + 后端 tree-sitter 精确解析**的融合策略：

```
Layer 1 ─ 前端即时定位（方案 A）
         优先级最高，无网络延迟
         → 遍历 Monaco model.getLinesContent()
         → 按语言切换正则模式（Java 类/方法、Vue 组件/script export）
         → 文件内跳转，毫秒级响应

Layer 2 ─ 后端 tree-sitter 精确解析（方案 B）
         当前端 Layer 1 无法定位时回退
         → 按 language 参数路由到对应 grammar 解析器
         → import/require 语句解析 + workspace 符号表索引
         → 跨文件跳转

Layer 3 ─ LSP 服务器（远期可选）
         仅在用户需要完整语义导航时启用
         → Java: jdtls / Vue: vue-language-server
```

### 实现顺序

#### Phase 1（2-3 天）— 前端 Provider + Transport API 骨架

- **基础设施**：
  - 新建 `src/lib/monaco-code-navigation.ts`：通用 provider 注册工厂
  - `handleEditorMount` 加一行 `registerNavigationProviders(monaco)`
- **Provider 实现**：
  - `getDefinitionPatterns(language)`：按语言返回正则模式集
   - Java 模式：类/方法/字段声明
   - Vue 模式：`<script setup>` 中的 `defineComponent` / `export default` / `defineProps` / 组件名
   - React 模式：`export function Component` / `const Component` / `function Component` / `interface` / `type`
- **后端**：
  - 新建 `commands/code_navigation.rs`：`gotoDefinition_core` 空实现（返回 `null`，表示未命中）
  - `router.rs` 加一行挂载 `POST /api/goto_definition`
  - 前端 Provider 先走正则，未命中时调用后端 API（Phase 2 后开始返回数据）

#### Phase 2（1-2 周）— 后端 tree-sitter

- **Rust 侧**：
  - 新增依赖 `tree-sitter` + `tree-sitter-java` + `tree-sitter-vue` + `tree-sitter-typescript`
  - `parsers/java.rs` + `parsers/vue.rs` + `parsers/typescript.rs`：各语言实现 `LanguageParser` trait
  - `commands/code_navigation.rs`：符号索引 + import 跨文件解析
- **符号表索引**：
  - Java：类名 → 文件路径（解析 `import` + 扫描 `src/` 下 `.java`）
  - Vue：组件名（kebab-case / PascalCase）→ `.vue` 文件路径（解析 `<script>` 中的 `import` + 扫描文件系统）
  - React：组件/函数/类型名 → `.tsx`/`.ts` 文件路径（解析 `import` + 扫描 workspace）
- **前端 Provider**：Layer 1 正则未命中时，`transport.call("gotoDefinition", { path, line, col, language })` → Layer 2

## 实现要点（Phase 1）

1. **注册 Provider**：在 `handleEditorMount` 中加一行 `registerNavigationProviders(monaco)`，Provider 工厂按语言注册：
   - `monaco.languages.registerDefinitionProvider("java", { provideDefinition })`
   - `monaco.languages.registerDefinitionProvider("vue", { provideDefinition })`
   - `monaco.languages.registerDefinitionProvider("typescript", { provideDefinition })`

2. **符号定位逻辑**：`getDefinitionPatterns(language)` 返回各语言的正则模式集：

   **Java 模式**：
   ```
   类定义：   ^\s*(public|private|protected)?\s*(abstract|final)?\s*class\s+(\w+)
   方法定义： ^\s*(public|private|protected)?[\s\S]*?(\w+)\s*\([^)]*\)\s*\{?
   字段定义： ^\s*(public|private|protected)?[\s\S]*?(\w+)\s+\w+\s*[=;]
   ```

   **Vue 模式**：
   ```
   <script setup> 组件名：  defineComponent\s*\(\s*['"](.+?)['"]
   export default name：    export\s+default\s*\{[\s\S]*?name\s*:\s*['"](.+?)['"]
   导入的组件：             import\s+(\w+)\s+from\s+['"].\/.+?['"]
   已注册组件选项：         components\s*:\s*\{[\s\S]*?(\w+)\s*[,\}]
   ```

   **React 模式 (tsx/ts)** ：
   ```
   命名函数组件：           export\s+(default\s+)?function\s+(\w+)
   箭头函数组件：           (export\s+)?const\s+(\w+)\s*[=:]\s*(React\.)?memo\s*\(
   普通箭头函数组件：       export\s+const\s+(\w+)\s*=\s*(\(|(\w+\s*:\s*))
   接口/类型定义：          export\s+(interface|type)\s+(\w+)
   hook 函数：              export\s+(default\s+)?function\s+use(\w+)
   ```

3. **跨文件优化（Phase 2）**：Rust 后端按语言路由到对应解析器：
   - Java：`tree-sitter-java` 解析 `import` → 扫描 `src/` 下 `.java` → 匹配类全限定名
   - Vue：`tree-sitter-vue` 解析 `<script>` 中的 `import` → 扫描 workspace 下同名 `.vue` → 匹配组件名
   - React：`tree-sitter-typescript` 解析 `import` → 扫描 workspace 下 `.tsx`/`.ts` → 匹配组件/函数/类型定义

4. **新增语言（如 Python）**：
   - 前端加 provider 模式集（`def` / `class`）
   - 后端加 `tree-sitter-python` 依赖 + 实现 `LanguageParser` trait
   - 无需改框架代码

## 结论

**✅ 完全可行。** 采用 A+B 融合方案，架构语言无关：

- **Phase 1**（2-3 天）：前端按语言注册 `DefinitionProvider` + `ReferenceProvider`，正则模式实现文件内符号跳转，无新增依赖，即时响应
- **Phase 2**（1-2 周）：Rust 后端 `tree-sitter-java` + `tree-sitter-vue` 进行 AST 解析 + workspace 符号表索引，覆盖跨文件导航

**首发支持 Java + Vue + React (TSX/JSX)**，后续扩展 Python 等只需新增 grammar + provider，不改框架。此路线兼顾了开发速度（Phase 1 快速上线）和功能完整性（Phase 2 精确导航），且不引入 JVM 等重型依赖。
