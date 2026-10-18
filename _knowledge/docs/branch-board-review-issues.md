---
tags: ["分支看板", "review", "代码定位", "缺陷修复", "Git"]
description: 分支看板（feature/分支看板与SQL脚本台账_20260920 分支）全面 Review 的 18 个问题：精确代码位置、成因与修复方案
---

# 分支看板功能全面 Review 问题详单（代码级定位）

> 来源：会话 #444，对 `feature/分支看板与SQL脚本台账_20260920` 分支的全面 Review。
> 本文为**代码级详单**；概要版见 `docs/branch-board-optimization-plan.md`。
> 状态标注基于会话后一轮修复的当前工作区快照：✅已修复 / 🔶部分修复 / ❌未修复。
> SQL 脚本台账：用户确认本分支暂不实现。

## 问题总览

| # | 问题 | 状态 | 优先级 |
|---|------|------|--------|
| P1 | ref_fingerprint 用随机 Hasher，重启后缓存全失效 | ✅ | 严重 |
| P2 | 快进合并/合并日期误判 | ✅ | 严重 |
| P3 | 冲突残留临时工作树导致合并死锁 | 🔶 | 严重 |
| P4 | 临时工作树 folders 表孤儿记录 | ✅ | 中 |
| P5 | 环境差异两点比较，他人提交显示为负向删除 | ✅ | 严重 |
| P6 | 提交历史未传 withFiles:false，初次加载极慢 | ❌ | 严重 |
| P7 | 合并前未校验远端 env 分支，推送被拒 | ❌ | 中 |
| P8 | "拉取"按钮过度禁用 | ❌ | 中 |
| P9 | 分支删除无 force 重试、面板不关闭 | ❌ | 中 |
| P10 | Tabs 未受控，切分支后内容空白 | ❌ | 中 |
| P11 | 缺少代码库级环境分支配置 UI | ❌ | 中 |
| P12 | 只读信息卡不展示环境分支 | ❌ | 低 |
| P13 | 同步远端串行阻塞（凭据重试已加） | 🔶 | 中 |
| P14 | 搜索/过滤缺陷 | ✅ | 中 |
| P15 | 工作区页签无刷新/文件点击交互 | ❌ | 低 |
| P16 | 创建时间/创建人缺 first_commit 兜底 | ✅ | 低 |
| P17 | 备注保存无 trim | ❌ | 低 |
| P18 | 头部无已归档徽标 | ❌ | 低 |

---

## P1 ✅ fingerprint 随机种子（`branch_board.rs`）

**位置**：`src-tauri/src/commands/branch_board.rs`
- 现实现 `FnvHasher` 定义：110–132 行
- `ref_fingerprint` 函数：137–159 行

**问题成因**：原代码用 `std::collections::hash_map::DefaultHasher::new()`，SipHash 每次进程启动带随机种子 → 指纹 `ref_fingerprint` 跨重启不一致 → 持久化在 SQLite 中的缓存 key 全部 miss，缓存形同虚设。

**修复后现状**（155–158 行）：
```rust
let mut hasher = FnvHasher::new();
entries.hash(&mut hasher);
Some(format!("{:016x}", hasher.finish()))
```

## P2 ✅ merge_info 快进判定错误（`branch_board.rs`）

**位置**：`src-tauri/src/commands/branch_board.rs`，`merge_info` 函数，334–364 行

**问题成因**：原实现 `git log --ancestry-path --reverse branch..env` 不带 `--merges`，且两点 range 会排除 base 分支上已有的 merge commit —— 导致真正吞入该分支的 merge commit 找不到，被误判为 `fast_forward`、合并日期为空/错误。

**修复后现状**：
```rust
let range = format!("{branch}..{env}");
let out = match git_stdout(path, &[
    "log", "--merges", "--ancestry-path", "--reverse",
    "--format=%cI%x09%H", &range,
]) ...
(Some("fast_forward".to_string()), None)  // 无 merge commit 时才标 fast_forward
```

## P3 🔶 脏工作树合并死锁（`branch-board.tsx` + `branch-board.ts`）

**位置 1**：`src/lib/platform/branch-board.ts`，`canMerge`：124–130 行
```ts
const dirtyPaths = entries.map((e) => e.file)
return { ok: dirtyPaths.length === 0, dirtyPaths }
```

