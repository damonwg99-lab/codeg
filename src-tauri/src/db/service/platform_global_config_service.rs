use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, DatabaseConnection, EntityTrait,
    QueryFilter, Set, IntoActiveModel,
};

use crate::db::entities::platform_global_config;
use crate::db::error::DbError;
use crate::models::GlobalConfigInfo;

fn to_info(m: platform_global_config::Model) -> GlobalConfigInfo {
    GlobalConfigInfo {
        id: m.id,
        config_type: m.config_type,
        config_json: m.config_json,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn get_by_type(
    conn: &DatabaseConnection,
    config_type: &str,
) -> Result<Option<GlobalConfigInfo>, DbError> {
    let row = platform_global_config::Entity::find()
        .filter(platform_global_config::Column::ConfigType.eq(config_type))
        .one(conn)
        .await?;
    Ok(row.map(to_info))
}

/// Upsert: if a row with the given `config_type` already exists, update it;
/// otherwise insert a new row.
pub async fn set(
    conn: &DatabaseConnection,
    config_type: &str,
    config_json: &str,
) -> Result<GlobalConfigInfo, DbError> {
    let existing = platform_global_config::Entity::find()
        .filter(platform_global_config::Column::ConfigType.eq(config_type))
        .one(conn)
        .await?;

    if let Some(row) = existing {
        let mut active = row.into_active_model();
        active.config_json = Set(config_json.to_string());
        active.updated_at = Set(Utc::now());
        let result = active.update(conn).await?;
        Ok(to_info(result))
    } else {
        let now = Utc::now();
        let model = platform_global_config::ActiveModel {
            id: NotSet,
            config_type: Set(config_type.to_string()),
            config_json: Set(config_json.to_string()),
            created_at: Set(now),
            updated_at: Set(now),
        };
        let result = model.insert(conn).await?;
        Ok(to_info(result))
    }
}
