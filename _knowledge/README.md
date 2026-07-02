# 📚 项目知识库

本目录存放项目知识文档、模板和技能定义，供 AI 代理在对话中检索和引用。

## 目录结构

| 目录 | 类型 | 说明 | 共享 |
|------|------|------|------|
| `docs/` | tech_doc | 技术文档（架构设计、API 规范、技术方案等） | ✅ |
| `templates/` | template | 模板文档（PRD 模板、代码模板、提示词模板） | ✅ |
| `skills/` | skill | AI 技能定义（每个技能是一个子目录，含 `skill.yaml`） | ✅ |
| `requirements/` | requirement | 需求文档（产品需求、用户故事、功能规格） | ✅ |
| `.private/ai-intermediate/` | ai_intermediate | AI 中间产物（代理生成的草稿、分析报告等） | ❌ 私有 |
| `.private/tasks/` | task_attachment | 任务附件（截图、日志、数据文件，绑定到特定任务） | ❌ 私有 |
| `.private/personal-notes/` | — | 个人备忘（不对外暴露） | ❌ 私有 |

> **共享文档**不在 `.private/` 下，可被 Scanner 扫描后供所有任务检索引用。
> **私有文档**仅在 `.private/` 下，仅对创建者或特定任务可见。

## 技能定义格式

每个技能是 `skills/` 下的一个**子目录**，核心文件为 `skill.yaml`：

```
skills/
  debug-assist/
    skill.yaml        ← 技能元数据
    debug-steps.md    ← 技能引用的文档（可选）
```

`skill.yaml` 示例：

```yaml
name: debug-assist                       # 技能名称（省略则用目录名）
description: 辅助调试，注入调试上下文       # 技能描述
trigger:
  task_type: bug                          # 触发条件：任务类型为 bug 时推荐此技能
inject:                                   # 注入列表：创建对话时自动注入这些文档
  - docs/architecture/product-arch.md
  - templates/prd-template.md
agent_hint: "请根据注入的上下文协助定位问题"  # 给代理的行为提示
```

- `trigger.task_type` — 当任务的 taskType 匹配时，系统推荐此技能
- `inject` — 对话创建时自动注入的文档路径列表
- `agent_hint` — 传递给代理的提示信息

## 文档元数据

Scanner 解析 `.md` 文件时支持 YAML frontmatter：

```markdown
---
tags: ["架构", "API"]
description: 产品架构总览文档
---
# 产品架构

...
```

- `tags` — 文档标签数组，用于搜索过滤
- `description` — 文档简短描述

## 使用方式

1. 将文档放入对应目录（如技术文档放入 `docs/`）
2. 在 Codeg 知识库页面点击 **刷新索引**，Scanner 会扫描所有文件并建立索引
3. 创建对话时，系统根据任务类型推荐匹配的技能，自动注入相关文档
4. 也可手动搜索 KB 文档并注入到对话上下文中