**位置 2**：`src/components/platform/branch-board.tsx`，`performMerge` 中的 gate 逻辑：439–447 行
```ts
const status = await gitStatus(targetPath)
const gate = canMerge(status)
if (!gate.ok) {
  if (temp && tempPath) { await removeTempWorktree(repoPath, tempPath).catch(() => {}) }
```

**位置 3**：脏工作树拦截弹窗（`DirtyGate` AlertDialog）：1036–1055 行，只有一个 Cancel 按钮（1052 行）。

**问题成因**：合并冲突未解决而关闭冲突 Dialog 时临时工作树被保留（`handleConflictClose` 492–499 行仅 toast 警告 `task.conflictLeftTemp`）；后续对该 env 合并时 `canMerge` 永久被脏 temp 目录拦截。**遗留缺口**：弹窗未识别 `.codeg-wt-` 残留路径，未提供"放弃并清理上次未完成合并"按钮。

## P4 ✅ 临时工作树 folders 孤儿记录（`branch_board.rs`）

**位置**：`src-tauri/src/commands/branch_board.rs`，`git_worktree_remove_temp_core`：686–707 行

**问题成因**：原实现只执行 `git worktree remove --force` + `prune`，不清理数据库 `folders` 表记录 → `.codeg-wt-` 临时目录删除后 DB 残留孤儿记录（前端拼接调用在 branch-board.tsx 429 行）。

**修复后现状**：
```rust
let _ = git_output(&path, &["worktree", "prune"]).await;
if let Some(db) = db {
    if let Err(e) = crate::db::service::folder_service::remove_folder(&db.conn, &worktree_path).await {
```

## P5 ✅ 环境差异两点比较（`folders.rs`）

**位置**：`src-tauri/src/commands/folders.rs`，`git_diff_with_branch`：2667–2712 行；`resolve_compare_ref`：2632–2659 行

**问题成因**：旧实现固定 `git diff <branch>` 两点比较，env 分支上其他人的提交会以"删除"形式出现在当前分支的环境差异里，功能失真。

**修复后现状**（2684–2690 行）：
```rust
match base_branch.as_deref().map(str::trim) {
    Some(base) if !base.is_empty() => {
        let compare_ref = resolve_compare_ref(&path, base).await;
        args.push(format!("{compare_ref}...{target_branch}")); // 三点 diff
    }
    _ => args.push(target_branch.to_string()),
}
```

## P6 ❌ gitLog 未传 withFiles（`branch-detail-panel.tsx`）

**位置**：`src/components/platform/branch-detail-panel.tsx`
- 初次加载 `useEffect`：179 行 `gitLog(path, PAGE, row.branch)`
- loadMore：219–225 行 `gitLog(path, PAGE, row.branch, undefined, entries.length)`

**API 已支持**：`src/lib/api.ts` 4634–4653 行，`gitLog(path, limit?, branch?, remote?, skip?, author?, allBranches?, withFiles?: boolean)`。

**问题成因**：gitLog 默认为每个 commit 计算/载入全量文件 diff，50 条/页导致打开详情面板初次加载极慢。**修复**：两处调用显式传 `withFiles: false`。

## P7 ❌ 合并前未校验远端 env 分支（`branch-board.tsx`）

**位置**：`src/components/platform/branch-board.tsx`，`performMerge`：399–487 行

**问题成因**：函数内的校验只有 `resolveEffectiveEnv`（405–409 行）与 `envBranch === row.branch`（410 行），之后直接 `const res = await gitMerge(targetPath, row.branch)`（449 行），全程没有目标 env 分支的 behind 检查或 fetch。本地 env 落后远端时 merge 后推送必然被远端拒绝。**修复**：performMerge 前检查 behind > 0 弹风险提示并支持快捷拉取。

## P8 ❌ "拉取"按钮过度禁用（`branch-detail-panel.tsx`）

**位置**：`src/components/platform/branch-detail-panel.tsx`，499–510 行
```tsx
{row?.hasRemote && (
  <Button ...
    disabled={busy || !row.needsPull}
    onClick={onPull}
```

**问题成因**：`needsPull` 来自上次"同步远端"的矩阵快照；用户未点同步前 needsPull=false，按钮禁用，无法主动拉取。**修复**：改为 `disabled={busy || !row.hasRemote}`。

## P9 ❌ 分支删除缺 force 重试 + 面板残留（`branch-board.tsx`）

