use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 1. platform_project table
        manager
            .create_table(
                Table::create()
                    .table(PlatformProject::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformProject::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PlatformProject::Name).text().not_null())
                    .col(ColumnDef::new(PlatformProject::Description).text().null())
                    .col(ColumnDef::new(PlatformProject::ClientName).text().null())
                    .col(
                        ColumnDef::new(PlatformProject::Status)
                            .text()
                            .not_null()
                            .default("planning"),
                    )
                    .col(ColumnDef::new(PlatformProject::RootDir).text().not_null())
                    .col(ColumnDef::new(PlatformProject::FolderId).integer().null())
                    .col(ColumnDef::new(PlatformProject::ZentaoProjectId).integer().null())
                    .col(ColumnDef::new(PlatformProject::ZentaoProductId).integer().null())
                    .col(ColumnDef::new(PlatformProject::JenkinsUrl).text().null())
                    .col(ColumnDef::new(PlatformProject::KbRepoUrl).text().null())
                    .col(ColumnDef::new(PlatformProject::KbLocalDir).text().null())
                    .col(ColumnDef::new(PlatformProject::DefaultAgentType).text().null())
                    .col(ColumnDef::new(PlatformProject::DelegationConfig).text().null())
                    .col(ColumnDef::new(PlatformProject::AgentConfigJson).text().null())
                    .col(
                        ColumnDef::new(PlatformProject::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformProject::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformProject::DeletedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_platform_project_folder")
                            .from(PlatformProject::Table, PlatformProject::FolderId)
                            .to(Folder::Table, Folder::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_project_status")
                    .table(PlatformProject::Table)
                    .col(PlatformProject::Status)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_project_folder")
                    .table(PlatformProject::Table)
                    .col(PlatformProject::FolderId)
                    .to_owned(),
            )
            .await?;

        // 2. platform_project_repo table
        manager
            .create_table(
                Table::create()
                    .table(PlatformProjectRepo::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformProjectRepo::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformProjectRepo::ProjectId)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(PlatformProjectRepo::Name).text().not_null())
                    .col(ColumnDef::new(PlatformProjectRepo::GitUrl).text().not_null())
                    .col(ColumnDef::new(PlatformProjectRepo::LocalDir).text().not_null())
                    .col(ColumnDef::new(PlatformProjectRepo::Branch).text().null())
                    .col(
                        ColumnDef::new(PlatformProjectRepo::HasClaudeMd)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(PlatformProjectRepo::FolderId).integer().null())
                    .col(
                        ColumnDef::new(PlatformProjectRepo::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformProjectRepo::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_project_repo_project")
                            .from(PlatformProjectRepo::Table, PlatformProjectRepo::ProjectId)
                            .to(PlatformProject::Table, PlatformProject::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_project_repo_folder")
                            .from(PlatformProjectRepo::Table, PlatformProjectRepo::FolderId)
                            .to(Folder::Table, Folder::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_project_repo_project")
                    .table(PlatformProjectRepo::Table)
                    .col(PlatformProjectRepo::ProjectId)
                    .to_owned(),
            )
            .await?;

        // 3. platform_task table
        manager
            .create_table(
                Table::create()
                    .table(PlatformTask::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformTask::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PlatformTask::ProjectId).integer().not_null())
                    .col(ColumnDef::new(PlatformTask::ParentTaskId).integer().null())
                    .col(ColumnDef::new(PlatformTask::Title).text().not_null())
                    .col(ColumnDef::new(PlatformTask::Description).text().null())
                    .col(ColumnDef::new(PlatformTask::TaskType).text().not_null())
                    .col(
                        ColumnDef::new(PlatformTask::Status)
                            .text()
                            .not_null()
                            .default("backlog"),
                    )
                    .col(ColumnDef::new(PlatformTask::Priority).text().null())
                    .col(ColumnDef::new(PlatformTask::Assignee).text().null())
                    // Zentao sync fields
                    .col(ColumnDef::new(PlatformTask::ZentaoId).integer().null())
                    .col(ColumnDef::new(PlatformTask::ZentaoType).text().null())
                    .col(
                        ColumnDef::new(PlatformTask::ZentaoSyncStatus)
                            .text()
                            .default("none"),
                    )
                    // Zentao extension fields
                    .col(ColumnDef::new(PlatformTask::Deadline).timestamp_with_time_zone().null())
                    .col(ColumnDef::new(PlatformTask::EstimatedHours).double().null())
                    .col(ColumnDef::new(PlatformTask::ConsumedHours).double().null())
                    .col(ColumnDef::new(PlatformTask::ZentaoModule).text().null())
                    // Project/knowledge base associations
                    .col(ColumnDef::new(PlatformTask::KbRefsJson).text().null())
                    .col(ColumnDef::new(PlatformTask::AffectedReposJson).text().null())
                    // Delegation config
                    .col(ColumnDef::new(PlatformTask::DelegationConfig).text().null())
                    .col(
                        ColumnDef::new(PlatformTask::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTask::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTask::DeletedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_task_project")
                            .from(PlatformTask::Table, PlatformTask::ProjectId)
                            .to(PlatformProject::Table, PlatformProject::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_task_parent")
                            .from(PlatformTask::Table, PlatformTask::ParentTaskId)
                            .to(PlatformTask::Table, PlatformTask::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_task_project")
                    .table(PlatformTask::Table)
                    .col(PlatformTask::ProjectId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_task_status")
                    .table(PlatformTask::Table)
                    .col(PlatformTask::Status)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_task_parent")
                    .table(PlatformTask::Table)
                    .col(PlatformTask::ParentTaskId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_platform_task_zentao")
                    .table(PlatformTask::Table)
                    .col(PlatformTask::ZentaoId)
                    .to_owned(),
            )
            .await?;

        // 4. platform_task_type_mapping table
        manager
            .create_table(
                Table::create()
                    .table(PlatformTaskTypeMapping::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformTaskTypeMapping::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PlatformTaskTypeMapping::LocalType).text().not_null())
                    .col(ColumnDef::new(PlatformTaskTypeMapping::ZentaoType).text().not_null())
                    .col(ColumnDef::new(PlatformTaskTypeMapping::ZentaoModule).text().null())
                    .col(ColumnDef::new(PlatformTaskTypeMapping::ProjectId).integer().null())
                    .col(
                        ColumnDef::new(PlatformTaskTypeMapping::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskTypeMapping::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_task_type_mapping_project")
                    .table(PlatformTaskTypeMapping::Table)
                    .col(PlatformTaskTypeMapping::ProjectId)
                    .to_owned(),
            )
            .await?;

        // 5. platform_task_conversation table
        manager
            .create_table(
                Table::create()
                    .table(PlatformTaskConversation::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformTaskConversation::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskConversation::TaskId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskConversation::ConversationId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskConversation::ConversationRole)
                            .text()
                            .not_null()
                            .default("discussion"),
                    )
                    .col(ColumnDef::new(PlatformTaskConversation::Summary).text().null())
                    .col(ColumnDef::new(PlatformTaskConversation::InjectedDocsJson).text().null())
                    .col(
                        ColumnDef::new(PlatformTaskConversation::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskConversation::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_task_conv_task")
                            .from(PlatformTaskConversation::Table, PlatformTaskConversation::TaskId)
                            .to(PlatformTask::Table, PlatformTask::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_task_conv_conversation")
                            .from(
                                PlatformTaskConversation::Table,
                                PlatformTaskConversation::ConversationId,
                            )
                            .to(Conversation::Table, Conversation::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_task_conversation_unique")
                    .table(PlatformTaskConversation::Table)
                    .col(PlatformTaskConversation::TaskId)
                    .col(PlatformTaskConversation::ConversationId)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // 6. platform_task_decomposition table
        manager
            .create_table(
                Table::create()
                    .table(PlatformTaskDecomposition::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformTaskDecomposition::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskDecomposition::SourceTaskId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformTaskDecomposition::AiGenerated)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(PlatformTaskDecomposition::DecompositionJson).text().null())
                    .col(
                        ColumnDef::new(PlatformTaskDecomposition::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_decomposition_task")
                            .from(
                                PlatformTaskDecomposition::Table,
                                PlatformTaskDecomposition::SourceTaskId,
                            )
                            .to(PlatformTask::Table, PlatformTask::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PlatformTaskDecomposition::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformTaskConversation::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformTaskTypeMapping::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformTask::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformProjectRepo::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(PlatformProject::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum PlatformProject {
    Table,
    Id,
    Name,
    Description,
    ClientName,
    Status,
    RootDir,
    FolderId,
    ZentaoProjectId,
    ZentaoProductId,
    JenkinsUrl,
    KbRepoUrl,
    KbLocalDir,
    DefaultAgentType,
    DelegationConfig,
    AgentConfigJson,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(DeriveIden)]
enum PlatformProjectRepo {
    Table,
    Id,
    ProjectId,
    Name,
    GitUrl,
    LocalDir,
    Branch,
    HasClaudeMd,
    FolderId,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum PlatformTask {
    Table,
    Id,
    ProjectId,
    ParentTaskId,
    Title,
    Description,
    TaskType,
    Status,
    Priority,
    Assignee,
    ZentaoId,
    ZentaoType,
    ZentaoSyncStatus,
    Deadline,
    EstimatedHours,
    ConsumedHours,
    ZentaoModule,
    KbRefsJson,
    AffectedReposJson,
    DelegationConfig,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(DeriveIden)]
enum PlatformTaskTypeMapping {
    Table,
    Id,
    LocalType,
    ZentaoType,
    ZentaoModule,
    ProjectId,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum PlatformTaskConversation {
    Table,
    Id,
    TaskId,
    ConversationId,
    ConversationRole,
    Summary,
    InjectedDocsJson,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum PlatformTaskDecomposition {
    Table,
    Id,
    SourceTaskId,
    AiGenerated,
    DecompositionJson,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Folder {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum Conversation {
    Table,
    Id,
}
