---
tags: ["分支看板", "review", "代码定位", "缺陷修复", "Git"]
description: 分支看板第三轮全面 Review（32 项）：实测验证的 P0 数据正确性缺陷、降级策略、性能与交互问题，含修复范围标注
---

# 分支看板 Review 第三轮问题清单

> 来源：2026-10-18 对 `feature/分支看板与SQL脚本台账_20260920`（HEAD = `68704965`）的全面 Review。
> **本文取代** `branch-board-review-issues.md` 的状态标注——那份文档的 ❌/🔶 标记是修复前的快照，其中多数已在 `6c8b662f` 修复。
> SQL 脚本台账：用户确认本分支不实现。
>
> **验证状态**：本次 Review 所在机器无 `cargo` / `pnpm`、`node_modules` 未安装，编译与测试未能实测。
> 标注 **【实测】** 的结论用临时 git 仓库验证过；其余为读代码确认。

## 问题总览

| # | 问题 | 严重度 | 本轮修复 |
|---|------|--------|---------|
| 1 | 归档与备注互相覆盖，造成数据丢失 | 🔴 P0 | ✅ |
| 2 | linked worktree 中的分支被误判为"未合并"【实测】 | 🔴 P0 | ✅ |
| 3 | 创建人/创建时间兜底取的是最新提交【实测】 | 🔴 P0 | ✅ |
| 4 | 单个仓库扫描失败导致整个看板空白 | 🔴 P0 | ✅ |
| 5 | 刷新失败静默无提示 | 🟠 P1 | ✅ |
| 6 | server 模式 handler 不校验 path 归属 | 🟢 不单独处理（上游同样如此） | — |
| 7 | worktree 移除失败仍返回 Ok，且 DB 记录先删 | 🟠 P1 | ✅ |
| 8 | 合并冲突放弃后的临时工作树死锁 | 🟠 P1 | ⬜ |
| 9 | git 子进程无超时、无 kill_on_drop | 🟠 P1 | ⬜ |
| 10 | 矩阵计算串行，O(分支 × 环境) | 🟠 P1 | ⬜ |
| 11 | 看板被 forceMount，成本与新鲜度两头吃亏 | 🟠 P1 | ✅ |
| 12 | env 默认归档 / 孤儿清理未接线（死代码） | 🟡 P2 | ⬜ |
| 13 | 非 origin 远端的环境分支解析不到 | 🟡 P2 | ✅ |
| 14 | EnvMergeStatus.ahead/behind 恒为 0 | 🟡 P2 | ⬜ |
| 15 | 删除失败一律引导"强制删除" | 🟡 P2 | ✅ |
| 16 | 合并前 env behind 校验只拒绝不给出路 | 🟡 P2 | ⬜ |
| 17 | 工作区页签无刷新、文件不可点击 | 🟡 P2 | ⬜ |
| 18 | repo 级环境分支保存失败无反馈、不刷新 context | 🟡 P2 | ✅ |
| 19 | "配置环境分支"入口无文案、不校验分支存在 | 🟡 P2 | ⬜ |
| 20 | "哪些环境已配置"有两个数据源 | 🟡 P2 | ⬜ |
| 21 | Push 按钮禁用无原因提示 | 🟡 P2 | ⬜ |
| 22–32 | 打磨项（见下） | 🟢 P3 | 部分 |

---

## 🔴 P0

### 1. 归档与备注互相覆盖，造成数据丢失

**位置**
- `src-tauri/src/db/service/platform_branch_state_service.rs:45–82`（`upsert`）
- `src/lib/platform/api.ts:203–214`（`upsertBranchState`）
- `src/components/platform/branch-board.tsx:570–612`（`toggleArchive` / `saveNote`）

**成因**：`on_conflict(...).update_columns([IsArchived, ArchivedAt, Description, UpdatedAt])` 无条件更新全部四列，而两个前端入口各只传一个字段。JS 的 `undefined` 字段在序列化时被丢弃，后端收到 `None`：

- 点"归档" → `description` 落到 `Set(None)` → **备注被清空**
- 编辑备注 → `is_archived` 走 `unwrap_or(false)` → **归档状态被重置**，分支从"已归档"页签跳回"活跃"

服务层 doc 注释写着 "optional so callers can update just one aspect"，实现与注释正好相反。
`description: Option<Option<String>>` 的三态语义也是失效的：serde 默认把"字段缺失"和"显式 null"都反序列化为外层 `None`，紧随的 `.flatten()` 又把剩下的区分抹平。

**修复**：改为按传入字段动态决定 `update_columns`；`description` 简化为 `Option<String>`，**空串 = 清空备注**，字段缺失 = 不改动。双层 Option 整个移除。