**位置**：`src/components/platform/branch-board.tsx`，`confirmDelete`：555–572 行
```ts
await gitDeleteBranch(repoPathOf(repo), branch)
setDeleteTarget(null)
await refresh()
```
catch 仅 toast（565–570 行）；删除确认弹窗 1058–1081 行。

**问题成因**：① 删除未完全合并的分支报错时无 `force=true` 重试路径；② 成功后只 `setDeleteTarget(null)` 未 `setDetail(null)`，右侧详情面板残留已被删除的分支。

## P10 ❌ Tabs 未受控（`branch-detail-panel.tsx`）

**位置**：`src/components/platform/branch-detail-panel.tsx`，449–452 行
```tsx
<Tabs
  defaultValue="overview"
```
切分支 effect（163–213 行）重置了 entries/diff 等状态，但没有控制 Tabs active value，也无 `onValueChange`。

**问题成因**：切到新分支时非受控 Tabs 停留在旧 tab（如 "diff"），而新分支 diffEnv 为空 → 内容空白。**修复**：改受控 `value`/`onValueChange`，切分支时自适应。

## P11 ❌ 缺代码库级环境分支配置（`project-detail.tsx`）

**位置**：`src/components/platform/project-detail.tsx`，repos 列表渲染：579–617 行

**问题成因**：每个 repo 只显示 name/localDir、`repo.branch` Badge、CLAUDE.md Badge 和删除按钮（608–615 行）；repo 级 dev/uat/prd 覆盖配置无处可设（编辑表单只有项目级三个 Input，451–470 行）。**修复**：repo 项增加"配置环境分支"入口，支持单库重写。

## P12 ❌ 只读信息卡不展示环境分支（`project-detail.tsx`）

**位置**：`src/components/platform/project-detail.tsx`，`basic-info` 只读分支：472–527 行

**问题成因**：只渲染 name/status/rootDir/description/clientName/defaultAgentType；devBranch/uatBranch/prdBranch 仅编辑态 Input 中存在，只读态无法看到项目当前的环境分支配置。

## P13 🔶 同步远端串行（`branch-board.tsx`）

**位置**：`src/components/platform/branch-board.tsx`，`handleSync`：322–358 行
```ts
for (const m of visibleMatrices) {
  ...
  await withCredentialRetry((creds) => gitFetch(path, creds), { folderPath: path })
```

**问题成因**：凭据重试已包装（✅），但仍是 for 内逐仓库 `await` 串行，某仓库 fetch 慢/卡住会阻塞整个同步。**修复**：改 `Promise.allSettled` 并行。

## P14 ✅ 搜索/过滤缺陷（`branch-board.ts`）

**位置**：`src/lib/platform/branch-board.ts`，`filterRows`：89–118 行

**问题成因**：① 原关键词只匹配 branch，不含备注与创建人；② `onlyUnmerged && !row.envs.some(...)` 把未配置环境的仓库全排除 → 无环境时"仅未合并"结果全空。

**修复后现状**（101、110–115 行）：
```ts
if (opts.onlyUnmerged && row.envs.length > 0 && !row.envs.some((e) => !e.merged)) return false
...
const matchBranch = row.branch.toLowerCase().includes(kw)
const matchDesc = state?.description?.toLowerCase().includes(kw) ?? false
const matchAuthor = row.createdBy?.toLowerCase().includes(kw) ?? false
```

## P15 ❌ 工作区页签缺交互（`branch-detail-panel.tsx`）

**位置**：`src/components/platform/branch-detail-panel.tsx`，`TabsContent value="working"`：657–694 行；状态行纯展示 673–685 行：
```tsx
<span ...>{s.status}</span><span ...>{s.file}</span>
```

**问题成因**：文件行无 onClick、无按钮（不能点击查看 Diff）；status 只在切分支 effect 里加载一次，页签无刷新按钮。

## P16 ✅ 创建时间/创建人兜底（`branch_board.rs`）

**位置**：`src-tauri/src/commands/branch_board.rs`
- reflog 路径：`created_at_from_reflog` 368–379 行；`parse_reflog_created_by` 382–398 行（读 `logs/refs/heads/<branch>`）
- first_commit 兜底：`compute_repo_matrix` 520–542 行

**问题成因**：原实现无兜底（或兜底拿的是**整个仓库**首个提交而非该分支的）。

