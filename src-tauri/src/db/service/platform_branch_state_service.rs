use chrono::Utc;
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};

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

/// Insert or update the human state of a branch. A repo/branch pair with no
/// row = active with no note.
///
/// The two aspects update independently: an argument left `None` keeps the
/// stored column untouched, so archiving a branch never clears its note and
/// editing the note never un-archives it. A `description` that is empty or
/// whitespace-only clears the note.
pub async fn upsert<C: ConnectionTrait>(
    conn: &C,
    repo_id: i32,
    branch: &str,
    is_archived: Option<bool>,
    description: Option<String>,
) -> Result<BranchStateInfo, DbError> {
    let now = Utc::now();
    let archived = is_archived.unwrap_or(false);
    let note = description
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let a = platform_branch_state::ActiveModel {
        repo_id: Set(repo_id),
        branch: Set(branch.to_string()),
        is_archived: Set(archived),
        archived_at: Set(if archived { Some(now) } else { None }),
        description: Set(note),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    };

    // Overwrite only the columns the caller actually supplied. `created_at` is
    // deliberately absent so the original creation stamp survives an update.
    let mut update_columns = vec![platform_branch_state::Column::UpdatedAt];
    if is_archived.is_some() {
        update_columns.push(platform_branch_state::Column::IsArchived);
        update_columns.push(platform_branch_state::Column::ArchivedAt);
    }
    if description.is_some() {
        update_columns.push(platform_branch_state::Column::Description);
    }

    let inserted = platform_branch_state::Entity::insert(a)
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([
                platform_branch_state::Column::RepoId,
                platform_branch_state::Column::Branch,
            ])
            .update_columns(update_columns)
            .to_owned(),
        )
        .exec_with_returning(conn)
        .await?;
    Ok(to_info(inserted))
}
