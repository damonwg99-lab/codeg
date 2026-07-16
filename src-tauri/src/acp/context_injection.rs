//! Builds the first-prompt context injection block that is prepended to the
//! agent's prompt on a new task conversation. The injected content is wrapped
//! in `<!-- codeg:inject:start/end -->` markers so the frontend rendering
//! layer can hide it from the user while the agent's LLM still sees it.
//!
//! ## Injection content
//! 1. **Project KB Rules** — contents of `_knowledge/RULES.md` (real-time read)
//! 2. **Task Context** — task id, title, type, and directory structure (only
//!    when the conversation is linked to a task via `platform_task_conversation`)

use crate::acp::types::PromptInputBlock;
use crate::db::service::{
    platform_project_service, platform_task_conversation_service, platform_task_service,
};
use sea_orm::DatabaseConnection;

/// Wraps injected context so the frontend can detect and hide it.
pub const INJECTION_MARKER_START: &str = "<!-- codeg:inject:start -->";
pub const INJECTION_MARKER_END: &str = "<!-- codeg:inject:end -->";

/// Whether the given text block contains the injection marker (i.e. it is an
/// injected context block that should be hidden from the user).
pub fn is_injected_block(text: &str) -> bool {
    text.starts_with(INJECTION_MARKER_START)
}

/// Build the first-prompt injection block for a new conversation. Returns
/// `None` when there is nothing to inject (no RULES.md and no task link).
pub async fn build_first_prompt_injection(
    conn: &DatabaseConnection,
    conversation_id: i32,
    folder_id: i32,
) -> Option<PromptInputBlock> {
    let mut parts: Vec<String> = Vec::new();

    // 1. Project KB Rules (from RULES.md)
    if let Ok(Some(project)) = platform_project_service::get_by_folder_id(conn, folder_id).await {
        let kb_dir = project
            .kb_local_dir
            .unwrap_or_else(|| format!("{}/_knowledge", project.root_dir));
        let rules_path = std::path::Path::new(&kb_dir).join("RULES.md");
        if rules_path.is_file() {
            match std::fs::read_to_string(&rules_path) {
                Ok(content) => {
                    parts.push(format!(
                        "=== Project Knowledge Base Rules ===\n{}\n=== End of Rules ===",
                        content,
                    ));
                }
                Err(e) => {
                    tracing::warn!(
                        "[context_injection] failed to read RULES.md at {}: {e}",
                        rules_path.display()
                    );
                }
            }
        }
    }

    // 2. Task Context (only when linked to a task)
    if let Ok(Some(link)) =
        platform_task_conversation_service::get_by_conversation(conn, conversation_id).await
    {
        if let Ok(Some(task)) = platform_task_service::get_by_id(conn, link.task_id).await {
            if let Ok(Some(project)) =
                platform_project_service::get_by_id(conn, task.project_id).await
            {
                let kb_dir = project
                    .kb_local_dir
                    .unwrap_or_else(|| format!("{}/_knowledge", project.root_dir));
                parts.push(format!(
                    "=== Task Context ===\n\
                     Task ID: {}\n\
                     Task Title: {}\n\
                     Task Type: {}\n\
                     Task Directory: {}/.private/tasks/{}/\n\
                     \x20 \x20├── attachments/       # User attachments, do not modify\n\
                     \x20 \x20└── ai_intermediate/   # Your generated documents go here\n\
                     === End Task Context ===",
                    task.id, task.title, task.task_type, kb_dir, task.id,
                ));
            }
        }
    }

    if parts.is_empty() {
        return None;
    }

    let text = format!(
        "{}\n{}\n{}",
        INJECTION_MARKER_START,
        parts.join("\n\n"),
        INJECTION_MARKER_END,
    );

    Some(PromptInputBlock::Text { text })
}
