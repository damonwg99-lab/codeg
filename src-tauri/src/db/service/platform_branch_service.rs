use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, JoinType, QueryFilter, QuerySelect, RelationTrait, Set};
use std::collections::HashMap;

use crate::db::entities::{platform_branch, platform_task_branch};
use crate::db::error::DbError;

pub async fn upsert<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
    repo_name: &str,
    branch_name: &str,
) -> Result<platform_branch::Model, DbError> {
    let existing = platform_branch::Entity::find()
        .filter(platform_branch::Column::ProjectId.eq(project_id))
        .filter(platform_branch::Column::RepoName.eq(repo_name))
        .filter(platform_branch::Column::Branch.eq(branch_name))
        .one(conn)
        .await?;

    if let Some(model) = existing {
        Ok(model)
    } else {
        let now = Utc::now();
        let active = platform_branch::ActiveModel {
            project_id: Set(project_id),
            repo_name: Set(repo_name.to_string()),
            branch: Set(branch_name.to_string()),
            status: Set("open".to_string()),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        };
        Ok(active.insert(conn).await?)
    }
}

pub async fn update_status<C: ConnectionTrait>(
    conn: &C,
    branch_id: i32,
    status: &str,
) -> Result<platform_branch::Model, DbError> {
    let model = platform_branch::Entity::find_by_id(branch_id)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound("branch not found".to_string()))?;
    let mut active: platform_branch::ActiveModel = model.into();
    active.status = Set(status.to_string());
    active.updated_at = Set(Utc::now());
    active.update(conn).await.map_err(DbError::from)
}

pub async fn list_by_project<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
) -> Result<Vec<platform_branch::Model>, DbError> {
    platform_branch::Entity::find()
        .filter(platform_branch::Column::ProjectId.eq(project_id))
        .all(conn)
        .await
        .map_err(DbError::from)
}

pub async fn list_by_status<C: ConnectionTrait>(
    conn: &C,
    project_id: i32,
    status: &str,
) -> Result<Vec<platform_branch::Model>, DbError> {
    platform_branch::Entity::find()
        .filter(platform_branch::Column::ProjectId.eq(project_id))
        .filter(platform_branch::Column::Status.eq(status))
        .all(conn)
        .await
        .map_err(DbError::from)
}

pub async fn link_to_task<C: ConnectionTrait>(
    conn: &C,
    task_id: i32,
    branch_id: i32,
) -> Result<platform_task_branch::Model, DbError> {
    let existing = platform_task_branch::Entity::find()
        .filter(platform_task_branch::Column::TaskId.eq(task_id))
        .filter(platform_task_branch::Column::BranchId.eq(branch_id))
        .one(conn)
        .await?;

    if let Some(model) = existing {
        Ok(model)
    } else {
        let active = platform_task_branch::ActiveModel {
            task_id: Set(task_id),
            branch_id: Set(branch_id),
            created_at: Set(Utc::now()),
            ..Default::default()
        };
        Ok(active.insert(conn).await?)
    }
}

pub async fn list_task_branches<C: ConnectionTrait>(
    conn: &C,
    task_id: i32,
) -> Result<Vec<platform_branch::Model>, DbError> {
    platform_branch::Entity::find()
        .join(
            JoinType::InnerJoin,
            platform_branch::Relation::TaskBranches.def(),
        )
        .filter(platform_task_branch::Column::TaskId.eq(task_id))
        .all(conn)
        .await
        .map_err(DbError::from)
}

pub async fn list_tasks_for_branch<C: ConnectionTrait>(
    conn: &C,
    branch_id: i32,
) -> Result<Vec<platform_task_branch::Model>, DbError> {
    platform_task_branch::Entity::find()
        .filter(platform_task_branch::Column::BranchId.eq(branch_id))
        .all(conn)
        .await
        .map_err(DbError::from)
}

pub async fn list_task_branch_links<C: ConnectionTrait>(
    conn: &C,
    task_id: i32,
) -> Result<Vec<platform_task_branch::Model>, DbError> {
    platform_task_branch::Entity::find()
        .filter(platform_task_branch::Column::TaskId.eq(task_id))
        .all(conn)
        .await
        .map_err(DbError::from)
}

pub async fn unlink_task_branch<C: ConnectionTrait>(
    conn: &C,
    task_id: i32,
    branch_id: i32,
) -> Result<u64, DbError> {
    platform_task_branch::Entity::delete_many()
        .filter(platform_task_branch::Column::TaskId.eq(task_id))
        .filter(platform_task_branch::Column::BranchId.eq(branch_id))
        .exec(conn)
        .await
        .map(|r| r.rows_affected)
        .map_err(DbError::from)
}

pub async fn count_branches_for_tasks<C: ConnectionTrait>(
    conn: &C,
    task_ids: &[i32],
) -> Result<HashMap<i32, usize>, DbError> {
    if task_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = platform_task_branch::Entity::find()
        .filter(platform_task_branch::Column::TaskId.is_in(task_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(DbError::from)?;
    let mut map = HashMap::new();
    for row in rows {
        *map.entry(row.task_id).or_insert(0) += 1;
    }
    Ok(map)
}

pub async fn get_branch_statuses_for_tasks<C: ConnectionTrait>(
    conn: &C,
    task_ids: &[i32],
) -> Result<HashMap<i32, Vec<String>>, DbError> {
    use sea_orm::QueryFilter;
    if task_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let task_branches = platform_task_branch::Entity::find()
        .filter(platform_task_branch::Column::TaskId.is_in(task_ids.iter().copied()))
        .all(conn)
        .await
        .map_err(DbError::from)?;
    let branch_ids: Vec<i32> = task_branches.iter().map(|tb| tb.branch_id).collect();
    if branch_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let branches = platform_branch::Entity::find()
        .filter(platform_branch::Column::Id.is_in(branch_ids))
        .all(conn)
        .await
        .map_err(DbError::from)?;
    let status_by_branch: HashMap<i32, String> =
        branches.into_iter().map(|b| (b.id, b.status)).collect();
    let mut map: HashMap<i32, Vec<String>> = HashMap::new();
    for tb in task_branches {
        if let Some(status) = status_by_branch.get(&tb.branch_id) {
            map.entry(tb.task_id).or_default().push(status.clone());
        }
    }
    Ok(map)
}
