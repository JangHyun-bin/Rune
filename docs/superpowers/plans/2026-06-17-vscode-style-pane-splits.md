# VS Code Style Pane Splits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VS Code style nested editor panes to Rune, including horizontal and vertical splits, pane-local tabs, drag-to-tabbar external Markdown opening, and drag-to-pane external Markdown splitting.

**Architecture:** Convert Rune from a single global `EditorView` plus single global `TabsState` into a pane workspace. Each pane owns its own tab state, CodeMirror view, undo state cache, tabbar, source/preview split state, and autosave timer; the app owns a nested layout tree and one active pane id. Existing single-pane behavior must continue to work through the same pane APIs before multi-pane behavior is enabled.

**Tech Stack:** TypeScript, CodeMirror 6, Tauri 2 native webview file-drop events, Vitest, Rust settings serde, Vite, Playwright/manual smoke for native desktop verification.

---

## Scope Check

This plan covers one integrated feature family:

- Pane model and nested layout tree.
- Refactor of current single editor state into pane-local state.
- Native external Markdown file drop.
- Pane-local tabbars and tab movement between panes.
- Layout persistence and restore.

Do not add unrelated editor commands, release changes, or visual redesigns in this plan. Keep the existing global editor mode control (`Live Preview`, `Source`, `Split`) as a global mode that applies to every pane. Keep source/preview split ratio separate from editor-pane split ratios.

## Current Code Constraints

- `src/main.ts` owns the current single `tabs`, `states`, `view`, `splitPreview`, `tabBar`, autosave, outline, find/replace, search, save, reload, and file-open wiring.
- `src/editor/editor.ts` creates editor states with a global `imagePaste` extension.
- `src/editor/docContext.ts` stores one global current path, which is fragile once multiple editors exist.
- `src/workspace/tabBar.ts` renders one global tabbar and has no drag/drop API.
- `src/workspace/layoutSettings.ts` stores sidebar, outline, and source/preview split ratio only.
- `src-tauri/src/settings.rs` stores `open_tabs` as a flat list and needs backward-compatible nested pane persistence.
- Tauri 2 exposes native file-drop through `getCurrentWebview().onDragDropEvent()`, which provides file paths and physical coordinates. Use this for external file drops instead of browser `DataTransfer.files`.

## File Structure

Create:

- `src/workspace/paneLayout.ts`  
  Pure nested layout model: layout node types, id generation helpers, split insertion, pane removal, active pane fallback, ratio normalization, serialization helpers.

- `src/workspace/paneLayout.test.ts`  
  Unit tests for split insertion, nested split shape, pane removal, and backward-compatible single-pane defaults.

- `src/workspace/dropTargets.ts`  
  Pure hit-testing helpers for native file-drop coordinates and pane edge zones.

- `src/workspace/dropTargets.test.ts`  
  Unit tests for tabbar target, pane edge target, center target, Markdown path filtering, and physical-to-CSS coordinate conversion.

- `src/workspace/panePersistence.ts`  
  TypeScript persistence types and normalizers for pane layout settings.

- `src/workspace/panePersistence.test.ts`  
  Unit tests for empty settings, legacy `openTabs`, invalid layout recovery, and roundtrip.

- `src/workspace/editorPane.ts`  
  Runtime pane controller. Owns a pane DOM root, pane tabbar, pane editor host, `TabsState`, `Map<tabId, EditorState>`, `EditorView`, pane-local autosave, source/preview split preview, and pane commands.

- `src/workspace/editorPane.test.ts`  
  DOM-based tests for pane tab switching, dirty state, active path reporting, and pane command callbacks.

- `src/workspace/paneWorkspace.ts`  
  Runtime manager for multiple panes. Owns layout tree, pane registry, active pane id, layout render, pane splitting, pane closing, active-pane dispatch, and persistence snapshot.

- `src/workspace/paneWorkspace.test.ts`  
  DOM-based tests for 1-pane restore, split creation, active pane switching, and opening a path into a target pane.

- `src/workspace/fileDrop.ts`  
  Native Tauri file-drop adapter with injectable event source for tests. Converts Tauri payloads into app-level actions.

- `src/workspace/fileDrop.test.ts`  
  Unit tests for dropped Markdown path filtering and target resolution.

Modify:

- `src/main.ts`  
  Replace global `tabs`, `states`, `view`, `tabBar`, `splitPreview`, and single-view commands with `PaneWorkspace` calls. Keep app-level features in `main.ts`: folder tree, settings, update checks, search panel, command palette, banners.

- `src/editor/editor.ts`  
  Allow pane-local image paste/drop context so each `EditorView` can resolve its own active document path.

- `src/editor/paste.ts`  
  Replace global `getDocPath()` usage with an injectable document path getter.

- `src/editor/docContext.ts`  
  Keep compatibility exports only if still needed by non-pane code; pane code should not depend on this singleton.

- `src/workspace/tabBar.ts`  
  Add pane id, drag source metadata, external drop affordance CSS classes, and handlers for tab select, close, context menu, internal tab drag, and tabbar hit testing.

- `src/workspace/layoutSettings.ts`  
  Keep existing sidebar/outline/source-preview layout settings. Do not put pane tree logic here; import pane persistence only where settings snapshots are built.

- `src/ipc/bindings.ts`  
  Add pane layout settings types to `Settings`.

- `src-tauri/src/settings.rs`  
  Add backward-compatible pane layout persistence fields.

- `src/styles.css`  
  Add nested pane workspace grid/flex layout, pane-local tabbar styling, split resizer styling, active pane styling, drop overlay zones, and cursor states.

- `index.html`  
  Remove the single global tabbar from the visual flow or leave it unused and hidden. The pane workspace should render tabbars inside each pane.

- `src/i18n/i18n.ts`  
  Add user-facing strings for drop overlay and pane commands in English, Korean, Japanese, and Simplified Chinese.

- `src/workspace/helpPanel.ts`  
  Add split-pane shortcuts only if the task implements keyboard split commands.

## Data Model

Use these TypeScript types as the stable app-level model:

```ts
export type PaneId = string;
export type SplitDirection = "row" | "column";

export type LayoutNode =
  | { type: "pane"; paneId: PaneId }
  | { type: "split"; direction: SplitDirection; children: LayoutNode[]; ratios: number[] };

export interface PaneSnapshot {
  id: PaneId;
  openTabs: string[];
  activePath: string | null;
}

export interface PaneWorkspaceSnapshot {
  version: 1;
  root: LayoutNode;
  activePaneId: PaneId;
  panes: PaneSnapshot[];
}
```

Use these runtime-only types:

```ts
export interface PaneOpenOptions {
  activate?: boolean;
  duplicate?: boolean;
}

export interface PaneSplitOptions {
  sourcePaneId: PaneId;
  direction: SplitDirection;
  side: "before" | "after";
  newPaneId: PaneId;
}

export interface DropTarget {
  kind: "tabbar" | "pane-edge" | "pane-center" | "none";
  paneId: PaneId | null;
  direction?: SplitDirection;
  side?: "before" | "after";
}
```

Use these Rust persistence structs:

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PaneLayoutNode {
    Pane { pane_id: String },
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
```

---

### Task 1: Add Pure Pane Layout Model

**Files:**
- Create: `src/workspace/paneLayout.ts`
- Create: `src/workspace/paneLayout.test.ts`

- [ ] **Step 1: Write failing tests for split insertion and pane removal**

Add `src/workspace/paneLayout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createSinglePaneLayout,
  flattenPaneIds,
  removePane,
  splitPane,
  type LayoutNode,
} from "./paneLayout";

