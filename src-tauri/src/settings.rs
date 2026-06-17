use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LayoutSettings {
    pub sidebar_width: Option<u16>,
    pub outline_height: Option<u16>,
    pub split_ratio: Option<f32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PaneLayoutNode {
    Pane {
        #[serde(rename = "paneId")]
        pane_id: String,
    },
    Split {
        direction: String,
        children: Vec<PaneLayoutNode>,
        ratios: Vec<f32>,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PaneSnapshot {
    pub id: String,
    pub open_tabs: Vec<String>,
    pub active_path: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PaneWorkspaceSnapshot {
    pub version: u8,
    pub root: PaneLayoutNode,
    pub active_pane_id: String,
    pub panes: Vec<PaneSnapshot>,
}

fn deserialize_pane_layout_lossy<'de, D>(
    deserializer: D,
) -> Result<Option<PaneWorkspaceSnapshot>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(value.and_then(|value| serde_json::from_value(value).ok()))
}

#[derive(Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: Option<String>,
    pub last_folder: Option<String>,
    pub open_tabs: Vec<String>,
    pub locale: Option<String>,
    pub editor_width: Option<String>,
    pub editor_mode: Option<String>,
    pub sidebar_width: Option<u16>,
    pub layout: Option<LayoutSettings>,
    #[serde(default, deserialize_with = "deserialize_pane_layout_lossy")]
    pub pane_layout: Option<PaneWorkspaceSnapshot>,
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
        assert!(load(&p).layout.is_none());
        assert!(load(&p).pane_layout.is_none());
        std::fs::write(
            &p,
            r#"{"theme":"light","openTabs":["/w/legacy.md"],"layout":{"sidebarWidth":280}}"#,
        )
        .unwrap();
        let legacy = load(&p);
        assert_eq!(legacy.open_tabs, vec!["/w/legacy.md".to_string()]);
        assert!(legacy.pane_layout.is_none());
        let s = Settings {
            theme: Some("dark".into()),
            last_folder: Some("/w".into()),
            open_tabs: vec!["/w/a.md".into()],
            locale: None,
            editor_width: Some("wide".into()),
            editor_mode: Some("source".into()),
            sidebar_width: Some(320),
            layout: Some(LayoutSettings {
                sidebar_width: Some(330),
                outline_height: Some(180),
                split_ratio: Some(0.6),
            }),
            pane_layout: Some(PaneWorkspaceSnapshot {
                version: 1,
                root: PaneLayoutNode::Split {
                    direction: "row".into(),
                    children: vec![
                        PaneLayoutNode::Pane {
                            pane_id: "pane-1".into(),
                        },
                        PaneLayoutNode::Pane {
                            pane_id: "pane-2".into(),
                        },
                    ],
                    ratios: vec![0.4, 0.6],
                },
                active_pane_id: "pane-2".into(),
                panes: vec![
                    PaneSnapshot {
                        id: "pane-1".into(),
                        open_tabs: vec!["/w/a.md".into()],
                        active_path: Some("/w/a.md".into()),
                    },
                    PaneSnapshot {
                        id: "pane-2".into(),
                        open_tabs: vec!["/w/b.md".into()],
                        active_path: Some("/w/b.md".into()),
                    },
                ],
            }),
        };
        save(&p, &s).unwrap();
        let raw_json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(
            raw_json["paneLayout"]["root"]["children"][0]["paneId"],
            serde_json::json!("pane-1")
        );
        assert_eq!(raw_json["paneLayout"]["activePaneId"], serde_json::json!("pane-2"));
        assert_eq!(
            raw_json["paneLayout"]["panes"][0]["openTabs"][0],
            serde_json::json!("/w/a.md")
        );
        let got = load(&p);
        assert_eq!(got.theme.as_deref(), Some("dark"));
        assert_eq!(got.open_tabs, vec!["/w/a.md".to_string()]);
        assert_eq!(got.editor_width.as_deref(), Some("wide"));
        assert_eq!(got.editor_mode.as_deref(), Some("source"));
        assert_eq!(got.sidebar_width, Some(320));
        let layout = got.layout.unwrap();
        assert_eq!(layout.sidebar_width, Some(330));
        assert_eq!(layout.outline_height, Some(180));
        assert_eq!(layout.split_ratio, Some(0.6));
        let pane_layout = got.pane_layout.unwrap();
        assert_eq!(pane_layout.version, 1);
        assert_eq!(pane_layout.active_pane_id, "pane-2");
        assert_eq!(pane_layout.panes.len(), 2);
        match pane_layout.root {
            PaneLayoutNode::Split {
                direction,
                children,
                ratios,
            } => {
                assert_eq!(direction, "row");
                assert_eq!(children.len(), 2);
                assert_eq!(ratios, vec![0.4, 0.6]);
            }
            PaneLayoutNode::Pane { .. } => panic!("expected split pane layout"),
        }
    }

    #[test]
    fn malformed_pane_layout_preserves_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(
            &p,
            r#"{
                "theme": "dark",
                "openTabs": ["/w/a.md"],
                "layout": { "sidebarWidth": 280, "splitRatio": 0.6 },
                "paneLayout": {
                    "version": 1,
                    "root": { "type": "pane", "paneId": 42 },
                    "activePaneId": "pane-1",
                    "panes": []
                }
            }"#,
        )
        .unwrap();

        let got = load(&p);
        assert_eq!(got.theme.as_deref(), Some("dark"));
        assert_eq!(got.open_tabs, vec!["/w/a.md".to_string()]);
        let layout = got.layout.unwrap();
        assert_eq!(layout.sidebar_width, Some(280));
        assert_eq!(layout.split_ratio, Some(0.6));
        assert!(got.pane_layout.is_none());
    }
}
