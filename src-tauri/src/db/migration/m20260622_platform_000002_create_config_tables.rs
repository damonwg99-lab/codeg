use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 1. platform_global_config table
        manager
            .create_table(
                Table::create()
                    .table(PlatformGlobalConfig::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformGlobalConfig::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PlatformGlobalConfig::ConfigType).text().not_null())
                    .col(ColumnDef::new(PlatformGlobalConfig::ConfigJson).text().not_null())
                    .col(
                        ColumnDef::new(PlatformGlobalConfig::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformGlobalConfig::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_global_config_type")
                    .table(PlatformGlobalConfig::Table)
                    .col(PlatformGlobalConfig::ConfigType)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // 2. platform_credential table
        manager
            .create_table(
                Table::create()
                    .table(PlatformCredential::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformCredential::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PlatformCredential::ProjectId).integer().null())
                    .col(ColumnDef::new(PlatformCredential::CredentialType).text().not_null())
                    .col(ColumnDef::new(PlatformCredential::CredentialKey).text().not_null())
                    .col(
                        ColumnDef::new(PlatformCredential::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformCredential::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_credential_type_project")
                    .table(PlatformCredential::Table)
                    .col(PlatformCredential::CredentialType)
                    .col(PlatformCredential::ProjectId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PlatformCredential::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformGlobalConfig::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum PlatformGlobalConfig {
    Table,
    Id,
    ConfigType,
    ConfigJson,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum PlatformCredential {
    Table,
    Id,
    ProjectId,
    CredentialType,
    CredentialKey,
    CreatedAt,
    UpdatedAt,
}
