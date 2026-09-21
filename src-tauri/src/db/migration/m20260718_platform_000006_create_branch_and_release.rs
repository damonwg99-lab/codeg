use sea_orm_migration::prelude::*;

/// Historical migration, intentionally kept as a NO-OP.
///
/// The original version of this migration created `platform_branch`,
/// `platform_task_branch`, `platform_release`, `platform_release_item`, and
/// added the `platform_task.related_db_scripts_json` column. That feature was
/// removed, and those objects are now dropped by
/// `m20260920_platform_000007_drop_branch_and_release`.
///
/// This file must stay registered: SeaORM refuses to start when a migration
/// recorded in `seaql_migrations` has no matching file ("Migration file of
/// version ... is missing"). Because it is already applied on existing
/// databases, gutting it to a no-op leaves them untouched (000007 drops the
/// tables); fresh databases never create the removed objects.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
