# CodeG 二开分支合并 main 操作手册（Merge Playbook）

> 沉淀自任务 91（合并 main v0.30.0，2026-09-03）。供后续每次同步上游时复用。
> 二开分支线：`release/ai-platform-merage-*`（版本 1.1.x）；上游：`main`（版本 0.x.y）。

## 一、合并标准流程（六步法）

### 第 1 步：预检评估
```powershell
git status                        # 必须工作树干净
git fetch origin
git merge-base HEAD main          # 找到上次同步点
git log --oneline HEAD..main | Measure-Object -Line   # 上游领先多少
git log --oneline main..HEAD | Measure-Object -Line   # 二开领先多少
```
判断规模：上游领先 >50 个提交时做好打硬仗准备（本次 0.28.1→0.30.0 积压了 166 个提交）。

### 第 2 步：摸清双方改动交集
```powershell
$mainFiles = git diff --name-only <merge-base> main
$curFiles  = git diff --name-only <merge-base> HEAD
$both = $mainFiles | Where-Object { $curFiles -contains $_ }   # 潜在冲突文件
$both.Count
```
交集文件按下面的"冲突分类学"预判处理方式。

### 第 3 步：试合并看真实冲突
```powershell
git merge main --no-commit --no-ff
git diff --name-only --diff-filter=U   # 实际冲突清单
```
用 `--no-commit` 拿到全貌再动手，随时可 `git merge --abort` 止损。

### 第 4 步：按分类逐个解决（见第二节）

### 第 5 步：编译驱动修复"隐形冲突"
git 报告无冲突 ≠ 合并正确。**必须跑编译**，让类型系统暴露"自动合并但语义不兼容"的问题：
```powershell
pnpm install        # lockfile 更新
pnpm build          # TS 全量类型检查 —— 本次暴露 2 处此类问题
cargo check --features test-utils                       # 桌面
cargo check --no-default-features --bin codeg-server    # 服务器
cargo check --no-default-features --bin codeg-mcp       # MCP
```

### 第 6 步：完整验证链 + 提交
```powershell
pnpm eslint; pnpm test
cargo clippy --all-targets --features test-utils -- -D warnings
cargo clippy --no-default-features --bin codeg-server --lib -- -D warnings
cargo clippy --no-default-features --bin codeg-mcp -- -D warnings
```
提交信息惯例：`Merge branch 'main' into release/ai-platform-merage-vX.Y.Z`。

## 二、冲突分类学（本次 13 个冲突的归纳）

| 类型 | 特征 | 处理方式 | 本次实例 |
|---|---|---|---|
| A 版本号 | version 字段两边各走各的版本线 | **保留二开版本**（用户已确认惯例：0.28.x 合并时保留 1.1.5，本次保留 1.1.6） | package.json / Cargo.toml / tauri.conf.json |
| B lockfile | Cargo.lock / pnpm-lock.yaml | 取一侧 → 编译重新生成 → **检查 tauri npm/crate 版本配对**（见第四节坑 1） | Cargo.lock（取 main 后 cargo check 重生成，再手动 update 对齐） |
| C 注册表类 | 两边往同一个表/列表加条目 | **两边都保留** | lib.rs 模块声明（二开 modules + main 的 open_in）、workbench-content.tsx 路由标题表（二开 platform 路由 + main canvas） |
| D 纯 import | import 语句互相穿插 | 两边都保留 | message-list-view.tsx、ai-elements-adapter.ts、clone-dialog.tsx |
| E main 重构 vs 二开字段 | main 把代码重构成新结构（helper/新函数），二开在同区域加了字段/分支 | **以 main 新结构为骨架，把二开内容移植进去** | connection.rs：采用 main 的 `test_delegation_injection()`，把二开的 `decomposition` 字段补进 helper；isTurnAnswerPart 的 switch 补 `decomposition` case |
| F 组件语义合并 | 同一组件两边各加了一套功能 | 语义拼接，两边功能都保留 | conversation-context-bar.tsx：二开 scoped picker（项目内仓库作用域）+ main 的 override（canvas 卡片）分支，onSelect/onSelectChatMode 里 override 分支前置 |
| G 隐形调用点 | 二开文件调用了 main 改过签名的共享组件（git 不报冲突） | **pnpm build 暴露后按 main 新签名补齐** | repo-git-operations.tsx 补 `worktreeNodes` prop（照抄 main 侧 branch-dropdown 的写法） |

判断口径（用户已确认的规则）：
1. 两边功能都要保留
2. main 做了优化的地方以 main 为主，再整合二开内容
3. 拿不准的必须问用户，不要自作主张

## 三、二开资产地图（冲突高发区）

前端：
- `src/components/platform/`、`src/lib/platform/`（decomposition-parser 等）
- `src/contexts/platform-context.tsx`、`src/hooks/use-platform*`、`src/hooks/use-auto-create-project.ts`
- `src/lib/folder-scoping.ts`（作用域选择逻辑，刻意隔离上游重构的样板）
- workbench 路由扩展：project/task/release/kanban/archive 等 route id
- `PlatformDecompositionBridge`、`usePlatform()`、`GoalControlProvider` 组合点是重点合并区
- 自定义类型变体：`AdaptedContentPart` 的 `decomposition`、`DelegationInjection` 的 `decomposition` 字段

