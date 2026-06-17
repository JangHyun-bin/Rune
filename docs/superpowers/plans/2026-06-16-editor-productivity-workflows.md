# Rune Editor Productivity Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the next productivity layer for Rune: common Markdown editing shortcuts, source/preview/split layout controls, visible workspace creation/open controls, horizontal-rule rendering, release workflow hardening, and a scoped slash-command foundation.

**Architecture:** Keep editor behavior in focused CodeMirror modules, keep workspace DOM controls in `src/workspace/*`, and let `src/main.ts` only orchestrate state, persistence, and command wiring. Split preview reuses the existing export renderer so the right preview pane matches HTML/PDF export behavior. Release hardening is handled separately from app behavior and should be log-driven because recent release runs are currently successful.

**Tech Stack:** Tauri 2, TypeScript 5.6, CodeMirror 6, Vitest 4, Rust filesystem commands already exposed through Tauri IPC, GitHub Actions, `gh` CLI.

---

## Scope Decisions

This is one product batch, but it should land as separate commits because the subsystems are independent:

1. Markdown editing shortcuts.
2. Layout mode UI plus split preview.
3. Workspace action bar and creation affordances.
4. Horizontal rule support in live preview and export tests.
5. Release workflow hardening only if logs reproduce the token-pool failure.
6. Slash commands after the layout/workspace pieces are stable.

Multi-root workspaces are out of this batch. "Workspace add/change/open" means a visible Open/Change Folder control, root-level New File/New Folder controls, and command-palette entries. True multi-root storage would require a settings-schema and file-tree model change and should be its own plan.

---

## Current State Inventory

- `src/editor/editor.ts` currently supports `EditorMode = "preview" | "source"`. Preview mode enables live preview widgets; source mode disables them.
- `src/main.ts` owns mode persistence, editor recreation, sidebar width persistence, file tree refresh, command palette, update checks, and global shortcuts.
- `src/workspace/settingsPanel.ts` already exposes the editor mode setting, but only as a select in Settings.
- `index.html` has `#tabbar` and `#editor` inside `#main-col`; there is no top-right layout control yet.
- `src/export/render.ts` strips YAML front matter only when it starts on line 1 and has a closing `---` or `...`; markdown-it should render body `---` as `<hr>`.
- CodeMirror's Markdown parser emits `HorizontalRule` for a body thematic break.
- Workspace create/rename/delete is mostly present already:
  - `src-tauri/src/fs_ops.rs` has `create_file`, `create_dir`, `rename`, and trash delete.
  - `src-tauri/src/commands.rs` exposes `create_file` and `create_dir`.
  - `src/ipc/bindings.ts` exposes `commands.createFile` and `commands.createDir`.
  - `src/main.ts` wires right-click folder menu items to `newFileIn()` and `newFolderIn()`.
- Recent `release.yml` runs for `v0.1.5` through `v0.1.9` succeeded. Treat "unable to select next github token from pool" as a regression to reproduce from logs before changing the workflow.

---

## File Structure

### Create

- `src/editor/markdownCommands.ts`
  - Pure text helpers and CodeMirror commands for bold, italic, indent, and outdent.
- `src/editor/markdownCommands.test.ts`
  - Unit tests for wrapping/unwrapping inline markers and line indentation ranges.
- `src/workspace/layoutModeControl.ts`
  - Segmented control for `Live Preview`, `Source`, and `Split`.
- `src/workspace/layoutModeControl.test.ts`
  - DOM/pure tests for mode normalization and selected-state rendering.
- `src/editor/splitPreview.ts`
  - Mount/update/destroy helper for the split preview pane.
- `src/editor/horizontalRule.ts`
  - `BlockSpec` for `HorizontalRule` live preview rendering.
- `src/editor/horizontalRule.test.ts`
  - Unit tests for the horizontal-rule matcher and DOM renderer.
- `src/workspace/fileTree.test.ts`
  - DOM tests for workspace header actions.
- `src/editor/slashCommands.ts`
  - Pure slash-command detection and snippet insertion model.
- `src/editor/slashCommands.test.ts`
  - Unit tests for slash-command trigger detection and snippets.

### Modify

- `src/editor/editor.ts`
  - Add `split` mode support, register markdown shortcut keymap, and register `horizontalRuleSpec`.
- `src/main.ts`
  - Mount layout mode control, split preview, workspace header actions, and new command-palette entries.
- `src/workspace/settingsPanel.ts`
  - Allow `split` mode in Settings or delegate display to the new layout control while keeping Settings in sync.
- `src/workspace/fileTree.ts`
  - Add a persistent workspace header action row.
