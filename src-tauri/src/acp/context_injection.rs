//! Builds the first-prompt context injection block that is prepended to the
//! agent's prompt on a new conversation. The injected content is wrapped in
//! `<!-- codeg:inject:start/end -->` markers so the frontend rendering layer
//! can hide it from the user while the agent's LLM still sees it.
//!
//! ## Injection content
//!
//! One **Knowledge Base Storage Rules** block for every project conversation
//! (the task association is no longer a gate — it only switches the variant):
//!
//! - **Task-linked conversations** — the task directory contract
//!   (`.private/tasks/{id}/`: `attachments/` read-only, `ai-intermediate/`
//!   receives ALL documents generated in the session).
//! - **Plain project conversations** — the default directory
//!   (`.private/ai-intermediate/`).
//!
//! Both variants point at `{kb_dir}/RULES.md` for the full rules instead of
//! inlining them: the agent reads the file on demand when it actually writes
//! documents, so conversations that never generate one carry only a ~60-token
//! contract.

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

/// Case-insensitive substring check for decomposition intent.
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
/// decomposition intent — instructs the agent to call the
/// `create_task_decomposition` tool, falling back to a
/// `task_decomposition_json` code fence.
pub const DECOMPOSITION_INSTRUCTION: &str = "[系统指令：仅当用户明确提出任务分解需求时，才调用 create_task_decomposition 工具传入子任务列表。如果用户没有提出该需求，不要仅因回复中出现了「分解」「拆分」等词就自行触发。如果无法调用该工具（如不在可用工具列表中），请在回复末尾的 ```task_decomposition_json 代码块中输出 JSON。格式为 {\"subTasks\":[{\"title\":\"任务标题（中文）\",\"description\":\"任务描述（中文）\",\"taskType\":\"bug|feature|task|improvement\",\"priority\":\"low|medium|high|urgent\"}]}。title 和 description 必须用中文填写。]";

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

/// Build the KB storage-rules block for a first prompt. Task-linked
/// conversations get the task-directory variant — every document generated in
/// the session belongs to the task, so there is no non-task fallback line.
/// Plain conversations get the default `.private/ai-intermediate/` variant.
/// Both point at RULES.md instead of inlining it (see module docs).
pub fn build_kb_storage_block(kb_dir: &str, task_id: Option<i32>) -> String {
    let task_part = match task_id {
        Some(id) => format!(
            "Task directory: {kb_dir}/.private/tasks/{id}/\n\
             \x20 \x20├── attachments/       # user attachments, read-only\n\
             \x20 \x20└── ai-intermediate/   # save ALL documents generated in this session here\n"
        ),
        None => format!(
            "Save generated documents to: {kb_dir}/.private/ai-intermediate/\n"
        ),
    };
    format!(
        "=== Knowledge Base Storage Rules ===\n\
         {task_part}\
         Before writing any document, read `{kb_dir}/RULES.md` and follow its full rules.\n\
         === End ==="
    )
}

/// Build the first-prompt injection block for a new conversation: the single
/// KB storage-rules block, in the task or plain variant depending on whether
/// the conversation is linked to a task. Returns `None` when the conversation
/// has no project context at all (non-platform / folderless sessions).
pub async fn build_first_prompt_injection(
    conn: &DatabaseConnection,
    conversation_id: Option<i32>,
    folder_id: i32,
) -> Option<PromptInputBlock> {
    // Resolve the conversation's task link once — it selects the block
    // variant and doubles as the project fallback when the folder itself has
    // no project (a task conversation may run without the project folder
    // open).
    let link = match conversation_id {
        Some(cid) => platform_task_conversation_service::get_by_conversation(conn, cid)
            .await
            .ok()
            .flatten(),
        None => None,
    };

    let project = match platform_project_service::get_by_folder_id(conn, folder_id).await {
        Ok(Some(project)) => Some(project),
        Ok(None) | Err(_) => match link.as_ref() {
            Some(link) => {
                let task = platform_task_service::get_by_id(conn, link.task_id)
                    .await
                    .ok()
                    .flatten()?;
                platform_project_service::get_by_id(conn, task.project_id)
                    .await
                    .ok()
                    .flatten()
            }
            None => None,
        },
    }?;

    let kb_dir = project
        .kb_local_dir
        .unwrap_or_else(|| format!("{}/_knowledge", project.root_dir));

    let text = format!(
        "{}\n{}\n{}",
        INJECTION_MARKER_START,
        build_kb_storage_block(&kb_dir, link.map(|l| l.task_id)),
        INJECTION_MARKER_END,
    );

    Some(PromptInputBlock::Text { text })
}

