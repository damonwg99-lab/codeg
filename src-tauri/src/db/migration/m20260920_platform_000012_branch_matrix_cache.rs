use sea_orm_migration::prelude::*;

/// Per-repo cache of the git-derived branch matrix. Purely a performance cache:
/// a `fingerprint` of the repo's ref files decides whether the stored
/// `matrix_json` is still valid. Never a source of truth — git is.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Alias::new("platform_branch_matrix_cache"))
                    .if_not_exists()
                    .col(ColumnDef::new(Alias::new("repo_id")).integer().not_null().primary_key())
                    .col(ColumnDef::new(Alias::new("fingerprint")).text().not_null())
                    .col(ColumnDef::new(Alias::new("matrix_json")).text().not_null())
                    .col(ColumnDef::new(Alias::new("updated_at")).timestamp_with_time_zone().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_branch_matrix_cache_repo")
                            .from(Alias::new("platform_branch_matrix_cache"), Alias::new("repo_id"))
                            .to(Alias::new("platform_project_repo"), Alias::new("id"))
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Alias::new("platform_branch_matrix_cache")).to_owned())
            .await
    }
}