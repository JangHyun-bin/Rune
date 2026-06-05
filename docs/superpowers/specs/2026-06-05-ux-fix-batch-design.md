# Rune UX Fix & Feature Batch — Design Spec

> Status: **Design (approved-pending-review)** · Date: 2026-06-05 · Target release: **v0.1.4**
> Author: Hyunbin Jang (with Claude) · Supersedes: none

## 1. Background & motivation

External user feedback (kurthong, 2026-06-05) reported three problems, all **verified in source** via a systematic-debugging investigation (9/9 root-cause hypotheses confirmed by adversarial review, 0 refuted):

1. **Rendering often doesn't work** — the inline live preview implements only a subset of markdown.
2. **Document alignment (centered vs full-width) is mixed with no clear rule.**
3. **The left workspace sidebar shows nothing when a file/folder is opened, and guidance is lacking.**

During design the author added three feature requests:

4. **Auto-update / check-for-updates** — so users don't have to revisit GitHub Releases manually.
5. **"Reveal in file explorer"** (open in Explorer/Finder).
6. **Right-click context menu + a coherent keyboard-shortcut scheme.**

This spec batches all of it into one phased release.

### Confirmed root causes (evidence summary)

| # | Symptom | Root cause (file:line) |
|---|---|---|
| ① | mixed center/full-width | `EditorView.lineWrapping` absent everywhere; `.cm-content{max-width:720px;margin:0 auto}` (`editorTheme.ts:8`) → long single-logical-lines overflow & scroll. Plus inconsistent block alignment (`editorTheme.ts:25-31`). |
| ② | rendering gaps | Lists/ordered/task/HR/setext have **no** handling (`livePreview.ts`); inline link URL not hidden (`livePreview.ts:60-62`); math is doc-wide regex, false-positives on `$5` (`math.ts:26-27`); blockquote styles first line only (`livePreview.ts:55-58`); table col-align ignored (`table.ts`); unsaved-doc relative images broken (`image.ts:16`). |
| ③ | empty/silent workspace | Opening a single file never loads a folder (`main.ts:122-125,240`); `scan_dir` lists `.md`/`.markdown` only (`fs_ops.rs:93`); empty tree has no empty-state (`fileTree.ts:35-48`); all failures are `console.error`/swallowed (`main.ts:110,134,143,230,266`). |

## 2. Goals / non-goals

**Goals**
- Make the live preview render the common markdown surface consistently (lists, tasks, links, math, multi-line quotes).
- Make alignment predictable: wrap long lines; offer a readable-width ↔ full-width toggle; unify block alignment.
- Make the workspace useful and self-explanatory: auto-load a file's folder, empty/first-run guidance, surfaced errors, reveal-in-explorer, right-click actions, file operations.
- In-app auto-update (check on launch + on demand, install with consent).
- Coherent, discoverable keyboard shortcuts.

**Non-goals (this batch)**
- Focus mode, document outline, plugin system (separate future plans).
- Non-markdown file support in the tree.
- Reworking the export pipeline beyond what rendering parity needs.
- macOS auto-update **shipping** (config is wired but gated — see §6.3 decision 3).

## 3. Resolved design decisions

| Decision | Choice |
|---|---|
| Organization | One spec, phased **P0 → P1 → P2**; each phase independently shippable. |
| Auto-update UX | Check on launch (after content loads) + manual button in Settings → on update found, **banner with consent** → download w/ progress → relaunch. |
| Auto-update phase | **P1** (this release). |
| List rendering | **Full**: `•` bullets, ordered numbers, **clickable task checkboxes** (toggle `[ ]`↔`[x]`). |
| Math fix | **Syntax-tree-aware + pandoc boundary rules** (exclude code spans/blocks; reject `$`+space/digit). |
| Context menu file ops | **Build new backend commands** (rename / delete / new file / new folder). |
| macOS auto-update | **(a) Windows + Linux first**; macOS gated until notarization is restored in CI. |
| Readable-width default | `readable` (720px centered) ON by default; persisted in settings.json. |
| Error surfacing | Lightweight banner/toast (reuse `conflictBanner` pattern) for failed load/read. |
| Delete safety | Move to OS trash/recycle bin (via `trash` crate) + confirm dialog, not permanent unlink. |

