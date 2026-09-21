use sea_orm_migration::prelude::*;

/// Add project-level default and per-repo override environment branches:
/// `dev_branch` / `uat_branch` / `prd_branch` on both `platform_project` and
/// `platform_project_repo`. Effective branch per repo = repo value ?? project
/// value.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            TargetTable::Project,
            TargetTable::Repo,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(table)
                        .add_column(ColumnDef::new(EnvBranch::DevBranch).text().null())
                        .add_column(ColumnDef::new(EnvBranch::UatBranch).text().null())
                        .add_column(ColumnDef::new(EnvBranch::PrdBranch).text().null())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            TargetTable::Project,
            TargetTable::Repo,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(table)
                        .drop_column(EnvBranch::DevBranch)
                        .drop_column(EnvBranch::UatBranch)
                        .drop_column(EnvBranch::PrdBranch)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(DeriveIden)]
enum TargetTable {
    #[sea_orm(iden = "platform_project")]
    Project,
    #[sea_orm(iden = "platform_project_repo")]
    Repo,
}

#[derive(DeriveIden)]
#[allow(clippy::enum_variant_names)]
enum EnvBranch {
    DevBranch,
    UatBranch,
    PrdBranch,
}