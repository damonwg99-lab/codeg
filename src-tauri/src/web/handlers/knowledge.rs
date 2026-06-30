//! Knowledge base web handlers for Axum (server + desktop web mode).
//! JSON handlers + multipart upload handlers.

use std::sync::Arc;

use axum::{
    extract::{Extension, Multipart},
    Json,
};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::knowledge as knowledge_commands;
use crate::models::{
    KnowledgeDocInfo, KbInitResult, ScanResultInfo, SkillInfo, UpdateKnowledgeDocDraft,
};

// ─── Param structs ───

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanKnowledgeRepoParams {
    pub project_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListKnowledgeDocsParams {
    pub project_id: i32,
    pub doc_type_filter: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchKnowledgeDocsParams {
    pub project_id: i32,
    pub query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetKnowledgeDocParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKnowledgeDocParams {
    pub id: i32,
    pub doc_type: Option<String>,
    pub title: Option<String>,
    pub is_shared: Option<bool>,
    pub tags_json: Option<Option<String>>,
    pub description: Option<Option<String>>,
    pub skill_name: Option<Option<String>>,
    pub task_id: Option<Option<i32>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteKnowledgeDocParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSkillsParams {
    pub project_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitKnowledgeRepoParams {
    pub project_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadKbDocContentParams {
    pub id: i32,
}

// ─── Handlers ───

pub async fn scan_knowledge_repo(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ScanKnowledgeRepoParams>,
) -> Result<Json<ScanResultInfo>, AppCommandError> {
    Ok(Json(
        knowledge_commands::scan_knowledge_repo_core(&state.db, params.project_id).await?,
    ))
}

pub async fn list_knowledge_docs(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListKnowledgeDocsParams>,
) -> Result<Json<Vec<KnowledgeDocInfo>>, AppCommandError> {
    Ok(Json(
        knowledge_commands::list_knowledge_docs_core(
            &state.db,
            params.project_id,
            params.doc_type_filter,
        )
        .await?,
    ))
}

pub async fn search_knowledge_docs(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SearchKnowledgeDocsParams>,
) -> Result<Json<Vec<KnowledgeDocInfo>>, AppCommandError> {
    Ok(Json(
        knowledge_commands::search_knowledge_docs_core(&state.db, params.project_id, params.query)
            .await?,
    ))
}

pub async fn get_knowledge_doc(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetKnowledgeDocParams>,
) -> Result<Json<KnowledgeDocInfo>, AppCommandError> {
    Ok(Json(
        knowledge_commands::get_knowledge_doc_core(&state.db, params.id).await?,
    ))
}

pub async fn update_knowledge_doc(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateKnowledgeDocParams>,
) -> Result<Json<KnowledgeDocInfo>, AppCommandError> {
    let draft = UpdateKnowledgeDocDraft {
        doc_type: params.doc_type,
        title: params.title,
        is_shared: params.is_shared,
        tags_json: params.tags_json,
        description: params.description,
        skill_name: params.skill_name,
        task_id: params.task_id,
    };
    Ok(Json(
        knowledge_commands::update_knowledge_doc_core(&state.db, params.id, draft).await?,
    ))
}

pub async fn delete_knowledge_doc(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DeleteKnowledgeDocParams>,
) -> Result<Json<()>, AppCommandError> {
    knowledge_commands::delete_knowledge_doc_core(&state.db, params.id).await?;
    Ok(Json(()))
}

pub async fn list_skills(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListSkillsParams>,
) -> Result<Json<Vec<SkillInfo>>, AppCommandError> {
    Ok(Json(
        knowledge_commands::list_skills_core(&state.db, params.project_id).await?,
    ))
}

pub async fn init_knowledge_repo(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<InitKnowledgeRepoParams>,
) -> Result<Json<KbInitResult>, AppCommandError> {
    Ok(Json(
        knowledge_commands::init_knowledge_repo_core(&state.db, params.project_id).await?,
    ))
}

pub async fn read_kb_doc_content(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ReadKbDocContentParams>,
) -> Result<Json<String>, AppCommandError> {
    Ok(Json(
        knowledge_commands::read_kb_doc_content_core(&state.db, params.id).await?,
    ))
}

// ─── Multipart upload handlers ───

/// Upload a document to the knowledge base.
///
/// Expected multipart fields:
/// - `project_id` (text) — project ID
/// - `target_dir` (text) — target directory within _knowledge/
/// - `file` (file) — the file to upload
pub async fn upload_kb_doc(
    Extension(state): Extension<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<KnowledgeDocInfo>, AppCommandError> {
    let mut project_id: Option<i32> = None;
    let mut target_dir: Option<String> = None;
    let mut file_name: Option<String> = None;
    let mut content_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppCommandError::invalid_input("Invalid multipart upload").with_detail(e.to_string()))?
    {
        match field.name() {
            Some("project_id") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppCommandError::invalid_input("Failed to read project_id").with_detail(e.to_string()))?;
                project_id = Some(text.parse::<i32>().map_err(|e| {
                    AppCommandError::invalid_input("Invalid project_id").with_detail(e.to_string())
                })?);
            }
            Some("target_dir") => {
                target_dir = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppCommandError::invalid_input("Failed to read target_dir").with_detail(e.to_string()))?,
                );
            }
            Some("file") => {
                file_name = Some(
                    field
                        .file_name()
                        .unwrap_or("untitled")
                        .to_string(),
                );
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppCommandError::io_error("Failed to read file bytes").with_detail(e.to_string()))?;
                content_bytes = Some(bytes.to_vec());
            }
            _ => {} // Skip unknown fields
        }
    }

    let project_id = project_id.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing project_id field")
    })?;
    let target_dir = target_dir.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing target_dir field")
    })?;
    let file_name = file_name.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing file field")
    })?;
    let content_bytes = content_bytes.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing file content")
    })?;

    Ok(Json(
        knowledge_commands::upload_kb_doc_core(
            &state.db,
            project_id,
            target_dir,
            file_name,
            content_bytes,
        )
        .await?,
    ))
}

