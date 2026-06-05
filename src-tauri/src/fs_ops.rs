use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// UTF-8 텍스트 파일을 읽는다.
pub fn read_text_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read failed '{}': {e}", path.display()))
}

/// 원자적 쓰기: 같은 디렉토리에 temp로 쓰고 fsync 후 rename.
/// 쓰기/동기화가 실패하면 temp 파일을 best-effort로 정리한다.
pub fn write_text_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = temp_sibling(path)?;
    let write_result = (|| -> Result<(), String> {
        let mut f = fs::File::create(&tmp)
            .map_err(|e| format!("create temp failed '{}': {e}", tmp.display()))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| format!("write temp failed '{}': {e}", tmp.display()))?;
        f.sync_all()
            .map_err(|e| format!("sync failed '{}': {e}", tmp.display()))?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&tmp); // best-effort cleanup; ignore secondary error
    }
    write_result?;
    fs::rename(&tmp, path)
        .map_err(|e| format!("rename failed '{}' -> '{}': {e}", tmp.display(), path.display()))
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = temp_sibling(path)?;
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create temp failed '{}': {e}", tmp.display()))?;
        f.write_all(bytes).map_err(|e| format!("write temp failed '{}': {e}", tmp.display()))?;
        f.sync_all().map_err(|e| format!("sync failed '{}': {e}", tmp.display()))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename failed: {e}"))
}

/// 바이트를 <doc_dir>/assets/<sha256>.<ext> 에 저장하고 "assets/<name>" 반환.
pub fn save_asset(doc_dir: &Path, bytes: &[u8], ext: &str) -> Result<String, String> {
    let assets = doc_dir.join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("create assets dir failed: {e}"))?;
    let mut h = Sha256::new();
    h.update(bytes);
    let digest = h.finalize();
    let hash: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    let safe_ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let name = if safe_ext.is_empty() { hash } else { format!("{hash}.{safe_ext}") };
    let path = assets.join(&name);
    if !path.exists() { write_bytes_atomic(&path, bytes)?; }
    Ok(format!("assets/{name}"))
}

/// 대상 파일과 같은 디렉토리의 `.<name>.tmp` 경로를 만든다.
fn temp_sibling(path: &Path) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("invalid path: {}", path.display()))?;
    let mut p = path.to_path_buf();
    p.set_file_name(format!(".{name}.tmp"));
    Ok(p)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

const IGNORE: &[&str] = &[".git", "node_modules", "target", ".superpowers"];

/// 폴더 재귀 스캔. dir 먼저·이름 오름차순, .md/.markdown 파일만(+ 비무시 디렉토리). depth 제한.
pub fn scan_dir(root: &Path, depth: usize) -> Vec<FileNode> {
    if depth > 12 { return vec![]; }
    let mut dirs: Vec<FileNode> = vec![];
    let mut files: Vec<FileNode> = vec![];
    let Ok(entries) = fs::read_dir(root) else { return vec![]; };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || IGNORE.contains(&name.as_str()) { continue; }
        let path = e.path();
        let p = path.to_string_lossy().to_string();
        if path.is_dir() {
            dirs.push(FileNode { name, path: p, is_dir: true, children: scan_dir(&path, depth + 1) });
        } else if matches!(path.extension().and_then(|x| x.to_str()), Some("md") | Some("markdown")) {
            files.push(FileNode { name, path: p, is_dir: false, children: vec![] });
        }
    }
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.into_iter().chain(files).collect()
}

/// dir/<name> 검증: 빈 이름·경로구분자·상위참조 금지.
fn safe_child(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("name is empty".into());
    }
    if n.contains('/') || n.contains('\\') || n == "." || n == ".." {
        return Err("name may not contain path separators".into());
    }
    Ok(dir.join(n))
}

/// path를 같은 폴더 안에서 new_name으로 이름 변경. 대상이 이미 있으면 에러.
pub fn rename(path: &Path, new_name: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("path has no parent folder")?;
    let target = safe_child(parent, new_name)?;
    if target.exists() {
        return Err(format!("already exists: {}", target.display()));
    }
    fs::rename(path, &target).map_err(|e| format!("rename failed: {e}"))
}

