use sea_orm_migration::prelude::*;

/// Per-branch human state: archive/hide flag + note. Keyed by `repo_id`.
/// Merge status itself is derived from git on the fly; this table only stores
/// intent git cannot express (D11/D12).
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(BranchState::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(BranchState::Id).integer().not_null().auto_increment().primary_key())
                    .col(ColumnDef::new(BranchState::RepoId).integer().not_null())
                    .col(ColumnDef::new(BranchState::Branch).text().not_null())
                    .col(ColumnDef::new(BranchState::IsArchived).boolean().not_null().default(false))
                    .col(ColumnDef::new(BranchState::ArchivedAt).timestamp_with_time_zone().null())
                    .col(ColumnDef::new(BranchState::Description).text().null())
                    .col(ColumnDef::new(BranchState::CreatedAt).timestamp_with_time_zone().not_null())
                    .col(ColumnDef::new(BranchState::UpdatedAt).timestamp_with_time_zone().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_branch_state_repo")
                            .from(BranchState::Table, BranchState::RepoId)
                            .to(Repo::Table, Repo::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_branch_state_repo_branch")
                    .table(BranchState::Table)
                    .col(BranchState::RepoId)
                    .col(BranchState::Branch)
                    .unique()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(BranchState::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum BranchState {
    Table,
    Id,
    RepoId,
    Branch,
    IsArchived,
    ArchivedAt,
    Description,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Repo {
    #[sea_orm(iden = "platform_project_repo")]
    Table,
    Id,
}