### 2. linked worktree 中的分支被误判为"未合并"【实测】

**位置**：`src-tauri/src/commands/branch_board.rs:273–284`（`merged_set`）

**成因**：`git branch --merged <env>` 对"已在其他 worktree 检出"的分支输出 `+` 前缀，代码只 strip 了 `*`。git 2.50.1 实测：

```
git branch --merged main  →  "+ feat-merged"
                             "* main"
代码解析 →  "+ feat-merged"   # 永远匹配不上任何真实分支名
```

codeg 自身重度使用 worktree，这正是看板最该显示正确的那批分支。

**后果**：已合并显示为未合并 → "仅未合并"筛选、合并按钮可见性、"建议归档"徽标全部出错；用户会对已合并分支重复发起合并。

**修复**：改用 `git for-each-ref --format=%(refname:short) --merged <env> refs/heads`。实测输出干净——含 worktree 分支、无前缀、无 `(HEAD detached at ...)` 伪条目，顺带解决问题 32。

### 3. 创建人/创建时间兜底取的是最新提交【实测】

**位置**：`src-tauri/src/commands/branch_board.rs:522–544`

**成因**：`git log --reverse --format=... -1 <range>`。git 的提交限制（`-1`）**先于** `--reverse` 生效，所以拿到的是最新提交而非最早提交。实测：

```
代码实际用法 git log --reverse --format=%cI%x09%an -1 main..feat  →  Third（最后一个提交者）
期望的最早提交 git log --reverse --format=... main..feat | head -1  →  Second
```

**后果**：reflog 缺失的分支（clone / fetch 来的，团队协作中绝大多数）"创建时间"显示为最后一次提交时间、"创建人"显示为最后一个提交者，并且带 `~` 前缀伪装成合理的估算值。

次级问题：`base_range` 固定取 `env_refs.first()`（dev），从 uat/prd 拉出的分支基线不对；dev 未配置时退化为整个分支历史。

**修复**：改为 `git rev-list --count <spec>` 得到 N，再 `git log --format=... --skip=N-1 --max-count=1 <spec>` 取最早提交——输出有界，实测正确。`<spec>` 用 `<branch> --not <所有存在的 env ref>`，不再只排除 dev。

### 4. 单个仓库扫描失败导致整个看板空白

**位置**：`src-tauri/src/commands/branch_board.rs:666–689`（`git_project_branch_matrix_core`）

**成因**：`for r in results { ok.push(r?) }` —— 任一仓库失败即整体上抛。

**后果**：用户确认"项目下有仓库没克隆"是常态（例：后端开发不会克隆前端仓库）。这种情况下看板**完全打不开**，而错误只在 `flatRows.length === 0` 时渲染一行小字，叠加问题 5 后用户看到的基本是一块空白。

**修复**：`RepoBranchMatrix` 增加 `error: Option<String>`，失败的仓库单独标注、其余正常显示。失败结果不写缓存（`compute_repo_cached` 里 `?` 在 `upsert` 之前，这点原本已正确）。

---

## 🟠 P1

### 5. 刷新失败静默无提示
`branch-board.tsx:802–810`：`error` 只在 `flatRows.length === 0` 时渲染。已有数据时刷新失败 → 不 toast、不提示，只有 spinner 停转。**修复**：已有数据时失败走 toast。

### 6. server 模式 handler 不校验 path 归属（已复核：降级，不单独处理）
`web/handlers/branch_board.rs` 的 `path` / `worktree_path` 原样转发给 core，没有"属于已登记仓库"的校验。

**复核结论（原先评为 P1 过重，已更正）：**
- 这些路由在 `require_token` 认证之后，与其他路由一致。
- 上游的 **33 个 git handler** 同样直接接收任意 `path`，其中包括 `git_push`、`git_reset`、`git_commit`、`git_checkout`、`git_delete_branch`；服务器上还有 `save_file_content`（写任意文件）和终端。所以**持有 token 的人本来就能操作整台服务器**，token 才是真正的安全边界。
- 分支看板新增的 handler 没有扩大这个边界。`git worktree remove --force` 只能删除属于该仓库的已登记 worktree，并不是"删任意目录"。

**结论：** 只给分支看板加校验既不能提升整体安全性（其余 33 个入口照旧），又会在二开侧引入与上游不一致的行为。若将来要做多人共用一个 `codeg-server`，应当在上游层面统一设计（按用户/项目授权 path），而不是在二开里零散打补丁。当前部署若是"一人一实例"或"团队互信共用 token"，无需处理。

