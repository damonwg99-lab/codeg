use crate::app_error::AppCommandError;
use crate::db::service::platform_branch_service;
use crate::db::service::platform_release_service;
use crate::db::service::platform_task_service;
use crate::db::AppDatabase;
use crate::models::platform_release::{
    CreateReleaseParams, ReleaseDetail, ReleaseInfo, ReleaseItemInfo,
};
use crate::web::event_bridge::{emit_event, EventEmitter};
use sea_orm::{ConnectionTrait, DatabaseConnection, TransactionError, TransactionTrait};
#[cfg(feature = "tauri-runtime")]
use crate::app_state::AppState;

const PLATFORM_TASK_CHANGED_EVENT: &str = "platform_task://changed";
const PLATFORM_RELEASE_CHANGED_EVENT: &str = "platform_release://changed";

fn emit_task_changed(emitter: &EventEmitter) {
    emit_event(emitter, PLATFORM_TASK_CHANGED_EVENT, "");
}

fn emit_release_changed(emitter: &EventEmitter) {
    emit_event(emitter, PLATFORM_RELEASE_CHANGED_EVENT, "");
}

const MAX_RELEASE_CODE_RETRIES: usize = 8;

pub async fn create_release_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    project_id: i32,
    params: CreateReleaseParams,
) -> Result<ReleaseDetail, AppCommandError> {
    let conn = &db.conn;

    let release_detail = build_release(conn, project_id, params).await?;

    emit_release_changed(emitter);

    Ok(release_detail)
}

async fn build_release(
    conn: &DatabaseConnection,
    project_id: i32,
    params: CreateReleaseParams,
) -> Result<ReleaseDetail, AppCommandError> {
    // Retry release_code generation on collision (P0-2).
    let mut attempt: usize = 0;
    loop {
        attempt += 1;
        let project_id_for_txn = project_id;
        let params_clone = params.clone();
        let release_code = pick_release_code(conn, project_id_for_txn).await?;

        let result = conn
            .transaction::<_, ReleaseDetail, AppCommandError>(move |txn| {
                let code = release_code.clone();
                let p = params_clone.clone();
                Box::pin(async move {
                    insert_release_with_items(txn, project_id_for_txn, &code, p).await
                })
            })
            .await;

        match result {
            Ok(detail) => return Ok(detail),
            Err(TransactionError::Connection(db_err)) => {
                let msg = db_err.to_string();
                if (msg.contains("UNIQUE") || msg.contains("unique") || msg.contains("Duplicate"))
                    && msg.contains("release_code")
                    && attempt < MAX_RELEASE_CODE_RETRIES
                {
                    continue;
                }
                return Err(AppCommandError::from(
                    crate::db::error::DbError::Database(db_err),
                ));
            }
            Err(TransactionError::Transaction(inner)) => return Err(inner),
        }
    }
}

async fn pick_release_code<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
) -> Result<String, AppCommandError> {
    let today = chrono::Utc::now().format("%Y%m%d").to_string();
    let existing = platform_release_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)?;
    let today_count = existing
        .iter()
        .filter(|r| r.release_code.starts_with(&today))
        .count();
    Ok(format!("REL-{}-{:02}", today, today_count + 1))
}

