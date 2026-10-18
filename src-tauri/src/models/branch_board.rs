use serde::{Deserialize, Serialize};

/// One environment's merge status for a branch, derived from git.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvMergeStatus {
    /// "dev" | "uat" | "prd"
    pub env: String,
    pub merged: bool,
    /// "merge" | "fast_forward" (None while unmerged / unknown)
    pub merge_via: Option<String>,
    pub merge_date: Option<String>,
}

/// Relationship between a local branch and its remote counterpart(s).
///
/// Kept explicit so the UI never has to guess "Synced" from two booleans: a
/// failed or ambiguous git probe maps to [`RemoteState::Unknown`], which is
/// distinct from a genuine zero-ahead/zero-behind [`RemoteState::Synced`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteState {
    /// The repository has no remotes configured at all.
    NoRemote,
    /// Remotes exist but none has a branch of this name yet (never pushed).
    Unpublished,
    /// Local and its remote counterpart point at the same commit.
    Synced,
    /// Local has commits the remote counterpart lacks.
    Ahead,
    /// The remote counterpart has commits the local branch lacks.
    Behind,
    /// Both sides have commits the other lacks.
    Diverged,
    /// Could not be determined (probe failed or the owner remote is ambiguous).
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRow {
    pub branch: String,
    pub created_at: Option<String>,
    /// "reflog" | "first_commit" (approximation source)
    pub created_at_source: Option<String>,
    pub is_env_branch: bool,
    /// Whether this is the branch checked out in the repo's main worktree.
    pub is_current: bool,
    pub last_commit_at: Option<String>,
    /// Who created the branch (from the local reflog; None for cloned/fetched).
    pub created_by: Option<String>,
    /// Tracked upstream, e.g. "origin/feat/x" (None when untracked).
    pub upstream: Option<String>,
    /// Whether a remote-tracking branch for this name exists (any remote).
    pub has_remote: bool,
    /// Explicit remote relationship, distinguishing the cases the two boolean
    /// flags below cannot (see [`RemoteState`]).
    pub remote_state: RemoteState,
    /// Commits the local branch has that its remote counterpart lacks.
    pub ahead: i64,
    /// Commits the remote counterpart has that the local branch lacks.
    pub behind: i64,
    /// Whether the local branch has commits its remote counterpart lacks.
    /// True for `Ahead`, `Diverged`, and `Unpublished` (nothing pushed at all).
    pub needs_push: bool,
    /// Whether the local branch is behind its remote counterpart.
    /// True for `Behind` and `Diverged`.
    pub needs_pull: bool,
    pub envs: Vec<EnvMergeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoBranchMatrix {
    pub repo_id: i32,
    pub repo_name: String,
    pub repo_path: String,
    /// Configured environment keys for this repo, e.g. ["uat", "prd"].
    pub envs: Vec<String>,
    pub branches: Vec<BranchRow>,
    /// Why this repo could not be scanned (missing checkout, broken git, …).
    ///
    /// A project may legitimately contain repos the current developer has not
    /// cloned, so one unreadable repo must never fail the whole matrix: it is
    /// reported here with an empty `branches` list while the rest stay usable.
    pub error: Option<String>,
}