### 7. worktree 移除失败仍返回 Ok，且 DB 记录先删
`branch_board.rs:699–720`：失败只 `tracing::warn` 后照常 `Ok(())`，且 DB 软删在前。前端 `branch-board.tsx:502/521/535/565` 还套了一层 `.catch(() => {})`。
**后果**：磁盘目录残留 + DB 记录已删 → 下次同名 worktree add 失败且无记录可追。
**修复**：失败返回 Err 且不删 DB 记录；DB 清理挪到移除成功之后。

### 8. 合并冲突放弃后的临时工作树死锁 ⬜
`branch-board.tsx:1122–1141`（DirtyGate）只有"取消"一个按钮，不识别 `.codeg-wt-` 残留路径、不提供清理入口；`handleConflictClose:551–558` 仅 toast 警告。用户只能手动去文件系统删目录才能再次向该环境合并。
**待定**：需要产品决定"放弃并清理上次未完成合并"的语义（是否连带丢弃用户的冲突编辑），本轮未动。

### 9. git 子进程无超时、无 kill_on_drop ⬜
`src-tauri/src/process.rs:38–47`（`configure_tokio_command`）两者都没有。server 模式下卡住的远端能让 HTTP 请求无限挂起、进程泄漏。
**待定**：`configure_tokio_command` 是全仓库共用入口，加超时会影响所有调用方，需要单独评估。

### 10. 矩阵计算串行，O(分支 × 环境) ⬜
`branch_board.rs:464–547`：`merged_set`、`merge_info`、`rev_left_right`、首提交兜底全部串行 `await`，只有仓库层并发 6（`REPO_CONCURRENCY`）。百分支仓库缓存 miss 时冷刷新可能数十秒。
顺带：`branch_tracking_config` 与 `list_local_branches` 跑了两次等价的 `for-each-ref`，后者其实已经取到 upstream。
**待定**：需要配合 `JoinSet` 限流改造，且要有基准数据才能验证收益，本轮未动。

### 11. 看板被 forceMount，成本与新鲜度两头吃亏
`src/components/platform/task-kanban.tsx:626–633`：`<TabsContent value="changes" forceMount>` 使 `BranchBoard` 在任务看板页加载时就挂载并执行完整的全仓库 git 扫描——即使用户从不点开分支看板；而真正切到该页签时又不重新拉取，数据可以任意陈旧。
**修复**：保留 `forceMount`（维持筛选条件与面板布局），但新增 `active` prop，把首次加载推迟到首次可见，并在重新可见且数据过期时刷新。

---

## 🟡 P2

### 12. env 默认归档 / 孤儿清理未接线（死代码）⬜
`platform_branch_state_service.rs:87–129`：`ensure_archived` / `prune_not_in` 全仓库零调用方（grep 确认）。"env 分支默认归档"没落地；分支删除后 state 行永久残留，**分支名复用时会继承上一次的备注和归档状态**。
**待定**：在读路径上自动 prune 有风险（仅存在于远端、本地已删的分支会丢掉用户备注），需要产品决定清理时机。

### 13. 非 origin 远端的环境分支解析不到
`branch_board.rs:294–307`（`resolve_env_ref`）硬编码 `origin/<env>`。同文件的 `git_pull_branch_core:748–787` 却刻意避免假设 origin，仓库里还有 `remote_status_uses_non_origin_upstream` 测试——口径自相矛盾。
**后果**：env 分支只存在于远端、且远端不叫 origin 时解析失败 → `merged_set` 作用在不存在的 ref 上 → 返回空集合 → 全部分支显示未合并（与问题 2、4 同症状）。
**修复**：改为在 `refs/remotes` 中查找唯一以 `/<env>` 结尾的 ref，与 `git_pull_branch_core` 口径统一。

### 14. EnvMergeStatus.ahead/behind 恒为 0 ⬜
`branch_board.rs:485–511` 恒填 0，`models/branch_board.rs:13–14` 与 `src/lib/platform/types.ts:92–93` 都带着这两个字段。"分支相对环境领先/落后几个提交"这个能力没实现。
**待定**：要么实现（每分支每环境再加一次 `rev-list --count`，与问题 10 冲突），要么从模型移除。需要先定产品是否要这个信息。

### 15. 删除失败一律引导"强制删除"
`branch-board.tsx:630–639`：catch 里无条件 `setForceDelete(true)`。若失败原因是"分支已在其他 worktree 检出"，强制删除同样会失败，但 UI 已经把用户引上这条死路。
**修复**：仅当错误信息指向"未完全合并"时才提供强制删除。

### 16. 合并前 env behind 校验只拒绝不给出路 ⬜
`branch-board.tsx:460–469` 仅 `toast.warning` 后 return，缺优化计划里要求的"快捷拉取"。且 `needsPull` 来自上次矩阵快照，用户未点同步远端时可能是陈旧的 false。

