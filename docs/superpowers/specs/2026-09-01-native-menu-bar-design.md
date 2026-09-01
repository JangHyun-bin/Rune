# Native OS Menu Bar — Design Spec

> Status: **Design (approved-pending-review)** · Date: 2026-09-01 · Target release: **v1.0.1**
> Author: Hyunbin Jang (with Claude) · Supersedes: none

## 1. Background & motivation

User report: the app has no top-level File/Edit/View-style menu bar that a typical desktop editor has, and `Ctrl+Shift+S` did nothing.

Root cause of both, confirmed via `superpowers:systematic-debugging`:

1. **No menu bar** — `src/chrome/chrome.ts` only ever built a titlebar out of the brand mark, sidebar/panel toggle buttons, and a settings gear. There is no `tauri::menu` usage anywhere in `src-tauri/`. This was an intentional minimal-chrome design choice (all commands are reachable via the Command Palette, `Ctrl+K`), but the user wants a real native menu bar in addition.
2. **`Ctrl+Shift+S` no-op** — `src/main.ts:1829` matched `mod && key === "s"` with no `shiftKey` check, so `Ctrl+Shift+S` fell into the same branch as `Ctrl+S` and silently re-saved the already-saved file (no dialog, no visible effect). **Already fixed** in this session (`main.ts` now has separate `mod+shift+s` → `doSaveAs()` / `mod+!shift+s` → `doSave()` branches, plus a `cmd.saveAs` palette entry and i18n strings in all 4 locales). This spec covers the remaining ask: the native menu bar.

## 2. Goals / non-goals

**Goals**
- A real native menu bar (Windows/Linux: window-attached menu bar; macOS: app menu bar) on the main window.
- File / View / Help top-level menus, backed by the exact same functions the Command Palette and keyboard shortcuts already call — no new business logic.
- Menu labels follow the app's active locale (en/ko/ja/zh) and update live when the user switches language.
- Quit (wherever it lives — File menu on Win/Linux, app menu on macOS) goes through the existing graceful-shutdown path (settings flush, hot-exit discard), not an abrupt process exit.

**Non-goals (this spec)**
- No *custom* Edit menu with Undo/Redo. CodeMirror 6 owns Undo/Redo via its own `historyKeymap`; native `PredefinedMenuItem::undo()/redo()` send OS-level `execCommand`, which does not touch CM6's internal history and risks state divergence. This is unrelated to the macOS app menu's native Cut/Copy/Paste/Select All/Window/Hide/Services items (§3, "macOS app menu" row) — those are OS-default items that exist for free until `app.set_menu` replaces the default menu, and restoring them is a regression fix, not new scope. (Added post-implementation, final review finding C1: the first implementation replaced the whole macOS app menu and silently lost these along with Cmd+Q.)
- No native OS accelerators on the custom menu items (see §5.4), with one exception: macOS Quit gets `CmdOrCtrl+Q` (§5.4, added post-implementation per finding C1) because there is no competing `keydown` branch for Quit on any platform.
- No menu on detached view windows (`view-*`) — those are workbench utility panels; scope stays on the main window to avoid touching the just-stabilized native-docking multi-window code.
- No per-item enabled/disabled state tracking (e.g. graying out Save when clean). Matches how the Command Palette already behaves — every item is always clickable, and the target function is already a safe no-op when there's nothing to do.

## 3. Resolved design decisions

| Decision | Choice |
|---|---|
| Menu-building approach | Rust builds the native menu via `tauri::menu`; click → `app.emit("menu-action", id)` → JS dispatch table calls existing functions. Mirrors the existing `app.emit("open-file", path)` pattern in `lib.rs`. |
| Accelerators | None on custom items. Labels show the shortcut as static hint text (e.g. `Save As…    Ctrl+Shift+S`); the real key handling stays in `main.ts`'s `keydown` listener. |
| i18n ownership | JS (`i18n.ts`) stays the single source of translated strings. A new Tauri command `set_menu_labels(labels: HashMap<String, String>)` pushes translated text into the already-built menu items via `set_text()`; Rust never embeds a copy of the 4-locale table. |
| Quit | Custom `menu-action: "app.quit"` item (not `PredefinedMenuItem::quit()`), handled in JS by calling `getCurrentWebviewWindow().close()` — same path as clicking the OS close button, so the existing `close-requested` save/hot-exit flush still runs. |
| macOS app menu | `Submenu` named after the app containing `PredefinedMenuItem::about()`, then a custom `app.quit` item (same as Win/Linux File→Quit — **not** `PredefinedMenuItem::quit()`, so it still routes through the graceful-shutdown path) with `.accelerator("CmdOrCtrl+Q")` set (the one accelerator exception — see §5.4). **Added post-implementation (final review finding C1):** `app.set_menu` replaces the OS's entire default app menu, which is where macOS actually gets Cmd+Q and the Cut/Copy/Paste/Select All keyboard shortcuts from — so the macOS app menu must also include `PredefinedMenuItem::cut/copy/paste/select_all()` (an Edit-role group, no id, no label sync needed — OS-supplied text) plus `minimize`/`close_window` and `hide`/`hide_others`/`services` to avoid silently regressing window management and clipboard shortcuts that worked before this feature touched the app menu. |
| Scope | Main window only. |
| Rust testability | Item definitions (id, label key, target platform) built as a pure function separate from the `tauri::menu::Menu` construction call, so the item list is unit-testable without an OS window — same separation `native_drag.rs` already uses between coordinate math and platform API calls. |

