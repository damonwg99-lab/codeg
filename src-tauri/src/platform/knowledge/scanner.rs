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
const SKIP_FILES: &[&str] = &["README.md", ".gitignore", "RULES.md"];

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
    } else if parts.windows(2).any(|w| w[0] == ".private" && w[1] == "tasks") {
        // Files directly under `.private/tasks/{task_id}/` are task
        // attachments (doc_type = "task_attachment"). Files nested under
        // `.private/tasks/{task_id}/ai-intermediate/` are already matched by
        // the `ai-intermediate` branch above.
        "task_attachment".to_string()
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

    let after_first = &content[3..];
    let after_first = after_first.trim_start_matches('\n').trim_start_matches("\r\n");

    let end_idx = match after_first.find("---") {
        Some(idx) => idx,
        None => return (None, None),
    };

    let yaml_str = &after_first[..end_idx];

    let mut tags: Vec<String> = Vec::new();
    let mut description: Option<String> = None;

    let mut in_tags_block = false;
    for line in yaml_str.lines() {
        let trimmed = line.trim();

        if in_tags_block {
            if trimmed.starts_with('-') {
                let tag = trimmed.trim_start_matches('-').trim();
                if !tag.is_empty() {
                    tags.push(tag.to_string());
                }
                continue;
            } else if trimmed.is_empty() {
                continue;
            } else {
                in_tags_block = false;
            }
        }

        if let Some(val) = trimmed.strip_prefix("tags:") {
            let val = val.trim();
            if val.starts_with('[') && val.ends_with(']') {
                let inner = &val[1..val.len() - 1];
                for part in inner.split(',') {
                    let tag = part.trim().trim_matches('\'').trim_matches('"');
                    if !tag.is_empty() {
                        tags.push(tag.to_string());
                    }
                }
            } else if val.is_empty() {
                in_tags_block = true;
            } else {
                tags.push(val.to_string());
            }
        } else if let Some(val) = trimmed.strip_prefix("description:") {
            let val = val.trim().trim_matches('\'').trim_matches('"');
            if !val.is_empty() {
                description = Some(val.to_string());
            }
        }
    }

    let tags_json = if tags.is_empty() {
        None
    } else {
        serde_json::to_string(&tags).ok()
    };

    (tags_json, description)
}

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

/// Discovered KB file entry with file metadata (size, mtime) but without reading body content.
#[derive(Debug, Clone)]
pub struct KbFileEntry {
    pub abs_path: PathBuf,
    pub rel_path: String,
    pub doc_type: String,
    pub is_shared: bool,
    pub skill_name: Option<String>,
    pub file_mtime: Option<i64>,
    pub file_size: Option<i64>,
    pub ext: String,
}

/// Fast directory walker that collects file metadata without reading contents.
pub fn discover_kb_files(kb_dir: &str) -> Result<Vec<KbFileEntry>, AppCommandError> {
    let root = Path::new(kb_dir);
    if !root.is_dir() {
        return Err(AppCommandError::not_found(format!(
            "KB directory does not exist: {kb_dir}"
        )));
    }

    let canon_root = std::fs::canonicalize(root).map_err(AppCommandError::io)?;
    let mut files = Vec::new();
    discover_recursive(&canon_root, &canon_root, 0, &mut files)?;
    Ok(files)
}

fn discover_recursive(
    dir: &Path,
    canon_root: &Path,
    depth: u32,
    results: &mut Vec<KbFileEntry>,
) -> Result<(), AppCommandError> {
    if depth > MAX_DEPTH {
        return Ok(());
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        if file_type.is_dir() {
            let dir_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if SKIP_DIRS.contains(&dir_name.as_str()) {
                continue;
            }
            discover_recursive(&path, canon_root, depth + 1, results)?;
        } else if file_type.is_file() {
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if SKIP_FILES.contains(&file_name.as_str()) {
                continue;
            }

            let rel_path = match path.strip_prefix(canon_root) {
                Ok(p) => p,
                Err(_) => continue,
            };
            let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
            let doc_type = infer_doc_type(rel_path);
            let is_shared = is_shared_file(rel_path);
            let skill_name = skill_name_from_path(rel_path);
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_default();

            let (file_mtime, file_size) = entry.metadata().ok().map(|m| {
                let mtime = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs() as i64);
                let size = m.len() as i64;
                (mtime, Some(size))
            }).unwrap_or((None, None));

            results.push(KbFileEntry {
                abs_path: path,
                rel_path: rel_path_str,
                doc_type,
                is_shared,
                skill_name,
                file_mtime,
                file_size,
                ext,
            });
        }
    }
    Ok(())
}

/// Parse content and frontmatter for a single file entry on demand.
pub fn read_scanned_doc(entry: &KbFileEntry) -> Result<ScannedDoc, AppCommandError> {
    let (title, tags_json, description, file_content) = if MD_EXTENSIONS.contains(&entry.ext.as_str()) {
        let content = std::fs::read_to_string(&entry.abs_path).map_err(AppCommandError::io)?;
        let (fm_tags, fm_desc) = parse_frontmatter(&content);
        let fm_title = extract_frontmatter_title(&content);
        let body = strip_frontmatter(&content);
        (fm_title.unwrap_or_else(|| title_from_filename(&entry.abs_path)), fm_tags, fm_desc, Some(body))
    } else if matches!(entry.ext.as_str(), "txt" | "json" | "yaml" | "yml") {
        let content = std::fs::read_to_string(&entry.abs_path).ok();
        (title_from_filename(&entry.abs_path), None, None, content)
    } else {
        (title_from_filename(&entry.abs_path), None, None, None)
    };

    Ok(ScannedDoc {
        doc_type: entry.doc_type.clone(),
        title,
        file_path: entry.rel_path.clone(),
        is_shared: entry.is_shared,
        tags_json,
        description,
        skill_name: entry.skill_name.clone(),
        content: file_content,
        file_mtime: entry.file_mtime,
        file_size: entry.file_size,
    })
}

