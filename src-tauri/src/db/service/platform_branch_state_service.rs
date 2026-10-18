use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};

use crate::db::entities::{platform_branch_state, platform_project_repo};
use crate::db::error::DbError;
use crate::models::BranchStateInfo;

fn to_info(m: platform_branch_state::Model) -> BranchStateInfo {
    BranchStateInfo {
        id: m.id,
        repo_id: m.repo_id,
        branch: m.branch,
        is_archived: m.is_archived,
        archived_at: m.archived_at,
        description: m.description,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_by_project<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
) -> Result<Vec<BranchStateInfo>, DbError> {
    let repo_ids: Vec<i32> = platform_project_repo::Entity::find()
        .filter(platform_project_repo::Column::ProjectId.eq(project_id))
        .all(conn)
        .await?
        .into_iter()
        .map(|r| r.id)
        .collect();
    if repo_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = platform_branch_state::Entity::find()
        .filter(platform_branch_state::Column::RepoId.is_in(repo_ids))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

/// Insert or update the human state of a branch. `is_archived`/`description`
/// are optional so callers can update just one aspect. A repo/branch pair with
/// no row = active with no note.
pub async fn upsert<C: ConnectionTrait>(
    conn: &C,
    repo_id: i32,
    branch: &str,
    is_archived: Option<bool>,
    description: Option<Option<String>>,
) -> Result<BranchStateInfo, DbError> {
    let now = Utc::now();
    let archived = is_archived.unwrap_or(false);
    let description = description.flatten();
    let a = platform_branch_state::ActiveModel {
        repo_id: Set(repo_id),
        branch: Set(branch.to_string()),
        is_archived: Set(archived),
        archived_at: Set(if archived { Some(now) } else { None }),
        description: Set(description.clone()),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    };
    let inserted = platform_branch_state::Entity::insert(a)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([
                platform_branch_state::Column::RepoId,
                platform_branch_state::Column::Branch,
            ])
            .update_columns([
                platform_branch_state::Column::IsArchived,
                platform_branch_state::Column::ArchivedAt,
                platform_branch_state::Column::Description,
                platform_branch_state::Column::UpdatedAt,
            ])
            .to_owned(),
        )
        .exec_with_returning(conn)
        .await?;
    Ok(to_info(inserted))
}

/// Ensure a state row exists for `branch` and is archived. No-op when a row
/// already exists (so a user's manual restore is never overridden). Used to
/// hide environment branches (dev/uat/prd) from the active list by default.
pub async fn ensure_archived<C: ConnectionTrait>(
    conn: &C,
    repo_id: i32,
    branch: &str,
) -> Result<(), DbError> {
    let existing = platform_branch_state::Entity::find()
        .filter(platform_branch_state::Column::RepoId.eq(repo_id))
        .filter(platform_branch_state::Column::Branch.eq(branch))
        .one(conn)
        .await?;
    if existing.is_some() {
        return Ok(());
    }
    let now = Utc::now();
    let active = platform_branch_state::ActiveModel {
        repo_id: Set(repo_id),
        branch: Set(branch.to_string()),
        is_archived: Set(true),
        archived_at: Set(Some(now)),
        description: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    };
    let _ = active.insert(conn).await;
    Ok(())
}

/// Delete state rows for branches that no longer exist in git, for one repo.
/// Keeps the archive/note table free of orphans.
pub async fn prune_not_in<C: ConnectionTrait>(
    conn: &C,
    repo_id: i32,
    keep: &[String],
) -> Result<u64, DbError> {
    let mut delete = platform_branch_state::Entity::delete_many()
        .filter(platform_branch_state::Column::RepoId.eq(repo_id));
    if !keep.is_empty() {
        delete = delete.filter(platform_branch_state::Column::Branch.is_not_in(keep.to_vec()));
    }
    let result = delete.exec(conn).await?;
    Ok(result.rows_affected)
}