# Native OS Menu Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real native File/View/Help menu bar (app menu on macOS) to Rune's main window, wired to the exact functions the Command Palette and keyboard shortcuts already call.

**Architecture:** Rust builds the native menu via `tauri::menu` at startup with hardcoded English fallback text and stable string ids; every click emits `app.emit("menu-action", id)` (same pattern as the existing `open-file` event); the frontend listens once and dispatches to existing functions. A separate `set_menu_labels` command lets JS push already-translated text into the built items whenever locale changes, so Rust never owns a copy of the 4-locale table.

**Tech Stack:** Rust / `tauri` 2.11 (`tauri::menu` module, no extra Cargo feature needed), TypeScript / Vite, Vitest, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-09-01-native-menu-bar-design.md`

## Global Constraints

- No `.accelerator(...)` call anywhere, on any menu item, on any platform — the DOM `keydown` listener in `src/main.ts` stays the only thing that reacts to keystrokes. Shortcut hints are plain text baked into the label string. **One exception (added post-implementation, final whole-branch review finding C1):** the macOS app-menu Quit item gets `.accelerator("CmdOrCtrl+Q")`, because `main.ts`'s `keydown` listener has no Quit/`q` branch on any platform to race against, and replacing macOS's default app menu (required to route Quit through graceful shutdown) otherwise silently drops the OS's own Cmd+Q handling. Scoped to Quit only.
- No *custom* Edit menu with `PredefinedMenuItem::undo()/redo()`. **Clarification (finding C1):** this does not forbid restoring the macOS app menu's native `cut()/copy()/paste()/select_all()`/window/hide/services items that `app.set_menu` silently removes when it replaces the OS default app menu — that removal was an unintended regression this branch introduced, not a deliberate scope cut.
- Menu bar applies to the **main window only** — never touch `view-*` detached windows or their capability file. (Finding I2: `app.set_menu` is app-wide by default and must be scoped explicitly on Windows/Linux; the `menu-action` forwarder must target the main window specifically, not broadcast.)
- Quit is **always** a custom `app.quit` action (never `PredefinedMenuItem::quit()`, on any platform) so it always routes through the window's existing `close-requested` graceful-shutdown path.
- `PredefinedMenuItem::about()` is the one exception allowed to stay native/unsynced (it only opens an OS info panel — no app state involved). **Correction (finding I3):** it must be built with `Some(AboutMetadata{..})`, not `None` — muda's Windows/GTK handlers silently no-op on `None`; only macOS's OS-deferred About tolerates it.
- Menu construction must never crash app startup (finding I5) — this feature has no feature flag, so `.setup()` must log and continue on a menu-build failure rather than propagate it into `.expect(...)`.
- Shortcut hint text (`"Save As…    Ctrl+Shift+S"`) must actually be baked into labels by `menuLabels()` (finding I4) — this was specified from the start (spec §3/§5.4) but never implemented in Tasks 1-4.

---

## Task 1: Rust — pure menu item definitions

**Files:**
- Create: `src-tauri/src/menu.rs`
- Modify: `src-tauri/src/lib.rs:1-8` (add `mod menu;` to the existing `mod` block)

**Interfaces:**
- Produces: `pub enum TargetOs { Windows, MacOs, Linux }` with `TargetOs::current() -> TargetOs`; `pub struct ActionDef { pub id: &'static str, pub fallback_text: &'static str }`; `pub enum Entry { Action(ActionDef), Separator }`; `pub struct SubmenuDef { pub id: &'static str, pub fallback_text: &'static str, pub entries: Vec<Entry> }`; `pub fn submenu_defs(target_os: TargetOs) -> Vec<SubmenuDef>`. Task 2 consumes all of these.

- [ ] **Step 1: Write `src-tauri/src/menu.rs` with the pure definitions and their tests**

```rust
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
```

- [ ] **Step 2: Register the module in `lib.rs`**

In `src-tauri/src/lib.rs`, the file starts with a block of `mod` declarations:

```rust
mod fs_ops;
mod hot_exit;
mod native_drag;
mod commands;
mod publishing;
mod settings;
mod search;
mod workspace_index;
```

Add `mod menu;` to this block (any position — alphabetical isn't enforced here, but put it next to `mod native_drag;` since both are platform-chrome modules):

```rust
mod fs_ops;
mod hot_exit;
mod native_drag;
mod menu;
mod commands;
mod publishing;
mod settings;
mod search;
mod workspace_index;
```

- [ ] **Step 3: Run the new unit tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml menu::`
Expected: 4 tests pass (`macos_file_menu_has_no_quit_action`, `windows_and_linux_file_menu_has_quit_action`, `every_platform_has_the_same_three_top_level_menus_in_order`, `ids_are_unique_within_a_platform`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/menu.rs src-tauri/src/lib.rs
git commit -m "feat(menu): add pure per-platform menu item definitions"
```

---

## Task 2: Rust — build the native menu, sync labels, wire into `lib.rs`

**Files:**
- Modify: `src-tauri/src/menu.rs` (append `build_menu`, `MenuState`, `SyncableItem`, `set_menu_labels`)
- Modify: `src-tauri/src/lib.rs` (register menu at startup, forward menu clicks, add the command to `invoke_handler`)

**Interfaces:**
- Consumes: `TargetOs`, `submenu_defs` from Task 1.
- Produces: `pub fn build_menu(app: &AppHandle, target_os: TargetOs) -> tauri::Result<(Menu, HashMap<String, SyncableItem>)>`; `pub struct MenuState(pub Mutex<HashMap<String, SyncableItem>>)`; `#[tauri::command] pub fn set_menu_labels(state: tauri::State<MenuState>, labels: HashMap<String, String>) -> Result<(), String>`. Task 4 (frontend) calls `set_menu_labels` by its Tauri command name `"set_menu_labels"` and listens for the `"menu-action"` event this task emits.

- [ ] **Step 1: Append the menu-building code to `src-tauri/src/menu.rs`**

Add these imports at the top of the file (above the `TargetOs` enum from Task 1):

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::menu::{IsMenuItem, Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Manager};
```

Append below `submenu_defs` (before the `#[cfg(test)]` block):

```rust
/// A menu handle whose text can be re-set after construction. `MenuItem`
/// and `Submenu` both expose `set_text`, but there is no shared trait for
/// it in `tauri::menu`, so this wraps whichever one a given id refers to.
pub enum SyncableItem {
    Item(MenuItem),
    Submenu(Submenu),
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

/// Builds the native menu for `target_os` and a lookup of every syncable
/// (id -> handle) so `set_menu_labels` can retext items after startup.
/// macOS gets a prepended app submenu (About + custom Quit); Win/Linux
/// fold Quit into File and get a native About row appended to Help.
pub fn build_menu(app: &AppHandle, target_os: TargetOs) -> tauri::Result<(Menu, HashMap<String, SyncableItem>)> {
    let mut lookup: HashMap<String, SyncableItem> = HashMap::new();
    let mut top_level: Vec<Submenu> = Vec::new();

    if target_os == TargetOs::MacOs {
        let about = PredefinedMenuItem::about(app, Some("About Rune"), None)?;
        let quit = MenuItemBuilder::with_id("app.quit", "Quit Rune").build(app)?;
        let app_menu = SubmenuBuilder::new(app, "Rune")
            .item(&about)
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
            let about = PredefinedMenuItem::about(app, Some("About Rune"), None)?;
            builder = builder.separator().item(&about);
        }
        let submenu = builder.build()?;
        top_level.push(submenu.clone());
        lookup.insert(def.id.to_string(), SyncableItem::Submenu(submenu));
    }

    let refs: Vec<&dyn IsMenuItem> = top_level.iter().map(|s| s as &dyn IsMenuItem).collect();
    let menu = MenuBuilder::new(app).items(&refs).build()?;
    Ok((menu, lookup))
}

/// Pushes already-translated text (from the frontend's i18n table) into
/// the menu built by `build_menu`. Rust never holds its own copy of the
/// 4-locale strings. Unknown ids in `labels` are silently skipped.
#[tauri::command]
pub fn set_menu_labels(state: tauri::State<MenuState>, labels: HashMap<String, String>) -> Result<(), String> {
    let lookup = state.0.lock().map_err(|e| e.to_string())?;
    for (id, text) in labels {
        if let Some(item) = lookup.get(&id) {
            item.set_text(&text).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
```

- [ ] **Step 2: Wire it into `src-tauri/src/lib.rs`**

Find this block near the end of `run()`:

```rust
        .manage(LaunchFile(Mutex::new(initial.into_iter().collect())))
        .manage(AppReady(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
```

Insert a `.setup(...)` call between `.manage(AppReady(...))` and `.invoke_handler(...)`:

```rust
        .manage(LaunchFile(Mutex::new(initial.into_iter().collect())))
        .manage(AppReady(AtomicBool::new(false)))
        .setup(|app| {
            let target_os = menu::TargetOs::current();
            let handle = app.app_handle();
            let (built_menu, lookup) = menu::build_menu(handle, target_os)?;
            app.set_menu(built_menu)?;
            app.manage(menu::MenuState(Mutex::new(lookup)));
            let emit_handle = handle.clone();
            app.on_menu_event(move |_app, event| {
                let _ = emit_handle.emit("menu-action", event.id().0.clone());
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
```

Add `menu::set_menu_labels` to the `generate_handler!` list — the list currently ends with:

```rust
            commands::create_dir,
            native_drag::native_webview_origin
        ])
```

Change it to:

```rust
            commands::create_dir,
            native_drag::native_webview_origin,
            menu::set_menu_labels
        ])
```

The top-of-file `use tauri::{Emitter, Manager};` import is already conditionally compiled in for desktop (see the `#[cfg(any(...))]` above it) and covers both `Emitter::emit` (used above) and `Manager` (used for `.manage()`/`.app_handle()`) — no new imports needed there.

- [ ] **Step 3: Build to catch any API mismatch**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: builds cleanly. If a method name differs slightly from what's written above (this was written against docs.rs for the pinned `tauri = 2.11.2`, but menu API details are worth double-checking against the exact local `Cargo.lock` resolution), the compiler error will name the exact mismatch — fix the call site, not the design (the ids/architecture don't change).

