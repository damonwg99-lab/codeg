use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_credential")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub project_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub credential_type: String,
    #[sea_orm(column_type = "Text")]
    pub credential_key: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