## 4. Phased scope

### Phase P0 — low-risk, immediate feel
- ①-1 `EditorView.lineWrapping`.
- ①-2 Readable-width ↔ full-width toggle (settings field + control + persist).
- ①-3 Unify block alignment + horizontal-scroll wrappers for tables/code.
- ③-1 Open-file auto-loads its parent folder (when no workspace folder is loaded).
- ③-2 Empty / first-run / failed states in the file tree (message + "Open Folder" button; distinguish loading vs empty vs error).
- ③-3 Surface folder-load / file-read failures (banner/toast) instead of console-only.
- ③-4 Reveal in file explorer (`opener.revealItemInDir`) via command + (later) context menu.

### Phase P1 — core features
- ②-1 List / ordered / **clickable task checkbox** rendering.
- ②-2 Inline link: hide URL when cursor off-line; show styled link text only.
- ②-3 Math: syntax-tree-aware + boundary rules.
- ②-4 Multi-line blockquote styling.
- ③-5 Right-click context menu (file / folder / tab) — incl. **rename / delete / new file / new folder** (new backend).
- ③-6 Keyboard-shortcut scheme (tab switching, width toggle) + `helpPanel` update.
- ④ Auto-update (check + consent install + manual button), Win+Linux; macOS gated.

### Phase P2 — polish / edges
- ②-5 Table column alignment (`:--:`).
- ②-6 Unsaved-doc image placeholder.
- ②-7 Unknown code-language handling.
- ③-7 Deleted / non-UTF-8 file click guidance; empty-directory pruning; stale tree/palette cleanup.
- ①-4 Remaining alignment-policy edge cases.

## 5. Detailed design by area

### 5.1 Alignment (①)

- **Line wrapping:** add `EditorView.lineWrapping` to the extension list in `editor.ts`. No other change needed for wrapping.
- **Width toggle:**
  - `settings.rs`: add `editor_width: Option<String>` (values `"readable" | "wide"`, default `readable`). Update `bindings.ts` `Settings`, `main.ts` `settingsSnapshot()`, and `restore()`.
  - Apply by toggling a class/data-attr on the editor container (or a CodeMirror theme variant): `readable` → `.cm-content{max-width:720px;margin:0 auto}`, `wide` → `max-width:none`.
  - Controls: Settings panel row (dropdown/segmented), status-bar toggle, command-palette command, shortcut (Ctrl/Cmd+Shift+L).
- **Block alignment policy:** body/headings/lists/tables/code left-aligned; math-block and Mermaid centered (the only intentionally-centered "figure-like" blocks). Wrap `.cm-md-table` and `.cm-md-codeblock` in an overflow-x:auto container so wide content scrolls within the column instead of breaking layout.

### 5.2 Rendering (②)

- **Lists (`livePreview.ts`):** handle `BulletList`/`OrderedList`/`ListItem`/`ListMark`. Bullet marker → `•` (styled), ordered numbers kept and aligned, indentation via padding. **Task list:** detect `- [ ]` / `- [x]`; render a clickable checkbox widget; on click dispatch a doc change toggling the marker; show raw when cursor is on the line. Checkbox widget lives in `blockWidgets.ts` or a new `taskList.ts`; extract the marker-toggle as a pure function for unit testing.
- **Inline link:** when the link's line is not active, hide the `(url)` (and brackets/parens) and render only the link text with link styling; when active, show raw. Adjust `HIDDEN_MARKS`/URL handling so URL is replaced (not merely marked) off-line.
- **Math (`math.ts`):** rewrite `build()` to walk the syntax tree, skip ranges inside `InlineCode`/`FencedCode`/`CodeText`, and apply pandoc-style boundary rules (opening `$` not followed by whitespace/digit; closing `$` not preceded by whitespace; `$$` block unaffected). Extract the "is this a real math span" decision into a pure, unit-tested function.
- **Multi-line blockquote:** iterate all lines of the `Blockquote` node (mirror the `FencedCode` loop) so continuation lines get `cm-md-quote`.
- **(P2)** Table `:--:` → per-column `text-align`; unsaved image → alt/placeholder; unknown lang → label/plain.

