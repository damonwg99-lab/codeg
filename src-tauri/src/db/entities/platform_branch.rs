use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_branch")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub project_id: i32,
    #[sea_orm(column_type = "Text")]
    pub repo_name: String,
    #[sea_orm(column_type = "Text")]
    pub branch: String,
    #[sea_orm(column_type = "Text", default_value = "open")]
    pub status: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::platform_project::Entity",
        from = "Column::ProjectId",
        to = "super::platform_project::Column::Id"
    )]
    Project,
    #[sea_orm(has_many = "super::platform_task_branch::Entity")]
    TaskBranches,
}

impl Related<super::platform_project::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Project.def()
    }
}

impl Related<super::platform_task_branch::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TaskBranches.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