- [ ] **Step 4: Run the full Rust test suite to check for regressions**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all existing tests plus the 4 from Task 1 still pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/menu.rs src-tauri/src/lib.rs
git commit -m "feat(menu): build native menu bar and forward clicks to the frontend"
```

---

## Task 3: Frontend — Tauri binding + i18n strings

**Files:**
- Modify: `src/ipc/bindings.ts:81` (add `setMenuLabels`)
- Modify: `src/i18n/i18n.ts` (add `menu.file` / `menu.view` / `menu.help` / `menu.quit` to all four locale blocks)
- Test: `src/i18n/parity.test.ts` (existing — no changes needed, just must keep passing)

**Interfaces:**
- Consumes: Tauri command `"set_menu_labels"` from Task 2.
- Produces: `commands.setMenuLabels(labels: Record<string, string>) -> Promise<Result<null>>`; i18n keys `menu.file`, `menu.view`, `menu.help`, `menu.quit` available via `t()`/`tr()` in every locale. Task 4 consumes both.

- [ ] **Step 1: Add the binding**

In `src/ipc/bindings.ts`, find:

```ts
  openDefaultAppsSettings: () => call<null>("open_default_apps_settings", {}),
```

Add directly after it:

```ts
  openDefaultAppsSettings: () => call<null>("open_default_apps_settings", {}),
  setMenuLabels: (labels: Record<string, string>) => call<null>("set_menu_labels", { labels }),
