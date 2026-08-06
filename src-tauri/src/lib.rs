mod fs_ops;
mod commands;
mod publishing;
mod settings;
mod search;
mod workspace_index;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

pub struct WatcherState(pub Mutex<Option<notify::RecommendedWatcher>>);
pub struct SearchState(pub Arc<Mutex<HashSet<u64>>>);
pub struct WorkspaceIndexState(pub Mutex<Option<Arc<workspace_index::WorkspaceIndex>>>);
/// File paths Rune was launched with (double-clicked .md via file association),
/// pending until the frontend is ready to open them.
pub struct LaunchFile(pub Mutex<Vec<String>>);

/// True once the frontend has registered its `open-file` listener (it drains
/// `LaunchFile` on startup). Before that, OS file-open events are buffered into
/// `LaunchFile`; after, they are delivered live.
pub struct AppReady(pub AtomicBool);

/// First CLI argument that is an existing file (skips the exe path and any flags).
/// This is how a double-clicked file arrives on Windows/Linux.
fn file_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && std::path::Path::new(a.as_str()).is_file())
        .cloned()
}

fn queue_open_file_until_ready(
    ready: &AtomicBool,
    launch: &Mutex<Vec<String>>,
    path: String,
) -> bool {
    let Ok(mut pending) = launch.lock() else {
        return false;
    };
    if ready.load(Ordering::SeqCst) {
        return false;
    }
    pending.push(path);
    true
}

pub(crate) fn take_queued_launch_files(
    ready: &AtomicBool,
    launch: &Mutex<Vec<String>>,
) -> Vec<String> {
    let Ok(mut pending) = launch.lock() else {
        return Vec::new();
    };
    ready.store(true, Ordering::SeqCst);
    std::mem::take(&mut *pending)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drains_initial_and_second_instance_files_in_arrival_order() {
        let ready = AtomicBool::new(false);
        let launch = Mutex::new(vec!["C:/vault/initial.md".to_owned()]);

        assert!(queue_open_file_until_ready(
            &ready,
            &launch,
            "C:/vault/second.md".into()
        ));
        assert_eq!(
            take_queued_launch_files(&ready, &launch),
            vec!["C:/vault/initial.md", "C:/vault/second.md"]
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial = file_from_args(&std::env::args().collect::<Vec<_>>());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // single-instance MUST be the first plugin registered. When a second launch
    // happens (e.g. user double-clicks another .md), route the file to the running
    // window instead of opening a new process.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = file_from_args(&argv) {
                if !queue_open_file_until_ready(
                    &app.state::<AppReady>().0,
                    &app.state::<LaunchFile>().0,
                    path.clone(),
                ) {
                    let _ = app.emit("open-file", path);
                }
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(WatcherState(Mutex::new(None)))
        .manage(SearchState(Arc::new(Mutex::new(HashSet::new()))))
        .manage(WorkspaceIndexState(Mutex::new(None)))
        .manage(LaunchFile(Mutex::new(initial.into_iter().collect())))
        .manage(AppReady(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            commands::path_exists,
            commands::read_file,
            commands::write_file,
            commands::write_file_if_unchanged,
            commands::publish_project_html,
            commands::pandoc_available,
            commands::publish_project_external,
            commands::save_asset,
            commands::list_dir,
            commands::load_settings,
            commands::save_settings,
            commands::watch_folder,
            commands::search,
            commands::cancel_search,
            commands::rebuild_workspace_index,
            commands::update_workspace_index,
            commands::search_workspace_index,
            commands::workspace_index_headings,
            commands::workspace_index_link_targets,
            commands::workspace_index_backlinks,
            commands::workspace_index_property_documents,
            commands::plan_path_change,
            commands::apply_path_change,
            commands::take_launch_file,
            commands::open_default_apps_settings,
            commands::delete_path,
            commands::create_file,
            commands::create_dir
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // macOS delivers file-open via the Opened event, not argv.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let p = path.to_string_lossy().to_string();
                        if !queue_open_file_until_ready(
                            &app.state::<AppReady>().0,
                            &app.state::<LaunchFile>().0,
                            p.clone(),
                        ) {
                            let _ = app.emit("open-file", p);
                        }
                    }
                }
            }
            let _ = (&app, &event);
        });
}
