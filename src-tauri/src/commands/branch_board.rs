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

/// Bump whenever the meaning or shape of a cached matrix changes.
///
/// The cache key is otherwise just a fingerprint of the repo's git refs, so after
/// an upgrade an unchanged repo would keep serving rows computed by the OLD
/// logic (wrong merge status, wrong creator, ...) until some ref happened to
/// move or the user pressed refresh. Mixing this into the key retires them.
// Bumped to 3: merge_info now dates fast-forward merges (reflog / tip commit),
// so cached rows computed with None dates would keep rendering a dateless
// "merged" cell until the next ref change.
const MATRIX_CACHE_VERSION: u32 = 3;

/// Max branches probed concurrently *within* one repo. Multiplies with
/// [`REPO_CONCURRENCY`], so kept small enough that the product stays a sane
/// number of simultaneous git processes.
const BRANCH_CONCURRENCY: usize = 8;

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
    /// Raw `%(upstream:track,nobracket)`: empty, `ahead 2`, `behind 3`,
    /// `ahead 1, behind 2`, or `gone`.
    track: String,
}

/// Local branches with committer date, upstream and its ahead/behind counts,
/// via one `for-each-ref`.
///
/// `%(upstream:track)` is the reason the matrix needs no per-branch `rev-list`:
/// git reports the counts for every branch in this single call, which on a
/// repository with many branches is the difference between one git process and
/// one per branch.
async fn list_local_branches(path: &str) -> Result<Vec<LocalBranch>, AppCommandError> {
    let out = git_stdout(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%09%(committerdate:iso8601-strict)%09%(upstream:short)%09%(upstream:track,nobracket)",
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
        branches.push(LocalBranch {
            name: parts[0].trim().to_string(),
            date: parts.get(1).map(|s| s.trim().to_string()).unwrap_or_default(),
            upstream: parts
                .get(2)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
            track: parts.get(3).map(|s| s.trim().to_string()).unwrap_or_default(),
        });
    }
    Ok(branches)
}

/// Parsed `%(upstream:track,nobracket)` output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct UpstreamTrack {
    pub ahead: i64,
    pub behind: i64,
    /// The upstream is still configured but no longer exists on the remote —
    /// typically the branch was merged and deleted server-side, then a
    /// `fetch --prune` ran locally.
    pub gone: bool,
}