```

- [ ] **Step 2: Add the new i18n keys to all four locales**

In `src/i18n/i18n.ts`, each locale block has a `"cmd.saveAs"` line (added in the prior Ctrl+Shift+S fix). Insert the four new `menu.*` keys directly after it in each block.

English block — find:
```ts
    "cmd.saveAs": "Save as…",
```
Change to:
```ts
    "cmd.saveAs": "Save as…",
    "menu.file": "File",
    "menu.view": "View",
    "menu.help": "Help",
    "menu.quit": "Quit",
```

Korean block — find:
```ts
    "cmd.saveAs": "다른 이름으로 저장…",
```
Change to:
```ts
    "cmd.saveAs": "다른 이름으로 저장…",
    "menu.file": "파일",
    "menu.view": "보기",
    "menu.help": "도움말",
    "menu.quit": "종료",
```

Japanese block — find:
```ts
    "cmd.saveAs": "名前を付けて保存…",
```
Change to:
```ts
    "cmd.saveAs": "名前を付けて保存…",
    "menu.file": "ファイル",
    "menu.view": "表示",
    "menu.help": "ヘルプ",
    "menu.quit": "終了",
```

Chinese (zh-Hans) block — find:
```ts
    "cmd.saveAs": "另存为…",
```
Change to:
```ts
    "cmd.saveAs": "另存为…",
    "menu.file": "文件",
    "menu.view": "视图",
    "menu.help": "帮助",
    "menu.quit": "退出",
