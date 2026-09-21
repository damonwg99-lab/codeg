use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_branch_state")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub repo_id: i32,
    #[sea_orm(column_type = "Text")]
    pub branch: String,
    pub is_archived: bool,
    pub archived_at: Option<DateTimeUtc>,
    #[sea_orm(column_type = "Text")]
    pub description: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::platform_project_repo::Entity",
        from = "Column::RepoId",
        to = "super::platform_project_repo::Column::Id"
    )]
    Repo,
}

impl Related<super::platform_project_repo::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Repo.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}