# UI Scale, Editor Font Zoom & macOS Launch Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `.md` double-click not opening files on macOS, add `Cmd+−/=/0` editor font zoom, and an app-wide UI scale control in Settings.

**Architecture:** Two CSS custom properties drive sizing — `--ui-scale` (set on `html`'s font-size, so every rem-based size scales) and `--editor-font-scale` (an editor-only multiplier layered on `1rem`). Effective editor text = `ui_scale × editor_font_scale`. The macOS fix buffers the OS "open" path into existing `LaunchFile` state so the frontend can drain it on startup. All sizing values are pure, clamped helpers in `src/theme/scale.ts`.

**Tech Stack:** Tauri 2 (Rust), CodeMirror 6, TypeScript, Vite, Vitest. No new dependencies.

## Global Constraints

- **No new dependencies** — implement with what's already in `package.json` / `Cargo.toml`.
- **Settings back-compat** — new persisted fields are `Option`/nullable; an old `settings.json` without them must load cleanly.
- **i18n parity** — every key added to `DICT.en` must be added to `ko`, `ja`, and `zh-Hans` (enforced by `src/i18n/parity.test.ts`).
- **Clamp on every apply** — `--ui-scale` and `--editor-font-scale` are only ever set through the `scale.ts` clamps, so a corrupt persisted value can never produce an unusable UI.
- **Composition model** — UI scale scales chrome + editor base font; editor font zoom is an additional editor-only multiplier on top.
- **Green gate** — the existing 181 frontend tests (`npx vitest run`) and Rust tests (`cd src-tauri && cargo test`) must stay green after every task.
- **rem conversion divisor is 16** (`Npx → (N/16)rem`). Keep as px: `1px`/`2px` borders, the `6px` drag-resizers, JS-driven layout vars (`--sidebar-width`, `--outline-height`, `--split-source-width`) and the `MIN`/`MAX` px constants in `main.ts`, `--editor-max`, and any `vw`/`vh`/`%` value.

---

### Task 1: macOS launch-file fix (Rust)

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands.rs:70-73`

**Interfaces:**
- Produces: `AppReady(pub std::sync::atomic::AtomicBool)` managed state; `take_launch_file` now also flips it to `true`.

- [ ] **Step 1: Add the `AppReady` state type and import**

In `src-tauri/src/lib.rs`, add the atomic import near the top (after `use std::sync::Mutex;`):

```rust
use std::sync::atomic::{AtomicBool, Ordering};
```

Add the new state struct right after the `LaunchFile` struct (around line 12):

```rust
/// True once the frontend has registered its `open-file` listener (it drains
/// `LaunchFile` on startup). Before that, OS file-open events are buffered into
/// `LaunchFile`; after, they are delivered live.
pub struct AppReady(pub AtomicBool);
```

- [ ] **Step 2: Manage the new state**

In `lib.rs`, in the builder chain, add `.manage(AppReady(...))` next to the existing `.manage(...)` calls (after `.manage(LaunchFile(Mutex::new(initial)))`):

```rust
        .manage(AppReady(AtomicBool::new(false)))
```

- [ ] **Step 3: Buffer the path in the macOS `Opened` handler**

In `lib.rs`, replace the macOS `Opened` block inside the `.run(|app, event| { ... })` closure (currently around lines 72-79) with:

```rust
            // macOS delivers file-open via the Opened event, not argv.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                let ready = app.state::<AppReady>().0.load(Ordering::SeqCst);
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let p = path.to_string_lossy().to_string();
                        // Cold launch: the frontend listener isn't ready yet, so
                        // buffer the path for take_launch_file() to drain on startup.
                        if !ready {
                            if let Ok(mut g) = app.state::<LaunchFile>().0.lock() {
                                *g = Some(p.clone());
                            }
                        }
                        let _ = app.emit("open-file", p);
                    }
                }
            }