/// dir 안에 빈 파일 생성. 새 경로 반환.
pub fn create_file(dir: &Path, name: &str) -> Result<String, String> {
    let target = safe_child(dir, name)?;
    if target.exists() {
        return Err(format!("already exists: {}", target.display()));
    }
    fs::File::create(&target).map_err(|e| format!("create file failed: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// dir 안에 폴더 생성. 새 경로 반환.
pub fn create_dir(dir: &Path, name: &str) -> Result<String, String> {
    let target = safe_child(dir, name)?;
    if target.exists() {
        return Err(format!("already exists: {}", target.display()));
    }
    fs::create_dir(&target).map_err(|e| format!("create dir failed: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// path를 OS 휴지통으로 이동(되돌릴 수 있음).
pub fn delete_to_trash(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| format!("delete failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_write_then_read() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        write_text_file_atomic(&file, "# Hello\n").unwrap();
        assert_eq!(read_text_file(&file).unwrap(), "# Hello\n");
    }

    #[test]
    fn atomic_write_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        write_text_file_atomic(&file, "v1").unwrap();
        write_text_file_atomic(&file, "v2 longer").unwrap();
        assert_eq!(read_text_file(&file).unwrap(), "v2 longer");
    }

    #[test]
    fn read_missing_file_is_err() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nope.md");
        assert!(read_text_file(&file).is_err());
    }

    #[test]
    fn write_to_missing_parent_dir_is_err_and_leaves_no_temp() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("no_such_subdir").join("note.md");
        assert!(write_text_file_atomic(&file, "x").is_err());
        let tmp = dir.path().join("no_such_subdir").join(".note.md.tmp");
        assert!(!tmp.exists());
    }

    #[test]
    fn roundtrip_utf8_cjk() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("한글.md");
        let content = "# 안녕하세요\n世界 🌍\n";
        write_text_file_atomic(&file, content).unwrap();
        assert_eq!(read_text_file(&file).unwrap(), content);
    }

    #[test]
    fn save_asset_writes_hashed_file_and_returns_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"\x89PNG fake image";
        let rel = save_asset(dir.path(), bytes, "png").unwrap();
        assert!(rel.starts_with("assets/") && rel.ends_with(".png"));
        assert!(dir.path().join(&rel).exists());
    }

    #[test]
    fn save_asset_is_idempotent_for_same_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let b = b"same";
        let a1 = save_asset(dir.path(), b, "png").unwrap();
        let a2 = save_asset(dir.path(), b, "png").unwrap();
        assert_eq!(a1, a2);
    }

    #[test]
    fn rename_moves_within_parent() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.md");
        std::fs::write(&a, "x").unwrap();
        rename(&a, "b.md").unwrap();
        assert!(!a.exists());
        assert!(dir.path().join("b.md").exists());
    }

    #[test]
    fn rename_to_existing_is_err() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        std::fs::write(dir.path().join("b.md"), "y").unwrap();
        assert!(rename(&dir.path().join("a.md"), "b.md").is_err());
    }

    #[test]
    fn create_file_makes_empty_and_returns_path() {
        let dir = tempfile::tempdir().unwrap();
        let p = create_file(dir.path(), "note.md").unwrap();
        assert!(std::path::Path::new(&p).exists());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "");
    }

    #[test]
    fn create_dir_makes_dir() {
        let dir = tempfile::tempdir().unwrap();
        let p = create_dir(dir.path(), "sub").unwrap();
        assert!(std::path::Path::new(&p).is_dir());
    }

    #[test]
    fn names_with_separators_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(create_file(dir.path(), "a/b.md").is_err());
        assert!(create_file(dir.path(), "..").is_err());
        assert!(create_file(dir.path(), "").is_err());
        assert!(create_dir(dir.path(), "a\\b").is_err());
    }

    #[test]
    fn scan_dir_lists_md_and_subdirs_sorted() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("b.md"), "b").unwrap();
        std::fs::write(dir.path().join("a.md"), "a").unwrap();
        std::fs::write(dir.path().join("ignore.txt"), "x").unwrap();
        std::fs::write(dir.path().join("sub").join("c.md"), "c").unwrap();
        let nodes = scan_dir(dir.path(), 0);
        assert_eq!(nodes.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), vec!["sub", "a.md", "b.md"]);
        let sub = &nodes[0];
        assert!(sub.is_dir && sub.children.len() == 1 && sub.children[0].name == "c.md");
    }
}
