# Design: macOS launch-file fix · editor font zoom · UI scale

Date: 2026-06-29
Status: Approved (design); pending spec review
Scope: "quick-fixes batch" — streams 1 + 2 of a larger decomposition (see Out of Scope)

## Context

Rune is a Tauri 2 + CodeMirror 6 markdown editor. This batch fixes one real
defect and adds two related sizing controls. All current sizes in the app are
hardcoded `px` (e.g. `editorTheme.ts:7` `.cm-scroller` is `16px`, sidebar is
`13px`); colors/spacing are CSS custom-property tokens. That token-based CSS is
the foundation the UI-scale change builds on.

This spec covers three changes:
- **A.** Fix `.md` double-click not opening the file on macOS.
- **B-1.** Editor font zoom via `Cmd+−` / `Cmd+=` / `Cmd+0`.
- **B-2.** App-wide UI scale, set in Settings, implemented as a px→rem refactor.

## A. macOS file-association open fix

### Root cause
On macOS cold launch the OS delivers the file path via `RunEvent::Opened`
(`lib.rs:73`), **not** via `argv`. The current handler only `emit`s an
`open-file` event. That event fires before the webview JS has registered its
listener (`main.ts:787`), so it is dropped — the app opens but the file does
not. The `LaunchFile` buffer that covers the Windows/Linux argv path
(`lib.rs:25,51`) is never populated on macOS.

### Fix
1. Add an app-ready flag: `pub struct AppReady(pub std::sync::atomic::AtomicBool)`
   managed in state, default `false`.
2. In the `RunEvent::Opened` handler: for each resolved path,
   - if **not** ready, store it into `LaunchFile` state
     (`app.try_state::<LaunchFile>()`), then
   - always `emit("open-file", path)` (covers warm launches).
3. `take_launch_file` (called once during `restore()`, `main.ts:658`) sets
   `AppReady = true` as a side effect, so any later OS open event is delivered
   live rather than buffered.

### Why it is safe
- Cold launch: the path is buffered → `take_launch_file()` drains it on startup
  → opened. A duplicate `open-file` event (if the listener happened to be ready)
  is harmless because `openOrFocus` deduplicates by path (`tabs.ts`) — it just
  focuses the existing tab.
- Warm launch (app already running, user double-clicks another `.md`): ready is
  `true`, so the path is emitted only, not buffered → no stale path lingers to
  be re-opened on a future restart.

### Files
- `src-tauri/src/lib.rs` — add `AppReady` state, update the `Opened` handler
  (~6 lines).
- `src-tauri/src/commands.rs` — `take_launch_file` flips `AppReady` to true.

### Verification
Manual: set Rune as the default `.md` handler, fully quit, double-click a `.md`
from Finder → file opens. Repeat with Rune already running.

## B. Sizing model

Two independent knobs that **compose**:

- **UI scale** (Settings) — drives `html { font-size }`; every rem-based size
  (chrome + editor base font) scales together.
- **Editor font zoom** (`Cmd+−/=/0`) — an editor-only multiplier layered on top.

