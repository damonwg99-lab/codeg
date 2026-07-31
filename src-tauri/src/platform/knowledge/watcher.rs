use std::sync::Mutex;
use std::time::Duration;

use notify::event::{EventKind, ModifyKind};
use notify::{Event, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TrySendError;

use crate::app_error::AppCommandError;
use crate::commands::knowledge::scan_knowledge_repo_core;
use crate::db::AppDatabase;
use crate::web::event_bridge::{emit_event, EventEmitter};

const KB_WATCH_DEBOUNCE_MS: u64 = 2_000;
const KB_WATCH_CHANNEL_CAPACITY: usize = 256;

struct KbManagedWatcher {
    _watcher: notify::RecommendedWatcher,
    _task: tokio::task::JoinHandle<()>,
}

static KB_WATCHERS: std::sync::LazyLock<Mutex<Vec<(i32, KbManagedWatcher)>>> =
    std::sync::LazyLock::new(|| Mutex::new(Vec::new()));

pub fn start_kb_watcher(
    project_id: i32,
    kb_dir: &str,
    db: AppDatabase,
    emitter: EventEmitter,
) -> Result<(), AppCommandError> {
    stop_kb_watcher(project_id);

    let (event_tx, event_rx) = mpsc::channel(KB_WATCH_CHANNEL_CAPACITY);

    let mut watcher =
        notify::recommended_watcher(move |result: Result<Event, notify::Error>| match result {
            Ok(event) => match event_tx.try_send(event) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => {
                    tracing::warn!("[kb-watcher] event channel full for project {project_id}");
                }
                Err(TrySendError::Closed(_)) => {}
            },
            Err(err) => {
                tracing::error!(
                    "[kb-watcher] notify error for project {project_id}: {err}"
                );
            }
        })
        .map_err(|e| {
            AppCommandError::io_error("Failed to create KB watcher")
                .with_detail(e.to_string())
        })?;

    watcher
        .watch(kb_dir.as_ref(), RecursiveMode::Recursive)
        .map_err(|e| {
            AppCommandError::io_error("Failed to watch KB directory")
                .with_detail(e.to_string())
        })?;

    let handle = tokio::spawn(kb_watch_loop(event_rx, db, emitter, project_id));

    let mut guard = KB_WATCHERS.lock().unwrap();
    guard.push((project_id, KbManagedWatcher {
        _watcher: watcher,
        _task: handle,
    }));

    tracing::info!("[kb-watcher] started for project {project_id}: {kb_dir}");
    Ok(())
}

pub fn stop_kb_watcher(project_id: i32) {
    let mut guard = KB_WATCHERS.lock().unwrap();
    if let Some(pos) = guard.iter().position(|(id, _)| *id == project_id) {
        let (_, entry) = guard.remove(pos);
        entry._task.abort();
        tracing::info!("[kb-watcher] stopped for project {project_id}");
    }
}

fn is_relevant_kb_event(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_)
            | EventKind::Modify(ModifyKind::Data(_))
            | EventKind::Modify(ModifyKind::Name(_))
            | EventKind::Remove(_)
    )
}

async fn kb_watch_loop(
    mut event_rx: mpsc::Receiver<Event>,
    db: AppDatabase,
    emitter: EventEmitter,
    project_id: i32,
) {
    let debounce = Duration::from_millis(KB_WATCH_DEBOUNCE_MS);
    let mut dirty = false;

    loop {
        if !dirty {
            match wait_next_relevant(&mut event_rx).await {
                Some(_) => dirty = true,
                None => break,
            }
        }

        match tokio::time::timeout(debounce, wait_next_relevant(&mut event_rx)).await {
            Ok(Some(_)) => {
                continue;
            }
            Ok(None) => {
                do_scan(&db, &emitter, project_id).await;
                break;
            }
            Err(_elapsed) => {
                do_scan(&db, &emitter, project_id).await;
                dirty = false;
            }
        }
    }
}

async fn wait_next_relevant(rx: &mut mpsc::Receiver<Event>) -> Option<Event> {
    loop {
        match rx.recv().await {
            Some(event) if is_relevant_kb_event(&event) => return Some(event),
            Some(_) => continue,
            None => return None,
        }
    }
}

async fn do_scan(db: &AppDatabase, emitter: &EventEmitter, project_id: i32) {
    match scan_knowledge_repo_core(db, project_id).await {
        Ok(result) => {
            emit_event(emitter, "knowledge://index-changed", &result);
        }
        Err(err) => {
            tracing::error!(
                "[kb-watcher] auto-scan failed for project {project_id}: {err}"
            );
        }
    }
}
