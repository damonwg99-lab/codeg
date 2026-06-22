use chrono::{DateTime, Utc};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub client_name: Option<String>,
    pub status: String,
    pub root_dir: String,
    pub folder_id: Option<i32>,
    pub zentao_project_id: Option<i32>,
    pub zentao_product_id: Option<i32>,
    pub jenkins_url: Option<String>,
    pub kb_repo_url: Option<String>,
    pub kb_local_dir: Option<String>,
    pub default_agent_type: Option<String>,
    pub delegation_config: Option<String>,
    pub agent_config_json: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: ProjectInfo,
    pub repos: Vec<ProjectRepoInfo>,
    pub task_count_by_status: TaskCountByStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCountByStatus {
    pub backlog: i32,
    pub confirmed: i32,
    pub in_progress: i32,
    pub done: i32,
    pub released: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRepoInfo {
    pub id: i32,
    pub project_id: i32,
    pub name: String,
    pub git_url: String,
    pub local_dir: String,
    pub branch: Option<String>,
    pub has_claude_md: bool,
    pub folder_id: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoScanResult {
    pub name: String,
    pub local_dir: String,
    pub git_url: Option<String>,
    pub has_claude_md: bool,
}
