use std::collections::HashMap;
use std::path::Path;

use crate::app_error::AppCommandError;
use crate::db::service::{
    platform_branch_state_service, platform_project_repo_service, platform_project_service,
};
use crate::db::AppDatabase;
use crate::models::{BranchRow, BranchStateInfo, EnvMergeStatus, RepoBranchMatrix};

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested)
// ─────────────────────────────────────────────────────────────────────────────

/// Parse a single `%(refname:short)%09%(ahead-behind:<env>)` line into
/// `(branch, ahead, behind)`. The value is "ahead behind".
pub(crate) fn parse_ahead_behind_line(line: &str) -> Option<(String, i64, i64)> {
    let (name, counts) = line.split_once('\t')?;
    let mut it = counts.split_whitespace();
    let ahead: i64 = it.next()?.parse().ok()?;
    let behind: i64 = it.next()?.parse().ok()?;
    Some((name.trim().to_string(), ahead, behind))
}

/// B is merged into env E iff B has no commit E lacks (ahead == 0).
pub(crate) fn is_merged(ahead: i64) -> bool {
    ahead == 0
}

/// Effective env branch: repo override wins, else project default.
pub(crate) fn effective_env(repo: Option<&str>, project: Option<&str>) -> Option<String> {
    match (repo, project) {
        (Some(r), _) if !r.trim().is_empty() => Some(r.trim().to_string()),
        (_, Some(p)) if !p.trim().is_empty() => Some(p.trim().to_string()),
        _ => None,
    }
}

/// Extract the epoch seconds from a reflog line. Reflog file line format is
/// `<old> <new> <name> <email> <ts> <tz>\t<message>`; the timestamp is the
/// second-to-last whitespace token before the tab.
pub(crate) fn parse_reflog_epoch(line: &str) -> Option<i64> {
    let before_tab = line.split('\t').next()?;
    let mut tokens = before_tab.split_whitespace();
    let _tz = tokens.next_back()?; // timezone
    let ts = tokens.next_back()?; // epoch seconds
    ts.parse().ok()
}