```

(`use tauri::Manager;` is already imported at the top of `lib.rs`, which provides `app.state::<T>()`.)

- [ ] **Step 4: Flip `AppReady` when the frontend drains the launch file**

In `src-tauri/src/commands.rs`, replace `take_launch_file` (lines 70-73) with:

```rust
/// Return (and clear) the file Rune was launched with via file association, if any.
/// Also marks the app "ready" so later OS open events are delivered live, not buffered.
#[tauri::command]
pub fn take_launch_file(
    launch: tauri::State<crate::LaunchFile>,
    ready: tauri::State<crate::AppReady>,
) -> Option<String> {
    ready.0.store(true, std::sync::atomic::Ordering::SeqCst);
    launch.0.lock().ok().and_then(|mut g| g.take())
}
```

- [ ] **Step 5: Verify it compiles and existing tests pass**

Run: `cd src-tauri && cargo test`
Expected: builds with no errors; all existing tests PASS.

- [ ] **Step 6: Manual verification (file association)**

Run: `npm run tauri dev` once to confirm the app launches. Then for a real check (requires a build): `npm run tauri build`, set Rune as the default `.md` handler in Finder, fully quit Rune, and double-click a `.md` file → the file opens. Repeat with Rune already running.
Expected: the document opens in both cold and warm launches.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "fix(macos): open .md file on launch via file association"
```

---

### Task 2: Pure scale helpers (`src/theme/scale.ts`)

**Files:**
- Create: `src/theme/scale.ts`
- Test: `src/theme/scale.test.ts`

**Interfaces:**
- Produces:
  - `UI_SCALE_STEPS: readonly number[]` = `[0.8, 0.9, 1.0, 1.1, 1.25, 1.5]`
  - `UI_SCALE_DEFAULT = 1.0`, `EDITOR_FONT_DEFAULT = 1.0`
  - `clampUiScale(value: number): number` — snaps to nearest step; non-finite → default
  - `clampEditorFontScale(value: number): number` — clamps to `[0.75, 1.75]`; non-finite → default
  - `stepEditorFontScale(current: number, dir: 1 | -1): number`

- [ ] **Step 1: Write the failing test**

Create `src/theme/scale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  clampUiScale,
  clampEditorFontScale,
  stepEditorFontScale,
  UI_SCALE_DEFAULT,
  EDITOR_FONT_DEFAULT,
} from "./scale";

describe("clampUiScale", () => {
  it("snaps to the nearest allowed step", () => {
    expect(clampUiScale(1.04)).toBe(1.0);
    expect(clampUiScale(1.15)).toBe(1.1);
    expect(clampUiScale(1.2)).toBe(1.25);
  });
  it("clamps out-of-range values to the ends", () => {
    expect(clampUiScale(5)).toBe(1.5);
    expect(clampUiScale(0.1)).toBe(0.8);
  });
  it("falls back to default on non-finite input", () => {
    expect(clampUiScale(NaN)).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(Infinity)).toBe(UI_SCALE_DEFAULT);
  });
});

describe("clampEditorFontScale", () => {
  it("clamps to [0.75, 1.75]", () => {
    expect(clampEditorFontScale(2)).toBe(1.75);
    expect(clampEditorFontScale(0.5)).toBe(0.75);
    expect(clampEditorFontScale(1.2)).toBe(1.2);
  });
  it("falls back to default on non-finite input", () => {
    expect(clampEditorFontScale(NaN)).toBe(EDITOR_FONT_DEFAULT);
  });
});

describe("stepEditorFontScale", () => {
  it("steps by 0.1 in the given direction", () => {
    expect(stepEditorFontScale(1.0, 1)).toBe(1.1);
    expect(stepEditorFontScale(1.0, -1)).toBe(0.9);
  });
  it("does not exceed the bounds", () => {
    expect(stepEditorFontScale(1.75, 1)).toBe(1.75);
    expect(stepEditorFontScale(0.75, -1)).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/theme/scale.test.ts`
Expected: FAIL — cannot resolve `./scale`.

- [ ] **Step 3: Write the implementation**

Create `src/theme/scale.ts`:

