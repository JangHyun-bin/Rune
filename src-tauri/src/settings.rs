use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Option<String>,
    pub last_folder: Option<String>,
    pub open_tabs: Vec<String>,
    pub locale: Option<String>,
    pub editor_width: Option<String>,
    pub sidebar_width: Option<u16>,
}

pub fn load(path: &PathBuf) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &PathBuf, s: &Settings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_default() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        assert_eq!(load(&p).theme, None);
        assert_eq!(load(&p).editor_width, None);
        assert_eq!(load(&p).sidebar_width, None);
        let s = Settings {
            theme: Some("dark".into()),
            last_folder: Some("/w".into()),
            open_tabs: vec!["/w/a.md".into()],
            locale: None,
            editor_width: Some("wide".into()),
            sidebar_width: Some(320),
        };
        save(&p, &s).unwrap();
        let got = load(&p);
        assert_eq!(got.theme.as_deref(), Some("dark"));
        assert_eq!(got.open_tabs, vec!["/w/a.md".to_string()]);
        assert_eq!(got.editor_width.as_deref(), Some("wide"));
        assert_eq!(got.sidebar_width, Some(320));
    }
}
