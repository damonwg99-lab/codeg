use std::sync::Arc;

use axum::{
    extract::Extension,
    Json,
};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::project as project_commands;
use crate::models::{
    CredentialInfo, GitRepoScanResult, GlobalConfigInfo, ProjectDetail, ProjectInfo,
    ProjectRepoInfo,
};

// ─── Param structs ───

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectParams {
    pub name: String,
    pub root_dir: String,
    pub description: Option<String>,
    pub client_name: Option<String>,
    pub default_agent_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectParams {
    pub id: i32,
    pub name: Option<String>,
    pub description: Option<String>,
    pub client_name: Option<String>,
    pub status: Option<String>,
    pub folder_id: Option<Option<i32>>,
    pub zentao_project_id: Option<Option<i32>>,
    pub zentao_product_id: Option<Option<i32>>,
    pub jenkins_url: Option<Option<String>>,
    pub kb_repo_url: Option<Option<String>>,
    pub kb_local_dir: Option<Option<String>>,
    pub default_agent_type: Option<Option<String>>,
    pub delegation_config: Option<Option<String>>,
    pub agent_config_json: Option<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetProjectParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListProjectReposParams {
    pub project_id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddProjectRepoParams {
    pub project_id: i32,
    pub name: String,
    pub git_url: String,
    pub local_dir: String,
    pub branch: Option<String>,
    pub has_claude_md: bool,
    pub folder_id: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProjectRepoParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanGitReposParams {
    pub root_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetGlobalConfigParams {
    pub config_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetGlobalConfigParams {
    pub config_type: String,
    pub config_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCredentialParams {
    pub credential_type: String,
    pub token: String,
    pub project_id: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCredentialParams {
    pub id: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCredentialExistsParams {
    pub credential_type: String,
    pub project_id: Option<i32>,
}

// ─── Handlers ───

pub async fn list_projects(
    Extension(state): Extension<Arc<AppState>>,
) -> Result<Json<Vec<ProjectInfo>>, AppCommandError> {
    Ok(Json(project_commands::list_projects_core(&state.db).await?))
}

pub async fn get_project(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetProjectParams>,
) -> Result<Json<ProjectDetail>, AppCommandError> {
    Ok(Json(project_commands::get_project_core(&state.db, params.id).await?))
}

pub async fn create_project(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CreateProjectParams>,
) -> Result<Json<ProjectInfo>, AppCommandError> {
    Ok(Json(
        project_commands::create_project_core(
            &state.db,
            &state.emitter,
            &params.name,
            &params.root_dir,
            params.description,
            params.client_name,
            params.default_agent_type,
        )
        .await?,
    ))
}

pub async fn update_project(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpdateProjectParams>,
) -> Result<Json<ProjectInfo>, AppCommandError> {
    Ok(Json(
        project_commands::update_project_core(
            &state.db,
            &state.emitter,
            params.id,
            params.name,
            params.description,
            params.client_name,
            params.status,
            params.folder_id,
            params.zentao_project_id,
            params.zentao_product_id,
            params.jenkins_url,
            params.kb_repo_url,
            params.kb_local_dir,
            params.default_agent_type,
            params.delegation_config,
            params.agent_config_json,
        )
        .await?,
    ))
}

pub async fn delete_project(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DeleteProjectParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    project_commands::delete_project_core(&state.db, &state.emitter, params.id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn list_project_repos(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListProjectReposParams>,
) -> Result<Json<Vec<ProjectRepoInfo>>, AppCommandError> {
    Ok(Json(project_commands::list_project_repos_core(&state.db, params.project_id).await?))
}

pub async fn add_project_repo(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<AddProjectRepoParams>,
) -> Result<Json<ProjectRepoInfo>, AppCommandError> {
    Ok(Json(
        project_commands::add_project_repo_core(
            &state.db,
            &state.emitter,
            params.project_id,
            &params.name,
            &params.git_url,
            &params.local_dir,
            params.branch,
            params.has_claude_md,
            params.folder_id,
        )
        .await?,
    ))
}

pub async fn remove_project_repo(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<RemoveProjectRepoParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    project_commands::remove_project_repo_core(&state.db, &state.emitter, params.id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn scan_git_repos(
    Json(params): Json<ScanGitReposParams>,
) -> Result<Json<Vec<GitRepoScanResult>>, AppCommandError> {
    Ok(Json(project_commands::scan_git_repos_core(&params.root_dir).await?))
}

pub async fn get_global_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GetGlobalConfigParams>,
) -> Result<Json<Option<GlobalConfigInfo>>, AppCommandError> {
    Ok(Json(project_commands::get_global_config_core(&state.db, &params.config_type).await?))
}

pub async fn set_global_config(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SetGlobalConfigParams>,
) -> Result<Json<GlobalConfigInfo>, AppCommandError> {
    Ok(Json(
        project_commands::set_global_config_core(&state.db, &state.emitter, &params.config_type, &params.config_json).await?,
    ))
}

pub async fn save_credential(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<SaveCredentialParams>,
) -> Result<Json<CredentialInfo>, AppCommandError> {
    Ok(Json(
        project_commands::save_credential_core(&state.db, &state.emitter, &params.credential_type, &params.token, params.project_id).await?,
    ))
}

pub async fn delete_credential(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<DeleteCredentialParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    project_commands::delete_credential_core(&state.db, &state.emitter, params.id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

/// Check whether a credential of the given type exists (for a specific
/// project or globally). Returns `{ "exists": bool }` without exposing
/// the token value.
pub async fn check_credential_exists(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<CheckCredentialExistsParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    use crate::db::service::platform_credential_service;
    let conn = &state.db.conn;
    let cred = platform_credential_service::get_by_type_and_project(
        conn,
        &params.credential_type,
        params.project_id,
    )
    .await
    .map_err(AppCommandError::from)?;

    let exists = cred.is_some();
    Ok(Json(serde_json::json!({ "exists": exists })))
}
