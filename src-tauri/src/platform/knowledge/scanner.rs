use std::path::{Path, PathBuf};

use crate::app_error::AppCommandError;
use crate::models::ScannedDoc;

/// Directories to skip during KB scanning — internal metadata or large
/// dependency trees that never contain meaningful knowledge docs.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    ".svn",
    ".hg",
    "vendor",
    "__pycache__",
    ".cache",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
];

/// Files to skip during KB scanning — project-level metadata or VCS
/// configuration that should not appear as knowledge docs.
const SKIP_FILES: &[&str] = &["README.md", ".gitignore"];

/// Maximum recursion depth for KB scanning.
const MAX_DEPTH: u32 = 10;

/// Extensions considered as Markdown files for frontmatter parsing.
const MD_EXTENSIONS: &[&str] = &["md", "markdown"];

/// Map a relative subdirectory path to a doc_type string.
/// Convention: docs/ → tech_doc, templates/ → template, skills/ → skill,
/// requirements/ → requirement, .private/ai-intermediate/ → ai_intermediate.
fn infer_doc_type(rel_path: &Path) -> String {
    let parts: Vec<String> = rel_path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if parts.iter().any(|p| p == "skills") {
        "skill".to_string()
    } else if parts.iter().any(|p| p == "templates") {
        "template".to_string()
    } else if parts.iter().any(|p| p == "requirements") {
        "requirement".to_string()
    } else if parts.iter().any(|p| p == "ai-intermediate") {
        "ai_intermediate".to_string()
    } else {
        "tech_doc".to_string()
    }
}

/// Check whether a file lives under `.private/` (not git-tracked → is_shared = false).
fn is_shared_file(rel_path: &Path) -> bool {
    !rel_path
        .components()
        .any(|c| c.as_os_str().to_string_lossy() == ".private")
}

/// Extract the skill name from a relative path under `skills/`.
/// E.g. `skills/generate-prd/template.md` → "generate-prd"
fn skill_name_from_path(rel_path: &Path) -> Option<String> {
    let parts: Vec<String> = rel_path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if let Some(idx) = parts.iter().position(|p| p == "skills") {
        if idx + 1 < parts.len() {
            Some(parts[idx + 1].clone())
        } else {
            None
        }
    } else {
        None
    }
}

/// Derive a title from a filename: strip extension, replace hyphens/underscores.
fn title_from_filename(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "untitled".to_string())
}

/// Parse YAML frontmatter from a Markdown file.
/// Returns (tags_json, description) if frontmatter is present.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let content = content.trim_start();
    if !content.starts_with("---") {
        return (None, None);
    }

    // Find the closing ---
    let after_first = &content[3..];
    let rest = after_first.trim_start_matches('\n');
    let Some(end_idx) = rest.find("---") else {
        return (None, None);
    };

    let yaml_block = &rest[..end_idx];

    // Minimal YAML parsing: extract tags and description.
    let mut tags: Option<Vec<String>> = None;
    let mut description: Option<String> = None;

    for line in yaml_block.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("tags:") {
            let value = stripped.trim();
            // Handle [tag1, tag2] format
            if value.starts_with('[') && value.ends_with(']') {
                let inner = &value[1..value.len() - 1];
                tags = Some(
                    inner
                        .split(',')
                        .map(|t| t.trim().trim_matches('"').trim_matches('\'').to_string())
                        .filter(|t| !t.is_empty())
                        .collect(),
                );
            } else {
                // Single tag or empty
                let v = value.trim_matches('"').trim_matches('\'');
                if !v.is_empty() {
                    tags = Some(vec![v.to_string()]);
                }
            }
        } else if let Some(stripped) = trimmed.strip_prefix("description:") {
            let value = stripped.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                description = Some(value.to_string());
            }
        }
    }

    let tags_json = tags.map(|t| serde_json::to_string(&t).unwrap_or_else(|_| "[]".to_string()));
    (tags_json, description)
}