- `src/workspace/helpPanel.ts`
  - Document `Ctrl/Cmd+B`, `Ctrl/Cmd+I`, `Tab`, `Shift+Tab`, and split layout shortcut if added.
- `src/i18n/i18n.ts`
  - Add labels for editor mode `Split`, layout control, workspace action buttons, and shortcut help.
- `src/ipc/bindings.ts`
  - No new command needed for file/folder creation; add only if a recent-folders feature is introduced.
- `src/styles.css`
  - Add layout control, split pane, preview pane, workspace header, and horizontal-rule styles.
- `src/export/render.test.ts`
  - Add regression tests for body horizontal rules and front matter.
- `.github/workflows/release.yml`
  - Only change after log reproduction; likely split matrix build from serialized publish if needed.

---

## Task 1: Markdown Editing Shortcuts

**Files:**
- Create: `src/editor/markdownCommands.ts`
- Create: `src/editor/markdownCommands.test.ts`
- Modify: `src/editor/editor.ts`
- Modify: `src/workspace/helpPanel.ts`
- Modify: `src/i18n/i18n.ts`

- [ ] **Step 1: Write failing tests for inline marker toggles**

Create `src/editor/markdownCommands.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { indentSelectedLines, outdentSelectedLines, toggleInlineMarker } from "./markdownCommands";

describe("toggleInlineMarker", () => {
  it("wraps selected text with italic markers", () => {
    expect(toggleInlineMarker("hello world", { from: 0, to: 5 }, "*")).toEqual({
      text: "*hello* world",
      range: { from: 1, to: 6 },
    });
  });

  it("unwraps selected italic text when the marker is already present", () => {
    expect(toggleInlineMarker("*hello* world", { from: 1, to: 6 }, "*")).toEqual({
      text: "hello world",
      range: { from: 0, to: 5 },
    });
  });

  it("wraps selected text with bold markers", () => {
    expect(toggleInlineMarker("hello", { from: 0, to: 5 }, "**")).toEqual({
      text: "**hello**",
      range: { from: 2, to: 7 },
    });
  });
});

describe("line indentation", () => {
  it("indents every touched line by two spaces", () => {
    expect(indentSelectedLines("one\ntwo\nthree", { from: 4, to: 7 })).toEqual({
      text: "one\n  two\nthree",
      range: { from: 6, to: 9 },
    });
  });

  it("outdents two leading spaces from every touched line", () => {
    expect(outdentSelectedLines("one\n  two\n  three", { from: 6, to: 15 })).toEqual({
      text: "one\ntwo\nthree",
      range: { from: 4, to: 11 },
    });
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```powershell
npm test -- markdownCommands
```

Expected: FAIL because `src/editor/markdownCommands.ts` does not exist.

- [ ] **Step 3: Implement pure text helpers**

Create `src/editor/markdownCommands.ts` with these exported helpers first:

```ts
import { EditorSelection, type Extension, type SelectionRange, StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";

export interface TextRange { from: number; to: number; }
export interface TextEditResult { text: string; range: TextRange; }

export function toggleInlineMarker(text: string, range: TextRange, marker: "*" | "**"): TextEditResult {
  const selected = text.slice(range.from, range.to);
  const before = text.slice(range.from - marker.length, range.from);
  const after = text.slice(range.to, range.to + marker.length);

  if (before === marker && after === marker) {
    return {
      text: text.slice(0, range.from - marker.length) + selected + text.slice(range.to + marker.length),
      range: { from: range.from - marker.length, to: range.to - marker.length },
    };
  }

  return {
    text: text.slice(0, range.from) + marker + selected + marker + text.slice(range.to),
    range: { from: range.from + marker.length, to: range.to + marker.length },
  };
}

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
}

function nextLineStart(text: string, pos: number): number {
  const next = text.indexOf("\n", pos);
  return next === -1 ? text.length : next + 1;
}

function touchedLineStarts(text: string, range: TextRange): number[] {
  const starts: number[] = [];
  let at = lineStart(text, range.from);
  const end = range.to > range.from ? lineStart(text, range.to - 1) : lineStart(text, range.to);
  while (at <= end) {
    starts.push(at);
    const next = nextLineStart(text, at);
    if (next <= at || next > text.length) break;
    at = next;
  }
  return starts;
}