### 17. 工作区页签无刷新、文件不可点击 ⬜
`branch-detail-panel.tsx:699–736`：`status` 只在切分支时加载一次，页签无刷新按钮；文件行纯展示，无法点开看 diff。

### 18. repo 级环境分支保存失败无反馈、不刷新 context
`project-detail.tsx:186–208`（`handleSaveRepoEnv`）：失败只 `console.error`，无 toast；成功只更新本地 `detail`，不像项目级保存那样调 `loadProjects()` → `usePlatform().activeProjectRepos` 可能陈旧，而详情面板的 `envs` 正是由它推导。
**修复**：加 toast + 成功后 `loadProjects()`。

### 19. "配置环境分支"入口无文案、不校验分支存在 ⬜
`project-detail.tsx:685–700`：只有图标按钮 + `title` 提示；弹窗里 Dev/UAT/PRD 标签硬编码未走 i18n（`811–846`）；不校验分支是否真实存在——填错分支名的唯一反馈就是"看板全显示未合并"。

### 20. "哪些环境已配置"有两个数据源 ⬜
看板用后端 `matrix.envs`（`branch-board.tsx:307–313`），详情面板用前端 `resolveEffectiveEnv`（`branch-detail-panel.tsx:163–166`）。两者不一致时，面板会列出某环境行却显示"未配置"。

### 21. Push 按钮禁用无原因提示 ⬜
`branch-detail-panel.tsx:526–535`：`disabled={busy || !repo || repo.folderId == null}` 无 tooltip，用户无法得知为何不可点。

---

## 🟢 P3 打磨

| # | 问题 | 位置 | 本轮 |
|---|------|------|------|
| 22 | 环境差异页签默认不选环境，需手动下拉才加载；点开文件后无法收起 | panel:739–809 | ⬜ |
| 23 | `openFile` 先 `setFileDiff({file, text:""})` → 加载期间闪现"无差异"文案 | panel:305–318 | ⬜ |
| 24 | 环境差异里空 diff 的文件点开后完全无反馈，与提交页签的"无差异"提示不一致 | panel:791 | ⬜ |
| 25 | `is_current` 只看主 worktree HEAD，"仅当前分支"筛选在 worktree 工作流下基本无用 | branch_board.rs:310–323 | ⬜ |
| 26 | `CellState.label` 算了但两个消费方都丢弃，各自重拼三元链且**已经分歧**（看板显示纯日期，面板显示"已合并 · 日期"） | board:890–903, panel:569–582 | ✅ |
| 27 | `"FF"` / `"— (FF)"` 硬编码未 i18n，两处各写一遍 | 同上 | ✅ |
| 28 | `unmergedEnvs` 仅被自己的测试引用（死代码） | branch-board.ts:70–72 | ⬜ |
| 29 | `t(\`task.env${...}\` as never)` 类型逃逸 6 处，未来漏译不会编译期暴露 | board:719/833, panel:593/758 | ⬜ |
| 30 | 表格无排序能力（固定 lastCommitAt 倒序）；`<tr onClick>` 无键盘可达性，且与行内 `<button>` 的 onClick 重复触发 | board:855–870 | ⬜ |
| 31 | git positional 参数（branch / env 名）无 `--` 分隔，`-` 开头的名字会被当 flag | branch_board.rs 多处 | ⬜ |
| 32 | `merged_set` 会把 `(HEAD detached at ...)` 收进集合 | branch_board.rs:278–283 | ✅ |

---

## 测试覆盖缺口

1. ✅ **P14 新增的"按备注/创建人搜索"无测试** —— `branch-board.test.ts` 的 keyword 测试只覆盖分支名，`matchDesc` / `matchAuthor` 两条分支未被触达。本轮已补。
2. ⬜ **2150 行 UI 零组件测试** —— `branch-board.tsx` + `branch-detail-panel.tsx` 没有任何组件测试：分页收敛、detail 快照同步、4 个竞态 seq（`requestSeq`/`diffSeq`/`commitSeq`/`fileDiffSeq`）、脏树拦截、强制删除重试全靠人工回归。**这是剩余缺口里最该补的一项。**
3. 🔶 **Rust 侧环境合并判定完全未覆盖** —— `compute_repo_matrix` 的集成测试只传 `&[]` 空环境，`merged_set`、`merge_info`、FF 识别、worktree `+` 前缀全部在测试盲区。**问题 2 就是从这个缺口漏出来的。** 本轮补了两个带非空 env 的集成测试（覆盖 worktree `+` 与首提交兜底）；`merge_info` 的 merge/FF 区分仍未覆盖。