/// Ensure `path` stays within `root` after canonicalization (path traversal guard).
/// Returns the canonicalized path if it is within root, or an error.
#[allow(dead_code)]
fn ensure_within_root(path: &Path, root: &Path) -> Result<PathBuf, AppCommandError> {
    let canon_path = std::fs::canonicalize(path).map_err(AppCommandError::io)?;
    let canon_root = std::fs::canonicalize(root).map_err(AppCommandError::io)?;
    if !canon_path.starts_with(&canon_root) {
        return Err(AppCommandError::permission_denied(
            "Path traversal detected: file resolves outside KB root",
        ));
    }
    Ok(canon_path)
}

/// Scan a knowledge base directory for documents.
///
/// Walks the KB root directory recursively (up to MAX_DEPTH levels),
/// infers doc_type from the directory structure, parses YAML frontmatter
/// from Markdown files, and returns a list of `ScannedDoc` entries ready
/// for upsert into the `platform_knowledge_doc` table.
///
/// Files outside the KB root (after canonicalization) are rejected to
/// prevent path traversal. Symbolic links are NOT followed.
pub async fn scan_kb_dir(kb_dir: &str) -> Result<Vec<ScannedDoc>, AppCommandError> {
    let root = Path::new(kb_dir);
    if !root.is_dir() {
        return Err(AppCommandError::not_found(format!(
            "KB directory does not exist: {kb_dir}"
        )));
    }

    let mut docs = Vec::new();
    scan_recursive(root, root, 0, &mut docs)?;
    Ok(docs)
}

/// Recursive helper that walks `dir` for knowledge docs.
/// Uses `canonicalize` + boundary check instead of `follow_links`.
fn scan_recursive(
    dir: &Path,
    root: &Path,
    depth: u32,
    results: &mut Vec<ScannedDoc>,
) -> Result<(), AppCommandError> {
    if depth > MAX_DEPTH {
        return Ok(());
    }

    // Boundary check: canonicalize dir and ensure it's within root
    let canon_dir = std::fs::canonicalize(dir).map_err(AppCommandError::io)?;
    let canon_root = std::fs::canonicalize(root).map_err(AppCommandError::io)?;
    if !canon_dir.starts_with(&canon_root) {
        return Err(AppCommandError::permission_denied(
            "Path traversal: directory resolves outside KB root",
        ));
    }

    let entries = std::fs::read_dir(&canon_dir);
    if entries.is_err() {
        return Ok(()); // Permission denied — skip silently
    }

    for entry in entries.unwrap() {
        let entry = entry.map_err(AppCommandError::io)?;
        let path = entry.path();

        // Skip symlinks — do NOT follow links
        if path.is_symlink() {
            continue;
        }

        if path.is_dir() {
            let dir_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Skip well-known heavy/irrelevant directories
            if SKIP_DIRS.contains(&dir_name.as_str()) {
                continue;
            }

            // Boundary check for subdirectory
            let canon_sub = std::fs::canonicalize(&path);
            if canon_sub.is_err() {
                continue; // Broken symlink or permission issue — skip
            }
            if !canon_sub.unwrap().starts_with(&canon_root) {
                continue; // Path traversal — skip
            }

            scan_recursive(&path, root, depth + 1, results)?;
        } else if path.is_file() {
            // Skip well-known project-level metadata files
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if SKIP_FILES.contains(&file_name.as_str()) {
                continue;
            }

            // Process file: compute relative path from root
            let rel_path = path.strip_prefix(&canon_root).map_err(|_| {
                AppCommandError::permission_denied("File path cannot be resolved relative to KB root")
            })?;

            let rel_path_str = rel_path.to_string_lossy().to_string();

            // Determine doc type
            let doc_type = infer_doc_type(rel_path);

            // Determine is_shared
            let is_shared = is_shared_file(rel_path);

            // Determine skill_name
            let skill_name = skill_name_from_path(rel_path);

            // Determine title and parse frontmatter for Markdown files
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();

            let (title, tags_json, description) = if MD_EXTENSIONS.contains(&ext.as_str()) {
                // Parse frontmatter
                let content = std::fs::read_to_string(&path).map_err(AppCommandError::io)?;
                let (fm_tags, fm_desc) = parse_frontmatter(&content);
                // Title: prefer frontmatter title if present, else use filename
                let fm_title = extract_frontmatter_title(&content);
                (fm_title.unwrap_or_else(|| title_from_filename(&path)), fm_tags, fm_desc)
            } else {
                (title_from_filename(&path), None, None)
            };

            results.push(ScannedDoc {
                doc_type,
                title,
                file_path: rel_path_str,
                is_shared,
                tags_json,
                description,
                skill_name,
            });
        }
    }

    Ok(())
}

