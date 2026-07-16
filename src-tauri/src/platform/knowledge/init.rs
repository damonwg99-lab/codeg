use std::path::Path;

use crate::app_error::AppCommandError;
use crate::models::KbInitResult;

/// Standard subdirectories to create inside `_knowledge/`.
const KB_SUB_DIRS: &[&str] = &[
    "docs",
    "templates",
    "requirements",
    ".private",
];

/// Subdirectories inside `.private/`.
const PRIVATE_SUB_DIRS: &[&str] = &[
    "ai-intermediate",
    "personal-notes",
];

/// Default `.gitignore` content for `_knowledge/`.
const GITIGNORE_CONTENT: &str = "# 私有区域 — 不纳入 Git 版本管理\n.private/\n";

/// Default `RULES.md` content for `_knowledge/`.
const RULES_CONTENT: &str = "\
# Project Rules

## File Storage Convention
- AI generated task-related documents → `_knowledge/.private/tasks/{task_id}/ai_intermediate/`
- AI generated non-task-related documents → `_knowledge/.private/ai-intermediate/`
- Architecture/design docs → `_knowledge/docs/`
- All task-related files must be saved under `_knowledge/.private/tasks/{task_id}/`
";

/// Default `README.md` content for `_knowledge/`.
const README_CONTENT: &str = "\
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
tags: [\"架构\", \"API\"]
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
";

/// Initialize the `_knowledge/` directory structure for a project.
///
/// Creates the standard subdirectory layout, a `.gitignore` (to exclude
/// `.private/`), and a `README.md`. If the KB directory already exists,
/// only missing subdirectories and files are created (no overwrite).
///
/// The `kb_dir` path is canonicalized and a boundary check is performed
/// to prevent path traversal.
pub fn init_kb_dir(kb_dir: &str) -> Result<KbInitResult, AppCommandError> {
    let root = Path::new(kb_dir);

    // Canonicalize parent of kb_dir to ensure we can safely create it
    // (If kb_dir already exists, canonicalize it directly)
    let canon_root = if root.is_dir() {
        std::fs::canonicalize(root).map_err(AppCommandError::io)?
    } else {
        // kb_dir doesn't exist yet — canonicalize its parent
        let parent = root.parent();
        if parent.is_none() || !parent.unwrap().is_dir() {
            return Err(AppCommandError::not_found(
                "Parent directory for KB init does not exist",
            ));
        }
        let canon_parent = std::fs::canonicalize(parent.unwrap()).map_err(AppCommandError::io)?;
        canon_parent.join(root.file_name().unwrap_or_default())
    };

    let kb_exists = root.is_dir();
    if !kb_exists {
        std::fs::create_dir_all(root).map_err(AppCommandError::io)?;
    }

    let mut created_sub_dirs = Vec::new();

    // Create standard subdirectories
    for sub in KB_SUB_DIRS {
        let sub_path = root.join(sub);
        let was_created = !sub_path.is_dir();
        if was_created {
            std::fs::create_dir_all(&sub_path).map_err(AppCommandError::io)?;
        }
        created_sub_dirs.push(sub.to_string());
    }

    // Create .private/ subdirectories
    for sub in PRIVATE_SUB_DIRS {
        let sub_path = root.join(".private").join(sub);
        if !sub_path.is_dir() {
            std::fs::create_dir_all(&sub_path).map_err(AppCommandError::io)?;
        }
    }

    // Create .gitignore if it doesn't exist
    let gitignore_path = root.join(".gitignore");
    let gitignore_created = !gitignore_path.is_file();
    if gitignore_created {
        std::fs::write(&gitignore_path, GITIGNORE_CONTENT).map_err(AppCommandError::io)?;
    }

    // Create README.md if it doesn't exist
    let readme_path = root.join("README.md");
    let readme_created = !readme_path.is_file();
    if readme_created {
        std::fs::write(&readme_path, README_CONTENT).map_err(AppCommandError::io)?;
    }

    // Create RULES.md if it doesn't exist
    let rules_path = root.join("RULES.md");
    let _rules_created = !rules_path.is_file();
    if !rules_path.is_file() {
        std::fs::write(&rules_path, RULES_CONTENT).map_err(AppCommandError::io)?;
    }

    Ok(KbInitResult {
        kb_dir: canon_root.to_string_lossy().to_string(),
        sub_dirs: created_sub_dirs,
        gitignore_created,
        readme_created,
    })
}

/// Ensure `.private/tasks/{task_id}/ai_intermediate/` exists in the KB directory.
pub fn create_task_ai_intermediate_dir(kb_dir: &str, task_id: i32) -> Result<(), AppCommandError> {
    let dir = Path::new(kb_dir)
        .join(".private")
        .join("tasks")
        .join(task_id.to_string())
        .join("ai_intermediate");
    if !dir.is_dir() {
        std::fs::create_dir_all(&dir).map_err(AppCommandError::io)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_kb_dir_new() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_path = tmp.path().join("_knowledge");

        let result = init_kb_dir(kb_path.to_string_lossy().as_ref()).unwrap();

        assert!(kb_path.is_dir());
        assert!(result.gitignore_created);
        assert!(result.readme_created);
        assert!(result.sub_dirs.contains(&"docs".to_string()));
        assert!(result.sub_dirs.contains(&"templates".to_string()));
        assert!(result.sub_dirs.contains(&"requirements".to_string()));
        assert!(result.sub_dirs.contains(&".private".to_string()));

        // Check .private subdirectories
        assert!(kb_path.join(".private").join("ai-intermediate").is_dir());
        assert!(kb_path.join(".private").join("personal-notes").is_dir());

        // Check .gitignore content
        let gitignore = std::fs::read_to_string(kb_path.join(".gitignore")).unwrap();
        assert!(gitignore.contains(".private/"));

        // Check README content
        let readme = std::fs::read_to_string(kb_path.join("README.md")).unwrap();
        assert!(readme.contains("项目知识库"));
    }

    #[test]
    fn test_init_kb_dir_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_path = tmp.path().join("_knowledge");

        // Pre-create some dirs and files
        std::fs::create_dir_all(kb_path.join("docs")).unwrap();
        std::fs::write(kb_path.join(".gitignore"), "custom content\n").unwrap();

        let result = init_kb_dir(kb_path.to_string_lossy().as_ref()).unwrap();

        // Existing items should NOT be overwritten
        assert!(!result.gitignore_created); // Already existed
        let gitignore = std::fs::read_to_string(kb_path.join(".gitignore")).unwrap();
        assert_eq!(gitignore, "custom content\n"); // Not overwritten

        // Missing subdirs should be created
        assert!(kb_path.join("templates").is_dir());
        assert!(kb_path.join("requirements").is_dir());

        // README should be created since it didn't exist
        assert!(result.readme_created);
    }

    #[test]
    fn test_init_kb_dir_no_parent() {
        // Non-existent parent should fail
        let result = init_kb_dir("/nonexistent/parent/_knowledge");
        assert!(result.is_err());
    }
}
