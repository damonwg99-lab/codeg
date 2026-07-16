//! Knowledge base commands — _core functions shared by Tauri and web handlers,
//! plus Tauri-specific wrappers (desktop mode only).

use std::path::{Path, PathBuf};

use crate::app_error::AppCommandError;
use crate::db::service::{platform_knowledge_doc_service, platform_project_service};
use crate::db::AppDatabase;
use crate::models::{
    KnowledgeDocInfo, KbInitResult, ScanResultInfo, SkillInfo,
    UpdateKnowledgeDocDraft, UpsertKnowledgeDocDraft,
};
use crate::platform::knowledge::{init, scanner, skill_discovery};

const KNOWLEDGE_DIR_NAME: &str = "_knowledge";

/// Infer task_id from a file path that follows the pattern
/// `.private/tasks/{task_id}/{filename}`.
fn infer_task_id_from_path(file_path: &str) -> Option<i32> {
    let parts: Vec<&str> = file_path.split('/').collect();
    // Look for the pattern: .private / tasks / {task_id} / ...
    if parts.len() >= 4 && parts[0] == ".private" && parts[1] == "tasks" {
        parts[2].parse::<i32>().ok()
    } else {
        None
    }
}

// ─── Helper: resolve kb_local_dir for a project, init if missing ───

/// Get the KB local directory path for a project. If the project has
/// `kb_local_dir` set, use it; otherwise derive it from `root_dir/_knowledge/`.
/// If the directory does not exist on disk, auto-init it.
async fn ensure_kb_dir(db: &AppDatabase, project_id: i32) -> Result<String, AppCommandError> {
    let conn = &db.conn;
    let project = platform_project_service::get_by_id(conn, project_id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Project not found: {project_id}")))?;

    let kb_dir = project
        .kb_local_dir
        .clone()
        .unwrap_or_else(|| {
            let mut buf = PathBuf::from(&project.root_dir);
            buf.push(KNOWLEDGE_DIR_NAME);
            buf.to_string_lossy().to_string()
        });

    // If the directory doesn't exist on disk, auto-init
    if !Path::new(&kb_dir).is_dir() {
        let _result = init::init_kb_dir(&kb_dir)?;
        // Update project.kb_local_dir if it was empty
        if project.kb_local_dir.is_none() {
            platform_project_service::update(
                conn,
                project_id,
                None,           // name
                None,           // description
                None,           // client_name
                None,           // status
                None,           // folder_id
                None,           // zentao_project_id
                None,           // zentao_product_id
                None,           // jenkins_url
                None,           // kb_repo_url
                Some(Some(kb_dir.clone())), // kb_local_dir
                None,           // default_agent_type
                None,           // delegation_config
                None,           // agent_config_json
            )
            .await
            .map_err(AppCommandError::from)?;
        }
    }

    Ok(kb_dir)
}

// ─── Scanner ───

pub async fn scan_knowledge_repo_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<ScanResultInfo, AppCommandError> {
    let conn = &db.conn;
    let kb_dir = ensure_kb_dir(db, project_id).await?;

    // Scan the directory
    let scanned_docs = scanner::scan_kb_dir(&kb_dir).await?;

    // Build a set of scanned file paths for deletion detection
    let scanned_paths: std::collections::HashSet<String> =
        scanned_docs.iter().map(|d| d.file_path.clone()).collect();

    // Upsert each scanned doc, preserving task_id on existing rows
    // (task attachments have a non-null task_id set by upload_task_attachment_core;
    //  the scanner cannot infer it, so we must not overwrite it with None).
    let mut new_count = 0;
    let mut updated_count = 0;

    // Get existing docs to distinguish new vs updated and to preserve task_id
    let existing_docs = platform_knowledge_doc_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)?;
    let existing_paths: std::collections::HashSet<String> =
        existing_docs.iter().map(|d| d.file_path.clone()).collect();
    // Also build a map for quick task_id lookup by file_path
    let existing_task_ids: std::collections::HashMap<String, Option<i32>> =
        existing_docs.iter().map(|d| (d.file_path.clone(), d.task_id)).collect();

    for doc in &scanned_docs {
        // Preserve existing task_id if present; otherwise set None
        let preserved_task_id = existing_task_ids.get(&doc.file_path)
            .and_then(|tid| *tid)
            .or_else(|| {
                // Infer task_id from path for newly scanned task attachment files
                // Path format: .private/tasks/{task_id}/{filename}
                infer_task_id_from_path(&doc.file_path)
            });

        let draft = UpsertKnowledgeDocDraft {
            project_id,
            doc_type: doc.doc_type.clone(),
            title: doc.title.clone(),
            file_path: doc.file_path.clone(),
            is_shared: doc.is_shared,
            tags_json: doc.tags_json.clone(),
            description: doc.description.clone(),
            skill_name: doc.skill_name.clone(),
            task_id: preserved_task_id,
        };

        let _result = platform_knowledge_doc_service::upsert_by_path(conn, draft)
            .await
            .map_err(AppCommandError::from)?;

        if existing_paths.contains(&doc.file_path) {
            updated_count += 1;
        } else {
            new_count += 1;
        }
    }

    // Soft-delete docs whose files no longer exist on disk,
    // but EXCLUDE task attachments (doc_type = "task_attachment" or task_id != null)
    // since they are independently uploaded and not part of the KB directory scan.
    let mut deleted_count = 0;
    for existing in &existing_docs {
        // Skip task attachments — they should not be deleted by KB scan sweep
        if existing.task_id.is_some() || existing.doc_type == "task_attachment" {
            continue;
        }
        if !scanned_paths.contains(&existing.file_path) {
            platform_knowledge_doc_service::delete(conn, existing.id)
                .await
                .map_err(AppCommandError::from)?;
            deleted_count += 1;
        }
    }

    Ok(ScanResultInfo {
        project_id,
        scanned_count: scanned_docs.len() as i32,
        new_count,
        updated_count,
        deleted_count,
    })
}

