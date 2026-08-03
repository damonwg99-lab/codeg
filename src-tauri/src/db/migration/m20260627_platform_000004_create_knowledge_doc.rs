use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(PlatformKnowledgeDoc::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PlatformKnowledgeDoc::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PlatformKnowledgeDoc::ProjectId).integer().not_null())
                    .col(
                        ColumnDef::new(PlatformKnowledgeDoc::DocType)
                            .text()
                            .not_null()
                            .default("tech_doc"),
                    )
                    .col(ColumnDef::new(PlatformKnowledgeDoc::Title).text().not_null())
                    .col(ColumnDef::new(PlatformKnowledgeDoc::FilePath).text().not_null())
                    .col(
                        ColumnDef::new(PlatformKnowledgeDoc::IsShared)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(PlatformKnowledgeDoc::TagsJson).text().null())
                    .col(ColumnDef::new(PlatformKnowledgeDoc::Description).text().null())
                    .col(ColumnDef::new(PlatformKnowledgeDoc::SkillName).text().null())
                    .col(ColumnDef::new(PlatformKnowledgeDoc::TaskId).integer().null())
                    .col(
                        ColumnDef::new(PlatformKnowledgeDoc::LastScannedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(PlatformKnowledgeDoc::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformKnowledgeDoc::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PlatformKnowledgeDoc::DeletedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_knowledge_doc_project")
                            .from(PlatformKnowledgeDoc::Table, PlatformKnowledgeDoc::ProjectId)
                            .to(PlatformProject::Table, PlatformProject::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_knowledge_doc_project")
                    .table(PlatformKnowledgeDoc::Table)
                    .col(PlatformKnowledgeDoc::ProjectId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_knowledge_doc_skill")
                    .table(PlatformKnowledgeDoc::Table)
                    .col(PlatformKnowledgeDoc::SkillName)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_knowledge_doc_task")
                    .table(PlatformKnowledgeDoc::Table)
                    .col(PlatformKnowledgeDoc::TaskId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_knowledge_doc_project_path")
                    .table(PlatformKnowledgeDoc::Table)
                    .col(PlatformKnowledgeDoc::ProjectId)
                    .col(PlatformKnowledgeDoc::FilePath)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PlatformKnowledgeDoc::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum PlatformKnowledgeDoc {
    Table,
    Id,
    ProjectId,
    DocType,
    Title,
    FilePath,
    IsShared,
    TagsJson,
    Description,
    SkillName,
    TaskId,
    LastScannedAt,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}

#[derive(DeriveIden)]
enum PlatformProject {
    Table,
    Id,
}
