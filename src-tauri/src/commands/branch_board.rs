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
use crate::models::{BranchRow, BranchStateInfo, EnvMergeStatus, RemoteState, RepoBranchMatrix};

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

/// Stable signature of the effective environment configuration, used as part of
/// the branch-matrix cache key so renaming an env branch (or toggling whether
/// any is configured) invalidates the cached matrix even when git refs are
/// unchanged. Order-independent.
pub(crate) fn env_config_signature(envs: &[(String, String)], configured: bool) -> String {
    let mut parts: Vec<String> = envs.iter().map(|(k, v)| format!("{k}={v}")).collect();
    parts.sort();
    format!("{}|configured={configured}", parts.join(";"))
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

/// Deterministic 64-bit FNV-1a hasher for stable cache fingerprints across
/// process restarts (unlike `std::collections::hash_map::DefaultHasher` which
/// is randomly seeded per process).
#[derive(Default)]
pub(crate) struct FnvHasher(u64);

impl FnvHasher {
    pub(crate) fn new() -> Self {
        Self(0xcbf29ce484222325)
    }
}

impl Hasher for FnvHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.0 ^= byte as u64;
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
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
    let mut hasher = FnvHasher::new();
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
    date: String,
    upstream: Option<String>,
}

/// Local branches with tip sha + committer date + upstream tracking, via one
/// `for-each-ref`.
async fn list_local_branches(path: &str) -> Result<Vec<LocalBranch>, AppCommandError> {
    let out = git_stdout(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(objectname)%09%(committerdate:iso8601-strict)%09%(upstream:short)",
            "refs/heads",
        ],
    )
    .await?;

    let mut branches = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.is_empty() || parts[0].trim().is_empty() {
            continue;
        }
        let name = parts[0].trim().to_string();
        let date = parts.get(2).map(|s| s.trim().to_string()).unwrap_or_default();
        let upstream = parts
            .get(3)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        branches.push(LocalBranch {
            name,
            date,
            upstream,
        });
    }
    Ok(branches)
}

/// Names of remote-tracking branches (e.g. "origin/main", "origin/feat/x").
async fn remote_branches(path: &str) -> HashSet<String> {
    let out = match git_stdout(
        path,
        &["for-each-ref", "--format=%(refname:short)", "refs/remotes"],
    )
    .await
    {
        Ok(s) => s,
        Err(_) => return HashSet::new(),
    };
    out.lines()
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.ends_with("/HEAD"))
        .map(String::from)
        .collect()
}

/// Configured tracking targets: map from local branch name -> remote-tracking
/// ref (e.g. "feat/x" -> "origin/feat/x").
async fn branch_tracking_config(path: &str) -> HashMap<String, String> {
    let out = match git_stdout(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(upstream:short)",
            "refs/heads",
        ],
    )
    .await
    {
        Ok(s) => s,
        Err(_) => return HashMap::new(),
    };
    let mut map = HashMap::new();
    for line in out.lines() {
        let mut parts = line.splitn(2, '\t');
        let local = parts.next().unwrap_or("").trim();
        let upstream = parts.next().unwrap_or("").trim();
        if !local.is_empty() && !upstream.is_empty() {
            map.insert(local.to_string(), upstream.to_string());
        }
    }
    map
}

