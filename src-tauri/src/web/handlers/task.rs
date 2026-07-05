use std::sync::Arc;

use axum::{
    extract::Extension,
    Json,
};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::task as task_commands;
use crate::models::{
    TaskConversationInfo, TaskConversationLaunchInfo, TaskDecompositionInfo, TaskDetail, TaskInfo,
    TaskTypeMappingInfo,
};

// ─── Param structs ───

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksParams {
    pub project_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskParams {
    pub project_id: i32,
    pub title: String,
    pub task_type: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub assignee: Option<String>,
    pub parent_task_id: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskParams {
    pub id: i32,
    pub title: Option<String>,
    pub description: Option<String>,
    pub task_type: Option<String>,
    pub status: Option<String>,
    pub priority: Option<Option<String>>,
    pub assignee: Option<Option<String>>,
    pub parent_task_id: Option<Option<i32>>,
    pub zentao_id: Option<Option<i32>>,
    pub zentao_type: Option<Option<String>>,
    pub zentao_sync_status: Option<Option<String>>,
    pub deadline: Option<Option<String>>,
    pub estimated_hours: Option<Option<f64>>,
    pub consumed_hours: Option<Option<f64>>,
    pub zentao_module: Option<Option<String>>,
    pub kb_refs_json: Option<Option<String>>,
    pub affected_repos_json: Option<Option<String>>,
    pub delegation_config: Option<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskStatusParams {
    pub id: i32,
    pub status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkConversationParams {
    pub task_id: i32,
    pub conversation_id: i32,
    pub role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationForTaskParams {
    pub task_id: i32,
    pub injected_docs_json: Option<String>,
    /// When provided, use this agent type instead of the project's default.
    pub agent_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlinkConversationParams {
    pub task_id: i32,
    pub conversation_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskConversationsParams {
    pub task_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTaskByConversationParams {
    pub conversation_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListTaskTypeMappingsParams {
    pub project_id: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskTypeMappingParams {
    pub local_type: String,
    pub zentao_type: String,
    pub zentao_module: Option<String>,
    pub project_id: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskTypeMappingParams {
    pub id: i32,
    pub local_type: Option<String>,
    pub zentao_type: Option<String>,
    pub zentao_module: Option<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTaskTypeMappingParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDecompositionParams {
    pub source_task_id: i32,
    pub ai_generated: bool,
    pub decomposition_json: Option<String>,
}

// ─── Handlers ───

pub async fn list_tasks(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListTasksParams>,
) -> Result<Json<Vec<TaskInfo>>, AppCommandError> {
    Ok(Json(task_commands::list_tasks_core(&state.db, params.project_id).await?))
}

pub async fn get_task(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetTaskParams>,
) -> Result<Json<TaskDetail>, AppCommandError> {
    Ok(Json(task_commands::get_task_core(&state.db, params.id).await?))
}

pub async fn create_task(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateTaskParams>,
) -> Result<Json<TaskInfo>, AppCommandError> {
    Ok(Json(
        task_commands::create_task_core(
            &state.db,
            &state.emitter,
            params.project_id,
            &params.title,
            &params.task_type,
            params.description,
            params.priority,
            params.assignee,
            params.parent_task_id,
        )
        .await?,
    ))
}

pub async fn update_task(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateTaskParams>,
) -> Result<Json<TaskInfo>, AppCommandError> {
    // Parse deadline from string to DateTime if provided
    let deadline = params.deadline.map(|dl| {
        dl.and_then(|s| chrono::DateTime::parse_from_rfc3339(&s)
            .map(|dt| dt.with_timezone(&chrono::Utc))
            .ok())
    });

    Ok(Json(
        task_commands::update_task_core(
            &state.db,
            &state.emitter,
            params.id,
            params.title,
            params.description,
            params.task_type,
            params.status,
            params.priority,
            params.assignee,
            params.parent_task_id,
            params.zentao_id,
            params.zentao_type,
            params.zentao_sync_status,
            deadline,
            params.estimated_hours,
            params.consumed_hours,
            params.zentao_module,
            params.kb_refs_json,
            params.affected_repos_json,
            params.delegation_config,
        )
        .await?,
    ))
}

pub async fn update_task_status(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateTaskStatusParams>,
) -> Result<Json<TaskInfo>, AppCommandError> {
    Ok(Json(
        task_commands::update_task_status_core(&state.db, &state.emitter, params.id, &params.status).await?,
    ))
}

pub async fn delete_task(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DeleteTaskParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    task_commands::delete_task_core(&state.db, &state.emitter, params.id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn link_conversation(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<LinkConversationParams>,
) -> Result<Json<TaskConversationInfo>, AppCommandError> {
    Ok(Json(
        task_commands::link_conversation_core(&state.db, &state.emitter, params.task_id, params.conversation_id, &params.role).await?,
    ))
}

pub async fn create_conversation_for_task(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateConversationForTaskParams>,
) -> Result<Json<TaskConversationLaunchInfo>, AppCommandError> {
    Ok(Json(
        task_commands::create_conversation_for_task_core(
            &state.db,
            &state.emitter,
            params.task_id,
            params.injected_docs_json,
            params.agent_type,
        )
        .await?,
    ))
}

pub async fn unlink_conversation(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UnlinkConversationParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    task_commands::unlink_conversation_core(&state.db, &state.emitter, params.task_id, params.conversation_id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn list_task_conversations(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListTaskConversationsParams>,
) -> Result<Json<Vec<TaskConversationInfo>>, AppCommandError> {
    Ok(Json(task_commands::list_task_conversations_core(&state.db, params.task_id).await?))
}

pub async fn get_task_by_conversation(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetTaskByConversationParams>,
) -> Result<Json<Option<TaskConversationInfo>>, AppCommandError> {
    Ok(Json(task_commands::get_task_by_conversation_core(&state.db, params.conversation_id).await?))
}

pub async fn list_task_type_mappings(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListTaskTypeMappingsParams>,
) -> Result<Json<Vec<TaskTypeMappingInfo>>, AppCommandError> {
    Ok(Json(task_commands::list_task_type_mappings_core(&state.db, params.project_id).await?))
}

pub async fn create_task_type_mapping(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateTaskTypeMappingParams>,
) -> Result<Json<TaskTypeMappingInfo>, AppCommandError> {
    Ok(Json(
        task_commands::create_task_type_mapping_core(&state.db, &params.local_type, &params.zentao_type, params.zentao_module, params.project_id).await?,
    ))
}

pub async fn update_task_type_mapping(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateTaskTypeMappingParams>,
) -> Result<Json<TaskTypeMappingInfo>, AppCommandError> {
    Ok(Json(
        task_commands::update_task_type_mapping_core(&state.db, params.id, params.local_type, params.zentao_type, params.zentao_module).await?,
    ))
}

pub async fn delete_task_type_mapping(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DeleteTaskTypeMappingParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    task_commands::delete_task_type_mapping_core(&state.db, params.id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn create_decomposition(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateDecompositionParams>,
) -> Result<Json<TaskDecompositionInfo>, AppCommandError> {
    Ok(Json(
        task_commands::create_decomposition_core(&state.db, params.source_task_id, params.ai_generated, params.decomposition_json).await?,
    ))
}
