use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DbBackend, Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        // Step 1: Revive task attachments that were wrongly soft-deleted by the
        // KB scan sweep (their files still exist on disk, but the path
        // mismatch on Windows caused the sweep to mark them as deleted).
        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE platform_knowledge_doc \
             SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP \
             WHERE (doc_type = 'task_attachment' OR task_id IS NOT NULL) \
               AND deleted_at IS NOT NULL".to_string(),
        ))
        .await?;

        // Step 2: Remove duplicate rows whose backslash-path, once normalized,
        // would clash with an existing forward-slash row under the same project.
        // The bug created two rows for the same file: one with '/' (original)
        // and one with '\' (scanner duplicate). We keep the lower-id row (the
        // original, which has the correct task_id) and delete the higher-id
        // duplicate (scanner copy, task_id = NULL).
        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "DELETE FROM platform_knowledge_doc WHERE id IN (\
                SELECT b.id \
                FROM platform_knowledge_doc AS a \
                JOIN platform_knowledge_doc AS b \
                ON a.project_id = b.project_id \
                AND REPLACE(a.file_path, '\\', '/') = REPLACE(b.file_path, '\\', '/') \
                AND a.id < b.id\
             )".to_string(),
        ))
        .await?;

        // Step 3: Normalize file_path: replace backslashes with forward slashes
        // in all remaining rows. After dedup, no UNIQUE constraint conflict.
        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "UPDATE platform_knowledge_doc \
             SET file_path = REPLACE(file_path, '\\', '/'), \
                 updated_at = updated_at \
             WHERE file_path LIKE '%\\%'".to_string(),
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // No-op: the data fix is one-directional; reverting would re-introduce
        // the bug for existing rows.
        Ok(())
    }
}
