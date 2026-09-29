use std::sync::Arc;

use axum::{extract::Extension, Json};
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::branch_board as branch_board_commands;
use crate::models::{BranchStateInfo, RepoBranchMatrix};

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
    Json(params): Json<GitWorktreeRemoveTempParams>,
) -> Result<Json<serde_json::Value>, AppCommandError> {
    branch_board_commands::git_worktree_remove_temp_core(params.path, params.worktree_path).await?;
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
    pub is_archived: Option<bool>,
    pub description: Option<Option<String>>,
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