## i18n

实测 10 种语言（en / zh-CN / zh-TW / ja / ko / es / de / fr / pt / ar）的 `Platform.task` 各 153 个 key，无缺口。

新增 6 条 `Platform.task` key，10 种语言全部提供翻译（用户同意修改语言文件）：

| key | 用途 |
|-----|------|
| `commitsOwnOnly` / `commitsAllHistory` | 提交页签的范围开关 |
| `commitsAllMerged` | 「分支提交已全部合并，显示全部历史」提示 |
| `mergedFastForward` | 快进合并标记（原硬编码 "FF"；中文为「快进/快轉」，其余语言保留通用缩写 FF） |
| `tempWorktreeCleanupFailed` | 临时工作树清理失败的提示（带路径，原先只有 console.warn） |
| `repoUnavailable` | 仓库读不到（多为未克隆）的专用提示，原先借用 `opFailed` 读起来别扭 |

另外「配置环境分支」弹窗里硬编码的 Dev/UAT/PRD 标签改为复用既有的 `task.envDev/envUat/envPrd`，无需新增 key。

**遗留：其余 7 种语言大量是英文占位。** `Platform.task` 共 159 条，zh-CN/zh-TW 只有 3 条与英文相同，而 ja/ko/es/de/fr/pt/ar 各有 **71–75 条（约 45%）与英文完全一致**（如 `Commits`、`Delete Branch`、`Uncommitted changes`）。这是本分支早期留下的状态，不是本轮引入的；本轮新增的 key 在这些语言里都是真翻译。要不要把存量补齐，需要你决定（一次性翻译约 500 条，建议翻译后找母语者抽查）。

---

# 本轮修复实施说明

> 二开约束：本项目基于上游 codeg 二次开发，修改以**不碰上游文件**为原则，减少后续合并冲突。
> 本轮改动的 14 个文件**全部是二开新增文件**（已逐个用 `git cat-file -e main:<path>` 核验），零上游改动。

## 改动文件

| 文件 | 性质 | 改动 |
|------|------|------|
| `src-tauri/src/commands/branch_board.rs` | 二开 | 问题 2、3、4、7、13 + 2 个回归测试 |
| `src-tauri/src/db/service/platform_branch_state_service.rs` | 二开 | 问题 1 |
| `src-tauri/src/models/branch_board.rs` | 二开 | 问题 4（`error` 字段） |
| `src-tauri/src/web/handlers/branch_board.rs` | 二开 | 问题 1（参数类型） |
| `src/components/platform/branch-board.tsx` | 二开 | 问题 1、4、5、7、11、15、26 |
| `src/components/platform/branch-detail-panel.tsx` | 二开 | 问题 26、27 |
| `src/components/platform/project-detail.tsx` | 二开 | 问题 18 |
| `src/components/platform/task-kanban.tsx` | 二开 | 问题 11（传 `active`） |
| `src/lib/platform/branch-board.ts` | 二开 | 问题 26、27（`envCellLabel`） |
| `src/lib/platform/api.ts` | 二开 | 问题 1 |
| `src/lib/platform/types.ts` | 二开 | 问题 4 |
| `src/lib/platform/errors.ts` | 二开（新增） | `errorText` 提取为共享模块（原 E20 重复） |
| `src/lib/platform/branch-board.test.ts` | 二开 | 补测试缺口 1 + `envCellLabel` 测试 |
| `_knowledge/docs/branch-board-review-round3.md` | 新增 | 本文 |

## 缓存版本号（升级必读）

矩阵缓存的键原本只有 git 引用指纹 + 环境配置，**没有代码版本**。本轮修了「worktree 里的分支误判未合并」「创建人取错」等计算逻辑，如果不处理，升级后未发生任何 ref 变化的仓库会**继续读到旧版本算出的错误结果**，直到有人提交或点刷新。已加入 `MATRIX_CACHE_VERSION`（当前为 2）参与缓存键，升级后旧缓存自动作废。**以后凡是改变矩阵计算含义或 `BranchRow` 结构的修改，都要递增它。**

## 关键权衡决策

**问题 1 偏离了二开既有约定。** 仓库里 `platform_project_repo_service::update` 等处的约定是 `Option<Option<T>>` + `if let Some(v) = field { Set(v) }`，DB 层的部分更新语义是对的。但 serde 默认把"字段缺失"和"显式 null"都反序列化为外层 `None`，所以**那套约定在传输层无法表达"清空"**。分支备注是用户可以清空的（文本框删光保存），必须能表达，因此这里改用 `Option<String>` + **空串 = 清空**，并在 service / core / `api.ts` 三处都写明。

