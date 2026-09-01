#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TargetOs {
    Windows,
    MacOs,
    Linux,
}

impl TargetOs {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            TargetOs::MacOs
        } else if cfg!(target_os = "linux") {
            TargetOs::Linux
        } else {
            TargetOs::Windows
        }
    }
}

pub struct ActionDef {
    pub id: &'static str,
    pub fallback_text: &'static str,
}

pub enum Entry {
    Action(ActionDef),
    Separator,
}

pub struct SubmenuDef {
    pub id: &'static str,
    pub fallback_text: &'static str,
    pub entries: Vec<Entry>,
}

/// Item/submenu ids are the contract with the frontend: they are the
/// `menu-action` event payload and the `set_menu_labels` map key
/// (see `src/chrome/menuLabels.ts`, Task 3). Fallback text is plain
/// English shown for the one frame before startup's `set_menu_labels`
/// call lands (see Task 4) — never the real localized text.
pub fn submenu_defs(target_os: TargetOs) -> Vec<SubmenuDef> {
    let mut file_entries = vec![
        Entry::Action(ActionDef { id: "file.newTab", fallback_text: "New Tab" }),
        Entry::Action(ActionDef { id: "file.open", fallback_text: "Open File…" }),
        Entry::Action(ActionDef { id: "file.openFolder", fallback_text: "Open Folder…" }),
        Entry::Separator,
        Entry::Action(ActionDef { id: "file.save", fallback_text: "Save" }),
        Entry::Action(ActionDef { id: "file.saveAs", fallback_text: "Save As…" }),
        Entry::Separator,
        Entry::Action(ActionDef { id: "file.exportHtml", fallback_text: "Export HTML" }),
        Entry::Action(ActionDef { id: "file.exportPdf", fallback_text: "Export PDF" }),
    ];
    if target_os != TargetOs::MacOs {
        file_entries.push(Entry::Separator);
        file_entries.push(Entry::Action(ActionDef { id: "app.quit", fallback_text: "Quit" }));
    }

    vec![
        SubmenuDef { id: "menu.file", fallback_text: "File", entries: file_entries },
        SubmenuDef {
            id: "menu.view",
            fallback_text: "View",
            entries: vec![
                Entry::Action(ActionDef { id: "view.toggleSidebar", fallback_text: "Toggle Sidebar" }),
                Entry::Action(ActionDef { id: "view.togglePanel", fallback_text: "Toggle Panel" }),
                Entry::Separator,
                Entry::Action(ActionDef { id: "view.toggleTheme", fallback_text: "Toggle Theme" }),
                Entry::Action(ActionDef { id: "view.toggleFocusMode", fallback_text: "Toggle Focus Mode" }),
            ],
        },
        SubmenuDef {
            id: "menu.help",
            fallback_text: "Help",
            entries: vec![Entry::Action(ActionDef { id: "help.help", fallback_text: "Help" })],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn action_ids(defs: &[SubmenuDef]) -> Vec<&'static str> {
        defs.iter()
            .flat_map(|s| {
                s.entries.iter().filter_map(|e| match e {
                    Entry::Action(a) => Some(a.id),
                    Entry::Separator => None,
                })
            })
            .collect()
    }

    #[test]
    fn macos_file_menu_has_no_quit_action() {
        let defs = submenu_defs(TargetOs::MacOs);
        assert!(!action_ids(&defs).contains(&"app.quit"));
    }

    #[test]
    fn windows_and_linux_file_menu_has_quit_action() {
        for os in [TargetOs::Windows, TargetOs::Linux] {
            let defs = submenu_defs(os);
            assert!(action_ids(&defs).contains(&"app.quit"), "{:?} should have Quit in File menu", os);
        }
    }

    #[test]
    fn every_platform_has_the_same_three_top_level_menus_in_order() {
        for os in [TargetOs::Windows, TargetOs::MacOs, TargetOs::Linux] {
            let titles: Vec<&str> = submenu_defs(os).iter().map(|s| s.id).collect();
            assert_eq!(titles, vec!["menu.file", "menu.view", "menu.help"], "{:?}", os);
        }
    }

    #[test]
    fn ids_are_unique_within_a_platform() {
        for os in [TargetOs::Windows, TargetOs::MacOs, TargetOs::Linux] {
            let defs = submenu_defs(os);
            let mut ids = action_ids(&defs);
            let before = ids.len();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), before, "{:?} has a duplicate menu item id", os);
        }
    }
}