## 4. Menu content

| Menu | Items | Maps to |
|---|---|---|
| **File** | New Tab | `newDoc()` |
| | Open File… | `openFile()` |
| | Open Folder… | `openFolder()` |
| | — | |
| | Save | `doSave()` |
| | Save As… | `doSaveAs()` |
| | — | |
| | Export HTML | `exportHtml(...)` |
| | Export PDF | `exportPdf(...)` |
| | — | |
| | Quit *(Win/Linux only — macOS uses the app menu's Quit)* | emits `app.quit` → `getCurrentWebviewWindow().close()` |
| **View** | Toggle Sidebar | existing `onTogglePrimarySidebar` callback |
| | Toggle Panel | existing `onTogglePanel` callback |
| | Toggle Theme | `flipTheme()` |
| | Toggle Focus Mode | `applyFocusMode(!focusMode)` |
| **Help** | Help | `helpPanel.open()` |
| | About Rune *(Win/Linux only — macOS uses the app menu's About)* | `PredefinedMenuItem::about(app, Some("About Rune"), Some(metadata))` — **must** pass `Some` metadata (name/version), not `None` (added post-implementation, finding I3: muda's Windows/GTK handlers no-op silently when metadata is `None`; only macOS's OS-deferred About works with `None`) |
| **macOS app menu** *(prepended, macOS only)* | About Rune | `PredefinedMenuItem::about()` |
| | Cut / Copy / Paste / Select All *(added post-implementation, finding C1)* | `PredefinedMenuItem::cut/copy/paste/select_all()` — restores OS-default clipboard shortcuts `app.set_menu` would otherwise silently remove |
| | Hide / Hide Others / Services *(added post-implementation, finding C1)* | `PredefinedMenuItem::hide/hide_others/services()` |
| | Minimize / Close Window *(added post-implementation, finding C1)* | `PredefinedMenuItem::minimize/close_window()` |
| | Quit Rune *(`CmdOrCtrl+Q` accelerator — the one exception, see §5.4)* | custom `app.quit` (not `PredefinedMenuItem::quit()`) |

## 5. Detailed design

### 5.1 Rust: menu construction (`src-tauri/src/menu.rs`, new)

- A pure function, e.g. `fn menu_item_defs(target_os: TargetOs) -> Vec<MenuItemDef>` where `MenuItemDef { id: &'static str, label_key: &'static str, separator_before: bool }`, decides *what* items exist per platform (Quit appears in File on Win/Linux, not on macOS). Unit-tested directly: assert the id list for each `TargetOs` variant.
- A second function, `fn build_menu(app: &AppHandle, defs: &[MenuItemDef]) -> tauri::Result<Menu<Wry>>`, turns those defs into real `tauri::menu` objects (this part needs an `AppHandle` and isn't unit-tested — mirrors how `native_drag.rs` keeps OS-API calls thin and untested while the math around them is covered).
- `run()` in `lib.rs` calls `build_menu` after the window is created and sets it via `app.set_menu(menu)` (Windows/Linux) — Tauri applies the same `Menu` as the app-wide menu on macOS automatically when set through `App`/`AppHandle` rather than per-window.
- `app.on_menu_event(|app, event| { let _ = app.emit("menu-action", event.id().0.clone()); })` registered once in `run()`, right next to the existing `RunEvent::Opened` handling.

### 5.2 Rust: label sync (`commands.rs` + `menu.rs`)

- New command `set_menu_labels(app: AppHandle, labels: HashMap<String, String>) -> Result<(), String>`: looks up each managed `MenuItemDef.id` in `labels` and calls `.set_text(text)` on the corresponding `MenuItem`/`Submenu`. Menu handles are stored in a new `MenuState(Mutex<Option<BuiltMenu>>)` managed state (parallel to `WatcherState`/`WorkspaceIndexState`) so the command can reach them after `run()` builds the menu once at startup.
- Missing keys in the map are simply skipped (defensive, not an error) — keeps this command tolerant of partial updates.

### 5.3 Frontend: labels + dispatch (`main.ts`, `ipc/bindings.ts`)

- `ipc/bindings.ts`: add `setMenuLabels: (labels: Record<string, string>) => call<void>("set_menu_labels", { labels })`, matching the existing hand-written binding style (`[[tauri-specta-needs-nightly]]`).
- A small `menuLabels(): Record<string, string>` builder in `main.ts` maps each menu id to `tr(...)` (reusing the same i18n keys already added for the palette, e.g. `cmd.save`, `cmd.saveAs`, plus new `menu.*` keys for items that don't already have a palette-friendly label, e.g. `menu.quit`, `menu.about`). Called once after `i18n` is ready at startup, and again inside the existing `applyLocale()` function (language picker already calls this on every switch).
- `listen("menu-action", (event) => { dispatch(event.payload as string); })` registered alongside the existing `listen("open-file", ...)` call. `dispatch` is a plain `switch`/lookup object mapping id → the same function references used by `paletteItems()`/the `keydown` handler (`doSave`, `doSaveAs`, `openFile`, `openFolder`, `newDoc`, `exportHtml`, `exportPdf`, `flipTheme`, `applyFocusMode`, sidebar/panel toggle callbacks, `helpPanel.open()`, and `"app.quit"` → `getCurrentWebviewWindow().close()`).
- No new test scaffolding for this dispatch — `main.ts` has zero unit tests today (confirmed by grep) and this follows the same glue-code convention as the `keydown` listener and `paletteItems()` it sits next to.

### 5.4 Accelerator display text

- `.accelerator(...)` is **never called** on any custom `MenuItem`, on any platform — this is the one rule that keeps the design simple. Tauri/muda has no "cosmetic-only" accelerator mode: calling `.accelerator()` registers a real OS-level key binding on every platform (Windows, macOS, Linux alike), which is exactly the double-dispatch risk Approach B was rejected for.
- The shortcut hint is instead just literal characters appended to the item's label string (e.g. `"Save As…    Ctrl+Shift+S"`), which renders identically everywhere and carries zero OS wiring. Pressing the key still only ever goes through `main.ts`'s existing `keydown` listener — the menu is click-only.

This removes the platform-uncertainty this section used to carry: with no `.accelerator()` call anywhere, there is exactly one path for a keystroke (DOM `keydown`) and exactly one path for a menu click (`on_menu_event → emit → JS dispatch`), and they never overlap.

**Amendment (post-implementation, final review finding C1):** the macOS app-menu Quit item is the one exception to "never call `.accelerator()`" — it gets `.accelerator("CmdOrCtrl+Q")`. Reasoning: the "no accelerator" rule exists to prevent an OS-registered key binding from double-dispatching against `main.ts`'s DOM `keydown` listener. `main.ts` has no `q`/Quit branch on any platform — Quit was only ever reachable via the menu — so there is no competing path this exception could race against. Without it, replacing macOS's default app menu (required to add the custom, graceful-shutdown-routed `app.quit` item at all) silently drops the OS's own Cmd+Q handling, which every native macOS app is expected to support. This exception is scoped to Quit only; it is not a general license to add accelerators to other items.

## 6. Risks, dependencies, open items

1. **`tauri::menu` API surface** — Tauri 2's menu module ships in the base `tauri` crate already depended on (`Cargo.toml:25`, no extra feature flag needed); confirm exact builder API (`MenuBuilder`/`SubmenuBuilder`/`PredefinedMenuItem`) against the pinned Tauri version during implementation.
2. **i18n keys** — new `menu.quit` / `menu.about` (and any label not already covered by an existing `cmd.*` key) need entries in all 4 locale blocks plus a `parity.test.ts` pass, following the pattern already used for `cmd.saveAs` in this session.
3. **`PredefinedMenuItem::about()` title text** — the item label itself ("About Rune") is set once at build time in whatever locale is active then; unlike custom items it is not re-synced by `set_menu_labels` (its *content*, the native About panel, is OS-drawn either way). Low-impact — acceptable for v1, notable if a future pass wants full label localization there too.
4. **Menu construction must not crash app startup** (added post-implementation, final review finding I5) — this feature ships with no feature flag (unlike `VITE_NATIVE_DOCKING`), so a menu-building failure (e.g. flaky GTK init on some Linux desktop) must not prevent the app from launching. Log and continue without a menu bar rather than propagating the error out of `.setup()`.

## 7. Testing strategy

- **Rust (unit):** `menu_item_defs()` per-`TargetOs` id lists (macOS excludes File→Quit, includes app-menu About/Quit; Windows/Linux include File→Quit, no app menu).
- **Vitest:** `menuLabels()` returns the expected id→string map for a given locale (pure function, no DOM).
- **Manual:** click every File/View/Help item once per platform; verify Quit flushes settings/hot-exit like the window close button does; verify menu labels update after switching language in Settings.
- Keep the full existing suite green (`npx tsc --noEmit`, `npx vitest run`, `cargo test`).

## 8. Affected files

Frontend: `src/main.ts`, `src/ipc/bindings.ts`, `src/i18n/i18n.ts`.
Rust: new `src-tauri/src/menu.rs`; `src-tauri/src/lib.rs` (register menu + `on_menu_event` + `MenuState`), `src-tauri/src/commands.rs` (`set_menu_labels`).

## 9. Out of scope (future)

Edit menu / native undo-redo integration · per-item enabled/disabled state · menu on detached view windows · tray icon.
