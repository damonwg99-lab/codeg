use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_project")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub description: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub client_name: Option<String>,
    #[sea_orm(column_type = "Text", default_value = "planning")]
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub root_dir: String,
    pub folder_id: Option<i32>,
    pub zentao_project_id: Option<i32>,
    pub zentao_product_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub jenkins_url: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub kb_repo_url: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub kb_local_dir: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub default_agent_type: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub delegation_config: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub agent_config_json: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub deleted_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::platform_project_repo::Entity")]
    ProjectRepos,
    #[sea_orm(has_many = "super::platform_task::Entity")]
    Tasks,
    #[sea_orm(
        belongs_to = "super::folder::Entity",
        from = "Column::FolderId",
        to = "super::folder::Column::Id"
    )]
    Folder,
}

impl Related<super::platform_project_repo::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ProjectRepos.def()
    }
}

impl Related<super::platform_task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tasks.def()
    }
}

impl Related<super::folder::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Folder.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
