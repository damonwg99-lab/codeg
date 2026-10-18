use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::branch_board as branch_board_commands;
use crate::models::{BranchStateInfo, GitCredentials, RepoBranchMatrix};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProjectBranchMatrixParams {
    pub project_id: i32,
    pub force: Option<bool>,
}

pub async fn git_project_branch_matrix(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GitProjectBranchMatrixParams>,
) -> Result<Json<Vec<RepoBranchMatrix>>, AppCommandError> {
    Ok(Json(
        branch_board_commands::git_project_branch_matrix_core(
            &state.db,
            params.project_id,
            params.force.unwrap_or(false),
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeAddExistingParams {
    pub path: String,
    pub worktree_path: String,
    pub branch: String,
}

pub async fn git_worktree_add_existing(
    Json(params): Json<GitWorktreeAddExistingParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    branch_board_commands::git_worktree_add_existing_core(
        params.path,
        params.worktree_path,
        params.branch,
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeRemoveTempParams {
    pub path: String,
    pub worktree_path: String,
}

pub async fn git_worktree_remove_temp(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GitWorktreeRemoveTempParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    branch_board_commands::git_worktree_remove_temp_core(
        Some(&state.db),
        params.path,
        params.worktree_path,
    )
    .await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListBranchStatesParams {
    pub project_id: i32,
}

pub async fn list_branch_states(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<ListBranchStatesParams>,
) -> Result<Json<Vec<BranchStateInfo>>, AppCommandError> {
    Ok(Json(
        branch_board_commands::list_branch_states_core(&state.db, params.project_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertBranchStateParams {
    pub repo_id: i32,
    pub branch: String,
    /// Absent leaves the stored archive flag untouched.
    pub is_archived: Option<bool>,
    /// Absent leaves the stored note untouched; empty clears it.
    pub description: Option<String>,
}

pub async fn upsert_branch_state(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<UpsertBranchStateParams>,
) -> Result<Json<BranchStateInfo>, AppCommandError> {
    Ok(Json(
        branch_board_commands::upsert_branch_state_core(
            &state.db,
            params.repo_id,
            params.branch,
            params.is_archived,
            params.description,
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchDiffFilesParams {
    pub path: String,
    pub branch: String,
    pub env_branch: String,
}

pub async fn git_branch_diff_files(
    Json(params): Json<GitBranchDiffFilesParams>,
) -> Result<Json<Vec<crate::commands::folders::GitLogFileChange>>, AppCommandError> {
    Ok(Json(
        branch_board_commands::git_branch_diff_files_core(
            &params.path,
            &params.branch,
            &params.env_branch,
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchDiffFileParams {
    pub path: String,
    pub branch: String,
    pub env_branch: String,
    pub file: String,
}

pub async fn git_branch_diff_file(
    Json(params): Json<GitBranchDiffFileParams>,
) -> Result<Json<String>, AppCommandError> {
    Ok(Json(
        branch_board_commands::git_branch_diff_file_core(
            &params.path,
            &params.branch,
            &params.env_branch,
            &params.file,
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchOwnCommitsParams {
    pub path: String,
    pub branch: String,
    pub env_branches: Vec<String>,
    pub skip: Option<u32>,
    pub limit: Option<u32>,
}

pub async fn git_branch_own_commits(
    Json(params): Json<GitBranchOwnCommitsParams>,
) -> Result<Json<crate::commands::folders::GitLogResult>, AppCommandError> {
    Ok(Json(
        branch_board_commands::git_branch_own_commits_core(
            &params.path,
            &params.branch,
            &params.env_branches,
            params.skip.unwrap_or(0),
            params.limit.unwrap_or(50),
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullBranchParams {
    pub path: String,
    pub branch: String,
    pub credentials: Option<GitCredentials>,
}

pub async fn git_pull_branch(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GitPullBranchParams>,
) -> Result<Json<crate::commands::folders::GitPullResult>, AppCommandError> {
    Ok(Json(
        branch_board_commands::git_pull_branch_core(
            &state.db,
            &params.path,
            &params.branch,
            params.credentials.as_ref(),
            &state.data_dir,
        )
        .await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDeleteBranchRemoteParams {
    pub path: String,
    pub branch: String,
    pub credentials: Option<GitCredentials>,
}

pub async fn git_delete_branch_remote(
    Extension(state): Extension<Arc<AppState>>,
    Json(params): Json<GitDeleteBranchRemoteParams>,
) -> Result<Json<String>, AppCommandError> {
    Ok(Json(
        branch_board_commands::git_delete_branch_remote_core(
            &params.path,
            &params.branch,
            params.credentials.as_ref(),
            &state.db,
            &state.data_dir,
        )
        .await?,
    ))
}
