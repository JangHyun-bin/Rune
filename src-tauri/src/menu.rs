use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{
    AboutMetadata, AboutMetadataBuilder, IsMenuItem, Menu, MenuBuilder, MenuItem, MenuItemBuilder,
    PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Wry};

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

/// A menu handle whose text can be re-set after construction. `MenuItem`
/// and `Submenu` both expose `set_text`, but there is no shared trait for
/// it in `tauri::menu`, so this wraps whichever one a given id refers to.
pub enum SyncableItem {
    Item(MenuItem<Wry>),
    Submenu(Submenu<Wry>),
}

impl SyncableItem {
    fn set_text(&self, text: &str) -> tauri::Result<()> {
        match self {
            SyncableItem::Item(item) => item.set_text(text),
            SyncableItem::Submenu(submenu) => submenu.set_text(text),
        }
    }
}

pub struct MenuState(pub Mutex<HashMap<String, SyncableItem>>);

/// Shared About-panel content for both the macOS app-menu About and the
/// Windows/Linux Help-menu About. Must be `Some(..)`, not `None` — muda's
/// Windows/GTK handlers silently no-op on `None` (finding I3); only macOS's
/// OS-deferred About tolerates it, but there's no reason to special-case
/// that platform when the same metadata works everywhere.
fn about_metadata() -> AboutMetadata<'static> {
    AboutMetadataBuilder::new()
        .name(Some("Rune"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .build()
}

/// Builds the native menu for `target_os` and a lookup of every syncable
/// (id -> handle) so `set_menu_labels` can retext items after startup.
/// macOS gets a prepended app submenu (About, native Cut/Copy/Paste/Select
/// All, Minimize/Close Window, Hide/Hide Others/Services, and a custom Quit
/// with `CmdOrCtrl+Q` — finding C1: `app.set_menu` replaces the OS default
/// app menu, so these have to be restored explicitly or the OS loses its
/// own Cmd+Q and clipboard shortcuts). Win/Linux fold Quit into File and
/// get a native About row appended to Help.
pub fn build_menu(app: &AppHandle, target_os: TargetOs) -> tauri::Result<(Menu<Wry>, HashMap<String, SyncableItem>)> {
    let mut lookup: HashMap<String, SyncableItem> = HashMap::new();
    let mut top_level: Vec<Submenu<Wry>> = Vec::new();

    if target_os == TargetOs::MacOs {
        let about = PredefinedMenuItem::about(app, Some("About Rune"), Some(about_metadata()))?;
        let cut = PredefinedMenuItem::cut(app, None)?;
        let copy = PredefinedMenuItem::copy(app, None)?;
        let paste = PredefinedMenuItem::paste(app, None)?;
        let select_all = PredefinedMenuItem::select_all(app, None)?;
        let minimize = PredefinedMenuItem::minimize(app, None)?;
        let close_window = PredefinedMenuItem::close_window(app, None)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let services = PredefinedMenuItem::services(app, None)?;
        // The one `.accelerator()` exception in the whole codebase (spec §5.4 amendment,
        // finding C1): main.ts's keydown listener has no Quit branch on any platform, so
        // there is no DOM keystroke this could double-dispatch against.
        let quit = MenuItemBuilder::with_id("app.quit", "Quit Rune")
            .accelerator("CmdOrCtrl+Q")
            .build(app)?;
        let app_menu = SubmenuBuilder::new(app, "Rune")
            .item(&about)
            .separator()
            .item(&cut)
            .item(&copy)
            .item(&paste)
            .item(&select_all)
            .separator()
            .item(&minimize)
            .item(&close_window)
            .separator()
            .item(&hide)
            .item(&hide_others)
            .item(&services)
            .separator()
            .item(&quit)
            .build()?;
        lookup.insert("app.quit".to_string(), SyncableItem::Item(quit));
        top_level.push(app_menu);
    }

    for def in submenu_defs(target_os) {
        let mut builder = SubmenuBuilder::with_id(app, def.id, def.fallback_text);
        for entry in &def.entries {
            match entry {
                Entry::Action(action) => {
                    let item = MenuItemBuilder::with_id(action.id, action.fallback_text).build(app)?;
                    builder = builder.item(&item);
                    lookup.insert(action.id.to_string(), SyncableItem::Item(item));
                }
                Entry::Separator => {
                    builder = builder.separator();
                }
            }
        }
        if def.id == "menu.help" && target_os != TargetOs::MacOs {
            let about = PredefinedMenuItem::about(app, Some("About Rune"), Some(about_metadata()))?;
            builder = builder.separator().item(&about);
        }
        let submenu = builder.build()?;
        top_level.push(submenu.clone());
        lookup.insert(def.id.to_string(), SyncableItem::Submenu(submenu));
    }

    let refs: Vec<&dyn IsMenuItem<Wry>> = top_level.iter().map(|s| s as &dyn IsMenuItem<Wry>).collect();
    let menu = MenuBuilder::new(app).items(&refs).build()?;
    Ok((menu, lookup))
}

/// Pushes already-translated text (from the frontend's i18n table) into
/// the menu built by `build_menu`. Rust never holds its own copy of the
/// 4-locale strings. Unknown ids in `labels` are silently skipped. A
/// `set_text` failure on one item does not stop the rest — every item is
/// attempted, and any failures are joined into the returned error so the
/// menu ends up as fully translated as possible rather than half-applied.
#[tauri::command]
pub fn set_menu_labels(state: tauri::State<MenuState>, labels: HashMap<String, String>) -> Result<(), String> {
    let lookup = state.0.lock().map_err(|e| e.to_string())?;
    let mut errors = Vec::new();
    for (id, text) in labels {
        if let Some(item) = lookup.get(&id) {
            if let Err(e) = item.set_text(&text) {
                errors.push(format!("{id}: {e}"));
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
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

    /// This is the mechanical half of the Rust<->TS id contract described in
    /// `submenu_defs`'s doc comment. If this fails after you add/rename/remove
    /// an id, update `MENU_LABEL_KEYS` in `src/chrome/menuLabels.ts` to match —
    /// every id here must have exactly one entry there, and vice versa.
    #[test]
    fn action_and_submenu_ids_match_the_frontend_contract() {
        let mut all_ids: Vec<&str> = [TargetOs::Windows, TargetOs::MacOs, TargetOs::Linux]
            .into_iter()
            .flat_map(|os| {
                let defs = submenu_defs(os);
                let mut ids: Vec<&str> = defs.iter().map(|s| s.id).collect();
                ids.extend(action_ids(&defs));
                ids
            })
            .collect();
        all_ids.sort_unstable();
        all_ids.dedup();
        assert_eq!(
            all_ids,
            vec![
                "app.quit",
                "file.exportHtml",
                "file.exportPdf",
                "file.newTab",
                "file.open",
                "file.openFolder",
                "file.save",
                "file.saveAs",
                "help.help",
                "menu.file",
                "menu.help",
                "menu.view",
                "view.toggleFocusMode",
                "view.togglePanel",
                "view.toggleSidebar",
                "view.toggleTheme",
            ],
            "menu id set changed — update src/chrome/menuLabels.ts's MENU_LABEL_KEYS to match"
        );
    }
}