// ─── CRUD ───

pub async fn list_knowledge_docs_core(
    db: &AppDatabase,
    project_id: i32,
    doc_type_filter: Option<String>,
) -> Result<Vec<KnowledgeDocInfo>, AppCommandError> {
    let conn = &db.conn;
    let docs = platform_knowledge_doc_service::list_by_project(conn, project_id)
        .await
        .map_err(AppCommandError::from)?;

    // Apply doc_type filter if provided
    let filtered = if let Some(filter) = doc_type_filter {
        docs.into_iter().filter(|d| d.doc_type == filter).collect()
    } else {
        docs
    };

    Ok(filtered)
}

pub async fn search_knowledge_docs_core(
    db: &AppDatabase,
    project_id: i32,
    query: String,
) -> Result<Vec<KnowledgeDocInfo>, AppCommandError> {
    let conn = &db.conn;
    platform_knowledge_doc_service::search(conn, project_id, &query)
        .await
        .map_err(AppCommandError::from)
}

pub async fn get_knowledge_doc_core(
    db: &AppDatabase,
    id: i32,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    let conn = &db.conn;
    platform_knowledge_doc_service::get_by_id(conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Knowledge doc not found: {id}")))
}

pub async fn update_knowledge_doc_core(
    db: &AppDatabase,
    id: i32,
    draft: UpdateKnowledgeDocDraft,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    let conn = &db.conn;
    platform_knowledge_doc_service::update(conn, id, draft)
        .await
        .map_err(AppCommandError::from)
}

pub async fn delete_knowledge_doc_core(
    db: &AppDatabase,
    id: i32,
) -> Result<(), AppCommandError> {
    let conn = &db.conn;
    platform_knowledge_doc_service::delete(conn, id)
        .await
        .map_err(AppCommandError::from)
}

// ─── Skills ───

pub async fn list_skills_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<Vec<SkillInfo>, AppCommandError> {
    let kb_dir = ensure_kb_dir(db, project_id).await?;
    skill_discovery::discover_skills(&kb_dir)
}

// ─── Upload ───

/// Infer doc_type from a target directory path.
fn infer_doc_type_from_target_dir(target_dir: &str) -> String {
    if target_dir.starts_with("templates") || target_dir.starts_with("templates/") {
        "template".to_string()
    } else if target_dir.starts_with("skills") || target_dir.starts_with("skills/") {
        "skill".to_string()
    } else if target_dir.starts_with("requirements") || target_dir.starts_with("requirements/") {
        "requirement".to_string()
    } else if target_dir.contains("ai-intermediate") {
        "ai_intermediate".to_string()
    } else if target_dir.contains(".private/tasks") {
        "task_attachment".to_string()
    } else {
        "tech_doc".to_string() // docs/ or any other dir → default
    }
}

/// Check whether a target_dir path is under `.private/`.
fn is_shared_from_target_dir(target_dir: &str) -> bool {
    !target_dir.starts_with(".private") && !target_dir.starts_with(".private/")
}

/// Extract skill name from a target_dir under `skills/`.
fn skill_name_from_target_dir(target_dir: &str) -> Option<String> {
    let stripped = target_dir
        .strip_prefix("skills/")
        .or_else(|| target_dir.strip_prefix("skills"))?;
    let first_component = stripped.split('/').next()?;
    if first_component.is_empty() {
        None
    } else {
        Some(first_component.to_string())
    }
}

pub async fn upload_kb_doc_core(
    db: &AppDatabase,
    project_id: i32,
    target_dir: String,
    filename: String,
    content_bytes: Vec<u8>,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    let conn = &db.conn;
    let kb_dir = ensure_kb_dir(db, project_id).await?;

    // Construct full file path
    let full_dir = Path::new(&kb_dir).join(&target_dir);
    tokio::task::block_in_place(|| {
        std::fs::create_dir_all(&full_dir).map_err(AppCommandError::io)
    })?;

    let full_path = full_dir.join(&filename);
    tokio::task::block_in_place(|| {
        std::fs::write(&full_path, &content_bytes).map_err(AppCommandError::io)
    })?;

    // Derive metadata
    let doc_type = infer_doc_type_from_target_dir(&target_dir);
    let is_shared = is_shared_from_target_dir(&target_dir);
    let skill_name = skill_name_from_target_dir(&target_dir);
    let file_path = format!("{}/{filename}", target_dir);
    let title = Path::new(&filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.clone());

    let draft = UpsertKnowledgeDocDraft {
        project_id,
        doc_type,
        title,
        file_path,
        is_shared,
        tags_json: None,
        description: None,
        skill_name,
        task_id: None,
    };

    platform_knowledge_doc_service::upsert_by_path(conn, draft)
        .await
        .map_err(AppCommandError::from)
}

pub async fn upload_task_attachment_core(
    db: &AppDatabase,
    project_id: i32,
    task_id: i32,
    filename: String,
    content_bytes: Vec<u8>,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    let conn = &db.conn;
    let kb_dir = ensure_kb_dir(db, project_id).await?;

    // Task attachments go to .private/tasks/{task_id}/
    let target_dir = format!(".private/tasks/{task_id}");
    let full_dir = Path::new(&kb_dir).join(&target_dir);
    tokio::task::block_in_place(|| {
        std::fs::create_dir_all(&full_dir).map_err(AppCommandError::io)
    })?;

    let full_path = full_dir.join(&filename);
    tokio::task::block_in_place(|| {
        std::fs::write(&full_path, &content_bytes).map_err(AppCommandError::io)
    })?;

    let file_path = format!("{target_dir}/{filename}");
    let title = Path::new(&filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.clone());

    let draft = UpsertKnowledgeDocDraft {
        project_id,
        doc_type: "task_attachment".to_string(),
        title,
        file_path,
        is_shared: false,
        tags_json: None,
        description: None,
        skill_name: None,
        task_id: Some(task_id),
    };

    platform_knowledge_doc_service::upsert_by_path(conn, draft)
        .await
        .map_err(AppCommandError::from)
}

pub async fn upload_task_ai_intermediate_doc_core(
    db: &AppDatabase,
    project_id: i32,
    task_id: i32,
    filename: String,
    content_bytes: Vec<u8>,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    let conn = &db.conn;
    let kb_dir = ensure_kb_dir(db, project_id).await?;

    let target_dir = format!(".private/tasks/{task_id}/ai-intermediate");
    let full_dir = Path::new(&kb_dir).join(&target_dir);
    tokio::task::block_in_place(|| {
        std::fs::create_dir_all(&full_dir).map_err(AppCommandError::io)
    })?;

    let full_path = full_dir.join(&filename);
    tokio::task::block_in_place(|| {
        std::fs::write(&full_path, &content_bytes).map_err(AppCommandError::io)
    })?;

    let file_path = format!("{target_dir}/{filename}");
    let title = Path::new(&filename)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| filename.clone());

    let draft = UpsertKnowledgeDocDraft {
        project_id,
        doc_type: "ai_intermediate".to_string(),
        title,
        file_path,
        is_shared: false,
        tags_json: None,
        description: None,
        skill_name: None,
        task_id: Some(task_id),
    };

    platform_knowledge_doc_service::upsert_by_path(conn, draft)
        .await
        .map_err(AppCommandError::from)
}

