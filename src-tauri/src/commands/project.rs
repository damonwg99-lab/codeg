use crate::app_error::AppCommandError;
use crate::db::service::{
    platform_credential_service, platform_global_config_service, platform_project_repo_service,
    platform_project_service,
};
use crate::db::AppDatabase;
use crate::models::{
    CredentialInfo, GitRepoScanResult, GlobalConfigInfo, ProjectDetail, ProjectInfo,
    ProjectRepoInfo, TaskCountByStatus,
};
use crate::platform::project::git_scan;
use crate::web::event_bridge::emit_event;

/// Event channel names for platform state changes.
const PLATFORM_PROJECT_CHANGED_EVENT: &str = "platform_project://changed";

// ─── Project CRUD ───

pub async fn list_projects_core(
    db: &AppDatabase,
) -> Result<Vec<ProjectInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_project_service::list(conn).await.map_err(AppCommandError::from)
}

pub async fn get_project_core(
    db: &AppDatabase,
    id: i32,
) -> Result<ProjectDetail, AppCommandError> {
    let conn = &db.conn;
    let project = platform_project_service::get_by_id(conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Project not found: {id}")))?;

    let repos = platform_project_repo_service::list_by_project(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    // Count tasks by status
    let tasks = crate::db::service::platform_task_service::list_by_project(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    let task_count_by_status = TaskCountByStatus {
        backlog: tasks.iter().filter(|t| t.status == "backlog").count() as i32,
        confirmed: tasks.iter().filter(|t| t.status == "confirmed").count() as i32,
        in_progress: tasks.iter().filter(|t| t.status == "in_progress").count() as i32,
        done: tasks.iter().filter(|t| t.status == "done").count() as i32,
        released: tasks.iter().filter(|t| t.status == "released").count() as i32,
    };

    Ok(ProjectDetail {
        project,
        repos,
        task_count_by_status,
    })
}

pub async fn create_project_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    name: &str,
    root_dir: &str,
    description: Option<String>,
    client_name: Option<String>,
    default_agent_type: Option<String>,
) -> Result<ProjectInfo, AppCommandError> {
    let conn = &db.conn;

    // Check if the directory is already a CodeG Folder; if not, create one
    let folder_id = find_or_create_folder(conn, root_dir, default_agent_type.clone()).await?;

    let project = platform_project_service::create(
        conn,
        name,
        root_dir,
        folder_id,
        description,
        client_name,
        default_agent_type,
    )
    .await
    .map_err(AppCommandError::from)?;

    emit_event(emitter, PLATFORM_PROJECT_CHANGED_EVENT, &project);
    Ok(project)
}

pub async fn update_project_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    id: i32,
    name: Option<String>,
    description: Option<String>,
    client_name: Option<String>,
    status: Option<String>,
    folder_id: Option<Option<i32>>,
    zentao_project_id: Option<Option<i32>>,
    zentao_product_id: Option<Option<i32>>,
    jenkins_url: Option<Option<String>>,
    kb_repo_url: Option<Option<String>>,
    kb_local_dir: Option<Option<String>>,
    default_agent_type: Option<Option<String>>,
    delegation_config: Option<Option<String>>,
    agent_config_json: Option<Option<String>>,
) -> Result<ProjectInfo, AppCommandError> {
    let conn = &db.conn;
    let project = platform_project_service::update(
        conn,
        id,
        name,
        description,
        client_name,
        status,
        folder_id,
        zentao_project_id,
        zentao_product_id,
        jenkins_url,
        kb_repo_url,
        kb_local_dir,
        default_agent_type,
        delegation_config,
        agent_config_json,
    )
    .await
    .map_err(AppCommandError::from)?;

    emit_event(emitter, PLATFORM_PROJECT_CHANGED_EVENT, &project);
    Ok(project)
}

pub async fn delete_project_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    id: i32,
) -> Result<(), AppCommandError> {
    let conn = &db.conn;
    platform_project_service::delete(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(
        emitter,
        PLATFORM_PROJECT_CHANGED_EVENT,
        serde_json::json!({ "id": id, "deleted": true }),
    );
    Ok(())
}

// ─── Project Repo ───

pub async fn list_project_repos_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<Vec<ProjectRepoInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_project_repo_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)
}

