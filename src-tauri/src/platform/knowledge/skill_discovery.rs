use std::path::Path;

use crate::app_error::AppCommandError;
use crate::models::SkillInfo;
use yaml_rust2::YamlLoader;

/// Discover all skills in the `skills/` directory under a KB root.
///
/// Each skill is a subdirectory containing a `skill.yaml` file. If the
/// `skills/` directory does not exist, returns `Ok(Vec::new())`.
///
/// Parses `skill.yaml` using `yaml-rust2` and extracts:
/// - `name` (falls back to directory name if absent in yaml)
/// - `description`
/// - `trigger.task_type`
/// - `inject` (list of document paths)
/// - `agent_hint`
pub fn discover_skills(kb_dir: &str) -> Result<Vec<SkillInfo>, AppCommandError> {
    let root = Path::new(kb_dir);
    let skills_dir = root.join("skills");

    // If skills/ doesn't exist, return empty — not an error
    if !skills_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut skills = Vec::new();
    let entries = std::fs::read_dir(&skills_dir).map_err(AppCommandError::io)?;

    for entry in entries {
        let entry = entry.map_err(AppCommandError::io)?;
        let path = entry.path();

        // Only process directories (each skill is a directory)
        if !path.is_dir() {
            continue;
        }

        // Skip symlinks
        if path.is_symlink() {
            continue;
        }

        let skill_yaml_path = path.join("skill.yaml");
        if !skill_yaml_path.is_file() {
            continue; // No skill.yaml — skip this directory
        }

        // Boundary check: canonicalize and ensure within kb_dir
        let canon_yaml = std::fs::canonicalize(&skill_yaml_path).map_err(AppCommandError::io)?;
        let canon_root = std::fs::canonicalize(root).map_err(AppCommandError::io)?;
        if !canon_yaml.starts_with(&canon_root) {
            continue; // Path traversal — skip
        }

        let dir_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let skill = parse_skill_yaml(&skill_yaml_path, &dir_name)?;
        skills.push(skill);
    }

    Ok(skills)
}

/// Parse a `skill.yaml` file into a `SkillInfo`.
/// Falls back to `dir_name` for the `name` field if yaml lacks it.
fn parse_skill_yaml(path: &Path, dir_name: &str) -> Result<SkillInfo, AppCommandError> {
    let content = std::fs::read_to_string(path).map_err(AppCommandError::io)?;

    let docs = YamlLoader::load_from_str(&content)
        .map_err(|e| AppCommandError::invalid_input(format!("Invalid skill.yaml at {}: {e}", path.display())))?;

    if docs.is_empty() {
        return Ok(SkillInfo {
            name: dir_name.to_string(),
            description: String::new(),
            trigger_task_type: None,
            inject: Vec::new(),
            agent_hint: None,
        });
    }

    let yaml = &docs[0];

    // name: prefer yaml value, fallback to directory name
    let name = yaml["name"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| dir_name.to_string());

    // description
    let description = yaml["description"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_default();

    // trigger.task_type
    let trigger_task_type = yaml["trigger"]["task_type"]
        .as_str()
        .map(|s| s.to_string());

    // inject: list of strings
    let inject = yaml["inject"]
        .as_vec()
        .map(|v| {
            v.iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();

    // agent_hint
    let agent_hint = yaml["agent_hint"]
        .as_str()
        .map(|s| s.to_string());

    Ok(SkillInfo {
        name,
        description,
        trigger_task_type,
        inject,
        agent_hint,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discover_skills_no_skills_dir() {
        let tmp = tempfile::tempdir().unwrap();
        // No skills/ directory — should return Ok(Vec::new())
        let result = discover_skills(tmp.path().to_string_lossy().as_ref()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_discover_skills_with_skill_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_dir = tmp.path();

        // Create skills/generate-prd/skill.yaml
        let skill_dir = kb_dir.join("skills").join("generate-prd");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("skill.yaml"),
            "name: generate-prd\ndescription: Generate PRD from requirements\ntrigger:\n  task_type: prd\ninject:\n  - docs/architecture/product-arch.md\n  - templates/prd-template.md\nagent_hint: \"Please generate PRD based on the context\"\n",
        )
        .unwrap();

        let result = discover_skills(kb_dir.to_string_lossy().as_ref()).unwrap();
        assert_eq!(result.len(), 1);

        let skill = &result[0];
        assert_eq!(skill.name, "generate-prd");
        assert_eq!(skill.description, "Generate PRD from requirements");
        assert_eq!(skill.trigger_task_type, Some("prd".to_string()));
        assert_eq!(skill.inject, vec!["docs/architecture/product-arch.md", "templates/prd-template.md"]);
        assert_eq!(skill.agent_hint, Some("Please generate PRD based on the context".to_string()));
    }

    #[test]
    fn test_discover_skills_yaml_missing_name() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_dir = tmp.path();

        let skill_dir = kb_dir.join("skills").join("code-review");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("skill.yaml"),
            "description: Code review skill\n",
        )
        .unwrap();

        let result = discover_skills(kb_dir.to_string_lossy().as_ref()).unwrap();
        assert_eq!(result.len(), 1);

        // Name should fall back to directory name
        assert_eq!(result[0].name, "code-review");
        assert_eq!(result[0].description, "Code review skill");
    }

    #[test]
    fn test_discover_skills_dir_without_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_dir = tmp.path();

        // Create a directory under skills/ that has no skill.yaml
        let skill_dir = kb_dir.join("skills").join("no-yaml");
        std::fs::create_dir_all(&skill_dir).unwrap();
        // Don't create skill.yaml

        let result = discover_skills(kb_dir.to_string_lossy().as_ref()).unwrap();
        assert!(result.is_empty()); // Should be skipped
    }

    #[test]
    fn test_discover_skills_invalid_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_dir = tmp.path();

        let skill_dir = kb_dir.join("skills").join("broken");
        std::fs::create_dir_all(&skill_dir).unwrap();
        // yaml-rust2 may be lenient with certain malformed input.
        // Use truly invalid yaml that the parser will reject.
        std::fs::write(skill_dir.join("skill.yaml"), "{:\n  invalid: [\n").unwrap();

        let result = discover_skills(kb_dir.to_string_lossy().as_ref());
        assert!(result.is_err()); // Should fail on invalid yaml
    }

    #[test]
    fn test_discover_skills_multiple_skills() {
        let tmp = tempfile::tempdir().unwrap();
        let kb_dir = tmp.path();

        let prd_dir = kb_dir.join("skills").join("generate-prd");
        std::fs::create_dir_all(&prd_dir).unwrap();
        std::fs::write(prd_dir.join("skill.yaml"), "name: generate-prd\ndescription: PRD\n").unwrap();

        let review_dir = kb_dir.join("skills").join("code-review");
        std::fs::create_dir_all(&review_dir).unwrap();
        std::fs::write(review_dir.join("skill.yaml"), "name: code-review\ndescription: Review\n").unwrap();

        let result = discover_skills(kb_dir.to_string_lossy().as_ref()).unwrap();
        assert_eq!(result.len(), 2);
    }
}