/// Extract `title` field from YAML frontmatter if present.
fn extract_frontmatter_title(content: &str) -> Option<String> {
    let content = content.trim_start();
    if !content.starts_with("---") {
        return None;
    }
    let after_first = &content[3..];
    let rest = after_first.trim_start_matches('\n');
    let end_idx = rest.find("---")?;
    let yaml_block = &rest[..end_idx];

    for line in yaml_block.lines() {
        let trimmed = line.trim();
        if let Some(stripped) = trimmed.strip_prefix("title:") {
            let value = stripped.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_doc_type() {
        assert_eq!(
            infer_doc_type(Path::new("docs/architecture/product-arch.md")),
            "tech_doc"
        );
        assert_eq!(
            infer_doc_type(Path::new("skills/generate-prd/skill.yaml")),
            "skill"
        );
        assert_eq!(
            infer_doc_type(Path::new("templates/prd-template.md")),
            "template"
        );
        assert_eq!(
            infer_doc_type(Path::new("requirements/client-a.md")),
            "requirement"
        );
        assert_eq!(
            infer_doc_type(Path::new(".private/ai-intermediate/prd-draft.md")),
            "ai_intermediate"
        );
    }

    #[test]
    fn test_is_shared_file() {
        assert!(is_shared_file(Path::new("docs/architecture/product-arch.md")));
        assert!(is_shared_file(Path::new("skills/generate-prd/skill.yaml")));
        assert!(!is_shared_file(Path::new(".private/ai-intermediate/prd-draft.md")));
        assert!(!is_shared_file(Path::new(".private/personal-notes/debug.md")));
    }

    #[test]
    fn test_skill_name_from_path() {
        assert_eq!(
            skill_name_from_path(Path::new("skills/generate-prd/template.md")),
            Some("generate-prd".to_string())
        );
        assert_eq!(
            skill_name_from_path(Path::new("skills/code-review/skill.yaml")),
            Some("code-review".to_string())
        );
        assert_eq!(
            skill_name_from_path(Path::new("docs/architecture/product-arch.md")),
            None
        );
    }

    #[test]
    fn test_title_from_filename() {
        assert_eq!(
            title_from_filename(Path::new("product-arch.md")),
            "product-arch"
        );
        assert_eq!(
            title_from_filename(Path::new("skill.yaml")),
            "skill"
        );
    }

    #[test]
    fn test_parse_frontmatter_tags_and_description() {
        let content = "---\ntags: [order, api, core]\ndescription: 订单服务API文档\n---\n\n# Content";
        let (tags, desc) = parse_frontmatter(content);
        assert!(tags.is_some());
        assert!(desc.is_some());
        let tags_val: Vec<String> = serde_json::from_str(&tags.unwrap()).unwrap();
        assert_eq!(tags_val, vec!["order", "api", "core"]);
        assert_eq!(desc.unwrap(), "订单服务API文档");
    }

    #[test]
    fn test_parse_frontmatter_single_tag() {
        let content = "---\ntags: \"single\"\n---\n\nContent";
        let (tags, _desc) = parse_frontmatter(content);
        assert!(tags.is_some());
        let tags_val: Vec<String> = serde_json::from_str(&tags.unwrap()).unwrap();
        assert_eq!(tags_val, vec!["single"]);
    }

    #[test]
    fn test_parse_frontmatter_no_frontmatter() {
        let content = "# Just a regular markdown file\nNo frontmatter here.";
        let (tags, desc) = parse_frontmatter(content);
        assert!(tags.is_none());
        assert!(desc.is_none());
    }

    #[test]
    fn test_extract_frontmatter_title() {
        let content = "---\ntitle: \"My Title\"\ntags: [a, b]\n---\n\n# Content";
        assert_eq!(extract_frontmatter_title(content), Some("My Title".to_string()));
    }

    #[test]
    fn test_extract_frontmatter_title_absent() {
        let content = "---\ntags: [a]\n---\n\n# Content";
        assert!(extract_frontmatter_title(content).is_none());
    }

    #[test]
    fn test_ensure_within_root_valid() {
        // Create temp dirs for testing
        let tmp_root = tempfile::tempdir().unwrap();
        let tmp_file = tmp_root.path().join("subdir").join("file.md");
        std::fs::create_dir_all(tmp_file.parent().unwrap()).unwrap();
        std::fs::write(&tmp_file, "test").unwrap();

        let result = ensure_within_root(&tmp_file, tmp_root.path());
        assert!(result.is_ok());
    }

    #[test]
    fn test_ensure_within_root_traversal() {
        let tmp_root = tempfile::tempdir().unwrap();
        let tmp_outside = tempfile::tempdir().unwrap();

        // A path pointing outside root should fail
        let outside_file = tmp_outside.path().join("evil.md");
        std::fs::write(&outside_file, "evil").unwrap();

        let result = ensure_within_root(&outside_file, tmp_root.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_scan_empty_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let results = rt.block_on(scan_kb_dir(tmp.path().to_string_lossy().as_ref())).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_scan_with_files() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_dir = tmp.path();

        // Create test structure
        let docs_dir = kb_dir.join("docs").join("architecture");
        std::fs::create_dir_all(&docs_dir).unwrap();
        std::fs::write(
            docs_dir.join("product-arch.md"),
            "---\ntags: [arch, core]\ndescription: Product architecture\n---\n\n# Architecture",
        )
        .unwrap();

        let skills_dir = kb_dir.join("skills").join("generate-prd");
        std::fs::create_dir_all(&skills_dir).unwrap();
        std::fs::write(skills_dir.join("template.md"), "# Template content").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let results = rt.block_on(scan_kb_dir(kb_dir.to_string_lossy().as_ref())).unwrap();

        // Should find at least 2 files
        assert!(results.len() >= 2);

        // Check docs file
        let doc = results.iter().find(|d| d.doc_type == "tech_doc").unwrap();
        assert_eq!(doc.title, "product-arch");
        assert!(doc.is_shared);
        assert!(doc.tags_json.is_some());
        assert!(doc.description.is_some());

        // Check skills file
        let skill_doc = results.iter().find(|d| d.doc_type == "skill").unwrap();
        assert_eq!(skill_doc.skill_name, Some("generate-prd".to_string()));
        assert!(skill_doc.is_shared);
    }

    #[test]
    fn test_scan_private_files() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_dir = tmp.path();

        let private_dir = kb_dir.join(".private").join("ai-intermediate");
        std::fs::create_dir_all(&private_dir).unwrap();
        std::fs::write(private_dir.join("draft.md"), "# Draft").unwrap();

        let rt = tokio::runtime::Runtime::new().unwrap();
        let results = rt.block_on(scan_kb_dir(kb_dir.to_string_lossy().as_ref())).unwrap();

        let doc = results.iter().find(|d| !d.is_shared).unwrap();
        assert!(!doc.is_shared);
        assert_eq!(doc.doc_type, "ai_intermediate");
    }
}
