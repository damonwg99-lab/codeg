use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_task_decomposition")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub source_task_id: i32,
    #[sea_orm(default_value = false)]
    pub ai_generated: bool,
    #[sea_orm(column_type = "Text")]
    pub decomposition_json: Option<String>,
    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::platform_task::Entity",
        from = "Column::SourceTaskId",
        to = "super::platform_task::Column::Id"
    )]
    SourceTask,
}

impl Related<super::platform_task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::SourceTask.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
