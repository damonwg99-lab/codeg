use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_task_branch")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub task_id: i32,
    pub branch_id: i32,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::platform_task::Entity",
        from = "Column::TaskId",
        to = "super::platform_task::Column::Id"
    )]
    Task,
    #[sea_orm(
        belongs_to = "super::platform_branch::Entity",
        from = "Column::BranchId",
        to = "super::platform_branch::Column::Id"
    )]
    Branch,
}

impl Related<super::platform_task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Task.def()
    }
}

impl Related<super::platform_branch::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Branch.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
