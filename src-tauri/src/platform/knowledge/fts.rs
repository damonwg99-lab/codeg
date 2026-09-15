use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};
use serde::Serialize;

use crate::app_error::AppCommandError;
use crate::db::error::DbError;
use crate::db::service::platform_knowledge_doc_service;
use crate::models::KnowledgeDocInfo;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocFtsResult {
    pub doc: KnowledgeDocInfo,
    pub snippet: String,
    pub rank: f64,
}

fn db_err(e: sea_orm::DbErr) -> AppCommandError {
    AppCommandError::from(DbError::from(e))
}

/// Sync or insert a document into the FTS5 index.
pub async fn sync_doc_fts(
    conn: &DatabaseConnection,
    doc_id: i32,
    project_id: i32,
    title: &str,
    tags: &str,
    description: &str,
    content: &str,
) -> Result<(), AppCommandError> {
    // Delete existing entry if any
    let delete_sql = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM platform_knowledge_doc_fts WHERE doc_id = ?",
        [doc_id.into()],
    );
    let _ = conn.execute(delete_sql).await;

    // Insert new entry
    let insert_sql = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "INSERT INTO platform_knowledge_doc_fts (doc_id, project_id, title, tags, description, content) VALUES (?, ?, ?, ?, ?, ?)",
        [
            doc_id.into(),
            project_id.into(),
            title.into(),
            tags.into(),
            description.into(),
            content.into(),
        ],
    );
    conn.execute(insert_sql).await.map_err(db_err)?;
    Ok(())
}

/// Delete a document from the FTS5 index.
pub async fn delete_doc_fts(
    conn: &DatabaseConnection,
    doc_id: i32,
) -> Result<(), AppCommandError> {
    let delete_sql = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "DELETE FROM platform_knowledge_doc_fts WHERE doc_id = ?",
        [doc_id.into()],
    );
    let _ = conn.execute(delete_sql).await;
    Ok(())
}

/// Sanitize user input for SQLite FTS5 MATCH query.
fn sanitize_fts5_query(raw: &str) -> String {
    let terms: Vec<String> = raw
        .split_whitespace()
        .map(|w| {
            let cleaned: String = w
                .chars()
                .filter(|c| !matches!(c, '"' | '*' | '^' | ':' | '(' | ')' | '{' | '}' | '\''))
                .collect();
            cleaned
        })
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{}\"*", w))
        .collect();

    if terms.is_empty() {
        String::new()
    } else {
        terms.join(" ")
    }
}

/// Search knowledge docs via SQLite FTS5 full-text index with snippet extraction.
pub async fn search_fts(
    conn: &DatabaseConnection,
    project_id: i32,
    query: &str,
) -> Result<Vec<KnowledgeDocFtsResult>, AppCommandError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let fts_query = sanitize_fts5_query(trimmed);
    if fts_query.is_empty() {
        return Ok(Vec::new());
    }

    // Use snippet() function from FTS5 with <mark> tags
    let sql = Statement::from_sql_and_values(
        DbBackend::Sqlite,
        "SELECT doc_id, snippet(platform_knowledge_doc_fts, -1, '<mark class=\"bg-amber-200 text-amber-950 dark:bg-amber-800 dark:text-amber-100 px-0.5 rounded font-medium\">', '</mark>', '...', 25) AS snippet, rank \
         FROM platform_knowledge_doc_fts \
         WHERE platform_knowledge_doc_fts MATCH ? AND project_id = ? \
         ORDER BY rank \
         LIMIT 50",
        [fts_query.into(), project_id.into()],
    );

    let rows = conn.query_all(sql).await.map_err(db_err)?;

    let mut results = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for row in rows {
        let doc_id: i32 = row.try_get("", "doc_id").map_err(db_err)?;
        let snippet: String = row.try_get("", "snippet").map_err(db_err)?;
        let rank: f64 = row.try_get("", "rank").map_err(db_err)?;

        if seen_ids.insert(doc_id) {
            if let Some(doc) = platform_knowledge_doc_service::get_by_id(conn, doc_id)
                .await
                .map_err(AppCommandError::from)?
            {
                results.push(KnowledgeDocFtsResult {
                    doc,
                    snippet,
                    rank,
                });
            }
        }
    }

    // Graceful fallback / enhancement: if FTS results are empty or few,
    // also search via LIKE to catch partial substrings
    let like_docs = platform_knowledge_doc_service::search(conn, project_id, trimmed)
        .await
        .unwrap_or_default();

    for doc in like_docs {
        if seen_ids.insert(doc.id) {
            let snippet = doc.description.clone().unwrap_or_else(|| doc.title.clone());
            results.push(KnowledgeDocFtsResult {
                doc,
                snippet,
                rank: 999.0,
            });
        }
    }

    Ok(results)
}