> ⚠️ 顺带发现：上面列出的那一批 `Option<Option<T>>` 接口（task / project / knowledge / chat_channel 等）大概都有同样的"无法清空"问题，值得单独排查——不在本轮范围内。

**问题 27 已补完。** 起初为避免改上游语言文件，把 "FF" 临时做成常量；用户同意改语言文件后，已改为 `task.mergedFastForward`，经 `envCellLabel` 的 `labels.fastForward` 传入。

**问题 7 已补完。** 后端移除失败返回 Err（且不再先删 DB 记录）；前端 `cleanupTempWorktree` 现在会弹出带路径的警告 `task.tempWorktreeCleanupFailed`，提示用户手动删除，否则下次向该环境合并会被拦截。

**问题 13 修复时发现并避开了一个坑。** 按远端后缀匹配 env 分支时，`ends_with("/uat")` 会把 `origin/release/uat` 也匹配上。因此要求 `/<env>` 之前的部分必须是**不含斜杠的裸远端名**。`git_pull_branch_core` 里的同类匹配（第 759 行）仍有这个问题，未动。

## ⚠️ 本轮唯一碰到的上游文件

`src-tauri/src/lib.rs`：在二开自己的 `branch_board_commands::…` 注册块里**新增 3 行**（`git_branch_diff_files`、`git_branch_diff_file`、`git_branch_own_commits`），紧挨着二开已有的行。Tauri 命令必须在这里注册，没有绕开的办法；改动与上游冲突的可能性很低，但合并上游时留意这个文件。
另外 `src/i18n/messages/*.json`（10 个文件）经用户同意各新增 6 条 `Platform.task` 文案，**只增不改**（每个文件 +6 行、0 删除，用文本插入而非整文件重写，避免产生满屏 diff）。
同时删除了二开文件 `src/lib/platform/diff-files.ts` 及其测试——环境差异改为后端出文件列表后，前端不再需要自己解析整段 patch，它成了死代码。

## 新增回归测试

- `branch_diff_lists_only_the_branchs_own_changes`（Rust）—— 三点比对：环境上别人的提交不会算成本分支的删除；文件列表与单文件 patch 基线一致；环境分支不存在时报错
- `parse_raw_numstat_merges_status_and_counts`、`option_like_names_are_rejected`（Rust）

- `merged_detection_covers_branches_checked_out_in_a_worktree`（Rust）—— 问题 2 的回归测试，建真实 worktree 验证
- `created_at_fallback_reports_the_first_commit_not_the_last`（Rust）—— 问题 3 的回归测试，删掉 reflog 模拟 fetch 来的分支
- 这两个也是 `compute_repo_matrix` **首次带非空 env 的集成测试**，填上了测试缺口 3 的主要部分
- `merged_means_contained_in_either_the_local_or_the_remote_env_branch`（Rust）—— 设计问题 A：远端已合并本地没拉、本地已合并未推送、都没合并三种情形
- `pull_is_redirected_to_the_worktree_that_owns_the_branch`（Rust）—— 在 worktree 检出的分支拉取被 git 拒绝的修复
- `parse_upstream_track_reads_every_git_shape`（Rust）—— `%(upstream:track,nobracket)` 的各种形态
- 既有测试 `remote_status_distinguishes_unpublished_from_no_remote` 此前就是红的：判「无远端」用的是 `refs/remotes` 是否为空，而不是是否配置了远端，刚 `remote add` 还没 fetch 的仓库会被报成「仅本地」。已改用 `git remote`
- `remoteCountsLabel`、`onlyNeedsPull` 筛选（前端）
- `envCellLabel`（前端）—— 含一条"board 与 panel 在每种 cell kind 上一致"的断言
- `filterRows` 按备注/创建人搜索 —— 填上测试缺口 1

## 未验证事项

本轮改动**未经编译与测试验证**：开发机上没有 `cargo`、没有 `pnpm`、`node_modules` 未安装。已做的替代核验：
- 逐一人工复查全部 diff
- 所有改动函数的调用方用 grep 全量核对（`upsert` / `upsert_branch_state_core` / `RepoBranchMatrix` 构造点 / `resolve_env_ref` / `merged_set` / `removeTempWorktree` / `CellState.label`）
- 改动文件做了括号平衡粗检
- 3 个 git 行为假设用临时仓库实测（`for-each-ref --merged` 输出、`--skip` 取最早提交、`--not` 多 ref）

**需要在有环境的机器上执行**：
```bash
cargo check --features test-utils
cargo test --features test-utils branch_board
cargo clippy --all-targets --features test-utils -- -D warnings
pnpm exec tsc --noEmit
pnpm vitest run src/lib/platform/branch-board.test.ts
pnpm lint .
```