**修复后现状**：
```rust
let base_range = env_refs.first()
    .map(|(_, _, resolved)| format!("{resolved}..{}", lb.name))
    .unwrap_or_else(|| lb.name.clone());
if let Ok(out) = git_stdout(repo_path,
    &["log", "--reverse", "--format=%cI%x09%an", "-1", &base_range])
...
created_at_source = Some("first_commit".to_string());
```
前端 798 行用 `row.createdAtSource === "first_commit"` 加 `~` 前缀标注估算值。

**遗留注意**：`base_range` 取 `env_refs.first()`（dev），dev 未配置时退化为 `lb.name ` 单分支范围。

## P17 ❌ 备注保存无 trim（`branch-board.tsx`）

**位置**：`src/components/platform/branch-board.tsx`，`saveNote`：533–553 行
```ts
const next = await upsertBranchState(noteEdit.repoId, noteEdit.branch, {
  description: noteEdit.value || null,
})
```

**问题成因**：`|| null` 只挡空串，纯空格/换行串原样入库。**修复**：`const v = noteEdit.value.trim(); description: v || null`。

## P18 ❌ 头部无归档徽标（`branch-detail-panel.tsx`）

**位置**：`src/components/platform/branch-detail-panel.tsx`
- 头部：397–447 行，只有 branch、remoteChip、repo.name/createdBy/createdAt/lastCommitAt
- `state.isArchived` 目前只出现在 overview 页签的归档按钮（620–628 行）

**问题成因**：已归档分支在面板头部无任何视觉标识，易误操作。

---

## 未修复项修复计划（❌/🔶 共 11 项速查）

| # | 修复方案 | 位置 |
|---|----------|------|
| P6 | gitLog 初次加载与 loadMore 传 `withFiles: false` | branch-detail-panel.tsx:179, 219–225 |
| P7 | performMerge 前校验 env 分支 behind>0，弹提示+快捷拉取 | branch-board.tsx:399–487 |
| P8 | disabled 改为 `busy \|\| !row.hasRemote` | branch-detail-panel.tsx:499–510 |
| P9 | 删除报错提供 force 重试；成功后 `setDetail(null)` | branch-board.tsx:555–572, 1058–1081 |
| P10 | Tabs 受控 + 切分支自适应重置 | branch-detail-panel.tsx:449–452 |
| P11 | repo 列表加"配置环境分支"入口 | project-detail.tsx:579–617 |
| P12 | 只读卡展示 dev/uat/prd 分支名 | project-detail.tsx:472–527 |
| P13 | for 串行改 `Promise.allSettled` 并行 | branch-board.tsx:322–358 |
| P15 | 工作区页签加刷新按钮；文件行点击打开 diff | branch-detail-panel.tsx:657–694 |
| P17 | saveNote 先 `.trim()` | branch-board.tsx:533–553 |
| P18 | 头部按 `state.isArchived` 显示归档徽标 | branch-detail-panel.tsx:397–447 |

P3（🔶）补全方案：DirtyGate 弹窗（branch-board.tsx:1036–1055）检测脏路径是否为 `.codeg-wt-` 残留，是则提供"放弃并清理上次未完成合并"按钮（调 `removeTempWorktree` 后放开 allow 继续）。

---

# 二轮深度 Review 发现的新问题（会话 #445 补充）

> 前端 20 条 + 后端 13 条，均为前述 18 条之外的新发现。部分经 tsc/vitest 实测确认。

## 后端新问题（F1–F13）

### 高

**F1 🔴 编译错误：调用不存在的缓存服务函数**
- `src-tauri/src/commands/branch_board.rs:591,613` 调用 `cache_service::get_cached_matrix/set_cached_matrix`，但实际服务 `platform_branch_matrix_cache_service` 只有 `get(conn, repo_id)`（无条件返回 `(fingerprint, json)` 元组）和 `upsert`，无此二函数，全仓库无定义。且语义不匹配：调用方期望带指纹匹配，现 get 无条件返回元组。
- 修复：统一为取回元组再比对指纹 / 写入走 `upsert`，或补带匹配语义的服务函数。

**F2 🔴 编译错误：`RepoBranchMatrix` 构造字段与模型不匹配**
- `branch_board.rs:594–603, 617–626` 构造了 `is_configured/dev_branch/uat_branch/prd_branch` 字段，而 `models/branch_board.rs:74–85` 实际是 `configured: bool` + `envs: Vec<String>`，无这些字段。命令端停在旧三分支模型，未随 enum 模式（`configured + envs`）同步。前端 TS 类型也需对齐。
- 修复：构造 `configured`、`envs`、`branches` 三字段。

