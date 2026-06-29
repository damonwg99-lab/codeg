use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, QueryFilter, QueryOrder, Set,
};

use crate::db::entities::platform_knowledge_doc;
use crate::db::error::DbError;
use crate::models::{
    CreateKnowledgeDocDraft, KnowledgeDocInfo, UpdateKnowledgeDocDraft, UpsertKnowledgeDocDraft,
};

fn to_info(m: platform_knowledge_doc::Model) -> KnowledgeDocInfo {
    KnowledgeDocInfo {
        id: m.id,
        project_id: m.project_id,
        doc_type: m.doc_type,
        title: m.title,
        file_path: m.file_path,
        is_shared: m.is_shared,
        tags_json: m.tags_json,
        description: m.description,
        skill_name: m.skill_name,
        task_id: m.task_id,
        last_scanned_at: m.last_scanned_at,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn create(
    conn: &DatabaseConnection,
    draft: CreateKnowledgeDocDraft,
) -> Result<KnowledgeDocInfo, DbError> {
    let now = Utc::now();
    let model = platform_knowledge_doc::ActiveModel {
        id: NotSet,
        project_id: Set(draft.project_id),
        doc_type: Set(draft.doc_type),
        title: Set(draft.title),
        file_path: Set(draft.file_path),
        is_shared: Set(draft.is_shared),
        tags_json: Set(draft.tags_json),
        description: Set(draft.description),
        skill_name: Set(draft.skill_name),
        task_id: Set(draft.task_id),
        last_scanned_at: Set(None),
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
    draft: UpdateKnowledgeDocDraft,
) -> Result<KnowledgeDocInfo, DbError> {
    let row = platform_knowledge_doc::Entity::find_by_id(id)
        .filter(platform_knowledge_doc::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("Knowledge doc not found: {id}")))?;

    let mut active = row.into_active_model();
    if let Some(v) = draft.doc_type {
        active.doc_type = Set(v);
    }
    if let Some(v) = draft.title {
        active.title = Set(v);
    }
    if let Some(v) = draft.is_shared {
        active.is_shared = Set(v);
    }
    if let Some(v) = draft.tags_json {
        active.tags_json = Set(v);
    }
    if let Some(v) = draft.description {
        active.description = Set(v);
    }
    if let Some(v) = draft.skill_name {
        active.skill_name = Set(v);
    }
    if let Some(v) = draft.task_id {
        active.task_id = Set(v);
    }
    active.updated_at = Set(Utc::now());
    let result = active.update(conn).await?;
    Ok(to_info(result))
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    let row = platform_knowledge_doc::Entity::find_by_id(id)
        .filter(platform_knowledge_doc::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::NotFound(format!("Knowledge doc not found: {id}")))?;

    let mut active = row.into_active_model();
    active.deleted_at = Set(Some(Utc::now()));
    active.updated_at = Set(Utc::now());
    active.update(conn).await?;
    Ok(())
}

pub async fn list_by_project(
    conn: &DatabaseConnection,
    project_id: i32,
) -> Result<Vec<KnowledgeDocInfo>, DbError> {
    let rows = platform_knowledge_doc::Entity::find()
        .filter(platform_knowledge_doc::Column::ProjectId.eq(project_id))
        .filter(platform_knowledge_doc::Column::DeletedAt.is_null())
        .order_by_desc(platform_knowledge_doc::Column::UpdatedAt)
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn search(
    conn: &DatabaseConnection,
    project_id: i32,
    keyword: &str,
) -> Result<Vec<KnowledgeDocInfo>, DbError> {
    let pattern = format!("%{keyword}%");
    let rows = platform_knowledge_doc::Entity::find()
        .filter(platform_knowledge_doc::Column::ProjectId.eq(project_id))
        .filter(platform_knowledge_doc::Column::DeletedAt.is_null())
        .filter(
            sea_orm::Condition::any()
                .add(platform_knowledge_doc::Column::Title.like(&pattern))
                .add(platform_knowledge_doc::Column::Description.like(&pattern))
                .add(platform_knowledge_doc::Column::TagsJson.like(&pattern)),
        )
        .order_by_desc(platform_knowledge_doc::Column::UpdatedAt)
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn find_by_skill_name(
    conn: &DatabaseConnection,
    project_id: i32,
    skill_name: &str,
) -> Result<Vec<KnowledgeDocInfo>, DbError> {
    let rows = platform_knowledge_doc::Entity::find()
        .filter(platform_knowledge_doc::Column::ProjectId.eq(project_id))
        .filter(platform_knowledge_doc::Column::DeletedAt.is_null())
        .filter(platform_knowledge_doc::Column::SkillName.eq(skill_name))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn find_by_task_id(
    conn: &DatabaseConnection,
    task_id: i32,
) -> Result<Vec<KnowledgeDocInfo>, DbError> {
    let rows = platform_knowledge_doc::Entity::find()
        .filter(platform_knowledge_doc::Column::TaskId.eq(task_id))
        .filter(platform_knowledge_doc::Column::DeletedAt.is_null())
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn upsert_by_path(
    conn: &DatabaseConnection,
    draft: UpsertKnowledgeDocDraft,
) -> Result<KnowledgeDocInfo, DbError> {
    let existing = platform_knowledge_doc::Entity::find()
        .filter(platform_knowledge_doc::Column::ProjectId.eq(draft.project_id))
        .filter(platform_knowledge_doc::Column::FilePath.eq(&draft.file_path))
        .filter(platform_knowledge_doc::Column::DeletedAt.is_null())
        .one(conn)
        .await?;

    if let Some(row) = existing {
        let mut active = row.into_active_model();
        active.doc_type = Set(draft.doc_type);
        active.title = Set(draft.title);
        active.is_shared = Set(draft.is_shared);
        active.tags_json = Set(draft.tags_json);
        active.description = Set(draft.description);
        active.skill_name = Set(draft.skill_name);
        active.task_id = Set(draft.task_id);
        active.last_scanned_at = Set(Some(Utc::now()));
        active.updated_at = Set(Utc::now());
        let result = active.update(conn).await?;
        Ok(to_info(result))
    } else {
        let now = Utc::now();
        let model = platform_knowledge_doc::ActiveModel {
            id: NotSet,
            project_id: Set(draft.project_id),
            doc_type: Set(draft.doc_type),
            title: Set(draft.title),
            file_path: Set(draft.file_path),
            is_shared: Set(draft.is_shared),
            tags_json: Set(draft.tags_json),
            description: Set(draft.description),
            skill_name: Set(draft.skill_name),
            task_id: Set(draft.task_id),
            last_scanned_at: Set(Some(now)),
            created_at: Set(now),
            updated_at: Set(now),
            deleted_at: Set(None),
        };
        let result = model.insert(conn).await?;
        Ok(to_info(result))
    }
}
