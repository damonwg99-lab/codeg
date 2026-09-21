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

/// Parse `git rev-list --left-right --count A...B` output ("<left>\t<right>").
/// `left` = commits reachable from A only (behind), `right` = from B only (ahead).
pub(crate) fn parse_left_right(stdout: &str) -> Option<(i64, i64)> {
    let mut it = stdout.split_whitespace();
    let left = it.next()?.parse().ok()?;
    let right = it.next()?.parse().ok()?;
    Some((left, right))
}

/// B is merged into env E iff B has no commit E lacks (ahead == 0).
pub(crate) fn is_merged(behind_ahead: (i64, i64)) -> bool {
    behind_ahead.1 == 0
}

/// Effective env branch: repo override wins, else project default.
pub(crate) fn effective_env(repo: Option<&str>, project: Option<&str>) -> Option<String> {
    match (repo, project) {
        (Some(r), _) if !r.trim().is_empty() => Some(r.trim().to_string()),
        (_, Some(p)) if !p.trim().is_empty() => Some(p.trim().to_string()),
        _ => None,
    }
}

/// Extract the ISO timestamp from a `git reflog --date=iso` line whose action is
/// "branch: Created from ...". Returns `None` for other reflog lines.
pub(crate) fn extract_reflog_creation_date(line: &str) -> Option<String> {
    if !line.contains("branch: Created from") {
        return None;
    }
    let start = line.find("HEAD@{")? + "HEAD@{".len();
    let rest = &line[start..];
    let end = rest.find('}')?;
    let date = rest[..end].trim();
    if date.is_empty() {
        None
    } else {
        Some(date.to_string())
    }
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

/// (behind, ahead) of `branch` relative to `env`.
async fn ahead_behind(path: &str, env: &str, branch: &str) -> Result<(i64, i64), AppCommandError> {
    let range = format!("{env}...{branch}");
    let out = git_stdout(path, &["rev-list", "--left-right", "--count", &range]).await?;
    parse_left_right(&out).ok_or_else(|| {
        AppCommandError::external_command("cannot parse rev-list output", out.clone())
    })
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

/// Branch creation date: reflog "Created from" when available, else the earliest
/// commit unique to the branch since its merge-base with `base_ref`.
async fn created_at_info(
    path: &str,
    branch: &str,
    base_ref: Option<&str>,
) -> Result<(Option<String>, Option<String>), AppCommandError> {
    if let Ok(out) = git_output(path, &["reflog", "show", "--date=iso", branch]).await {
        if out.status.success() {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if let Some(date) = extract_reflog_creation_date(line) {
                    return Ok((Some(date), Some("reflog".to_string())));
                }
            }
        }
    }

    if let Some(base) = base_ref {
        if let Ok(mb) = git_stdout(path, &["merge-base", branch, base]).await {
            let mb = mb.trim().to_string();
            if !mb.is_empty() {
                let range = format!("{mb}..{branch}");
                if let Ok(log) = git_stdout(path, &["log", "--reverse", "--format=%cI", &range]).await
                {
                    if let Some(first) = log.lines().next() {
                        return Ok((Some(first.trim().to_string()), Some("first_commit".to_string())));
                    }
                }
            }
        }
    }
    Ok((None, None))
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
        let base_ref = envs.first().map(|(_, n)| n.clone()).or_else(|| repo.branch.clone());

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
                let (behind, ahead) = ahead_behind(&path, env_name, &lb.name)
                    .await
                    .unwrap_or((0, 0));
                let merged = is_merged((behind, ahead));
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

            let (created_at, created_src) = created_at_info(&path, &lb.name, base_ref.as_deref())
                .await
                .unwrap_or((None, None));

            rows.push(BranchRow {
                branch: lb.name,
                created_at,
                created_at_source: created_src,
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
        // Cleanup is best-effort; a leftover registration is pruned below.
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
    fn parse_left_right_reads_counts() {
        assert_eq!(parse_left_right("3\t0\n"), Some((3, 0)));
        assert_eq!(parse_left_right("0 5"), Some((0, 5)));
        assert_eq!(parse_left_right(""), None);
        assert_eq!(parse_left_right("abc"), None);
    }

    #[test]
    fn merged_when_no_unique_commits() {
        assert!(is_merged((0, 0)));
        assert!(is_merged((7, 0)));
        assert!(!is_merged((0, 2)));
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
    fn reflog_creation_date_extracted() {
        let line = "abc1234 HEAD@{2026-09-01 10:00:00 +0800}: branch: Created from main";
        assert_eq!(
            extract_reflog_creation_date(line).as_deref(),
            Some("2026-09-01 10:00:00 +0800")
        );
        assert_eq!(extract_reflog_creation_date("abc1234 HEAD@{x}: commit: msg"), None);
    }

    #[test]
    fn resolve_repo_path_joins_relative() {
        let p = resolve_repo_path("/root", "svc/api");
        assert!(p.ends_with("svc") || p.contains("svc"));
    }
}