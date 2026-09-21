use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchStateInfo {
    pub id: i32,
    pub repo_id: i32,
    pub branch: String,
    pub is_archived: bool,
    pub archived_at: Option<DateTime<Utc>>,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}