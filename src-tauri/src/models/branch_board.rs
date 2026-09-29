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
    pub last_commit_at: Option<String>,
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
    pub branches: Vec<BranchRow>,
}