Effective editor text size = `UI scale × editor font scale`. Chrome scales with
UI scale only. (If the user later prefers fully independent knobs, drop the
editor's dependence on `1rem` — but composition is the approved default.)

Both values persist in settings and clamp on load.

### B-1. Editor font zoom

- `editorTheme.ts` `.cm-scroller` font-size → `calc(1rem * var(--editor-font-scale, 1))`.
  Headings/code already use `em`, so they scale proportionally. CodeMirror
  re-measures on font change, so there are no coordinate issues.
- Keymap in the existing `main.ts` `window` keydown handler (alongside the other
  app shortcuts):
  - `Cmd/Ctrl` + `-` → decrease
  - `Cmd/Ctrl` + `=` (and `+`) → increase
  - `Cmd/Ctrl` + `0` → reset to 1.0 (`Cmd+1–9` already switch tabs; `0` is free)
- Sets `--editor-font-scale` on `:root`; persists `editorFontScale`.
- Steps of 0.1, clamped to `[0.75, 1.75]`.
- Add the three shortcuts to the Help panel (`helpPanel.ts`).

### B-2. UI scale (px → rem refactor)

- `html { font-size: calc(16px * var(--ui-scale, 1)); }`, default `--ui-scale: 1`.
- Convert `styles.css` and `editorTheme.ts` per this rule:
  - **Convert to rem** (`px / 16`): all `font-size` values; control
    `padding`/`gap`/`border-radius`; dialog/card widths — everything that should
    grow with the UI.
  - **Keep px**: `1px`/`2px` borders; drag-resizer hit areas (`6px`); the
    JS-driven layout vars (`--sidebar-width`, `--outline-height`,
    `--split-source-width`) and the `MIN`/`MAX` constants in `main.ts` (these are
    physical drag pixels, independent of UI scale); `--editor-max` readable
    measure (a typographic constant); `vw`/`vh`/`%` values.
- Settings panel: new "UI 크기" row, a `<select>` with `80 / 90 / 100 / 110 /
  125 / 150 %` (default 100). On change set `--ui-scale` and persist `uiScale`.
- `clampUiScale` snaps loaded values to the nearest allowed step (corrupt/old
  values fall back to 1.0).

## Data model

Add two optional fields (so older settings files stay compatible — both default
to `None`/unset):

- Rust `settings.rs` `Settings`: `ui_scale: Option<f32>`, `editor_font_scale: Option<f32>`
  (serde camelCase → `uiScale`, `editorFontScale`).
- TS `ipc/bindings.ts` `Settings` interface: `uiScale: number | null`,
  `editorFontScale: number | null`.
- `main.ts` `settingsSnapshot()` writes both; `restore()` reads, clamps, and
  applies both before content loads (so there is no resize flash).

## Internationalization

New keys in all four locales (`i18n.ts`), enforced by `i18n/parity.test.ts`:
- `settings.uiScale` (Settings row label)
- `cmd.zoomIn`, `cmd.zoomOut`, `cmd.zoomReset` (Help panel labels)

## Testing

- New `src/theme/scale.ts` with pure helpers `clampUiScale`,
  `clampEditorFontScale`, `stepEditorFontScale(current, dir)` →
  `src/theme/scale.test.ts` (clamping bounds, step direction, snap-to-nearest).
- Extend the Rust settings roundtrip test (`settings.rs`) to set and read back
  `ui_scale` / `editor_font_scale`, and confirm an older file lacking them loads
  as `None`.
- Existing 181 frontend tests + Rust tests must stay green.

## Files touched

`src-tauri/src/lib.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/settings.rs`,
`src/ipc/bindings.ts`, `src/theme/editorTheme.ts`, `src/theme/scale.ts` (new),
`src/styles.css` (bulk px→rem), `src/main.ts` (keymap + apply + restore),
`src/workspace/settingsPanel.ts`, `src/i18n/i18n.ts`, `src/workspace/helpPanel.ts`,
plus `scale.test.ts` (new).

## Risks

- **rem refactor breadth.** Broad mechanical edit to `styles.css`; risk of visual
  regression. Mitigation: convert systematically (`px / 16`), then verify light
  and dark at 100% look pixel-identical to before, then exercise the scale steps.
- **Editor padding/measure under scale.** Verify the editor content column and
  padding still look right at 80% and 150%.
- **Persisted-value safety.** All three CSS vars are applied through clamps, so a
  corrupt settings value can never produce an unusable UI.

## Out of scope (future streams)

Recorded from the decomposition; each gets its own spec later:
- **Stream 3 — curated customization:** custom accent color, 1–2 extra themes
  (sepia / high-contrast), focus/zen mode. (Explicitly *not* a full
  theme/layout engine — that conflicts with Rune's "quiet, recedes" identity.)
- **Stream 4 — performance:** live-preview decoration rebuilds, math full-text
  regex, split-preview full re-render per keystroke.
- **Stream 5 — competitive feature gaps:** research-led, against commercial `.md`
  apps.
