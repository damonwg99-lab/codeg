use chrono::Utc;
use sea_orm::{ActiveModelTrait, ConnectionTrait, EntityTrait, Set};

use crate::db::entities::platform_branch_matrix_cache;
use crate::db::error::DbError;

pub async fn get<C: ConnectionTrait>(
    conn: &C,
    repo_id: i32,
) -> Result<Option<(String, String)>, DbError> {
    let row = platform_branch_matrix_cache::Entity::find_by_id(repo_id)
        .one(conn)
        .await?;
    Ok(row.map(|m| (m.fingerprint, m.matrix_json)))
}

pub async fn upsert<C: ConnectionTrait>(
    conn: &C,
    repo_id: i32,
    fingerprint: &str,
    matrix_json: &str,
) -> Result<(), DbError> {
    let active = platform_branch_matrix_cache::ActiveModel {
        repo_id: Set(repo_id),
        fingerprint: Set(fingerprint.to_string()),
        matrix_json: Set(matrix_json.to_string()),
        updated_at: Set(Utc::now()),
    };
    platform_branch_matrix_cache::Entity::insert(active)
        .on_conflict(
            sea_orm::sea_query::OnConflict::column(platform_branch_matrix_cache::Column::RepoId)
                .update_columns([
                    platform_branch_matrix_cache::Column::Fingerprint,
                    platform_branch_matrix_cache::Column::MatrixJson,
                    platform_branch_matrix_cache::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}