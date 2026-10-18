# 分支看板功能全面优化与缺陷修复计划

> **分支**：eature/分支看板与SQL脚本台账_20260920  
> **更新时间**：2026-10-16  
> **范围说明**：SQL 脚本台账暂不在此分支实现，本计划聚焦于**分支看板**与**项目环境分支配置**的缺陷修复、数据一致性、性能提升与交互体验完善。

---

## 一、 问题总览与修复优先级

| 序号 | 问题描述 | 分类 | 影响度 | 涉及模块 |
| :--- | :--- | :--- | :--- | :--- |
| **P1** | 缓存指纹使用随机 Hasher，导致重启后 SQLite 缓存全失效 | 后端核心 | 严重（性能） | ranch_board.rs |
| **P2** | 快进合并（Fast-Forward）算法错误，导致状态与合并日期误判 | 算法逻辑 | 严重（准确性） | ranch_board.rs |
| **P3** | 合并冲突未解决时留下临时工作树，导致后续合并永久死锁 | Git 流程 | 严重（流程中断） | ranch-board.tsx |
| **P4** | 临时工作树在数据库 olders 表残留孤儿记录 | 数据一致性 | 中（脏数据） | ranch_board.rs, ranch-board.tsx |
| **P5** | 环境差异（Diff）采用两点对比，导致他人提交显示为负向删除 | Git 算法 | 严重（功能失真） | olders.rs, ranch-detail-panel.tsx |
| **P6** | 提交历史加载未传 withFiles: false，导致初次加载无效耗时极长 | 性能优化 | 严重（性能） | ranch-detail-panel.tsx |
| **P7** | 合并到环境分支前未校验/拉取远端环境分支状态，推送时报错拒绝 | Git 流程 | 中（协作安全） | ranch-board.tsx |
| **P8** | 详情面板“拉取”按钮过度禁用（未点击同步远端前无法拉取） | 交互控制 | 中（可用性） | ranch-detail-panel.tsx |
| **P9** | 分支删除缺少强制删除（Force Delete）选项，且删除后详情面板残留 | 交互控制 | 中（可用性） | ranch-board.tsx |
| **P10** | 详情面板 Tabs 未受控，切换分支时导致环境差异内容空白 | 状态管理 | 中（展示异常） | ranch-detail-panel.tsx |
| **P11** | 项目详情页缺少代码库独立环境分支配置 UI | 功能缺失 | 中（能力受限） | project-detail.tsx |
| **P12** | 项目详情页只读状态下未展示已配置的环境分支 | 展示缺失 | 低（体验） | project-detail.tsx |
| **P13** | “同步远端” 串行阻塞所有仓库，且缺少私有库凭据重试 | 性能/网络 | 中（效率与体验） | ranch-board.tsx |
| **P14** | 搜索与过滤边界缺陷（未匹配备注/创建人，无环境时“未合并”全空） | 检索逻辑 | 中（体验） | ranch-board.ts |
| **P15** | 工作区页签缺少刷新按钮与点击查看 Diff 交互 | 交互增强 | 低（体验） | ranch-detail-panel.tsx |
| **P16** | 分支创建时间与创建人缺少 irst_commit 兜底实现 | 数据展示 | 低（完整性） | ranch_board.rs |
| **P17** | 备注编辑保存时未进行 .trim() 处理纯空格脏数据 | 数据清洗 | 低（数据质量） | ranch-board.tsx |
| **P18** | 详情面板缺少“已归档”状态指示徽标 | 状态展示 | 低（易用性） | ranch-detail-panel.tsx |

---

## 二、 阶段执行方案

### 阶段一：后端核心与数据正确性（P1, P2, P4, P16）
1. **P1 确定性缓存指纹算法**：
   - 在 src-tauri/src/commands/branch_board.rs 中实现确定性的 FnvHasher 替代 DefaultHasher，确保跨进程启动后相同的 Git 引用状态产生绝对一致的指纹，让 SQLite 缓存稳定生效。
