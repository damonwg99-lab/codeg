use chrono::{DateTime, Utc};
use super::AgentType;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInfo {
    pub id: i32,
    pub project_id: i32,
    pub parent_task_id: Option<i32>,
    pub title: String,
    pub description: Option<String>,
    pub task_type: String,
    pub status: String,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub zentao_id: Option<i32>,
    pub zentao_type: Option<String>,
    pub zentao_sync_status: Option<String>,
    pub deadline: Option<DateTime<Utc>>,
    pub estimated_hours: Option<f64>,
    pub consumed_hours: Option<f64>,
    pub zentao_module: Option<String>,
    pub kb_refs_json: Option<String>,
    pub affected_repos_json: Option<String>,
    pub delegation_config: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    pub task: TaskInfo,
    pub conversations: Vec<TaskConversationInfo>,
    pub sub_tasks: Vec<TaskInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConversationInfo {
    pub id: i32,
    pub task_id: i32,
    pub conversation_id: i32,
    pub conversation_role: String,
    pub summary: Option<String>,
    pub injected_docs_json: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConversationLaunchInfo {
    pub conversation_id: i32,
    pub folder_id: i32,
    pub agent_type: AgentType,
    pub title: String,
    pub link: TaskConversationInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTypeMappingInfo {
    pub id: i32,
    pub local_type: String,
    pub zentao_type: String,
    pub zentao_module: Option<String>,
    pub project_id: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDecompositionInfo {
    pub id: i32,
    pub source_task_id: i32,
    pub ai_generated: bool,
    pub decomposition_json: Option<String>,
    pub created_at: DateTime<Utc>,
}
