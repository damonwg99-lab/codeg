use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set,
};

use crate::db::entities::platform_credential;
use crate::db::error::DbError;
use crate::keyring_store;
use crate::models::CredentialInfo;

fn to_info(m: platform_credential::Model) -> CredentialInfo {
    CredentialInfo {
        id: m.id,
        project_id: m.project_id,
        credential_type: m.credential_type,
        credential_key: m.credential_key,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_by_type(
    conn: &DatabaseConnection,
    credential_type: &str,
) -> Result<Vec<CredentialInfo>, DbError> {
    let rows = platform_credential::Entity::find()
        .filter(platform_credential::Column::CredentialType.eq(credential_type))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(to_info).collect())
}

pub async fn get_by_type_and_project(
    conn: &DatabaseConnection,
    credential_type: &str,
    project_id: Option<i32>,
) -> Result<Option<CredentialInfo>, DbError> {
    let mut query = platform_credential::Entity::find()
        .filter(platform_credential::Column::CredentialType.eq(credential_type));
    if let Some(pid) = project_id {
        query = query.filter(platform_credential::Column::ProjectId.eq(pid));
    } else {
        query = query.filter(platform_credential::Column::ProjectId.is_null());
    }
    let row = query.one(conn).await?;
    Ok(row.map(to_info))
}

pub async fn create(
    conn: &DatabaseConnection,
    credential_type: &str,
    credential_key: &str,
    project_id: Option<i32>,
) -> Result<CredentialInfo, DbError> {
    let now = Utc::now();
    let model = platform_credential::ActiveModel {
        id: NotSet,
        project_id: Set(project_id),
        credential_type: Set(credential_type.to_string()),
        credential_key: Set(credential_key.to_string()),
        created_at: Set(now),
        updated_at: Set(now),
    };
    let result = model.insert(conn).await?;
    Ok(to_info(result))
}

pub async fn delete(conn: &DatabaseConnection, id: i32) -> Result<(), DbError> {
    // Also delete the token from keyring_store
    let row = platform_credential::Entity::find_by_id(id)
        .one(conn)
        .await?;
    if let Some(cred) = row {
        let _ = remove_token(&cred.credential_key);
    }
    platform_credential::Entity::delete_by_id(id)
        .exec(conn)
        .await?;
    Ok(())
}

// ─── keyring_store helpers ───

pub fn store_token(credential_key: &str, token: &str) -> Result<(), String> {
    keyring_store::set_token(credential_key, token)
}

pub fn retrieve_token(credential_key: &str) -> Option<String> {
    keyring_store::get_token(credential_key)
}

pub fn remove_token(credential_key: &str) -> Result<(), String> {
    keyring_store::delete_token(credential_key)
}