describe("pane layout model", () => {
  it("creates a single-pane layout", () => {
    const layout = createSinglePaneLayout("pane-1");
    expect(layout).toEqual({ type: "pane", paneId: "pane-1" });
    expect(flattenPaneIds(layout)).toEqual(["pane-1"]);
  });

  it("splits a pane to the right using row direction", () => {
    const layout = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "row",
      side: "after",
      newPaneId: "pane-2",
    });
    expect(layout).toEqual({
      type: "split",
      direction: "row",
      ratios: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-1" },
        { type: "pane", paneId: "pane-2" },
      ],
    });
  });

  it("splits a pane above using column direction and before side", () => {
    const layout = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "column",
      side: "before",
      newPaneId: "pane-2",
    });
    expect(layout).toEqual({
      type: "split",
      direction: "column",
      ratios: [0.5, 0.5],
      children: [
        { type: "pane", paneId: "pane-2" },
        { type: "pane", paneId: "pane-1" },
      ],
    });
  });

  it("nests a different split direction", () => {
    const first = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "row",
      side: "after",
      newPaneId: "pane-2",
    });
    const second = splitPane(first, {
      sourcePaneId: "pane-2",
      direction: "column",
      side: "after",
      newPaneId: "pane-3",
    });
    expect(flattenPaneIds(second)).toEqual(["pane-1", "pane-2", "pane-3"]);
    expect((second as Extract<LayoutNode, { type: "split" }>).direction).toBe("row");
  });

  it("removes a pane and collapses redundant split nodes", () => {
    const layout = splitPane(createSinglePaneLayout("pane-1"), {
      sourcePaneId: "pane-1",
      direction: "row",
      side: "after",
      newPaneId: "pane-2",
    });
    expect(removePane(layout, "pane-2")).toEqual({ type: "pane", paneId: "pane-1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/workspace/paneLayout.test.ts
```

Expected: fail because `src/workspace/paneLayout.ts` does not exist.

- [ ] **Step 3: Implement pure pane layout helpers**

Create `src/workspace/paneLayout.ts`:

```ts
export type PaneId = string;
export type SplitDirection = "row" | "column";

export type LayoutNode =
  | { type: "pane"; paneId: PaneId }
  | { type: "split"; direction: SplitDirection; children: LayoutNode[]; ratios: number[] };

export interface SplitPaneRequest {
  sourcePaneId: PaneId;
  direction: SplitDirection;
  side: "before" | "after";
  newPaneId: PaneId;
}

export function createSinglePaneLayout(paneId: PaneId): LayoutNode {
  return { type: "pane", paneId };
}

export function flattenPaneIds(node: LayoutNode): PaneId[] {
  if (node.type === "pane") return [node.paneId];
  return node.children.flatMap(flattenPaneIds);
}

function evenRatios(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

function normalizeSplit(node: Extract<LayoutNode, { type: "split" }>): LayoutNode {
  const children = node.children.filter(Boolean);
  if (children.length === 1) return children[0];
  return { ...node, children, ratios: evenRatios(children.length) };
}

export function splitPane(node: LayoutNode, request: SplitPaneRequest): LayoutNode {
  if (node.type === "pane") {
    if (node.paneId !== request.sourcePaneId) return node;
    const current: LayoutNode = { type: "pane", paneId: node.paneId };
    const next: LayoutNode = { type: "pane", paneId: request.newPaneId };
    const children = request.side === "before" ? [next, current] : [current, next];
    return { type: "split", direction: request.direction, children, ratios: [0.5, 0.5] };
  }

  const children = node.children.map((child) => splitPane(child, request));
  return normalizeSplit({ ...node, children });
}

export function removePane(node: LayoutNode, paneId: PaneId): LayoutNode | null {
  if (node.type === "pane") return node.paneId === paneId ? null : node;
  const children = node.children
    .map((child) => removePane(child, paneId))
    .filter((child): child is LayoutNode => child !== null);
  if (children.length === 0) return null;
  return normalizeSplit({ ...node, children });
}
```

- [ ] **Step 4: Run pane layout tests**

Run:

```bash
npx vitest run src/workspace/paneLayout.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/paneLayout.ts src/workspace/paneLayout.test.ts
git commit -m "feat(workspace): add pane layout model"
```

---

### Task 2: Add Drop Target Model

**Files:**
- Create: `src/workspace/dropTargets.ts`
- Create: `src/workspace/dropTargets.test.ts`

- [ ] **Step 1: Write failing tests for Markdown filtering and edge hit testing**

Create `src/workspace/dropTargets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { firstMarkdownPath, hitPaneDropZone, physicalToCssPoint } from "./dropTargets";

describe("drop targets", () => {
  it("selects the first Markdown path", () => {
    expect(firstMarkdownPath(["C:/x/a.txt", "C:/x/b.md", "C:/x/c.markdown"])).toBe("C:/x/b.md");
  });

  it("rejects non-Markdown paths", () => {
    expect(firstMarkdownPath(["C:/x/a.txt", "C:/x/b.png"])).toBeNull();
  });

  it("converts physical coordinates to CSS coordinates", () => {
    expect(physicalToCssPoint({ x: 240, y: 120 }, 2)).toEqual({ x: 120, y: 60 });
  });

  it("targets the left edge as a row split before the pane", () => {
    const target = hitPaneDropZone({ left: 100, top: 50, width: 400, height: 300 }, { x: 130, y: 180 });
    expect(target).toEqual({ kind: "pane-edge", direction: "row", side: "before" });
  });

  it("targets the bottom edge as a column split after the pane", () => {
    const target = hitPaneDropZone({ left: 100, top: 50, width: 400, height: 300 }, { x: 300, y: 335 });
    expect(target).toEqual({ kind: "pane-edge", direction: "column", side: "after" });
  });

  it("targets center when outside edge threshold", () => {
    const target = hitPaneDropZone({ left: 100, top: 50, width: 400, height: 300 }, { x: 300, y: 180 });
    expect(target).toEqual({ kind: "pane-center" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/workspace/dropTargets.test.ts
```

Expected: fail because `src/workspace/dropTargets.ts` does not exist.

- [ ] **Step 3: Implement drop target helpers**

Create `src/workspace/dropTargets.ts`:

```ts
import type { SplitDirection } from "./paneLayout";

export interface Point {
  x: number;
  y: number;
}

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type PaneDropZone =
  | { kind: "pane-edge"; direction: SplitDirection; side: "before" | "after" }
  | { kind: "pane-center" };

const EDGE_RATIO = 0.22;
const EDGE_MIN = 42;
const EDGE_MAX = 96;

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function firstMarkdownPath(paths: string[]): string | null {
  return paths.find(isMarkdownPath) ?? null;
}

export function physicalToCssPoint(position: Point, deviceScaleFactor = window.devicePixelRatio || 1): Point {
  const scale = Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0 ? deviceScaleFactor : 1;
  return { x: position.x / scale, y: position.y / scale };
}

function edgeSize(length: number): number {
  return Math.min(EDGE_MAX, Math.max(EDGE_MIN, length * EDGE_RATIO));
}

export function hitPaneDropZone(rect: RectLike, point: Point): PaneDropZone {
  const leftEdge = edgeSize(rect.width);
  const topEdge = edgeSize(rect.height);
  const relX = point.x - rect.left;
  const relY = point.y - rect.top;

  if (relX <= leftEdge) return { kind: "pane-edge", direction: "row", side: "before" };
  if (relX >= rect.width - leftEdge) return { kind: "pane-edge", direction: "row", side: "after" };
  if (relY <= topEdge) return { kind: "pane-edge", direction: "column", side: "before" };
  if (relY >= rect.height - topEdge) return { kind: "pane-edge", direction: "column", side: "after" };
  return { kind: "pane-center" };
}
```

- [ ] **Step 4: Run drop target tests**

Run:

```bash
npx vitest run src/workspace/dropTargets.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/dropTargets.ts src/workspace/dropTargets.test.ts
git commit -m "feat(workspace): add pane drop target helpers"
```

---

### Task 3: Add Pane Persistence Types and Backward Compatibility

**Files:**
- Create: `src/workspace/panePersistence.ts`
- Create: `src/workspace/panePersistence.test.ts`
- Modify: `src/ipc/bindings.ts`
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Write failing TypeScript persistence tests**

Create `src/workspace/panePersistence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizePaneWorkspaceSnapshot, serializePaneWorkspaceSnapshot } from "./panePersistence";

describe("pane persistence", () => {
  it("creates a single-pane snapshot from legacy open tabs", () => {
    const snapshot = normalizePaneWorkspaceSnapshot(null, ["/w/a.md", "/w/b.md"]);
    expect(snapshot.root).toEqual({ type: "pane", paneId: "pane-1" });
    expect(snapshot.activePaneId).toBe("pane-1");
    expect(snapshot.panes).toEqual([{ id: "pane-1", openTabs: ["/w/a.md", "/w/b.md"], activePath: "/w/a.md" }]);
  });

  it("creates an empty single-pane snapshot with no legacy tabs", () => {
    const snapshot = normalizePaneWorkspaceSnapshot(null, []);
    expect(snapshot.panes).toEqual([{ id: "pane-1", openTabs: [], activePath: null }]);
  });

  it("roundtrips a valid nested snapshot", () => {
    const snapshot = normalizePaneWorkspaceSnapshot({
      version: 1,
      root: {
        type: "split",
        direction: "row",
        ratios: [0.5, 0.5],
        children: [
          { type: "pane", paneId: "pane-1" },
          { type: "pane", paneId: "pane-2" },
        ],
      },
      activePaneId: "pane-2",
      panes: [
        { id: "pane-1", openTabs: ["/w/a.md"], activePath: "/w/a.md" },
        { id: "pane-2", openTabs: ["/w/b.md"], activePath: "/w/b.md" },
      ],
    }, []);
    expect(JSON.parse(serializePaneWorkspaceSnapshot(snapshot))).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run TypeScript persistence test to verify it fails**

Run:

```bash
npx vitest run src/workspace/panePersistence.test.ts
```

Expected: fail because `src/workspace/panePersistence.ts` does not exist.

- [ ] **Step 3: Implement TypeScript persistence normalizer**

Create `src/workspace/panePersistence.ts`:

```ts
import { createSinglePaneLayout, flattenPaneIds, type LayoutNode, type PaneId } from "./paneLayout";

export interface PaneSnapshot {
  id: PaneId;
  openTabs: string[];
  activePath: string | null;
}

export interface PaneWorkspaceSnapshot {
  version: 1;
  root: LayoutNode;
  activePaneId: PaneId;
  panes: PaneSnapshot[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isLayoutNode(value: unknown): value is LayoutNode {
  if (!isRecord(value)) return false;
  if (value.type === "pane") return typeof value.paneId === "string";
  if (value.type !== "split") return false;
  return (value.direction === "row" || value.direction === "column")
    && Array.isArray(value.children)
    && value.children.every(isLayoutNode);
}

function singlePaneFromLegacy(openTabs: string[]): PaneWorkspaceSnapshot {
  return {
    version: 1,
    root: createSinglePaneLayout("pane-1"),
    activePaneId: "pane-1",
    panes: [{ id: "pane-1", openTabs, activePath: openTabs[0] ?? null }],
  };
}

export function normalizePaneWorkspaceSnapshot(value: unknown, legacyOpenTabs: string[]): PaneWorkspaceSnapshot {
  if (!isRecord(value) || value.version !== 1 || !isLayoutNode(value.root) || typeof value.activePaneId !== "string" || !Array.isArray(value.panes)) {
    return singlePaneFromLegacy(legacyOpenTabs);
  }
  const paneIds = new Set(flattenPaneIds(value.root));
  const panes = value.panes
    .filter((pane): pane is Record<string, unknown> => isRecord(pane))
    .filter((pane) => typeof pane.id === "string" && paneIds.has(pane.id))
    .map((pane) => {
      const openTabs = Array.isArray(pane.openTabs) ? pane.openTabs.filter((path): path is string => typeof path === "string") : [];
      const activePath = typeof pane.activePath === "string" && openTabs.includes(pane.activePath) ? pane.activePath : (openTabs[0] ?? null);
      return { id: pane.id as string, openTabs, activePath };
    });
  if (panes.length === 0) return singlePaneFromLegacy(legacyOpenTabs);
  return {
    version: 1,
    root: value.root,
    activePaneId: paneIds.has(value.activePaneId) ? value.activePaneId : panes[0].id,
    panes,
  };
}

export function serializePaneWorkspaceSnapshot(snapshot: PaneWorkspaceSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
```

- [ ] **Step 4: Update frontend settings binding**

Modify `src/ipc/bindings.ts` by importing no runtime code and adding structural types:

```ts
export type PaneLayoutNode =
  | { type: "pane"; paneId: string }
  | { type: "split"; direction: "row" | "column"; children: PaneLayoutNode[]; ratios: number[] };
export interface PaneSnapshot { id: string; openTabs: string[]; activePath: string | null; }
export interface PaneWorkspaceSnapshot { version: 1; root: PaneLayoutNode; activePaneId: string; panes: PaneSnapshot[]; }
export interface Settings {
  theme: string | null;
  lastFolder: string | null;
  openTabs: string[];
  locale: string | null;
  editorWidth: string | null;
  editorMode: string | null;
  sidebarWidth: number | null;
  layout: LayoutSettings | null;
  paneLayout: PaneWorkspaceSnapshot | null;
}
```

- [ ] **Step 5: Update Rust settings persistence**

Modify `src-tauri/src/settings.rs`:

```rust
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PaneLayoutNode {
    Pane { pane_id: String },
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
```

Add to `Settings`:

```rust
pub pane_layout: Option<PaneWorkspaceSnapshot>,
```

Update the existing `roundtrip_and_default` test to assert:

```rust
assert!(load(&p).pane_layout.is_none());
```

and include `pane_layout: None` in the explicit `Settings` literal.

- [ ] **Step 6: Run persistence tests**

Run:

```bash
npx vitest run src/workspace/panePersistence.test.ts
cargo test --manifest-path src-tauri/Cargo.toml settings
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/workspace/panePersistence.ts src/workspace/panePersistence.test.ts src/ipc/bindings.ts src-tauri/src/settings.rs
git commit -m "feat(workspace): persist pane layout snapshots"
```

---

### Task 4: Make Image Paste Pane-Local

**Files:**
- Modify: `src/editor/paste.ts`
- Modify: `src/editor/editor.ts`
- Test: existing editor tests plus a focused new test if a DOM test is practical

- [ ] **Step 1: Refactor paste extension into a factory**

Modify `src/editor/paste.ts` so it exports both a factory and a compatibility default:

```ts
export interface ImagePasteContext {
  getDocPath: () => string | null;
}

export function imagePasteFor(context: ImagePasteContext) {
  return EditorView.domEventHandlers({
    paste(e, view) {
      const items = e.clipboardData?.items;
      if (!items) return false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); void handleFile(view, f, context.getDocPath); return true; }
        }
      }
      return false;
    },
    drop(e, view) {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return false;
      const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imgs.length === 0) return false;
      e.preventDefault();
      for (const f of imgs) void handleFile(view, f, context.getDocPath);
      return true;
    },
  });
}
```

Change `handleFile` signature:

```ts
async function handleFile(view: EditorView, file: File, getDocPath: () => string | null) {
  const docPath = getDocPath();
  if (!docPath) { alert(t("image.saveFirst")); return; }
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  const res = await commands.saveAsset(docPath, bytes, extFromType(file.type));
  if (res.status === "error") { console.error(res.error); return; }
  const pos = view.state.selection.main.head;
  view.dispatch({ changes: { from: pos, insert: `![](${res.data})` }, selection: { anchor: pos + 2 } });
}
```

Keep compatibility:

```ts
export const imagePaste = imagePasteFor({ getDocPath });
```

- [ ] **Step 2: Add editor state option for pane-local path**

Modify `src/editor/editor.ts`:

```ts
export interface EditorStateOptions {
  extraExtensions?: Extension[];
  mode?: EditorMode;
  getDocPath?: () => string | null;
}
```

Add overload-friendly implementation:

```ts
export function editorState(
  doc: string,
  onChange: (text: string) => void,
  extraExtensions: Extension[] = [],
  mode: EditorMode = "preview",
  getDocPath?: () => string | null,
): EditorState {
  const imagePasteExtension = getDocPath ? imagePasteFor({ getDocPath }) : imagePaste;
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      markdownShortcutKeymap(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      editorTheme(),
      EditorView.lineWrapping,
      syntaxHighlighting(codeHighlightStyle),
      ...modeExtensions(mode),
      imagePasteExtension,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
      ...extraExtensions,
    ],
  });
}
```

- [ ] **Step 3: Run editor tests and build**

Run:

```bash
npm test -- --run
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/editor/paste.ts src/editor/editor.ts
git commit -m "refactor(editor): support pane-local document context"
```

---

### Task 5: Add Pane-Local Tabbar API

**Files:**
- Modify: `src/workspace/tabBar.ts`
- Modify: `src/workspace/fileTree.test.ts` only if DOM helper needs class matching updates
- Create or modify: `src/workspace/tabBar.test.ts`

- [ ] **Step 1: Write tabbar tests for pane id and drag metadata**

Create `src/workspace/tabBar.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mountTabBar } from "./tabBar";
import { openOrFocus, emptyTabs } from "./tabs";

describe("tab bar", () => {
  it("marks the rendered tabbar with a pane id", () => {
    const host = document.createElement("div");
    const state = openOrFocus(emptyTabs(), "/w/a.md", "A");
    mountTabBar(host, {
      paneId: "pane-1",
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onContextMenu: vi.fn(),
      onTabDragStart: vi.fn(),
    }).render(state);
    expect(host.dataset.paneId).toBe("pane-1");
    expect(host.querySelector(".tab")?.getAttribute("draggable")).toBe("true");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/workspace/tabBar.test.ts
```

Expected: fail because `mountTabBar` does not accept `paneId`.

- [ ] **Step 3: Extend tabbar handlers**

Modify `src/workspace/tabBar.ts` handler type:

```ts
export interface TabDragPayload {
  paneId: string;
  tabId: string;
  path: string | null;
  duplicate: boolean;
}

export interface TabBarHandlers {
  paneId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onTabDragStart?: (payload: TabDragPayload) => void;
}
```

Set host metadata and per-tab drag:

```ts
el.dataset.paneId = handlers.paneId;
tab.draggable = true;
tab.addEventListener("dragstart", (event) => {
  handlers.onTabDragStart?.({
    paneId: handlers.paneId,
    tabId: t.id,
    path: t.path,
    duplicate: event.ctrlKey || event.metaKey,
  });
});
```

- [ ] **Step 4: Run tabbar tests**

Run:

```bash
npx vitest run src/workspace/tabBar.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/tabBar.ts src/workspace/tabBar.test.ts
git commit -m "feat(workspace): make tabbar pane-aware"
```

---

### Task 6: Create Editor Pane Runtime Controller

**Files:**
- Create: `src/workspace/editorPane.ts`
- Create: `src/workspace/editorPane.test.ts`
- Modify: no `src/main.ts` wiring in this task

- [ ] **Step 1: Write failing pane controller tests**

Create `src/workspace/editorPane.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createEditorPane } from "./editorPane";

describe("editor pane", () => {
  it("opens a path into a pane and reports active path", async () => {
    const host = document.createElement("div");
    const pane = createEditorPane({
      id: "pane-1",
      host,
      editorMode: "source",
      readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
      writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
      onActiveChange: vi.fn(),
      onDirtyChange: vi.fn(),
      onRequestSaveSettings: vi.fn(),
    });
    await pane.openPath("/w/a.md");
    expect(pane.activePath()).toBe("/w/a.md");
    expect(host.querySelector(".pane-tabbar")).not.toBeNull();
    pane.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/workspace/editorPane.test.ts
```

Expected: fail because `src/workspace/editorPane.ts` does not exist.

- [ ] **Step 3: Implement editor pane controller**

Create `src/workspace/editorPane.ts` with this public API:

```ts
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { editorState, createEditorView, type EditorMode } from "../editor/editor";
import { mountTabBar } from "./tabBar";
import { autosave } from "./autosave";
import { activeTab, closeTab, emptyTabs, markActiveSaved, newUntitled, openOrFocus, setActive, tabDirty, updateActiveText, type TabsState } from "./tabs";
import { mountSplitPreview, type SplitPreview } from "../editor/splitPreview";

export interface CommandResult<T> {
  status: "ok";
  data: T;
}

export interface CommandError {
  status: "error";
  error: string;
}

export interface EditorPaneOptions {
  id: string;
  host: HTMLElement;
  editorMode: EditorMode;
  readFile: (path: string) => Promise<CommandResult<string> | CommandError>;
  writeFile: (path: string, contents: string) => Promise<CommandResult<null> | CommandError>;
  onActiveChange: (paneId: string) => void;
  onDirtyChange: (paneId: string) => void;
  onRequestSaveSettings: () => void;
}

export interface EditorPane {
  id: string;
  root: HTMLElement;
  view: EditorView;
  openPath(path: string): Promise<void>;
  newDoc(): void;
  switchTo(tabId: string): void;
  closeTab(tabId: string): void;
  activePath(): string | null;
  activeText(): string;
  activeDirty(): boolean;
  tabsSnapshot(): { openTabs: string[]; activePath: string | null };
  setEditorMode(mode: EditorMode): void;
  saveActive(): Promise<void>;
  destroy(): void;
}
```

Implementation rules:

- `root` contains `.pane-tabbar` and `.pane-editor`.
- `mountTabBar` renders into `.pane-tabbar`.
- `editorState` receives `getDocPath: () => activeTab(tabs)?.path ?? null`.
- `autosave(800, () => void saveActive())` is created per pane.
- `onActiveChange(id)` fires on pane `mousedown` and editor focus.
- `onDirtyChange(id)` fires on document changes.
- `tabsSnapshot()` returns only saved file paths, not untitled tabs.

- [ ] **Step 4: Run pane controller tests**

Run:

```bash
npx vitest run src/workspace/editorPane.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/editorPane.ts src/workspace/editorPane.test.ts
git commit -m "feat(workspace): add editor pane controller"
```

---

### Task 7: Create Pane Workspace Runtime Manager

**Files:**
- Create: `src/workspace/paneWorkspace.ts`
- Create: `src/workspace/paneWorkspace.test.ts`
- Modify: no `src/main.ts` wiring in this task

- [ ] **Step 1: Write failing workspace manager tests**

Create `src/workspace/paneWorkspace.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPaneWorkspace } from "./paneWorkspace";

describe("pane workspace", () => {
  it("starts with one pane and opens a path into the active pane", async () => {
    const host = document.createElement("div");
    const workspace = createPaneWorkspace({
      host,
      editorMode: "source",
      readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
      writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
      onActivePaneChange: vi.fn(),
      onActiveDocumentChange: vi.fn(),
      onRequestSaveSettings: vi.fn(),
    });
    await workspace.openPathInActivePane("/w/a.md");
    expect(workspace.activePane().activePath()).toBe("/w/a.md");
    expect(workspace.snapshot().panes[0].openTabs).toEqual(["/w/a.md"]);
    workspace.destroy();
  });

  it("splits the active pane and opens a path into the new pane", async () => {
    const host = document.createElement("div");
    const workspace = createPaneWorkspace({
      host,
      editorMode: "source",
      readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
      writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
      onActivePaneChange: vi.fn(),
      onActiveDocumentChange: vi.fn(),
      onRequestSaveSettings: vi.fn(),
    });
    await workspace.openPathInActivePane("/w/a.md");
    const paneId = await workspace.splitActivePaneAndOpen("/w/b.md", "row", "after");
    expect(workspace.snapshot().root.type).toBe("split");
    expect(workspace.activePane().id).toBe(paneId);
    expect(workspace.activePane().activePath()).toBe("/w/b.md");
    workspace.destroy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/workspace/paneWorkspace.test.ts
```

Expected: fail because `src/workspace/paneWorkspace.ts` does not exist.

- [ ] **Step 3: Implement pane workspace manager**

Create `src/workspace/paneWorkspace.ts` with this public API:

```ts
import { createSinglePaneLayout, flattenPaneIds, splitPane, type LayoutNode, type PaneId, type SplitDirection } from "./paneLayout";
import { createEditorPane, type EditorPane } from "./editorPane";
import type { EditorMode } from "../editor/editor";
import type { PaneWorkspaceSnapshot } from "./panePersistence";

export interface PaneWorkspaceOptions {
  host: HTMLElement;
  editorMode: EditorMode;
  readFile: EditorPaneOptions["readFile"];
  writeFile: EditorPaneOptions["writeFile"];
  onActivePaneChange: (paneId: PaneId) => void;
  onActiveDocumentChange: () => void;
  onRequestSaveSettings: () => void;
}

export interface PaneWorkspace {
  activePane(): EditorPane;
  openPathInActivePane(path: string): Promise<void>;
  openPathInPane(paneId: PaneId, path: string): Promise<void>;
  splitActivePaneAndOpen(path: string, direction: SplitDirection, side: "before" | "after"): Promise<PaneId>;
  splitPaneAndOpen(paneId: PaneId, path: string, direction: SplitDirection, side: "before" | "after"): Promise<PaneId>;
  setActivePane(paneId: PaneId): void;
  setEditorMode(mode: EditorMode): void;
  snapshot(): PaneWorkspaceSnapshot;
  destroy(): void;
}
```

Rendering rules:

- `host.className = "pane-workspace"`.
- Each pane root gets `data-pane-id`.
- Split nodes render as `.pane-split[data-direction="row"]` or `.pane-split[data-direction="column"]`.
- Split ratios are rendered with CSS grid tracks using `fr` values from `ratios`.
- Active pane root gets `.active`.

- [ ] **Step 4: Run workspace tests**

Run:

```bash
npx vitest run src/workspace/paneWorkspace.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/paneWorkspace.ts src/workspace/paneWorkspace.test.ts
git commit -m "feat(workspace): add pane workspace manager"
```

---

### Task 8: Wire Main App Through PaneWorkspace With One Pane

**Files:**
- Modify: `src/main.ts`
- Modify: `index.html`
- Modify: `src/styles.css`

- [ ] **Step 1: Replace global tabbar markup**

Modify `index.html`:

```html
<div id="main-col">
  <div id="editor-toolbar"></div>
  <div id="editor"></div>
</div>
```

Remove the standalone:

```html
<div id="tabbar"></div>
```

- [ ] **Step 2: Add pane workspace CSS**

Modify `src/styles.css`:

```css
.pane-workspace { height:100%; min-height:0; display:grid; background:var(--bg); }
.editor-pane-root { min-width:0; min-height:0; display:flex; flex-direction:column; border:1px solid transparent; }
.editor-pane-root.active { border-color:var(--accent-soft); }
.pane-tabbar { display:flex; align-items:stretch; height:36px; background:var(--faint); border-bottom:1px solid var(--border); overflow-x:auto; flex:0 0 auto; }
.pane-editor { flex:1; min-width:0; min-height:0; }
.pane-split { min-width:0; min-height:0; display:grid; }
.pane-split[data-direction="row"] { grid-auto-flow:column; }
.pane-split[data-direction="column"] { grid-auto-flow:row; }
```

Move existing `#tabbar` tab styles to `.pane-tabbar` equivalents:

```css
.pane-tabbar .tab { display:flex; align-items:center; gap:6px; padding:0 12px; max-width:200px; border-right:1px solid var(--border); cursor:pointer; font-size:12.5px; color:var(--muted); white-space:nowrap; border-top:2px solid transparent; }
.pane-tabbar .tab.active { background:var(--bg); color:var(--text); border-top-color:var(--accent); }
.pane-tabbar .label { overflow:hidden; text-overflow:ellipsis; }
.pane-tabbar .close { color:var(--muted); padding:0 2px; }
.pane-tabbar .close:hover { color:var(--danger); }
```

- [ ] **Step 3: Replace single editor initialization in main**

In `src/main.ts`, remove global `tabBar`, `tabs`, `states`, `view`, `splitPreview`, and `splitResizerCleanup` after the pane workspace is ready. Add:

```ts
let paneWorkspace: PaneWorkspace;

function activePane() {
  return paneWorkspace.activePane();
}

function activeView(): EditorView {
  return activePane().view;
}
```

Initialize:

```ts
paneWorkspace = createPaneWorkspace({
  host: editorRoot,
  editorMode,
  readFile: commands.readFile,
  writeFile: commands.writeFile,
  onActivePaneChange: () => syncActiveUI(),
  onActiveDocumentChange: () => syncActiveUI(),
  onRequestSaveSettings: scheduleSaveSettings,
});
```

- [ ] **Step 4: Update app-level commands to active pane**

Replace uses:

```ts
activeTab(tabs)
view
tabs.activeId
switchTo(id)
openPath(path)
newDoc()
requestClose(id)
```

with pane calls:

```ts
activePane().activePath()
activeView()
paneWorkspace.openPathInActivePane(path)
activePane().newDoc()
activePane().closeTab(id)
```

Keep function names in `main.ts` as wrappers where other modules call them:

```ts
async function openPath(path: string): Promise<void> {
  await paneWorkspace.openPathInActivePane(path);
  if (!currentFolder) {
    const dir = parentDir(path);
    if (dir) await loadFolder(dir).catch(() => {});
  }
  scheduleSaveSettings();
}

function newDoc(): void {
  activePane().newDoc();
  scheduleSaveSettings();
}
```

- [ ] **Step 5: Update outline/status/find/search/export**

Update `refreshStatus()`:

```ts
const view = activeView();
const text = view.state.doc.toString();
```

Update `refreshOutline()` and `jumpToLine()` to use `activeView()`.

Update find/replace handlers to call `activeView()` at call time, not capture a stale view:

```ts
getText: () => activeView().state.doc.toString(),
getCursor: () => activeView().state.selection.main.head,
```

Update export:

```ts
void exportHtml(activeView().state.doc.toString(), exportTitle())
```

- [ ] **Step 6: Run full frontend tests and build**

Run:

```bash
npm test -- --run
npm run build
```

Expected: pass.

- [ ] **Step 7: Browser smoke one-pane behavior**

Run:

```bash
npm run dev -- --host 127.0.0.1 --port 1438
```

Smoke checks:

- App opens with one pane.
- Existing open tabs restore.
- New tab works.
- Open file works.
- Save works.
- Find/replace uses active pane.
- Outline follows active pane.
- Source/preview/split mode still works inside the pane.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts index.html src/styles.css
git commit -m "refactor(workspace): route editor through pane workspace"
```

---

### Task 9: Restore and Save Pane Layout

**Files:**
- Modify: `src/main.ts`
- Modify: `src/workspace/paneWorkspace.ts`
- Modify: `src/workspace/panePersistence.ts`
- Modify: `src-tauri/src/settings.rs`

- [ ] **Step 1: Update settings snapshot**

Modify `settingsSnapshot()` in `src/main.ts`:

```ts
const paneLayout = paneWorkspace.snapshot();
const openTabs = paneLayout.panes.flatMap((pane) => pane.openTabs);
return {
  theme,
  lastFolder: currentFolder,
  openTabs,
  locale: getLocale(),
  editorWidth: currentEditorWidth(),
  editorMode,
  sidebarWidth: layout.sidebarWidth,
  layout,
  paneLayout,
};
```

- [ ] **Step 2: Update restore path**

In `restore()`:

```ts
const paneSnapshot = normalizePaneWorkspaceSnapshot(s.paneLayout, s.openTabs);
await paneWorkspace.restore(paneSnapshot);
```

Add `restore(snapshot)` to `PaneWorkspace`:

```ts
restore(snapshot: PaneWorkspaceSnapshot): Promise<void>;
```

Restore rules:

- Create pane controllers for every snapshot pane.
- Render the layout tree.
- Open each pane's `openTabs` in order.
- Activate `activePath` in each pane.
- Set active pane to `snapshot.activePaneId`.
- If all panes have no tabs, create one untitled tab in the active pane.

- [ ] **Step 3: Add pane workspace restore tests**

Extend `src/workspace/paneWorkspace.test.ts`:

```ts
it("restores two panes from a snapshot", async () => {
  const host = document.createElement("div");
  const workspace = createPaneWorkspace({
    host,
    editorMode: "source",
    readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
    writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
    onActivePaneChange: vi.fn(),
    onActiveDocumentChange: vi.fn(),
    onRequestSaveSettings: vi.fn(),
  });
  await workspace.restore({
    version: 1,
    root: {
      type: "split",
      direction: "row",
      ratios: [0.5, 0.5],
      children: [{ type: "pane", paneId: "pane-1" }, { type: "pane", paneId: "pane-2" }],
    },
    activePaneId: "pane-2",
    panes: [
      { id: "pane-1", openTabs: ["/w/a.md"], activePath: "/w/a.md" },
      { id: "pane-2", openTabs: ["/w/b.md"], activePath: "/w/b.md" },
    ],
  });
  expect(workspace.activePane().id).toBe("pane-2");
  expect(workspace.snapshot().panes).toHaveLength(2);
  workspace.destroy();
});
```

- [ ] **Step 4: Run persistence and workspace tests**

Run:

```bash
npx vitest run src/workspace/panePersistence.test.ts src/workspace/paneWorkspace.test.ts
cargo test --manifest-path src-tauri/Cargo.toml settings
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts src/workspace/paneWorkspace.ts src/workspace/panePersistence.ts src/workspace/paneWorkspace.test.ts src-tauri/src/settings.rs
git commit -m "feat(workspace): restore nested pane layouts"
```

---

### Task 10: Add Pane Split UI and Resizers

**Files:**
- Modify: `src/workspace/paneWorkspace.ts`
- Modify: `src/workspace/paneLayout.ts`
- Modify: `src/workspace/paneLayout.test.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Add ratio update tests**

Extend `src/workspace/paneLayout.test.ts`:

```ts
import { updateSplitRatios } from "./paneLayout";

it("updates ratios for a split containing two panes", () => {
  const layout = splitPane(createSinglePaneLayout("pane-1"), {
    sourcePaneId: "pane-1",
    direction: "row",
    side: "after",
    newPaneId: "pane-2",
  });
  const updated = updateSplitRatios(layout, ["pane-1", "pane-2"], [0.35, 0.65]);
  expect(updated).toEqual({
    type: "split",
    direction: "row",
    ratios: [0.35, 0.65],
    children: [
      { type: "pane", paneId: "pane-1" },
      { type: "pane", paneId: "pane-2" },
    ],
  });
});
```

- [ ] **Step 2: Implement ratio update**

Add to `src/workspace/paneLayout.ts`:

```ts
export function updateSplitRatios(node: LayoutNode, childPaneIds: PaneId[], ratios: number[]): LayoutNode {
  if (node.type === "pane") return node;
  const currentIds = node.children.flatMap(flattenPaneIds);
  if (currentIds.join("\0") === childPaneIds.join("\0") && ratios.length === node.children.length) {
    const total = ratios.reduce((sum, value) => sum + Math.max(0.05, value), 0);
    return { ...node, ratios: ratios.map((value) => Math.max(0.05, value) / total) };
  }
  return { ...node, children: node.children.map((child) => updateSplitRatios(child, childPaneIds, ratios)) };
}
```

- [ ] **Step 3: Render split resizers**

In `src/workspace/paneWorkspace.ts`, render a `.pane-split-resizer` between split children:

```ts
const resizer = document.createElement("div");
resizer.className = "pane-split-resizer";
resizer.dataset.direction = node.direction;
resizer.setAttribute("role", "separator");
resizer.setAttribute("aria-orientation", node.direction === "row" ? "vertical" : "horizontal");
```

Resizer drag rules:

- Row split: horizontal pointer movement changes adjacent child ratios.
- Column split: vertical pointer movement changes adjacent child ratios.
- Clamp each adjacent child to at least `0.12`.
- Persist through `onRequestSaveSettings()` on pointerup.

- [ ] **Step 4: Add resizer CSS**

Add to `src/styles.css`:

```css
.pane-split-resizer { background:var(--faint); z-index:2; }
.pane-split-resizer[data-direction="row"] { width:6px; cursor:col-resize; }
.pane-split-resizer[data-direction="column"] { height:6px; cursor:row-resize; }
.pane-split-resizer:hover,
.pane-split-resizer.dragging { background:var(--accent-soft); }
body.resizing-pane-row { cursor:col-resize; user-select:none; }
body.resizing-pane-column { cursor:row-resize; user-select:none; }
```

- [ ] **Step 5: Run pane tests and build**

Run:

```bash
npx vitest run src/workspace/paneLayout.test.ts src/workspace/paneWorkspace.test.ts
npm run build
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/workspace/paneLayout.ts src/workspace/paneLayout.test.ts src/workspace/paneWorkspace.ts src/styles.css
git commit -m "feat(workspace): resize nested editor panes"
```

---

### Task 11: Add Native External Markdown File Drop

**Files:**
- Create: `src/workspace/fileDrop.ts`
- Create: `src/workspace/fileDrop.test.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing file drop tests**

Create `src/workspace/fileDrop.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handleNativeFileDrop } from "./fileDrop";

describe("native file drop", () => {
  it("opens a Markdown file in the target tabbar pane", async () => {
    const openInPane = vi.fn(async () => {});
    await handleNativeFileDrop({
      paths: ["C:/w/a.md"],
      target: { kind: "tabbar", paneId: "pane-1" },
      openInPane,
      splitInPane: vi.fn(),
    });
    expect(openInPane).toHaveBeenCalledWith("pane-1", "C:/w/a.md");
  });

  it("splits a pane from an edge target", async () => {
    const splitInPane = vi.fn(async () => {});
    await handleNativeFileDrop({
      paths: ["C:/w/a.md"],
      target: { kind: "pane-edge", paneId: "pane-1", direction: "row", side: "after" },
      openInPane: vi.fn(),
      splitInPane,
    });
    expect(splitInPane).toHaveBeenCalledWith("pane-1", "C:/w/a.md", "row", "after");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/workspace/fileDrop.test.ts
```

Expected: fail because `src/workspace/fileDrop.ts` does not exist.

- [ ] **Step 3: Implement file drop handler**

Create `src/workspace/fileDrop.ts`:

```ts
import { firstMarkdownPath } from "./dropTargets";
import type { SplitDirection } from "./paneLayout";

export type ResolvedDropTarget =
  | { kind: "tabbar"; paneId: string }
  | { kind: "pane-center"; paneId: string }
  | { kind: "pane-edge"; paneId: string; direction: SplitDirection; side: "before" | "after" }
  | { kind: "none"; paneId: null };

export async function handleNativeFileDrop(args: {
  paths: string[];
  target: ResolvedDropTarget;
  openInPane: (paneId: string, path: string) => Promise<void>;
  splitInPane: (paneId: string, path: string, direction: SplitDirection, side: "before" | "after") => Promise<void>;
}): Promise<boolean> {
  const path = firstMarkdownPath(args.paths);
  if (!path || args.target.kind === "none" || !args.target.paneId) return false;
  if (args.target.kind === "pane-edge") {
    await args.splitInPane(args.target.paneId, path, args.target.direction, args.target.side);
    return true;
  }
  await args.openInPane(args.target.paneId, path);
  return true;
}
```

- [ ] **Step 4: Wire Tauri native drop event in main**

Modify `src/main.ts`:

```ts
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { handleNativeFileDrop } from "./workspace/fileDrop";
import { hitPaneDropZone, physicalToCssPoint } from "./workspace/dropTargets";
```

Add:

```ts
function resolveDropTarget(point: { x: number; y: number }): ResolvedDropTarget {
  const el = document.elementFromPoint(point.x, point.y);
  const tabbar = el?.closest<HTMLElement>(".pane-tabbar");
  if (tabbar?.dataset.paneId) return { kind: "tabbar", paneId: tabbar.dataset.paneId };

  const pane = el?.closest<HTMLElement>(".editor-pane-root");
  if (!pane?.dataset.paneId) return { kind: "none", paneId: null };
  const zone = hitPaneDropZone(pane.getBoundingClientRect(), point);
  return { ...zone, paneId: pane.dataset.paneId };
}

void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type !== "drop") return;
  const point = physicalToCssPoint(event.payload.position);
  void handleNativeFileDrop({
    paths: event.payload.paths,
    target: resolveDropTarget(point),
    openInPane: (paneId, path) => paneWorkspace.openPathInPane(paneId, path),
    splitInPane: (paneId, path, direction, side) => paneWorkspace.splitPaneAndOpen(paneId, path, direction, side),
  });
});
```

- [ ] **Step 5: Add drop overlay classes**

In `src/main.ts`, update native `enter` and `over` events to call:

```ts
showDropOverlay(resolveDropTarget(point));
```

On `leave` and `drop`, call:

```ts
hideDropOverlay();
```

Use a simple CSS overlay:

```css
.drop-overlay { position:fixed; pointer-events:none; z-index:150; border:2px solid var(--accent); background:rgba(17,74,219,0.08); }
.drop-overlay.hidden { display:none; }
```

- [ ] **Step 6: Run tests and build**

Run:

```bash
npx vitest run src/workspace/dropTargets.test.ts src/workspace/fileDrop.test.ts
npm run build
```

Expected: pass.

- [ ] **Step 7: Native smoke on Windows**

Run:

```bash
npm run tauri dev
```

Manual checks:

- Drag a `.md` file from File Explorer onto a pane tabbar. It opens as a tab in that pane.
- Drag a `.md` file onto the left edge of a pane. It creates a new pane to the left.
- Drag a `.md` file onto the right edge of a pane. It creates a new pane to the right.
- Drag a `.md` file onto the top edge of a pane. It creates a new pane above.
- Drag a `.md` file onto the bottom edge of a pane. It creates a new pane below.
- Drag a `.txt` file. Rune ignores it.
- Existing image drop into a saved Markdown document still inserts an image link.

- [ ] **Step 8: Commit**

```bash
git add src/workspace/fileDrop.ts src/workspace/fileDrop.test.ts src/main.ts src/styles.css
git commit -m "feat(workspace): open markdown files from native drop"
```

---

### Task 12: Add Tab Drag Between Panes

**Files:**
- Modify: `src/workspace/tabBar.ts`
- Modify: `src/workspace/editorPane.ts`
- Modify: `src/workspace/paneWorkspace.ts`
- Modify: `src/styles.css`
- Modify or create tests: `src/workspace/paneWorkspace.test.ts`, `src/workspace/tabBar.test.ts`

- [ ] **Step 1: Add workspace tests for moving a tab between panes**

Extend `src/workspace/paneWorkspace.test.ts`:

```ts
it("moves an existing tab from one pane to another", async () => {
  const host = document.createElement("div");
  const workspace = createPaneWorkspace({
    host,
    editorMode: "source",
    readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
    writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
    onActivePaneChange: vi.fn(),
    onActiveDocumentChange: vi.fn(),
    onRequestSaveSettings: vi.fn(),
  });
  await workspace.openPathInActivePane("/w/a.md");
  const pane2 = await workspace.splitActivePaneAndOpen("/w/b.md", "row", "after");
  workspace.moveTabToPane("pane-1", "/w/a.md", pane2, { duplicate: false });
  const snapshot = workspace.snapshot();
  expect(snapshot.panes.find((pane) => pane.id === "pane-1")?.openTabs).toEqual([]);
  expect(snapshot.panes.find((pane) => pane.id === pane2)?.openTabs).toContain("/w/a.md");
  workspace.destroy();
});
```

- [ ] **Step 2: Add pane methods for removing and accepting tabs**

In `src/workspace/editorPane.ts`, add:

```ts
removePath(path: string): boolean;
acceptPath(path: string, text: string, activate: boolean): void;
```

Rules:

- `removePath` refuses to remove a dirty tab and returns `false`.
- `removePath` removes the tab and switches to a neighbor if successful.
- `acceptPath` adds or focuses the path using existing text.
- If move source has a dirty tab, show the existing close confirmation before moving.

- [ ] **Step 3: Add workspace tab move API**

In `src/workspace/paneWorkspace.ts`, add:

```ts
moveTabToPane(sourcePaneId: string, path: string, targetPaneId: string, options: { duplicate: boolean }): Promise<boolean>;
```

Implementation:

```ts
const source = panes.get(sourcePaneId);
const target = panes.get(targetPaneId);
if (!source || !target) return false;
const text = source.textForPath(path);
if (text === null) return false;
if (!options.duplicate && !source.removePath(path)) return false;
target.acceptPath(path, text, true);
setActivePane(targetPaneId);
onRequestSaveSettings();
return true;
```

- [ ] **Step 4: Wire tabbar drag payload**

In `src/workspace/tabBar.ts`, set drag data:

```ts
event.dataTransfer?.setData("application/x-rune-tab", JSON.stringify({
  paneId: handlers.paneId,
  tabId: t.id,
  path: t.path,
  duplicate: event.ctrlKey || event.metaKey,
}));
event.dataTransfer!.effectAllowed = "move";
```

On `.pane-tabbar` dragover/drop:

```ts
el.addEventListener("dragover", (event) => {
  if (event.dataTransfer?.types.includes("application/x-rune-tab")) event.preventDefault();
});
el.addEventListener("drop", (event) => {
  const raw = event.dataTransfer?.getData("application/x-rune-tab");
  if (!raw) return;
  event.preventDefault();
  handlers.onTabDrop?.(JSON.parse(raw), handlers.paneId);
});
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npx vitest run src/workspace/tabBar.test.ts src/workspace/paneWorkspace.test.ts
npm run build
```

Expected: pass.

- [ ] **Step 6: Native desktop smoke**

Run:

```bash
npm run tauri dev
```

Manual checks:

- Drag a tab from pane A to pane B tabbar. It moves.
- Ctrl-drag a tab from pane A to pane B tabbar. It duplicates.
- Drag a dirty tab. Rune asks before removing it from the source pane.
- Closing the last tab in a pane leaves an untitled tab or collapses the pane according to the close rule selected in Task 13.

- [ ] **Step 7: Commit**

```bash
git add src/workspace/tabBar.ts src/workspace/editorPane.ts src/workspace/paneWorkspace.ts src/workspace/tabBar.test.ts src/workspace/paneWorkspace.test.ts src/styles.css
git commit -m "feat(workspace): drag tabs between panes"
```

---

### Task 13: Pane Close and Collapse Rules

**Files:**
- Modify: `src/workspace/paneWorkspace.ts`
- Modify: `src/workspace/editorPane.ts`
- Modify: `src/workspace/paneLayout.ts`
- Modify: tests

- [ ] **Step 1: Define close rule in tests**

Use this product rule:

- Closing the last tab in a pane creates an untitled tab if it is the only pane.
- Closing the last tab in a pane removes the pane if more than one pane exists.
- Removing a pane collapses redundant parent split nodes.
- Active pane moves to the nearest remaining pane in layout order.

Extend `src/workspace/paneWorkspace.test.ts`:

```ts
it("removes an empty pane when multiple panes exist", async () => {
  const host = document.createElement("div");
  const workspace = createPaneWorkspace({
    host,
    editorMode: "source",
    readFile: vi.fn(async (path: string) => ({ status: "ok" as const, data: `# ${path}` })),
    writeFile: vi.fn(async () => ({ status: "ok" as const, data: null })),
    onActivePaneChange: vi.fn(),
    onActiveDocumentChange: vi.fn(),
    onRequestSaveSettings: vi.fn(),
  });
  await workspace.openPathInActivePane("/w/a.md");
  const pane2 = await workspace.splitActivePaneAndOpen("/w/b.md", "row", "after");
  workspace.closePaneTab(pane2, "/w/b.md");
  expect(workspace.snapshot().panes.map((pane) => pane.id)).toEqual(["pane-1"]);
  expect(workspace.snapshot().root).toEqual({ type: "pane", paneId: "pane-1" });
  workspace.destroy();
});
```

- [ ] **Step 2: Implement workspace close rule**

Add to `PaneWorkspace`:

```ts
closePaneTab(paneId: string, pathOrTabId: string): void;
```

Implementation rules:

- Delegate tab close to pane.
- If pane has no tabs afterward and there is more than one pane, destroy pane and call `removePane`.
- If pane has no tabs afterward and it is the only pane, call `newDoc()`.
- Re-render layout after pane removal.
- Persist after every close.

- [ ] **Step 3: Run tests**

Run:

```bash
npx vitest run src/workspace/paneLayout.test.ts src/workspace/paneWorkspace.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/workspace/paneWorkspace.ts src/workspace/editorPane.ts src/workspace/paneLayout.ts src/workspace/paneWorkspace.test.ts
git commit -m "feat(workspace): collapse empty editor panes"
```

---

### Task 14: Update Search, File Watch, and External Open Events for Panes

**Files:**
- Modify: `src/main.ts`
- Modify: `src/workspace/paneWorkspace.ts`
- Modify: tests if existing helpers expose this logic

- [ ] **Step 1: Update search result behavior**

Keep search result behavior simple:

```ts
const searchPanel = mountSearchPanel(
  () => currentFolder,
  (path, line) => {
    void (async () => {
      await paneWorkspace.openPathInActivePane(path);
      jumpToLine(line);
    })();
  },
);
```

- [ ] **Step 2: Update external open-file event**

Existing single-instance and macOS open-file events should open in active pane:

```ts
void listen<string>("open-file", (e) => {
  void paneWorkspace.openPathInActivePane(e.payload);
});
```

- [ ] **Step 3: Update file watcher behavior**

Add to `PaneWorkspace`:

```ts
dirtyTabsForPath(path: string): Array<{ paneId: string; path: string }>;
cleanTabsForPath(path: string): Array<{ paneId: string; path: string }>;
reloadCleanTabsForPath(path: string, text: string): void;
```

In `onFsChange(paths)`:

```ts
for (const path of paths) {
  if (paneWorkspace.dirtyTabsForPath(path).length > 0) {
    banner.show();
  } else if (paneWorkspace.cleanTabsForPath(path).length > 0) {
    const res = await commands.readFile(path);
    if (res.status === "ok") paneWorkspace.reloadCleanTabsForPath(path, res.data);
  }
}
```

- [ ] **Step 4: Update reveal active**

```ts
function revealActive(): void {
  const path = activePane().activePath();
  if (path) void revealItemInDir(path);
}
```

- [ ] **Step 5: Run tests and build**

Run:

```bash
npm test -- --run
npm run build
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/workspace/paneWorkspace.ts
git commit -m "refactor(workspace): route app events through active pane"
```

---

### Task 15: i18n, Help, and Polish

**Files:**
- Modify: `src/i18n/i18n.ts`
- Modify: `src/workspace/helpPanel.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Add strings**

Add these keys in all four language blocks:

```ts
"pane.drop.openTab": "Open in tab",
"pane.drop.splitLeft": "Split left",
"pane.drop.splitRight": "Split right",
"pane.drop.splitUp": "Split up",
"pane.drop.splitDown": "Split down",
"pane.close": "Close pane",
"pane.splitRight": "Split right",
"pane.splitDown": "Split down",
```

Korean:

```ts
"pane.drop.openTab": "탭으로 열기",
"pane.drop.splitLeft": "왼쪽 분할",
"pane.drop.splitRight": "오른쪽 분할",
"pane.drop.splitUp": "위쪽 분할",
"pane.drop.splitDown": "아래쪽 분할",
"pane.close": "분할 닫기",
"pane.splitRight": "오른쪽 분할",
"pane.splitDown": "아래쪽 분할",
```

- [ ] **Step 2: Add help entries if keyboard split commands exist**

If Task 15 adds shortcuts, use:

```ts
{ keys: [MOD, "\\"], labelKey: "pane.splitRight" },
{ keys: [MOD, SHIFT, "\\"], labelKey: "pane.splitDown" },
```

If no keyboard shortcuts are implemented, do not modify `helpPanel.ts`.

- [ ] **Step 3: Run i18n-aware tests and build**

Run:

```bash
npm test -- --run
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/i18n.ts src/workspace/helpPanel.ts src/styles.css
git commit -m "feat(workspace): polish pane split labels"
```

---

### Task 16: End-to-End Verification

**Files:**
- No source changes unless a verification failure identifies a specific source fix.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass. Vite chunk-size warnings are acceptable if they match current baseline.

- [ ] **Step 2: Native desktop smoke**

Run:

```bash
npm run tauri dev
```

Verify:

- App starts with one pane when no pane layout exists.
- Legacy `openTabs` settings restore into one pane.
- Existing nested pane layout restores.
- Save persists nested pane layout.
- Open file dialog opens in active pane.
- File tree click opens in active pane.
- Search result opens in active pane and jumps to line.
- Single-instance `.md` open event opens in active pane.
- Drag `.md` from File Explorer to pane tabbar opens as a tab.
- Drag `.md` from File Explorer to pane left/right/top/bottom edge creates the expected split.
- Drag tab between panes moves it.
- Ctrl-drag tab between panes duplicates it.
- Source/preview split mode still renders inside each pane.
- Layout save/export/import/reset still affects sidebar, outline, and source-preview split ratio.
- Dirty tab close prompts still work.
- File watcher conflict banner still appears for dirty external changes.

- [ ] **Step 3: Browser visual checks**

Run:

```bash
npm run dev -- --host 127.0.0.1 --port 1438
```

Use Playwright or Browser plugin to check:

- Desktop viewport `1280x720`: two horizontal panes have readable tabbars and no text overlap.
- Desktop viewport `1280x720`: two vertical panes preserve editor scroll areas.
- Narrow viewport `390x844`: one pane remains usable; multi-pane layout scrolls or clamps without overlap.
- Drop overlay labels fit inside zones.

- [ ] **Step 4: Commit verification-only fixes**

If source fixes were required:

```bash
git add <changed-files>
git commit -m "fix(workspace): stabilize pane split interactions"
```

If no source fixes were required, do not create an empty commit.

---

## Risk Register

- `src/main.ts` is hot and brittle. Keep patches small and commit after each task.
- Pane-local autosave must not save the wrong document. Verify with two panes containing different dirty files.
- Image paste/drop must use the target pane's active path, not a global singleton.
- Native file-drop coordinates are physical pixels. Convert with `window.devicePixelRatio`.
- Existing source/preview split mode and new editor pane splits are different concepts. Keep CSS class names distinct.
- Settings must remain backward-compatible with old `openTabs`.
- HTML5 tab drag may interact differently on Windows webview. If `DataTransfer` is unreliable, switch tab drag to pointer-based internal drag in Task 12 while keeping the same `moveTabToPane` API.

## Self-Review

Spec coverage:

- VS Code style nested split panes: Tasks 1, 6, 7, 10, 13.
- Horizontal and vertical splits: Tasks 1, 2, 7, 10, 11.
- External `.md` dragged onto tabbar as new tab: Task 11.
- External `.md` dragged onto editor body to split: Task 11.
- Tabs dragged between panes or duplicated: Task 12.
- Layout save and restore: Tasks 3 and 9.
- Existing Rune behavior preservation: Tasks 8, 14, 16.

Placeholder scan:

- No task relies on unspecified file names.
- Every source change task names the files and commands.
- Product rules for pane close, drop zones, persistence, and legacy settings are explicit.

Type consistency:

- `LayoutNode`, `PaneWorkspaceSnapshot`, `PaneSnapshot`, `SplitDirection`, and `PaneId` names are consistent across model, persistence, workspace, and settings tasks.
- `paneLayout` is the new settings field in frontend and Rust.
- `source/preview splitRatio` remains in `layout`, while editor-pane split ratios remain in `paneLayout.root`.
