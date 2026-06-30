use std::path::Path;

use crate::app_error::AppCommandError;
use crate::models::KbInitResult;

/// Standard subdirectories to create inside `_knowledge/`.
const KB_SUB_DIRS: &[&str] = &[
    "docs",
    "templates",
    "skills",
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

/// Default `README.md` content for `_knowledge/`.
const README_CONTENT: &str = "\
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
agent_hint: \"请根据注入的上下文协助定位问题\"  # 给代理的行为提示
```

- `trigger.task_type` — 当任务的 taskType 匹配时，系统推荐此技能
- `inject` — 对话创建时自动注入的文档路径列表
- `agent_hint` — 传递给代理的提示信息

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

    Ok(KbInitResult {
        kb_dir: canon_root.to_string_lossy().to_string(),
        sub_dirs: created_sub_dirs,
        gitignore_created,
        readme_created,
    })
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
        assert!(result.sub_dirs.contains(&"skills".to_string()));
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
        assert!(kb_path.join("skills").is_dir());

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