```

- [ ] **Step 3: Run the i18n parity test**

Run: `npx vitest run src/i18n/parity.test.ts`
Expected: passes (all four locales now have matching key sets again).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/bindings.ts src/i18n/i18n.ts
git commit -m "feat(menu): add setMenuLabels binding and menu i18n strings"
```

---

## Task 4: Frontend — label builder (tested) + dispatch + sync points

**Files:**
- Create: `src/chrome/menuLabels.ts`
- Test: `src/chrome/menuLabels.test.ts`
- Modify: `src/main.ts` (dispatch table + two call sites)

**Interfaces:**
- Consumes: `t` from `src/i18n/i18n.ts`; `commands.setMenuLabels` from Task 3; the menu item ids defined in Task 1/2 (`file.newTab`, `file.open`, `file.openFolder`, `file.save`, `file.saveAs`, `file.exportHtml`, `file.exportPdf`, `app.quit`, `view.toggleSidebar`, `view.togglePanel`, `view.toggleTheme`, `view.toggleFocusMode`, `help.help`, plus submenu ids `menu.file`, `menu.view`, `menu.help`).
- Produces: `export function menuLabels(): Record<string, string>` — the complete id→translated-text map for the current locale.

- [ ] **Step 1: Write the failing test for `menuLabels()`**

Create `src/chrome/menuLabels.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { setLocale } from "../i18n/i18n";
import { menuLabels } from "./menuLabels";

describe("menuLabels", () => {
  beforeEach(() => setLocale("en"));

  it("maps every menu id to its English text by default", () => {
    const labels = menuLabels();
    expect(labels["menu.file"]).toBe("File");
    expect(labels["menu.view"]).toBe("View");
    expect(labels["menu.help"]).toBe("Help");
    expect(labels["file.save"]).toBe("Save");
    expect(labels["file.saveAs"]).toBe("Save as…");
    expect(labels["app.quit"]).toBe("Quit");
    expect(labels["view.toggleSidebar"]).toBe("Toggle Primary Sidebar");
  });

  it("re-translates every key when the locale changes", () => {
    setLocale("ko");
    const labels = menuLabels();
    expect(labels["menu.file"]).toBe("파일");
    expect(labels["app.quit"]).toBe("종료");
  });

  it("has no id mapped to an empty string in any locale", () => {
    for (const locale of ["en", "ko", "ja", "zh-Hans"] as const) {
      setLocale(locale);
      const labels = menuLabels();
      for (const [id, text] of Object.entries(labels)) {
        expect(text.length, `${id} in ${locale}`).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/chrome/menuLabels.test.ts`