pub async fn add_project_repo_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    project_id: i32,
    name: &str,
    git_url: &str,
    local_dir: &str,
    branch: Option<String>,
    has_claude_md: bool,
    folder_id: Option<i32>,
) -> Result<ProjectRepoInfo, AppCommandError> {
    let conn = &db.conn;
    let repo = platform_project_repo_service::create(
        conn,
        project_id,
        name,
        git_url,
        local_dir,
        branch,
        has_claude_md,
        folder_id,
    )
    .await
    .map_err(AppCommandError::from)?;

    emit_event(emitter, PLATFORM_PROJECT_CHANGED_EVENT, &repo);
    Ok(repo)
}

pub async fn remove_project_repo_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    id: i32,
) -> Result<(), AppCommandError> {
    let conn = &db.conn;
    platform_project_repo_service::delete(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(
        emitter,
        PLATFORM_PROJECT_CHANGED_EVENT,
        serde_json::json!({ "repoId": id, "removed": true }),
    );
    Ok(())
}

pub async fn scan_git_repos_core(
    root_dir: &str,
) -> Result<Vec<GitRepoScanResult>, AppCommandError> {
    git_scan::scan_root_dir(root_dir).await.map_err(|e| {
        AppCommandError::io_error("Failed to scan git repositories").with_detail(e.to_string())
    })
}

// ─── Global Config ───

pub async fn get_global_config_core(
    db: &AppDatabase,
    config_type: &str,
) -> Result<Option<GlobalConfigInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_global_config_service::get_by_type(conn, config_type)
        .await
        .map_err(AppCommandError::from)
}

pub async fn set_global_config_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    config_type: &str,
    config_json: &str,
) -> Result<GlobalConfigInfo, AppCommandError> {
    let conn = &db.conn;
    let config = platform_global_config_service::set(conn, config_type, config_json)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(
        emitter,
        &format!("platform_config://changed/{}", config_type),
        &config,
    );
    Ok(config)
}

// ─── Credential ───

pub async fn save_credential_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    credential_type: &str,
    token: &str,
    project_id: Option<i32>,
) -> Result<CredentialInfo, AppCommandError> {
    let conn = &db.conn;
    // Generate a keyring_store key
    let credential_key = format!(
        "platform:{}:{}",
        credential_type,
        project_id
            .map(|p| p.to_string())
            .unwrap_or_else(|| "global".to_string())
    );

    // Store token in keyring_store first
    platform_credential_service::store_token(&credential_key, token)
        .map_err(|e| AppCommandError::io_error("Failed to save credential").with_detail(e))?;

    // Then create the DB record
    let cred = platform_credential_service::create(conn, credential_type, &credential_key, project_id)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(
        emitter,
        &format!("platform_credential://changed/{}", credential_type),
        serde_json::json!({ "credentialType": credential_type, "projectId": project_id, "exists": true }),
    );
    Ok(cred)
}

pub async fn get_credential_token_core(
    db: &AppDatabase,
    credential_type: &str,
    project_id: Option<i32>,
) -> Result<Option<String>, AppCommandError> {
    let conn = &db.conn;
    let cred = platform_credential_service::get_by_type_and_project(conn, credential_type, project_id)
        .await
        .map_err(AppCommandError::from)?;

    if let Some(cred) = cred {
        let token = platform_credential_service::retrieve_token(&cred.credential_key);
        Ok(token)
    } else {
        Ok(None)
    }
}

