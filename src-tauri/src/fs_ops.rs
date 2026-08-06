use serde::{Deserialize, Serialize};
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

/// 현재 UTF-8 내용이 기대한 스냅샷과 같을 때만 원자적으로 저장한다.
pub fn write_text_file_if_unchanged(
    path: &Path,
    expected_contents: Option<&str>,
    contents: &str,
) -> Result<bool, String> {
    let current = match fs::read_to_string(path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("read failed '{}': {error}", path.display())),
    };
    if current.as_deref() != expected_contents {
        return Ok(false);
    }
    write_text_file_atomic(path, contents)?;
    Ok(true)
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

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublishAsset {
    pub source_path: String,
    pub relative_path: String,
}

const PUBLICATION_MARKER: &str = ".rune-publication";

pub(crate) fn safe_relative_asset_path(path: &str) -> Result<PathBuf, String> {
    let value = Path::new(path);
    if value.is_absolute()
        || value.components().any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("invalid publish asset path: {path}"));
    }
    Ok(value.to_path_buf())
}

pub(crate) fn validate_publish_output(
    root: &Path,
    path: &Path,
    extensions: &[&str],
    protected_paths: &[String],
) -> Result<PathBuf, String> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| extensions.iter().any(|extension| value.eq_ignore_ascii_case(extension)))
    {
        return Err(format!(
            "publish output must use one of these extensions: {}",
            extensions.iter().map(|value| format!(".{value}")).collect::<Vec<_>>().join(", ")
        ));
    }
    let parent = path.parent().ok_or_else(|| format!("invalid publish path: {}", path.display()))?;
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("resolve workspace root failed '{}': {error}", root.display()))?;
    let mut existing_parent = parent;
    while !existing_parent.exists() {
        existing_parent = existing_parent.parent()
            .ok_or_else(|| format!("publish path is outside workspace: {}", path.display()))?;
    }
    let canonical_existing_parent = fs::canonicalize(existing_parent)
        .map_err(|error| format!("resolve publish directory failed '{}': {error}", existing_parent.display()))?;
    if !canonical_existing_parent.starts_with(&canonical_root) {
        return Err(format!("publish path is outside workspace: {}", path.display()));
    }
    if path.exists() {
        let metadata = fs::symlink_metadata(path)
            .map_err(|error| format!("inspect publish output failed '{}': {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("publish output may not be a symlink: {}", path.display()));
        }
        let canonical_output = fs::canonicalize(path)
            .map_err(|error| format!("resolve publish output failed '{}': {error}", path.display()))?;
        for protected in protected_paths {
            if fs::canonicalize(protected).is_ok_and(|source| source == canonical_output) {
                return Err(format!("publish output would overwrite a source file: {}", path.display()));
            }
        }
    }
    fs::create_dir_all(parent).map_err(|error| format!("create publish directory failed '{}': {error}", parent.display()))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("resolve publish directory failed '{}': {error}", parent.display()))?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(format!("publish path is outside workspace: {}", path.display()));
    }
    Ok(canonical_root)
}