**F3 git 失败系统性吞错 + 空结果写入缓存持久化**
- `branch_board.rs:454–457`（`list_local_branches` 失败→空矩阵）、229–287（`remote_branches`/`merged_set` 等失败→空集合）、609–615（失败结果照样 `set_cached_matrix`）。
- 后果：仓库路径错/git 坏/权限问题时，看板显示"空矩阵"或"全未合并"，且空 JSON 被缓存，refs 不变就一直命中坏缓存，用户完全看不到错误。
- 修复：helper 返回 `Result` 上抛 provider 级失败；失败不写缓存；或加 `error: Option<String>` 字段 + tracing。

**F4 git 子进程无超时、无 kill_on_drop**
- `branch_board.rs:165–172, 691–698, 742–780`；`configure_tokio_command`（src/process.rs:38–47）无 `kill_on_drop(true)`、无 timeout。pull 的网络 fetch 走 `folders.rs:1857`，服务器模式下挂起的远端可让 HTTP 请求无限阻塞，进程泄漏。
- 修复：矩阵本地探针加 deadline（如 30s/repo），fetch 类网络操作加超时 + `kill_on_drop`。

**F5 upsert_branch_state check-then-insert 无事务，并发撞唯一索引**
- `platform_branch_state_service.rs:52–87` + 迁移 `m20260920...branch_state.rs:35–45`（`repo_id+branch` unique 索引）。两个并发 upsert 同 find None → 一者成功另一者撞 unique 报内部错误。无事务、无 `on_conflict`。
- 修复：改 `insert().on_conflict(columns([RepoId,Branach]).do_update(...))` 或事务+重试。

**F6 ensure_archived / prune_not_in 死代码，"env 分支默认归档"未落地**
- `platform_branch_state_service.rs:92–118, 122–134`：全仓库只有定义无调用；已消失分支永不 prune。要么接入 matrix/list 接口，要么删除。

**F7 web 模式新路由对 path/worktree_path/branch 无归属校验（安全）**
- `src-tauri/src/web/router_platform.rs:72–90` + `web/handlers/branch_board.rs:40–70,120–133`：前端传参原样转发。服务器模式下（持有 CODEG_TOKEN 者）可对**主机任意目录**执行 `git pull`（含凭据写入）或 `git worktree remove --force`（branch_board.rs:691）。无"path 属于已注册 repo"归属校验。
- 修复：core 校验 path ∈ project 注册 repo 集合，或 canonicalize 后位于 project root_dir 之下；worktree_path 限制在对应 repo 内。
- 顺带：`remove_folder_by_path` 精确路径匹配（folder_service.rs:481–487），路径分隔符/大小写不一致时软删不生效——是"孤儿记录"的另一独立诱因。

**F8 worktree remove 失败仍返回 Ok**
- `branch_board.rs:686–707`：remove 失败仅 `tracing::warn`，照常 `Ok(())` 且 DB 软删已先行执行（700–705）→ 前端看到成功，磁盘目录残存，下次 worktree add 同名再失败。与 pull 链路 non-zero→Err 风格相反。
- 修复：stderr 转 Err 返回；DB 清理放在删除成功之后（顺序倒置）。

### 低

**F9 linked worktree 路径的 fingerprint 恒定 → 缓存永不失效**
- `branch_board.rs:74–96, 137–159`：`git_dir_no_spawn` 对 worktree 解析出 per-worktree dir，refs/packed-refs 实际在 commondir（主 .git），扫描得到常量 refs。若日后对 worktree 路径算矩阵，缓存将 stale。
- 修复：解析 `<gitdir>/commondir` 收敛到 common dir，或对 worktree 显式返回 None 不缓存。

**F10 git 参数 `-` 开头 option injection**
- `branch_board.rs:755, 691, 291` 等：用户可配的 branch/env 名直接拼到 `rev-parse --verify`、`worktree remove` 等 positional 参数，以 `-` 开头会被 git 吃掉当 flag（args 数组执行无 shell 注入，但 option 注入仍在）。
- 修复：positional 参数前统一插 `--`，或校验名称不以 `-` 开头。

**F11 upsert_branch_state_core 未校验 repo_id 归属**
- `branch_board.rs:718–728`：不存在的 repo_id 以 FK violation 冒到用户端显示成内部错误；未像 matrix core 那样 `not_found("Project not found")`。web handler（handlers/branch_board.rs:96–110）同样透传。