pub(crate) fn parse_upstream_track(raw: &str) -> UpstreamTrack {
    let raw = raw.trim();
    if raw == "gone" {
        return UpstreamTrack {
            gone: true,
            ..Default::default()
        };
    }
    let mut out = UpstreamTrack::default();
    for part in raw.split(',') {
        let part = part.trim();
        if let Some(n) = part.strip_prefix("ahead ") {
            out.ahead = n.trim().parse().unwrap_or(0);
        } else if let Some(n) = part.strip_prefix("behind ") {
            out.behind = n.trim().parse().unwrap_or(0);
        }
    }
    out
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

/// Whether the repo has any remote configured at all (`git remote`).
///
/// Deliberately distinct from [`remote_branches`]: a remote that has never been
/// fetched or pushed to has no remote-tracking refs, so judging "has a remote"
/// by `refs/remotes` reports every branch in a freshly configured repo as
/// local-only when they are really just unpublished.
async fn has_configured_remote(path: &str) -> bool {
    git_stdout(path, &["remote"])
        .await
        .map(|out| out.lines().any(|l| !l.trim().is_empty()))
        .unwrap_or(false)
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

/// Local branches whose tip is contained in `<env>`.
///
/// Uses `for-each-ref` rather than `git branch --merged`: the latter decorates
/// its output (`* ` for the checked-out branch, `+ ` for one checked out in a
/// linked worktree, plus a `(HEAD detached at ...)` pseudo-entry), and any
/// prefix left unstripped silently turns a merged branch into an unmerged one.
/// `for-each-ref` emits bare names only.
async fn merged_set(path: &str, env: &str) -> HashSet<String> {
    let out = match git_stdout(
        path,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "--merged",
            env,
            "refs/heads",
        ],
    )
    .await
    {
        Ok(s) => s,
        Err(_) => return HashSet::new(),
    };
    out.lines()
        .map(str::trim)
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

/// Every ref that represents an environment branch, local first, then the
/// remote-tracking one. Empty when neither exists.
///
/// A branch counts as released to an environment if EITHER ref contains it,
/// because each alone is wrong in one direction: the local copy lags when a
/// teammate merged on the remote and you have not pulled yet, and the remote
/// lags right after you merged locally and before you pushed.
///
/// Never assumes `origin`: it picks the uniquely owning remote. The candidate
/// match requires the part before `/<env>` to be a bare remote name, otherwise
/// env `uat` would also match `origin/release/uat` and silently compare against
/// the wrong branch. An ambiguous name (several remotes carry it) contributes
/// no remote ref rather than a guess.
async fn resolve_env_refs(path: &str, env: &str, remotes: &HashSet<String>) -> Vec<String> {
    let mut refs = Vec::new();
    if git_ref_exists(path, &format!("refs/heads/{env}")).await {
        refs.push(env.to_string());
    }
    let suffix = format!("/{env}");
    let mut candidates = remotes.iter().filter(|r| {
        r.strip_suffix(&suffix)
            .is_some_and(|remote| !remote.is_empty() && !remote.contains('/'))
    });
    // Remote-tracking names come from `for-each-ref`, so a hit is known to exist.
    if let (Some(only), None) = (candidates.next(), candidates.next()) {
        refs.push(only.clone());
    }
    refs
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
///    fast-forward. The date the user cares about ("when did it land?") is
///    reconstructed from the env ref's own move history — see
///    [`ff_merge_date`].
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
    (
        Some("fast_forward".to_string()),
        ff_merge_date(path, branch, env).await,
    )
}

/// The landing date of a fast-forward merge: no merge commit exists to point
/// at, so the best evidence is when the env ref itself first moved to the
/// branch's tip — every ref move (local `merge`, `push`, and fetches that
/// advance a remote-tracking ref) appends a reflog entry with a timestamp.
/// Without such an entry — reflog expired or disabled, or the merge happened
/// elsewhere and this clone only ever saw the aftermath — fall back to the
/// tip's commit date: the same kind of answer, though it may understate the
/// landing moment by however long the branch sat finished before being merged.
async fn ff_merge_date(path: &str, branch: &str, env: &str) -> Option<String> {
    let tip = git_stdout(
        path,
        &["rev-parse", "--quiet", "--verify", branch],
    )
    .await
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| s.len() == 40);
    if let Some(tip) = tip {
        if let Ok(out) = git_stdout(
            path,
            &["log", "-g", "--reverse", "--format=%H%x09%gI", env],
        )
        .await
        {
            for line in out.lines() {
                let mut parts = line.splitn(2, '\t');
                let new_sha = parts.next().unwrap_or("").trim();
                if new_sha == tip {
                    let date = parts.next().unwrap_or("").trim();
                    if !date.is_empty() {
                        return Some(date.to_string());
                    }
                }
            }
        }
    }
    git_stdout(path, &["log", "--max-count=1", "--format=%cI", branch])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Whether the branch's own reflog records any move since it was created.
///
/// `Some(false)` means the only entry is `branch: Created from ...`: the branch
/// still sits exactly where it was cut and has no work of its own. `None` when
/// the reflog is unavailable (fresh clone, gc), where its absence proves
/// nothing and callers must keep their default.
fn branch_moved_since_creation(git_dir: &Path, branch: &str) -> Option<bool> {
    let log_path = git_dir.join("logs").join("refs").join("heads").join(branch);
    let content = std::fs::read_to_string(log_path).ok()?;
    Some(
        content
            .lines()
            .any(|line| !line.trim().is_empty() && !line.contains("branch: Created from")),
    )
}

/// Branch creation date + creator read straight from the reflog file (no git
/// process). Returns `(created_at_rfc3339, created_by)`.
fn created_at_from_reflog(git_dir: &Path, branch: &str) -> Option<(String, Option<String>)> {    let log_path = git_dir.join("logs").join("refs").join("heads").join(branch);
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

/// Date + author of the OLDEST commit reachable from `branch` but not from any
/// ref in `exclude`. Serves as the branch-creation fallback when the reflog has
/// no `branch: Created from` entry — the case for every fetched or cloned
/// branch, i.e. most branches in a shared repository.
///
/// Note `--reverse` is NOT used: git applies commit limiting *before* the
/// reversal, so `--reverse -1` yields the NEWEST commit. Since git logs
/// newest-first, the oldest commit is simply the last line.
///
/// Requires a baseline. Without one the range would be the branch's entire
/// history, whose oldest commit is the repository's first — not this branch's
/// creation — so it reports nothing rather than something misleading, and
/// avoids walking the whole history for every branch.
async fn first_commit_info(
    path: &str,
    branch: &str,
    exclude: &[String],
) -> Option<(String, Option<String>)> {
    if exclude.is_empty() {
        return None;
    }

    let mut args: Vec<&str> = vec!["log", "--format=%cI%x09%an", branch, "--not"];
    args.extend(exclude.iter().map(String::as_str));
    let out = git_stdout(path, &args).await.ok()?;

    let line = out.lines().rfind(|l| !l.trim().is_empty())?;
    let mut parts = line.splitn(2, '\t');
    let date = parts.next().unwrap_or("").trim().to_string();
    if date.is_empty() {
        return None;
    }
    let author = parts.next().unwrap_or("").trim();
    Some((date, (!author.is_empty()).then(|| author.to_string())))
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
///
/// Spawns no git process in the common cases: [`list_local_branches`] already
/// carried the upstream and its ahead/behind counts. Only a branch with no
/// tracking config that nonetheless has a same-named remote ref falls back to a
/// `rev-list`, which is rare — both pushing a branch and checking out a fetched
/// one write tracking config.
async fn branch_remote_status(
    path: &str,
    lb: &LocalBranch,
    remotes: &HashSet<String>,
    has_remote_configured: bool,
) -> (RemoteState, i64, i64, bool) {
    // "No remote" is about configuration, not about whether anything has been
    // fetched yet — see [`has_configured_remote`].
    if !has_remote_configured {
        return (RemoteState::NoRemote, 0, 0, false);
    }

    // A configured upstream is only this branch's counterpart when it names the
    // branch itself — see [`upstream_tracks_branch`].
    if let Some(upstream) = lb.upstream.as_deref() {
        if upstream_tracks_branch(upstream, &lb.name) {
            let track = parse_upstream_track(&lb.track);
            if track.gone || !remotes.contains(upstream) {
                return (RemoteState::Unpublished, 0, 0, false);
            }
            return (
                state_from_counts(track.ahead, track.behind),
                track.ahead,
                track.behind,
                true,
            );
        }
    }

    match same_name_remote_ref(&lb.name, remotes) {
        Some(target) => match rev_left_right(path, &lb.name, target).await {
            Some((ahead, behind)) => (state_from_counts(ahead, behind), ahead, behind, true),
            None => (RemoteState::Unknown, 0, 0, true),
        },
        None => (RemoteState::Unpublished, 0, 0, false),
    }
}

/// Whether `upstream` (e.g. `origin/feat/x`) names `branch` itself on a remote,
/// as opposed to a different branch. `git switch -c feat origin/dev` silently
/// records `origin/dev` as the new branch's upstream; measuring `feat` against
/// it reports a never-pushed branch as `synced` (or `ahead`/`behind`) relative
/// to the branch it was cut from, and hides the "local" badge.
fn upstream_tracks_branch(upstream: &str, branch: &str) -> bool {
    upstream
        .strip_suffix(&format!("/{branch}"))
        .is_some_and(|remote| !remote.is_empty() && !remote.contains('/'))
}

/// The uniquely owning same-named remote ref for `branch` (e.g. `origin/feat/x`
/// for `feat/x`). The prefix must be a bare remote name, else branch `uat`
/// would also match `origin/release/uat`.
fn same_name_remote_ref<'a>(branch: &str, remotes: &'a HashSet<String>) -> Option<&'a str> {
    let suffix = format!("/{branch}");
    let mut candidates = remotes.iter().filter_map(|r| {
        let remote = r.strip_suffix(&suffix)?;
        (!remote.is_empty() && !remote.contains('/')).then_some(r.as_str())
    });
    match (candidates.next(), candidates.next()) {
        (Some(target), None) => Some(target),
        _ => None,
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

    // Remotes come first: resolving an env branch that only exists remotely
    // needs them.
    let remotes = remote_branches(repo_path).await;
    let has_remote_configured = has_configured_remote(repo_path).await;

    // Resolve each env to the refs that exist (local branch and/or its
    // remote-tracking counterpart), then one git call per ref for its merged
    // set. Only refs that actually resolve are ever passed on: a non-existent
    // ref given to `git log --not` would fail the whole probe.
    let mut env_refs: Vec<(String, String, Vec<String>)> = Vec::new();
    let mut existing_env_refs: Vec<String> = Vec::new();
    for (env_key, env_name) in envs {
        let refs = resolve_env_refs(repo_path, env_name, &remotes).await;
        existing_env_refs.extend(refs.iter().cloned());
        env_refs.push((env_key.clone(), env_name.clone(), refs));
    }
    let mut merged: HashMap<String, Vec<(String, HashSet<String>)>> = HashMap::new();
    for (env_key, _name, refs) in &env_refs {
        let mut sets = Vec::with_capacity(refs.len());
        for r in refs {
            sets.push((r.clone(), merged_set(repo_path, r).await));
        }
        merged.insert(env_key.clone(), sets);
    }

    let git_dir = git_dir_no_spawn(repo_path);
    let current = current_branch(repo_path).await;

    // Per-branch probes run concurrently. `merge_info` alone is one git process
    // per (merged branch × env), which dominates a cold scan: on a repo with a
    // hundred branches and three environments the serial version spent seconds
    // waiting on process startup. Bounded so the nesting with REPO_CONCURRENCY
    // cannot spawn an unbounded number of git processes at once.
    let merged_ref = &merged;
    let env_refs_ref = &env_refs;
    let existing_env_refs_ref = &existing_env_refs;
    let remotes_ref = &remotes;
    let git_dir_ref = git_dir.as_deref();
    let current_ref = current.as_deref();

    let mut rows: Vec<BranchRow> = stream::iter(locals)
        .map(|lb| async move {
            let mut statuses = Vec::new();
            let mut is_env_branch = false;
            for (env_key, env_name, _refs) in env_refs_ref {
                if lb.name == *env_name {
                    is_env_branch = true;
                    statuses.push(EnvMergeStatus {
                        env: env_key.clone(),
                        merged: true,
                        merge_via: None,
                        merge_date: None,
                    });
                    continue;
                }
                // First ref (local before remote) that contains the branch; it
                // also supplies the merge method and date.
                let containing = merged_ref
                    .get(env_key)
                    .and_then(|sets| sets.iter().find(|(_, s)| s.contains(&lb.name)))
                    .map(|(r, _)| r.as_str());
                let (mut via, mut date) = match containing {
                    Some(r) => merge_info(repo_path, &lb.name, r).await,
                    None => (None, None),
                };
                let mut is_merged = containing.is_some();
                // A branch cut from this env and never committed to is an
                // ancestor of it, so `--merged` lists it — yet nothing has been
                // merged. Only a fast-forward path can land here; a real
                // fast-forward merge has moved the branch's own ref since
                // creation (commits, or a fetch into it).
                if is_merged
                    && via.as_deref() == Some("fast_forward")
                    && git_dir_ref
                        .and_then(|gd| branch_moved_since_creation(gd, &lb.name))
                        == Some(false)
                {
                    is_merged = false;
                    via = None;
                    date = None;
                }
                statuses.push(EnvMergeStatus {
                    env: env_key.clone(),
                    merged: is_merged,
                    merge_via: via,
                    merge_date: date,
                });
            }

            let created = git_dir_ref.and_then(|gd| created_at_from_reflog(gd, &lb.name));
            let (mut created_at, mut created_by, mut created_at_source) = match created {
                Some((d, b)) => (Some(d), b, Some("reflog".to_string())),
                None => (None, None, None),
            };

            // Excluding every configured env (not just dev) keeps the probe
            // honest for branches cut from uat/prd rather than dev.
            if created_at.is_none() {
                if let Some((dt, author)) =
                    first_commit_info(repo_path, &lb.name, existing_env_refs_ref).await
                {
                    created_at = Some(dt);
                    created_by = author;
                    created_at_source = Some("first_commit".to_string());
                }
            }

            let (remote_state, ahead, behind, has_remote) =
                branch_remote_status(repo_path, &lb, remotes_ref, has_remote_configured).await;
            let needs_push = matches!(
                remote_state,
                RemoteState::Ahead | RemoteState::Diverged | RemoteState::Unpublished
            );
            let needs_pull = matches!(remote_state, RemoteState::Behind | RemoteState::Diverged);

            let is_current = current_ref == Some(lb.name.as_str());
            BranchRow {
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
                ahead,
                behind,
                needs_push,
                needs_pull,
                envs: statuses,
            }
        })
        .buffer_unordered(BRANCH_CONCURRENCY)
        .collect()
        .await;

    // `buffer_unordered` completes out of order; sort so the cached JSON and
    // the API response stay deterministic.
    rows.sort_by(|a, b| a.branch.cmp(&b.branch));
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
    let last_fetch_at = last_fetch_at(&repo_path);
    let env_sig = env_config_signature(&envs, configured);
    let fp = ref_fingerprint(&repo_path);
    let cache_key = fp
        .as_ref()
        .map(|f| format!("v{MATRIX_CACHE_VERSION}|{f}|{env_sig}"));

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
                        envs: envs.iter().map(|(k, _)| k.clone()).collect(),
                        branches: rows,
                        last_fetch_at,
                        error: None,
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
        envs: envs.iter().map(|(k, _)| k.clone()).collect(),
        branches: rows,
        last_fetch_at,
        error: None,
    })
}

/// `git fetch --all --prune` for one repo, best effort.
///
/// The board's remote column is only as fresh as the local remote-tracking
/// refs: a branch deleted on the remote keeps looking `synced` (or `ahead`)
/// until a prune drops its ref. A manual refresh therefore prunes first.
///
/// Failures (offline, private remote without cached credentials, slow network)
/// must never fail the scan — they degrade to the offline view. The prompt is
/// disabled and the call is bounded so a stuck fetch cannot hang the board.
async fn prune_remote_refs(repo_path: &str) {
    let mut cmd = crate::process::tokio_command("git");
    cmd.args(["fetch", "--all", "--prune", "--quiet"])
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null());
    match tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output()).await {
        Ok(Ok(out)) if out.status.success() => {}
        Ok(Ok(out)) => tracing::warn!(
            "[branch_board] fetch --prune failed for {repo_path}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ),
        Ok(Err(e)) => {
            tracing::warn!("[branch_board] fetch --prune could not run for {repo_path}: {e}")
        }
        Err(_) => tracing::warn!("[branch_board] fetch --prune timed out for {repo_path}"),
    }
}

