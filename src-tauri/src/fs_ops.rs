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
}
