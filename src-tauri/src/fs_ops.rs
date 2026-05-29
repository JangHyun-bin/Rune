use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// UTF-8 텍스트 파일을 읽는다.
pub fn read_text_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read failed: {e}"))
}

/// 원자적 쓰기: 같은 디렉토리에 temp로 쓰고 fsync 후 rename.
pub fn write_text_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = temp_sibling(path);
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create temp failed: {e}"))?;
        f.write_all(contents.as_bytes()).map_err(|e| format!("write temp failed: {e}"))?;
        f.sync_all().map_err(|e| format!("sync failed: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

fn temp_sibling(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let mut p = path.to_path_buf();
    p.set_file_name(format!(".{name}.tmp"));
    p
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
}