// ─── KB Init ───

pub async fn init_knowledge_repo_core(
    db: &AppDatabase,
    project_id: i32,
) -> Result<KbInitResult, AppCommandError> {
    // This just delegates to ensure_kb_dir + init_kb_dir
    let kb_dir = ensure_kb_dir(db, project_id).await?;

    // If the directory already existed (ensure_kb_dir skipped init),
    // re-run init_kb_dir to get the result struct (it's idempotent)
    init::init_kb_dir(&kb_dir)
}

// ─── Read content ───

pub async fn read_kb_doc_content_core(
    db: &AppDatabase,
    id: i32,
) -> Result<String, AppCommandError> {
    let conn = &db.conn;
    let doc = platform_knowledge_doc_service::get_by_id(conn, id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| AppCommandError::not_found(format!("Knowledge doc not found: {id}")))?;

    // Get project to resolve kb_local_dir
    let project = platform_project_service::get_by_id(conn, doc.project_id)
        .await
        .map_err(AppCommandError::from)?
        .ok_or_else(|| {
            AppCommandError::not_found(format!("Project not found: {}", doc.project_id))
        })?;

    let kb_dir = project
        .kb_local_dir
        .clone()
        .unwrap_or_else(|| {
            let mut buf = PathBuf::from(&project.root_dir);
            buf.push(KNOWLEDGE_DIR_NAME);
            buf.to_string_lossy().to_string()
        });

    let abs_path = Path::new(&kb_dir).join(&doc.file_path);

    tokio::task::block_in_place(|| {
        std::fs::read_to_string(&abs_path).map_err(AppCommandError::io)
    })
}

