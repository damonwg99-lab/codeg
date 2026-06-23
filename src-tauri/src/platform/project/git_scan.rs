use crate::app_error::AppCommandError;
use crate::models::GitRepoScanResult;
use std::path::Path;

/// Directories to skip during recursive scanning — they are either
/// internal git metadata or very large dependency trees that would
/// slow the scan and never contain meaningful git repos.
const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    ".svn",
    ".hg",
    "vendor",       // Go vendor dir — no git repos inside
    "__pycache__",
    ".cache",
    ".venv",
    "venv",
    "dist",
    "build",
    "target",       // Rust/Cargo target dir
    ".next",        // Next.js build output
    ".turbo",       // Turborepo cache
];

/// Maximum recursion depth to prevent runaway scans on deeply nested
/// directory trees. Most real-world git repos sit within 1-5 levels
/// of a project root.
const MAX_DEPTH: u32 = 10;

/// Scan a project root directory for git repositories.
///
/// Recursively walks subdirectories (up to MAX_DEPTH levels), checking
/// each for a `.git/` directory. When a git repo is found, its
/// subdirectories are NOT further scanned (they belong to that repo).
/// Skips well-known heavy directories (node_modules, .git, target, etc.)
/// to keep the scan fast.
///
/// For each found repo, parses the remote URL from `.git/config` and
/// checks for a `CLAUDE.md` file.
pub async fn scan_root_dir(root_dir: &str) -> Result<Vec<GitRepoScanResult>, AppCommandError> {
    let root = Path::new(root_dir);
    if !root.is_dir() {
        return Err(AppCommandError::not_found(format!(
            "Directory does not exist: {root_dir}"
        )));
    }

    let mut results = Vec::new();
    scan_recursive(root, root, 0, &mut results);

    // Sort by local_dir for consistent ordering
    results.sort_by(|a, b| a.local_dir.cmp(&b.local_dir));
    Ok(results)
}

/// Recursive helper: scan `dir` for git repos, descending into
/// subdirectories until a `.git/` is found (then stop — that
/// directory IS the repo, don't scan its children) or MAX_DEPTH
/// is reached.
fn scan_recursive(
    dir: &Path,
    root: &Path,
    depth: u32,
    results: &mut Vec<GitRepoScanResult>,
) {
    if depth > MAX_DEPTH {
        return;
    }

    // First check: is this directory itself a git repo?
    let git_dir = dir.join(".git");
    if git_dir.is_dir() {
        // This IS a git repo — record it and do NOT descend further
        // (subdirectories belong to this repo, not separate ones).
        // Exception: if dir IS the root, we still need to scan children
        // because the root may be a git repo AND also contain other repos.
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let local_dir = dir
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());

        let git_url = parse_git_remote_url(&git_dir);
        let has_claude_md = dir.join("CLAUDE.md").is_file();

        // Only add if this is NOT the root itself (root may be a repo,
        // but we only want to discover nested repos under it).
        // If root IS a repo, we still add it — the user explicitly
        // chose this root_dir as their project root.
        if dir != root {
            results.push(GitRepoScanResult {
                name,
                local_dir,
                git_url,
                has_claude_md,
            });
        }
        // Even if root is a git repo, we still scan its children
        // for nested repos (monorepo pattern).
        // If a non-root dir is a git repo, we do NOT scan its children.
        if dir != root {
            return;
        }
    }

    // Read entries and recurse into subdirectories
    let entries = std::fs::read_dir(dir);
    if entries.is_err() {
        return; // Permission denied or other I/O error — skip silently
    }

    for entry in entries.unwrap() {
        if entry.is_err() {
            continue;
        }
        let path = entry.unwrap().path();

        // Only process directories
        if !path.is_dir() {
            continue;
        }

        // Skip well-known heavy/irrelevant directories
        let dir_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if SKIP_DIRS.contains(&dir_name.as_str()) {
            continue;
        }

        // Recurse into this subdirectory
        scan_recursive(&path, root, depth + 1, results);
    }
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
