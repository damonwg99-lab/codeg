//! Cluster A: platform-repo folder creation (D32 decoupled from
//! [`folder_service`]).
//!
//! Project sub-repos registered via [`crate::commands::project`] hit this
//! helper to insert a top-level folder row with `kind = platform_repo`. The
//! frontend sidebar excludes `platform_repo` folders from its folder list
//! (see `@/lib/platform/folder-kind-ext`) so they remain selectable as a
//! working scope without polluting the user's visible folder tree.

use sea_orm::DatabaseConnection;

use crate::db::entities::folder::FolderKind;
use crate::db::error::DbError;
use crate::db::service::folder_service::{add_folder_inner, ParentWrite};
use crate::models::FolderHistoryEntry;

/// Create a `platform_repo` folder backing a project git repository.
///
/// Mirrors [`crate::db::service::folder_service::add_folder`] but sets
/// `kind = platform_repo`. The folder is a top-level entry (`parent_id` is
/// preserved, i.e. NULL for new rows); the project-cluster caller is
/// responsible for separately tracking the row in `platform_project_repo`.
/// Reopening an existing row does NOT rewrite its `kind` (it is written once
/// at insert per the folder entity contract).
pub async fn add_platform_repo_folder(
    conn: &DatabaseConnection,
    path: &str,
) -> Result<FolderHistoryEntry, DbError> {
    add_folder_inner(conn, path, ParentWrite::Preserve, FolderKind::PlatformRepo).await
}