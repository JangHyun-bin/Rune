mod fs_ops;
mod commands;
mod settings;
mod search;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub struct WatcherState(pub Mutex<Option<notify::RecommendedWatcher>>);
/// A file path Rune was launched with (double-clicked .md via file association),
/// pending until the frontend is ready to open it.
pub struct LaunchFile(pub Mutex<Option<String>>);

/// First CLI argument that is an existing file (skips the exe path and any flags).
/// This is how a double-clicked file arrives on Windows/Linux.
fn file_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && std::path::Path::new(a.as_str()).is_file())
        .cloned()
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
                let _ = app.emit("open-file", path);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .manage(LaunchFile(Mutex::new(initial)))
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::save_asset,
            commands::list_dir,
            commands::load_settings,
            commands::save_settings,
            commands::watch_folder,
            commands::search,
            commands::take_launch_file,
            commands::open_default_apps_settings
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            // macOS delivers file-open via the Opened event, not argv.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let _ = app.emit("open-file", path.to_string_lossy().to_string());
                    }
                }
            }
            let _ = (&app, &event);
        });
}
