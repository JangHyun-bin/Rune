# VS Code Workbench View Mobility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Workbench foundation so Workspace, Outline, and Search can move between the Primary Sidebar, Secondary Sidebar, and bottom Panel through commands, context menus, and drag-and-drop, with reset and import/export support.

**Architecture:** Reuse the version-1 Workbench snapshot, Registry, and create-once view instances from the foundation plan. Add rendering for the already-declared Secondary Sidebar and Panel parts, then route every move mechanism through one pure `moveView()` state transition and one Workbench controller method.

**Tech Stack:** TypeScript, browser DOM/CSS and native HTML drag events for internal views, Vitest pure hit-testing and fake-DOM tests, existing Tauri settings persistence. No new dependency.

## Global Constraints

- This plan starts only after `2026-07-27-vscode-workbench-foundation.md` is complete and green.
- Do not modify `PaneWorkspace`, editor-pane drag/drop, or native Tauri file-drop behavior.
- Internal view drag data uses `application/x-rune-workbench-view`; native Markdown drops continue using the existing Tauri adapter.
- Commands/context menus and drag-and-drop must call the same `workbench.moveView()` method.
- Closing or moving a view must not recreate or dispose its Registry instance.
- Empty Secondary Sidebar and Panel parts hide automatically.
- The Primary Sidebar always retains at least one usable registered container, even if its views are moved out.
- Imported JSON is normalized before applying; unsupported versions do not partially mutate current state.
- Do not add floating windows, arbitrary editor docking, extension manifests, or a generalized Dock Tree.
- Do not stage or modify the unrelated untracked `.ua/` directory.

---

## Scope Check

This is one integrated mobility release:

- Secondary Sidebar and Panel rendering/resizing.
- Move View commands and context menus.
- Drag registered views among Workbench locations.
- Primary Sidebar left/right position and Panel bottom/left/right position.
- Reset locations and version-2 layout export/import.

Activity Bar reordering, arbitrary new View Containers, editor groups inside sidebars, and floating windows remain out of scope.

## File Structure

Create:

- `src/workbench/viewDrop.ts` — pure internal drag payload and drop-position helpers.
- `src/workbench/viewDrop.test.ts` — payload validation and insertion-index tests.

Modify:

- `src/workbench/workbenchLayout.ts` — `moveView`, part positions, empty-part normalization, reset helpers.
- `src/workbench/workbenchLayout.test.ts` — move/reset/position tests.
- `src/workbench/workbench.ts` — Secondary Sidebar, Panel, move menus, drag wiring, and generic resizers.
- `src/workbench/workbench.test.ts` — create-once movement, part visibility, and drop tests.
- `src/workbench/viewRegistry.ts` — expose destination container metadata only if the foundation API does not already provide it.
- `src/workspace/layoutSettings.ts` — version-2 layout export/import containing both legacy editor layout and Workbench snapshot.
- `src/workspace/layoutSettings.test.ts` — v1/v2 import compatibility and invalid-import tests.
- `src/workspace/settingsPanel.ts` — show location/visibility summary and use v2 export/import/reset.
- `src/main.ts` — palette entries and combined layout save/export/import/reset handlers.
- `src/chrome/chrome.ts` — Secondary Sidebar and Panel toggle buttons.
- `src/i18n/i18n.ts` — move/location/reset/import labels in four locales.
- `src/styles.css` — Secondary Sidebar, Panel positions, drop target/indicator, and dragging state.

---

### Task 1: Add Pure View Movement and Part Position State

**Files:**
- Modify: `src/workbench/workbenchLayout.ts`
- Modify: `src/workbench/workbenchLayout.test.ts`

**Interfaces:**
- Consumes: foundation `WorkbenchLayoutSnapshot`.
- Produces:

