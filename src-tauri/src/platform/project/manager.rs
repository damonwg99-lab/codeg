use std::sync::Arc;

/// Phase 1a simple PlatformManager — an empty shell.
/// Phase 1b will add active_project_id and related UI state management.
pub struct PlatformManager {
    inner: Arc<Inner>,
}

struct Inner {
    // Phase 1a: empty — Phase 1b will add fields like active_project_id
}

impl PlatformManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {}),
        }
    }

    pub fn clone_ref(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl Default for PlatformManager {
    fn default() -> Self {
        Self::new()
    }
}
