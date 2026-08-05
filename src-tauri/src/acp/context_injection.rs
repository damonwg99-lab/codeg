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

/// Keywords (Chinese + English) that signal the user wants task decomposition.
/// Mirrors `DECOMPOSITION_KEYWORDS` in
/// `src/lib/platform/decomposition-parser.ts`.
const DECOMPOSITION_KEYWORDS: &[&str] = &[
    "分解",
    "拆分",
    "子任务",
    "细化",
    "拆解",
    "分析并提出任务",
    "decompose",
    "break down",
    "sub-tasks",
    "subtasks",
    "split into tasks",
    "task breakdown",
    "propose tasks",
    "create tasks from",
];

/// Case-insensitive substring check for decomposition intent. Mirrors
/// `hasDecompositionIntent` in `decomposition-parser.ts`.
pub fn has_decomposition_intent(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    let lower = text.to_lowercase();
    DECOMPOSITION_KEYWORDS
        .iter()
        .any(|kw| lower.contains(&kw.to_lowercase()))
}

/// Join the `Text` blocks of a prompt into a single string for intent
/// detection (space-separated, untruncated).
pub fn has_decomposition_intent_in_blocks(blocks: &[PromptInputBlock]) -> bool {
    let joined = blocks
        .iter()
        .filter_map(|b| match b {
            PromptInputBlock::Text { text } => {
                let t = text.trim();
                (!t.is_empty()).then_some(t)
            }
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ");
    has_decomposition_intent(&joined)
}

/// The decomposition instruction appended to the prompt when the user expresses
/// decomposition intent. Mirrors `DECOMPOSITION_INSTRUCTION` in
/// `decomposition-parser.ts` — instructs the agent to call the
/// `create_task_decomposition` tool, falling back to a
/// `task_decomposition_json` code fence.
pub const DECOMPOSITION_INSTRUCTION: &str = "[系统指令：当提出任务分解时，请优先调用 create_task_decomposition 工具传入子任务列表。如果无法调用该工具（如不在可用工具列表中），请在回复末尾的 ```task_decomposition_json 代码块中输出 JSON。格式为 {\"subTasks\":[{\"title\":\"任务标题（中文）\",\"description\":\"任务描述（中文）\",\"taskType\":\"bug|feature|task|improvement\",\"priority\":\"low|medium|high|urgent\"}]}。title 和 description 必须用中文填写。]";

/// Build a marker-wrapped decomposition instruction block. Because it is
/// wrapped in the `codeg:inject` markers, the frontend hides it from the user
/// automatically (same path as KB rules / task context).
pub fn build_decomposition_instruction_block() -> PromptInputBlock {
    PromptInputBlock::Text {
        text: format!(
            "{}\n{}\n{}",
            INJECTION_MARKER_START,
            DECOMPOSITION_INSTRUCTION,
            INJECTION_MARKER_END,
        ),
    }
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
                     \x20 \x20└── ai-intermediate/   # Your generated documents go here\n\
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

/// Build a compact re-injection preamble for long-running conversations.
/// Only contains the critical file-storage and branch-tracking rules to
/// prevent exceeding token budgets.
pub fn build_reinjection_preamble(kb_dir: &str, task_id: i32) -> String {
    let task_dir = format!("{kb_dir}/.private/tasks/{task_id}/ai-intermediate/");
    let branch_log = format!("{kb_dir}/.private/tasks/{task_id}/.branch-log.md");

    format!(
        "{}\n=== Task Reminder ===\n\
         Task ID: {task_id}\n\
         - Save generated documents to: `{task_dir}`\n\
         - Record new git branches in: `{branch_log}`\n\
         Format per branch: `- {{repo_name}}: {{branch_name}}`\n\
         === End Reminder ===\n{}",
        INJECTION_MARKER_START,
        INJECTION_MARKER_END,
    )
}

/// Whether the current session should receive a re-injection.
///
/// Triggers when:
/// - `message_count` reaches a multiple of `re_injection_interval`
/// - OR `current_tokens` exceeds 50% of `max_tokens`
pub fn should_reinject(
    message_count: usize,
    current_tokens: usize,
    max_tokens: usize,
    re_injection_interval: usize,
) -> bool {
    if message_count == 0 {
        return false;
    }
    message_count.is_multiple_of(re_injection_interval)
        || (current_tokens as f64 / max_tokens as f64) > 0.5
}

/// Resolve the KB directory + task id for a conversation linked to a task
/// (same resolution as the Task Context section of
/// [`build_first_prompt_injection`]). Returns `None` when the conversation is
/// not linked to a task.
async fn resolve_task_context(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Option<(String, i32)> {
    let link = platform_task_conversation_service::get_by_conversation(conn, conversation_id)
        .await
        .ok()??;
    let task = platform_task_service::get_by_id(conn, link.task_id).await.ok()??;
    let project = platform_project_service::get_by_id(conn, task.project_id)
        .await
        .ok()??;
    let kb_dir = project
        .kb_local_dir
        .unwrap_or_else(|| format!("{}/_knowledge", project.root_dir));
    Some((kb_dir, task.id))
}

/// Build the wrapped re-injection preamble block for a task-linked
/// conversation, or `None` when the conversation is not linked to a task (in
/// which case there is nothing to re-inject). Used by the manager on
/// follow-up prompts, gated by [`should_reinject`].
pub async fn build_reinjection_block(
    conn: &DatabaseConnection,
    conversation_id: i32,
) -> Option<PromptInputBlock> {
    let (kb_dir, task_id) = resolve_task_context(conn, conversation_id).await?;
    Some(PromptInputBlock::Text {
        text: build_reinjection_preamble(&kb_dir, task_id),
    })
}

/// Default interval (in user turns) between re-injections of the compact task
/// reminder for long-running sessions.
pub const DEFAULT_RE_INJECTION_INTERVAL: usize = 5;
/// Environment variable that overrides [`DEFAULT_RE_INJECTION_INTERVAL`].
pub const RE_INJECTION_INTERVAL_ENV: &str = "CODEG_REINJECTION_INTERVAL";

/// Read the re-injection interval from `CODEG_REINJECTION_INTERVAL`, falling
/// back to [`DEFAULT_RE_INJECTION_INTERVAL`] when unset or unparsable (and
/// never returning 0, which would re-inject on every turn).
pub fn re_injection_interval_from_env() -> usize {
    std::env::var(RE_INJECTION_INTERVAL_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_RE_INJECTION_INTERVAL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_decomposition_intent_matches_zh_and_en_keywords() {
        assert!(has_decomposition_intent("请帮我分解这个任务"));
        assert!(has_decomposition_intent("拆分下面的需求"));
        assert!(has_decomposition_intent("please decompose this"));
        assert!(has_decomposition_intent("Break Down into sub-tasks"));
        assert!(!has_decomposition_intent("帮我写一个函数"));
        assert!(!has_decomposition_intent(""));
    }

    #[test]
    fn decomposition_instruction_block_is_marker_wrapped() {
        let block = build_decomposition_instruction_block();
        let PromptInputBlock::Text { text } = block else {
            panic!("expected text block");
        };
        assert!(text.starts_with(INJECTION_MARKER_START));
        assert!(text.contains(INJECTION_MARKER_END));
        assert!(is_injected_block(&text));
        assert!(text.contains("create_task_decomposition"));
        assert!(text.contains("task_decomposition_json"));
    }

    #[test]
    fn reinjection_preamble_is_marker_wrapped_and_mentions_task_dir() {
        let text = build_reinjection_preamble("/repo/_knowledge", 42);
        assert!(text.starts_with(INJECTION_MARKER_START));
        assert!(text.contains(INJECTION_MARKER_END));
        assert!(is_injected_block(&text));
        assert!(text.contains("/repo/_knowledge/.private/tasks/42/ai-intermediate/"));
        assert!(text.contains(".branch-log.md"));
        assert!(text.contains("Task ID: 42"));
    }

    #[test]
    fn should_reinject_triggers_on_first_interval() {
        assert!(!should_reinject(0, 0, 0, 5));
        assert!(!should_reinject(1, 0, 0, 5));
        assert!(should_reinject(5, 0, 0, 5));
        assert!(should_reinject(10, 0, 0, 5));
        assert!(!should_reinject(6, 0, 0, 5));
    }

    #[test]
    fn should_reinject_triggers_on_token_threshold() {
        // 0/0 → NaN → false; a real half-consumed budget → true.
        assert!(!should_reinject(1, 0, 0, 100));
        assert!(should_reinject(1, 60, 100, 100));
    }

    #[test]
    fn reinjection_interval_env_defaults_to_five() {
        let prev = std::env::var(RE_INJECTION_INTERVAL_ENV).ok();
        std::env::remove_var(RE_INJECTION_INTERVAL_ENV);
        assert_eq!(re_injection_interval_from_env(), 5);
        std::env::set_var(RE_INJECTION_INTERVAL_ENV, "3");
        assert_eq!(re_injection_interval_from_env(), 3);
        // Unparsable / zero must not crash nor re-inject every turn.
        std::env::set_var(RE_INJECTION_INTERVAL_ENV, "abc");
        assert_eq!(re_injection_interval_from_env(), 5);
        std::env::set_var(RE_INJECTION_INTERVAL_ENV, "0");
        assert_eq!(re_injection_interval_from_env(), 5);
        match prev {
            Some(v) => std::env::set_var(RE_INJECTION_INTERVAL_ENV, v),
            None => std::env::remove_var(RE_INJECTION_INTERVAL_ENV),
        }
    }
}