/// Resolve a repo's `local_dir` to an absolute path (relative ones hang off the
/// project root dir).
pub(crate) fn resolve_repo_path(root_dir: &str, local_dir: &str) -> String {
    if Path::new(local_dir).is_absolute() {
        local_dir.to_string()
    } else {
        Path::new(root_dir).join(local_dir).to_string_lossy().to_string()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// git process helpers
// ─────────────────────────────────────────────────────────────────────────────

async fn git_output(path: &str, args: &[&str]) -> Result<std::process::Output, AppCommandError> {
    crate::process::tokio_command("git")
        .args(args)
        .current_dir(path)
        .output()
        .await
        .map_err(AppCommandError::io)
}

async fn git_stdout(path: &str, args: &[&str]) -> Result<String, AppCommandError> {
    let out = git_output(path, args).await?;
    if !out.status.success() {
        return Err(AppCommandError::external_command(
            "git command failed",
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

struct LocalBranch {
    name: String,
    tip: String,
    date: String,
}

/// Local branches with tip sha + committer date, via one `for-each-ref`.
async fn list_local_branches(path: &str) -> Result<Vec<LocalBranch>, AppCommandError> {
    let out = git_stdout(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)%09%(committerdate:iso-strict)",
            "refs/heads",
        ],
    )
    .await?;
    let mut rows = Vec::new();
    for line in out.lines() {
        let mut parts = line.split('\t');
        let name = parts.next().unwrap_or("").trim();
        let tip = parts.next().unwrap_or("").trim();
        let date = parts.next().unwrap_or("").trim();
        if !name.is_empty() {
            rows.push(LocalBranch {
                name: name.to_string(),
                tip: tip.to_string(),
                date: date.to_string(),
            });
        }
    }
    Ok(rows)
}

/// Ahead/behind for every local branch relative to `env`, in ONE git call
/// (git >= 2.41 `%(ahead-behind:)`). Returns `branch -> (ahead, behind)`.
async fn env_ahead_behind_map(
    path: &str,
    env: &str,
) -> Result<HashMap<String, (i64, i64)>, AppCommandError> {
    let format = format!("--format=%(refname:short)%09%(ahead-behind:{env})");
    let out = git_stdout(path, &["for-each-ref", &format, "refs/heads"]).await?;
    let mut map = HashMap::new();
    for line in out.lines() {
        if let Some((name, ahead, behind)) = parse_ahead_behind_line(line) {
            map.insert(name, (ahead, behind));
        }
    }
    Ok(map)
}

/// Merge method + date for a merged branch. `merge_via` = "fast_forward" when
/// the earliest ancestry-path commit is the branch tip itself (no merge commit).
async fn merge_info(
    path: &str,
    branch: &str,
    env: &str,
    branch_tip: &str,
) -> Result<(Option<String>, Option<String>), AppCommandError> {
    let range = format!("{branch}..{env}");
    let out = git_stdout(
        path,
        &["log", "--ancestry-path", "--format=%H", "--reverse", &range],
    )
    .await?;
    let first = out.lines().next().map(|s| s.trim().to_string());
    match first {
        Some(sha) if sha == branch_tip => Ok((Some("fast_forward".to_string()), None)),
        Some(sha) => {
            let date = git_stdout(path, &["log", "-1", "--format=%cI", &sha]).await?;
            Ok((Some("merge".to_string()), Some(date.trim().to_string())))
        }
        None => Ok((None, None)),
    }
}

/// Absolute `.git` dir for a repo (one git call per repo).
async fn git_dir(path: &str) -> Option<String> {
    git_stdout(path, &["rev-parse", "--absolute-git-dir"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Branch creation date read straight from the reflog file (no git process):
/// the oldest entry that records `branch: Created from ...`.
fn created_at_from_reflog(git_dir: &str, branch: &str) -> Option<String> {
    let log_path = Path::new(git_dir)
        .join("logs")
        .join("refs")
        .join("heads")
        .join(branch);
    let content = std::fs::read_to_string(log_path).ok()?;
    for line in content.lines() {
        if line.contains("branch: Created from") {
            if let Some(epoch) = parse_reflog_epoch(line) {
                let dt = chrono::DateTime::from_timestamp(epoch, 0)?;
                return Some(dt.to_rfc3339());
            }
        }
    }
    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Core commands
// ─────────────────────────────────────────────────────────────────────────────

pub async fn git_project_branch_matrix_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<Vec<RepoBranchMatrix>, AppCommandError> {
    let conn = &db.conn;
    let project = platform_project_service::get_by_id(conn, project_id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Project not found: {project_id}")))?;
    let repos = platform_project_repo_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)?;

    let mut out = Vec::new();
    for repo in repos {
        let path = resolve_repo_path(&project.root_dir, &repo.local_dir);
        let dev = effective_env(repo.dev_branch.as_deref(), project.dev_branch.as_deref());
        let uat = effective_env(repo.uat_branch.as_deref(), project.uat_branch.as_deref());
        let prd = effective_env(repo.prd_branch.as_deref(), project.prd_branch.as_deref());
        let configured = dev.is_some() || uat.is_some() || prd.is_some();

        let envs: Vec<(String, String)> = [("dev", dev), ("uat", uat), ("prd", prd)]
            .into_iter()
            .filter_map(|(k, v)| v.map(|v| (k.to_string(), v)))
            .collect();

        let locals = match list_local_branches(&path).await {
            Ok(v) => v,
            Err(_) => {
                out.push(RepoBranchMatrix {
                    repo_id: repo.id,
                    repo_name: repo.name,
                    repo_path: path,
                    configured,
                    branches: Vec::new(),
                });
                continue;
            }
        };

        // One git call per env for all branches' ahead/behind.
        let mut env_maps: HashMap<String, HashMap<String, (i64, i64)>> = HashMap::new();
        for (_, env_name) in &envs {
            if let Ok(map) = env_ahead_behind_map(&path, env_name).await {
                env_maps.insert(env_name.clone(), map);
            }
        }
        let git_dir = git_dir(&path).await;

        let mut rows = Vec::new();
        for lb in locals {
            let mut statuses = Vec::new();
            let mut is_env_branch = false;
            for (env_key, env_name) in &envs {
                if &lb.name == env_name {
                    is_env_branch = true;
                    statuses.push(EnvMergeStatus {
                        env: env_key.clone(),
                        merged: true,
                        merge_via: None,
                        merge_date: None,
                        ahead: 0,
                        behind: 0,
                    });
                    continue;
                }
                let (ahead, behind) = env_maps
                    .get(env_name)
                    .and_then(|m| m.get(&lb.name).copied())
                    .unwrap_or((0, 0));
                let merged = is_merged(ahead);
                let (via, date) = if merged {
                    merge_info(&path, &lb.name, env_name, &lb.tip)
                        .await
                        .unwrap_or((None, None))
                } else {
                    (None, None)
                };
                statuses.push(EnvMergeStatus {
                    env: env_key.clone(),
                    merged,
                    merge_via: via,
                    merge_date: date,
                    ahead,
                    behind,
                });
            }

            let created_at = git_dir
                .as_deref()
                .and_then(|gd| created_at_from_reflog(gd, &lb.name));

            rows.push(BranchRow {
                branch: lb.name,
                created_at_source: created_at.as_ref().map(|_| "reflog".to_string()),
                created_at,
                is_env_branch,
                last_commit_at: Some(lb.date).filter(|s| !s.is_empty()),
                envs: statuses,
            });
        }

        out.push(RepoBranchMatrix {
            repo_id: repo.id,
            repo_name: repo.name,
            repo_path: path,
            configured,
            branches: rows,
        });
    }
    Ok(out)
}

pub async fn git_worktree_add_existing_core(
    path: String,
    worktree_path: String,
    branch: String,
) -> Result<(), AppCommandError> {
    crate::work_task::git::worktree_add_existing_branch(&path, &worktree_path, &branch).await
}

pub async fn git_worktree_remove_temp_core(
    path: String,
    worktree_path: String,
) -> Result<(), AppCommandError> {
    let out = git_output(&path, &["worktree", "remove", "--force", &worktree_path]).await?;
    if !out.status.success() {
        tracing::warn!(
            "[branch_board] worktree remove failed for {worktree_path}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let _ = git_output(&path, &["worktree", "prune"]).await;
    Ok(())
}

pub async fn list_branch_states_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<Vec<BranchStateInfo>, AppCommandError> {
    platform_branch_state_service::list_by_project(&db.conn, project_id)
        .await
        .map_err(AppCommandError::from)
}

pub async fn upsert_branch_state_core(
    db: &AppDatabase,
    repo_id: i32,
    branch: String,
    is_archived: Option<bool>,
    description: Option<Option<String>>,
) -> Result<BranchStateInfo, AppCommandError> {
    platform_branch_state_service::upsert(&db.conn, repo_id, &branch, is_archived, description)
        .await
        .map_err(AppCommandError::from)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_project_branch_matrix(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
) -> Result<Vec<RepoBranchMatrix>, AppCommandError> {
    git_project_branch_matrix_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_worktree_add_existing(
    path: String,
    worktree_path: String,
    branch: String,
) -> Result<(), AppCommandError> {
    git_worktree_add_existing_core(path, worktree_path, branch).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_worktree_remove_temp(
    path: String,
    worktree_path: String,
) -> Result<(), AppCommandError> {
    git_worktree_remove_temp_core(path, worktree_path).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_branch_states(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
) -> Result<Vec<BranchStateInfo>, AppCommandError> {
    list_branch_states_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn upsert_branch_state(
    db: tauri::State<'_, AppDatabase>,
    repo_id: i32,
    branch: String,
    is_archived: Option<bool>,
    description: Option<Option<String>>,
) -> Result<BranchStateInfo, AppCommandError> {
    upsert_branch_state_core(&db, repo_id, branch, is_archived, description).await
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ahead_behind_line_reads_counts() {
        assert_eq!(
            parse_ahead_behind_line("feat/a\t3 0"),
            Some(("feat/a".to_string(), 3, 0))
        );
        assert_eq!(
            parse_ahead_behind_line("dev\t0 12"),
            Some(("dev".to_string(), 0, 12))
        );
        assert_eq!(parse_ahead_behind_line("nope"), None);
    }

    #[test]
    fn merged_when_no_ahead() {
        assert!(is_merged(0));
        assert!(!is_merged(2));
    }

    #[test]
    fn effective_env_prefers_repo_then_project() {
        assert_eq!(
            effective_env(Some("release/uat"), Some("uat")).as_deref(),
            Some("release/uat")
        );
        assert_eq!(effective_env(None, Some("uat")).as_deref(), Some("uat"));
        assert_eq!(
            effective_env(Some("  "), Some("uat")).as_deref(),
            Some("uat")
        );
        assert_eq!(effective_env(None, None), None);
    }

    #[test]
    fn parse_reflog_epoch_extracts_timestamp() {
        let line =
            "0000 1111 Alice <a@b.c> 1700000000 +0800\tbranch: Created from main";
        assert_eq!(parse_reflog_epoch(line), Some(1700000000));
        assert_eq!(parse_reflog_epoch("garbage"), None);
    }

    #[test]
    fn resolve_repo_path_joins_relative() {
        let p = resolve_repo_path("/root", "svc/api");
        assert!(p.contains("svc"));
    }
}