/// Upload a task attachment.
///
/// Expected multipart fields:
/// - `project_id` (text) — project ID
/// - `task_id` (text) — task ID
/// - `file` (file) — the file to upload
pub async fn upload_task_attachment(
    Extension(state): Extension<Arc<AppState>>,
    mut multipart: Multipart,
) -> Result<Json<KnowledgeDocInfo>, AppCommandError> {
    let mut project_id: Option<i32> = None;
    let mut task_id: Option<i32> = None;
    let mut file_name: Option<String> = None;
    let mut content_bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppCommandError::invalid_input("Invalid multipart upload").with_detail(e.to_string()))?
    {
        match field.name() {
            Some("project_id") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppCommandError::invalid_input("Failed to read project_id").with_detail(e.to_string()))?;
                project_id = Some(text.parse::<i32>().map_err(|e| {
                    AppCommandError::invalid_input("Invalid project_id").with_detail(e.to_string())
                })?);
            }
            Some("task_id") => {
                let text = field
                    .text()
                    .await
                    .map_err(|e| AppCommandError::invalid_input("Failed to read task_id").with_detail(e.to_string()))?;
                task_id = Some(text.parse::<i32>().map_err(|e| {
                    AppCommandError::invalid_input("Invalid task_id").with_detail(e.to_string())
                })?);
            }
            Some("file") => {
                file_name = Some(
                    field
                        .file_name()
                        .unwrap_or("untitled")
                        .to_string(),
                );
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|e| AppCommandError::io_error("Failed to read file bytes").with_detail(e.to_string()))?;
                content_bytes = Some(bytes.to_vec());
            }
            _ => {} // Skip unknown fields
        }
    }

    let project_id = project_id.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing project_id field")
    })?;
    let task_id = task_id.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing task_id field")
    })?;
    let file_name = file_name.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing file field")
    })?;
    let content_bytes = content_bytes.ok_or_else(|| {
        AppCommandError::invalid_input("Multipart upload missing file content")
    })?;

    Ok(Json(
        knowledge_commands::upload_task_attachment_core(
            &state.db,
            project_id,
            task_id,
            file_name,
            content_bytes,
        )
        .await?,
    ))
}