```ts
export type SidebarPosition = "left" | "right";
export type PanelPosition = "bottom" | "left" | "right";
export function moveView(
  state: WorkbenchLayoutSnapshot,
  viewId: WorkbenchViewId,
  containerId: WorkbenchContainerId,
  order?: number,
): WorkbenchLayoutSnapshot;
export function setPrimarySidebarPosition(
  state: WorkbenchLayoutSnapshot,
  position: SidebarPosition,
): WorkbenchLayoutSnapshot;
export function setPanelPosition(
  state: WorkbenchLayoutSnapshot,
  position: PanelPosition,
): WorkbenchLayoutSnapshot;
export function resetViewLocations(state: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot;
```

- [ ] **Step 1: Add failing transition tests**

Cover:

```ts
it("moves Outline to the auxiliary container and opens Secondary Sidebar", () => {
  const state = moveView(DEFAULT_WORKBENCH_LAYOUT, "outline", "auxiliary");
  expect(state.views.outline.containerId).toBe("auxiliary");
  expect(state.parts.secondarySidebar.visible).toBe(true);
  expect(state.parts.secondarySidebar.activeContainerId).toBe("auxiliary");
});

it("normalizes orders after moving into an occupied container", () => {
  const first = moveView(DEFAULT_WORKBENCH_LAYOUT, "outline", "search", 0);
  expect(first.views.outline.order).toBe(0);
  expect(first.views.search.order).toBe(1);
});

it("hides a source part when its last visible view moves away", () => {
  const noOutline = closeView(DEFAULT_WORKBENCH_LAYOUT, "outline");
  const moved = moveView(noOutline, "workspace", "auxiliary");
  expect(moved.parts.primarySidebar.visible).toBe(false);
});

it("resets locations without resetting part sizes", () => {
  const resized = setPartSize(DEFAULT_WORKBENCH_LAYOUT, "primarySidebar", 360);
  const moved = moveView(resized, "outline", "panel");
  const reset = resetViewLocations(moved);
  expect(reset.views.outline.containerId).toBe("explorer");
  expect(reset.parts.primarySidebar.size).toBe(360);
});
```

Also test all allowed/invalid sidebar and panel positions.

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run src/workbench/workbenchLayout.test.ts
```

Expected: FAIL on missing movement APIs.

- [ ] **Step 3: Extend the snapshot without changing its version**

Add:

```ts
positions: {
  primarySidebar: SidebarPosition;
  panel: PanelPosition;
};
```

to `WorkbenchLayoutSnapshot`, defaulting to:

```ts
positions: {
  primarySidebar: "left",
  panel: "bottom",
},
```

This remains version 1 because the foundation normalizer already owns version 1 and must treat missing position fields as defaults.

Movement rules:

- Remove the view from source ordering, insert at the clamped destination index, then renumber both containers from zero.
- Set moved view `visible: true`.
- Open and activate the destination part.
- Hide a source part only when all containers assigned to that part have no visible views.
- `resetViewLocations` restores container/order/visible/collapsed values from defaults while preserving part sizes and positions.

- [ ] **Step 4: Run tests and commit**

```powershell
npx vitest run src/workbench/workbenchLayout.test.ts
git add src/workbench/workbenchLayout.ts src/workbench/workbenchLayout.test.ts
git commit -m "feat(workbench): move views between containers"
```

---

### Task 2: Render Secondary Sidebar and Panel

**Files:**
- Modify: `src/workbench/workbench.ts`
- Modify: `src/workbench/workbench.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: existing Secondary/Panel hosts and snapshot parts.
- Produces:

```ts
moveView(viewId: WorkbenchViewId, containerId: WorkbenchContainerId, order?: number): void;
togglePart(partId: WorkbenchPartId): void;
setPrimarySidebarPosition(position: SidebarPosition): void;
setPanelPosition(position: PanelPosition): void;
resetViewLocations(): void;
```

- [ ] **Step 1: Add failing DOM tests**

Verify:

