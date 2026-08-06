use crate::fs_ops::{self, PublishAsset};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static PUBLISH_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub fn pandoc_available() -> bool {
    Command::new("pandoc")
        .arg("--version")
        .output()
        .is_ok_and(|output| output.status.success())
}

pub fn publish_with_pandoc(
    root: &Path,
    path: &Path,
    html: &str,
    assets: &[PublishAsset],
    protected_paths: &[String],
) -> Result<(), String> {
    publish_external_with(root, path, html, assets, protected_paths, run_pandoc)
}

fn run_pandoc(input: &Path, output: &Path, format: &str) -> Result<(), String> {
    let result = Command::new("pandoc")
        .current_dir(input.parent().ok_or("Pandoc input has no parent directory")?)
        .arg(input)
        .arg("--from=html")
        .arg(format!("--to={format}"))
        .arg("--output")
        .arg(output)
        .output();
    let result = match result {
        Ok(result) => result,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Err("Pandoc is not installed or is not available on PATH.".into());
        }
        Err(error) => return Err(format!("start Pandoc failed: {error}")),
    };
    if result.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("Pandoc conversion failed with status {}", result.status)
    } else {
        format!("Pandoc conversion failed: {stderr}")
    })
}

fn publish_external_with<F>(
    root: &Path,
    path: &Path,
    html: &str,
    assets: &[PublishAsset],
    protected_paths: &[String],
    converter: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path, &str) -> Result<(), String>,
{
    let canonical_root = fs_ops::validate_publish_output(root, path, &["docx", "epub"], protected_paths)?;
    let parent = path.parent().ok_or_else(|| format!("invalid publish path: {}", path.display()))?;
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("invalid publish filename: {}", path.display()))?;
    let format = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| format!("invalid publish filename: {}", path.display()))?;
    let sequence = PUBLISH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let transient = format!(".rune-pandoc-{stem}-{}-{sequence}", std::process::id());
    let staging = parent.join(format!("{transient}.input"));
    let temporary = parent.join(format!("{transient}.output"));
    let backup = parent.join(format!("{transient}.backup"));

    fs::create_dir(&staging)
        .map_err(|error| format!("create Pandoc staging failed '{}': {error}", staging.display()))?;
    let result = (|| -> Result<(), String> {
        let input = staging.join("input.html");
        fs::write(&input, html)
            .map_err(|error| format!("write Pandoc input failed '{}': {error}", input.display()))?;
        let asset_root = staging.join(format!("{stem}.assets"));
        for asset in assets {
            let relative = fs_ops::safe_relative_asset_path(&asset.relative_path)?;
            let source = Path::new(&asset.source_path);
            if !source.is_file() {
                return Err(format!("publish asset is not a readable file: {}", source.display()));
            }
            let canonical_source = fs::canonicalize(source)
                .map_err(|error| format!("resolve publish asset failed '{}': {error}", source.display()))?;
            if !canonical_source.starts_with(&canonical_root) {
                return Err(format!("publish asset is outside workspace: {}", source.display()));
            }
            let target = asset_root.join(relative);
            if let Some(directory) = target.parent() {
                fs::create_dir_all(directory).map_err(|error| {
                    format!("create Pandoc asset directory failed '{}': {error}", directory.display())
                })?;
            }
            fs::copy(source, &target).map_err(|error| {
                format!("copy Pandoc asset failed '{}' -> '{}': {error}", source.display(), target.display())
            })?;
        }

        converter(&input, &temporary, &format)?;
        let output_metadata = fs::metadata(&temporary)
            .map_err(|error| format!("Pandoc did not create an output file: {error}"))?;
        if !output_metadata.is_file() || output_metadata.len() == 0 {
            return Err("Pandoc created an empty output file.".into());
        }

        if path.exists() {
            fs::rename(path, &backup)
                .map_err(|error| format!("backup previous publication failed: {error}"))?;
        }
        if let Err(error) = fs::rename(&temporary, path) {
            if backup.exists() {
                fs::rename(&backup, path)
                    .map_err(|restore| format!("promote Pandoc output failed: {error}; restore failed: {restore}"))?;
            }
            return Err(format!("promote Pandoc output failed: {error}"));
        }
        if backup.exists() {
            fs::remove_file(&backup)
                .map_err(|error| format!("remove previous publication backup failed: {error}"))?;
        }
        Ok(())
    })();

    let _ = fs::remove_file(&temporary);
    let _ = fs::remove_dir_all(&staging);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs_ops::PublishAsset;
    use std::fs;

    fn transient_paths(directory: &std::path::Path) -> Vec<String> {
        fs::read_dir(directory)
            .unwrap()
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.contains(".rune-pandoc-"))
            .collect()
    }

    #[test]
    fn successful_conversion_atomically_replaces_the_previous_output() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("Book.docx");
        fs::write(&output, b"old").unwrap();

        publish_external_with(dir.path(), &output, "<h1>Book</h1>", &[], &[], |input, target, format| {
            assert_eq!(fs::read_to_string(input).unwrap(), "<h1>Book</h1>");
            assert_eq!(format, "docx");
            fs::write(target, b"new").map_err(|error| error.to_string())
        })
        .unwrap();

        assert_eq!(fs::read(&output).unwrap(), b"new");
        assert!(transient_paths(dir.path()).is_empty());
    }

    #[test]
    fn failed_conversion_preserves_the_previous_output() {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("Book.epub");
        fs::write(&output, b"old").unwrap();

        let result = publish_external_with(dir.path(), &output, "<h1>Book</h1>", &[], &[], |_, _, _| {
            Err("conversion failed".into())
        });

        assert_eq!(result.unwrap_err(), "conversion failed");
        assert_eq!(fs::read(&output).unwrap(), b"old");
        assert!(transient_paths(dir.path()).is_empty());
    }

    #[test]
    fn external_publish_rejects_outputs_outside_the_workspace_and_source_overwrites() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source = workspace.path().join("chapter.docx");
        fs::write(&source, b"source").unwrap();

        let outside_result = publish_external_with(
            workspace.path(),
            &outside.path().join("Book.docx"),
            "html",
            &[],
            &[],
            |_, _, _| panic!("converter must not run"),
        );
        let source_result = publish_external_with(
            workspace.path(),
            &source,
            "html",
            &[],
            &[source.to_string_lossy().into_owned()],
            |_, _, _| panic!("converter must not run"),
        );

        assert!(outside_result.is_err());
        assert!(source_result.is_err());
        assert_eq!(fs::read(&source).unwrap(), b"source");
    }

    #[test]
    fn external_publish_stages_assets_under_the_output_stem() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("cover.png");
        let output = dir.path().join("exports").join("Book.epub");
        fs::write(&source, b"image").unwrap();
        let assets = [PublishAsset {
            source_path: source.to_string_lossy().into_owned(),
            relative_path: "doc-1/cover.png".into(),
        }];

        publish_external_with(
            dir.path(),
            &output,
            r#"<img src="Book.assets/doc-1/cover.png">"#,
            &assets,
            &[],
            |input, target, format| {
                assert_eq!(format, "epub");
                assert!(fs::read_to_string(input).unwrap().contains("Book.assets/doc-1/cover.png"));
                assert_eq!(fs::read(input.parent().unwrap().join("Book.assets/doc-1/cover.png")).unwrap(), b"image");
                fs::write(target, b"epub").map_err(|error| error.to_string())
            },
        )
        .unwrap();

        assert_eq!(fs::read(&output).unwrap(), b"epub");
        assert!(transient_paths(output.parent().unwrap()).is_empty());
    }
}