```ts
// UI scale + editor font scale: pure, clamped helpers. No DOM access.

export const UI_SCALE_STEPS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5] as const;
export const UI_SCALE_DEFAULT = 1.0;

/** Snap any value to the nearest allowed UI-scale step; non-finite → default. */
export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT;
  let best: number = UI_SCALE_STEPS[0];
  for (const step of UI_SCALE_STEPS) {
    if (Math.abs(step - value) < Math.abs(best - value)) best = step;
  }
  return best;
}

export const EDITOR_FONT_MIN = 0.75;
export const EDITOR_FONT_MAX = 1.75;
export const EDITOR_FONT_DEFAULT = 1.0;
const EDITOR_FONT_STEP = 0.1;

/** Clamp editor font scale to [MIN, MAX]; non-finite → default. */
export function clampEditorFontScale(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_FONT_DEFAULT;
  return Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, value));
}

/** Step the editor font scale one increment in `dir` (+1/−1), rounded, clamped. */
export function stepEditorFontScale(current: number, dir: 1 | -1): number {
  const base = clampEditorFontScale(current);
  const next = Math.round((base + dir * EDITOR_FONT_STEP) * 100) / 100;
  return clampEditorFontScale(next);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/theme/scale.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/theme/scale.ts src/theme/scale.test.ts
git commit -m "feat(theme): add pure ui-scale and editor-font-scale helpers"
```

---

### Task 3: Editor font zoom (`Cmd+−/=/0`)

**Files:**
- Modify: `src/styles.css:1-23` (add `--editor-font-scale` default to `:root`)
- Modify: `src/theme/editorTheme.ts:7` (`.cm-scroller` font-size)
- Modify: `src/main.ts` (apply helpers + keydown bindings)

**Interfaces:**
- Consumes: `clampEditorFontScale`, `stepEditorFontScale`, `EDITOR_FONT_DEFAULT` from `src/theme/scale.ts`.
- Produces: CSS var `--editor-font-scale`; `applyEditorFontScale(scale, persist?)`, `currentEditorFontScale()` in `main.ts`.

- [ ] **Step 1: Add the CSS var default**

In `src/styles.css`, inside the `:root { ... }` block (before the closing `}` near line 23), add:

```css
  --editor-font-scale: 1;
```

- [ ] **Step 2: Drive the editor font-size from the var**

In `src/theme/editorTheme.ts`, change the `.cm-scroller` rule (line 7) from `fontSize: "16px"` to:

```ts
    ".cm-scroller": { fontFamily: "var(--sans)", fontSize: "calc(1rem * var(--editor-font-scale, 1))", lineHeight: "1.7", overflow: "auto" },
```

(At defaults, `1rem` = 16px and the multiplier is 1, so this renders identically to before.)

- [ ] **Step 3: Add the import and apply helpers in `main.ts`**

In `src/main.ts`, extend the existing `scale` import is not present yet — add this import near the other imports (e.g. after the `layoutSettings` import on line 32):

```ts
import { clampEditorFontScale, stepEditorFontScale, EDITOR_FONT_DEFAULT } from "./theme/scale";
```

Then add these functions near the other `apply*` functions (e.g. after `applyEditorMode`, around line 188):

```ts
function applyEditorFontScale(scale: number, persist = true): void {
  document.documentElement.style.setProperty("--editor-font-scale", String(clampEditorFontScale(scale)));
  if (persist) scheduleSaveSettings();
}
function currentEditorFontScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--editor-font-scale");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clampEditorFontScale(parsed) : EDITOR_FONT_DEFAULT;
}
function zoomEditorFont(dir: 1 | -1): void {
  applyEditorFontScale(stepEditorFontScale(currentEditorFontScale(), dir));
}
```

- [ ] **Step 4: Add the keydown bindings**

In `src/main.ts`, in the `window.addEventListener("keydown", (e) => { ... })` block (lines 852-867), add these three bindings after the `const mod = e.ctrlKey || e.metaKey;` line (line 854) and before the existing `mod && e.shiftKey` checks:

```ts
  if (mod && (e.key === "-" || e.key === "_")) { e.preventDefault(); zoomEditorFont(-1); return; }
  if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomEditorFont(1); return; }
  if (mod && e.key === "0") { e.preventDefault(); applyEditorFontScale(EDITOR_FONT_DEFAULT); return; }
```

