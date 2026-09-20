use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "platform_task")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub project_id: i32,
    pub parent_task_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub title: String,
    #[sea_orm(column_type = "Text")]
    pub description: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub task_type: String,
    #[sea_orm(column_type = "Text", default_value = "backlog")]
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub priority: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub assignee: Option<String>,
    // Zentao sync fields
    pub zentao_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub zentao_type: Option<String>,
    #[sea_orm(column_type = "Text", default_value = "none")]
    pub zentao_sync_status: Option<String>,
    // Zentao extension fields
    pub deadline: Option<DateTimeUtc>,
    pub estimated_hours: Option<f64>,
    pub consumed_hours: Option<f64>,
    #[sea_orm(column_type = "Text")]
    pub zentao_module: Option<String>,
    // Project/knowledge base associations
    #[sea_orm(column_type = "Text")]
    pub kb_refs_json: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub affected_repos_json: Option<String>,
    // Delegation config
    #[sea_orm(column_type = "Text")]
    pub delegation_config: Option<String>,
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
    #[sea_orm(
        belongs_to = "Entity",
        from = "Column::ParentTaskId",
        to = "Column::Id"
    )]
    ParentTask,
    #[sea_orm(has_many = "Entity")]
    SubTasks,
    #[sea_orm(has_many = "super::platform_task_conversation::Entity")]
    Conversations,
    #[sea_orm(has_many = "super::platform_task_decomposition::Entity")]
    Decompositions,
}

impl Related<super::platform_project::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Project.def()
    }
}

impl Related<Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ParentTask.def()
    }
}

impl Related<super::platform_task_conversation::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Conversations.def()
    }
}

impl Related<super::platform_task_decomposition::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Decompositions.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