## 剩余待办（按建议顺序）

1. **测试缺口 2** —— 2150 行 UI 零组件测试，是下一个最该补的
2. ~~问题 6（安全）~~ —— 复核后降级，见上文问题 6；仅当要做多人共用 `codeg-server` 时才需要，且应在上游层面统一做
3. **问题 10 + 9**（性能）—— 矩阵串行、git 无超时；都需要基准数据，且 9 涉及上游 `process.rs`，应在二开侧包装
4. **问题 8 / 16 / 12 / 14** —— 都需要产品决策（临时工作树清理语义、快捷拉取、state 行清理时机、是否要 ahead/behind）
5. **问题 17 / 19 / 20 / 21 / 22–25 / 28–31** —— 交互打磨，可批量处理

---

# 目标达成度与设计评审

> 产品初衷：管理本地 git 分支——看清分支合并到各环境的情况、哪些分支需要拉取、方便拉取/合并/删除/筛选/归档、能比对差异、知道哪些功能已发布到哪些环境。

## 目标达成度

| 目标 | 现状 | 说明 |
|------|------|------|
| 各环境合并情况 | ✅ | 本地/远端 env 分支取并集（设计问题 A 已改）；仅识别普通 merge，团队确认如此（设计问题 B） |
| 哪些分支需要拉取 | ✅（本轮补全） | 之前只算了 `needsPull` 却无筛选、无数量；现有「有更新」筛选 + `↑N ↓M` |
| 获取最新代码 | ✅（本轮修 bug） | 分支在**另一个 worktree 检出**时，拉取会被 git 直接拒绝（实测 `refusing to fetch into branch ... checked out at ...`），已改为转到该 worktree 内执行 |
| 合并 | ✅ | 自动复用/创建临时 worktree，有脏树拦截、冲突弹窗、合并后推送提示；临时 worktree 残留死锁未解（问题 8） |
| 删除 | ✅ 仅本地 | 无删远端分支，视需求 |
| 筛选 | ✅ | 仓库/归档/环境+状态/仅未合并/仅需推送/有更新/仅当前/关键词 |
| 归档 | 🔶 | 手动归档可用；「env 分支默认归档」是死代码（问题 12） |
| 比对差异 | 🔶 | 可用但整体加载、基线可能过期，见页签评审 |
| 功能↔环境发布情况 | 🔶 | 看板是**分支视角**，靠备注文本关联功能；没有与任务的关联展示 |

## 设计问题（建议你拍板）

**A. 「是否已合并到环境」以本地 env 分支为准，可能过期。✅ 已改为取并集。** 原来 `resolve_env_ref` 只取一个 ref：本地 `dev/uat/prd` 存在就只看本地。若队友已把分支合进 `origin/uat` 而你本地 `uat` 没拉，该分支会一直显示「未合并」。现在 `resolve_env_refs` 返回本地和远端两个 ref，**任一包含即算已合并**，合并方式与日期取先命中的那个 ref。真实 git 实验确认：本地落后时 `main` 漏掉远端已合并的分支，未推送时 `origin/main` 漏掉本地已合并的分支，并集两者都覆盖。回归测试 `merged_means_contained_in_either_the_local_or_the_remote_env_branch`。
> 注意：并集下「已合并」不代表「已推送」，是否已推看环境分支自己的「需推送」标记。

**B. 只识别真正的祖先关系。⏸ 确认保持现状。** `for-each-ref --merged` 判的是提交可达性，能识别普通 merge；**识别不了 squash merge**（`git cherry` 也不行，实验验证），rebase merge 只有 `git cherry` 能识别。团队确认基本使用普通合并，所以不处理。**若以后改用 squash**，建议做「手动标记为已合并到某环境」存库，而不是靠提交信息猜。

**C. 缓存粒度过粗。** 指纹覆盖整个 `refs/`，仓库里任意一个 ref 变化（任何人 fetch、你自己提交一次）都会让**整仓矩阵作废并全量重算**，缓存对「日常有变动」的仓库基本无效，首次加载慢的体感会反复出现。优化方向是按分支 tip 增量计算，工作量较大。

## 详情 4 个页签评审

