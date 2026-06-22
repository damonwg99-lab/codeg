use crate::app_error::AppCommandError;
use crate::models::GitRepoScanResult;
use std::path::Path;

/// Scan a project root directory for git repositories.
///
/// Walks all direct subdirectories of `root_dir`, checks each for a `.git/`
/// directory, tries to parse the remote URL from `.git/config`, and checks
/// for a `CLAUDE.md` file.
pub async fn scan_root_dir(root_dir: &str) -> Result<Vec<GitRepoScanResult>, AppCommandError> {
    let root = Path::new(root_dir);
    if !root.is_dir() {
        return Err(AppCommandError::not_found(format!(
            "Directory does not exist: {root_dir}"
        )));
    }

    let mut results = Vec::new();

    // Read entries in the root directory
    let entries = std::fs::read_dir(root)
        .map_err(|e| AppCommandError::io_error("Failed to read directory").with_detail(e.to_string()))?;

    for entry in entries {
        let entry = entry.map_err(|e| {
            AppCommandError::io_error("Failed to read directory entry").with_detail(e.to_string())
        })?;
        let path = entry.path();

        // Only check directories
        if !path.is_dir() {
            continue;
        }

        // Check if it contains a .git/ directory
        let git_dir = path.join(".git");
        if !git_dir.is_dir() {
            continue;
        }

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Relative path from root_dir
        let local_dir = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());

        // Try to parse git remote URL from .git/config
        let git_url = parse_git_remote_url(&git_dir);

        // Check for CLAUDE.md
        let has_claude_md = path.join("CLAUDE.md").is_file();

        results.push(GitRepoScanResult {
            name,
            local_dir,
            git_url,
            has_claude_md,
        });
    }

    // Sort by name for consistent ordering
    results.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(results)
}

/// Parse the first remote URL from a `.git/config` file.
/// Returns `None` if the file can't be read or no remote is found.
fn parse_git_remote_url(git_dir: &Path) -> Option<String> {
    let config_path = git_dir.join("config");
    let content = std::fs::read_to_string(&config_path).ok()?;

    // Simple line-by-line parse — look for [remote "origin"] section
    let mut in_origin = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[remote \"origin\"]" {
            in_origin = true;
            continue;
        }
        if trimmed.starts_with('[') {
            in_origin = false;
            continue;
        }
        if in_origin && trimmed.starts_with("url = ") {
            return Some(trimmed[6..].to_string());
        }
        // Also handle `url=` (no spaces around =)
        if in_origin && trimmed.starts_with("url=") {
            return Some(trimmed[4..].to_string());
        }
    }
    None
}
