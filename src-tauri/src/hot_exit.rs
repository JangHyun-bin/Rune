use serde_json::Value;
use std::path::Path;

pub fn load(path: &Path) -> Result<Option<Value>, String> {
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "read Hot Exit recovery failed '{}': {error}",
                path.display()
            ))
        }
    };
    Ok(serde_json::from_str(&source).ok())
}

pub fn save(path: &Path, snapshot: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create Hot Exit directory failed '{}': {error}",
                parent.display()
            )
        })?;
    }
    let source = serde_json::to_string(snapshot)
        .map_err(|error| format!("serialize Hot Exit recovery failed: {error}"))?;
    crate::fs_ops::write_text_file_atomic(path, &source)
}

pub fn clear(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "clear Hot Exit recovery failed '{}': {error}",
            path.display()
        )),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn roundtrips_and_atomically_replaces_a_recovery_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hot-exit.json");

        super::save(&path, &json!({ "version": 1, "value": "first" })).unwrap();
        super::save(&path, &json!({ "version": 1, "value": "second" })).unwrap();

        assert_eq!(
            super::load(&path).unwrap(),
            Some(json!({ "version": 1, "value": "second" }))
        );
        assert!(!dir.path().join(".hot-exit.json.tmp").exists());
    }

    #[test]
    fn malformed_recovery_is_ignored_without_deleting_the_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hot-exit.json");
        std::fs::write(&path, "{not-json").unwrap();

        assert_eq!(super::load(&path).unwrap(), None);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{not-json");
    }

    #[test]
    fn clear_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hot-exit.json");
        std::fs::write(&path, "{}").unwrap();

        super::clear(&path).unwrap();
        super::clear(&path).unwrap();

        assert!(!path.exists());
    }
}