/// Build a compact re-injection preamble for long-running conversations.
/// Mirrors the first-prompt storage block's two variants: task-linked
/// conversations get the task directory, plain ones the default directory.
/// Both re-point at RULES.md so the full rules stay one read away.
pub fn build_reinjection_preamble(kb_dir: &str, task_id: Option<i32>) -> String {
    let dir_line = match task_id {
        Some(id) => format!(
            "- Save ALL documents generated in this session to: \
             `{kb_dir}/.private/tasks/{id}/ai-intermediate/`"
        ),
        None => format!(
            "- Save generated documents to: `{kb_dir}/.private/ai-intermediate/`"
        ),
    };

    format!(
        "{}\n=== KB Reminder ===\n\
         {dir_line}\n\
         - Full rules: `{kb_dir}/RULES.md`\n\
         === End Reminder ===\n{}",
        INJECTION_MARKER_START, INJECTION_MARKER_END,
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

/// Resolve the KB directory + optional task id for a re-injection. Task-linked
/// conversations resolve through the link (same chain as the task variant of
/// [`build_first_prompt_injection`]); plain project conversations fall back to
/// the folder's project. Returns `None` when there is no project context at
/// all — nothing to remind about.
async fn resolve_reinjection_context(
    conn: &DatabaseConnection,
    conversation_id: i32,
    folder_id: Option<i32>,
) -> Option<(String, Option<i32>)> {
    if let Some(link) =
        platform_task_conversation_service::get_by_conversation(conn, conversation_id)
            .await
            .ok()
            .flatten()
    {
        if let Some(task) = platform_task_service::get_by_id(conn, link.task_id).await.ok().flatten()
        {
            if let Some(project) =
                platform_project_service::get_by_id(conn, task.project_id).await.ok().flatten()
            {
                let kb_dir = project
                    .kb_local_dir
                    .unwrap_or_else(|| format!("{}/_knowledge", project.root_dir));
                return Some((kb_dir, Some(task.id)));
            }
        }
    }

    let project = platform_project_service::get_by_folder_id(conn, folder_id?)
        .await
        .ok()
        .flatten()?;
    let kb_dir = project
        .kb_local_dir
        .unwrap_or_else(|| format!("{}/_knowledge", project.root_dir));
    Some((kb_dir, None))
}

/// Build the wrapped re-injection preamble block for a conversation — the
/// task variant for task-linked conversations, the default-directory variant
/// for plain project conversations, or `None` when there is no project
/// context (nothing to remind about). Used by the manager on follow-up
/// prompts, gated by [`should_reinject`].
pub async fn build_reinjection_block(
    conn: &DatabaseConnection,
    conversation_id: i32,
    folder_id: Option<i32>,
) -> Option<PromptInputBlock> {
    let (kb_dir, task_id) = resolve_reinjection_context(conn, conversation_id, folder_id).await?;
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

/// The single per-prompt entry point used by the connection manager.
///
/// Decides and builds the context injection for ONE user prompt, from the
/// connection's identity and turn counter alone — the manager only feeds this
/// the pieces and advances its counter afterwards. The policy, in order:
///
/// - **First prompt on the connection** (`prompt_turn_count == 0`): the KB
///   storage-rules block for every project conversation (task-directory
///   variant when linked, default variant otherwise), plus the decomposition
///   instruction when the user's own message expresses decomposition intent.
///   Gating the decomposition block on the message (rather than injecting it
///   unconditionally on every turn) keeps the agent from being primed to
///   decompose of its own accord when it merely echoes "分解/拆分".
/// - **Follow-up prompts**: compact re-injection preamble when due per
///   [`should_reinject`] — the task-directory variant for task-linked
///   conversations, the default-directory variant for plain project
///   conversations — so long-running sessions keep their file-storage rules.
///   The decomposition rule is likewise refreshed against long-context
///   forgetting for ALL sessions.
/// - Otherwise the blocks pass through unchanged.
///
/// The conversation row's `message_count` is deliberately NOT used: it is
/// only ever set at creation (0) and stays 0 for a live session.
pub async fn inject_for_prompt(
    conn: &DatabaseConnection,
    conversation_id: Option<i32>,
    folder_id: Option<i32>,
    prompt_turn_count: usize,
    blocks: Vec<PromptInputBlock>,
) -> Vec<PromptInputBlock> {
    // Inject the decomposition instruction only when the user's own message
    // expresses decomposition intent (see doc comment above).
    let use_decomp_injection = has_decomposition_intent_in_blocks(&blocks);

    if prompt_turn_count == 0 {
        // First prompt on this connection — KB storage contract + optional
        // decomposition instruction. Only a project folder is required: the
        // task link is resolved inside (and merely switches the variant).
        let mut injected_blocks = Vec::new();
        if let Some(fid) = folder_id {
            if let Some(block) = build_first_prompt_injection(conn, conversation_id, fid).await {
                injected_blocks.push(block);
            }
        }
        if use_decomp_injection {
            injected_blocks.push(build_decomposition_instruction_block());
        }
        if injected_blocks.is_empty() {
            blocks
        } else {
            injected_blocks.extend(blocks);
            injected_blocks
        }
    } else if let Some(cid) = conversation_id {
        // Follow-up prompt — compact re-injection when due.
        if should_reinject(prompt_turn_count, 0, 0, re_injection_interval_from_env()) {
            let mut reinjected = Vec::with_capacity(blocks.len() + 2);
            if use_decomp_injection {
                reinjected.push(build_decomposition_instruction_block());
            }
            if let Some(block) = build_reinjection_block(conn, cid, folder_id).await {
                reinjected.push(block);
            }
            reinjected.extend(blocks);
            reinjected
        } else {
            blocks
        }
    } else {
        blocks
    }
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
    fn kb_storage_block_task_variant_mentions_task_dir() {
        let text = build_kb_storage_block("/repo/_knowledge", Some(42));
        assert!(text.contains("/repo/_knowledge/.private/tasks/42/"));
        assert!(text.contains("attachments/"));
        assert!(text.contains("ai-intermediate/"));
        assert!(text.contains("/repo/_knowledge/RULES.md"));
        // Task metadata (title/type/description) intentionally absent — it is
        // already in the user's own conversation; only the storage contract
        // is injected.
        assert!(!text.contains("Task Title"));
        assert!(!text.contains("Task Description"));
        assert!(!text.contains("Session Role"));
        // No non-task fallback: a linked session files everything under the
        // task directory.
        assert!(!text.contains("Non-task documents"));
    }

    #[test]
    fn kb_storage_block_plain_variant_mentions_default_dir() {
        let text = build_kb_storage_block("/repo/_knowledge", None);
        assert!(text.contains("/repo/_knowledge/.private/ai-intermediate/"));
        assert!(text.contains("/repo/_knowledge/RULES.md"));
        assert!(!text.contains("tasks/"));
    }

    #[test]
    fn reinjection_preamble_is_marker_wrapped_and_mentions_task_dir() {
        let text = build_reinjection_preamble("/repo/_knowledge", Some(42));
        assert!(text.starts_with(INJECTION_MARKER_START));
        assert!(text.contains(INJECTION_MARKER_END));
        assert!(is_injected_block(&text));
        assert!(text.contains("/repo/_knowledge/.private/tasks/42/ai-intermediate/"));
        assert!(text.contains("/repo/_knowledge/RULES.md"));
    }

    #[test]
    fn reinjection_preamble_plain_variant_mentions_default_dir() {
        let text = build_reinjection_preamble("/repo/_knowledge", None);
        assert!(is_injected_block(&text));
        assert!(text.contains("/repo/_knowledge/.private/ai-intermediate/"));
        assert!(text.contains("/repo/_knowledge/RULES.md"));
        assert!(!text.contains("tasks/"));
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