2. **P2 修复 Fast-Forward 与 Merge Date 识别**：
   - 修正 merge_info：通过 git log --merges --ancestry-path --reverse 提取真正的 merge commit。若不存在 merge commit 但已在 merged set 中，则标记为 ast_forward，避免将环境后续提交误判为 merge commit。
3. **P4 临时工作区数据库级清理**：
   - 在 olders.rs 或 ranch_board.rs 中提供清理临时工作树的接口，删除 Git 工作树的同时清理 olders 表记录。
4. **P16 补充首个提交（first_commit）兜底**：
   - 在 reflog 缺失时，通过 git log --reverse --format=%cI%x09%an -1 <branch> 获取分支创建人与创建时间，设置 createdAtSource = "first_commit"。

---

### 阶段二：Git 差异算法与加载性能（P5, P6）
1. **P5 环境差异三点对比（Three-Dot Diff）**：
   - 修改 src-tauri/src/commands/folders.rs 中的 git_diff_with_branch：当存在 ase_branch 时，采用 ormat!("{compare_ref}...{target_branch}")（或计算 merge-base），只呈现该分支自拉出以来自身所修改的内容。
2. **P6 提交历史按需加载优化**：
   - 修改 ranch-detail-panel.tsx，在调用 gitLog 加载提交历史和 loadMore 时，显式传递 withFiles: false，避免后端对每页 50 个 commit 进行耗时的全量文件 diff 计算。

---

### 阶段三：合并生命周期安全与按钮控制（P3, P7, P8, P9, P10, P18）
1. **P3 临时工作树死锁解开与清理**：
   - 在 canMerge 拦截弹窗中增加检测：若脏工作树路径匹配 .codeg-wt- 临时目录，提供“放弃并清理上次未完成合并”的操作按钮。
2. **P7 合并前校验环境分支远端状态**：
   - 在 performMerge 前，检查目标环境分支是否存在未拉取的远端提交（ehind > 0），弹出风险提示并支持快捷拉取。
3. **P8 优化“拉取”按钮启用条件**：
   - 改为 disabled={busy || !row.hasRemote}，只要配置了远端就允许用户主动触发拉取。
4. **P9 分支删除强制确认与面板联动**：
   - 当 gitDeleteBranch 遇到未完全合并错误时，提示“是否强制删除”并支持 orce = true 重试；删除成功后自动关闭右侧详情面板。
5. **P10 详情面板 Tabs 受控**：
   - 将 <Tabs> 设为受控组件；切换分支时自动适配目标分支的环境差异选项，防止内容空白。
6. **P18 详情面板头部归档指示**：
   - 增加已归档分支的明确视觉标识。

---

### 阶段四：项目配置 UI 补全与边缘体验（P11, P12, P13, P14, P15, P17）
1. **P11 代码库独立环境分支配置 UI**：
   - 在 project-detail.tsx 的代码库列表中，为每个代码库增加“配置环境分支”操作入口，支持单库重写 dev/uat/prd 分支。
2. **P12 项目详情页只读态环境分支展示**：
   - 在项目基本信息只读卡片中直观显示 dev/uat/prd 环境分支名称。
3. **P13 “同步远端” 并行化与凭据包装**：
   - 使用 Promise.allSettled 并行 fetch 各代码库，并包装 withCredentialRetry。
4. **P14 搜索与过滤逻辑增强**：
   - 允许搜索分支备注与创建人；修复未配置环境时的“仅未合并”全空问题。
5. **P15 工作区页签增加刷新按钮与文件交互**。
6. **P17 备注保存过滤纯空格**。

---

## 三、 验证与回归测试策略
1. **Rust 单元测试**：针对哈希算法、指纹计算、reflog 解析与合并检测编写或运行单元测试。
2. **前端 Vitest 测试**：针对 ranch-board.test.ts、diff-files.test.ts 更新过滤、状态与 URL 逻辑测试。
3. **集成验证**：验证合并、冲突、撤销、强制删除、多仓库同步的全链路流程。

