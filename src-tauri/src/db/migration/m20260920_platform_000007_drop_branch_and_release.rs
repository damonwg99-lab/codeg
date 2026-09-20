use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop in reverse dependency order. `IF EXISTS` keeps this idempotent for
        // databases that never created these tables (fresh installs skip the old
        // create migration, which was removed alongside this one).
        manager
            .drop_table(
                Table::drop()
                    .table(Alias::new("platform_release_item"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(Alias::new("platform_release"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(Alias::new("platform_task_branch"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(Alias::new("platform_branch"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        // SQLite has no `DROP COLUMN IF EXISTS`: ignore the error when the column
        // is absent (fresh installs never added it).
        let _ = manager
            .get_connection()
            .execute_unprepared("ALTER TABLE platform_task DROP COLUMN related_db_scripts_json")
            .await;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Destructive drop; the original schema is not restorable here.
        Ok(())
    }
}
