# 📚 项目知识库

本目录存放项目知识文档和模板，供 AI 代理在对话中检索和引用。

## 目录结构

| 目录 | 类型 | 说明 | 共享 |
|------|------|------|------|
| `docs/` | tech_doc | 技术文档（架构设计、API 规范、技术方案等） | ✅ |
| `templates/` | template | 模板文档（PRD 模板、代码模板、提示词模板） | ✅ |
| `requirements/` | requirement | 需求文档（产品需求、用户故事、功能规格） | ✅ |
| `.private/ai-intermediate/` | ai_intermediate | AI 中间产物（代理生成的草稿、分析报告等） | ❌ 私有 |
| `.private/tasks/` | task_attachment | 任务附件（截图、日志、数据文件，绑定到特定任务） | ❌ 私有 |
| `.private/personal-notes/` | — | 个人备忘（不对外暴露） | ❌ 私有 |

> **共享文档**不在 `.private/` 下，可被 Scanner 扫描后供所有任务检索引用。
> **私有文档**仅在 `.private/` 下，仅对创建者或特定任务可见。

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
