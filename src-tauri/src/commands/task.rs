use crate::app_error::AppCommandError;
use crate::db::service::{
    platform_task_conversation_service, platform_task_decomposition_service,
    platform_task_service, platform_task_type_mapping_service,
};
use crate::db::AppDatabase;
use crate::models::{
    TaskConversationInfo, TaskDecompositionInfo, TaskDetail, TaskInfo, TaskTypeMappingInfo,
};
use crate::web::event_bridge::emit_event;

const PLATFORM_TASK_CHANGED_EVENT: &str = "platform_task://changed";
const PLATFORM_TASK_CONVERSATION_CHANGED_EVENT: &str = "platform_task_conversation://changed";

// ─── Task CRUD ───

pub async fn list_tasks_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<Vec<TaskInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_task_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)
}

pub async fn get_task_core(
    db: &AppDatabase,
    id: i32,
) -> Result<TaskDetail, AppCommandError> {
    let conn = &db.conn;
    let task = platform_task_service::get_by_id(conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Task not found: {id}")))?;

    let conversations = platform_task_conversation_service::list_by_task(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    let sub_tasks = platform_task_service::list_sub_tasks(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    Ok(TaskDetail {
        task,
        conversations,
        sub_tasks,
    })
}

pub async fn create_task_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    project_id: i32,
    title: &str,
    task_type: &str,
    description: Option<String>,
    priority: Option<String>,
    assignee: Option<String>,
    parent_task_id: Option<i32>,
) -> Result<TaskInfo, AppCommandError> {
    let conn = &db.conn;
    let task = platform_task_service::create(
        conn,
        project_id,
        title,
        task_type,
        description,
        priority,
        assignee,
        parent_task_id,
    )
    .await
    .map_err(AppCommandError::from)?;

    emit_event(emitter, PLATFORM_TASK_CHANGED_EVENT, &task);
    Ok(task)
}

pub async fn update_task_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    id: i32,
    title: Option<String>,
    description: Option<String>,
    task_type: Option<String>,
    status: Option<String>,
    priority: Option<Option<String>>,
    assignee: Option<Option<String>>,
    parent_task_id: Option<Option<i32>>,
    zentao_id: Option<Option<i32>>,
    zentao_type: Option<Option<String>>,
    zentao_sync_status: Option<Option<String>>,
    deadline: Option<Option<chrono::DateTime<chrono::Utc>>>,
    estimated_hours: Option<Option<f64>>,
    consumed_hours: Option<Option<f64>>,
    zentao_module: Option<Option<String>>,
    kb_refs_json: Option<Option<String>>,
    affected_repos_json: Option<Option<String>>,
    delegation_config: Option<Option<String>>,
) -> Result<TaskInfo, AppCommandError> {
    let conn = &db.conn;
    let task = platform_task_service::update(
        conn,
        id,
        title,
        description,
        task_type,
        status,
        priority,
        assignee,
        parent_task_id,
        zentao_id,
        zentao_type,
        zentao_sync_status,
        deadline,
        estimated_hours,
        consumed_hours,
        zentao_module,
        kb_refs_json,
        affected_repos_json,
        delegation_config,
    )
    .await
    .map_err(AppCommandError::from)?;

    emit_event(emitter, PLATFORM_TASK_CHANGED_EVENT, &task);
    Ok(task)
}

pub async fn update_task_status_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    id: i32,
    status: &str,
) -> Result<TaskInfo, AppCommandError> {
    let conn = &db.conn;
    let task = platform_task_service::update_status(conn, id, status)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(emitter, PLATFORM_TASK_CHANGED_EVENT, &task);
    Ok(task)
}

pub async fn delete_task_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    id: i32,
) -> Result<(), AppCommandError> {
    let conn = &db.conn;
    platform_task_service::delete(conn, id)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(
        emitter,
        PLATFORM_TASK_CHANGED_EVENT,
        serde_json::json!({ "id": id, "deleted": true }),
    );
    Ok(())
}

