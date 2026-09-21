use sea_orm_migration::prelude::*;

/// Add project-level default and per-repo override environment branches:
/// `dev_branch` / `uat_branch` / `prd_branch` on both `platform_project` and
/// `platform_project_repo`. Effective branch per repo = repo value ?? project
/// value.
///
/// SQLite cannot apply multiple ALTER options in one statement, so each column
/// is added with its own `ALTER TABLE`.
#[derive(DeriveMigrationName)]
pub struct Migration;

const TABLES: [&str; 2] = ["platform_project", "platform_project_repo"];
const COLUMNS: [&str; 3] = ["dev_branch", "uat_branch", "prd_branch"];

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES {
            for column in COLUMNS {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .add_column(ColumnDef::new(Alias::new(column)).text().null())
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in TABLES {
            for column in COLUMNS {
                manager
                    .alter_table(
                        Table::alter()
                            .table(Alias::new(table))
                            .drop_column(Alias::new(column))
                            .to_owned(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}