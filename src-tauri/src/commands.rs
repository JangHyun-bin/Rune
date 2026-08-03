use crate::fs_ops;
use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs_ops::read_text_file(&PathBuf::from(path))
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<crate::fs_ops::FileNode>, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() { return Err(format!("폴더가 아님: {path}")); }
    Ok(crate::fs_ops::scan_dir(&p, 0))
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    fs_ops::write_text_file_atomic(&PathBuf::from(path), &contents)
}

#[tauri::command]
pub fn save_asset(doc_path: String, bytes: Vec<u8>, ext: String) -> Result<String, String> {
    let dir = Path::new(&doc_path).parent().ok_or("문서 경로에 폴더가 없음")?;
    fs_ops::save_asset(dir, &bytes, &ext)
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<crate::settings::Settings, String> {
    Ok(crate::settings::load(&settings_path(&app)?))
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: crate::settings::Settings) -> Result<(), String> {
    crate::settings::save(&settings_path(&app)?, &settings)
}

#[tauri::command]
pub fn watch_folder(app: AppHandle, state: tauri::State<crate::WatcherState>, path: String) -> Result<(), String> {
    let app2 = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            // only signal real content/structure changes
            if matches!(ev.kind, notify::EventKind::Modify(_) | notify::EventKind::Create(_) | notify::EventKind::Remove(_)) {
                let paths: Vec<String> = ev.paths.iter().map(|p| p.to_string_lossy().to_string()).collect();
                let _ = app2.emit("fs-change", paths);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher); // replacing drops & stops the old watcher
    Ok(())
}

#[tauri::command]
pub async fn search(
    state: tauri::State<'_, crate::SearchState>,
    root: String,
    query: String,
    request_id: u64,
) -> Result<crate::search::SearchResults, String> {
    let canceled = state.0.clone();
    let canceled_for_scan = canceled.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::search::search_files_until(std::path::Path::new(&root), &query, || {
            canceled_for_scan
                .lock()
                .map(|requests| requests.contains(&request_id))
                .unwrap_or(true)
        })
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Ok(mut requests) = canceled.lock() {
        requests.remove(&request_id);
    }
    Ok(result)
}

#[tauri::command]
pub fn cancel_search(
    state: tauri::State<'_, crate::SearchState>,
    request_id: u64,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(request_id);
    Ok(())
}

fn current_workspace_index(
    state: &tauri::State<'_, crate::WorkspaceIndexState>,
    root: &str,
) -> Result<Arc<crate::workspace_index::WorkspaceIndex>, String> {
    let index = state.0.lock().map_err(|error| error.to_string())?
        .clone().ok_or("workspace index is not ready")?;
    if index.root() != Path::new(root) {
        return Err("workspace index belongs to a different folder".into());
    }
    Ok(index)
}

#[tauri::command]
pub async fn rebuild_workspace_index(
    state: tauri::State<'_, crate::WorkspaceIndexState>,
    root: String,
) -> Result<crate::workspace_index::IndexStats, String> {
    let index = tauri::async_runtime::spawn_blocking(move || {
        crate::workspace_index::WorkspaceIndex::build(Path::new(&root))
    }).await.map_err(|error| error.to_string())??;
    let stats = index.stats();
    *state.0.lock().map_err(|error| error.to_string())? = Some(Arc::new(index));
    Ok(stats)
}

#[tauri::command]
pub async fn update_workspace_index(
    state: tauri::State<'_, crate::WorkspaceIndexState>,
    root: String,
    paths: Vec<String>,
) -> Result<crate::workspace_index::IndexStats, String> {
    let index = current_workspace_index(&state, &root)?;
    let source = index.clone();
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let updated = tauri::async_runtime::spawn_blocking(move || source.updated(&paths))
        .await.map_err(|error| error.to_string())??;
    let stats = updated.stats();
    let mut current = state.0.lock().map_err(|error| error.to_string())?;
    if !current.as_ref().is_some_and(|current| Arc::ptr_eq(current, &index)) {
        return Err("workspace index changed while updating".into());
    }
    *current = Some(Arc::new(updated));
    Ok(stats)
}

#[tauri::command]
pub async fn search_workspace_index(
    index_state: tauri::State<'_, crate::WorkspaceIndexState>,
    search_state: tauri::State<'_, crate::SearchState>,
    root: String,
    scope_root: Option<String>,
    query: String,
    active_path: Option<String>,
    request_id: u64,
) -> Result<crate::search::SearchResults, String> {
    let index = current_workspace_index(&index_state, &root)?;
    let canceled = search_state.0.clone();
    let canceled_for_search = canceled.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        index.search_under(
            &query,
            scope_root.as_deref().map(Path::new),
            active_path.as_deref().map(Path::new),
            || canceled_for_search.lock()
                .map(|requests| requests.contains(&request_id))
                .unwrap_or(true),
        )
    }).await;
    if let Ok(mut requests) = canceled.lock() {
        requests.remove(&request_id);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn workspace_index_headings(
    state: tauri::State<'_, crate::WorkspaceIndexState>,
    root: String,
) -> Result<Vec<crate::workspace_index::IndexedHeading>, String> {
    let index = current_workspace_index(&state, &root)?;
    tauri::async_runtime::spawn_blocking(move || index.headings())
        .await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn workspace_index_link_targets(
    state: tauri::State<'_, crate::WorkspaceIndexState>,
    root: String,
    source_path: Option<String>,
) -> Result<Vec<crate::workspace_index::LinkTarget>, String> {
    let index = current_workspace_index(&state, &root)?;
    tauri::async_runtime::spawn_blocking(move || {
        index.link_targets(source_path.as_deref().map(Path::new))
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn workspace_index_backlinks(
    state: tauri::State<'_, crate::WorkspaceIndexState>,
    root: String,
    target_path: String,
) -> Result<Vec<crate::workspace_index::Backlink>, String> {
    let index = current_workspace_index(&state, &root)?;
    tauri::async_runtime::spawn_blocking(move || index.backlinks(Path::new(&target_path)))
        .await
        .map_err(|error| error.to_string())
}

/// Return (and clear) the file Rune was launched with via file association, if any.
/// Also marks the app "ready" so later OS open events are delivered live, not buffered.
#[tauri::command]
pub fn take_launch_file(
    launch: tauri::State<crate::LaunchFile>,
    ready: tauri::State<crate::AppReady>,
) -> Option<String> {
    ready.0.store(true, Ordering::SeqCst);
    launch.0.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<(), String> {
    fs_ops::rename(std::path::Path::new(&path), &new_name)
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    fs_ops::delete_to_trash(std::path::Path::new(&path))
}

#[tauri::command]
pub fn create_file(dir: String, name: String) -> Result<String, String> {
    fs_ops::create_file(std::path::Path::new(&dir), &name)
}

#[tauri::command]
pub fn create_dir(dir: String, name: String) -> Result<String, String> {
    fs_ops::create_dir(std::path::Path::new(&dir), &name)
}

/// Open the OS "default apps" UI so the user can make Rune the default .md handler.
/// Windows blocks programmatic default-handler changes (UserChoice hash), so we
/// deep-link into Settings and let the user confirm; Linux can set it directly.
#[tauri::command]
pub fn open_default_apps_settings() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:")
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // xdg allows setting the default handler directly (best-effort).
        let _ = std::process::Command::new("xdg-mime")
            .args(["default", "Rune.desktop", "text/markdown"])
            .spawn();
    }
    Ok(())
}