| 页签 | 评价 | 建议 |
|------|------|------|
| **概览** | 合理。同步/合并/备注/归档/删除都在这 | 无 |
| **工作区** | ✅ 已并入概览，页签删除。原问题：只列 `git status`、无操作无刷新、分支未检出时整页只有一句「未检出」 | 概览里新增「未提交改动」一节，**仅在有改动（或读取失败）时出现**：琥珀色提示「这些改动尚未提交，合并时不会带入环境」+ 可折叠的文件列表；切回概览时重新读取。注意：合并门禁检查的是**目标环境分支**的工作区，不是功能分支的，所以这里提醒的是「未提交的改动不会被合并」，而不是「会拦截合并」（之前文档里写反了） |
| **环境差异** | ✅ 已改。原问题：① 默认不选环境，进来是空白；② 一次性取回**所有文件**的完整 diff，大分支很慢；③ 基线是可能过期的本地 env；④ 加载失败被吞成空 diff，读起来像「没有差异」 | 现在：进入页签自动选第一个**未合并**的环境；先取文件列表（名称/状态/行数），点文件才取该文件 patch；基线取更新的那个 env ref；失败显示错误而不是「无差异」。新增二开命令 `git_branch_diff_files` / `git_branch_diff_file` |
| **提交** | ✅ 已改。原问题：`git log <branch>` 包含从仓库根开始的**全部祖先**，翻页会翻到别人的历史 | 现在默认只列「在本分支但不在任何环境分支（本地+远端）」的提交，即还没发布的工作；顶部有「仅本分支 / 全部历史」开关。全部已合并时自动显示全部历史并提示原因；环境分支自身、未配置环境、环境分支都不存在时默认全部历史。已推送图标保持可用。新增二开命令 `git_branch_own_commits` |

## 首次加载/详情慢的原因

1. **详情面板每次刷新都重载**（已修）：effect 依赖 `row` 对象，而看板每次刷新都会重建所有 row 对象，导致重拉 log、worktree、status，并把页签弹回「概览」。现仅依赖分支名。
2. **矩阵为每个分支单独起 git 进程**（已缓解）：ahead/behind 并入已有的 `for-each-ref`，并去掉重复的 tracking 查询；分支级探测改为 8 路并发。按「100 分支/3 环境」估算约 393→292 次 git 调用、墙钟约 5.9s→0.5s（**假设值，非实测**）。
3. **缓存过粗**（见设计问题 C，未改）。
4. **环境差异整体加载**（已改为文件列表 + 单文件按需，见页签评审）。
5. **forceMount**：此前页面一打开就全仓库扫描（已改为首次可见才加载）。

## 废代码清单（grep 核实）

| 项 | 位置 | 处理 |
|----|------|------|
| `ensure_archived` / `prune_not_in` | `platform_branch_state_service.rs` | ✅ 已删（零调用方）；连带去掉不再使用的 `ActiveModelTrait` import |
| `unmergedEnvs` + 其测试 | `branch-board.ts` | ✅ 已删 |
| `EnvMergeStatus.ahead/behind` | Rust 模型 + 2 处构造 + `types.ts` + 10 处测试数据 | ✅ 已删（后端恒填 0，前端不读）。`BranchRow.ahead/behind` 是另一回事，已启用并显示 |
| `RepoBranchMatrix.configured` | Rust 模型 + 3 处构造 + `types.ts` | ✅ 已删字段；`configured` 局部变量保留，缓存签名仍在使用 |
| `diff-files.ts` + 测试 | `src/lib/platform/` | ✅ 上一轮已删 |
| `BranchRow.upstream` | 模型 + `types.ts` | **保留**：前端虽未读，但既有测试用它断言「非 origin 远端的上游识别正确」，且可用于悬停显示跟踪分支，不算死代码 |
| `BranchStateInfo.archivedAt/updatedAt` | 模型 + `types.ts` | **保留**：来自数据库的真实信息（何时归档），删除没有收益 |
| 无人引用的语言文案 key | `Platform.task` | **未删**，见下 |

**无人引用的语言文案**（字面量搜索无匹配，与分支看板相关的）：`branchBoard`、`colActions`、`colAheadBehind`、`createdApprox`、`mergeFailed`、`pullFailed`、`detailNotCheckedOut`、`detailNoChanges`。`colAheadBehind` 说明曾有一列「领先/落后」后来拿掉了。没有删，因为是 10 个上游语言文件里的存量，且我无法在编译环境外排除动态拼接 key 的可能；确认无用后可一并删除。

以上都只有后端定义、没有调用点的才算真正的死代码；仅前端不读的字段删除前要确认是否打算展示。

---

## 上一轮 51 项的现状

读代码确认**已修**：P1、P2、P4、P5、P6、P10、P11、P12、P13、P14、P17、P18；F1、F2、F5；E1–E9、E11、E12、E13、E15、E16、E17、E20。
读代码确认**仍未修**（已并入本文）：P3→8、P7→16、P15→17；F3→4、F4→9、F6→12、F7→6、F8→7、F10→31、F12→10、F13→32；E10、E14、E18→29、E19→26/28。
