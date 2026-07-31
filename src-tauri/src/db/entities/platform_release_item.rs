use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_release_item")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub release_id: i32,
    pub branch_id: i32,
    pub task_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub external_ref_json: Option<String>,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::platform_release::Entity",
        from = "Column::ReleaseId",
        to = "super::platform_release::Column::Id"
    )]
    Release,
    #[sea_orm(
        belongs_to = "super::platform_branch::Entity",
        from = "Column::BranchId",
        to = "super::platform_branch::Column::Id"
    )]
    Branch,
}

impl Related<super::platform_release::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Release.def()
    }
}

impl Related<super::platform_branch::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Branch.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