export function indentSelectedLines(text: string, range: TextRange, unit = "  "): TextEditResult {
  const starts = touchedLineStarts(text, range);
  let nextText = text;
  let addedBeforeFrom = 0;
  let addedBeforeTo = 0;

  for (let i = starts.length - 1; i >= 0; i--) {
    nextText = nextText.slice(0, starts[i]) + unit + nextText.slice(starts[i]);
  }
  for (const start of starts) {
    if (start <= range.from) addedBeforeFrom += unit.length;
    if (start <= range.to) addedBeforeTo += unit.length;
  }
  return { text: nextText, range: { from: range.from + addedBeforeFrom, to: range.to + addedBeforeTo } };
}

export function outdentSelectedLines(text: string, range: TextRange, unit = "  "): TextEditResult {
  const starts = touchedLineStarts(text, range);
  let nextText = text;
  let removedBeforeFrom = 0;
  let removedBeforeTo = 0;

  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i];
    const remove = nextText.slice(start, start + unit.length) === unit ? unit.length : nextText[start] === "\t" ? 1 : 0;
    if (remove === 0) continue;
    nextText = nextText.slice(0, start) + nextText.slice(start + remove);
    if (start < range.from) removedBeforeFrom += remove;
    if (start < range.to) removedBeforeTo += remove;
  }

  return {
    text: nextText,
    range: {
      from: Math.max(lineStart(nextText, range.from - removedBeforeFrom), range.from - removedBeforeFrom),
      to: Math.max(0, range.to - removedBeforeTo),
    },
  };
}
```

- [ ] **Step 4: Run tests until the pure helpers pass**

Run:

```powershell
npm test -- markdownCommands
```

Expected: PASS.

- [ ] **Step 5: Add CodeMirror commands and keymap**

Append to `src/editor/markdownCommands.ts`:

```ts
function replaceWholeDoc(text: string, result: TextEditResult, range: SelectionRange) {
  return {
    changes: { from: 0, to: text.length, insert: result.text },
    selection: EditorSelection.range(result.range.from, result.range.to),
    scrollIntoView: true,
  };
}

function toggleMarkerCommand(marker: "*" | "**"): StateCommand {
  return ({ state, dispatch }) => {
    const range = state.selection.main;
    if (range.empty) return false;
    const text = state.doc.toString();
    dispatch(state.update(replaceWholeDoc(text, toggleInlineMarker(text, range, marker), range)));
    return true;
  };
}

const indentCommand: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  const text = state.doc.toString();
  dispatch(state.update(replaceWholeDoc(text, indentSelectedLines(text, range), range)));
  return true;
};

const outdentCommand: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  const text = state.doc.toString();
  dispatch(state.update(replaceWholeDoc(text, outdentSelectedLines(text, range), range)));
  return true;
};

export function markdownShortcutKeymap(): Extension {
  return keymap.of([
    { key: "Mod-b", run: toggleMarkerCommand("**"), preventDefault: true },
    { key: "Mod-i", run: toggleMarkerCommand("*"), preventDefault: true },
    { key: "Tab", run: indentCommand, preventDefault: true },
    { key: "Shift-Tab", run: outdentCommand, preventDefault: true },
  ]);
}
```

- [ ] **Step 6: Wire keymap into the editor**

In `src/editor/editor.ts`, import the keymap:

```ts
import { markdownShortcutKeymap } from "./markdownCommands";
```

Add it before the default keymap so Rune handles these first:

```ts
      markdownShortcutKeymap(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
```

- [ ] **Step 7: Update shortcut help and i18n**

In `src/workspace/helpPanel.ts`, add rows under `help.editing`:

```ts
    { keys: [MOD, "B"], labelKey: "help.bold" },
    { keys: [MOD, "I"], labelKey: "help.italic" },
    { keys: ["Tab"], labelKey: "help.indent" },
    { keys: [SHIFT, "Tab"], labelKey: "help.outdent" },
```

In `src/i18n/i18n.ts`, add these keys to every locale:

```ts
    "help.bold": "Bold",
    "help.italic": "Italic",
    "help.indent": "Indent",
    "help.outdent": "Outdent",
```

- [ ] **Step 8: Validate**

Run:

```powershell
npm test -- markdownCommands
npm test -- parity
npm run build
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/editor/markdownCommands.ts src/editor/markdownCommands.test.ts src/editor/editor.ts src/workspace/helpPanel.ts src/i18n/i18n.ts
git commit -m "feat(editor): add markdown editing shortcuts"
```

---

## Task 2: Layout Mode Control and Split Preview

**Files:**
- Create: `src/workspace/layoutModeControl.ts`
- Create: `src/workspace/layoutModeControl.test.ts`
- Create: `src/editor/splitPreview.ts`
- Modify: `src/editor/editor.ts`
- Modify: `src/main.ts`
- Modify: `src/workspace/settingsPanel.ts`
- Modify: `src/i18n/i18n.ts`
- Modify: `src/styles.css`
- Modify: `index.html`

- [ ] **Step 1: Write failing tests for mode normalization**

Create `src/workspace/layoutModeControl.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeEditorMode } from "./layoutModeControl";