// ─── Task Conversation ───

pub async fn link_conversation_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    task_id: i32,
    conversation_id: i32,
    role: &str,
) -> Result<TaskConversationInfo, AppCommandError> {
    let conn = &db.conn;
    let link = platform_task_conversation_service::create(conn, task_id, conversation_id, role, None)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(emitter, PLATFORM_TASK_CONVERSATION_CHANGED_EVENT, &link);
    Ok(link)
}

pub async fn unlink_conversation_core(
    db: &AppDatabase,
    emitter: &crate::web::event_bridge::EventEmitter,
    task_id: i32,
    conversation_id: i32,
) -> Result<(), AppCommandError> {
    let conn = &db.conn;
    platform_task_conversation_service::delete_by_task_and_conversation(conn, task_id, conversation_id)
        .await
        .map_err(AppCommandError::from)?;

    emit_event(
        emitter,
        PLATFORM_TASK_CONVERSATION_CHANGED_EVENT,
        serde_json::json!({ "taskId": task_id, "conversationId": conversation_id, "removed": true }),
    );
    Ok(())
}

pub async fn list_task_conversations_core(
    db: &AppDatabase,
    task_id: i32,
) -> Result<Vec<TaskConversationInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_task_conversation_service::list_by_task(conn, task_id)
        .await
        .map_err(AppCommandError::from)
}

pub async fn get_task_by_conversation_core(
    db: &AppDatabase,
    conversation_id: i32,
) -> Result<Option<TaskConversationInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_task_conversation_service::get_by_conversation(conn, conversation_id)
        .await
        .map_err(AppCommandError::from)
}

// ─── Task Type Mapping ───

pub async fn list_task_type_mappings_core(
    db: &AppDatabase,
    project_id: Option<i32>,
) -> Result<Vec<TaskTypeMappingInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_task_type_mapping_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)
}

pub async fn create_task_type_mapping_core(
    db: &AppDatabase,
    local_type: &str,
    zentao_type: &str,
    zentao_module: Option<String>,
    project_id: Option<i32>,
) -> Result<TaskTypeMappingInfo, AppCommandError> {
    let conn = &db.conn;
    platform_task_type_mapping_service::create(conn, local_type, zentao_type, zentao_module, project_id)
        .await
        .map_err(AppCommandError::from)
}

pub async fn update_task_type_mapping_core(
    db: &AppDatabase,
    id: i32,
    local_type: Option<String>,
    zentao_type: Option<String>,
    zentao_module: Option<Option<String>>,
) -> Result<TaskTypeMappingInfo, AppCommandError> {
    let conn = &db.conn;
    platform_task_type_mapping_service::update(conn, id, local_type, zentao_type, zentao_module)
        .await
        .map_err(AppCommandError::from)
}

pub async fn delete_task_type_mapping_core(
    db: &AppDatabase,
    id: i32,
) -> Result<(), AppCommandError> {
    let conn = &db.conn;
    platform_task_type_mapping_service::delete(conn, id)
        .await
        .map_err(AppCommandError::from)
}

// ─── Task Decomposition ───

pub async fn create_decomposition_core(
    db: &AppDatabase,
    source_task_id: i32,
    ai_generated: bool,
    decomposition_json: Option<String>,
) -> Result<TaskDecompositionInfo, AppCommandError> {
    let conn = &db.conn;
    platform_task_decomposition_service::create(conn, source_task_id, ai_generated, decomposition_json)
        .await
        .map_err(AppCommandError::from)
}

