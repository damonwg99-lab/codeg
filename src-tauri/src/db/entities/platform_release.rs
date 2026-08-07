use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_release")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub project_id: i32,
    #[sea_orm(column_type = "Text")]
    pub release_code: String,
    #[sea_orm(column_type = "Text")]
    pub title: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub notes: Option<String>,
    #[sea_orm(column_type = "Text", default_value = "draft")]
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub deployer: Option<String>,
    pub prd_deployed_at: Option<DateTimeUtc>,
    pub closed_at: Option<DateTimeUtc>,
    #[sea_orm(column_type = "Text")]
    pub ci_job_id: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub ci_webhook_url: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
    pub deleted_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::platform_project::Entity",
        from = "Column::ProjectId",
        to = "super::platform_project::Column::Id"
    )]
    Project,
}

impl Related<super::platform_project::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Project.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