### 5.3 Workspace / UX (③)

- **Auto-load parent folder:** in `openPath`/`openFile`/`takeLaunchFile`, if `currentFolder` is null, call `loadFolder(parentDir(path))` so opening any file populates the tree. Never override an explicitly chosen folder.
- **Empty/first-run/error states (`fileTree.ts`):** render distinct states — *loading* (transient), *empty folder* (message + "Open Folder" button + hint that only `.md`/`.markdown` show), *no folder yet* (first-run guidance), *error* (message + retry). Requires `render()` to know which state (pass a status, or a small state enum from `main.ts`).
- **Error surfacing:** new `errorBanner.ts` (or extend `conflictBanner`) shown by `main.ts` on `loadFolder`/`readFile`/`saveAsset` failures, replacing silent `console.error`. Distinguish "empty" from "failed".
- **Reveal in explorer:** `opener.revealItemInDir(path)`; add capability `opener:allow-reveal-item-in-dir` (+ `opener:allow-open-path` for "open with default app"). Exposed via context menu + palette command.
- **Context menu (`contextMenu.ts`, new):** generic right-click menu component (position, keyboard dismiss, click-outside). Items:
  - File row: Open · Reveal in Explorer · Copy Path · Rename · Delete
  - Folder row: New File · New Folder · Reveal in Explorer · Rename · Delete
  - Tab: Close · Close Others · Copy Path · Reveal in Explorer
- **New backend file operations (`fs_ops.rs` + `commands.rs`):**
  - `rename_path(from, to)` — validate `to` parent exists and `to` doesn't exist; `fs::rename`.
  - `delete_path(path)` — **move to OS trash** via the `trash` crate (reversible); confirm dialog in UI first.
  - `create_file(dir, name)` — create empty `.md` (reject existing, sanitize name).
  - `create_dir(dir, name)` — `fs::create_dir`.
  - All return `Result<…, String>`; path-safety checks; the existing folder watcher (`fs-change`) refreshes the tree, with an explicit `loadFolder` fallback. Add `tempfile`-based unit tests mirroring existing `fs_ops` tests.
- **Keyboard shortcuts:** consolidate the `main.ts` keydown handler + the CodeMirror keymap; update `helpPanel`. Cross-platform (Cmd on macOS).

  | Action | Shortcut |
  |---|---|
  | Command palette | Ctrl/Cmd+K *(existing)* |
  | Open file / folder | Ctrl/Cmd+O / Ctrl/Cmd+Shift+O *(existing)* |
  | New / Save / Close tab | Ctrl/Cmd+N / +S / +W *(existing)* |
  | Export HTML | Ctrl/Cmd+E *(existing)* |
  | Search / Help | Ctrl/Cmd+Shift+F / F1 *(existing)* |
  | **Next / Prev tab** | **Ctrl/Cmd+Tab / Ctrl/Cmd+Shift+Tab** *(new)* |
  | **Go to tab 1–9** | **Ctrl/Cmd+1 … 9** *(new)* |
  | **Toggle editor width** | **Ctrl/Cmd+Shift+L** *(new)* |
  | Reveal in Explorer / Check for updates | via palette + menu *(no global key)* |

### 5.4 Auto-update (④)

**Dependencies / registration**
- Cargo: `tauri-plugin-updater`, `tauri-plugin-process` (desktop-gated). npm: `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`. Register in `lib.rs` (desktop only).

**Config (`tauri.conf.json`)**
```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<contents of rune-updater.key.pub>",
      "endpoints": [
        "https://github.com/JangHyun-bin/Rune/releases/latest/download/latest.json"
      ],
      "windows": { "installMode": "passive" }
    }
  }
}
```
*(pubkey is the key **content**, not a path.)*

**Capabilities (`capabilities/default.json`)**: add `updater:default`, `process:default` (the latter provides `process:allow-restart`).

