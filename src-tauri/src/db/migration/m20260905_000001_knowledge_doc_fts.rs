use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DbBackend, Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        // Create FTS5 virtual table for full-text search across knowledge docs.
        // unicode61 tokenizer supports unicode text out-of-the-box in SQLite.
        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "CREATE VIRTUAL TABLE IF NOT EXISTS platform_knowledge_doc_fts USING fts5(
                doc_id UNINDEXED,
                project_id UNINDEXED,
                title,
                tags,
                description,
                content,
                tokenize='unicode61'
            );".to_string(),
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();

        conn.execute(Statement::from_string(
            DbBackend::Sqlite,
            "DROP TABLE IF EXISTS platform_knowledge_doc_fts;".to_string(),
        ))
        .await?;

        Ok(())
    }
}
