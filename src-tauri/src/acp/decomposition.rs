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
