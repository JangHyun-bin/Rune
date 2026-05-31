use crate::fs_ops;
use notify::{RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
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
pub fn search(root: String, query: String) -> Result<Vec<crate::search::SearchHit>, String> {
    Ok(crate::search::search_files(std::path::Path::new(&root), &query))
}
