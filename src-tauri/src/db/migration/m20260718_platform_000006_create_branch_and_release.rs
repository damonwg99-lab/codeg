use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // platform_branch
        manager
            .create_table(
                Table::create()
                    .table(PlatformBranch::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformBranch::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformBranch::ProjectId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformBranch::RepoName)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformBranch::Branch)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformBranch::Status)
                            .text()
                            .not_null()
                            .default("open"),
                    )
                    .col(
                        ColumnDef::new(PlatformBranch::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformBranch::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_branch_project")
                            .from(PlatformBranch::Table, PlatformBranch::ProjectId)
                            .to(PlatformProject::Table, PlatformProject::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_branch_project")
                    .table(PlatformBranch::Table)
                    .col(PlatformBranch::ProjectId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_branch_project_repo")
                    .table(PlatformBranch::Table)
                    .col(PlatformBranch::ProjectId)
                    .col(PlatformBranch::RepoName)
                    .col(PlatformBranch::Branch)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // platform_task_branch
        manager
            .create_table(
                Table::create()
                    .table(PlatformTaskBranch::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformTaskBranch::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskBranch::TaskId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskBranch::BranchId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskBranch::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_task_branch_task")
                            .from(PlatformTaskBranch::Table, PlatformTaskBranch::TaskId)
                            .to(PlatformTask::Table, PlatformTask::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_task_branch_branch")
                            .from(
                                PlatformTaskBranch::Table,
                                PlatformTaskBranch::BranchId,
                            )
                            .to(PlatformBranch::Table, PlatformBranch::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_task_branch_task")
                    .table(PlatformTaskBranch::Table)
                    .col(PlatformTaskBranch::TaskId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_task_branch_branch")
                    .table(PlatformTaskBranch::Table)
                    .col(PlatformTaskBranch::BranchId)
                    .to_owned(),
            )
            .await?;

        // platform_release
        manager
            .create_table(
                Table::create()
                    .table(PlatformRelease::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformRelease::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::ProjectId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::ReleaseCode)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::Title)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::Notes)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::Status)
                            .text()
                            .not_null()
                            .default("draft"),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::Deployer)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::PrdDeployedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::ClosedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::CiJobId)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::CiWebhookUrl)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformRelease::DeletedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_release_project")
                            .from(PlatformRelease::Table, PlatformRelease::ProjectId)
                            .to(PlatformProject::Table, PlatformProject::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_release_project")
                    .table(PlatformRelease::Table)
                    .col(PlatformRelease::ProjectId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_release_project_code")
                    .table(PlatformRelease::Table)
                    .col(PlatformRelease::ProjectId)
                    .col(PlatformRelease::ReleaseCode)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // platform_release_item
        manager
            .create_table(
                Table::create()
                    .table(PlatformReleaseItem::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformReleaseItem::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformReleaseItem::ReleaseId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformReleaseItem::BranchId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformReleaseItem::TaskId)
                            .integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformReleaseItem::ExternalRefJson)
                            .text()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformReleaseItem::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_release_item_release")
                            .from(
                                PlatformReleaseItem::Table,
                                PlatformReleaseItem::ReleaseId,
                            )
                            .to(PlatformRelease::Table, PlatformRelease::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_release_item_branch")
                            .from(
                                PlatformReleaseItem::Table,
                                PlatformReleaseItem::BranchId,
                            )
                            .to(PlatformBranch::Table, PlatformBranch::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_release_item_release")
                    .table(PlatformReleaseItem::Table)
                    .col(PlatformReleaseItem::ReleaseId)
                    .to_owned(),
            )
            .await?;

        // 修改 platform_task — 新增 related_db_scripts_json 列
        manager
            .alter_table(
                Table::alter()
                    .table(PlatformTask::Table)
                    .add_column(
                        ColumnDef::new(PlatformTask::RelatedDbScriptsJson)
                            .text()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(PlatformReleaseItem::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformRelease::Table).to_owned())
            .await?;
        manager
            .drop_table(
                Table::drop()
                    .table(PlatformTaskBranch::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformBranch::Table).to_owned())
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(PlatformTask::Table)
                    .drop_column(PlatformTask::RelatedDbScriptsJson)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum PlatformBranch {
    Table,
    Id,
    ProjectId,
    RepoName,
    Branch,
    Status,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum PlatformTaskBranch {
    Table,
    Id,
    TaskId,
    BranchId,
    CreatedAt,
}

#[derive(DeriveIden)]
enum PlatformRelease {
    Table,
    Id,
    ProjectId,
    ReleaseCode,
    Title,
    Notes,
    Status,
    Deployer,
    PrdDeployedAt,
    ClosedAt,
    CiJobId,
    CiWebhookUrl,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(DeriveIden)]
enum PlatformReleaseItem {
    Table,
    Id,
    ReleaseId,
    BranchId,
    TaskId,
    ExternalRefJson,
    CreatedAt,
}

#[derive(DeriveIden)]
enum PlatformTask {
    Table,
    Id,
    RelatedDbScriptsJson,
}

#[derive(DeriveIden)]
enum PlatformProject {
    Table,
    Id,
}