/// HTML과 복사된 asset 디렉터리를 한 publication 단위로 교체한다.
/// asset 준비가 실패하면 기존 HTML과 asset은 그대로 남는다.
pub fn publish_html(
    root: &Path,
    path: &Path,
    contents: &str,
    assets: &[PublishAsset],
    protected_paths: &[String],
) -> Result<(), String> {
    let canonical_root = validate_publish_output(root, path, &["html"], protected_paths)?;
    let parent = path.parent().ok_or_else(|| format!("invalid publish path: {}", path.display()))?;
    let stem = path.file_stem().and_then(|value| value.to_str()).filter(|value| !value.is_empty())
        .ok_or_else(|| format!("invalid publish filename: {}", path.display()))?;
    let target_assets = parent.join(format!("{stem}.assets"));
    let staged_assets = parent.join(format!(".{stem}.assets.tmp"));
    let backup_assets = parent.join(format!(".{stem}.assets.backup"));

    if target_assets.exists() {
        let metadata = fs::symlink_metadata(&target_assets)
            .map_err(|error| format!("inspect publish assets failed '{}': {error}", target_assets.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("publish assets may not be a symlink: {}", target_assets.display()));
        }
        if !metadata.is_dir()
            || !fs::read_to_string(target_assets.join(PUBLICATION_MARKER))
                .is_ok_and(|value| value == "Rune project assets\n")
        {
            return Err(format!(
                "publish assets would replace an unmanaged path: {}",
                target_assets.display()
            ));
        }
        let canonical_assets = fs::canonicalize(&target_assets)
            .map_err(|error| format!("resolve publish assets failed '{}': {error}", target_assets.display()))?;
        let protected_source = protected_paths.iter()
            .filter_map(|protected| fs::canonicalize(protected).ok())
            .chain(assets.iter().filter_map(|asset| fs::canonicalize(&asset.source_path).ok()))
            .find(|source| source.starts_with(&canonical_assets));
        if let Some(source) = protected_source {
            return Err(format!(
                "publish assets would replace a source file: {}",
                source.display()
            ));
        }
    }

    if backup_assets.exists() && !target_assets.exists() {
        fs::rename(&backup_assets, &target_assets)
            .map_err(|error| format!("restore interrupted publish failed: {error}"))?;
    }
    if backup_assets.exists() {
        return Err(format!("publish backup already exists: {}", backup_assets.display()));
    }
    if staged_assets.exists() {
        fs::remove_dir_all(&staged_assets)
            .map_err(|error| format!("remove stale publish staging failed: {error}"))?;
    }

    if !assets.is_empty() {
        fs::create_dir(&staged_assets)
            .map_err(|error| format!("create publish staging failed '{}': {error}", staged_assets.display()))?;
        let staged = (|| -> Result<(), String> {
            fs::write(staged_assets.join(PUBLICATION_MARKER), "Rune project assets\n")
                .map_err(|error| format!("write publish marker failed: {error}"))?;
            for asset in assets {
                let relative = safe_relative_asset_path(&asset.relative_path)?;
                let source = Path::new(&asset.source_path);
                if !source.is_file() {
                    return Err(format!("publish asset is not a readable file: {}", source.display()));
                }
                let canonical_source = fs::canonicalize(source)
                    .map_err(|error| format!("resolve publish asset failed '{}': {error}", source.display()))?;
                if !canonical_source.starts_with(&canonical_root) {
                    return Err(format!("publish asset is outside workspace: {}", source.display()));
                }
                let target = staged_assets.join(relative);
                if let Some(directory) = target.parent() {
                    fs::create_dir_all(directory)
                        .map_err(|error| format!("create publish asset directory failed '{}': {error}", directory.display()))?;
                }
                fs::copy(source, &target)
                    .map_err(|error| format!("copy publish asset failed '{}' -> '{}': {error}", source.display(), target.display()))?;
            }
            Ok(())
        })();
        if let Err(error) = staged {
            let _ = fs::remove_dir_all(&staged_assets);
            return Err(error);
        }
    }

    if target_assets.exists() {
        fs::rename(&target_assets, &backup_assets)
            .map_err(|error| format!("backup previous publish assets failed: {error}"))?;
    }
    if !assets.is_empty() {
        if let Err(error) = fs::rename(&staged_assets, &target_assets) {
            if backup_assets.exists() {
                let _ = fs::rename(&backup_assets, &target_assets);
            }
            return Err(format!("promote publish assets failed: {error}"));
        }
    }

    if let Err(error) = write_text_file_atomic(path, contents) {
        if target_assets.exists() {
            let _ = fs::remove_dir_all(&target_assets);
        }
        if backup_assets.exists() {
            let _ = fs::rename(&backup_assets, &target_assets);
        }
        return Err(error);
    }
    if backup_assets.exists() {
        fs::remove_dir_all(&backup_assets)
            .map_err(|error| format!("remove previous publish assets failed: {error}"))?;
    }
    Ok(())
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
    fn conditional_write_saves_only_when_source_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("project.json");
        write_text_file_atomic(&file, "original").unwrap();

        assert!(write_text_file_if_unchanged(&file, Some("original"), "saved").unwrap());
        assert_eq!(read_text_file(&file).unwrap(), "saved");

        write_text_file_atomic(&file, "external").unwrap();
        assert!(!write_text_file_if_unchanged(&file, Some("saved"), "lost").unwrap());
        assert_eq!(read_text_file(&file).unwrap(), "external");
    }

    #[test]
    fn conditional_write_detects_creation_and_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("project.json");

        assert!(write_text_file_if_unchanged(&file, None, "created").unwrap());
        assert!(!write_text_file_if_unchanged(&file, None, "overwritten").unwrap());
        assert_eq!(read_text_file(&file).unwrap(), "created");

        fs::remove_file(&file).unwrap();
        assert!(!write_text_file_if_unchanged(&file, Some("created"), "recreated").unwrap());
        assert!(!file.exists());
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
    fn publish_html_copies_assets_and_replaces_the_previous_publication() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("cover.png");
        fs::write(&source, b"png bytes").unwrap();
        let output = dir.path().join("dist").join("Book.html");

        publish_html(dir.path(), &output, "first", &[PublishAsset {
            source_path: source.to_string_lossy().into_owned(),
            relative_path: "doc-1/cover.png".into(),
        }], &[]).unwrap();

        assert_eq!(fs::read_to_string(&output).unwrap(), "first");
        assert_eq!(fs::read(output.parent().unwrap().join("Book.assets/doc-1/cover.png")).unwrap(), b"png bytes");

        publish_html(dir.path(), &output, "second", &[], &[]).unwrap();
        assert_eq!(fs::read_to_string(&output).unwrap(), "second");
        assert!(!output.parent().unwrap().join("Book.assets").exists());
    }

    #[test]
    fn publish_html_keeps_the_previous_publication_when_asset_staging_fails() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("Book.html");
        fs::write(&output, "original").unwrap();
        fs::create_dir(dir.path().join("Book.assets")).unwrap();
        fs::write(dir.path().join("Book.assets/keep.txt"), "keep").unwrap();

        let result = publish_html(dir.path(), &output, "replacement", &[PublishAsset {
            source_path: dir.path().join("missing.png").to_string_lossy().into_owned(),
            relative_path: "doc-1/missing.png".into(),
        }], &[]);

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&output).unwrap(), "original");
        assert_eq!(fs::read_to_string(dir.path().join("Book.assets/keep.txt")).unwrap(), "keep");
    }

    #[test]
    fn publish_html_rejects_unsafe_asset_destinations() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("asset.bin");
        fs::write(&source, "asset").unwrap();
        let result = publish_html(dir.path(), &dir.path().join("Book.html"), "html", &[PublishAsset {
            source_path: source.to_string_lossy().into_owned(),
            relative_path: "../escape.bin".into(),
        }], &[]);
        assert!(result.is_err());
        assert!(!dir.path().join("escape.bin").exists());
    }

    #[test]
    fn publish_html_rejects_assets_and_outputs_outside_the_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source = outside.path().join("secret.png");
        fs::write(&source, "secret").unwrap();
        let asset_result = publish_html(workspace.path(), &workspace.path().join("Book.html"), "html", &[PublishAsset {
            source_path: source.to_string_lossy().into_owned(),
            relative_path: "doc-1/secret.png".into(),
        }], &[]);
        let output_result = publish_html(workspace.path(), &outside.path().join("Book.html"), "html", &[], &[]);

        assert!(asset_result.is_err());
        assert!(output_result.is_err());
        assert!(!outside.path().join("Book.html").exists());
    }

    #[test]
    fn publish_html_rejects_an_asset_directory_containing_source_files() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("Book.html");
        let assets = dir.path().join("Book.assets");
        fs::create_dir(&assets).unwrap();
        fs::write(assets.join(PUBLICATION_MARKER), "Rune project assets\n").unwrap();
        let document = assets.join("chapter.md");
        let image = assets.join("cover.png");
        fs::write(&document, "# Chapter").unwrap();
        fs::write(&image, "image").unwrap();

        let document_result = publish_html(
            dir.path(),
            &output,
            "replacement",
            &[],
            &[document.to_string_lossy().into_owned()],
        );
        let image_result = publish_html(
            dir.path(),
            &output,
            "replacement",
            &[PublishAsset {
                source_path: image.to_string_lossy().into_owned(),
                relative_path: "doc-1/cover.png".into(),
            }],
            &[],
        );

        assert!(document_result.is_err());
        assert!(image_result.is_err());
        assert_eq!(fs::read_to_string(document).unwrap(), "# Chapter");
        assert_eq!(fs::read_to_string(image).unwrap(), "image");
        assert!(!output.exists());
    }

    #[test]
    fn publish_html_does_not_replace_an_unmanaged_asset_path() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("Book.html");
        let assets = dir.path().join("Book.assets");
        fs::create_dir(&assets).unwrap();
        let user_file = assets.join("notes.txt");
        fs::write(&user_file, "keep").unwrap();

        let result = publish_html(dir.path(), &output, "replacement", &[], &[]);

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(user_file).unwrap(), "keep");
        assert!(!output.exists());
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
