//! Platform (Cluster A/B/C/D/E) HTTP route table, split into its own module so
//! `web/router.rs` can register all platform routes with one `.merge(...)` call
//! without threading every platform endpoint through the giant main route list.
//!
//! The returned [`Router`] carries no auth/CORS layer of its own — it gets the
//! same `require_token` middleware / CORS wrapping the rest of `api` gets once
//! `build_router` merges it in BEFORE applying `.layer(auth::require_token)`.
//! That keeps every platform route under the same `CODEG_TOKEN` gate as the
//! core router without duplicating the middleware setup. Multipart upload
//! routes (KB doc / task attachment / AI intermediate doc) carry their own
//! `DefaultBodyLimit::disable()` which composes with the outer auth layer
//! exactly as it would inline.

use axum::{
    extract::DefaultBodyLimit,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

/// Web params for `/search_files_content` (Cluster E). The desktop path streams
/// results via the `search_files_content:results` event; the web/server path
/// returns the full `Vec<FileContentMatch>` synchronously via this endpoint.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFilesContentParams {
    base_path: String,
    keyword: String,
    max_results: Option<usize>,
}

/// Inline handler for `/search_files_content` — delegates to the shared
/// `commands::file_search::search_files_content` core. Lives here instead of
/// in `handlers/folders.rs` to keep the Cluster E surface grouped with the
/// rest of the platform routes (D32 decoupling).
async fn search_files_content(
    Json(params): Json<SearchFilesContentParams>,
) -> Result<
    Json<Vec<crate::commands::file_search::FileContentMatch>>,
    crate::app_error::AppCommandError,
> {
    let result = crate::commands::file_search::search_files_content(
        params.base_path,
        params.keyword,
        params.max_results,
    )
    .await?;
    Ok(Json(result))
}

/// Build the platform route router. The routes match the command names used by
/// the web transport (`call("list_projects") -> POST /api/list_projects`), so
/// they share the same flat `/api/` namespace as the rest of the API — no
/// `/platform/` prefix is introduced.
pub fn platform_routes() -> Router {
    Router::new()
        // ─── Project + zentao + credentials (Cluster A) ─────────────────────
        .route("/list_projects", post(handlers::project::list_projects))
        .route("/get_project", post(handlers::project::get_project))
        .route("/create_project", post(handlers::project::create_project))
        .route("/update_project", post(handlers::project::update_project))
        .route("/delete_project", post(handlers::project::delete_project))
        .route("/list_project_repos", post(handlers::project::list_project_repos))
        .route("/add_project_repo", post(handlers::project::add_project_repo))
        .route("/remove_project_repo", post(handlers::project::remove_project_repo))
        .route("/scan_git_repos", post(handlers::project::scan_git_repos))
        .route("/get_global_config", post(handlers::project::get_global_config))
        .route("/set_global_config", post(handlers::project::set_global_config))
        .route("/save_credential", post(handlers::project::save_credential))
        .route("/delete_credential", post(handlers::project::delete_credential))
        .route(
            "/check_credential_exists",
            post(handlers::project::check_credential_exists),
        )
        // ─── Tasks + task-type mapping + decomposition + branch links (Clusters A/B/D) ─
        .route("/list_tasks", post(handlers::task::list_tasks))
        .route("/get_task", post(handlers::task::get_task))
        .route("/create_task", post(handlers::task::create_task))
        .route("/update_task", post(handlers::task::update_task))
        .route("/update_task_status", post(handlers::task::update_task_status))
        .route("/delete_task", post(handlers::task::delete_task))
        .route("/link_conversation", post(handlers::task::link_conversation))
        .route(
            "/create_conversation_for_task",
            post(handlers::task::create_conversation_for_task),
        )
        .route("/unlink_conversation", post(handlers::task::unlink_conversation))
        .route(
            "/list_task_conversations",
            post(handlers::task::list_task_conversations),
        )
        .route(
            "/get_task_by_conversation",
            post(handlers::task::get_task_by_conversation),
        )
        .route(
            "/list_task_type_mappings",
            post(handlers::task::list_task_type_mappings),
        )
        .route(
            "/create_task_type_mapping",
            post(handlers::task::create_task_type_mapping),
        )
        .route(
            "/update_task_type_mapping",
            post(handlers::task::update_task_type_mapping),
        )
        .route(
            "/delete_task_type_mapping",
            post(handlers::task::delete_task_type_mapping),
        )
        .route(
            "/create_decomposition",
            post(handlers::task::create_decomposition),
        )
        .route("/link_task_branch", post(handlers::task::link_task_branch))
        .route("/update_task_branch", post(handlers::task::update_task_branch))
        .route("/update_task_db_scripts", post(handlers::task::update_task_db_scripts))
        .route("/unlink_task_branch", post(handlers::task::unlink_task_branch))
        // ─── Releases (Cluster B) ────────────────────────────────────────────
        .route("/create_release", post(handlers::release::create_release))
        .route("/list_releases", post(handlers::release::list_releases))
        .route("/releases/for_task", get(handlers::release::list_releases_for_task))
        .route("/get_release", post(handlers::release::get_release))
        .route("/update_release", post(handlers::release::update_release))
        .route("/delete_release", post(handlers::release::delete_release))
        // ─── Knowledge Base: scan / docs / skills / upload / watcher (Cluster C) ─
        .route(
            "/scan_knowledge_repo",
            post(handlers::knowledge::scan_knowledge_repo),
        )
        .route(
            "/list_knowledge_docs",
            post(handlers::knowledge::list_knowledge_docs),
        )
        .route(
            "/search_knowledge_docs",
            post(handlers::knowledge::search_knowledge_docs),
        )
        .route("/get_knowledge_doc", post(handlers::knowledge::get_knowledge_doc))
        .route(
            "/update_knowledge_doc",
            post(handlers::knowledge::update_knowledge_doc),
        )
        .route(
            "/delete_knowledge_doc",
            post(handlers::knowledge::delete_knowledge_doc),
        )
        .route("/list_skills", post(handlers::knowledge::list_skills))
        .route(
            "/init_knowledge_repo",
            post(handlers::knowledge::init_knowledge_repo),
        )
        .route(
            "/read_kb_doc_content",
            post(handlers::knowledge::read_kb_doc_content),
        )
        .route("/start_kb_watch", post(handlers::knowledge::start_kb_watch))
        .route("/stop_kb_watch", post(handlers::knowledge::stop_kb_watch))
        // Multipart upload routes — disabled DefaultBodyLimit so large KB docs
        // / task attachments bypass the default 2 MiB request cap.
        .route(
            "/upload_kb_doc",
            post(handlers::knowledge::upload_kb_doc).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/upload_task_attachment",
            post(handlers::knowledge::upload_task_attachment)
                .layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/upload_task_ai_intermediate_doc",
            post(handlers::knowledge::upload_task_ai_intermediate_doc)
                .layer(DefaultBodyLimit::disable()),
        )
        // ─── File content search (Cluster E) ────────────────────────────────
        .route(
            "/search_files_content",
            post(search_files_content),
        )
        // ─── Releases for a task (Cluster B, GET path) ──────────────────────
        .route(
            "/releases/for_task",
            get(handlers::release::list_releases_for_task),
        )
}

use crate::web::handlers;