pub async fn delete_credential_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    id: i32,
) -> Result<(), AppCommandError> {
    let conn = &db.conn;
    platform_credential_service::delete(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(
        emitter,
        "platform_credential://changed",
        serde_json::json!({ "credentialId": id, "removed": true }),
    );
    Ok(())
}

// ─── Folder association helper ───

/// Check if the given directory is already a CodeG Folder.
/// If yes, return its id; if not, create a new Folder and return its id.
async fn find_or_create_folder(
    conn: &sea_orm::DatabaseConnection,
    root_dir: &str,
    default_agent_type: Option<String>,
) -> Result<Option<i32>, AppCommandError> {
    use crate::db::service::folder_service;

    // Check if a Folder with this path already exists (including soft-deleted ones
    // — add_folder re-opens deleted folders)
    let existing = folder_service::add_folder(conn, root_dir)
        .await
        .map_err(AppCommandError::from)?;

    // If we have a default_agent_type, set it on the folder
    if let Some(agent_type_str) = default_agent_type {
        let agent_type: Option<crate::models::AgentType> = serde_json::from_value(
            serde_json::Value::String(agent_type_str),
        )
        .ok();
        if let Some(at) = agent_type {
            folder_service::update_folder_default_agent(conn, existing.id, Some(at))
                .await
                .map_err(AppCommandError::from)?;
        }
    }

    Ok(Some(existing.id))
}

// ─── Tauri command wrappers (only compiled in desktop mode) ───
#[cfg(feature = "tauri-runtime")]
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_projects(
    db: tauri::State<'_, AppDatabase>,
) -> Result<Vec<ProjectInfo>, AppCommandError> {
    list_projects_core(&db).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_project(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<ProjectDetail, AppCommandError> {
    get_project_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_project(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    name: String,
    root_dir: String,
    description: Option<String>,
    client_name: Option<String>,
    default_agent_type: Option<String>,
) -> Result<ProjectInfo, AppCommandError> {
    create_project_core(&db, &emitter, &name, &root_dir, description, client_name, default_agent_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_project(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    id: i32,
    name: Option<String>,
    description: Option<String>,
    client_name: Option<String>,
    status: Option<String>,
    folder_id: Option<Option<i32>>,
    zentao_project_id: Option<Option<i32>>,
    zentao_product_id: Option<Option<i32>>,
    jenkins_url: Option<Option<String>>,
    kb_repo_url: Option<Option<String>>,
    kb_local_dir: Option<Option<String>>,
    default_agent_type: Option<Option<String>>,
    delegation_config: Option<Option<String>>,
    agent_config_json: Option<Option<String>>,
) -> Result<ProjectInfo, AppCommandError> {
    update_project_core(
        &db, &emitter, id, name, description, client_name, status,
        folder_id, zentao_project_id, zentao_product_id, jenkins_url,
        kb_repo_url, kb_local_dir, default_agent_type, delegation_config, agent_config_json,
    ).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_project(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_project_core(&db, &emitter, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_project_repos(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
) -> Result<Vec<ProjectRepoInfo>, AppCommandError> {
    list_project_repos_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn add_project_repo(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    project_id: i32,
    name: String,
    git_url: String,
    local_dir: String,
    branch: Option<String>,
    has_claude_md: bool,
    folder_id: Option<i32>,
) -> Result<ProjectRepoInfo, AppCommandError> {
    add_project_repo_core(&db, &emitter, project_id, &name, &git_url, &local_dir, branch, has_claude_md, folder_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn remove_project_repo(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    id: i32,
) -> Result<(), AppCommandError> {
    remove_project_repo_core(&db, &emitter, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn scan_git_repos(
    root_dir: String,
) -> Result<Vec<GitRepoScanResult>, AppCommandError> {
    scan_git_repos_core(&root_dir).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_global_config(
    db: tauri::State<'_, AppDatabase>,
    config_type: String,
) -> Result<Option<GlobalConfigInfo>, AppCommandError> {
    get_global_config_core(&db, &config_type).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn set_global_config(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    config_type: String,
    config_json: String,
) -> Result<GlobalConfigInfo, AppCommandError> {
    set_global_config_core(&db, &emitter, &config_type, &config_json).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn save_credential(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    credential_type: String,
    token: String,
    project_id: Option<i32>,
) -> Result<CredentialInfo, AppCommandError> {
    save_credential_core(&db, &emitter, &credential_type, &token, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_credential(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_credential_core(&db, &emitter, id).await
}
