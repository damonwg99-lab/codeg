//! Decomposition feature (task-splitting MCP tool).
//!
//! * [`DecompositionConfig`] — the static config for the `decomposition` feature
//!   group (whether `create_task_decomposition` is exposed).
//! * [`DecompositionRuntimeConfig`] — the hot-swappable "is the feature on?" flag,
//!   read at MCP injection time alongside delegation / feedback / ask / sessions
//!   so `codeg-mcp` is injected when ANY feature is enabled, and the companion's
//!   `--features` lists `decomposition` to expose the tool.

use std::sync::Arc;
use tokio::sync::RwLock;

/// Static config for the decomposition feature group.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DecompositionConfig {
    pub enabled: bool,
}

/// Hot-swappable feature config read at MCP injection time. Kept tiny and
/// separate from the other feature configs so the `decomposition` tool group
/// toggles independently — `codeg-mcp` is injected when ANY feature is enabled,
/// and each tool is listed only when its own feature is on.
#[derive(Debug, Clone, Default)]
pub struct DecompositionRuntimeConfig {
    inner: Arc<RwLock<DecompositionConfig>>,
}

impl DecompositionRuntimeConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn snapshot(&self) -> DecompositionConfig {
        self.inner.read().await.clone()
    }

    pub async fn set(&self, cfg: DecompositionConfig) {
        *self.inner.write().await = cfg
    }

    /// Convenience read used at MCP injection time.
    pub async fn is_enabled(&self) -> bool {
        self.inner.read().await.enabled
    }
}

/// Error text for a malformed `create_task_decomposition` input (JSON-RPC
/// invalid-params, code -32602).
const DECOMPOSITION_INVALID_PARAMS: &str =
    "create_task_decomposition requires a non-empty subTasks array";

/// Validate the `create_task_decomposition` tool input and build the
/// confirmation text the companion returns as the tool result. The front-end
/// detects the tool_call block on the ACP stream and synthesises a
/// DecompositionCard directly — the companion itself only acknowledges.
///
/// Returns `Err` with the JSON-RPC error message when `subTasks` is missing
/// or not a non-empty array.
pub fn build_decomposition_confirmation(arguments: &serde_json::Value) -> Result<String, &'static str> {
    let sub_tasks = arguments.get("subTasks").ok_or(DECOMPOSITION_INVALID_PARAMS)?;
    let arr = match sub_tasks.as_array() {
        Some(arr) if !arr.is_empty() => arr,
        _ => return Err(DECOMPOSITION_INVALID_PARAMS),
    };
    let count = arr.len();
    Ok(format!(
        "Decomposition proposal received ({count} sub-tasks). \
         The user can review and confirm them in the CodeG interface."
    ))
}

#[cfg(test)]
mod tests {
    use super::build_decomposition_confirmation;
    use serde_json::json;

    #[test]
    fn confirmation_counts_sub_tasks() {
        let args = json!({ "subTasks": [{ "title": "a" }, { "title": "b" }] });
        let msg = build_decomposition_confirmation(&args).unwrap();
        assert!(msg.contains("2 sub-tasks"));
    }

    #[test]
    fn missing_or_empty_sub_tasks_are_invalid_params() {
        assert!(build_decomposition_confirmation(&json!({})).is_err());
        assert!(build_decomposition_confirmation(&json!({ "subTasks": [] })).is_err());
        assert!(build_decomposition_confirmation(&json!({ "subTasks": "x" })).is_err());
    }
}