- Moving Outline from Explorer to Auxiliary reparents the exact same `element`.
- Registry factory remains called once.
- Secondary Sidebar and resizer become visible.
- Moving the last visible view out hides the source part.
- Moving Search into Panel renders a horizontal Panel tab/title row and view body.
- Bottom Panel resize persists height; left/right Panel resize persists width in the same `parts.panel.size`.
- Toggling a part never changes child view visibility.

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run src/workbench/workbench.test.ts
```

- [ ] **Step 3: Generalize rendering by part**

Refactor one internal renderer:

```ts
function renderPart(
  partId: WorkbenchPartId,
  host: HTMLElement,
  resizer: HTMLElement,
): void
```

Rules:

- Sidebar containers render views vertically with collapsible headers.
- Panel containers render visible views as a tab row; the active view body fills remaining space.
- Empty parts and their resizers receive `.hidden`.
- Reparent cached `view.element`; never replace it with a clone.
- Set `data-part-id`, `data-container-id`, and `data-view-id` on drop-relevant elements.
- Use one generic pointer-resize helper inside `workbench.ts`; do not create a separate utility until another caller exists.

- [ ] **Step 4: Add position CSS**

Use attributes/classes on `#body` and `#workbench-center`:

```text
data-primary-sidebar-position="left|right"
data-panel-position="bottom|left|right"
```

Required behavior:

- Primary Sidebar and Activity Bar move together.
- Secondary Sidebar remains opposite the Primary Sidebar.
- Bottom Panel sits below `#main-col`.
- Left/right Panel sits beside `#main-col` inside `#workbench-center`.
- Existing editor minimum width remains 220 px.
- Resizer cursor and `aria-orientation` update with position.

- [ ] **Step 5: Run and commit**

```powershell
npx vitest run src/workbench/workbench.test.ts src/workbench/workbenchLayout.test.ts
npm run build
git add src/workbench/workbench.ts src/workbench/workbench.test.ts src/styles.css
git commit -m "feat(workbench): add secondary sidebar and panel"
```

---

### Task 3: Add Move Commands and Context Menus

**Files:**
- Modify: `src/workbench/workbench.ts`
- Modify: `src/main.ts`
- Modify: `src/chrome/chrome.ts`
- Modify: `src/i18n/i18n.ts`

**Interfaces:**
- Consumes: existing `showContextMenu`, Workbench movement APIs, Palette Items.
- Produces: mouse- and keyboard-accessible movement without drag-and-drop.

- [ ] **Step 1: Add localized strings**

Add translations for:

```text
workbench.toggleSecondarySidebar
workbench.togglePanel
workbench.moveView
workbench.moveToPrimarySidebar
workbench.moveToSecondarySidebar
workbench.moveToPanel
workbench.movePrimarySidebarLeft
workbench.movePrimarySidebarRight
workbench.movePanelBottom
workbench.movePanelLeft
workbench.movePanelRight
workbench.resetViewLocations
```

- [ ] **Step 2: Add a view-header More Actions callback**

Extend `mountWorkbench` options:

```ts
onViewMenu?: (viewId: WorkbenchViewId, x: number, y: number) => void;
```

The view header `...` button calls this callback. In `main.ts`, use the existing `showContextMenu` with explicit destination entries:

```ts
[
  { label: tr("workbench.moveToPrimarySidebar"), run: () => workbench.moveView(id, "explorer") },
  { label: tr("workbench.moveToSecondarySidebar"), run: () => workbench.moveView(id, "auxiliary") },
  { label: tr("workbench.moveToPanel"), run: () => workbench.moveView(id, "panel") },
  { label: tr("view.close"), run: () => workbench.closeView(id) },
]
```

Do not show the current destination as a move option.

- [ ] **Step 3: Add palette and titlebar controls**

Add Palette Items for all part toggles, view moves, position changes, and reset. Add Secondary Sidebar and Panel toggle buttons to `mountChrome`, including translated tooltips and ARIA labels.

- [ ] **Step 4: Verify**

```powershell
npm test
npm run build
```