async fn insert_release_with_items<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
    release_code: &str,
    params: CreateReleaseParams,
) -> Result<ReleaseDetail, AppCommandError> {
    // P0-3: all inserts happen inside the txn.
    let release = platform_release_service::create(
        conn,
        project_id,
        release_code,
        params.title.as_deref(),
        params.notes.as_deref(),
        params.deployer.as_deref(),
    )
    .await
    .map_err(AppCommandError::from)?;

    for branch_id in &params.branch_ids {
        platform_release_service::add_item(conn, release.id, *branch_id, None, None)
            .await
            .map_err(AppCommandError::from)?;
    }

    if let Some(ref refs_json) = params.external_refs_json {
        if let Ok(refs) = serde_json::from_str::<Vec<serde_json::Value>>(refs_json) {
            for ref_item in refs {
                let repo = ref_item
                    .get("repo")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let branch_name = ref_item
                    .get("branch")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !repo.is_empty() && !branch_name.is_empty() {
                    let branch = platform_branch_service::upsert(
                        conn, project_id, repo, branch_name,
                    )
                    .await
                    .map_err(AppCommandError::from)?;
                    let ext_ref = serde_json::json!({
                        "title": ref_item.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                        "repo": repo,
                        "branch": branch_name,
                    })
                    .to_string();
                    platform_release_service::add_item(
                        conn,
                        release.id,
                        branch.id,
                        None,
                        Some(&ext_ref),
                    )
                    .await
                    .map_err(AppCommandError::from)?;
                }
            }
        }
    }

    let items = platform_release_service::list_items(conn, release.id)
        .await
        .map_err(AppCommandError::from)?;
    let branches = platform_branch_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)?;

    let mut release_items = Vec::new();
    for item in items {
        let branch = branches.iter().find(|b| b.id == item.branch_id);
        release_items.push(ReleaseItemInfo {
            id: item.id,
            release_id: item.release_id,
            branch_id: item.branch_id,
            repo_name: branch.map_or("".to_string(), |b| b.repo_name.clone()),
            branch: branch.map_or("".to_string(), |b| b.branch.clone()),
            branch_status: branch.map_or("".to_string(), |b| b.status.clone()),
            task_id: item.task_id,
            task_title: None,
            external_ref_json: item.external_ref_json,
        });
    }

    Ok(ReleaseDetail {
        release: release.into(),
        items: release_items,
    })
}

pub async fn list_releases_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<Vec<ReleaseInfo>, AppCommandError> {
    let conn = &db.conn;
    let releases = platform_release_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)?;

    // P1-13: populate branch_count per release.
    let ids: Vec<i32> = releases.iter().map(|r| r.id).collect();
    let counts = platform_release_service::count_items_for_releases(conn, &ids)
        .await
        .map_err(AppCommandError::from)?;

    Ok(releases
        .into_iter()
        .map(|m| {
            let bc = counts.get(&m.id).copied().unwrap_or(0) as i32;
            let mut info: ReleaseInfo = m.into();
            info.branch_count = bc;
            info
        })
        .collect())
}

pub async fn list_releases_for_task_core(
    db: &AppDatabase,
    task_id: i32,
) -> Result<Vec<ReleaseInfo>, AppCommandError> {
    let conn = &db.conn;
    let releases = platform_release_service::list_releases_for_task(conn, task_id)
        .await
        .map_err(AppCommandError::from)?;

    let ids: Vec<i32> = releases.iter().map(|r| r.id).collect();
    let counts = platform_release_service::count_items_for_releases(conn, &ids)
        .await
        .map_err(AppCommandError::from)?;

    Ok(releases
        .into_iter()
        .map(|m| {
            let bc = counts.get(&m.id).copied().unwrap_or(0) as i32;
            let mut info: ReleaseInfo = m.into();
            info.branch_count = bc;
            info
        })
        .collect())
}

pub async fn get_release_core(
    db: &AppDatabase,
    release_id: i32,
) -> Result<ReleaseDetail, AppCommandError> {
    let conn = &db.conn;
    let release = platform_release_service::get_by_id(conn, release_id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found("Release not found"))?;

    let items = platform_release_service::list_items(conn, release.id)
        .await
        .map_err(AppCommandError::from)?;
    let branches = platform_branch_service::list_by_project(conn, release.project_id)
        .await
        .map_err(AppCommandError::from)?;

    let mut release_items = Vec::new();
    for item in items {
        let branch = branches.iter().find(|b| b.id == item.branch_id);
        release_items.push(ReleaseItemInfo {
            id: item.id,
            release_id: item.release_id,
            branch_id: item.branch_id,
            repo_name: branch.map_or("".to_string(), |b| b.repo_name.clone()),
            branch: branch.map_or("".to_string(), |b| b.branch.clone()),
            branch_status: branch.map_or("".to_string(), |b| b.status.clone()),
            task_id: item.task_id,
            task_title: None,
            external_ref_json: item.external_ref_json,
        });
    }

    Ok(ReleaseDetail {
        release: release.into(),
        items: release_items,
    })
}

