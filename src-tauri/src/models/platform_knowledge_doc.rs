use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocInfo {
    pub id: i32,
    pub project_id: i32,
    pub doc_type: String,
    pub title: String,
    pub file_path: String,
    pub is_shared: bool,
    pub tags_json: Option<String>,
    pub description: Option<String>,
    pub skill_name: Option<String>,
    pub task_id: Option<i32>,
    pub last_scanned_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateKnowledgeDocDraft {
    pub project_id: i32,
    #[serde(default = "default_doc_type")]
    pub doc_type: String,
    pub title: String,
    pub file_path: String,
    #[serde(default)]
    pub is_shared: bool,
    pub tags_json: Option<String>,
    pub description: Option<String>,
    pub skill_name: Option<String>,
    pub task_id: Option<i32>,
}

fn default_doc_type() -> String {
    "tech_doc".to_string()
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKnowledgeDocDraft {
    pub doc_type: Option<String>,
    pub title: Option<String>,
    pub is_shared: Option<bool>,
    pub tags_json: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub skill_name: Option<Option<String>>,
    pub task_id: Option<Option<i32>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertKnowledgeDocDraft {
    pub project_id: i32,
    #[serde(default = "default_doc_type")]
    pub doc_type: String,
    pub title: String,
    pub file_path: String,
    #[serde(default)]
    pub is_shared: bool,
    pub tags_json: Option<String>,
    pub description: Option<String>,
    pub skill_name: Option<String>,
    pub task_id: Option<i32>,
}