// ─── Tauri command wrappers (desktop mode only) ───

#[cfg(feature = "tauri-runtime")]
use tauri::State;

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn scan_knowledge_repo(
    db: State<'_, AppDatabase>,
    project_id: i32,
) -> Result<ScanResultInfo, AppCommandError> {
    scan_knowledge_repo_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_knowledge_docs(
    db: State<'_, AppDatabase>,
    project_id: i32,
    doc_type_filter: Option<String>,
) -> Result<Vec<KnowledgeDocInfo>, AppCommandError> {
    list_knowledge_docs_core(&db, project_id, doc_type_filter).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn search_knowledge_docs(
    db: State<'_, AppDatabase>,
    project_id: i32,
    query: String,
) -> Result<Vec<KnowledgeDocInfo>, AppCommandError> {
    search_knowledge_docs_core(&db, project_id, query).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn get_knowledge_doc(
    db: State<'_, AppDatabase>,
    id: i32,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    get_knowledge_doc_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
#[allow(clippy::too_many_arguments)]
pub async fn update_knowledge_doc(
    db: State<'_, AppDatabase>,
    id: i32,
    doc_type: Option<String>,
    title: Option<String>,
    is_shared: Option<bool>,
    tags_json: Option<Option<String>>,
    description: Option<Option<String>>,
    skill_name: Option<Option<String>>,
    task_id: Option<Option<i32>>,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    let draft = UpdateKnowledgeDocDraft {
        doc_type,
        title,
        is_shared,
        tags_json,
        description,
        skill_name,
        task_id,
    };
    update_knowledge_doc_core(&db, id, draft).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn delete_knowledge_doc(
    db: State<'_, AppDatabase>,
    id: i32,
) -> Result<(), AppCommandError> {
    delete_knowledge_doc_core(&db, id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn list_skills(
    db: State<'_, AppDatabase>,
    project_id: i32,
) -> Result<Vec<SkillInfo>, AppCommandError> {
    list_skills_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn upload_kb_doc(
    db: State<'_, AppDatabase>,
    project_id: i32,
    target_dir: String,
    filename: String,
    content_bytes: Vec<u8>,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    upload_kb_doc_core(&db, project_id, target_dir, filename, content_bytes).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn upload_task_attachment(
    db: State<'_, AppDatabase>,
    project_id: i32,
    task_id: i32,
    filename: String,
    content_bytes: Vec<u8>,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    upload_task_attachment_core(&db, project_id, task_id, filename, content_bytes).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn upload_task_ai_intermediate_doc(
    db: State<'_, AppDatabase>,
    project_id: i32,
    task_id: i32,
    filename: String,
    content_bytes: Vec<u8>,
) -> Result<KnowledgeDocInfo, AppCommandError> {
    upload_task_ai_intermediate_doc_core(&db, project_id, task_id, filename, content_bytes).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn init_knowledge_repo(
    db: State<'_, AppDatabase>,
    project_id: i32,
) -> Result<KbInitResult, AppCommandError> {
    init_knowledge_repo_core(&db, project_id).await
}

#[cfg(feature = "tauri-runtime")]
#[cfg_attr(feature = "tauri-runtime", tauri::command)]
pub async fn read_kb_doc_content(
    db: State<'_, AppDatabase>,
    id: i32,
) -> Result<String, AppCommandError> {
    read_kb_doc_content_core(&db, id).await
}