(These keys don't collide with existing letter shortcuts or the `1–9` tab bindings.)

- [ ] **Step 5: Verify build + tests**

Run: `npm run build`
Expected: `tsc` passes, `vite build` succeeds (no type errors).

Run: `npx vitest run`
Expected: all tests PASS (181 + new scale tests).

- [ ] **Step 6: Manual verification**

Run: `npm run tauri dev`. Open a document, press `Cmd+=` a few times (text grows), `Cmd+−` (text shrinks), `Cmd+0` (returns to original size). Headings and code spans scale proportionally.

- [ ] **Step 7: Commit**

```bash
git add src/styles.css src/theme/editorTheme.ts src/main.ts
git commit -m "feat(editor): Cmd+-/=/0 to zoom editor font size"
```

---

### Task 4: App-wide UI scale (px → rem refactor)

**Files:**
- Modify: `src/styles.css` (token defs + `html` font-size + hardcoded px font-sizes)
- Modify: `src/theme/editorTheme.ts:8` (`.cm-content` padding)
- Modify: `src/main.ts` (apply helper)

**Interfaces:**
- Consumes: `clampUiScale`, `UI_SCALE_DEFAULT` from `src/theme/scale.ts`.
- Produces: CSS var `--ui-scale`; `applyUiScale(scale, persist?)`, `currentUiScale()` in `main.ts`.

- [ ] **Step 1: Add the `--ui-scale` default and the scaling `html` rule**

In `src/styles.css`, inside `:root { ... }` add (next to `--editor-font-scale: 1;`):

```css
  --ui-scale: 1;
```

Then change the `html, body` rule (line 30) to add a scaling `html` font-size rule above it:

```css
html { font-size: calc(16px * var(--ui-scale, 1)); }
html, body { height: 100%; margin: 0; }
```

- [ ] **Step 2: Convert the spacing + radius tokens to rem**

In `src/styles.css` `:root`, convert the token *definitions* (every consumer using `var(--space-*)` / `var(--radius-*)` then scales automatically):

```css
  /* spacing (4px base) */
  --space-4:0.25rem; --space-8:0.5rem; --space-12:0.75rem; --space-16:1rem; --space-24:1.5rem; --space-32:2rem;
  /* radius */
  --radius-sm:0.375rem; --radius-md:0.625rem; --radius-lg:0.875rem; --radius-xl:1.25rem;
```

- [ ] **Step 3: Convert hardcoded px font-sizes to rem**

In `src/styles.css`, convert every hardcoded `font-size: Npx` to `font-size: (N/16)rem` (leave everything else in this step alone). Apply throughout the file. Reference conversions for the values present:

```
12.5px → 0.78125rem    13px   → 0.8125rem    14px → 0.875rem
12px   → 0.75rem       11px   → 0.6875rem    10px → 0.625rem
10.5px → 0.65625rem    11.5px → 0.71875rem   15px → 0.9375rem
16px   → 1rem          17px   → 1.0625rem
```

Example (line 34, `#titlebar`): `font-size:12.5px;` → `font-size:0.78125rem;`.
Example (line 43, `#sidebar`): `font-size:13px;` → `font-size:0.8125rem;`.

Do **not** convert: `min-width:96px`/`max-width` structural px, borders, the `6px` resizers, `--sidebar-width`/`--outline-height` defaults, `--split-source-width`, or any `vw`/`vh`/`%`.

- [ ] **Step 4: Convert the editor content padding to rem**

In `src/theme/editorTheme.ts`, change `.cm-content` (line 8) padding from `"32px 28px"` to rem so it scales with the UI:

```ts
    ".cm-content": { maxWidth: "var(--editor-max, 720px)", margin: "0 auto", padding: "2rem 1.75rem" },
```

(Leave `maxWidth: var(--editor-max, 720px)` as-is — the readable measure is a typographic constant.)

- [ ] **Step 5: Add the apply helper + import in `main.ts`**

In `src/main.ts`, extend the scale import from Task 3 to also pull UI-scale helpers:

```ts
import { clampEditorFontScale, stepEditorFontScale, EDITOR_FONT_DEFAULT, clampUiScale, UI_SCALE_DEFAULT } from "./theme/scale";
```

Add these helpers next to `applyEditorFontScale`:

```ts
function applyUiScale(scale: number, persist = true): void {
  document.documentElement.style.setProperty("--ui-scale", String(clampUiScale(scale)));
  if (persist) scheduleSaveSettings();
}
function currentUiScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--ui-scale");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? clampUiScale(parsed) : UI_SCALE_DEFAULT;
}
```

- [ ] **Step 6: Verify build + tests, then visual regression at 100%**

Run: `npm run build` → Expected: passes.
Run: `npx vitest run` → Expected: all PASS.
Run: `npm run tauri dev`. With `--ui-scale` at its default (1), the UI must look pixel-identical to before this task (compare titlebar height, sidebar text, tabs, dialogs in both light and dark).

- [ ] **Step 7: Manual verification of scaling**

In the dev app console, run `document.documentElement.style.setProperty("--ui-scale", "1.5")` → the whole interface (sidebar, tabs, toolbar, statusbar, editor text) grows together; structural borders stay crisp. Set back to `"1"`.

- [ ] **Step 8: Commit**

```bash
git add src/styles.css src/theme/editorTheme.ts src/main.ts
git commit -m "feat(ui): app-wide UI scale via --ui-scale rem refactor"
```

---

### Task 5: Persist scale in Rust settings

**Files:**
- Modify: `src-tauri/src/settings.rs:53-66` (add fields) and the roundtrip test (lines 104-184)

**Interfaces:**
- Produces: `Settings.ui_scale: Option<f32>`, `Settings.editor_font_scale: Option<f32>` (serde camelCase → `uiScale`, `editorFontScale`).

- [ ] **Step 1: Extend the roundtrip test (failing)**

In `src-tauri/src/settings.rs`, in the `roundtrip_and_default` test, add to the constructed `Settings { ... }` literal (after `sidebar_width: Some(320),`):

```rust
            ui_scale: Some(1.25),
            editor_font_scale: Some(1.1),
```

And add these assertions after `assert_eq!(got.sidebar_width, Some(320));`:

```rust
        assert_eq!(got.ui_scale, Some(1.25));
        assert_eq!(got.editor_font_scale, Some(1.1));
```

In the `malformed_pane_layout_preserves_other_settings` test, after the existing assertions, confirm absent fields default to `None`:

```rust
        assert!(got.ui_scale.is_none());
        assert!(got.editor_font_scale.is_none());
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test settings`
Expected: FAIL — `Settings` has no field `ui_scale` / `editor_font_scale`.

- [ ] **Step 3: Add the fields to the struct**

In `src-tauri/src/settings.rs`, in `pub struct Settings`, add these two fields (after `pub sidebar_width: Option<u16>,`):

```rust
    pub ui_scale: Option<f32>,
    pub editor_font_scale: Option<f32>,
```

(The struct already has `#[serde(rename_all = "camelCase", default)]`, so they serialize as `uiScale`/`editorFontScale` and default to `None` for older files.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd src-tauri && cargo test settings`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat(settings): persist uiScale and editorFontScale"
```

---

### Task 6: Wire persistence through the frontend

**Files:**
- Modify: `src/ipc/bindings.ts:14` (`Settings` interface)
- Modify: `src/main.ts` (`settingsSnapshot`, the `restore` fallback literal, and apply-on-restore)

**Interfaces:**
- Consumes: `applyUiScale`, `currentUiScale`, `applyEditorFontScale`, `currentEditorFontScale` (Tasks 3–4); `Settings.uiScale`/`editorFontScale` (Task 5).

- [ ] **Step 1: Add the fields to the TS `Settings` interface**

In `src/ipc/bindings.ts`, line 14, add the two fields to the `Settings` interface (before the closing `}`):

```ts
uiScale: number | null; editorFontScale: number | null;
```

- [ ] **Step 2: Include both in `settingsSnapshot()`**

In `src/main.ts`, in `settingsSnapshot()` (lines 71-77), add the two values to the returned object (alongside `editorMode`, `sidebarWidth`, etc.):

```ts
  return { theme, lastFolder: currentFolder, openTabs, locale: getLocale(), editorWidth: currentEditorWidth(), editorMode, sidebarWidth: layout.sidebarWidth, layout, paneLayout, uiScale: currentUiScale(), editorFontScale: currentEditorFontScale() };
```

- [ ] **Step 3: Add the fields to the `restore()` fallback literal**

In `src/main.ts`, in `restore()` (line 616), add the two fields to the fallback settings object so it satisfies the `Settings` type:

```ts
  const s = res.status === "ok" ? res.data : { theme: null, lastFolder: null, openTabs: [], locale: null, editorWidth: null, editorMode: null, sidebarWidth: null, layout: null, paneLayout: null, uiScale: null, editorFontScale: null };
```

- [ ] **Step 4: Apply both on restore (before content loads)**

In `src/main.ts` `restore()`, right after the `applyLayoutSettings(...)` call (line 623), add:

```ts
  applyUiScale(s.uiScale ?? UI_SCALE_DEFAULT, false);
  applyEditorFontScale(s.editorFontScale ?? EDITOR_FONT_DEFAULT, false);
```

(`persist = false` avoids a redundant save during startup.)

- [ ] **Step 5: Verify build + tests**

Run: `npm run build` → Expected: passes (no type errors — the `Settings` literal and snapshot now match the interface).
Run: `npx vitest run` → Expected: all PASS.

- [ ] **Step 6: Manual verification of persistence**

Run: `npm run tauri dev`. Press `Cmd+=` twice, then quit and relaunch → the editor font stays enlarged. (UI scale persistence is verified in Task 7 once the control exists.)

- [ ] **Step 7: Commit**

```bash
git add src/ipc/bindings.ts src/main.ts
git commit -m "feat(settings): load and save uiScale/editorFontScale on restore"
```

---

### Task 7: Settings UI scale control, i18n, and help shortcuts

**Files:**
- Modify: `src/i18n/i18n.ts` (4 locales × 4 new keys)
- Modify: `src/workspace/settingsPanel.ts` (handlers + new row)
- Modify: `src/main.ts` (`mountSettingsPanel` wiring)
- Modify: `src/workspace/helpPanel.ts` (zoom shortcut rows)

**Interfaces:**
- Consumes: `UI_SCALE_STEPS` from `src/theme/scale.ts`; `applyUiScale`/`currentUiScale` from `main.ts`.
- Produces: `SettingsPanel` handlers `onUiScale: (scale: number) => void`, `getUiScale: () => number`.

- [ ] **Step 1: Add i18n keys to all four locales (failing parity if partial)**

In `src/i18n/i18n.ts`, add these four keys to **each** of `en`, `ko`, `ja`, `zh-Hans` (place near the other `settings.*` / `cmd.*` keys in each block):

```ts
    // en
    "settings.uiScale": "UI size",
    "cmd.zoomIn": "Increase editor font",
    "cmd.zoomOut": "Decrease editor font",
    "cmd.zoomReset": "Reset editor font",
```
```ts
    // ko
    "settings.uiScale": "UI 크기",
    "cmd.zoomIn": "에디터 글자 키우기",
    "cmd.zoomOut": "에디터 글자 줄이기",
    "cmd.zoomReset": "에디터 글자 기본값",
```
```ts
    // ja
    "settings.uiScale": "UI サイズ",
    "cmd.zoomIn": "エディタの文字を大きく",
    "cmd.zoomOut": "エディタの文字を小さく",
    "cmd.zoomReset": "エディタの文字をリセット",
```
```ts
    // zh-Hans
    "settings.uiScale": "界面大小",
    "cmd.zoomIn": "增大编辑器字体",
    "cmd.zoomOut": "减小编辑器字体",
    "cmd.zoomReset": "重置编辑器字体",
```

- [ ] **Step 2: Verify i18n parity passes**

Run: `npx vitest run src/i18n/parity.test.ts`
Expected: PASS (all four locales define the new keys).

- [ ] **Step 3: Add handlers to the settings panel**

In `src/workspace/settingsPanel.ts`, add two handlers to the `mountSettingsPanel(handlers: { ... })` type (after `getEditorMode`):

```ts
  onUiScale: (scale: number) => void;
  getUiScale: () => number;
```

Add the import at the top:

```ts
import { UI_SCALE_STEPS } from "../theme/scale";
```

- [ ] **Step 4: Render the UI-size row**

In `src/workspace/settingsPanel.ts` `build()`, after the Editor-mode row (ends line 99) and before the Layout row, add:

```ts
    // UI size
    const uiRow = document.createElement("div"); uiRow.className = "settings-row";
    const uiLabel = document.createElement("label"); uiLabel.textContent = t("settings.uiScale");
    const uiSel = document.createElement("select");
    for (const step of UI_SCALE_STEPS) {
      const o = document.createElement("option"); o.value = String(step); o.textContent = `${Math.round(step * 100)}%`;
      if (step === handlers.getUiScale()) o.selected = true;
      uiSel.appendChild(o);
    }
    uiSel.addEventListener("change", () => handlers.onUiScale(Number(uiSel.value)));
    uiRow.append(uiLabel, uiSel); card.appendChild(uiRow);
```

- [ ] **Step 5: Wire the handlers in `main.ts`**

In `src/main.ts`, in the `mountSettingsPanel({ ... })` call (starts line 283), add to the handlers object (e.g. after `getEditorMode: currentEditorMode,`):

```ts
  onUiScale: (scale) => { applyUiScale(scale); settingsPanel.refresh(); },
  getUiScale: currentUiScale,
```

- [ ] **Step 6: Add the zoom shortcuts to the Help panel**

In `src/workspace/helpPanel.ts`, add a zoom row group. Insert a new group into the `GROUPS` array (after the `help.tools` group, before the closing `];` on line 42):

```ts
  { titleKey: "help.tools", rows: [
    { keys: [MOD, "−"], labelKey: "cmd.zoomOut" },
    { keys: [MOD, "+"], labelKey: "cmd.zoomIn" },
    { keys: [MOD, "0"], labelKey: "cmd.zoomReset" },
  ] },
```

- [ ] **Step 7: Verify build + full test suite**

Run: `npm run build` → Expected: passes.
Run: `npx vitest run` → Expected: all PASS.

- [ ] **Step 8: Manual verification end-to-end**

Run: `npm run tauri dev`. Open Settings (⚙) → change "UI size" to 125% → the whole interface scales. Quit and relaunch → the 125% UI size and any editor zoom both persist. Open Help (F1) → the three zoom shortcuts are listed.

- [ ] **Step 9: Commit**

```bash
git add src/i18n/i18n.ts src/workspace/settingsPanel.ts src/main.ts src/workspace/helpPanel.ts
git commit -m "feat(settings): UI size control, zoom shortcuts in help, i18n"
```

---

## Self-Review

**Spec coverage:**
- A. macOS launch fix → Task 1. ✓
- B-1. editor font zoom (`Cmd+−/=/0`, var, headings scale, help entries) → Tasks 3 (zoom) + 7 (help). ✓
- B-2. UI scale rem refactor (`html` font-size, token conversion, keep-px list, Settings select) → Tasks 4 + 7. ✓
- Composition model (`ui_scale × editor_font_scale`) → editorTheme `calc(1rem * --editor-font-scale)` with `1rem` scaled by `--ui-scale`. ✓
- Data model (`uiScale`, `editorFontScale`, Optional) → Tasks 5 (Rust) + 6 (TS). ✓
- i18n parity (4 keys × 4 locales) → Task 7. ✓
- Tests (`scale.ts` helpers, Rust roundtrip) → Tasks 2 + 5. ✓
- Persisted-value safety (clamp on apply/load) → `apply*` go through clamps; `restore` clamps. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; the rem conversion gives an explicit divisor, a conversion table, worked examples, and a keep-px list rather than "convert appropriately."

**Type consistency:** `applyUiScale`/`currentUiScale`/`applyEditorFontScale`/`currentEditorFontScale` names are consistent across Tasks 3, 4, 6. `uiScale`/`editorFontScale` field names match across Rust (`ui_scale`/`editor_font_scale` camelCased), the TS `Settings` interface, `settingsSnapshot`, and the `restore` literal. `UI_SCALE_STEPS`/`clampUiScale`/`stepEditorFontScale` signatures match their `scale.ts` definitions.

## Out of Scope (future streams)

Stream 3 (curated customization: accent color, sepia/high-contrast themes, focus mode), Stream 4 (performance), Stream 5 (competitive feature gaps) — each gets its own spec + plan.