/// When this repo last talked to a remote, from the `FETCH_HEAD` mtime, as
/// RFC 3339. Git records no fetch timestamp anywhere else.
fn last_fetch_at(repo_path: &str) -> Option<String> {
    let git_dir = git_dir_no_spawn(repo_path)?;
    let modified = std::fs::metadata(git_dir.join("FETCH_HEAD"))
        .ok()?
        .modified()
        .ok()?;
    let local: chrono::DateTime<chrono::Local> = modified.into();
    Some(local.to_rfc3339())
}

// ─────────────────────────────────────────────────────────────────────────────
// Public core functions
// ─────────────────────────────────────────────────────────────────────────────

pub async fn git_project_branch_matrix_core(
    db: &AppDatabase,
    project_id: i32,
    force: bool,
    fetch: bool,
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
    // A repo that cannot be scanned degrades to an entry carrying `error`
    // instead of failing the request: a project routinely contains repos the
    // current developer has not cloned, and one of those must not blank the
    // whole board. Failures are never cached (`compute_repo_cached` only writes
    // the cache after a successful scan), so a later clone recovers on its own.
    let mut results: Vec<RepoBranchMatrix> = stream::iter(tasks)
        .map(|(repo_id, repo_name, repo_path, envs, configured)| async move {
            // Prune before scanning: a branch deleted on the remote keeps its
            // stale remote-tracking ref (and therefore looks `synced`) until a
            // fetch with `--prune` removes it.
            if fetch {
                prune_remote_refs(&repo_path).await;
            }
            match compute_repo_cached(
                conn,
                repo_id,
                &repo_name,
                repo_path.clone(),
                envs.clone(),
                configured,
                force,
            )
            .await
            {
                Ok(m) => m,
                Err(e) => {
                    tracing::warn!("[branch_board] scanning repo '{repo_name}' failed: {e}");
                    RepoBranchMatrix {
                        repo_id,
                        repo_name,
                        repo_path,
                        envs: envs.iter().map(|(k, _)| k.clone()).collect(),
                        branches: Vec::new(),
                        last_fetch_at: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        })
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
    db: Option<&AppDatabase>,
    path: String,
    worktree_path: String,
) -> Result<(), AppCommandError> {
    let out = git_output(&path, &["worktree", "remove", "--force", &worktree_path]).await?;
    if !out.status.success() {
        // Reported rather than warn-and-Ok: returning success while the
        // checkout is still on disk — and the folder row already deleted —
        // left the next `worktree add` for this path failing with no trace of
        // why. Bail out before touching the database so the two agree.
        return Err(AppCommandError::external_command(
            format!("Failed to remove worktree '{worktree_path}'"),
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
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

/// Update a branch's archive flag and/or note. Omitting an argument leaves that
/// aspect untouched; an empty `description` clears the note.
pub async fn upsert_branch_state_core(
    db: &AppDatabase,
    repo_id: i32,
    branch: String,
    is_archived: Option<bool>,
    description: Option<String>,
) -> Result<BranchStateInfo, AppCommandError> {
    platform_branch_state_service::upsert(&db.conn, repo_id, &branch, is_archived, description)
        .await
        .map_err(AppCommandError::from)
}

/// Pull (fast-forward) a local branch from its configured upstream. When the
/// branch has a remote-tracking counterpart but no tracking config of its own,
/// the uniquely owning remote is adopted via `--set-upstream-to` so the existing
/// `git_update_branch` (which requires an upstream) can run. Never assumes
/// `origin`: an ambiguous or absent counterpart is reported explicitly. An
/// upstream naming a *different* branch (see [`upstream_tracks_branch`]) counts
/// as no upstream at all, so `feat/x` cut from `origin/dev` never pulls `dev`.
pub async fn git_pull_branch_core(
    db: &AppDatabase,
    path: &str,
    branch: &str,
    credentials: Option<&crate::models::GitCredentials>,
    data_dir: &std::path::Path,
) -> Result<crate::commands::folders::GitPullResult, AppCommandError> {
    let tracking = branch_tracking_config(path).await;
    let has_own_upstream = tracking
        .get(branch)
        .is_some_and(|upstream| upstream_tracks_branch(upstream, branch));
    if !has_own_upstream {
        let remotes = remote_branches(path).await;
        let suffix = format!("/{branch}");
        let candidates: Vec<&String> = remotes
            .iter()
            .filter(|r| {
                r.strip_suffix(&suffix)
                    .is_some_and(|remote| !remote.is_empty() && !remote.contains('/'))
            })
            .collect();
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

    // A branch checked out in a LINKED worktree cannot be advanced from here:
    // `git fetch origin x:x` refuses to move a branch that is checked out
    // elsewhere ("refusing to fetch into branch ... checked out at ..."), and
    // upstream's `git_update_branch_core` only recognises the main worktree's
    // HEAD as "checked out". Task branches live in linked worktrees, so run the
    // pull inside the worktree that owns the branch instead.
    let pull_path = checked_out_worktree(path, branch)
        .await
        .unwrap_or_else(|| path.to_string());

    crate::commands::folders::git_update_branch_core(
        &pull_path,
        branch,
        false,
        credentials,
        db,
        data_dir,
    )
    .await
}

/// Delete the remote counterpart of `branch`, resolving the remote exactly the
/// way the board decides a branch is published: its recorded upstream when that
/// names the branch itself and still exists, else the uniquely owning
/// same-named remote branch. A `switch -c feat/x origin/dev` leftover upstream
/// therefore never resolves to `dev`.
///
/// Resolved here rather than in the caller because a branch can be published
/// with no tracking config (e.g. a same-named remote ref was adopted), in which
/// case the frontend has no remote name to pass. Errors when the branch is not
/// published, so a wrong remote is never guessed.
pub async fn git_delete_branch_remote_core(
    path: &str,
    branch: &str,
    credentials: Option<&crate::models::GitCredentials>,
    db: &AppDatabase,
    data_dir: &std::path::Path,
) -> Result<String, AppCommandError> {
    crate::git_repo::ensure_git_repo(path)?;
    ensure_not_option_like("branch", branch)?;

    let remotes = remote_branches(path).await;
    let remote_ref = push_comparison_ref(path, branch, &remotes)
        .await
        .ok_or_else(|| {
            AppCommandError::not_found(format!(
                "Branch '{branch}' has no remote counterpart to delete"
            ))
        })?;
    // `remote_ref` looks like "origin/feat/x": the first path segment is the
    // remote name, the rest is the branch name on that remote.
    let (remote, remote_branch) = remote_ref.split_once('/').ok_or_else(|| {
        AppCommandError::external_command("Unexpected upstream ref", remote_ref.clone())
    })?;

    crate::commands::folders::git_delete_remote_branch_core(
        path,
        remote,
        remote_branch,
        credentials,
        db,
        data_dir,
    )
    .await
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch ↔ environment diff
// ─────────────────────────────────────────────────────────────────────────────

/// The ref a branch is compared against for an environment.
///
/// Both env refs can exist (see [`resolve_env_refs`]); the remote one is the
/// better base when it is at or ahead of the local one, since a stale local
/// copy would otherwise attribute env changes the branch has already merged in
/// to the branch itself. When the local env branch has commits the remote
/// lacks (an unpushed merge), the local one is the more advanced and wins.
async fn diff_base_ref(path: &str, env: &str) -> Result<String, AppCommandError> {
    let remotes = remote_branches(path).await;
    let refs = resolve_env_refs(path, env, &remotes).await;
    match refs.as_slice() {
        [] => Err(AppCommandError::not_found(format!(
            "Environment branch '{env}' was not found locally or on a remote"
        ))),
        [only] => Ok(only.clone()),
        [local, remote, ..] => {
            let remote_is_ahead = git_output(
                path,
                &["merge-base", "--is-ancestor", local.as_str(), remote.as_str()],
            )
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
            let chosen = if remote_is_ahead { remote } else { local };
            Ok(chosen.clone())
        }
    }
}

/// Reject names git would read as an option rather than a revision.
fn ensure_not_option_like(what: &str, value: &str) -> Result<(), AppCommandError> {
    if value.trim().is_empty() || value.starts_with('-') {
        return Err(AppCommandError::invalid_input(format!(
            "Invalid {what}: '{value}'"
        )));
    }
    Ok(())
}

/// Files a branch changes relative to an environment, WITHOUT their contents.
///
/// The diff tab used to fetch the whole patch for every file up front, which is
/// slow for a large branch and pointless when only one file gets opened.
/// `--raw --numstat` returns just names, status and line counts; a file's patch
/// is fetched on demand via [`git_branch_diff_file_core`].
///
/// Three-dot (`base...branch`): only the branch's OWN changes since it diverged,
/// so commits other people landed on the environment do not show up as deletions.
pub async fn git_branch_diff_files_core(
    path: &str,
    branch: &str,
    env: &str,
) -> Result<Vec<crate::commands::folders::GitLogFileChange>, AppCommandError> {
    crate::git_repo::ensure_git_repo(path)?;
    ensure_not_option_like("branch", branch)?;
    ensure_not_option_like("environment branch", env)?;

    let base = diff_base_ref(path, env).await?;
    let range = format!("{base}...{branch}");
    let out = git_output(
        path,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--raw",
            "--numstat",
            "--no-renames",
            "--no-color",
            &range,
        ],
    )
    .await?;
    if !out.status.success() {
        return Err(AppCommandError::external_command(
            "git diff failed",
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(parse_raw_numstat(&String::from_utf8_lossy(&out.stdout)))
}

/// Patch for ONE file of the branch ↔ environment comparison, against the same
/// base as [`git_branch_diff_files_core`] so the list and the patch agree.
pub async fn git_branch_diff_file_core(
    path: &str,
    branch: &str,
    env: &str,
    file: &str,
) -> Result<String, AppCommandError> {
    crate::git_repo::ensure_git_repo(path)?;
    ensure_not_option_like("branch", branch)?;
    ensure_not_option_like("environment branch", env)?;

    let base = diff_base_ref(path, env).await?;
    let range = format!("{base}...{branch}");
    let pathspec = format!(":(literal){file}");
    let out = git_output(
        path,
        &[
            "-c",
            "core.quotePath=false",
            "diff",
            "--no-color",
            &range,
            "--",
            &pathspec,
        ],
    )
    .await?;
    if !out.status.success() {
        return Err(AppCommandError::external_command(
            "git diff failed",
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The remote ref a branch's "pushed" state is measured against: its configured
/// upstream when that names the branch itself and still exists, else the
/// uniquely owning same-named remote branch. `None` when the branch was never
/// published.
///
/// The same-name rule matters beyond display: deleting a branch's remote
/// counterpart goes through here, so trusting `origin/dev` as the counterpart
/// of `feat/x` (a `switch -c feat/x origin/dev` leftover) would delete the
/// environment branch.
async fn push_comparison_ref(
    path: &str,
    branch: &str,
    remotes: &HashSet<String>,
) -> Option<String> {
    let out = git_stdout(
        path,
        &[
            "for-each-ref",
            "--format=%(upstream:short)%09%(upstream:track,nobracket)",
            &format!("refs/heads/{branch}"),
        ],
    )
    .await
    .ok()?;
    let mut parts = out.lines().next().unwrap_or("").splitn(2, '\t');
    let upstream = parts.next().unwrap_or("").trim();
    let track = parts.next().unwrap_or("").trim();
    if !upstream.is_empty()
        && upstream_tracks_branch(upstream, branch)
        && track != "gone"
        && remotes.contains(upstream)
    {
        return Some(upstream.to_string());
    }

    same_name_remote_ref(branch, remotes).map(str::to_string)
}

/// Commits that are on `branch` but in NONE of the environment branches — the
/// branch's own work, i.e. what is still waiting to be released.
///
/// `git log <branch>` lists every ancestor, so a feature branch's history view
/// was dominated by the environment's history from before it was cut, and
/// "load more" paged through the whole repository. Upstream's `git_log` has no
/// way to exclude refs, hence this command; it also reproduces the per-commit
/// `pushed` flag, which the caller would otherwise lose.
///
/// `env_branches` are environment branch NAMES; each contributes its local and
/// remote ref (see [`resolve_env_refs`]). Errors when none of them exist, since
/// an empty exclusion would silently return the full history.
pub async fn git_branch_own_commits_core(
    path: &str,
    branch: &str,
    env_branches: &[String],
    skip: u32,
    limit: u32,
) -> Result<crate::commands::folders::GitLogResult, AppCommandError> {
    use crate::commands::folders::{GitLogEntry, GitLogResult};

    crate::git_repo::ensure_git_repo(path)?;
    ensure_not_option_like("branch", branch)?;
    for env in env_branches {
        ensure_not_option_like("environment branch", env)?;
    }

    let remotes = remote_branches(path).await;
    let mut exclude: Vec<String> = Vec::new();
    for env in env_branches {
        exclude.extend(resolve_env_refs(path, env, &remotes).await);
    }
    exclude.sort();
    exclude.dedup();
    if exclude.is_empty() {
        return Err(AppCommandError::not_found(
            "None of the environment branches were found locally or on a remote",
        ));
    }

    let max = format!("--max-count={limit}");
    let skip_arg = format!("--skip={skip}");
    let mut args: Vec<&str> = vec![
        "-c",
        "core.quotePath=false",
        "log",
        &max,
        &skip_arg,
        "--format=%H%x00%h%x00%an%x00%aI%x00%B%x1e",
        branch,
        "--not",
    ];
    args.extend(exclude.iter().map(String::as_str));
    let out = git_output(path, &args).await?;
    if !out.status.success() {
        return Err(AppCommandError::external_command(
            "git log failed",
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }

    // "Pushed" is measured against the branch's own remote counterpart. The
    // `rev-list` is limited to the same window as the log (skip + limit): both
    // walk in the same order, so every displayed unpushed commit falls inside
    // the first `skip + limit` unpushed ones.
    let remote_ref = push_comparison_ref(path, branch, &remotes).await;
    let unpushed: Option<HashSet<String>> = match remote_ref.as_deref() {
        Some(remote) => {
            let window = format!("--max-count={}", u64::from(skip) + u64::from(limit));
            let mut rl: Vec<&str> = vec!["rev-list", &window, branch, "--not", remote];
            rl.extend(exclude.iter().map(String::as_str));
            git_stdout(path, &rl)
                .await
                .ok()
                .map(|s| s.lines().map(|l| l.trim().to_string()).collect())
        }
        None => None,
    };
    let remote_configured = has_configured_remote(path).await;

    let mut entries = Vec::new();
    for record in String::from_utf8_lossy(&out.stdout).split('\u{1e}') {
        let record = record.trim_start_matches('\n');
        if record.trim().is_empty() {
            continue;
        }
        let mut f = record.splitn(5, '\0');
        let (Some(full), Some(short), Some(author), Some(date), Some(message)) =
            (f.next(), f.next(), f.next(), f.next(), f.next())
        else {
            continue;
        };
        let pushed = match (&remote_ref, &unpushed) {
            (Some(_), Some(set)) => Some(!set.contains(full)),
            // A remote ref exists but the comparison failed: say so, not "pushed".
            (Some(_), None) => None,
            // Never published: unpushed if a remote exists to push to.
            (None, _) => remote_configured.then_some(false),
        };
        entries.push(GitLogEntry {
            hash: short.to_string(),
            full_hash: full.to_string(),
            author: author.to_string(),
            date: date.to_string(),
            message: message.trim_end().to_string(),
            files: Vec::new(),
            pushed,
        });
    }

    Ok(GitLogResult {
        entries,
        has_upstream: remote_ref.is_some(),
    })
}

/// Merge `git diff --raw --numstat` output into one entry per path.
///
/// `--raw` lines look like `:100644 100644 <sha> <sha> M\t<path>` and carry the
/// status; `--numstat` lines look like `<adds>\t<dels>\t<path>` (`-` for binary
/// files). Upstream has an equivalent parser but keeps it private to its own
/// module, so this one is kept here rather than changing a shared file.
pub(crate) fn parse_raw_numstat(stdout: &str) -> Vec<crate::commands::folders::GitLogFileChange> {
    use crate::commands::folders::GitLogFileChange;

    let mut files: Vec<GitLogFileChange> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut slot = |path: &str, files: &mut Vec<GitLogFileChange>| -> usize {
        *index.entry(path.to_string()).or_insert_with(|| {
            files.push(GitLogFileChange {
                path: path.to_string(),
                status: "M".to_string(),
                additions: 0,
                deletions: 0,
            });
            files.len() - 1
        })
    };

    for line in stdout.lines() {
        if line.is_empty() {
            continue;
        }
        if line.starts_with(':') {
            let mut parts = line.splitn(2, '\t');
            let meta = parts.next().unwrap_or("");
            let Some(path) = parts.next() else { continue };
            let status = meta
                .split_whitespace()
                .last()
                .and_then(|s| s.chars().next())
                .unwrap_or('M')
                .to_string();
            let i = slot(path, &mut files);
            files[i].status = status;
            continue;
        }
        let mut parts = line.splitn(3, '\t');
        let (Some(add), Some(del), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let count = |v: &str| v.parse::<u32>().unwrap_or(0);
        let i = slot(path, &mut files);
        files[i].additions = count(add);
        files[i].deletions = count(del);
    }
    files
}

/// Path of the worktree that has `branch` checked out, when that is a worktree
/// other than `path` itself. `None` when the branch is not checked out anywhere
/// or is checked out in `path`'s own worktree (nothing to redirect).
async fn checked_out_worktree(path: &str, branch: &str) -> Option<String> {
    let out = git_stdout(path, &["worktree", "list", "--porcelain"])
        .await
        .ok()?;
    let want = format!("branch refs/heads/{branch}");
    let mut current: Option<&str> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            current = Some(p.trim());
        } else if line.trim() == want {
            let found = current?;
            let same = |a: &str, b: &str| {
                std::fs::canonicalize(a).ok() == std::fs::canonicalize(b).ok()
            };
            return (!same(found, path)).then(|| found.to_string());
        }
    }
    None
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
    fetch: Option<bool>,
) -> Result<Vec<RepoBranchMatrix>, AppCommandError> {
    git_project_branch_matrix_core(
        &db,
        project_id,
        force.unwrap_or(false),
        fetch.unwrap_or(false),
    )
    .await
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
    description: Option<String>,
) -> Result<BranchStateInfo, AppCommandError> {
    upsert_branch_state_core(&db, repo_id, branch, is_archived, description).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_branch_diff_files(
    path: String,
    branch: String,
    env_branch: String,
) -> Result<Vec<crate::commands::folders::GitLogFileChange>, AppCommandError> {
    git_branch_diff_files_core(&path, &branch, &env_branch).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_branch_diff_file(
    path: String,
    branch: String,
    env_branch: String,
    file: String,
) -> Result<String, AppCommandError> {
    git_branch_diff_file_core(&path, &branch, &env_branch, &file).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_branch_own_commits(
    path: String,
    branch: String,
    env_branches: Vec<String>,
    skip: Option<u32>,
    limit: Option<u32>,
) -> Result<crate::commands::folders::GitLogResult, AppCommandError> {
    git_branch_own_commits_core(
        &path,
        &branch,
        &env_branches,
        skip.unwrap_or(0),
        limit.unwrap_or(50),
    )
    .await
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

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn git_delete_branch_remote(
    db: tauri::State<'_, AppDatabase>,
    path: String,
    branch: String,
    credentials: Option<crate::models::GitCredentials>,
    app_handle: tauri::AppHandle,
) -> Result<String, AppCommandError> {
    use tauri::Manager;
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppCommandError::external_command("Failed to resolve app data dir", e.to_string()))?;
    let data_dir = crate::paths::resolve_effective_data_dir(&data_dir);
    git_delete_branch_remote_core(&path, &branch, credentials.as_ref(), &db, &data_dir).await
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
    fn parse_upstream_track_reads_every_git_shape() {
        // Shapes verified against git 2.50 `for-each-ref
        // --format=%(upstream:track,nobracket)`.
        assert_eq!(parse_upstream_track(""), UpstreamTrack::default());
        assert_eq!(
            parse_upstream_track("ahead 1"),
            UpstreamTrack {
                ahead: 1,
                behind: 0,
                gone: false
            }
        );
        assert_eq!(
            parse_upstream_track("behind 3"),
            UpstreamTrack {
                ahead: 0,
                behind: 3,
                gone: false
            }
        );
        assert_eq!(
            parse_upstream_track("ahead 2, behind 5"),
            UpstreamTrack {
                ahead: 2,
                behind: 5,
                gone: false
            }
        );
        assert!(parse_upstream_track("gone").gone);
        // An empty track means "in sync", never "diverged".
        assert_eq!(
            state_from_counts(
                parse_upstream_track("").ahead,
                parse_upstream_track("").behind
            ),
            RemoteState::Synced
        );
    }

    #[test]
    fn parse_raw_numstat_merges_status_and_counts() {
        let out = "\
:000000 100644 0000000 1111111 A\tsrc/new.rs
:100644 100644 2222222 3333333 M\tsrc/old.rs
:100644 000000 4444444 0000000 D\tdocs/gone.md
:100644 100644 5555555 6666666 M\tassets/logo.png
12\t0\tsrc/new.rs
3\t1\tsrc/old.rs
0\t9\tdocs/gone.md
-\t-\tassets/logo.png
";
        let files = parse_raw_numstat(out);
        let by = |p: &str| files.iter().find(|f| f.path == p).expect(p);

        assert_eq!(files.len(), 4, "one entry per path, not one per line");
        assert_eq!(
            (by("src/new.rs").status.as_str(), by("src/new.rs").additions),
            ("A", 12)
        );
        assert_eq!(
            (by("src/old.rs").additions, by("src/old.rs").deletions),
            (3, 1)
        );
        assert_eq!(by("docs/gone.md").status, "D");
        // Binary files report `-` for both counts.
        assert_eq!(
            (by("assets/logo.png").additions, by("assets/logo.png").deletions),
            (0, 0)
        );
        assert!(parse_raw_numstat("").is_empty());
    }

    #[test]
    fn option_like_names_are_rejected() {
        assert!(ensure_not_option_like("branch", "feat/x").is_ok());
        assert!(ensure_not_option_like("branch", "--output=/tmp/x").is_err());
        assert!(ensure_not_option_like("branch", "-D").is_err());
        assert!(ensure_not_option_like("branch", "  ").is_err());
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

    /// Like [`git`], but attributes the commit to `author` so a test can tell
    /// a branch's first committer from its last.
    fn git_as(dir: &std::path::Path, author: &str, args: &[&str]) -> bool {
        std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .env("GIT_AUTHOR_NAME", author)
            .env("GIT_AUTHOR_EMAIL", "a@example.com")
            .env("GIT_COMMITTER_NAME", author)
            .env("GIT_COMMITTER_EMAIL", "a@example.com")
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
    async fn merged_detection_covers_branches_checked_out_in_a_worktree() {
        // `git branch --merged` prefixes a branch that is checked out in a
        // linked worktree with "+". That prefix used to leak into the parsed
        // name, so the branch matched nothing and a fully merged branch was
        // reported as unmerged — the common case here, because worktrees are
        // how this product gives a task its own checkout.
        let repo_dir = tempfile::tempdir().expect("repo");
        let wt_parent = tempfile::tempdir().expect("wt parent");
        init_repo(repo_dir.path());

        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/done"]));
        std::fs::write(repo_dir.path().join("d.txt"), "d\n").expect("write");
        assert!(git(repo_dir.path(), &["add", "-A"]));
        assert!(git(repo_dir.path(), &["commit", "-q", "-m", "d"]));
        assert!(git(repo_dir.path(), &["checkout", "-q", "main"]));
        assert!(git(
            repo_dir.path(),
            &["merge", "-q", "--no-ff", "-m", "merge", "feat/done"]
        ));

        let wt = path_str(&wt_parent.path().join("done-wt"));
        assert!(git(
            repo_dir.path(),
            &["worktree", "add", "-q", &wt, "feat/done"]
        ));

        let envs = vec![("dev".to_string(), "main".to_string())];
        let rows = compute_repo_matrix(&path_str(repo_dir.path()), &envs)
            .await
            .expect("compute_repo_matrix");
        let done = rows
            .iter()
            .find(|r| r.branch == "feat/done")
            .expect("feat/done row");
        let dev = done
            .envs
            .iter()
            .find(|e| e.env == "dev")
            .expect("dev status");
        assert!(
            dev.merged,
            "a merged branch checked out in a linked worktree must still read as merged"
        );
    }

    #[tokio::test]
    async fn merged_means_contained_in_either_the_local_or_the_remote_env_branch() {
        // Each env ref alone is wrong in one direction: the local env branch
        // lags when a teammate merged on the remote and you have not pulled,
        // and the remote lags right after you merged locally and before you
        // pushed. A branch is released if either contains it.
        let work = tempfile::tempdir().expect("work");
        let remote_dir = tempfile::tempdir().expect("remote");
        let other = tempfile::tempdir().expect("other");
        init_repo(work.path());
        // `-b main`: with git config cleared the bare repo's HEAD would default
        // to `master`, and the clone below could not check anything out.
        assert!(git(
            remote_dir.path(),
            &["init", "-q", "--bare", "-b", "main", "r.git"]
        ));
        let bare = path_str(&remote_dir.path().join("r.git"));
        assert!(git(work.path(), &["remote", "add", "origin", &bare]));
        assert!(git(work.path(), &["push", "-q", "-u", "origin", "main"]));

        let commit_on_branch = |name: &str| {
            assert!(git(work.path(), &["checkout", "-q", "-b", name, "main"]));
            std::fs::write(work.path().join(format!("{name}.txt")), "x\n").expect("write");
            assert!(git(work.path(), &["add", "-A"]));
            assert!(git(work.path(), &["commit", "-q", "-m", name]));
            assert!(git(work.path(), &["checkout", "-q", "main"]));
        };
        commit_on_branch("feat/remote-merged");
        commit_on_branch("feat/local-merged");
        commit_on_branch("feat/open");
        assert!(git(
            work.path(),
            &["push", "-q", "origin", "feat/remote-merged"]
        ));

        // A teammate merges feat/remote-merged on the remote; we only fetch, so
        // the local `main` stays behind origin/main.
        assert!(git(
            other.path(),
            &["clone", "-q", &bare, &path_str(&other.path().join("c"))]
        ));
        let c = other.path().join("c");
        assert!(git(&c, &["config", "user.name", "o"]));
        assert!(git(&c, &["config", "user.email", "o@example.com"]));
        assert!(git(
            &c,
            &["merge", "-q", "--no-ff", "-m", "m", "origin/feat/remote-merged"]
        ));
        assert!(git(&c, &["push", "-q", "origin", "main"]));
        assert!(git(work.path(), &["fetch", "-q", "origin"]));

        // We merge feat/local-merged locally and do not push.
        assert!(git(
            work.path(),
            &["merge", "-q", "--no-ff", "-m", "m2", "feat/local-merged"]
        ));

        let envs = vec![("dev".to_string(), "main".to_string())];
        let rows = compute_repo_matrix(&path_str(work.path()), &envs)
            .await
            .expect("compute_repo_matrix");
        let merged_into_dev = |branch: &str| {
            rows.iter()
                .find(|r| r.branch == branch)
                .unwrap_or_else(|| panic!("row {branch}"))
                .envs
                .iter()
                .find(|e| e.env == "dev")
                .expect("dev status")
                .merged
        };

        assert!(
            merged_into_dev("feat/remote-merged"),
            "merged on origin/main only: the stale local main must not hide it"
        );
        assert!(
            merged_into_dev("feat/local-merged"),
            "merged on local main only: the unpushed merge must still count"
        );
        assert!(
            !merged_into_dev("feat/open"),
            "a branch in neither env ref stays unmerged"
        );
    }

    #[tokio::test]
    async fn merge_info_splits_merge_from_fast_forward_and_dates_fast_forward() {
        // Third-round review gap: the merge / fast-forward classification had
        // zero coverage. A `--no-ff` merge reports the merge commit; a plain
        // fast-forward produces no merge commit at all, so its date has to be
        // reconstructed (the env ref's reflog — the moment the pointer moved —
        // or, when that history is absent, the tip's own commit date).
        let repo_dir = tempfile::tempdir().expect("repo");
        init_repo(repo_dir.path());

        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/m"]));
        std::fs::write(repo_dir.path().join("m.txt"), "m\n").expect("write");
        assert!(git(repo_dir.path(), &["add", "-A"]));
        assert!(git(repo_dir.path(), &["commit", "-q", "-m", "m"]));
        assert!(git(repo_dir.path(), &["checkout", "-q", "main"]));
        assert!(git(
            repo_dir.path(),
            &["merge", "-q", "--no-ff", "-m", "m merge", "feat/m"]
        ));

        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/ff"]));
        std::fs::write(repo_dir.path().join("ff.txt"), "ff\n").expect("write");
        assert!(git(repo_dir.path(), &["add", "-A"]));
        assert!(git(repo_dir.path(), &["commit", "-q", "-m", "ff"]));
        assert!(git(repo_dir.path(), &["checkout", "-q", "main"]));
        // Default merge mode: main fast-forwards, no merge commit is created.
        assert!(git(repo_dir.path(), &["merge", "-q", "feat/ff"]));

        let path = path_str(repo_dir.path());
        let (via_m, date_m) = merge_info(&path, "feat/m", "main").await;
        assert_eq!(via_m.as_deref(), Some("merge"));
        assert!(date_m.is_some(), "a real merge must carry its date");

        let (via_ff, date_ff) = merge_info(&path, "feat/ff", "main").await;
        assert_eq!(via_ff.as_deref(), Some("fast_forward"));
        let date_ff =
            date_ff.expect("fast-forward must still carry a landing date");
        let landed = chrono::DateTime::parse_from_rfc3339(&date_ff)
            .expect("rfc3339 landing date");
        // The pointer cannot reach the tip before the tip existed.
        let tip_date = git_stdout(
            &path,
            &["log", "--max-count=1", "--format=%cI", "feat/ff"],
        )
        .await
        .expect("tip date");
        let tip_at = chrono::DateTime::parse_from_rfc3339(tip_date.trim())
            .expect("rfc3339 tip date");
        assert!(
            landed >= tip_at,
            "landing time ({landed}) precedes the tip commit ({tip_at})"
        );
    }

    #[tokio::test]
    async fn own_commits_exclude_the_environment_history() {
        let repo = tempfile::tempdir().expect("repo");
        init_repo(repo.path());
        assert!(git(repo.path(), &["checkout", "-q", "-b", "feat/own"]));
        for (n, author) in [("1", "First"), ("2", "Middle"), ("3", "Last")] {
            std::fs::write(repo.path().join(format!("f{n}.txt")), "x\n").expect("write");
            assert!(git(repo.path(), &["add", "-A"]));
            assert!(git_as(repo.path(), author, &["commit", "-q", "-m", n]));
        }
        // Someone else lands a commit on the environment meanwhile.
        assert!(git(repo.path(), &["checkout", "-q", "main"]));
        std::fs::write(repo.path().join("theirs.txt"), "t\n").expect("write");
        assert!(git(repo.path(), &["add", "-A"]));
        assert!(git(repo.path(), &["commit", "-q", "-m", "theirs"]));

        let path = path_str(repo.path());
        let envs = vec!["main".to_string()];

        let own = git_branch_own_commits_core(&path, "feat/own", &envs, 0, 50)
            .await
            .expect("own commits");
        let authors: Vec<&str> = own.entries.iter().map(|e| e.author.as_str()).collect();
        assert_eq!(
            authors,
            vec!["Last", "Middle", "First"],
            "newest first, and not the base/env commits (plain `git log` returns 5)"
        );

        // Paging walks the same list.
        let page = git_branch_own_commits_core(&path, "feat/own", &envs, 1, 1)
            .await
            .expect("page");
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].author, "Middle");

        // Once merged into the environment, nothing is left that is "its own".
        assert!(git(
            repo.path(),
            &["merge", "-q", "--no-ff", "-m", "m", "feat/own"]
        ));
        let merged = git_branch_own_commits_core(&path, "feat/own", &envs, 0, 50)
            .await
            .expect("merged");
        assert!(merged.entries.is_empty());

        // No environment branch exists: refuse, rather than return full history
        // that the caller would present as "the branch's own commits".
        assert!(
            git_branch_own_commits_core(&path, "feat/own", &["nope".to_string()], 0, 50)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn own_commits_report_whether_each_one_is_pushed() {
        let work = tempfile::tempdir().expect("work");
        let remote_dir = tempfile::tempdir().expect("remote");
        init_repo(work.path());
        assert!(git(
            remote_dir.path(),
            &["init", "-q", "--bare", "-b", "main", "r.git"]
        ));
        let bare = path_str(&remote_dir.path().join("r.git"));
        assert!(git(work.path(), &["remote", "add", "origin", &bare]));
        assert!(git(work.path(), &["push", "-q", "-u", "origin", "main"]));
        assert!(git(work.path(), &["checkout", "-q", "-b", "feat/p"]));

        let commit = |n: &str| {
            std::fs::write(work.path().join(format!("{n}.txt")), "x\n").expect("write");
            assert!(git(work.path(), &["add", "-A"]));
            assert!(git(work.path(), &["commit", "-q", "-m", n]));
        };
        commit("pushed-1");
        commit("pushed-2");
        assert!(git(work.path(), &["push", "-q", "-u", "origin", "feat/p"]));
        commit("local-only");

        let path = path_str(work.path());
        let res = git_branch_own_commits_core(&path, "feat/p", &["main".to_string()], 0, 50)
            .await
            .expect("own commits");
        assert!(res.has_upstream);
        let flags: Vec<(String, Option<bool>)> = res
            .entries
            .iter()
            .map(|e| (e.message.clone(), e.pushed))
            .collect();
        assert_eq!(
            flags,
            vec![
                ("local-only".to_string(), Some(false)),
                ("pushed-2".to_string(), Some(true)),
                ("pushed-1".to_string(), Some(true)),
            ]
        );

        // A branch that was never published: every commit is unpushed (a remote
        // exists to push to), and there is no upstream.
        assert!(git(work.path(), &["checkout", "-q", "-b", "feat/new", "main"]));
        commit("brand-new");
        let fresh = git_branch_own_commits_core(&path, "feat/new", &["main".to_string()], 0, 50)
            .await
            .expect("unpublished");
        assert!(!fresh.has_upstream);
        assert_eq!(fresh.entries[0].pushed, Some(false));
    }

    #[tokio::test]
    async fn branch_diff_lists_only_the_branchs_own_changes() {
        // Two-dot (`env..branch` / `git diff env branch`) would list the file
        // someone else landed on the environment as a DELETION in the branch.
        // Three-dot shows only what the branch itself changed.
        let repo = tempfile::tempdir().expect("repo");
        init_repo(repo.path());
        assert!(git(repo.path(), &["checkout", "-q", "-b", "feat/mine"]));
        std::fs::write(repo.path().join("mine.txt"), "mine\n").expect("write");
        assert!(git(repo.path(), &["add", "-A"]));
        assert!(git(repo.path(), &["commit", "-q", "-m", "mine"]));
        assert!(git(repo.path(), &["checkout", "-q", "main"]));
        std::fs::write(repo.path().join("theirs.txt"), "theirs\n").expect("write");
        assert!(git(repo.path(), &["add", "-A"]));
        assert!(git(repo.path(), &["commit", "-q", "-m", "theirs"]));

        let path = path_str(repo.path());
        let files = git_branch_diff_files_core(&path, "feat/mine", "main")
            .await
            .expect("diff files");
        let names: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(names, vec!["mine.txt"], "only the branch's own change");
        assert_eq!(files[0].status, "A");
        assert_eq!(files[0].additions, 1);

        // The per-file patch uses the same base, so it agrees with the list.
        let patch = git_branch_diff_file_core(&path, "feat/mine", "main", "mine.txt")
            .await
            .expect("diff file");
        assert!(patch.contains("+mine"), "patch was: {patch}");
        assert!(!patch.contains("theirs"));

        // A missing environment branch is a clear error, not an empty diff.
        assert!(git_branch_diff_files_core(&path, "feat/mine", "no-such-env")
            .await
            .is_err());
    }

    #[tokio::test]
    async fn pull_is_redirected_to_the_worktree_that_owns_the_branch() {
        // `git fetch origin x:x` refuses to advance a branch checked out in a
        // linked worktree, so the pull must run inside that worktree. This
        // pins the lookup that decides where.
        let repo_dir = tempfile::tempdir().expect("repo");
        let wt_parent = tempfile::tempdir().expect("wt parent");
        init_repo(repo_dir.path());
        assert!(git(repo_dir.path(), &["branch", "feat/wt"]));
        assert!(git(repo_dir.path(), &["branch", "feat/free"]));
        let wt = wt_parent.path().join("feat-wt");
        assert!(git(
            repo_dir.path(),
            &["worktree", "add", "-q", &path_str(&wt), "feat/wt"]
        ));
        let repo = path_str(repo_dir.path());

        let found = checked_out_worktree(&repo, "feat/wt")
            .await
            .expect("feat/wt is checked out in a linked worktree");
        assert_eq!(
            std::fs::canonicalize(&found).expect("canonicalize found"),
            std::fs::canonicalize(&wt).expect("canonicalize wt"),
        );
        // Checked out in the main worktree itself: nothing to redirect.
        assert_eq!(checked_out_worktree(&repo, "main").await, None);
        // Not checked out anywhere.
        assert_eq!(checked_out_worktree(&repo, "feat/free").await, None);
    }

    #[tokio::test]
    async fn created_at_fallback_reports_the_first_commit_not_the_last() {
        // With no reflog entry (every fetched or cloned branch), creation info
        // falls back to the branch's own first commit. `git log --reverse -1`
        // returns the NEWEST commit instead, because commit limiting is applied
        // before the reversal — which mislabeled the last committer as the
        // branch's creator.
        let repo_dir = tempfile::tempdir().expect("repo");
        init_repo(repo_dir.path());
        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/multi"]));
        for (n, author) in [("1", "First"), ("2", "Middle"), ("3", "Last")] {
            std::fs::write(repo_dir.path().join(format!("f{n}.txt")), "x\n").expect("write");
            assert!(git(repo_dir.path(), &["add", "-A"]));
            assert!(git_as(repo_dir.path(), author, &["commit", "-q", "-m", n]));
        }

        // Simulate a fetched branch: no local "branch: Created from" entry.
        std::fs::remove_dir_all(repo_dir.path().join(".git").join("logs"))
            .expect("drop reflog");

        let envs = vec![("dev".to_string(), "main".to_string())];
        let rows = compute_repo_matrix(&path_str(repo_dir.path()), &envs)
            .await
            .expect("compute_repo_matrix");
        let row = rows
            .iter()
            .find(|r| r.branch == "feat/multi")
            .expect("feat/multi row");

        assert_eq!(row.created_at_source.as_deref(), Some("first_commit"));
        assert_eq!(
            row.created_by.as_deref(),
            Some("First"),
            "the fallback must report the branch's first commit, not its latest"
        );
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

    /// A repo whose `main` is published and whose `feat/new` was cut with
    /// `git switch -c feat/new origin/main`, which records `origin/main` as
    /// the new branch's upstream. Returns the repo path.
    async fn repo_with_branch_tracking_another_branch() -> (tempfile::TempDir, String) {
        let repo_dir = tempfile::tempdir().expect("repo");
        let remote_dir = tempfile::tempdir().expect("remote");
        init_repo(repo_dir.path());
        assert!(git(remote_dir.path(), &["init", "-q", "--bare", "r.git"]));
        let bare = path_str(&remote_dir.path().join("r.git"));
        assert!(git(repo_dir.path(), &["remote", "add", "origin", &bare]));
        assert!(git(repo_dir.path(), &["push", "-q", "-u", "origin", "main"]));
        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/new"]));
        assert!(git(
            repo_dir.path(),
            &["branch", "--set-upstream-to=origin/main", "feat/new"]
        ));
        let path = path_str(repo_dir.path());
        (repo_dir, path)
    }

    #[tokio::test]
    async fn remote_status_ignores_upstream_naming_another_branch() {
        // Measuring `feat/new` against `origin/main` reported a never-pushed
        // branch as `synced` whenever it sat on the same commit, and hid the
        // "local" badge — the branch has no remote counterpart at all.
        let (_repo, path) = repo_with_branch_tracking_another_branch().await;
        let row = row_for(&path, "feat/new").await;
        assert_eq!(
            row.remote_state,
            RemoteState::Unpublished,
            "a differently-named upstream is not this branch's counterpart"
        );
        assert!(!row.has_remote);
        assert!(row.needs_push);
        // The raw config is still reported, it just does not drive the state.
        assert_eq!(row.upstream.as_deref(), Some("origin/main"));
    }

    #[tokio::test]
    async fn push_comparison_ignores_upstream_naming_another_branch() {
        // Deleting the remote counterpart resolves through this helper, so
        // trusting `origin/main` would delete `main` on the remote.
        let (repo_dir, path) = repo_with_branch_tracking_another_branch().await;
        let remotes = remote_branches(&path).await;
        assert_eq!(push_comparison_ref(&path, "feat/new", &remotes).await, None);

        // Once published under its own name, the ordinary path applies again.
        assert!(git(repo_dir.path(), &["push", "-q", "-u", "origin", "feat/new"]));
        let remotes = remote_branches(&path).await;
        assert_eq!(
            push_comparison_ref(&path, "feat/new", &remotes).await.as_deref(),
            Some("origin/feat/new")
        );
    }

    #[tokio::test]
    async fn prune_remote_refs_drops_refs_of_branches_deleted_on_the_remote() {
        // A branch deleted on the remote keeps its stale remote-tracking ref, so
        // the row would keep reporting `synced` forever. The board's refresh
        // prunes; the row must then read as never published.
        let repo_dir = tempfile::tempdir().expect("repo");
        let remote_dir = tempfile::tempdir().expect("remote");
        init_repo(repo_dir.path());
        assert!(git(remote_dir.path(), &["init", "-q", "--bare", "r.git"]));
        let bare = path_str(&remote_dir.path().join("r.git"));
        assert!(git(repo_dir.path(), &["remote", "add", "origin", &bare]));
        assert!(git(repo_dir.path(), &["push", "-q", "-u", "origin", "main"]));
        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/gone"]));
        assert!(git(repo_dir.path(), &["push", "-q", "-u", "origin", "feat/gone"]));

        let path = path_str(repo_dir.path());
        assert_eq!(row_for(&path, "feat/gone").await.remote_state, RemoteState::Synced);

        assert!(git(
            &remote_dir.path().join("r.git"),
            &["branch", "-D", "feat/gone"]
        ));
        prune_remote_refs(&path).await;

        let row = row_for(&path, "feat/gone").await;
        assert_eq!(row.remote_state, RemoteState::Unpublished);
        assert!(!row.has_remote);
        assert!(row.needs_push);
    }

    #[tokio::test]
    async fn last_fetch_at_reports_none_until_the_repo_talks_to_a_remote() {
        let bare_dir = tempfile::tempdir().expect("bare");
        init_repo(bare_dir.path());
        let path = path_str(bare_dir.path());
        assert_eq!(last_fetch_at(&path), None);

        let remote_dir = tempfile::tempdir().expect("remote");
        assert!(git(remote_dir.path(), &["init", "-q", "--bare", "r.git"]));
        let bare = path_str(&remote_dir.path().join("r.git"));
        assert!(git(bare_dir.path(), &["remote", "add", "origin", &bare]));
        assert!(git(bare_dir.path(), &["fetch", "-q", "origin"]));

        let at = last_fetch_at(&path).expect("FETCH_HEAD written by fetch");
        assert!(chrono::DateTime::parse_from_rfc3339(&at).is_ok());
    }

    #[tokio::test]
    async fn fresh_cut_branch_is_not_reported_as_merged_into_its_base() {
        // A branch cut from the env and not committed to yet is an ancestor of
        // the env, so `--merged` lists it. Showing "merged · <env tip date>"
        // there is misleading: nothing of the branch has been released.
        let repo_dir = tempfile::tempdir().expect("repo");
        init_repo(repo_dir.path());
        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/fresh"]));

        let envs = vec![("dev".to_string(), "main".to_string())];
        let rows = compute_repo_matrix(&path_str(repo_dir.path()), &envs)
            .await
            .expect("compute_repo_matrix");
        let fresh = rows
            .iter()
            .find(|r| r.branch == "feat/fresh")
            .expect("feat/fresh row");
        let dev = fresh.envs.iter().find(|e| e.env == "dev").expect("dev cell");
        assert!(!dev.merged);
        assert_eq!(dev.merge_via, None);
        assert_eq!(dev.merge_date, None);
    }

    #[tokio::test]
    async fn fast_forward_merged_branch_still_reports_merged() {
        // The fresh-cut rule must not hide a real fast-forward merge: that one
        // moved the branch's own ref after creation.
        let repo_dir = tempfile::tempdir().expect("repo");
        init_repo(repo_dir.path());
        assert!(git(repo_dir.path(), &["checkout", "-q", "-b", "feat/ff"]));
        std::fs::write(repo_dir.path().join("f.txt"), "f\n").expect("write");
        assert!(git(repo_dir.path(), &["add", "-A"]));
        assert!(git(repo_dir.path(), &["commit", "-q", "-m", "f"]));
        assert!(git(repo_dir.path(), &["checkout", "-q", "main"]));
        assert!(git(repo_dir.path(), &["merge", "-q", "--ff-only", "feat/ff"]));

        let envs = vec![("dev".to_string(), "main".to_string())];
        let rows = compute_repo_matrix(&path_str(repo_dir.path()), &envs)
            .await
            .expect("compute_repo_matrix");
        let ff = rows
            .iter()
            .find(|r| r.branch == "feat/ff")
            .expect("feat/ff row");
        let dev = ff.envs.iter().find(|e| e.env == "dev").expect("dev cell");
        assert!(dev.merged);
        assert_eq!(dev.merge_via.as_deref(), Some("fast_forward"));
        assert!(dev.merge_date.is_some());
    }
}
