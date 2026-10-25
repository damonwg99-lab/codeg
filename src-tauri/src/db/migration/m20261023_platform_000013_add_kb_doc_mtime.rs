use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DbBackend, Statement};

#[derive(DeriveMigrationName)]
#[allow(dead_code)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        // Add file_mtime and file_size columns to platform_knowledge_doc
        // for incremental scanning and change detection.
        let _ = conn
            .execute(Statement::from_string(
                DbBackend::Sqlite,
                "ALTER TABLE platform_knowledge_doc ADD COLUMN file_mtime BIGINT DEFAULT NULL;".to_string(),
            ))
            .await;

        let _ = conn
            .execute(Statement::from_string(
                DbBackend::Sqlite,
                "ALTER TABLE platform_knowledge_doc ADD COLUMN file_size BIGINT DEFAULT NULL;".to_string(),
            ))
            .await;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
