use crate::fs_ops;
use std::path::PathBuf;

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs_ops::read_text_file(&PathBuf::from(path))
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    fs_ops::write_text_file_atomic(&PathBuf::from(path), &contents)
}
