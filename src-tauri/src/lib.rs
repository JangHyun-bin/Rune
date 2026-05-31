mod fs_ops;
mod commands;
mod settings;
mod search;

pub struct WatcherState(pub std::sync::Mutex<Option<notify::RecommendedWatcher>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![commands::read_file, commands::write_file, commands::save_asset, commands::list_dir, commands::load_settings, commands::save_settings, commands::watch_folder, commands::search])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
