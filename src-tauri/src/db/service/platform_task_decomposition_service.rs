use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

use crate::db::entities::platform_task_decomposition;
use crate::db::error::DbError;
use crate::models::TaskDecompositionInfo;

fn to_info(m: platform_task_decomposition::Model) -> TaskDecompositionInfo {
    TaskDecompositionInfo {
        id: m.id,
        source_task_id: m.source_task_id,
        ai_generated: m.ai_generated,
        decomposition_json: m.decomposition_json,
        created_at: m.created_at,
    }
}

pub async fn create(
    conn: &DatabaseConnection,
    source_task_id: i32,
    ai_generated: bool,
    decomposition_json: Option<String>,
) -> Result<TaskDecompositionInfo, DbError> {
    let now = Utc::now();
    let model = platform_task_decomposition::ActiveModel {
        id: NotSet,
        source_task_id: Set(source_task_id),
        ai_generated: Set(ai_generated),
        decomposition_json: Set(decomposition_json),
        created_at: Set(now),
    };
    let result = model.insert(conn).await?;
    Ok(to_info(result))
}

pub async fn list_by_task(
    conn: &DatabaseConnection,
    source_task_id: i32,
) -> Result<Vec<TaskDecompositionInfo>, DbError> {
    let rows = platform_task_decomposition::Entity::find()
        .filter(platform_task_decomposition::Column::SourceTaskId.eq(source_task_id))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}