Expected: FAIL — `Cannot find module './menuLabels'` (the file doesn't exist yet).

- [ ] **Step 3: Write `src/chrome/menuLabels.ts`**

```ts
import { t } from "../i18n/i18n";

/**
 * Menu item/submenu id -> i18n key. Ids match what src-tauri/src/menu.rs
 * assigns (the menu-action event payload and set_menu_labels map key);
 * i18n keys are reused from the command palette wherever the same
 * action already has one, so there is one string per concept, not two.
 */
const MENU_LABEL_KEYS: Record<string, string> = {
  "menu.file": "menu.file",
  "menu.view": "menu.view",
  "menu.help": "menu.help",
  "file.newTab": "cmd.newTab",
  "file.open": "cmd.openFile",
  "file.openFolder": "cmd.openFolder",
  "file.save": "cmd.save",
  "file.saveAs": "cmd.saveAs",
  "file.exportHtml": "cmd.exportHtml",
  "file.exportPdf": "cmd.exportPdf",
  "app.quit": "menu.quit",
  "view.toggleSidebar": "workbench.togglePrimarySidebar",
  "view.togglePanel": "workbench.togglePanel",
  "view.toggleTheme": "cmd.toggleTheme",
  "view.toggleFocusMode": "cmd.toggleFocusMode",
  "help.help": "cmd.help",
};

export function menuLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, key] of Object.entries(MENU_LABEL_KEYS)) out[id] = t(key);
  return out;
}
```

- [ ] **Step 4: Run the test again to confirm it passes**

Run: `npx vitest run src/chrome/menuLabels.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the dispatch table and the two sync call sites into `src/main.ts`**

Add the import near the top, next to the existing i18n import:

```ts
import { t as tr, setLocale, getLocale, detectLocale, LOCALES, type Locale } from "./i18n/i18n";
```
becomes
```ts
import { t as tr, setLocale, getLocale, detectLocale, LOCALES, type Locale } from "./i18n/i18n";
import { menuLabels } from "./chrome/menuLabels";
```

Find the block of `safeListen` calls:

```ts
void safeListen<string[]>("fs-change", (e) => onFsChange(e.payload));
// A .md opened via file association while Rune is already running (single-instance / macOS).
const openFileListenerReady = safeListen<string>("open-file", (e) => { void nativeFileOpenQueue.openLiveFile(e.payload); });
```

Add the dispatch function and its listener directly after:

```ts
void safeListen<string[]>("fs-change", (e) => onFsChange(e.payload));
// A .md opened via file association while Rune is already running (single-instance / macOS).
const openFileListenerReady = safeListen<string>("open-file", (e) => { void nativeFileOpenQueue.openLiveFile(e.payload); });
function menuAction(id: string): void {
  switch (id) {
    case "file.newTab": newDoc(); break;
    case "file.open": void openFile(); break;
    case "file.openFolder": void openFolder(); break;
    case "file.save": void doSave(); break;
    case "file.saveAs": void doSaveAs(); break;
    case "file.exportHtml": void exportHtml(activeView().state.doc.toString(), exportTitle()); break;
    case "file.exportPdf": void exportPdf(activeView().state.doc.toString(), exportTitle()); break;
    case "app.quit": void getCurrentWebviewWindow().close(); break;
    case "view.toggleSidebar": commandRegistry.execute(togglePartCommandId("primarySidebar")); break;
    case "view.togglePanel": commandRegistry.execute(togglePartCommandId("panel")); break;
    case "view.toggleTheme": flipTheme(); break;
    case "view.toggleFocusMode": applyFocusMode(!focusMode); break;
    case "help.help": helpPanel.open(); break;
  }
}
void safeListen<string>("menu-action", (e) => menuAction(e.payload));
```

Find `applyLocale` (the live language-switch path):

```ts
function applyLocale(l: Locale): void {
  setLocale(l);
  chrome.relabel();
  workbench.relabel();
  layoutModeControl?.relabel();
  syncActiveUI();
  settingsPanel.refresh();
  broadcastViewWindowPresentation();
  scheduleSaveSettings();
}
```

Add the menu resync:

```ts
function applyLocale(l: Locale): void {
  setLocale(l);
  chrome.relabel();
  workbench.relabel();
  layoutModeControl?.relabel();
  void commands.setMenuLabels(menuLabels());
  syncActiveUI();
  settingsPanel.refresh();
  broadcastViewWindowPresentation();
  scheduleSaveSettings();
}
```

Find the startup restore path (inside the async function that runs on launch):

```ts
  setLocale(saved ?? detectLocale());
  if (firstRun && import.meta.env.VITE_WDIO !== "1") {
    setLocale(await showLanguagePicker(getLocale()));
  }
  chrome.relabel();
  workbench.relabel();
  layoutModeControl?.relabel();
```

Add the initial menu sync right after locale is finally resolved:

```ts
  setLocale(saved ?? detectLocale());
  if (firstRun && import.meta.env.VITE_WDIO !== "1") {
    setLocale(await showLanguagePicker(getLocale()));
  }
  chrome.relabel();
  workbench.relabel();
  layoutModeControl?.relabel();
  void commands.setMenuLabels(menuLabels());
```

- [ ] **Step 6: Type-check and run the full Vitest suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass, including the 3 new `menuLabels` tests.

- [ ] **Step 7: Commit**

```bash
git add src/chrome/menuLabels.ts src/chrome/menuLabels.test.ts src/main.ts
git commit -m "feat(menu): dispatch native menu clicks and keep labels in sync with locale"
```

---

## Task 5: Manual verification (native chrome — not exercised by any automated suite)

No new automated coverage applies here: menu bars are OS chrome that neither `jsdom`-based Vitest nor a windowless `cargo test` can render or click. This mirrors how the project already treats native docking (`docs/qa/v1.0.1-native-docking.md`) — verified manually/via WDIO smoke, not unit tests.

- [ ] **Step 1: Full build**

Run: `npm run build && cargo build --manifest-path src-tauri/Cargo.toml`
Expected: both succeed.

- [ ] **Step 2: Launch the dev app and check the menu bar exists**

Run: `npm run tauri dev` (or the project's existing dev-launch script)
Expected: a File / View / Help menu bar is visible (Windows: attached to the window; macOS: at the top of the screen with the app name as the first menu).

- [ ] **Step 3: Click through every item once**

For each of File → New Tab / Open File… / Open Folder… / Save / Save As… / Export HTML / Export PDF, and View → Toggle Sidebar / Toggle Panel / Toggle Theme / Toggle Focus Mode, and Help → Help:
Expected: identical behavior to triggering the same action from the Command Palette (`Ctrl+K`).

- [ ] **Step 4: Verify Quit does a graceful shutdown**

Type something (leave the doc dirty), click File → Quit (or the app-menu Quit on macOS).
Expected: the app closes exactly like clicking the OS window-close button does today — no crash, and reopening the app restores the same session (hot-exit), confirming `close()` reached the existing `onCloseRequested` handler rather than an abrupt exit.

- [ ] **Step 5: Verify live locale sync**

Open Settings → change the UI language.
Expected: the menu bar's own labels (File/View/Help and every item) update immediately to the new language, without restarting the app.

- [ ] **Step 6: Update the QA record**

Add a short entry to `docs/qa/` (new file `docs/qa/native-menu-bar.md` or append to an existing relevant doc — match whatever the project's most recent QA doc naming does) noting which platform(s) you actually ran Steps 2-5 on. If you only verified on one OS, say so explicitly rather than implying full 3-platform coverage — this project's QA docs consistently separate "verified" from "not yet verified" per platform (see `docs/qa/v1.0.1-native-docking.md` for the pattern).

- [ ] **Step 7: Commit the QA note**

```bash
git add docs/qa/
git commit -m "docs(qa): record native menu bar manual verification"
```

---

## Self-review notes (for the plan author, not a task)

- Spec coverage: §4 menu content → Tasks 1-2 (Rust structure) + Task 4 (dispatch); §5.1-5.2 Rust construction/label sync → Task 2; §5.3 frontend dispatch/labels → Task 4; §5.4 no-accelerator rule → Global Constraints + Task 2 code (no `.accelerator()` call anywhere); §6 risk 1 (API surface) → Task 2 Step 3 explicitly expects a possible compiler-driven correction; §6 risk 2 (i18n keys) → Task 3; §7 testing strategy → Task 1 (Rust unit), Task 4 (Vitest `menuLabels`), Task 5 (manual). Nothing in the spec is unaddressed.
- No placeholders: every step has real, complete code — none of it depends on information gathered live from docs.rs (`tauri` 2.11.2) during plan-writing for this task.