describe("normalizeEditorMode", () => {
  it("accepts preview, source, and split", () => {
    expect(normalizeEditorMode("preview")).toBe("preview");
    expect(normalizeEditorMode("source")).toBe("source");
    expect(normalizeEditorMode("split")).toBe("split");
  });

  it("falls back to preview for unknown values", () => {
    expect(normalizeEditorMode(null)).toBe("preview");
    expect(normalizeEditorMode("bad")).toBe("preview");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
npm test -- layoutModeControl
```

Expected: FAIL because the file does not exist.

- [ ] **Step 3: Implement the layout mode control**

Create `src/workspace/layoutModeControl.ts`:

```ts
import type { EditorMode } from "../editor/editor";
import { t } from "../i18n/i18n";

export interface LayoutModeControl {
  setMode(mode: EditorMode): void;
  relabel(): void;
}

const MODES: EditorMode[] = ["preview", "source", "split"];

export function normalizeEditorMode(value: unknown): EditorMode {
  return value === "source" || value === "split" || value === "preview" ? value : "preview";
}

function labelForMode(mode: EditorMode): string {
  if (mode === "source") return t("editorMode.source");
  if (mode === "split") return t("editorMode.split");
  return t("editorMode.preview");
}

export function mountLayoutModeControl(
  parent: HTMLElement,
  getMode: () => EditorMode,
  onMode: (mode: EditorMode) => void,
): LayoutModeControl {
  const wrap = document.createElement("div");
  wrap.className = "layout-mode-control";
  parent.replaceChildren(wrap);

  function draw(): void {
    wrap.replaceChildren();
    for (const mode of MODES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "layout-mode-button" + (getMode() === mode ? " active" : "");
      button.textContent = labelForMode(mode);
      button.setAttribute("aria-pressed", String(getMode() === mode));
      button.addEventListener("click", () => onMode(mode));
      wrap.appendChild(button);
    }
  }

  draw();
  return {
    setMode: () => draw(),
    relabel: () => draw(),
  };
}
```

- [ ] **Step 4: Extend the editor mode type**

In `src/editor/editor.ts`:

```ts
export type EditorMode = "preview" | "source" | "split";
```

Then keep split's editor pane as raw source:

```ts
function modeExtensions(mode: EditorMode): Extension[] {
  if (mode === "source" || mode === "split") return [];
  return [
    livePreview,
    blockWidgets([horizontalRuleSpec, mermaidSpec, tableSpec]),
    mathField(),
    imagePreview(),
  ];
}
```

- [ ] **Step 5: Add split preview mount/update helper**

Create `src/editor/splitPreview.ts`:

```ts
import { renderBody } from "../export/render";

export interface SplitPreview {
  element: HTMLElement;
  update(markdown: string): void;
  destroy(): void;
}

export function mountSplitPreview(parent: HTMLElement): SplitPreview {
  const element = document.createElement("div");
  element.className = "split-preview";
  parent.appendChild(element);
  let seq = 0;
  let timer: number | undefined;

  function update(markdown: string): void {
    if (timer !== undefined) window.clearTimeout(timer);
    const id = ++seq;
    timer = window.setTimeout(() => {
      void renderBody(markdown).then((html) => {
        if (id === seq) element.innerHTML = html;
      });
    }, 120);
  }

  function destroy(): void {
    seq++;
    if (timer !== undefined) window.clearTimeout(timer);
    element.remove();
  }

  return { element, update, destroy };
}
```

- [ ] **Step 6: Add the toolbar mount point**

Change `index.html` inside `#main-col`:

```html
          <div id="editor-toolbar"></div>
          <div id="tabbar"></div>
          <div id="editor"></div>
```

- [ ] **Step 7: Wire split layout in `src/main.ts`**

Add imports:

```ts
import { mountLayoutModeControl, normalizeEditorMode } from "./workspace/layoutModeControl";
import { mountSplitPreview, type SplitPreview } from "./editor/splitPreview";
```

Add state:

```ts
let splitPreview: SplitPreview | null = null;
const editorRoot = document.getElementById("editor")!;
const editorToolbar = document.getElementById("editor-toolbar")!;
```

Mount the control after settings panel initialization:

```ts
const layoutModeControl = mountLayoutModeControl(editorToolbar, currentEditorMode, (mode) => applyEditorMode(mode));
```

Add a helper:

```ts
function syncEditorLayout(): HTMLElement {
  splitPreview?.destroy();
  splitPreview = null;
  editorRoot.replaceChildren();

  if (editorMode !== "split") {
    editorRoot.className = "";
    const pane = document.createElement("div");
    pane.className = "editor-pane";
    editorRoot.appendChild(pane);
    return pane;
  }

  editorRoot.className = "editor-split";
  const sourcePane = document.createElement("div");
  sourcePane.className = "editor-pane split-source";
  editorRoot.appendChild(sourcePane);
  splitPreview = mountSplitPreview(editorRoot);
  return sourcePane;
}
```

Update editor creation and mode switching so CodeMirror is mounted into `syncEditorLayout()` rather than directly into `#editor`. After every doc change and after `showActive()`, call:

```ts
splitPreview?.update(view.state.doc.toString());
layoutModeControl.setMode(editorMode);
```

In `restore()`, normalize settings:

```ts
editorMode = normalizeEditorMode(s.editorMode);
```

- [ ] **Step 8: Update Settings mode select**

In `src/workspace/settingsPanel.ts`, change:

```ts
    for (const v of ["preview", "source"] as const) {
```

to:

```ts
    for (const v of ["preview", "source", "split"] as const) {
```

and label `"split"` with `t("editorMode.split")`.

- [ ] **Step 9: Add i18n keys**

Add to every locale:

```ts
    "editorMode.split": "Split",
    "layout.mode": "Layout",
```

- [ ] **Step 10: Add CSS**

Append to `src/styles.css`:

```css
#editor-toolbar {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.layout-mode-control {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.layout-mode-button {
  border: 0;
  border-right: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  font-family: var(--sans);
  font-size: 12px;
  padding: 5px 9px;
  cursor: pointer;
}

.layout-mode-button:last-child {
  border-right: 0;
}

.layout-mode-button.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

#editor.editor-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 1fr);
}

.editor-pane {
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.split-source {
  border-right: 1px solid var(--border);
}

.split-preview {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 28px 36px;
  box-sizing: border-box;
  background: var(--bg);
  color: var(--text);
}
```

- [ ] **Step 11: Validate**

Run:

```powershell
npm test -- layoutModeControl
npm test -- --run
npm run build
```

Expected: all PASS. Manual smoke in dev app: switch between Live Preview, Source, and Split; close/reopen app; mode persists.

- [ ] **Step 12: Commit**

```powershell
git add index.html src/editor/editor.ts src/editor/splitPreview.ts src/workspace/layoutModeControl.ts src/workspace/layoutModeControl.test.ts src/workspace/settingsPanel.ts src/i18n/i18n.ts src/main.ts src/styles.css
git commit -m "feat(editor): add split preview layout"
```

---

## Task 3: Workspace Action Bar

**Files:**
- Create: `src/workspace/fileTree.test.ts`
- Modify: `src/workspace/fileTree.ts`
- Modify: `src/main.ts`
- Modify: `src/workspace/commandPalette.ts` only if command labels need grouping.
- Modify: `src/i18n/i18n.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing DOM test for workspace actions**

Create `src/workspace/fileTree.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mountFileTree } from "./fileTree";

describe("mountFileTree", () => {
  it("shows workspace action buttons when a folder is loaded", () => {
    const host = document.createElement("div");
    const openFile = vi.fn();
    const openFolder = vi.fn();
    const menu = vi.fn();
    const newFile = vi.fn();
    const newFolder = vi.fn();

    const tree = mountFileTree(host, openFile, openFolder, menu, { onNewFile: newFile, onNewFolder: newFolder });
    tree.render([{ name: "a.md", path: "C:/w/a.md", isDir: false, children: [] }], "C:/w");

    expect(host.querySelector(".ft-actions")).not.toBeNull();
    expect(host.textContent).toContain("Workspace");
  });
});
```

- [ ] **Step 2: Run focused test and confirm failure**

```powershell
npm test -- fileTree
```

Expected: FAIL because `mountFileTree` does not accept the fifth argument and `render()` does not accept a folder path.

- [ ] **Step 3: Extend file-tree interface**

In `src/workspace/fileTree.ts`, change the interface:

```ts
export interface FileTree {
  render(root: FileNode[], folderPath?: string | null): void;
  setActive(path: string | null): void;
  showNoFolder(): void;
  showError(): void;
}

export interface FileTreeActions {
  onNewFile?: () => void;
  onNewFolder?: () => void;
}
```

Change `mountFileTree` signature:

```ts
export function mountFileTree(
  sidebar: HTMLElement,
  onOpen: (path: string) => void,
  onOpenFolder: () => void,
  onContextMenu: (node: FileNode, x: number, y: number) => void,
  actions: FileTreeActions = {},
): FileTree {
```

Track folder path:

```ts
  let currentFolderPath: string | null = null;
```

In `draw()`, render a header before rows:

```ts
    const header = document.createElement("div");
    header.className = "ft-header";
    const ws = document.createElement("div");
    ws.className = "ft-ws";
    ws.textContent = t("tree.workspace");
    const actionRow = document.createElement("div");
    actionRow.className = "ft-actions";

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "ft-action";
    openBtn.textContent = t(currentFolderPath ? "tree.changeFolder" : "tree.openFolder");
    openBtn.addEventListener("click", () => onOpenFolder());
    actionRow.appendChild(openBtn);

    if (currentFolderPath) {
      const fileBtn = document.createElement("button");
      fileBtn.type = "button";
      fileBtn.className = "ft-action";
      fileBtn.textContent = t("menu.newFile");
      fileBtn.addEventListener("click", () => actions.onNewFile?.());
      actionRow.appendChild(fileBtn);

      const folderBtn = document.createElement("button");
      folderBtn.type = "button";
      folderBtn.className = "ft-action";
      folderBtn.textContent = t("menu.newFolder");
      folderBtn.addEventListener("click", () => actions.onNewFolder?.());
      actionRow.appendChild(folderBtn);
    }

    header.append(ws, actionRow);
    sidebar.appendChild(header);
```

Update `render()`:

```ts
    render(root, folderPath = null) { mode = "tree"; lastRoot = root; currentFolderPath = folderPath; draw(); },
```

- [ ] **Step 4: Wire root-level actions from main**

In `src/main.ts`, change tree mounting to:

```ts
const tree = mountFileTree(
  document.getElementById("filetree")!,
  (p) => void openPath(p),
  () => void openFolder(),
  fileTreeMenu,
  {
    onNewFile: () => { if (currentFolder) void newFileIn(currentFolder); },
    onNewFolder: () => { if (currentFolder) void newFolderIn(currentFolder); },
  },
);
```

In `loadFolder()`:

```ts
  tree.render(res.data, dir);
```

Add command-palette entries:

```ts
    { label: tr("menu.newFile"), run: () => { if (currentFolder) void newFileIn(currentFolder); } },
    { label: tr("menu.newFolder"), run: () => { if (currentFolder) void newFolderIn(currentFolder); } },
```

- [ ] **Step 5: Add i18n**

Add to every locale:

```ts
    "tree.changeFolder": "Change Folder...",
```

- [ ] **Step 6: Add CSS**

Append:

```css
.ft-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px 6px;
}

.ft-header .ft-ws {
  padding: 0;
}

.ft-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ft-action {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--muted);
  border-radius: var(--radius-sm);
  font-family: var(--sans);
  font-size: 11px;
  line-height: 1;
  padding: 4px 6px;
  cursor: pointer;
}

.ft-action:hover {
  color: var(--accent);
  border-color: var(--accent);
}
```

- [ ] **Step 7: Validate**

Run:

```powershell
npm test -- fileTree
npm test -- parity
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/workspace/fileTree.ts src/workspace/fileTree.test.ts src/main.ts src/i18n/i18n.ts src/styles.css
git commit -m "feat(workspace): add visible workspace actions"
```

---

## Task 4: Horizontal Rule Rendering

**Files:**
- Create: `src/editor/horizontalRule.ts`
- Create: `src/editor/horizontalRule.test.ts`
- Modify: `src/editor/editor.ts`
- Modify: `src/export/render.test.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing tests for horizontal-rule helpers and export rendering**

Create `src/editor/horizontalRule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { horizontalRuleSpec } from "./horizontalRule";

describe("horizontalRuleSpec", () => {
  it("matches the CodeMirror markdown HorizontalRule node", () => {
    expect(horizontalRuleSpec.match({} as never, "HorizontalRule", 0, 3)).toBe(true);
    expect(horizontalRuleSpec.match({} as never, "Paragraph", 0, 3)).toBe(false);
  });

  it("renders an inert horizontal rule element", () => {
    const el = horizontalRuleSpec.render("---");
    expect(el.className).toBe("cm-md-hr");
    expect(el.querySelector("hr")).not.toBeNull();
  });
});
```

Append to `src/export/render.test.ts`:

```ts
  it("renders a body horizontal rule as hr", () => {
    const html = mdRender("# A\n\n---\n\nB");

    expect(html).toContain("<hr");
    expect(html).toContain("<h1>A</h1>");
    expect(html).toContain("<p>B</p>");
  });
```

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm test -- horizontalRule render
```

Expected: horizontal-rule test FAIL because the file does not exist. Export render test may already PASS; keep it as a regression.

- [ ] **Step 3: Implement `horizontalRuleSpec`**

Create `src/editor/horizontalRule.ts`:

```ts
import type { EditorState } from "@codemirror/state";
import type { BlockSpec } from "./blockWidgets";

export const horizontalRuleSpec: BlockSpec = {
  match: (_state: EditorState, name: string) => name === "HorizontalRule",
  key: () => "horizontal-rule",
  render: () => {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-hr";
    wrap.appendChild(document.createElement("hr"));
    return wrap;
  },
};
```

- [ ] **Step 4: Register the spec**

In `src/editor/editor.ts`, import it:

```ts
import { horizontalRuleSpec } from "./horizontalRule";
```

Register it before larger widgets:

```ts
    blockWidgets([horizontalRuleSpec, mermaidSpec, tableSpec]),
```

- [ ] **Step 5: Add CSS**

Append:

```css
.cm-md-hr {
  padding: 10px 0;
}

.cm-md-hr hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 0;
}
```

- [ ] **Step 6: Validate**

Run:

```powershell
npm test -- horizontalRule render previewWidget
npm run build
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/editor/horizontalRule.ts src/editor/horizontalRule.test.ts src/editor/editor.ts src/export/render.test.ts src/styles.css
git commit -m "feat(editor): render markdown horizontal rules"
```

---

## Task 5: Release Workflow Token-Pool Hardening

**Files:**
- Modify only if reproduced: `.github/workflows/release.yml`
- Optional create: `scripts/verify-release-assets.ps1`

- [ ] **Step 1: Check recent release history**

Run:

```powershell
gh run list --workflow release.yml --limit 20
```

Expected current baseline: recent `v0.1.5` through `v0.1.9` runs are successful. If they are still successful, do not change release upload structure in this task.

- [ ] **Step 2: Pull failed logs only when the token-pool error appears**

When a failed run exists:

```powershell
gh run view <RUN_ID> --log-failed
```

Look for the exact step and message containing:

```text
unable to select next github token from pool
```

- [ ] **Step 3: If failure is inside matrix release upload, switch to serialized publish**

Only apply this architecture if Step 2 proves the failure comes from concurrent `tauri-action` release creation/upload:

1. Build matrix produces local bundles.
2. Each matrix job uploads bundles through `actions/upload-artifact`.
3. A single `publish` job downloads all artifacts.
4. `publish` creates/edits the GitHub Release once and uploads assets with `gh release upload --clobber`.
5. `promote` still marks the release latest after upload verification.

The important workflow shape is:

```yaml
  publish:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: dist-release
      - name: Create or update release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh release view "${GITHUB_REF_NAME}" --repo "${GITHUB_REPOSITORY}" >/dev/null 2>&1 || \
            gh release create "${GITHUB_REF_NAME}" --repo "${GITHUB_REPOSITORY}" --title "Rune ${GITHUB_REF_NAME}" --prerelease --notes-file release-notes.md
          find dist-release -type f -print0 | xargs -0 gh release upload "${GITHUB_REF_NAME}" --repo "${GITHUB_REPOSITORY}" --clobber
```

- [ ] **Step 4: Keep current macOS signing/notarization behavior**

Do not re-enable these in CI unless the Apple notary connectivity problem is deliberately being retested:

```yaml
          # APPLE_ID: ${{ secrets.APPLE_ID }}
          # APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          # APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Developer ID signing secrets stay active:

```yaml
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
```

- [ ] **Step 5: Validate after any workflow change**

Push a test tag and monitor:

```powershell
git tag v0.1.X
git push origin v0.1.X
gh run watch --exit-status
gh release view v0.1.X --json isDraft,isPrerelease,assets,url
```

Expected:

- `isDraft` is `false`.
- `isPrerelease` becomes `false` after promote.
- Windows `.msi`, Windows `.exe`, macOS `.dmg`, Linux `.deb`, Linux `.rpm`, Linux `.AppImage`, `.sig` files, and `latest.json` are present.

- [ ] **Step 6: Commit only when a workflow change was made**

```powershell
git add .github/workflows/release.yml scripts/verify-release-assets.ps1
git commit -m "ci(release): serialize release asset publishing"
```

---

## Task 6: Slash Command Foundation

**Files:**
- Create: `src/editor/slashCommands.ts`
- Create: `src/editor/slashCommands.test.ts`
- Modify after tests pass: `src/editor/editor.ts`
- Modify after UI decision: `src/styles.css`
- Optional later UI file in this batch: `src/editor/slashCommandMenu.ts`

This should run after Tasks 1-4 because split/source mode and keyboard indentation affect how snippets should insert.

- [ ] **Step 1: Write failing pure tests**

Create `src/editor/slashCommands.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectSlashTrigger, slashCommands } from "./slashCommands";

describe("detectSlashTrigger", () => {
  it("detects a slash command at the start of a line", () => {
    expect(detectSlashTrigger("/ta", 3)).toEqual({ from: 0, to: 3, query: "ta" });
  });

  it("detects a slash command after leading spaces", () => {
    expect(detectSlashTrigger("  /code", 7)).toEqual({ from: 2, to: 7, query: "code" });
  });

  it("does not trigger in the middle of normal text", () => {
    expect(detectSlashTrigger("hello /ta", 9)).toBeNull();
  });
});

describe("slashCommands", () => {
  it("includes table, code, mermaid, todo, and callout snippets", () => {
    expect(slashCommands.map((command) => command.id)).toEqual(["table", "code", "mermaid", "todo", "callout"]);
  });
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm test -- slashCommands
```

Expected: FAIL because the file does not exist.

- [ ] **Step 3: Implement the pure command model**

Create `src/editor/slashCommands.ts`:

```ts
export interface SlashTrigger {
  from: number;
  to: number;
  query: string;
}

export interface SlashCommand {
  id: "table" | "code" | "mermaid" | "todo" | "callout";
  label: string;
  insert: string;
  cursorOffset: number;
}

export const slashCommands: SlashCommand[] = [
  { id: "table", label: "Table", insert: "| Column | Column |\n| --- | --- |\n|  |  |", cursorOffset: 30 },
  { id: "code", label: "Code block", insert: "```\n\n```", cursorOffset: 4 },
  { id: "mermaid", label: "Mermaid diagram", insert: "```mermaid\ngraph TD\n  A[Start] --> B[End]\n```", cursorOffset: 19 },
  { id: "todo", label: "Task list", insert: "- [ ] ", cursorOffset: 6 },
  { id: "callout", label: "Callout", insert: "> [!NOTE]\n> ", cursorOffset: 12 },
];

export function detectSlashTrigger(linePrefix: string, cursorOffset: number): SlashTrigger | null {
  const prefix = linePrefix.slice(0, cursorOffset);
  const match = prefix.match(/(^|\s)\/([A-Za-z]*)$/);
  if (!match) return null;
  const slashFrom = prefix.length - match[2].length - 1;
  const beforeSlash = prefix.slice(0, slashFrom);
  if (beforeSlash.trim().length > 0) return null;
  return { from: slashFrom, to: prefix.length, query: match[2].toLowerCase() };
}
```

- [ ] **Step 4: Validate pure model**

```powershell
npm test -- slashCommands
```

Expected: PASS.

- [ ] **Step 5: Decide UI integration point before coding menu**

Use CodeMirror decorations and a small positioned menu only after the pure model passes. The minimum viable UI:

- Opens when cursor is after a valid slash trigger.
- Filters `slashCommands` by `id` or `label`.
- `Enter` inserts the selected snippet.
- `Escape` closes the menu without changing text.
- Does not open inside inline text, code blocks, or URLs.

- [ ] **Step 6: Commit pure model first**

```powershell
git add src/editor/slashCommands.ts src/editor/slashCommands.test.ts
git commit -m "feat(editor): add slash command model"
```

---

## Final Verification Before Release

Run the full local gate:

```powershell
npm test -- --run
npm run build
cargo check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
```

Manual app smoke:

```powershell
npm run tauri dev
```

Verify:

- `Ctrl/Cmd+I` toggles italic on selected Markdown text.
- `Ctrl/Cmd+B` toggles bold on selected Markdown text.
- `Tab` indents selected/current Markdown lines.
- `Shift+Tab` outdents selected/current Markdown lines.
- Top-right layout control switches Live Preview, Source, and Split.
- Split mode shows raw Markdown on the left and rendered preview on the right.
- Workspace panel has visible Open/Change Folder, New File, and New Folder controls.
- Right-click file/folder actions still work.
- Body `---` renders as a visible horizontal rule.
- YAML front matter at the top is still stripped from export output.
- Existing table/mermaid/math/image widgets remain inert and do not intercept text selection outside their source range.

Release gate after the final feature batch:

```powershell
git status --short
git log --oneline -5
```

Then bump version, tag, push, and monitor release only after local verification is green.
