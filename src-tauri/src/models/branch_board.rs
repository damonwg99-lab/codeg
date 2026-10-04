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
    pub ahead: i64,
    pub behind: i64,
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
    /// Whether a remote branch `origin/<branch>` exists.
    pub has_remote: bool,
    /// Whether the local branch has commits its remote counterpart lacks.
    pub needs_push: bool,
    /// Whether the local branch is behind its remote counterpart.
    pub needs_pull: bool,
    pub envs: Vec<EnvMergeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoBranchMatrix {
    pub repo_id: i32,
    pub repo_name: String,
    pub repo_path: String,
    /// Whether at least one environment branch is configured for this repo.
    pub configured: bool,
    /// Configured environment keys for this repo, e.g. ["uat", "prd"].
    pub envs: Vec<String>,
    pub branches: Vec<BranchRow>,
}