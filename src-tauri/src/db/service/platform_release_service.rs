use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use sea_orm::PaginatorTrait;

use crate::db::entities::{platform_release, platform_release_item, platform_task_branch};
use crate::db::error::DbError;

pub async fn create<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
    release_code: &str,
    title: Option<&str>,
    notes: Option<&str>,
    deployer: Option<&str>,
) -> Result<platform_release::Model, DbError> {
    let now = Utc::now();
    let active = platform_release::ActiveModel {
        project_id: Set(project_id),
        release_code: Set(release_code.to_string()),
        title: Set(title.map(|s| s.to_string())),
        notes: Set(notes.map(|s| s.to_string())),
        status: Set("draft".to_string()),
        deployer: Set(deployer.map(|s| s.to_string())),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    };
    Ok(active.insert(conn).await?)
}

pub async fn update_status<C: ConnectionTrait>(
    conn: &C,
    release_id: i32,
    status: &str,
    deployer: Option<&str>,
) -> Result<platform_release::Model, DbError> {
    let model = platform_release::Entity::find_by_id(release_id)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound("release not found".to_string()))?;

    // State machine whitelist.
    // Allowed: draft→prd_deployed, prd_deployed→draft (rollback), prd_deployed→closed.
    let from = model.status.as_str();
    let allowed = matches!((from, status), ("draft", "prd_deployed") | ("prd_deployed", "draft") | ("prd_deployed", "closed"));
    if !allowed {
        return Err(DbError::InvalidStateTransition(format!(
            "{from} -> {status}"
        )));
    }

    let mut active: platform_release::ActiveModel = model.into();
    active.status = Set(status.to_string());
    active.updated_at = Set(Utc::now());
    if let Some(d) = deployer {
        active.deployer = Set(Some(d.to_string()));
    }
    if status == "prd_deployed" {
        active.prd_deployed_at = Set(Some(Utc::now()));
    }
    if status == "closed" {
        active.closed_at = Set(Some(Utc::now()));
    }
    Ok(active.update(conn).await?)
}

pub async fn list_by_project<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
) -> Result<Vec<platform_release::Model>, DbError> {
    platform_release::Entity::find()
        .filter(platform_release::Column::ProjectId.eq(project_id))
        .filter(platform_release::Column::DeletedAt.is_null())
        .order_by_desc(platform_release::Column::CreatedAt)
        .all(conn)
        .await
        .map_err(DbError::from)
}

pub async fn get_by_id<C: ConnectionTrait>(
    conn: &C,
    release_id: i32,
) -> Result<Option<platform_release::Model>, DbError> {
    platform_release::Entity::find_by_id(release_id).one(conn).await.map_err(DbError::from)
}

pub async fn count_items<C: ConnectionTrait>(
    conn: &C,
    release_id: i32,
) -> Result<i64, DbError> {
    let count = platform_release_item::Entity::find()
        .filter(platform_release_item::Column::ReleaseId.eq(release_id))
        .count(conn)
        .await?;
    Ok(count as i64)
}

pub async fn count_items_for_releases<C: ConnectionTrait>(
    conn: &C,
    release_ids: &[i32],
) -> Result<std::collections::HashMap<i32, i64>, DbError> {
    use std::collections::HashMap;
    let mut map = HashMap::new();
    if release_ids.is_empty() {
        return Ok(map);
    }
    let rows = platform_release_item::Entity::find()
        .filter(platform_release_item::Column::ReleaseId.is_in(release_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(DbError::from)?;
    for row in rows {
        *map.entry(row.release_id).or_insert(0) += 1;
    }
    // releases with no items need an explicit 0 entry
    for id in release_ids {
        map.entry(*id).or_insert(0);
    }
    Ok(map)
}

pub async fn list_releases_for_task<C: ConnectionTrait>(
    conn: &C,
    task_id: i32,
) -> Result<Vec<platform_release::Model>, DbError> {
    let branch_ids: Vec<i32> = platform_task_branch::Entity::find()
        .filter(platform_task_branch::Column::TaskId.eq(task_id))
        .all(conn)
        .await?
        .into_iter()
        .map(|b| b.id)
        .collect();
    if branch_ids.is_empty() {
        return Ok(Vec::new());
    }
    let release_ids: Vec<i32> = platform_release_item::Entity::find()
        .filter(platform_release_item::Column::BranchId.is_in(branch_ids))
        .all(conn)
        .await?
        .into_iter()
        .map(|i| i.release_id)
        .collect();
    if release_ids.is_empty() {
        return Ok(Vec::new());
    }
    let releases = platform_release::Entity::find()
        .filter(platform_release::Column::Id.is_in(release_ids))
        .order_by_desc(platform_release::Column::CreatedAt)
        .all(conn)
        .await?;
    Ok(releases)
}

pub async fn soft_delete<C: ConnectionTrait>(
    conn: &C,
    release_id: i32,
) -> Result<platform_release::Model, DbError> {
    let model = platform_release::Entity::find_by_id(release_id)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound("release not found".to_string()))?;
    let mut active: platform_release::ActiveModel = model.into();
    active.deleted_at = Set(Some(Utc::now()));
    Ok(active.update(conn).await?)
}

pub async fn add_item<C: ConnectionTrait>(
    conn: &C,
    release_id: i32,
    branch_id: i32,
    task_id: Option<i32>,
    external_ref_json: Option<&str>,
) -> Result<platform_release_item::Model, DbError> {
    let active = platform_release_item::ActiveModel {
        release_id: Set(release_id),
        branch_id: Set(branch_id),
        task_id: Set(task_id),
        external_ref_json: Set(external_ref_json.map(|s| s.to_string())),
        created_at: Set(Utc::now()),
        ..Default::default()
    };
    Ok(active.insert(conn).await?)
}

pub async fn list_items<C: ConnectionTrait>(
    conn: &C,
    release_id: i32,
) -> Result<Vec<platform_release_item::Model>, DbError> {
    platform_release_item::Entity::find()
        .filter(platform_release_item::Column::ReleaseId.eq(release_id))
        .all(conn)
        .await
        .map_err(DbError::from)
}

pub async fn remove_item<C: ConnectionTrait>(
    conn: &C,
    item_id: i32,
) -> Result<u64, DbError> {
    platform_release_item::Entity::delete_by_id(item_id)
        .exec(conn)
        .await
        .map(|r| r.rows_affected)
        .map_err(DbError::from)
}