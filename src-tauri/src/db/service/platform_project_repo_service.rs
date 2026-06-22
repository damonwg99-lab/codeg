use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set, IntoActiveModel,
};

use crate::db::entities::platform_project_repo;
use crate::db::error::DbError;
use crate::models::ProjectRepoInfo;

fn to_info(m: platform_project_repo::Model) -> ProjectRepoInfo {
    ProjectRepoInfo {
        id: m.id,
        project_id: m.project_id,
        name: m.name,
        git_url: m.git_url,
        local_dir: m.local_dir,
        branch: m.branch,
        has_claude_md: m.has_claude_md,
        folder_id: m.folder_id,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_by_project(
    conn: &DatabaseConnection,
    project_id: i32,
) -> Result<Vec<ProjectRepoInfo>, DbError> {
    let rows = platform_project_repo::Entity::find()
        .filter(platform_project_repo::Column::ProjectId.eq(project_id))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn get_by_id(
    conn: &DatabaseConnection,
    id: i32,
) -> Result<Option<ProjectRepoInfo>, DbError> {
    let row = platform_project_repo::Entity::find_by_id(id)
        .one(conn)
        .await?;
    Ok(row.map(to_info))
}

pub async fn create(
    conn: &DatabaseConnection,
    project_id: i32,
    name: &str,
    git_url: &str,
    local_dir: &str,
    branch: Option<String>,
    has_claude_md: bool,
    folder_id: Option<i32>,
) -> Result<ProjectRepoInfo, DbError> {
    let now = Utc::now();
    let model = platform_project_repo::ActiveModel {
        id: NotSet,
        project_id: Set(project_id),
        name: Set(name.to_string()),
        git_url: Set(git_url.to_string()),
        local_dir: Set(local_dir.to_string()),
        branch: Set(branch),
        has_claude_md: Set(has_claude_md),
        folder_id: Set(folder_id),
        created_at: Set(now),
        updated_at: Set(now),
    };
    let result = model.insert(conn).await?;
    Ok(to_info(result))
}

pub async fn update(
    conn: &DatabaseConnection,
    id: i32,
    name: Option<String>,
    git_url: Option<String>,
    local_dir: Option<String>,
    branch: Option<Option<String>>,
    has_claude_md: Option<bool>,
    folder_id: Option<Option<i32>>,
) -> Result<ProjectRepoInfo, DbError> {
    let row = platform_project_repo::Entity::find_by_id(id)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Project repo not found: {id}")))?;

    let mut active = row.into_active_model();
    if let Some(v) = name {
        active.name = Set(v);
    }
    if let Some(v) = git_url {
        active.git_url = Set(v);
    }
    if let Some(v) = local_dir {
        active.local_dir = Set(v);
    }
    if let Some(v) = branch {
        active.branch = Set(v);
    }
    if let Some(v) = has_claude_md {
        active.has_claude_md = Set(v);
    }
    if let Some(v) = folder_id {
        active.folder_id = Set(v);
    }
    active.updated_at = Set(Utc::now());
    let result = active.update(conn).await?;
    Ok(to_info(result))
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    // Hard delete — project_repo has no soft-delete column
    platform_project_repo::Entity::delete_by_id(id)
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn find_by_folder_id(
    conn: &DatabaseConnection,
    folder_id: i32,
) -> Result<Option<ProjectRepoInfo>, DbError> {
    let row = platform_project_repo::Entity::find()
        .filter(platform_project_repo::Column::FolderId.eq(folder_id))
        .one(conn)
        .await?;
    Ok(row.map(to_info))
}
