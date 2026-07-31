use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::sync::{Arc, Mutex};

use ignore::WalkBuilder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::app_error::AppCommandError;

const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;
const DEFAULT_MAX_RESULTS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentMatch {
    pub relative_path: String,
    pub line_number: usize,
    pub line_content: String,
}

/// Core streaming search: emits results via `EventEmitter` (works in both
/// desktop Tauri mode and standalone web server mode).
pub fn search_files_content_streaming_core(
    emitter: &crate::web::event_bridge::EventEmitter,
    search_id: String,
    base_path: String,
    keyword: String,
    max_results: Option<usize>,
) {
    let trimmed = keyword.trim().to_string();
    if trimmed.is_empty() {
        return;
    }

    let lower_keyword = trimmed.to_lowercase();
    let max_results = max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let root = PathBuf::from(&base_path);
    let emitter = emitter.clone();

    std::thread::spawn(move || {
        let (tx, rx) = channel::<Vec<FileContentMatch>>();

        let emitter_clone = emitter.clone();
        let sid = search_id.clone();
        std::thread::spawn(move || {
            let mut emitted = 0usize;
            let mut done_sent = false;
            for batch in rx {
                emitted += batch.len();
                let done = emitted >= max_results;
                crate::web::event_bridge::emit_event(
                    &emitter_clone,
                    "search_files_content:results",
                    ContentSearchBatch {
                        search_id: sid.clone(),
                        matches: batch,
                        done,
                    },
                );
                if done {
                    done_sent = true;
                    break;
                }
            }
            if !done_sent {
                crate::web::event_bridge::emit_event(
                    &emitter_clone,
                    "search_files_content:results",
                    ContentSearchBatch {
                        search_id: sid,
                        matches: vec![],
                        done: true,
                    },
                );
            }
        });

        let paths = collect_file_paths_parallel(&root);

        let _ = paths
            .par_iter()
            .try_for_each_with(
                (tx, Arc::new(Mutex::new(0usize))),
                |(tx, emitted), (path, relative_path)| {
                    let count = emitted.lock().unwrap();
                    if *count >= max_results {
                        return Err(());
                    }
                    drop(count);

                    let mut local: Vec<FileContentMatch> = Vec::new();
                    let file = match File::open(path) {
                        Ok(f) => f,
                        Err(_) => return Ok::<_, ()>(()),
                    };
                    let reader = BufReader::new(file);
                    for (i, line_result) in reader.lines().enumerate() {
                        let line = match line_result {
                            Ok(l) => l,
                            Err(_) => break,
                        };
                        if line.to_lowercase().contains(&lower_keyword) {
                            let display = line.chars().take(200).collect::<String>();
                            let display = if line.chars().count() > 200 {
                                format!("{display}...")
                            } else {
                                display
                            };
                            local.push(FileContentMatch {
                                relative_path: relative_path.clone(),
                                line_number: i + 1,
                                line_content: display,
                            });
                        }
                    }
                    if !local.is_empty() {
                        let _ = tx.send(local);
                    }
                    Ok::<_, ()>(())
                },
            );
    });
}

