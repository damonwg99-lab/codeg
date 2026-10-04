use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use futures::stream::{self, StreamExt};
use sea_orm::DatabaseConnection;

use crate::app_error::AppCommandError;
use crate::db::service::{
    platform_branch_matrix_cache_service as cache_service,
    platform_branch_state_service, platform_project_repo_service, platform_project_service,
};
use crate::db::AppDatabase;
use crate::models::{BranchRow, BranchStateInfo, EnvMergeStatus, RepoBranchMatrix};

/// Max repos processed concurrently (each spawns a few git processes).
const REPO_CONCURRENCY: usize = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested)
// ─────────────────────────────────────────────────────────────────────────────

/// Parse `git rev-list --left-right --count A...B` output ("<left>\t<right>").
/// left = reachable from A only, right = from B only.
pub(crate) fn parse_left_right(stdout: &str) -> Option<(i64, i64)> {
    let mut it = stdout.split_whitespace();
    let left = it.next()?.parse().ok()?;
    let right = it.next()?.parse().ok()?;
    Some((left, right))
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

/// Locate the repo's `.git` directory WITHOUT spawning git: a plain dir, or the
/// path recorded in a `.git` file (worktrees / submodules).
fn git_dir_no_spawn(repo_path: &str) -> Option<PathBuf> {
    let dot = Path::new(repo_path).join(".git");
    if dot.is_dir() {
        return Some(dot);
    }
    if dot.is_file() {
        let content = std::fs::read_to_string(&dot).ok()?;
        for line in content.lines() {
            if let Some(rest) = line.strip_prefix("gitdir:") {
                let p = rest.trim();
                let abs = if Path::new(p).is_absolute() {
                    PathBuf::from(p)
                } else {
                    Path::new(repo_path).join(p)
                };
                if abs.is_dir() {
                    return Some(abs);
                }
            }
        }
    }
    None
}

fn push_entry(p: &Path, out: &mut Vec<String>) {
    if let Ok(md) = std::fs::metadata(p) {
        let mtime = md
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        out.push(format!("{}:{}:{}", p.to_string_lossy(), mtime, md.len()));
    }
}

/// Cheap signature of a repo's ref state (file metadata only, no git process).
/// Any branch add/delete/move changes the underlying ref files, hence the hash.
/// `None` when the repo has no local `.git` (not a repo / missing).
fn ref_fingerprint(repo_path: &str) -> Option<String> {
    let git_dir = git_dir_no_spawn(repo_path)?;
    let mut entries: Vec<String> = Vec::new();
    push_entry(&git_dir.join("packed-refs"), &mut entries);
    push_entry(&git_dir.join("HEAD"), &mut entries);
    let mut stack = vec![git_dir.join("refs")];
    while let Some(dir) = stack.pop() {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    push_entry(&p, &mut entries);
                }
            }
        }
    }
    entries.sort();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    entries.hash(&mut hasher);
    Some(format!("{:016x}", hasher.finish()))
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
    upstream: Option<String>,
    trackshort: String,
}

/// Local branches with tip sha + committer date + upstream tracking, via one
/// `for-each-ref`.
async fn list_local_branches(path: &str) -> Result<Vec<LocalBranch>, AppCommandError> {
    let out = git_stdout(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)%09%(committerdate:iso-strict)%09%(upstream:short)%09%(upstream:trackshort)",
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
        let upstream = parts.next().unwrap_or("").trim();
        let trackshort = parts.next().unwrap_or("").trim();
        if !name.is_empty() {
            rows.push(LocalBranch {
                name: name.to_string(),
                tip: tip.to_string(),
                date: date.to_string(),
                upstream: if upstream.is_empty() {
                    None
                } else {
                    Some(upstream.to_string())
                },
                trackshort: trackshort.to_string(),
            });
        }
    }
    Ok(rows)
}

/// Names of remote branches under `origin/` (without the prefix), excluding
/// `origin/HEAD`.
async fn remote_branches(path: &str) -> HashSet<String> {
    let out = git_stdout(
        path,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"],
    )
    .await;
    match out {
        Ok(s) => s
            .lines()
            .filter_map(|l| l.trim().strip_prefix("origin/"))
            .filter(|n| !n.is_empty() && *n != "HEAD")
            .map(|n| n.to_string())
            .collect(),
        Err(_) => HashSet::new(),
    }
}