/// Scan a knowledge base directory for all documents (compatibility helper).
pub async fn scan_kb_dir(kb_dir: &str) -> Result<Vec<ScannedDoc>, AppCommandError> {
    let entries = discover_kb_files(kb_dir)?;
    let mut docs = Vec::with_capacity(entries.len());
    for entry in &entries {
        match read_scanned_doc(entry) {
            Ok(doc) => docs.push(doc),
            Err(e) => tracing::warn!("[kb-scanner] failed to read doc {}: {}", entry.rel_path, e),
        }
    }
    Ok(docs)
}

/// Extract `title` field from YAML frontmatter if present.
fn extract_frontmatter_title(content: &str) -> Option<String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let after_first = &trimmed[3..];
    let rest = after_first.trim_start_matches('\n').trim_start_matches("\r\n");
    let end_idx = rest.find("---")?;
    let yaml_str = &rest[..end_idx];

    for line in yaml_str.lines() {
        let l = line.trim();
        if let Some(val) = l.strip_prefix("title:") {
            let val = val.trim().trim_matches('\'').trim_matches('"');
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/// Strip YAML frontmatter from Markdown content to get clean body text for FTS indexing.
fn strip_frontmatter(content: &str) -> String {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return content.to_string();
    }
    let after_first = &trimmed[3..];
    let rest = after_first.trim_start_matches('\n').trim_start_matches("\r\n");
    if let Some(end_idx) = rest.find("---") {
        let after_closing = &rest[end_idx + 3..];
        after_closing.trim_start_matches('\n').trim_start_matches("\r\n").to_string()
    } else {
        content.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_infer_doc_type() {
        assert_eq!(infer_doc_type(Path::new("docs/architecture/design.md")), "tech_doc");
        assert_eq!(infer_doc_type(Path::new("skills/generate-prd/template.md")), "skill");
        assert_eq!(infer_doc_type(Path::new("templates/pr.md")), "template");
        assert_eq!(infer_doc_type(Path::new("requirements/auth.md")), "requirement");
        assert_eq!(infer_doc_type(Path::new(".private/ai-intermediate/summary.md")), "ai_intermediate");
        assert_eq!(infer_doc_type(Path::new("unknown/path.md")), "tech_doc");
    }

    #[test]
    fn test_is_shared_file() {
        assert!(is_shared_file(Path::new("docs/architecture/design.md")));
        assert!(!is_shared_file(Path::new(".private/ai-intermediate/summary.md")));
        assert!(!is_shared_file(Path::new(".private/secret.md")));
    }

    #[test]
    fn test_skill_name_from_path() {
        assert_eq!(
            skill_name_from_path(Path::new("skills/generate-prd/template.md")),
            Some("generate-prd".to_string())
        );
        assert_eq!(skill_name_from_path(Path::new("docs/guide.md")), None);
    }

    #[test]
    fn test_parse_frontmatter_inline_array() {
        let content = "---\ntags: [auth, jwt, security]\ndescription: JWT authentication guide\n---\n# Content";
        let (tags, desc) = parse_frontmatter(content);
        assert!(tags.is_some());
        let tags_vec: Vec<String> = serde_json::from_str(&tags.unwrap()).unwrap();
        assert_eq!(tags_vec, vec!["auth", "jwt", "security"]);
        assert_eq!(desc, Some("JWT authentication guide".to_string()));
    }

    #[test]
    fn test_parse_frontmatter_block_list() {
        let content = "---\ntags:\n  - auth\n  - jwt\ndescription: A guide\n---\n# Content";
        let (tags, desc) = parse_frontmatter(content);
        assert!(tags.is_some());
        let tags_vec: Vec<String> = serde_json::from_str(&tags.unwrap()).unwrap();
        assert_eq!(tags_vec, vec!["auth", "jwt"]);
        assert_eq!(desc, Some("A guide".to_string()));
    }

    #[test]
    fn test_parse_frontmatter_missing() {
        let content = "# Just a header\nNo frontmatter here.";
        let (tags, desc) = parse_frontmatter(content);
        assert!(tags.is_none());
        assert!(desc.is_none());
    }

    #[test]
    fn test_ensure_within_root_rejects_outside() {
        let tmp_root = tempfile::tempdir().unwrap();
        let tmp_outside = tempfile::tempdir().unwrap();
        let outside_file = tmp_outside.path().join("secret.txt");
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

        assert!(results.len() >= 2);

        let doc = results.iter().find(|d| d.doc_type == "tech_doc").unwrap();
        assert_eq!(doc.title, "product-arch");
        assert!(doc.is_shared);
        assert!(doc.tags_json.is_some());
        assert!(doc.description.is_some());

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
