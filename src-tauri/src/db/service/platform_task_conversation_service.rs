use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set, IntoActiveModel,
};

use crate::db::entities::platform_task_conversation;
use crate::db::error::DbError;
use crate::models::TaskConversationInfo;

fn to_info(m: platform_task_conversation::Model) -> TaskConversationInfo {
    TaskConversationInfo {
        id: m.id,
        task_id: m.task_id,
        conversation_id: m.conversation_id,
        conversation_role: m.conversation_role,
        summary: m.summary,
        injected_docs_json: m.injected_docs_json,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_by_task(
    conn: &DatabaseConnection,
    task_id: i32,
) -> Result<Vec<TaskConversationInfo>, DbError> {
    let rows = platform_task_conversation::Entity::find()
        .filter(platform_task_conversation::Column::TaskId.eq(task_id))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn get_by_conversation(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<Option<TaskConversationInfo>, DbError> {
    let row = platform_task_conversation::Entity::find()
        .filter(platform_task_conversation::Column::ConversationId.eq(conversation_id))
        .one(conn)
        .await?;
    Ok(row.map(to_info))
}

pub async fn create(
    conn: &DatabaseConnection,
    task_id: i32,
    conversation_id: i32,
    role: &str,
    injected_docs_json: Option<String>,
) -> Result<TaskConversationInfo, DbError> {
    let now = Utc::now();
    let model = platform_task_conversation::ActiveModel {
        id: NotSet,
        task_id: Set(task_id),
        conversation_id: Set(conversation_id),
        conversation_role: Set(role.to_string()),
        summary: Set(None),
        injected_docs_json: Set(injected_docs_json),
        created_at: Set(now),
        updated_at: Set(now),
    };
    let result = model.insert(conn).await?;
    Ok(to_info(result))
}

pub async fn update_summary(
    conn: &DatabaseConnection,
    id: i32,
    summary: &str,
) -> Result<TaskConversationInfo, DbError> {
    let row = platform_task_conversation::Entity::find_by_id(id)
        .one(conn)
        .await?
        .ok_or_else(|| {
            DbError::Migration(format!("Task conversation not found: {id}"))
        })?;

    let mut active = row.into_active_model();
    active.summary = Set(Some(summary.to_string()));
    active.updated_at = Set(Utc::now());
    let result = active.update(conn).await?;
    Ok(to_info(result))
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    platform_task_conversation::Entity::delete_by_id(id)
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn delete_by_task_and_conversation(
    conn: &DatabaseConnection,
    task_id: i32,
    conversation_id: i32,
) -> Result<(), DbError> {
    platform_task_conversation::Entity::delete_many()
        .filter(platform_task_conversation::Column::TaskId.eq(task_id))
        .filter(platform_task_conversation::Column::ConversationId.eq(conversation_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// Delete all task-conversation links referencing a given conversation_id.
/// Called when a conversation is deleted to prevent orphaned links from
/// appearing in the task detail's "Associated conversations" section.
pub async fn delete_by_conversation(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Result<(), DbError> {
    platform_task_conversation::Entity::delete_many()
        .filter(platform_task_conversation::Column::ConversationId.eq(conversation_id))
        .exec(conn)
        .await?;
    Ok(())
}