// ─── Tauri command wrappers ───

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_tasks(
    db: tauri::State<'_, AppDatabase>,
    project_id: i32,
) -> Result<Vec<TaskInfo>, AppCommandError> {
    list_tasks_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_task(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<TaskDetail, AppCommandError> {
    get_task_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_task(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    project_id: i32,
    title: String,
    task_type: String,
    description: Option<String>,
    priority: Option<String>,
    assignee: Option<String>,
    parent_task_id: Option<i32>,
) -> Result<TaskInfo, AppCommandError> {
    create_task_core(&db, &emitter, project_id, &title, &task_type, description, priority, assignee, parent_task_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_task(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    id: i32,
    title: Option<String>,
    description: Option<String>,
    task_type: Option<String>,
    status: Option<String>,
    priority: Option<Option<String>>,
    assignee: Option<Option<String>>,
    parent_task_id: Option<Option<i32>>,
    zentao_id: Option<Option<i32>>,
    zentao_type: Option<Option<String>>,
    zentao_sync_status: Option<Option<String>>,
    deadline: Option<Option<chrono::DateTime<chrono::Utc>>>,
    estimated_hours: Option<Option<f64>>,
    consumed_hours: Option<Option<f64>>,
    zentao_module: Option<Option<String>>,
    kb_refs_json: Option<Option<String>>,
    affected_repos_json: Option<Option<String>>,
    delegation_config: Option<Option<String>>,
) -> Result<TaskInfo, AppCommandError> {
    update_task_core(
        &db, &emitter, id, title, description, task_type, status,
        priority, assignee, parent_task_id, zentao_id, zentao_type,
        zentao_sync_status, deadline, estimated_hours, consumed_hours,
        zentao_module, kb_refs_json, affected_repos_json, delegation_config,
    ).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_task_status(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    id: i32,
    status: String,
) -> Result<TaskInfo, AppCommandError> {
    update_task_status_core(&db, &emitter, id, &status).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_task(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_task_core(&db, &emitter, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn link_conversation(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    task_id: i32,
    conversation_id: i32,
    role: String,
) -> Result<TaskConversationInfo, AppCommandError> {
    link_conversation_core(&db, &emitter, task_id, conversation_id, &role).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn unlink_conversation(
    db: tauri::State<'_, AppDatabase>,
    emitter: tauri::State<'_, crate::web::event_bridge::EventEmitter>,
    task_id: i32,
    conversation_id: i32,
) -> Result<(), AppCommandError> {
    unlink_conversation_core(&db, &emitter, task_id, conversation_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_task_conversations(
    db: tauri::State<'_, AppDatabase>,
    task_id: i32,
) -> Result<Vec<TaskConversationInfo>, AppCommandError> {
    list_task_conversations_core(&db, task_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_task_by_conversation(
    db: tauri::State<'_, AppDatabase>,
    conversation_id: i32,
) -> Result<Option<TaskConversationInfo>, AppCommandError> {
    get_task_by_conversation_core(&db, conversation_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_task_type_mappings(
    db: tauri::State<'_, AppDatabase>,
    project_id: Option<i32>,
) -> Result<Vec<TaskTypeMappingInfo>, AppCommandError> {
    list_task_type_mappings_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_task_type_mapping(
    db: tauri::State<'_, AppDatabase>,
    local_type: String,
    zentao_type: String,
    zentao_module: Option<String>,
    project_id: Option<i32>,
) -> Result<TaskTypeMappingInfo, AppCommandError> {
    create_task_type_mapping_core(&db, &local_type, &zentao_type, zentao_module, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn update_task_type_mapping(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
    local_type: Option<String>,
    zentao_type: Option<String>,
    zentao_module: Option<Option<String>>,
) -> Result<TaskTypeMappingInfo, AppCommandError> {
    update_task_type_mapping_core(&db, id, local_type, zentao_type, zentao_module).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_task_type_mapping(
    db: tauri::State<'_, AppDatabase>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_task_type_mapping_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn create_decomposition(
    db: tauri::State<'_, AppDatabase>,
    source_task_id: i32,
    ai_generated: bool,
    decomposition_json: Option<String>,
) -> Result<TaskDecompositionInfo, AppCommandError> {
    create_decomposition_core(&db, source_task_id, ai_generated, decomposition_json).await
}