**F12 矩阵计算串行 git 子进程，O(branches × envs)**
- `branch_board.rs:476–545`：每 branch × env 发独立 `git log --merges`（loop 内）+ per-branch rev-list/log，全部串行 await（repo 层仅并发 6）。百分支级仓库缓存 miss 时冷刷新可能几十秒。
- 修复：按 env 批量收集 merge 信息，或 JoinSet 限流并发。

**F13 merged_set 用 `git branch --merged` 裸输出按行解析**
- `branch_board.rs:276–287`：含 `(HEAD detached at ...)` 行也进集合。建议 `--format="%(refname:short)"` 收紧。

### 后端非问题确认
- args 数组执行无 shell 展开；缓存重复计算 upsert 幂等可自愈；branch_state 的 `Option<Option<String>>` 三端语义一致。

## 前端新问题（E1–E20）

### 高

**E1 🔴 编译失败 + 渲染逻辑错 + 测试红：`envCellState` 签名改了一半**
- 定义 `src/lib/platform/branch-board.ts:144–149` 要求 4 参数，但所有调用（branch-board.tsx:805、branch-detail-panel.tsx:527、branch-board.test.ts:79/89/108/112/118）只传 2 个：`envCellState(row, e)`。
- tsc 实测 4 处 `TS2554: Expected 4 arguments, but got 2`；vitest 实测 3 failed（`expected 'unconfigured' to be 'unmerged'`）。运行时 `isConfigured===undefined` 恒走未配置分支，**merged/unmerged 列全错**。
- 另内部用 snake_case 字段（.ts:162–163 `status.merge_via`），TS2551 报错；`envKey` 参数未用。
- 修复：二选一——恢复简洁签名（内部自查 row.envs 判断 configured），或全量改造调用方+测试。

**E2 🔴 编译错误：`GitStatusEntry` 从不存在的路径导入**
- `src/lib/platform/branch-board.ts:1`：`import type { GitStatusEntry } from "@/lib/api"` → TS2459，实际导出在 `@/lib/types`（types.ts:4044）。`canMerge` 入参类型断链。

**E3 任何刷新整板切 loading 占位，弹窗/滚动/布局被打断**
- `branch-board.tsx:190–218, 574–578`：`refresh()` 一律 `setLoading(true)`，触发早退分支卸载整个 `<ResizablePanelGroup>`——滚动位置丢失、打开中的弹窗消失、布局重置。refresh 在 sync/pull/merge/delete 后都会调用。
- 修复：区分 `loading`（首屏）与 `refreshing`（后台，仅 spinner/降透明度）。

**E4 详情面板 detail.row 是快照，刷新后不更新**
- `branch-board.tsx:179–182, 777`：`setDetail({ repo, row })` 存当次引用；refresh 后仍然是旧对象 → 面板显示陈旧的 merged/needsPull/needsPush，合并成功后仍可再点 Merge；删除分支后 detail 残留已删除分支（与 P9 复合）。
- 修复：refresh 后按 `repoId:branch` 从新 matrices 重新解析同步 detail；分支消失则 setDetail(null)。

**E5 diff 加载竞态：切分支后旧 diff 写入新面板**
- `branch-detail-panel.tsx:163–213, 236–257`：行切换重置 effect 清空 diffText 但**未 bump `diffSeq`**；旧 `loadDiff`（seq=1）响应在切换后返回，`seq === diffSeq.current` 仍成立，旧分支 diff 强行写入新面板。
- 修复：切换 effect 中 `diffSeq.current++`。

### 中

**E6 `openFile` 无竞态防护 + 吞错**
- `branch-detail-panel.tsx:279–288`：`const seq = commitSeq.current` 只读不自增；同 commit 连点文件 A、B，A 后到则显示 B 文件名 + A 文本错配。catch 全吞，失败停在空占位无失败反馈。
- 修复：`++commitSeq.current`（或独立 fileDiffSeq）；catch 显示加载失败态。

**E7 `loadMore` 无 seq 防护，跨分支追加脏数据**
- `branch-detail-panel.tsx:215–234`：在途 loadMore 期间切分支，旧请求返回后把旧分支第 2 页 append 到新分支第 1 页后，hasMore 也按旧分支判定。
- 修复：加单调 seq 或 effect 清理 cancelled 标志。