#[cfg(feature = "tauri-runtime")]
#[tauri::command]
pub async fn search_files_content_streaming(
    app_handle: tauri::AppHandle,
    search_id: String,
    base_path: String,
    keyword: String,
    max_results: Option<usize>,
) -> Result<(), AppCommandError> {
    use crate::web::event_bridge::EventEmitter;
    search_files_content_streaming_core(
        &EventEmitter::Tauri(app_handle),
        search_id,
        base_path,
        keyword,
        max_results,
    );
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchBatch {
    pub search_id: String,
    pub matches: Vec<FileContentMatch>,
    pub done: bool,
}

pub async fn search_files_content(
    base_path: String,
    keyword: String,
    max_results: Option<usize>,
) -> Result<Vec<FileContentMatch>, AppCommandError> {
    let trimmed = keyword.trim().to_string();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let lower_keyword = trimmed.to_lowercase();
    let max_results = max_results.unwrap_or(DEFAULT_MAX_RESULTS);
    let root = PathBuf::from(&base_path);

    let file_paths: Vec<(PathBuf, String)> =
        tokio::task::spawn_blocking(move || collect_file_paths_parallel(&root))
            .await
            .map_err(|e| {
                AppCommandError::task_execution_failed("search_files_content spawn_blocking")
                    .with_detail(e.to_string())
            })?;

    let results = tokio::task::spawn_blocking(move || {
        let results = Mutex::new(Vec::with_capacity(max_results));
        let _ = file_paths
            .par_iter()
            .try_for_each(|(path, relative_path)| {
                if results.lock().unwrap().len() >= max_results {
                    return Err(());
                }
                let mut local: Vec<FileContentMatch> = Vec::new();
                let file = match File::open(path) {
                    Ok(f) => f,
                    Err(_) => return Ok::<_, ()>(()),
                };
                let reader = BufReader::new(file);
                for (i, line_result) in reader.lines().enumerate() {
                    let line = match line_result {
                        Ok(l) => l,
                        Err(_) => break,
                    };
                    if line.to_lowercase().contains(&lower_keyword) {
                        let display = line.chars().take(200).collect::<String>();
                        let display = if line.chars().count() > 200 {
                            format!("{display}...")
                        } else {
                            display
                        };
                        local.push(FileContentMatch {
                            relative_path: relative_path.clone(),
                            line_number: i + 1,
                            line_content: display,
                        });
                    }
                }
                if !local.is_empty() {
                    let mut guard = results.lock().unwrap();
                    let remaining = max_results - guard.len();
                    let take = local.len().min(remaining);
                    guard.extend(local.into_iter().take(take));
                }
                Ok::<_, ()>(())
            });
        results.into_inner().unwrap_or_else(|e| e.into_inner())
    })
    .await
    .map_err(|e| {
        AppCommandError::task_execution_failed("search_files_content parallel search")
            .with_detail(e.to_string())
    })?;

    Ok(results)
}

fn collect_file_paths_parallel(root: &Path) -> Vec<(PathBuf, String)> {
    let root_owned = root.to_path_buf();
    let paths = Arc::new(Mutex::new(Vec::new()));
    let paths_clone = Arc::clone(&paths);
    WalkBuilder::new(root)
        .git_ignore(true)
        .build_parallel()
        .run(move || {
            let paths = Arc::clone(&paths_clone);
            let root = root_owned.clone();
            Box::new(move |entry| {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => return ignore::WalkState::Continue,
                };
                let ft = match entry.file_type() {
                    Some(ft) => ft,
                    None => return ignore::WalkState::Continue,
                };
                if !ft.is_file() {
                    return ignore::WalkState::Continue;
                }
                if let Ok(meta) = entry.metadata() {
                    if meta.len() > MAX_FILE_SIZE {
                        return ignore::WalkState::Continue;
                    }
                }
                let path = entry.path();
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                if is_binary_extension(ext) {
                    return ignore::WalkState::Continue;
                }
                let relative_path = path
                    .strip_prefix(&root)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let mut guard = paths.lock().unwrap();
                guard.push((path.to_path_buf(), relative_path));
                ignore::WalkState::Continue
            })
        });

    Arc::into_inner(paths)
        .and_then(|m| m.into_inner().ok())
        .unwrap_or_default()
}

fn is_binary_extension(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "bmp"
            | "ico"
            | "svg"
            | "webp"
            | "woff"
            | "woff2"
            | "ttf"
            | "eot"
            | "otf"
            | "mp3"
            | "mp4"
            | "avi"
            | "mov"
            | "wmv"
            | "flv"
            | "webm"
            | "mkv"
            | "zip"
            | "tar"
            | "gz"
            | "bz2"
            | "7z"
            | "rar"
            | "exe"
            | "dll"
            | "so"
            | "dylib"
            | "pdf"
            | "doc"
            | "docx"
            | "xls"
            | "xlsx"
            | "ppt"
            | "pptx"
            | "class"
            | "pyc"
            | "pyo"
            | "o"
            | "obj"
            | "bin"
            | "dat"
            | "db"
            | "sqlite"
            | "sqlite3"
            | "wasm"
            | "map"
            | "lock"
            | "jar"
            | "war"
            | "ear"
            | "apk"
            | "ipa"
            | "json"
    )
}
