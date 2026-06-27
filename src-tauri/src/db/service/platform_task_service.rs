use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder, Set, IntoActiveModel,
};
use sea_orm::entity::prelude::DateTimeUtc;

use crate::db::entities::platform_task;
use crate::db::error::DbError;
use crate::models::TaskInfo;

fn to_info(m: platform_task::Model) -> TaskInfo {
    TaskInfo {
        id: m.id,
        project_id: m.project_id,
        parent_task_id: m.parent_task_id,
        title: m.title,
        description: m.description,
        task_type: m.task_type,
        status: m.status,
        priority: m.priority,
        assignee: m.assignee,
        zentao_id: m.zentao_id,
        zentao_type: m.zentao_type,
        zentao_sync_status: m.zentao_sync_status,
        deadline: m.deadline,
        estimated_hours: m.estimated_hours,
        consumed_hours: m.consumed_hours,
        zentao_module: m.zentao_module,
        kb_refs_json: m.kb_refs_json,
        affected_repos_json: m.affected_repos_json,
        delegation_config: m.delegation_config,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_by_project(
    conn: &DatabaseConnection,
    project_id: i32,
) -> Result<Vec<TaskInfo>, DbError> {
    let rows = platform_task::Entity::find()
        .filter(platform_task::Column::ProjectId.eq(project_id))
        .filter(platform_task::Column::DeletedAt.is_null())
        .order_by_asc(platform_task::Column::Status)
        .order_by_desc(platform_task::Column::Priority)
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn get_by_id(
    conn: &DatabaseConnection,
    id: i32,
) -> Result<Option<TaskInfo>, DbError> {
    let row = platform_task::Entity::find_by_id(id)
        .filter(platform_task::Column::DeletedAt.is_null())
        .one(conn)
        .await?;
    Ok(row.map(to_info))
}

pub async fn create(
    conn: &DatabaseConnection,
    project_id: i32,
    title: &str,
    task_type: &str,
    description: Option<String>,
    priority: Option<String>,
    assignee: Option<String>,
    parent_task_id: Option<i32>,
) -> Result<TaskInfo, DbError> {
    let now = Utc::now();
    let model = platform_task::ActiveModel {
        id: NotSet,
        project_id: Set(project_id),
        parent_task_id: Set(parent_task_id),
        title: Set(title.to_string()),
        description: Set(description),
        task_type: Set(task_type.to_string()),
        status: Set("backlog".to_string()),
        priority: Set(priority),
        assignee: Set(assignee),
        zentao_id: Set(None),
        zentao_type: Set(None),
        zentao_sync_status: Set(Some("none".to_string())),
        deadline: Set(None),
        estimated_hours: Set(None),
        consumed_hours: Set(None),
        zentao_module: Set(None),
        kb_refs_json: Set(None),
        affected_repos_json: Set(None),
        delegation_config: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
        deleted_at: Set(None),
    };
    let result = model.insert(conn).await?;
    Ok(to_info(result))
}

pub async fn update(
    conn: &DatabaseConnection,
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
    deadline: Option<Option<DateTimeUtc>>,
    estimated_hours: Option<Option<f64>>,
    consumed_hours: Option<Option<f64>>,
    zentao_module: Option<Option<String>>,
    kb_refs_json: Option<Option<String>>,
    affected_repos_json: Option<Option<String>>,
    delegation_config: Option<Option<String>>,
) -> Result<TaskInfo, DbError> {
    let row = platform_task::Entity::find_by_id(id)
        .filter(platform_task::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Task not found: {id}")))?;

    let mut active = row.into_active_model();
    if let Some(v) = title {
        active.title = Set(v);
    }
    if let Some(v) = description {
        active.description = Set(Some(v));
    }
    if let Some(v) = task_type {
        active.task_type = Set(v);
    }
    if let Some(v) = status {
        active.status = Set(v);
    }
    if let Some(v) = priority {
        active.priority = Set(v);
    }
    if let Some(v) = assignee {
        active.assignee = Set(v);
    }
    if let Some(v) = parent_task_id {
        active.parent_task_id = Set(v);
    }
    if let Some(v) = zentao_id {
        active.zentao_id = Set(v);
    }
    if let Some(v) = zentao_type {
        active.zentao_type = Set(v);
    }
    if let Some(v) = zentao_sync_status {
        active.zentao_sync_status = Set(v);
    }
    if let Some(v) = deadline {
        active.deadline = Set(v);
    }
    if let Some(v) = estimated_hours {
        active.estimated_hours = Set(v);
    }
    if let Some(v) = consumed_hours {
        active.consumed_hours = Set(v);
    }
    if let Some(v) = zentao_module {
        active.zentao_module = Set(v);
    }
    if let Some(v) = kb_refs_json {
        active.kb_refs_json = Set(v);
    }
    if let Some(v) = affected_repos_json {
        active.affected_repos_json = Set(v);
    }
    if let Some(v) = delegation_config {
        active.delegation_config = Set(v);
    }
    active.updated_at = Set(Utc::now());
    let result = active.update(conn).await?;
    Ok(to_info(result))
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    let row = platform_task::Entity::find_by_id(id)
        .filter(platform_task::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Task not found: {id}")))?;

    let mut active = row.into_active_model();
    active.deleted_at = Set(Some(Utc::now()));
    active.updated_at = Set(Utc::now());
    active.update(conn).await?;
    Ok(())
}

pub async fn list_by_status(
    conn: &DatabaseConnection,
    project_id: i32,
    status: &str,
) -> Result<Vec<TaskInfo>, DbError> {
    let rows = platform_task::Entity::find()
        .filter(platform_task::Column::ProjectId.eq(project_id))
        .filter(platform_task::Column::DeletedAt.is_null())
        .filter(platform_task::Column::Status.eq(status))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn list_sub_tasks(
    conn: &DatabaseConnection,
    parent_task_id: i32,
) -> Result<Vec<TaskInfo>, DbError> {
    let rows = platform_task::Entity::find()
        .filter(platform_task::Column::ParentTaskId.eq(parent_task_id))
        .filter(platform_task::Column::DeletedAt.is_null())
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn list_by_zentao_sync_status(
    conn: &DatabaseConnection,
    status: &str,
) -> Result<Vec<TaskInfo>, DbError> {
    let rows = platform_task::Entity::find()
        .filter(platform_task::Column::DeletedAt.is_null())
        .filter(platform_task::Column::ZentaoSyncStatus.eq(status))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn update_status(
    conn: &DatabaseConnection,
    id: i32,
    status: &str,
) -> Result<TaskInfo, DbError> {
    let row = platform_task::Entity::find_by_id(id)
        .filter(platform_task::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Task not found: {id}")))?;

    let mut active = row.into_active_model();
    active.status = Set(status.to_string());
    active.updated_at = Set(Utc::now());
    let result = active.update(conn).await?;
    Ok(to_info(result))
}