**Signing keypair (one-time, author)**
- `npm run tauri signer generate -- -w rune-updater.key` → `rune-updater.key` (private) + `rune-updater.key.pub` (public).
- Store private key + password under `D:\HB\Rhizome\rune-signing\`; confirm it is git-ignored. Public key content → `tauri.conf.json` `pubkey`.

**CI (`.github/workflows/release.yml`)**
- Build step env adds `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (new repo secrets).
- `tauri-action`: keep `uploadUpdaterJson` (default true); set `updaterJsonPreferNsis: true` (we ship NSIS). Release stays published (non-draft) so `latest.json` is fetchable by tag.

**Frontend flow (`updatePanel.ts` / banner, new)**
```ts
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

const update = await check();          // Update | null
if (update?.available) {               // show banner: "vX available [Update now] [Later]"
  await update.downloadAndInstall((e) => { /* Started/Progress/Finished → progress UI */ });
  await relaunch();
}
```
- Trigger: once on launch after `restore()`; plus a Settings "Check for updates" button showing current version + result.
- i18n keys for all strings (en/ko/ja/zh).

**Platform gating (decision 3a)**
- Windows (NSIS) + Linux (AppImage): full auto-update.
- macOS: **in-app auto-install disabled** until CI notarization is restored — on macOS, finding an update shows a "Download from Releases" link (manual) instead of `downloadAndInstall`. Flip to full auto-update once `release.yml` notarization works (see `notarization-ci-disabled` note). deb/rpm: never auto-update (manual; documented).

## 6. Risks, dependencies, open items

1. **macOS notarization** is currently disabled in CI (manual `notarize.ps1`); macOS auto-update is gated on restoring it. Tracked separately.
2. **Updater is non-retroactive:** only builds that embed the pubkey (v0.1.4+) can auto-update to later versions. v0.1.3 and earlier users must download v0.1.4 once manually.
3. **Interactive task checkboxes** add edit-dispatch complexity inside the live-preview decoration layer — keep the toggle logic pure and well-tested; guard cursor/selection interplay.
4. **Backend fs mutations** (rename/delete/create) need path-safety and reliable tree refresh; `trash` crate adds a dependency (acceptable for safe deletes).
5. **Node test env:** CodeMirror/DOM behaviors can't run under `environment:"node"`; mitigate by extracting pure functions; cover UI via manual/browse checks.

## 7. Testing strategy

- **Vitest (pure):** math span decision (boundary + code-exclusion), task-marker toggle, list/link decoration builders where extractable, width-toggle settings round-trip, new i18n keys, context-menu item assembly.
- **Rust:** `rename_path`/`delete_path`/`create_file`/`create_dir` unit tests (tempfile), path-safety/error cases — mirroring existing `fs_ops` tests.
- **Manual / browse:** live-preview visuals, context menu, reveal, and an end-to-end auto-update against a throwaway test release.
- Keep all 45 existing tests green.

## 8. Affected files

Frontend: `editor/editor.ts`, `editor/livePreview.ts`, `editor/math.ts`, `editor/table.ts`, `editor/blockWidgets.ts` (+ new `editor/taskList.ts`), `editor/image.ts`, `theme/editorTheme.ts`, `styles.css`, `workspace/fileTree.ts`, `workspace/settingsPanel.ts`, `workspace/tabBar.ts`, `main.ts`, `i18n/i18n.ts`, `ipc/bindings.ts`; new `workspace/contextMenu.ts`, `workspace/errorBanner.ts`, `workspace/updatePanel.ts`.
Rust: `settings.rs`, `commands.rs`, `fs_ops.rs`, `lib.rs`, `capabilities/default.json`, `tauri.conf.json`, `Cargo.toml`.
CI/build: `.github/workflows/release.yml`. Version bump to `0.1.4` in `package.json`, `Cargo.toml`, `tauri.conf.json`.

## 9. Out of scope (future)
Focus mode · document outline · plugin system · non-markdown files in tree · macOS auto-update shipping (until notarization).