/// Set of local branches already merged into `env`, in ONE git call
/// (`for-each-ref --merged=<env>`). Empty on error (e.g. env branch missing).
async fn merged_set(path: &str, env: &str) -> HashSet<String> {
    let merged_arg = format!("--merged={env}");
    let out = git_stdout(
        path,
        &["for-each-ref", "--format=%(refname:short)", &merged_arg, "refs/heads"],
    )
    .await;
    match out {
        Ok(s) => s
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        Err(_) => HashSet::new(),
    }
}

/// Whether a ref resolves to a commit locally.
async fn git_ref_exists(path: &str, ref_name: &str) -> bool {
    git_output(path, &["rev-parse", "--verify", "--quiet", ref_name])
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Ref to compare/merge against for an env: the local branch when it exists,
/// else the `origin/<env>` remote-tracking branch (the common case right after
/// a clone, where the env branch only exists on the remote). Falls back to the
/// bare name so behaviour is unchanged when neither exists.
async fn resolve_env_ref(path: &str, env: &str) -> String {
    if git_ref_exists(path, &format!("refs/heads/{env}")).await {
        return env.to_string();
    }
    let remote = format!("origin/{env}");
    if git_ref_exists(path, &remote).await {
        return remote;
    }
    env.to_string()
}

/// Branch checked out in the repo's main worktree (None when detached).
async fn current_branch(path: &str) -> Option<String> {
    let out = git_output(path, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Merge method + date for a merged branch, in ONE git call: the earliest
/// ancestry-path commit between branch and env. Fast-forward when that commit
/// is the branch tip itself (no merge commit, so no date).
async fn merge_info(
    path: &str,
    branch: &str,
    env: &str,
    branch_tip: &str,
) -> (Option<String>, Option<String>) {
    let range = format!("{branch}..{env}");
    let out = match git_stdout(
        path,
        &["log", "--ancestry-path", "--reverse", "--format=%cI%x09%H", &range],
    )
    .await
    {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    let Some(line) = out.lines().next() else {
        return (None, None);
    };
    let mut parts = line.splitn(2, '\t');
    let date = parts.next().unwrap_or("").trim().to_string();
    let sha = parts.next().unwrap_or("").trim();
    if sha == branch_tip {
        return (Some("fast_forward".to_string()), None);
    }
    if date.is_empty() {
        (None, None)
    } else {
        (Some("merge".to_string()), Some(date))
    }
}

/// Branch creation date + creator read straight from the reflog file (no git
/// process). Returns `(created_at_rfc3339, created_by)`.
fn created_at_from_reflog(git_dir: &Path, branch: &str) -> Option<(String, Option<String>)> {
    let log_path = git_dir.join("logs").join("refs").join("heads").join(branch);
    let content = std::fs::read_to_string(log_path).ok()?;
    for line in content.lines() {
        if line.contains("branch: Created from") {
            let epoch = parse_reflog_epoch(line)?;
            let dt = chrono::DateTime::from_timestamp(epoch, 0)?;
            return Some((dt.to_rfc3339(), parse_reflog_created_by(line)));
        }
    }
    None
}

/// Extract the creator NAME (without email) from a reflog creation line.
pub(crate) fn parse_reflog_created_by(line: &str) -> Option<String> {
    if !line.contains("branch: Created from") {
        return None;
    }
    let before_tab = line.split('\t').next()?;
    let tokens: Vec<&str> = before_tab.split_whitespace().collect();
    // tokens: [old, new, name..., <email>, ts, tz]
    if tokens.len() < 6 {
        return None;
    }
    let name = tokens[2..tokens.len() - 3].join(" ");
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

async fn compute_repo_matrix(repo_path: &str, envs: &[(String, String)]) -> Vec<BranchRow> {
    let locals = match list_local_branches(repo_path).await {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    // Resolve each env to a ref that exists locally (local branch, else the
    // origin remote-tracking branch), then one git call per env for its merged
    // set.
    let mut env_refs: Vec<(String, String, String)> = Vec::new();
    for (env_key, env_name) in envs {
        let resolved = resolve_env_ref(repo_path, env_name).await;
        env_refs.push((env_key.clone(), env_name.clone(), resolved));
    }
    let mut merged: HashMap<String, HashSet<String>> = HashMap::new();
    for (env_key, _name, resolved) in &env_refs {
        merged.insert(env_key.clone(), merged_set(repo_path, resolved).await);
    }
    let git_dir = git_dir_no_spawn(repo_path);
    let remotes = remote_branches(repo_path).await;
    let current = current_branch(repo_path).await;

    let mut rows = Vec::new();
    for lb in locals {
        let mut statuses = Vec::new();
        let mut is_env_branch = false;
        for (env_key, env_name, resolved) in &env_refs {
            if lb.name == *env_name {
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
            let is_merged = merged
                .get(env_key)
                .map(|s| s.contains(&lb.name))
                .unwrap_or(false);
            let (via, date) = if is_merged {
                merge_info(repo_path, &lb.name, resolved, &lb.tip).await
            } else {
                (None, None)
            };
            statuses.push(EnvMergeStatus {
                env: env_key.clone(),
                merged: is_merged,
                merge_via: via,
                merge_date: date,
                ahead: 0,
                behind: 0,
            });
        }

        let created = git_dir
            .as_deref()
            .and_then(|gd| created_at_from_reflog(gd, &lb.name));
        let (created_at, created_by) = match created {
            Some((d, b)) => (Some(d), b),
            None => (None, None),
        };

        let has_remote = lb.upstream.is_some() || remotes.contains(&lb.name);
        let (needs_push, needs_pull) = if lb.upstream.is_some() {
            (lb.trackshort.contains('>'), lb.trackshort.contains('<'))
        } else if remotes.contains(&lb.name) {
            let range = format!("origin/{}...{}", lb.name, lb.name);
            match git_stdout(
                repo_path,
                &["rev-list", "--left-right", "--count", &range],
            )
            .await
            {
                Ok(s) => match parse_left_right(&s) {
                    Some((behind, ahead)) => (ahead > 0, behind > 0),
                    None => (false, false),
                },
                Err(_) => (false, false),
            }
        } else {
            (false, false)
        };

        let is_current = current.as_deref() == Some(lb.name.as_str());
        rows.push(BranchRow {
            branch: lb.name,
            created_at_source: created_at.as_ref().map(|_| "reflog".to_string()),
            created_at,
            is_env_branch,
            is_current,
            last_commit_at: Some(lb.date).filter(|s| !s.is_empty()),
            created_by,
            upstream: lb.upstream,
            has_remote,
            needs_push,
            needs_pull,
            envs: statuses,
        });
    }
    rows
}

async fn compute_repo_cached(
    conn: &DatabaseConnection,
    repo_id: i32,
    repo_name: &str,
    repo_path: String,
    envs: Vec<(String, String)>,
    configured: bool,
    force: bool,
) -> RepoBranchMatrix {
    let fingerprint = ref_fingerprint(&repo_path);

    if !force {
        if let Some(fp) = fingerprint.as_deref() {
            if let Ok(Some((cached_fp, json))) = cache_service::get(conn, repo_id).await {
                if cached_fp == fp {
                    if let Ok(matrix) = serde_json::from_str::<RepoBranchMatrix>(&json) {
                        return matrix;
                    }
                }
            }
        }
    }

    let branches = compute_repo_matrix(&repo_path, &envs).await;

    // Environment branches (dev/uat/prd) default to archived (hidden) unless the
    // user has explicitly restored them.
    for b in &branches {
        if b.is_env_branch {
            let _ = platform_branch_state_service::ensure_archived(conn, repo_id, &b.branch).await;
        }
    }

    // Auto-clean orphaned archive/note rows for branches git no longer has.
    let keep: Vec<String> = branches.iter().map(|b| b.branch.clone()).collect();
    let _ = platform_branch_state_service::prune_not_in(conn, repo_id, &keep).await;

    let matrix = RepoBranchMatrix {
        repo_id,
        repo_name: repo_name.to_string(),
        repo_path,
        configured,
        envs: envs.iter().map(|(k, _)| k.clone()).collect(),
        branches,
    };

    if let Some(fp) = fingerprint {
        if let Ok(json) = serde_json::to_string(&matrix) {
            let _ = cache_service::upsert(conn, repo_id, &fp, &json).await;
        }
    }

    matrix
}

pub async fn git_project_branch_matrix_core(
    db: &AppDatabase,
    project_id: i32,
    force: bool,
) -> Result<Vec<RepoBranchMatrix>, AppCommandError> {
    let conn = &db.conn;
    let project = platform_project_service::get_by_id(conn, project_id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Project not found: {project_id}")))?;
    let repos = platform_project_repo_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)?;

    let root_dir = project.root_dir.clone();
    let p_dev = project.dev_branch.clone();
    let p_uat = project.uat_branch.clone();
    let p_prd = project.prd_branch.clone();

    let mut results: Vec<RepoBranchMatrix> = stream::iter(repos.into_iter().map(|repo| {
        let conn = conn.clone();
        let root_dir = root_dir.clone();
        let p_dev = p_dev.clone();
        let p_uat = p_uat.clone();
        let p_prd = p_prd.clone();
        async move {
            let repo_path = resolve_repo_path(&root_dir, &repo.local_dir);
            let dev = effective_env(repo.dev_branch.as_deref(), p_dev.as_deref());
            let uat = effective_env(repo.uat_branch.as_deref(), p_uat.as_deref());
            let prd = effective_env(repo.prd_branch.as_deref(), p_prd.as_deref());
            let configured = dev.is_some() || uat.is_some() || prd.is_some();
            let envs: Vec<(String, String)> = [("dev", dev), ("uat", uat), ("prd", prd)]
                .into_iter()
                .filter_map(|(k, v)| v.map(|v| (k.to_string(), v)))
                .collect();
            compute_repo_cached(
                &conn,
                repo.id,
                &repo.name,
                repo_path,
                envs,
                configured,
                force,
            )
            .await
        }
    }))
    .buffer_unordered(REPO_CONCURRENCY)
    .collect()
    .await;

    results.sort_by_key(|m| m.repo_id);
    Ok(results)
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

/// Pull (fast-forward) a local branch from `origin/<branch>`. Auto-sets the
/// upstream when the branch has a remote counterpart but no tracking config, so
/// the existing `git_update_branch` (which requires an upstream) can run.
pub async fn git_pull_branch_core(
    db: &AppDatabase,
    path: &str,
    branch: &str,
    credentials: Option<&crate::models::GitCredentials>,
    data_dir: &std::path::Path,
) -> Result<crate::commands::folders::GitPullResult, AppCommandError> {
    let remote_ref = format!("refs/remotes/origin/{branch}");
    let exists = git_output(path, &["rev-parse", "--verify", "--quiet", &remote_ref])
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !exists {
        return Err(AppCommandError::not_found(format!(
            "Remote branch 'origin/{branch}' not found; sync remote first"
        )));
    }

    let remote_cfg = git_stdout(
        path,
        &["config", "--get", &format!("branch.{branch}.remote")],
    )
    .await
    .unwrap_or_default();
    if remote_cfg.trim().is_empty() {
        let _ = git_output(
            path,
            &[
                "branch",
                "--set-upstream-to",
                &format!("origin/{branch}"),
                branch,
            ],
        )
        .await;
    }

    crate::commands::folders::git_update_branch_core(path, branch, false, credentials, db, data_dir)
        .await
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_project_branch_matrix(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
    force: Option<bool>,
) -> Result<Vec<RepoBranchMatrix>, AppCommandError> {
    git_project_branch_matrix_core(&db, project_id, force.unwrap_or(false)).await
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

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_pull_branch(
    db: tauri::State<'_, AppDatabase>,
    path: String,
    branch: String,
    credentials: Option<crate::models::GitCredentials>,
    app_handle: tauri::AppHandle,
) -> Result<crate::commands::folders::GitPullResult, AppCommandError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppCommandError::external_command("Failed to resolve app data dir", e.to_string()))?;
    let data_dir = crate::paths::resolve_effective_data_dir(&data_dir);
    git_pull_branch_core(&db, &path, &branch, credentials.as_ref(), &data_dir).await
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
        let line = "0000 1111 Alice <a@b.c> 1700000000 +0800\tbranch: Created from main";
        assert_eq!(parse_reflog_epoch(line), Some(1700000000));
        assert_eq!(parse_reflog_epoch("garbage"), None);
    }

    #[test]
    fn parse_reflog_created_by_extracts_name() {
        let line = "0000 1111 Alice <a@b.c> 1700000000 +0800\tbranch: Created from main";
        assert_eq!(parse_reflog_created_by(line).as_deref(), Some("Alice"));
        assert_eq!(parse_reflog_created_by("x\tcommit: msg"), None);
    }

    #[test]
    fn parse_left_right_reads_counts() {
        assert_eq!(parse_left_right("3\t0\n"), Some((3, 0)));
        assert_eq!(parse_left_right("0 5"), Some((0, 5)));
    }

    #[test]
    fn resolve_repo_path_joins_relative() {
        let p = resolve_repo_path("/root", "svc/api");
        assert!(p.contains("svc"));
    }
}