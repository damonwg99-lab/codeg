use sea_orm_migration::prelude::*;

/// Reconcile `platform_branch_state`.
///
/// An earlier revision of `m20260920_platform_000010_create_branch_state`
/// created the table as `branch_state` (its `DeriveIden` enum was missing the
/// `platform_` prefix), so databases that already applied it lack the
/// `platform_branch_state` table the entity expects. This migration drops the
/// stray table and ensures the correctly-named one exists.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(Alias::new("branch_state"))
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(Alias::new("platform_branch_state"))
                    .if_not_exists()
                    .col(ColumnDef::new(Alias::new("id")).integer().not_null().auto_increment().primary_key())
                    .col(ColumnDef::new(Alias::new("repo_id")).integer().not_null())
                    .col(ColumnDef::new(Alias::new("branch")).text().not_null())
                    .col(ColumnDef::new(Alias::new("is_archived")).boolean().not_null().default(false))
                    .col(ColumnDef::new(Alias::new("archived_at")).timestamp_with_time_zone().null())
                    .col(ColumnDef::new(Alias::new("description")).text().null())
                    .col(ColumnDef::new(Alias::new("created_at")).timestamp_with_time_zone().not_null())
                    .col(ColumnDef::new(Alias::new("updated_at")).timestamp_with_time_zone().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_branch_state_repo")
                            .from(Alias::new("platform_branch_state"), Alias::new("repo_id"))
                            .to(Alias::new("platform_project_repo"), Alias::new("id"))
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_branch_state_repo_branch")
                    .table(Alias::new("platform_branch_state"))
                    .col(Alias::new("repo_id"))
                    .col(Alias::new("branch"))
                    .unique()
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}