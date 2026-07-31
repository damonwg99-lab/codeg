use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set, IntoActiveModel,
};

use crate::db::entities::platform_task_type_mapping;
use crate::db::error::DbError;
use crate::models::TaskTypeMappingInfo;

fn to_info(m: platform_task_type_mapping::Model) -> TaskTypeMappingInfo {
    TaskTypeMappingInfo {
        id: m.id,
        local_type: m.local_type,
        zentao_type: m.zentao_type,
        zentao_module: m.zentao_module,
        project_id: m.project_id,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_by_project(
    conn: &DatabaseConnection,
    project_id: Option<i32>,
) -> Result<Vec<TaskTypeMappingInfo>, DbError> {
    let mut query = platform_task_type_mapping::Entity::find();
    if let Some(pid) = project_id {
        query = query.filter(platform_task_type_mapping::Column::ProjectId.eq(pid));
    }
    let rows = query.all(conn).await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn create(
    conn: &DatabaseConnection,
    local_type: &str,
    zentao_type: &str,
    zentao_module: Option<String>,
    project_id: Option<i32>,
) -> Result<TaskTypeMappingInfo, DbError> {
    let now = Utc::now();
    let model = platform_task_type_mapping::ActiveModel {
        id: NotSet,
        local_type: Set(local_type.to_string()),
        zentao_type: Set(zentao_type.to_string()),
        zentao_module: Set(zentao_module),
        project_id: Set(project_id),
        created_at: Set(now),
        updated_at: Set(now),
    };
    let result = model.insert(conn).await?;
    Ok(to_info(result))
}

pub async fn update(
    conn: &DatabaseConnection,
    id: i32,
    local_type: Option<String>,
    zentao_type: Option<String>,
    zentao_module: Option<Option<String>>,
) -> Result<TaskTypeMappingInfo, DbError> {
    let row = platform_task_type_mapping::Entity::find_by_id(id)
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Task type mapping not found: {id}")))?;

    let mut active = row.into_active_model();
    if let Some(v) = local_type {
        active.local_type = Set(v);
    }
    if let Some(v) = zentao_type {
        active.zentao_type = Set(v);
    }
    if let Some(v) = zentao_module {
        active.zentao_module = Set(v);
    }
    active.updated_at = Set(Utc::now());
    let result = active.update(conn).await?;
    Ok(to_info(result))
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    platform_task_type_mapping::Entity::delete_by_id(id)
        .exec(conn)
        .await?;
    Ok(())
}
