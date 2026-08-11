pub mod agent;
pub mod automation;
pub mod background;
pub mod chat_channel;
pub mod conversation;
pub mod folder;
pub mod message;
pub mod model_provider;
pub mod pet;
pub mod quick_message;
pub mod remote_workspace_connection;
pub mod system;
pub mod token_usage;
pub mod work_task;

pub use agent::AgentType;
pub use automation::{
    AutomationAction, AutomationConfig, AutomationDraft, AutomationInfo, AutomationRunInfo,
    AutomationRunStatus, IsolationMode, TriggerKind,
};
#[allow(unused_imports)]
pub use chat_channel::{ChannelStatusInfo, ChatChannelInfo, ChatChannelMessageLogInfo};
pub use conversation::{
    AgentConversationCount, AgentStats, ConversationDetail, ConversationSummary,
    ConversationTurnsPage, DbConversationDetail, DbConversationSummary, FolderInfo,
    ImportFolderOutcome, ImportResult, ImportSelectedResult, ScanFolder, ScanResult, ScanSession,
    ScanSessionStatus, SelectedSessionKey, SessionStats, SidebarData,
};
pub use folder::{
    FolderCommandInfo, FolderDetail, FolderHistoryEntry, OpenedTab, OpenedTabsSnapshot,
    SaveTabsOutcome,
};
pub use message::{
    AgentExecutionStats, AgentToolCall, ContentBlock, ImageData, MessageRole, MessageTurn,
    TurnRole, TurnUsage, UnifiedMessage,
};
pub use quick_message::QuickMessageInfo;
pub use remote_workspace_connection::RemoteWorkspaceConnectionInfo;
pub use token_usage::{
    TokenUsageBreakdownItem, TokenUsageBucket, TokenUsageConversationItem, TokenUsageFacets,
    TokenUsageFilter, TokenUsageFolderFacet, TokenUsageHeatCell, TokenUsagePoint,
    TokenUsageReport, TokenUsageStreak, TokenUsageSyncProgress, TokenUsageSyncResult,
    TokenUsageSyncStatus, TokenUsageTotals,
};
pub use work_task::{
    FollowUpIntent, WorkTaskChangedFile, WorkTaskConfig, WorkTaskDraft, WorkTaskEventInfo,
    WorkTaskFolderSettings, WorkTaskInfo, WorkTaskMergeState, WorkTaskPreflight, WorkTaskStatus,
    WorkTaskTemplateDraft, WorkTaskTemplateInfo, STAGE_PROMPT_ALL,
};
#[cfg(feature = "tauri-runtime")]
pub use system::SystemRenderingSettings;
pub use system::{
    AvailableTerminalShells, GitCredentials, GitDetectResult, GitHubAccountsSettings,
    GitHubTokenValidation, GitSettings, SystemLanguageSettings, SystemProxySettings,
    SystemTerminalSettings, TerminalShellOption,
};

// ─── Platform models (Cluster A/B/C) ───
pub mod platform_project;
pub mod platform_task;
pub mod platform_config;
pub mod platform_knowledge_doc;
pub use platform_project::{
    GitRepoScanResult, ProjectDetail, ProjectInfo, ProjectRepoInfo, TaskCountByStatus,
};
pub use platform_task::{
    TaskBranchInfo, TaskConversationInfo, TaskConversationLaunchInfo, TaskDecompositionInfo,
    TaskDetail, TaskInfo, TaskTypeMappingInfo,
};
pub use platform_config::{CredentialInfo, GlobalConfigInfo};
pub use platform_knowledge_doc::{
    CreateKnowledgeDocDraft, KnowledgeDocInfo, UpdateKnowledgeDocDraft, UpsertKnowledgeDocDraft,
};
pub mod platform_knowledge;
pub use platform_knowledge::{KbInitResult, ScanResultInfo, ScannedDoc, SkillInfo};
// ─── Release/Branch models (Cluster B) ───
pub mod platform_release;
pub use platform_release::{
    BranchInfo, CreateReleaseParams, ReleaseDetail, ReleaseInfo, ReleaseItemInfo,
};