后端：
- `commands/{knowledge,project,release,file_search,office_tools,...}` 模块
- `db/service/platform_*`、`db/entities` 平台表
- `acp/decomposition`、`acp/context_injection.rs`

i18n：10 语言 json，自动合并成功率高，合并后靠 pnpm build 兜底。

## 四、已知坑与预存问题（判断"是否合并引入"的参照）

### 坑 1：tauri npm/crate 版本配对
Cargo.lock 取 main 侧后，Rust 侧 tauri 可能落后 npm 侧的 minor 版本，构建时报
`Found version mismatched Tauri packages`。修法（Cargo.toml 约束是宽松的 `version = "2"`）：
```powershell
cargo update -p tauri --precise <npm侧大版本一致的最新>
cargo update -p tauri-plugin-dialog --precise <同上>
```
本次：2.10.2→2.11.5、2.6.0→2.7.2，与 npm `^2.11.1`/`^2.7.2` 配对。

### 坑 2：lockfile 重新生成不会自动升级
cargo 按最小满足原则保持 lock 已有版本，"重新生成"≠"升到最新"。

### 预存问题（合并前就存在，勿误判为合并引入）：
1. **前端测试 55+ 确定性失败**：workspace-folder-dialog（26）、sidebar-conversation-list（29+），根因 `usePlatformContext must be used within PlatformProvider` —— 测试没有 PlatformProvider 包裹。
2. **eslint 全仓 CRLF 错误**（35.9 万条 `Delete ␍`）：Windows 检出行尾配置问题，prettier endOfLine 未配置/检出为 CRLF。
3. **cargo test 无法运行**：测试 exe 启动即 `0xC0000139` —— 测试 exe 无内嵌 manifest，加载 System32 的 comctl32 v5 缺 `TaskDialogIndirect`（v6 独有导出）；应用 exe 有 Tauri manifest 所以正常。修复方向：build.rs 加 `cargo:rustc-link-arg-tests=/MANIFEST:EMBED` + manifest 文件。**判定手段：临时 worktree 上构建合并前代码做对照实验。**
4. **大并行编译页面文件不足**：`os error 1455`，且会让构建缓存进入损坏状态（rlib/E0460/E0463 报错连环出现，单 crate 清理无法收敛，只能 cargo clean 全量重建）。预防：`cargo test -j 2` 或调大 Windows 页面文件。
5. **vitest 全量并行下的偶发失败**：task-settings-dialog、forge-page 单文件跑全部通过，属负载型 flaky。
6. 自动更新检查失败日志（`[Update] check failed ... damonwg99-lab/codeg`）：应用进程没走代理直连 GitHub，reqwest 只认 HTTP_PROXY/HTTPS_PROXY 环境变量，无功能影响。

## 五、降低未来合并痛苦的结构性建议（按性价比排序）

1. **小步高频合并**：本次痛苦的根源是积压（0.28.1→0.30.0，166 个提交、463 个文件）。建议每个上游 minor 版本发布后就合一次（0.31.0 一出就合），冲突量级会从 13 个文件降到 2-3 个。
2. **开启 git rerere**：`git config rerere.enabled true`。相同冲突的解决方案会被记住并自动复用——对"每次都合同样的表/模块声明"这类冲突立竿见影。
3. **推广 folder-scoping 模式**：`@/lib/folder-scoping` 的注释写明"All logic lives in `@/lib/folder-scoping` so main's component refactors never touch it"——二开逻辑全部抽进独立模块，上游文件里只留 1 个 hook 调用点。把这套模式推广到所有高冲突组件（message-list-view、adapter 等），冲突会从"内容合并"退化为"声明合并"。
4. **少改上游共享文件**：command.tsx 的 max-h 这类小改动，能用 CSS 变量/包装组件实现就不要直接改上游文件，直接改 = 永久冲突源。
5. **上游 breaking changes 清单**：维护一份"main 频繁重构的共享组件"清单（BranchSelectorList、MessageListView、ai-elements-adapter、DelegationInjection），每次合并先看这些组件的 CHANGELOG/签名变化，主动排查二开调用点（rg 组件名），不等编译报错。
6. **版本自检脚本**：合并后自动核对（a）三处 version=1.1.x 一致（b）tauri npm/crate minor 配对（c）Cargo.lock 中二开自定义依赖仍在。可做成 `scripts/post-merge-check.ps1`。
7. **合并决策记录**：像本次一样把"版本保留 1.1.6、样式以 main 为准"等决策沉淀进本手册，避免每次重新纠结。

## 六、本次合并档案

- 合并基数：ae18f33e（v0.28.1）；上游领先 166 commits / 463 files；二开领先 140 commits / 177 files
- 冲突 13 文件全部解决；连带修复 2 处隐形冲突 + 2 处 clippy 新 lint
- 验证：cargo check ×3 ✅ / clippy ×3 ✅ / pnpm build ✅ / pnpm test 预存失败 ⚠️ / cargo test 环境受阻 ⛔（见第四节坑 3）
- 用户决策记录：版本保留 1.1.6；command.tsx 采用 main 的 18.75rem
- 详细报告：`_knowledge/.private/tasks/91/ai-intermediate/merge-report.md`