/// Commits reachable from a ref: run `git branch --merged <env>`. Branches in
/// the output have their tips contained in `<env>`.
async fn merged_set(path: &str, env: &str) -> HashSet<String> {
    let out = match git_stdout(path, &["branch", "--merged", env]).await {
        Ok(s) => s,
        Err(_) => return HashSet::new(),
    };
    out.lines()
        .map(str::trim)
        .map(|s| s.strip_prefix('*').unwrap_or(s).trim())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
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

/// Merge method + date for a branch already known to be merged into `env`.
///
/// 1. Finds the earliest merge commit on `env` bringing `branch` in via `--merges`.
///    If found, returns `(Some("merge"), Some(merge_commit_date))`.
/// 2. If no merge commit exists in `branch..env`, the branch was incorporated via
///    fast-forward: returns `(Some("fast_forward"), None)`.
async fn merge_info(
    path: &str,
    branch: &str,
    env: &str,
) -> (Option<String>, Option<String>) {
    let range = format!("{branch}..{env}");
    let out = match git_stdout(
        path,
        &[
            "log",
            "--merges",
            "--ancestry-path",
            "--reverse",
            "--format=%cI%x09%H",
            &range,
        ],
    )
    .await
    {
        Ok(s) => s,
        Err(_) => return (None, None),
    };
    if let Some(line) = out.lines().next() {
        let mut parts = line.splitn(2, '\t');
        let date = parts.next().unwrap_or("").trim().to_string();
        if !date.is_empty() {
            return (Some("merge".to_string()), Some(date));
        }
    }
    (Some("fast_forward".to_string()), None)
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

async fn rev_left_right(path: &str, a: &str, b: &str) -> Option<(i64, i64)> {
    let range = format!("{a}...{b}");
    let out = git_stdout(path, &["rev-list", "--left-right", "--count", &range])
        .await
        .ok()?;
    parse_left_right(&out)
}

pub(crate) fn state_from_counts(ahead: i64, behind: i64) -> RemoteState {
    match (ahead, behind) {
        (0, 0) => RemoteState::Synced,
        (a, 0) if a > 0 => RemoteState::Ahead,
        (0, b) if b > 0 => RemoteState::Behind,
        _ => RemoteState::Diverged,
    }
}

/// Compute remote relationship for a local branch.
async fn branch_remote_status(
    path: &str,
    lb: &LocalBranch,
    remotes: &HashSet<String>,
    tracking: &HashMap<String, String>,
) -> (RemoteState, Option<i64>, Option<i64>, bool) {
    if remotes.is_empty() {
        return (RemoteState::NoRemote, None, None, false);
    }
    let upstream = tracking
        .get(&lb.name)
        .cloned()
        .or_else(|| {
            let default_target = format!("origin/{}", lb.name);
            remotes.contains(&default_target).then_some(default_target)
        });

    let Some(target) = upstream else {
        return (RemoteState::Unpublished, None, None, false);
    };

    if !remotes.contains(&target) {
        return (RemoteState::Unpublished, None, None, false);
    }

    match rev_left_right(path, &lb.name, &target).await {
        Some((ahead, behind)) => (state_from_counts(ahead, behind), Some(ahead), Some(behind), true),
        None => (RemoteState::Unknown, None, None, true),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix calculation
// ─────────────────────────────────────────────────────────────────────────────

/// Compute the branch matrix for one repo. Fails when the repo cannot be read
/// at all (missing path / broken git) so the caller never caches an
/// accidental empty matrix as a good result.
async fn compute_repo_matrix(
    repo_path: &str,
    envs: &[(String, String)],
) -> Result<Vec<BranchRow>, AppCommandError> {
    let locals = list_local_branches(repo_path)
        .await
        .map_err(|e| AppCommandError::external_command("Failed to list branches", e.to_string()))?;

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
    let tracking = branch_tracking_config(repo_path).await;
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
                merge_info(repo_path, &lb.name, resolved).await
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
        let (mut created_at, mut created_by, mut created_at_source) = match created {
            Some((d, b)) => (Some(d), b, Some("reflog".to_string())),
            None => (None, None, None),
        };

        if created_at.is_none() {
            let base_range = env_refs
                .first()
                .map(|(_, _, resolved)| format!("{resolved}..{}", lb.name))
                .unwrap_or_else(|| lb.name.clone());
            if let Ok(out) = git_stdout(
                repo_path,
                &["log", "--reverse", "--format=%cI%x09%an", "-1", &base_range],
            )
            .await
            {
                if let Some(line) = out.lines().next() {
                    let mut parts = line.splitn(2, '\t');
                    let dt = parts.next().unwrap_or("").trim().to_string();
                    let author = parts.next().unwrap_or("").trim().to_string();
                    if !dt.is_empty() {
                        created_at = Some(dt);
                        created_by = if author.is_empty() { None } else { Some(author) };
                        created_at_source = Some("first_commit".to_string());
                    }
                }
            }
        }

        let (remote_state, ahead, behind, has_remote) =
            branch_remote_status(repo_path, &lb, &remotes, &tracking).await;
        let needs_push = matches!(
            remote_state,
            RemoteState::Ahead | RemoteState::Diverged | RemoteState::Unpublished
        );
        let needs_pull =
            matches!(remote_state, RemoteState::Behind | RemoteState::Diverged);

        let is_current = current.as_deref() == Some(lb.name.as_str());
        rows.push(BranchRow {
            branch: lb.name,
            created_at_source,
            created_at,
            is_env_branch,
            is_current,
            last_commit_at: Some(lb.date).filter(|s| !s.is_empty()),
            created_by,
            upstream: lb.upstream,
            has_remote,
            remote_state,
            ahead: ahead.unwrap_or(0),
            behind: behind.unwrap_or(0),
            needs_push,
            needs_pull,
            envs: statuses,
        });
    }
    Ok(rows)
}

async fn compute_repo_cached(
    conn: &DatabaseConnection,
    repo_id: i32,
    repo_name: &str,
    repo_path: String,
    envs: Vec<(String, String)>,
    configured: bool,
    force: bool,
) -> Result<RepoBranchMatrix, AppCommandError> {
    let env_sig = env_config_signature(&envs, configured);
    let fp = ref_fingerprint(&repo_path);
    let cache_key = fp.as_ref().map(|f| format!("{f}|{env_sig}"));

    if !force {
        if let Some(ref key) = cache_key {
            let cached = cache_service::get(conn, repo_id)
                .await
                .ok()
                .flatten()
                .filter(|(stored_fp, _)| stored_fp == key);
            if let Some((_, cached_json)) = cached {
                if let Ok(rows) = serde_json::from_str::<Vec<BranchRow>>(&cached_json) {
                    return Ok(RepoBranchMatrix {
                        repo_id,
                        repo_name: repo_name.to_string(),
                        repo_path,
                        configured,
                        envs: envs.iter().map(|(k, _)| k.clone()).collect(),
                        branches: rows,
                    });
                }
            }
        }
    }

    let rows = compute_repo_matrix(&repo_path, &envs).await?;

    if let Some(ref key) = cache_key {
        if let Ok(json) = serde_json::to_string(&rows) {
            let _ = cache_service::upsert(conn, repo_id, key, &json).await;
        }
    }

    Ok(RepoBranchMatrix {
        repo_id,
        repo_name: repo_name.to_string(),
        repo_path,
        configured,
        envs: envs.iter().map(|(k, _)| k.clone()).collect(),
        branches: rows,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Public core functions
// ─────────────────────────────────────────────────────────────────────────────

pub async fn git_project_branch_matrix_core(
    db: &AppDatabase,
    project_id: i32,
    force: bool,
) -> Result<Vec<RepoBranchMatrix>, AppCommandError> {
    let project = platform_project_service::get_by_id(&db.conn, project_id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Project not found"))?;

    let repos = platform_project_repo_service::list_by_project(&db.conn, project_id)
        .await
        .map_err(AppCommandError::from)?;

    let mut tasks = Vec::new();
    for repo in repos {
        let repo_path = resolve_repo_path(&project.root_dir, &repo.local_dir);
        let mut envs: Vec<(String, String)> = Vec::new();
        if let Some(b) = effective_env(repo.dev_branch.as_deref(), project.dev_branch.as_deref()) {
            envs.push(("dev".to_string(), b));
        }
        if let Some(b) = effective_env(repo.uat_branch.as_deref(), project.uat_branch.as_deref()) {
            envs.push(("uat".to_string(), b));
        }
        if let Some(b) = effective_env(repo.prd_branch.as_deref(), project.prd_branch.as_deref()) {
            envs.push(("prd".to_string(), b));
        }
        let configured = !envs.is_empty();
        tasks.push((repo.id, repo.name, repo_path, envs, configured));
    }

    let conn = &db.conn;
    let results: Vec<Result<RepoBranchMatrix, AppCommandError>> = stream::iter(tasks)
        .map(|(repo_id, repo_name, repo_path, envs, configured)| async move {
            compute_repo_cached(conn, repo_id, &repo_name, repo_path, envs, configured, force)
                .await
                .map_err(|e| {
                    AppCommandError::external_command(
                        format!("Failed to compute branch matrix for repo '{repo_name}'"),
                        e.to_string(),
                    )
                })
        })
        .buffer_unordered(REPO_CONCURRENCY)
        .collect()
        .await;

    // Fail loudly when any repo cannot be scanned: an empty/partial matrix
    // silently presented as fresh data is worse than an explicit error.
    let mut ok = Vec::with_capacity(results.len());
    for r in results {
        ok.push(r?);
    }
    ok.sort_by_key(|m| m.repo_id);
    Ok(ok)
}

pub async fn git_worktree_add_existing_core(
    path: String,
    worktree_path: String,
    branch: String,
) -> Result<(), AppCommandError> {
    crate::work_task::git::worktree_add_existing_branch(&path, &worktree_path, &branch).await
}

pub async fn git_worktree_remove_temp_core(
    db: Option<&AppDatabase>,
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
    if let Some(db) = db {
        if let Err(e) = crate::db::service::folder_service::remove_folder(&db.conn, &worktree_path).await {
            tracing::warn!(
                "[branch_board] cleaning folder db entry for {worktree_path}: {e}"
            );
        }
    }
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

/// Pull (fast-forward) a local branch from its configured upstream. When the
/// branch has a remote-tracking counterpart but no tracking config, the
/// uniquely owning remote is adopted via `--set-upstream-to` so the existing
/// `git_update_branch` (which requires an upstream) can run. Never assumes
/// `origin`: an ambiguous or absent counterpart is reported explicitly.
pub async fn git_pull_branch_core(
    db: &AppDatabase,
    path: &str,
    branch: &str,
    credentials: Option<&crate::models::GitCredentials>,
    data_dir: &std::path::Path,
) -> Result<crate::commands::folders::GitPullResult, AppCommandError> {
    let tracking = branch_tracking_config(path).await;
    if !tracking.contains_key(branch) {
        let remotes = remote_branches(path).await;
        let suffix = format!("/{branch}");
        let candidates: Vec<&String> = remotes.iter().filter(|r| r.ends_with(&suffix)).collect();
        match candidates.len() {
            0 => {
                return Err(AppCommandError::invalid_input(format!(
                    "Branch '{branch}' has no upstream and no remote-tracking counterpart"
                )));
            }
            1 => {
                let target = candidates[0];
                let set_out = git_output(path, &["branch", &format!("--set-upstream-to={target}"), branch]).await?;
                if !set_out.status.success() {
                    return Err(AppCommandError::external_command(
                        "Failed to set upstream",
                        String::from_utf8_lossy(&set_out.stderr).trim().to_string(),
                    ));
                }
            }
            _ => {
                return Err(AppCommandError::invalid_input(format!(
                    "Branch '{branch}' matches multiple remotes ({}); configure upstream explicitly",
                    candidates.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
                )));
            }
        }
    }

    crate::commands::folders::git_update_branch_core(path, branch, false, credentials, db, data_dir)
        .await
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri command wrappers
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
    db: tauri::State<'_, AppDatabase>,
    path: String,
    worktree_path: String,
) -> Result<(), AppCommandError> {
    git_worktree_remove_temp_core(Some(&db), path, worktree_path).await
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
    fn fnv_hasher_is_deterministic() {
        let mut h1 = FnvHasher::new();
        let mut h2 = FnvHasher::new();
        let data = vec!["refs/heads/main", "refs/heads/dev", "HEAD"];
        data.hash(&mut h1);
        data.hash(&mut h2);
        assert_eq!(h1.finish(), h2.finish());
        assert_ne!(h1.finish(), 0);
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

    #[test]
    fn env_config_signature_tracks_configuration() {
        let base = env_config_signature(&[("dev".into(), "develop".into())], true);
        let renamed = env_config_signature(&[("dev".into(), "main".into())], true);
        let unconfigured = env_config_signature(&[("dev".into(), "develop".into())], false);
        assert_ne!(base, renamed, "renaming an env branch must change the key");
        assert_ne!(base, unconfigured, "the configured flag must change the key");

        // Order-independent.
        let a = env_config_signature(
            &[("uat".into(), "u".into()), ("dev".into(), "d".into())],
            true,
        );
        let b = env_config_signature(
            &[("dev".into(), "d".into()), ("uat".into(), "u".into())],
            true,
        );
        assert_eq!(a, b);
    }

    #[test]
    fn remote_state_from_counts_covers_all_directions() {
        assert_eq!(state_from_counts(0, 0), RemoteState::Synced);
        assert_eq!(state_from_counts(2, 0), RemoteState::Ahead);
        assert_eq!(state_from_counts(0, 3), RemoteState::Behind);
        assert_eq!(state_from_counts(1, 1), RemoteState::Diverged);
    }

    // ── Temporary-repository integration tests ──────────────────────────────
    //
    // These exercise the real git probes (multiple remotes, upstream config,
    // local-only branches) against throwaway repositories. No network access:
    // remotes are local bare repos.

    fn git(dir: &std::path::Path, args: &[&str]) -> bool {
        std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.com")
            .output()
            .expect("spawn git")
            .status
            .success()
    }

    fn init_repo(dir: &std::path::Path) {
        assert!(git(dir, &["init", "-q", "-b", "main"]));
        assert!(git(dir, &["config", "user.name", "t"]));
        assert!(git(dir, &["config", "user.email", "t@example.com"]));
        assert!(git(dir, &["config", "core.autocrlf", "false"]));
        std::fs::write(dir.join("a.txt"), "a\n").expect("write");
        assert!(git(dir, &["add", "-A"]));
        assert!(git(dir, &["commit", "-q", "-m", "base"]));
    }

    fn path_str(p: &std::path::Path) -> String {
        p.to_string_lossy().replace('\\', "/")
    }

    async fn row_for(path: &str, branch: &str) -> BranchRow {
        compute_repo_matrix(path, &[])
            .await
            .expect("compute_repo_matrix")
            .into_iter()
            .find(|r| r.branch == branch)
            .unwrap_or_else(|| panic!("branch {branch} missing for {path}"))
    }

    #[tokio::test]
    async fn remote_status_uses_non_origin_upstream() {
        let repo_dir = tempfile::tempdir().expect("repo");
        let remote_dir = tempfile::tempdir().expect("remote");
        init_repo(repo_dir.path());
        assert!(git(remote_dir.path(), &["init", "-q", "--bare", "company.git"]));
        let bare = path_str(&remote_dir.path().join("company.git"));
        assert!(git(repo_dir.path(), &["remote", "add", "company", &bare]));
        assert!(git(repo_dir.path(), &["push", "-q", "-u", "company", "main"]));

        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/x"]));
        std::fs::write(repo_dir.path().join("x.txt"), "x\n").expect("write");
        assert!(git(repo_dir.path(), &["add", "-A"]));
        assert!(git(repo_dir.path(), &["commit", "-q", "-m", "x"]));
        assert!(git(repo_dir.path(), &["push", "-q", "-u", "company", "feat/x"]));

        let path = path_str(repo_dir.path());
        let feat = row_for(&path, "feat/x").await;
        assert_eq!(
            feat.upstream.as_deref(),
            Some("company/feat/x"),
            "upstream should track the company remote, not origin"
        );
        assert_eq!(feat.remote_state, RemoteState::Synced);
        assert!(feat.has_remote);
        assert!(!feat.needs_push && !feat.needs_pull);
    }

    #[tokio::test]
    async fn remote_status_distinguishes_unpublished_from_no_remote() {
        // A remote is configured, but this local branch was never pushed.
        let repo_dir = tempfile::tempdir().expect("repo");
        let remote_dir = tempfile::tempdir().expect("remote");
        init_repo(repo_dir.path());
        assert!(git(remote_dir.path(), &["init", "-q", "--bare", "r.git"]));
        let bare = path_str(&remote_dir.path().join("r.git"));
        assert!(git(repo_dir.path(), &["remote", "add", "origin", &bare]));
        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/local"]));
        std::fs::write(repo_dir.path().join("l.txt"), "l\n").expect("write");
        assert!(git(repo_dir.path(), &["add", "-A"]));
        assert!(git(repo_dir.path(), &["commit", "-q", "-m", "l"]));

        let local = row_for(&path_str(repo_dir.path()), "feat/local").await;
        assert_eq!(local.remote_state, RemoteState::Unpublished);
        assert!(local.needs_push, "unpublished branches belong in 'needs push'");
        assert!(!local.has_remote);

        // A repository with no remotes at all is `no_remote`, never `synced`.
        let bare_dir = tempfile::tempdir().expect("bare");
        init_repo(bare_dir.path());
        let main = row_for(&path_str(bare_dir.path()), "main").await;
        assert_eq!(main.remote_state, RemoteState::NoRemote);
        assert!(!main.needs_push && !main.needs_pull);
    }
}