**E8 分页不随数据收缩收敛，整页空白**
- `branch-board.tsx:288–292, 862–884`：`page` 只在筛选变化时重置（303–314），refresh 后行数减少不 clamp → 停留第 3 页而只剩 1 页数据，tbody 空、显示 `3 / 1`。
- 修复：`useEffect(() => { if (page > totalPages) setPage(totalPages) })`。

**E9 statusFilter 在 envFilter="all" 时静默失效**
- `branch-board.tsx:655–676` + `lib/platform/branch-board.ts:104–109`：两个筛选下拉并列独立渲染，但 filterRows 里 status 分支仅在 `env !== "all"` 时执行——用户单独选状态"已合并"列表毫无变化，以为按钮坏了。
- 修复：env=all 时禁用/重置 status 下拉，或改为跨 env 的 any/all 语义。

**E10 onlyUnmerged 对未配置 env 的分支放行（口径不一致）**
- `lib/platform/branch-board.ts:101`：`row.envs.length > 0 &&` 守卫使未配置任何环境的分支在"仅未合并"下仍显示；而 `isFullyMerged`（41–44 行）对空 envs 返回 false。两处口径矛盾。

**E11 硬编码中文绕过 i18n**
- `branch-board.tsx:729`（`加载分支失败：${error}`）、814（`"—（FF）"` 全角内联）、`branch-detail-panel.tsx:532` 同款。10 语言下吐中文。
- 附：i18n key 本身无缺失（en/zh-CN `Platform.task` 151 个 key 已逐一核对无缺口）；问题是硬编码绕过。修复：新增 `task.loadFailed`/`task.mergedFF` key，FF label 抽公共函数（顺带消除 board 与 panel 两份已出现分歧的 label 三元链）。

**E12 拉取遇冲突但 repo 无 folderId 时冲突被静默吞掉**
- `branch-board.tsx:368–397`：`if (res.conflict?.has_conflicts && repo.folderId != null)` —— folderId 为 null 时冲突落到 `await refresh()`，无弹窗无 toast，工作区静默停在冲突态。
- 修复：先判 has_conflicts，兜底 toast.error。

**E13 删除确认按钮无防重，可双击并发**
- `branch-board.tsx:555–572, 1073–1078`：`confirmDelete` 不设 `busy`，双击并发两次 `gitDeleteBranch`；对比 doPull/performMerge/handleSync 都走 `setBusy(true)` 排他。
- 修复：delete 也走 busy 排他，按钮加 disabled。

### 低

**E14 repo 未找到时行点击无反馈**
- `branch-board.tsx:770–786`：`repoById.get(repoId)` 为空时 `onClick={() => repo && ...}` 静默不可点，无 cursor/提示差异。

**E15 隐藏列后 envFilter/statusFilter 仍生效且 UI 脱节**
- `branch-board.tsx:243–249, 295–301`：shownEnvs 只看当前 repoFilter 范围；切仓库后生效的 env 下拉整个消失，用户无法取消导致列表被筛空且看不见原因。
- 修复：`shownEnvs` 不含 envFilter 时自动重置。

**E16 handleSync 总数用过期闭包**
- `branch-board.tsx:341`：`total` 在 `await refresh()` 之后才取 `visibleMatrices.length`，意图含混，应循环前取。

**E17 首屏加载/手动刷新时 spinner 不转**
- `branch-board.tsx:719–721`：`animate-spin` 由 `busy` 驱动，首屏 `loading=true` 时不动，视觉反馈与实际请求不一致。
- 修复：条件改 `(busy || refreshing)`，配合 E3 拆分。

**E18 动态 i18n key 依赖 `as never` 类型逃逸**
- 多处（branch-board.tsx:648–650, 753–755, 848；panel:323, 552, 716）：`t(\`task.env${...}\` as never)` 骗过 next-intl 类型检查，未来漏译不会编译期暴露。

**E19 死代码 / 逻辑重复**
- `branch-board.ts` 的 `unmergedEnvs` 全仓库无调用方（71–73 行）；`CellState.label` 装了 i18n 原始 key 却全链路丢弃，两个组件各自重拼 label 三元链且实现已分歧（P18 同源温床）。

**E20 errorText 与 refresh 内联错误提取重复且口径不一**
- `branch-board.tsx:111–118 vs 204–211`：内联版会 `JSON.stringify(e)`，errorText 返回 `String(e ?? "")`，文案格式两处不同。refresh 应复用 errorText。

