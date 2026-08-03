use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // platform_activity_log table — Phase 2 will implement CRUD;
        // this migration only creates the table so the schema is ready.
        manager
            .create_table(
                Table::create()
                    .table(PlatformActivityLog::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformActivityLog::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PlatformActivityLog::ProjectId).integer().not_null())
                    .col(ColumnDef::new(PlatformActivityLog::TaskId).integer().null())
                    .col(ColumnDef::new(PlatformActivityLog::Action).text().not_null())
                    .col(ColumnDef::new(PlatformActivityLog::Actor).text().null())
                    .col(ColumnDef::new(PlatformActivityLog::DetailJson).text().null())
                    .col(
                        ColumnDef::new(PlatformActivityLog::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_activity_log_project")
                    .table(PlatformActivityLog::Table)
                    .col(PlatformActivityLog::ProjectId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_activity_log_task")
                    .table(PlatformActivityLog::Table)
                    .col(PlatformActivityLog::TaskId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_activity_log_action")
                    .table(PlatformActivityLog::Table)
                    .col(PlatformActivityLog::Action)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PlatformActivityLog::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum PlatformActivityLog {
    Table,
    Id,
    ProjectId,
    TaskId,
    Action,
    Actor,
    DetailJson,
    CreatedAt,
}
