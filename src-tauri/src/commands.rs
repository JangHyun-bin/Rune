use crate::fs_ops;
use std::path::{Path, PathBuf};

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs_ops::read_text_file(&PathBuf::from(path))
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