## 二轮问题总表

| # | 严重度 | 位置 | 问题 |
|---|--------|------|------|
| F1 | 高 | branch_board.rs:591,613 | 调用不存在的缓存服务函数（编译错误） |
| F2 | 高 | branch_board.rs:594–626 | RepoBranchMatrix 字段与 models 不匹配（编译错误） |
| F3 | 高 | branch_board.rs:454+609 | git 失败吞错 + 空结果进持久缓存 |
| F4 | 高 | branch_board.rs:165+ | git 无超时/kill_on_drop，pull 可无限挂起 |
| F5 | 高 | branch_state_service.rs:52 | check-then-insert 并发撞唯一索引 |
| F6 | 高 | branch_state_service.rs:92–134 | 死代码：ensure_archived/prune 未接线 |
| F7 | 高 | router_platform.rs:72–90 | web 路由无 path 归属校验（任意路径 pull/worktree remove） |
| F8 | 高 | branch_board.rs:686–707 | worktree remove 失败返回 Ok，DB 先软删 |
| F9 | 低 | branch_board.rs:74–96 | worktree 路径 fingerprint 恒定 |
| F10 | 低 | branch_board.rs 多处 | `-` 开头 option injection |
| F11 | 低 | branch_board.rs:718–728 | upsert_branch_state 未校验 repo_id 归属 |
| F12 | 中 | branch_board.rs:476–545 | 矩阵串行 git 子进程，缓存 miss 时极慢 |
| F13 | 低 | branch_board.rs:276–287 | merged_set 裸行解析含 detached 行 |
| E1 | 高 | branch-board.ts:144 等 | envCellState 签名半改（编译失败+渲染错+测试红） |
| E2 | 高 | branch-board.ts:1 | GitStatusEntry 错误导入源（编译错误） |
| E3 | 高 | branch-board.tsx:574 | 刷新整板切 loading，弹窗/滚动被打断 |
| E4 | 高 | branch-board.tsx:179 | detail.row 快照陈旧 |
| E5 | 高 | branch-detail-panel.tsx:163 | diff 竞态没 bump diffSeq |
| E6 | 中 | branch-detail-panel.tsx:279 | openFile 错配+吞错 |
| E7 | 中 | branch-detail-panel.tsx:215 | loadMore 跨分支追加 |
| E8 | 中 | branch-board.tsx:288 | 分页不收敛整页空白 |
| E9 | 中 | branch-board.tsx:655 | statusFilter 单独时静默失效 |
| E10 | 中 | branch-board.ts:101 | onlyUnmerged 口径不一致 |
| E11 | 中 | tsx:729/814, panel:532 | 硬编码中文绕过 i18n |
| E12 | 中 | branch-board.tsx:368 | 无 folderId 时 pull 冲突静默吞 |
| E13 | 中 | branch-board.tsx:1073 | 删除无防重可并发 |
| E14 | 低 | branch-board.tsx:770 | repo 缺失行点击无反馈 |
| E15 | 低 | branch-board.tsx:295 | 隐藏列后筛选仍生效且 UI 脱节 |
| E16 | 低 | branch-board.tsx:341 | handleSync 过期闭包计数 |
| E17 | 低 | branch-board.tsx:719 | spinner 条件与加载态不符 |
| E18 | 低 | 多处 | i18n 动态 key `as never` 逃逸 |
| E19 | 低 | branch-board.ts:71 | unmergedEnvs 死代码 / label 丢弃逻辑重复 |
| E20 | 低 | branch-board.tsx:204 | 错误提取逻辑重复口径不一 |

## 优先修复建议

1. **先修编译（F1/F2/E1/E2）**——当前分支工作区应过不了 `cargo check` 和 `pnpm exec tsc --noEmit`，是半改状态的必现问题，验证命令：`cargo check --features test-utils`、`pnpm exec tsc --noEmit`、`pnpm vitest run src/lib/platform/branch-board.test.ts`。
2. **再修高危运行时**：F3（坏缓存）、F5（并发 upsert）、E3/E4（刷新保 DOM + detail 同步）、E5（diff 竞态）。
3. **安全面**：F7 的 path 归属校验在服务器部署模式上线前必须补。
4. **性能**：F4（超时）、F12（批量/并发）、P6（withFiles:false，一轮遗留）。
