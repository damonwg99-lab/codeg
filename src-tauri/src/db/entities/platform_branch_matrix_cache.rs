use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_branch_matrix_cache")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub repo_id: i32,
    #[sea_orm(column_type = "Text")]
    pub fingerprint: String,
    #[sea_orm(column_type = "Text")]
    pub matrix_json: String,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}