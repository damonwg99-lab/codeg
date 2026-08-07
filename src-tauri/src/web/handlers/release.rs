use axum::{extract, Extension, Json};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use crate::app_error::AppCommandError;
use crate::app_state::AppState;
use crate::commands::release;
use crate::models::platform_release::CreateReleaseParams;

pub async fn create_release(
    Extension(state): Extension<Arc<AppState>>,
    extract::Json(params): extract::Json<CreateReleaseParams>,
) -> Result<Json<Value>, AppCommandError> {
    let project_id = params.project_id;
    let result =
        release::create_release_core(&state.db, &state.emitter, project_id, params)
            .await?;
    Ok(Json(serde_json::to_value(&result).unwrap_or(json!({}))))
}

pub async fn list_releases(
    Extension(state): Extension<Arc<AppState>>,
    extract::Json(body): extract::Json<Value>,
) -> Result<Json<Value>, AppCommandError> {
    let project_id = body
        .get("project_id")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let result = release::list_releases_core(&state.db, project_id).await?;
    Ok(Json(serde_json::to_value(&result).unwrap_or(json!([]))))
}

pub async fn list_releases_for_task(
    Extension(state): Extension<Arc<AppState>>,
    extract::Query(params): extract::Query<HashMap<String, String>>,
) -> Result<Json<Value>, AppCommandError> {
    let task_id = params
        .get("task_id")
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(0);
    let result = release::list_releases_for_task_core(&state.db, task_id).await?;
    Ok(Json(serde_json::to_value(&result).unwrap_or(json!([]))))
}

pub async fn get_release(
    Extension(state): Extension<Arc<AppState>>,
    extract::Json(body): extract::Json<Value>,
) -> Result<Json<Value>, AppCommandError> {
    let release_id = body.get("id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let result = release::get_release_core(&state.db, release_id).await?;
    Ok(Json(serde_json::to_value(&result).unwrap_or(json!({}))))
}

pub async fn update_release(
    Extension(state): Extension<Arc<AppState>>,
    extract::Json(body): extract::Json<Value>,
) -> Result<Json<Value>, AppCommandError> {
    let release_id = body.get("id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let status = body.get("status").and_then(|v| v.as_str()).unwrap_or("draft");
    let deployer = body.get("deployer").and_then(|v| v.as_str());
    let result =
        release::update_release_status_core(&state.db, &state.emitter, release_id, status, deployer)
            .await?;
    Ok(Json(serde_json::to_value(&result).unwrap_or(json!({}))))
}

pub async fn delete_release(
    Extension(state): Extension<Arc<AppState>>,
    extract::Json(body): extract::Json<Value>,
) -> Result<Json<Value>, AppCommandError> {
    let release_id = body.get("id").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    release::delete_release_core(&state.db, &state.emitter, release_id).await?;
    Ok(Json(json!({"ok": true})))
}