pub async fn update_release_status_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    release_id: i32,
    status: &str,
    deployer: Option<&str>,
) -> Result<ReleaseInfo, AppCommandError> {
    let conn = &db.conn;

    // For "closed" we also narrate the archive of done tasks in the same txn (P0-4).
    let is_closing = status == "closed";

    if is_closing {
        let emitter_ref = emitter.clone();
        let status_owned = status.to_string();
        let deployer_owned = deployer.map(|s| s.to_string());
        let release_info = conn
            .transaction::<_, ReleaseInfo, AppCommandError>(move |txn| {
                Box::pin(async move {
                    let model = platform_release_service::update_status(
                        txn,
                        release_id,
                        &status_owned,
                        deployer_owned.as_deref(),
                    )
                    .await
                    .map_err(AppCommandError::from)?;

                    let items = platform_release_service::list_items(txn, release_id)
                        .await
                        .map_err(AppCommandError::from)?;
                    for item in items {
                        let task_branches =
                            platform_branch_service::list_tasks_for_branch(txn, item.branch_id)
                                .await
                                .map_err(AppCommandError::from)?;
                        for tb in task_branches {
                            // P0-1: lookup the task by id directly, then filter by status=="done".
                            let task = platform_task_service::get_by_id(txn, tb.task_id)
                                .await
                                .map_err(AppCommandError::from)?;
                            if let Some(t) = task {
                                if t.status == "done" {
                                    platform_task_service::update_status(
                                        txn,
                                        t.id,
                                        "archived",
                                    )
                                    .await
                                    .map_err(AppCommandError::from)?;
                                }
                            }
                        }
                    }
                    Ok(ReleaseInfo::from(model))
                })
            })
            .await
            .map_err(map_txn_err)?;

        emit_task_changed(&emitter_ref);
        emit_release_changed(&emitter_ref);
        Ok(release_info)
    } else {
        let model =
            platform_release_service::update_status(conn, release_id, status, deployer)
                .await
                .map_err(AppCommandError::from)?;
        emit_release_changed(emitter);
        Ok(ReleaseInfo::from(model))
    }
}

fn map_txn_err(e: TransactionError<AppCommandError>) -> AppCommandError {
    match e {
        TransactionError::Connection(db) => {
            AppCommandError::new(crate::app_error::AppErrorCode::DatabaseError, "Database transaction failed")
                .with_detail(db.to_string())
        }
        TransactionError::Transaction(inner) => inner,
    }
}

pub async fn delete_release_core(
    db: &AppDatabase,
    emitter: &EventEmitter,
    release_id: i32,
) -> Result<(), AppCommandError> {
    platform_release_service::soft_delete(&db.conn, release_id)
        .await
        .map_err(AppCommandError::from)?;
    emit_release_changed(emitter);
    Ok(())
}

// ─── Tauri commands ───

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_release(
    state: tauri::State<'_, AppState>,
    project_id: i32,
    params: CreateReleaseParams,
) -> Result<ReleaseDetail, AppCommandError> {
    create_release_core(&state.db, &state.emitter, project_id, params).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_releases(
    state: tauri::State<'_, AppState>,
    project_id: i32,
) -> Result<Vec<ReleaseInfo>, AppCommandError> {
    list_releases_core(&state.db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_releases_for_task(
    state: tauri::State<'_, AppState>,
    task_id: i32,
) -> Result<Vec<ReleaseInfo>, AppCommandError> {
    list_releases_for_task_core(&state.db, task_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_release(
    state: tauri::State<'_, AppState>,
    release_id: i32,
) -> Result<ReleaseDetail, AppCommandError> {
    get_release_core(&state.db, release_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_release(
    state: tauri::State<'_, AppState>,
    release_id: i32,
    status: String,
    deployer: Option<String>,
) -> Result<ReleaseInfo, AppCommandError> {
    update_release_status_core(
        &state.db,
        &state.emitter,
        release_id,
        &status,
        deployer.as_deref(),
    )
    .await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_release(
    state: tauri::State<'_, AppState>,
    release_id: i32,
) -> Result<(), AppCommandError> {
    delete_release_core(&state.db, &state.emitter, release_id).await
}