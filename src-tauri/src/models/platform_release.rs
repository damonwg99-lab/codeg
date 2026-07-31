use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub id: i32,
    pub project_id: i32,
    pub repo_name: String,
    pub branch: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseInfo {
    pub id: i32,
    pub project_id: i32,
    pub release_code: String,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub status: String,
    pub deployer: Option<String>,
    pub branch_count: i32,
    pub prd_deployed_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
    pub ci_job_id: Option<String>,
    pub ci_webhook_url: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseDetail {
    pub release: ReleaseInfo,
    pub items: Vec<ReleaseItemInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseItemInfo {
    pub id: i32,
    pub release_id: i32,
    pub branch_id: i32,
    pub repo_name: String,
    pub branch: String,
    pub branch_status: String,
    pub task_id: Option<i32>,
    pub task_title: Option<String>,
    pub external_ref_json: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateReleaseParams {
    pub project_id: i32,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub deployer: Option<String>,
    pub branch_ids: Vec<i32>,
    pub external_refs_json: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateReleaseParams {
    pub id: i32,
    pub status: Option<String>,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub deployer: Option<String>,
}

impl From<crate::db::entities::platform_release::Model> for ReleaseInfo {
    fn from(m: crate::db::entities::platform_release::Model) -> Self {
        Self {
            id: m.id,
            project_id: m.project_id,
            release_code: m.release_code,
            title: m.title,
            notes: m.notes,
            status: m.status,
            deployer: m.deployer,
            branch_count: 0,
            prd_deployed_at: m.prd_deployed_at,
            closed_at: m.closed_at,
            ci_job_id: m.ci_job_id,
            ci_webhook_url: m.ci_webhook_url,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}

impl From<crate::db::entities::platform_branch::Model> for BranchInfo {
    fn from(m: crate::db::entities::platform_branch::Model) -> Self {
        Self {
            id: m.id,
            project_id: m.project_id,
            repo_name: m.repo_name,
            branch: m.branch,
            status: m.status,
            created_at: m.created_at,
            updated_at: m.updated_at,
        }
    }
}
