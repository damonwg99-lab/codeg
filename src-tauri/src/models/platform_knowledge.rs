use serde::{Deserialize, Serialize};

/// A discovered skill from `skills/*/skill.yaml`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    /// Skill name (e.g. "generate-prd"), derived from directory name or yaml `name`.
    pub name: String,
    /// Human-readable description.
    pub description: String,
    /// Task type(s) that trigger this skill.
    pub trigger_task_type: Option<String>,
    /// Documents the skill recommends injecting into the agent context.
    pub inject: Vec<String>,
    /// Hint text for the agent.
    pub agent_hint: Option<String>,
}

/// Result of KB directory initialization.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbInitResult {
    /// Absolute path of the created `_knowledge/` directory.
    pub kb_dir: String,
    /// Subdirectories created inside `_knowledge/`.
    pub sub_dirs: Vec<String>,
    /// Whether `.gitignore` was created.
    pub gitignore_created: bool,
    /// Whether `README.md` was created.
    pub readme_created: bool,
}

/// A file discovered during KB scanning, ready for upsert.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedDoc {
    /// Inferred doc type (tech_doc, template, skill, etc.).
    pub doc_type: String,
    /// Document title (from frontmatter or filename).
    pub title: String,
    /// Relative file path within the KB directory.
    pub file_path: String,
    /// Whether the file is under a shared (git-tracked) area.
    pub is_shared: bool,
    /// Tags extracted from frontmatter (stored as JSON string).
    pub tags_json: Option<String>,
    /// Description extracted from frontmatter.
    pub description: Option<String>,
    /// Associated skill name (if under `skills/`).
    pub skill_name: Option<String>,
}

/// Result of scanning a knowledge base directory.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResultInfo {
    /// The project whose KB was scanned.
    pub project_id: i32,
    /// Total number of files found on disk.
    pub scanned_count: i32,
    /// Number of new records inserted.
    pub new_count: i32,
    /// Number of existing records updated.
    pub updated_count: i32,
    /// Number of records soft-deleted (file no longer on disk).
    pub deleted_count: i32,
}
