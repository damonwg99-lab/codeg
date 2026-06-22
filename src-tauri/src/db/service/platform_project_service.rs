use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder, Set, IntoActiveModel,
};

use crate::db::entities::platform_project;
use crate::db::error::DbError;
use crate::models::ProjectInfo;

fn to_info(m: platform_project::Model) -> ProjectInfo {
    ProjectInfo {
        id: m.id,
        name: m.name,
        description: m.description,
        client_name: m.client_name,
        status: m.status,
        root_dir: m.root_dir,
        folder_id: m.folder_id,
        zentao_project_id: m.zentao_project_id,
        zentao_product_id: m.zentao_product_id,
        jenkins_url: m.jenkins_url,
        kb_repo_url: m.kb_repo_url,
        kb_local_dir: m.kb_local_dir,
        default_agent_type: m.default_agent_type,
        delegation_config: m.delegation_config,
        agent_config_json: m.agent_config_json,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list(conn: &DatabaseConnection) -> Result<Vec<ProjectInfo>, DbError> {
    let rows = platform_project::Entity::find()
        .filter(platform_project::Column::DeletedAt.is_null())
        .order_by_desc(platform_project::Column::UpdatedAt)
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn get_by_id(
    conn: &DatabaseConnection,
    id: i32,
) -> Result<Option<ProjectInfo>, DbError> {
    let row = platform_project::Entity::find_by_id(id)
        .filter(platform_project::Column::DeletedAt.is_null())
        .one(conn)
        .await?;
    Ok(row.map(to_info))
}

pub async fn get_by_folder_id(
    conn: &DatabaseConnection,
    folder_id: i32,
) -> Result<Option<ProjectInfo>, DbError> {
    let row = platform_project::Entity::find()
        .filter(platform_project::Column::FolderId.eq(folder_id))
        .filter(platform_project::Column::DeletedAt.is_null())
        .one(conn)
        .await?;
    Ok(row.map(to_info))
}

pub async fn create(
    conn: &DatabaseConnection,
    name: &str,
    root_dir: &str,
    folder_id: Option<i32>,
    description: Option<String>,
    client_name: Option<String>,
    default_agent_type: Option<String>,
) -> Result<ProjectInfo, DbError> {
    let now = Utc::now();
    let model = platform_project::ActiveModel {
        id: NotSet,
        name: Set(name.to_string()),
        description: Set(description),
        client_name: Set(client_name),
        status: Set("planning".to_string()),
        root_dir: Set(root_dir.to_string()),
        folder_id: Set(folder_id),
        zentao_project_id: Set(None),
        zentao_product_id: Set(None),
        jenkins_url: Set(None),
        kb_repo_url: Set(None),
        kb_local_dir: Set(None),
        default_agent_type: Set(default_agent_type),
        delegation_config: Set(None),
        agent_config_json: Set(None),
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
    name: Option<String>,
    description: Option<String>,
    client_name: Option<String>,
    status: Option<String>,
    folder_id: Option<Option<i32>>,
    zentao_project_id: Option<Option<i32>>,
    zentao_product_id: Option<Option<i32>>,
    jenkins_url: Option<Option<String>>,
    kb_repo_url: Option<Option<String>>,
    kb_local_dir: Option<Option<String>>,
    default_agent_type: Option<Option<String>>,
    delegation_config: Option<Option<String>>,
    agent_config_json: Option<Option<String>>,
) -> Result<ProjectInfo, DbError> {
    let row = platform_project::Entity::find_by_id(id)
        .filter(platform_project::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Project not found: {id}")))?;

    let mut active = row.into_active_model();
    if let Some(v) = name {
        active.name = Set(v);
    }
    if let Some(v) = description {
        active.description = Set(Some(v));
    }
    if let Some(v) = client_name {
        active.client_name = Set(Some(v));
    }
    if let Some(v) = status {
        active.status = Set(v);
    }
    if let Some(v) = folder_id {
        active.folder_id = Set(v);
    }
    if let Some(v) = zentao_project_id {
        active.zentao_project_id = Set(v);
    }
    if let Some(v) = zentao_product_id {
        active.zentao_product_id = Set(v);
    }
    if let Some(v) = jenkins_url {
        active.jenkins_url = Set(v);
    }
    if let Some(v) = kb_repo_url {
        active.kb_repo_url = Set(v);
    }
    if let Some(v) = kb_local_dir {
        active.kb_local_dir = Set(v);
    }
    if let Some(v) = default_agent_type {
        active.default_agent_type = Set(v);
    }
    if let Some(v) = delegation_config {
        active.delegation_config = Set(v);
    }
    if let Some(v) = agent_config_json {
        active.agent_config_json = Set(v);
    }
    active.updated_at = Set(Utc::now());
    let result = active.update(conn).await?;
    Ok(to_info(result))
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    let row = platform_project::Entity::find_by_id(id)
        .filter(platform_project::Column::DeletedAt.is_null())
        .one(conn)
        .await?
        .ok_or_else(|| DbError::Migration(format!("Project not found: {id}")))?;

    let mut active = row.into_active_model();
    active.deleted_at = Set(Some(Utc::now()));
    active.updated_at = Set(Utc::now());
    active.update(conn).await?;
    Ok(())
}

pub async fn list_by_status(
    conn: &DatabaseConnection,
    status: &str,
) -> Result<Vec<ProjectInfo>, DbError> {
    let rows = platform_project::Entity::find()
        .filter(platform_project::Column::DeletedAt.is_null())
        .filter(platform_project::Column::Status.eq(status))
        .order_by_desc(platform_project::Column::UpdatedAt)
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}