Manual keyboard-only check: open Command Palette, move Outline to each part, close/reopen it, reset locations, and verify focus never becomes trapped.

- [ ] **Step 5: Commit**

```powershell
git add src/workbench/workbench.ts src/main.ts src/chrome/chrome.ts src/i18n/i18n.ts
git commit -m "feat(workbench): move views with commands and menus"
```

---

### Task 4: Add Internal View Drag-and-Drop

**Files:**
- Create: `src/workbench/viewDrop.ts`
- Create: `src/workbench/viewDrop.test.ts`
- Modify: `src/workbench/workbench.ts`
- Modify: `src/workbench/workbench.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: HTML `DragEvent`, `workbench.moveView`.
- Produces:

```ts
export const VIEW_DRAG_TYPE = "application/x-rune-workbench-view";
export interface ViewDropTarget {
  containerId: WorkbenchContainerId;
  order: number;
}
export function encodeViewDrag(id: WorkbenchViewId): string;
export function decodeViewDrag(value: string): WorkbenchViewId | null;
export function insertionIndex(midpoints: number[], pointer: number): number;
```

- [ ] **Step 1: Add pure failing tests**

Verify:

- Only `workspace`, `outline`, and `search` payloads decode.
- Empty, JSON, Markdown paths, and arbitrary ids return null.
- Insertion index returns zero before all headers, the middle index between headers, and length after all headers.

- [ ] **Step 2: Implement pure helpers and run tests**

```powershell
npx vitest run src/workbench/viewDrop.test.ts
```

Expected after implementation: PASS.

- [ ] **Step 3: Wire internal dragging**

Rules:

- Only `.workbench-view-header` is draggable.
- On `dragstart`, set `VIEW_DRAG_TYPE` and `effectAllowed = "move"`.
- Container bodies accept dragover only when `decodeViewDrag()` succeeds.
- Compute insertion order from visible view-header vertical midpoints in Sidebars and tab horizontal midpoints in Panel.
- On drop, call only `workbench.moveView(viewId, containerId, order)`.
- Clear all indicators on `drop`, `dragend`, and window blur.
- Do not call or modify native Tauri Markdown drop handlers.

- [ ] **Step 4: Add visual and DOM checks**

Add:

- `.view-dragging` opacity.
- `.view-drop-target` outline.
- `.view-drop-indicator` two-pixel accent line.
- `prefers-reduced-motion` disables indicator transitions.

DOM test must assert that drop calls `moveView` and the instance is still created once.

- [ ] **Step 5: Run and commit**

```powershell
npx vitest run src/workbench/viewDrop.test.ts src/workbench/workbench.test.ts
npm run build
git add src/workbench/viewDrop.ts src/workbench/viewDrop.test.ts src/workbench/workbench.ts src/workbench/workbench.test.ts src/styles.css
git commit -m "feat(workbench): drag views between parts"
```

---

### Task 5: Upgrade Layout Import, Export, and Reset

**Files:**
- Modify: `src/workspace/layoutSettings.ts`
- Modify: `src/workspace/layoutSettings.test.ts`
- Modify: `src/workspace/settingsPanel.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: current source/preview `ResolvedLayoutSettings`, `WorkbenchLayoutSnapshot`.
- Produces:

```ts
export interface LayoutExportV2 {
  version: 2;
  layout: ResolvedLayoutSettings;
  workbench: WorkbenchLayoutSnapshot;
}
```

- [ ] **Step 1: Add failing compatibility tests**

Test:

- Version 2 roundtrip preserves part sizes, positions, containers, visibility, and source/preview ratio.
- Existing version 1 `{ version: 1, layout: ... }` still imports and uses default Workbench state.
- Existing plain legacy layout object still imports.
- Invalid Workbench data rejects the whole v2 import rather than applying only numeric layout values.

- [ ] **Step 2: Implement version-2 serialization**

Use signatures:

```ts
export function serializeLayoutSettings(
  layout: Partial<LayoutSettings>,
  workbench: WorkbenchLayoutSnapshot,
): string;

export function parseLayoutSettingsJson(text: string): {
  layout: ResolvedLayoutSettings;
  workbench: WorkbenchLayoutSnapshot | null;
} | null;
```

Version-1 and plain imports return `workbench: null`. Version-2 imports normalize Workbench data and reject when the input declared version 2 but omitted it.

- [ ] **Step 3: Apply imported state atomically**

In `main.ts`, parse first. Only after a non-null result:

```ts
applyLayoutSettings(parsed.layout, false);
if (parsed.workbench) workbench.restore(parsed.workbench);
scheduleSaveSettings();
settingsPanel.refresh();
```

Reset restores:

- `DEFAULT_LAYOUT` for source/preview ratio.
- `DEFAULT_WORKBENCH_LAYOUT` for locations, visibility, sizes, and positions.
- Existing `paneLayout` remains untouched.

- [ ] **Step 4: Run and commit**

```powershell
npx vitest run src/workspace/layoutSettings.test.ts src/workbench/workbenchLayout.test.ts
npm run build
git add src/workspace/layoutSettings.ts src/workspace/layoutSettings.test.ts src/workspace/settingsPanel.ts src/main.ts
git commit -m "feat(workbench): export and reset custom layouts"
```

---

### Task 6: Full Regression and Desktop QA

**Files:**
- Modify only if a verified defect requires a fix.

- [ ] **Step 1: Run all automated checks**

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Run the complete desktop matrix**

```powershell
npm run tauri dev
```

Verify:

1. Workspace, Outline, and Search move by menu and Command Palette among all three parts.
2. Dragging each view to all destinations produces the same final state as commands.
3. Moving Outline retains current headings, active heading, scroll position, and instance.
4. Moving Workspace retains expanded folders and active file.
5. Secondary Sidebar and Panel hide when empty and reopen with previous size.
6. Primary Sidebar left/right and Panel bottom/left/right survive restart.
7. Export, reset, and import recover the same Workbench arrangement.
8. Reset does not close editor tabs or alter editor pane splits.
9. Internal view drag never triggers native Markdown-file drop behavior.
10. External Markdown drop still opens/splits editor panes.
11. Light/dark themes, UI scale range, editor font scale, and 390 px-wide window remain usable.
12. All close, collapse, toggle, More Actions, and titlebar buttons have visible keyboard focus and translated ARIA labels.

- [ ] **Step 3: Inspect the final diff**

```powershell
git status --short
git diff --stat
git diff -- src/workbench src/main.ts index.html src/styles.css src/ipc/bindings.ts src-tauri/src/settings.rs
```

Confirm `.ua/` is not staged and no unrelated generated assets are included.

- [ ] **Step 4: Commit verified fixes if any**

If Task 6 required code fixes, stage only those exact files and commit:

```powershell
git commit -m "fix(workbench): close layout regression gaps"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

### Spec Coverage

- Secondary Sidebar and Panel: Task 2.
- Open/close/reopen across all parts: Tasks 1–3.
- Command/context-menu movement: Task 3.
- Drag-and-drop movement: Task 4.
- Position, persistence, reset, export/import: Tasks 1, 2, and 5.
- Editor and native-drop continuity: Global Constraints and Task 6.
- Accessibility and four-locale coverage: Tasks 3, 4, and 6.

### Type Consistency

- Movement always targets `WorkbenchContainerId`, never raw DOM ids.
- Drag payload decodes to `WorkbenchViewId`.
- Controller, menu, palette, and drag route through the same `moveView` signature.
- Layout export v2 carries `ResolvedLayoutSettings` and `WorkbenchLayoutSnapshot`; editor `paneLayout` remains separate.

### Placeholder Scan

The plan contains no deferred implementation placeholders. Floating windows, arbitrary docking, extensions, and Activity Bar reordering are explicit non-goals.

