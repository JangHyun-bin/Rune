# VS Code Workbench Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rune's hard-coded Workspace/Outline sidebar wiring with a VS Code-style Workbench, View Container, and View Registry foundation that preserves existing editor behavior while allowing core views to be opened, closed, collapsed, switched, and restored across launches.

**Architecture:** Keep `PaneWorkspace` as the unchanged Editor Part. Add a pure, versioned workbench layout model; a registry that creates each view once; and a DOM controller that renders an Activity Bar plus Primary Sidebar around the existing editor region. Workspace, Outline, and Search become registered views without rewriting their content logic.

**Tech Stack:** TypeScript, browser DOM/CSS, Vitest in Node with local fake DOMs, Tauri 2 settings persistence, Rust serde, existing Rune i18n and context-menu utilities. No new dependency.

## Global Constraints

- Preserve `src/workspace/paneWorkspace.ts`, `paneLayout.ts`, `editorPane.ts`, tab state, autosave, native file drop, source/preview mode, and `PaneWorkspaceSnapshot` behavior.
- Do not introduce an extension manifest loader, context-key expression language, generalized Dock Tree, state library, or UI framework.
- Keep Settings and Help as modal dialogs. Only Workspace, Outline, and Search become Workbench views in this plan.
- Create every registered view at most once per app lifetime. Closing a view hides it; it does not destroy its DOM or state.
- All loaded JSON is untrusted. Normalize `workbenchLayout` before use and fall back to defaults on malformed or unsupported versions.
- Keep writing legacy `layout.sidebarWidth` and `layout.outlineHeight` for one compatibility release. `workbenchLayout` becomes the UI source of truth.
- Add every user-facing string in English, Korean, Japanese, and Simplified Chinese.
- Preserve keyboard accessibility: buttons use native `<button>`, separators keep `role="separator"`, and closing a focused view returns focus to the editor.
- Do not stage or modify the unrelated untracked `.ua/` directory.

---

## Scope Check

This plan produces one independently usable release:

- Activity Bar with Explorer and Search View Containers.
- Primary Sidebar with Workspace and Outline views.
- View open, close, collapse, container switch, and session restore.
- Existing Search behavior rendered inside the Primary Sidebar instead of a modal.
- Existing editor pane layout untouched.

Secondary Sidebar, bottom Panel, moving views between locations, internal view drag-and-drop, panel positioning, and layout import/export v2 are deliberately assigned to the follow-up plan:

`docs/superpowers/plans/2026-07-27-vscode-workbench-view-mobility.md`

## Current Code Constraints

- `index.html` hard-codes `#sidebar > #filetree + #outline-resizer + #outline`.
- `src/main.ts` owns sidebar/outline resizing, view mounting, settings snapshots, command-palette entries, and global shortcuts.
- `mountFileTree(host, ...)` and `mountOutlinePanel(host, ...)` already accept caller-owned hosts and can be wrapped without rewriting their internals.
- `mountSearchPanel(...)` creates a document-level modal and must be converted to a host-mounted view.
- `src/workspace/layoutSettings.ts` stores sidebar width, outline height, and source/preview ratio in one legacy object.
- `src-tauri/src/settings.rs` has typed settings and lossy recovery only for `pane_layout`.
- Vitest runs in Node. DOM-facing tests use small in-file fake DOMs rather than jsdom.

## File Structure

Create:

- `src/workbench/workbenchLayout.ts` — pure snapshot types, defaults, normalization, and immutable state transitions.
- `src/workbench/workbenchLayout.test.ts` — malformed-state recovery and open/close/collapse/container-switch tests.
- `src/workbench/viewRegistry.ts` — View Container/View contribution registration and create-once lifecycle.
- `src/workbench/viewRegistry.test.ts` — duplicate registration, single creation, and disposal tests.
- `src/workbench/workbench.ts` — Activity Bar and Primary Sidebar renderer/controller.
- `src/workbench/workbench.test.ts` — DOM-level open/close/reparent/focus behavior.
- `src/workspace/searchPanel.test.ts` — docked Search rendering, debounce, result selection, and lifecycle.

Modify:

- `index.html` — replace hard-coded sidebar contents with Workbench part hosts; retain `#main-col`, `#editor-toolbar`, and `#editor`.
- `src/styles.css` — Activity Bar, View Container, view header/body, hidden state, and existing resize styling.
- `src/workspace/searchPanel.ts` — mount search UI into a supplied host and expose `focus()`.
- `src/workspace/outlinePanel.ts` — add `relabel()` and `dispose()` without changing heading behavior.
- `src/workspace/fileTree.ts` — add `dispose()` to the returned interface; no rendering rewrite.
- `src/main.ts` — register the three views, replace sidebar/outline ownership with Workbench calls, and restore/save the new snapshot.
- `src/ipc/bindings.ts` — add `workbenchLayout: unknown | null`.
- `src-tauri/src/settings.rs` — persist `workbench_layout: Option<serde_json::Value>`.
- `src/i18n/i18n.ts` — Workbench, container, view, and close/collapse labels.
- `src/workspace/helpPanel.ts` — document the Activity Bar behavior; do not add a conflicting `Mod+B` shortcut.

---

### Task 1: Add the Pure Workbench Layout Model

**Files:**
- Create: `src/workbench/workbenchLayout.ts`
- Create: `src/workbench/workbenchLayout.test.ts`

**Interfaces:**
- Consumes: legacy `sidebarWidth` and `outlineHeight` numbers during migration.
- Produces:
  - `WorkbenchPartId`
  - `WorkbenchContainerId`
  - `WorkbenchViewId`
  - `WorkbenchLayoutSnapshot`
  - `DEFAULT_WORKBENCH_LAYOUT`
  - `normalizeWorkbenchLayout(value, legacy?)`
  - `openView`, `closeView`, `toggleViewCollapsed`, `activateContainer`, `setPartSize`, `resetViewVisibility`

- [ ] **Step 1: Write failing normalization and transition tests**

Create `src/workbench/workbenchLayout.test.ts` with these cases:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  activateContainer,
  closeView,
  normalizeWorkbenchLayout,
  openView,
  resetViewVisibility,
  setPartSize,
  toggleViewCollapsed,
} from "./workbenchLayout";

describe("workbench layout", () => {
  it("migrates legacy sidebar and outline sizes", () => {
    const state = normalizeWorkbenchLayout(null, {
      sidebarWidth: 318,
      outlineHeight: 176,
    });
    expect(state.parts.primarySidebar.size).toBe(318);
    expect(state.views.outline.size).toBe(176);
  });

  it("recovers from malformed and unsupported snapshots", () => {
    expect(normalizeWorkbenchLayout({ version: 99 })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(normalizeWorkbenchLayout({ version: 1, parts: null })).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it("closes and reopens a view without changing its container", () => {
    const closed = closeView(DEFAULT_WORKBENCH_LAYOUT, "outline");
    expect(closed.views.outline.visible).toBe(false);
    const reopened = openView(closed, "outline");
    expect(reopened.views.outline).toMatchObject({
      containerId: "explorer",
      visible: true,
    });
    expect(reopened.parts.primarySidebar.visible).toBe(true);
    expect(reopened.parts.primarySidebar.activeContainerId).toBe("explorer");
  });

  it("collapses a visible view without closing it", () => {
    const state = toggleViewCollapsed(DEFAULT_WORKBENCH_LAYOUT, "outline");
    expect(state.views.outline.visible).toBe(true);
    expect(state.views.outline.collapsed).toBe(true);
  });

  it("activates Search and opens the Primary Sidebar", () => {
    const state = activateContainer(DEFAULT_WORKBENCH_LAYOUT, "search");
    expect(state.parts.primarySidebar).toMatchObject({
      visible: true,
      activeContainerId: "search",
    });
  });

  it("clamps persisted part sizes", () => {
    expect(setPartSize(DEFAULT_WORKBENCH_LAYOUT, "primarySidebar", 20).parts.primarySidebar.size).toBe(96);
    expect(setPartSize(DEFAULT_WORKBENCH_LAYOUT, "primarySidebar", 9000).parts.primarySidebar.size).toBe(720);
  });

  it("resets visibility without resetting sizes or locations", () => {
    const resized = setPartSize(closeView(DEFAULT_WORKBENCH_LAYOUT, "outline"), "primarySidebar", 360);
    const reset = resetViewVisibility(resized);
    expect(reset.views.outline).toMatchObject({ visible: true, collapsed: false });
    expect(reset.parts.primarySidebar.size).toBe(360);
    expect(reset.views.outline.containerId).toBe("explorer");
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npx vitest run src/workbench/workbenchLayout.test.ts
```

Expected: FAIL because `src/workbench/workbenchLayout.ts` does not exist.

- [ ] **Step 3: Implement the exact snapshot contract**

Create `src/workbench/workbenchLayout.ts` with these public types and defaults:

```ts
export type WorkbenchPartId = "primarySidebar" | "secondarySidebar" | "panel";
export type WorkbenchContainerId = "explorer" | "search" | "auxiliary" | "panel";
export type WorkbenchViewId = "workspace" | "outline" | "search";

export interface WorkbenchPartState {
  visible: boolean;
  size: number;
  activeContainerId: WorkbenchContainerId;
}

export interface WorkbenchContainerState {
  part: WorkbenchPartId;
  order: number;
}

export interface WorkbenchViewState {
  containerId: WorkbenchContainerId;
  order: number;
  visible: boolean;
  collapsed: boolean;
  size: number | null;
}

export interface WorkbenchLayoutSnapshot {
  version: 1;
  parts: Record<WorkbenchPartId, WorkbenchPartState>;
  containers: Record<WorkbenchContainerId, WorkbenchContainerState>;
  views: Record<WorkbenchViewId, WorkbenchViewState>;
}

export const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayoutSnapshot = {
  version: 1,
  parts: {
    primarySidebar: { visible: true, size: 240, activeContainerId: "explorer" },
    secondarySidebar: { visible: false, size: 280, activeContainerId: "auxiliary" },
    panel: { visible: false, size: 220, activeContainerId: "panel" },
  },
  containers: {
    explorer: { part: "primarySidebar", order: 0 },
    search: { part: "primarySidebar", order: 1 },
    auxiliary: { part: "secondarySidebar", order: 0 },
    panel: { part: "panel", order: 0 },
  },
  views: {
    workspace: { containerId: "explorer", order: 0, visible: true, collapsed: false, size: null },
    outline: { containerId: "explorer", order: 1, visible: true, collapsed: false, size: 220 },
    search: { containerId: "search", order: 0, visible: true, collapsed: false, size: null },
  },
};
```

Implementation rules:

- Clone defaults and returned states; never mutate an input snapshot.
- Accept only `version === 1`.
- Accept only the declared part, container, and view ids.
- Clamp Primary/Secondary Sidebar size to `96..720`, Panel size to `96..600`, and Outline size to `64..600`.
- Reject non-finite sizes.
- A view may reference only an existing container.
- `openView` sets the view visible, the owning part visible, and the owning part's `activeContainerId`.
- `closeView` only changes `visible`; it does not change container, order, collapsed state, or size.
- `activateContainer` opens its owning part.
- `resetViewVisibility` restores each built-in view's default visible/collapsed state while preserving containers, orders, part sizes, and active container ids.
- Use a small internal `cloneLayout()` helper based on object/array spreads; do not use JSON stringify/parse.

- [ ] **Step 4: Run the focused tests**

Run:

```powershell
npx vitest run src/workbench/workbenchLayout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the model**

```powershell
git add src/workbench/workbenchLayout.ts src/workbench/workbenchLayout.test.ts
git commit -m "feat(workbench): add layout state model"
```

---

### Task 2: Add the Create-Once View Registry

**Files:**
- Create: `src/workbench/viewRegistry.ts`
- Create: `src/workbench/viewRegistry.test.ts`

**Interfaces:**
- Consumes: browser-created `HTMLElement` instances from core view factories.
- Produces:

```ts
export interface WorkbenchView {
  element: HTMLElement;
  focus?(): void;
  relabel?(): void;
  dispose(): void;
}

export interface ViewContainerContribution {
  id: WorkbenchContainerId;
  titleKey: string;
  icon: string;
  order: number;
}

export interface ViewContribution {
  id: WorkbenchViewId;
  titleKey: string;
  defaultContainerId: WorkbenchContainerId;
  order: number;
  create(): WorkbenchView;
}
```

- [ ] **Step 1: Write failing lifecycle tests**

Test all of the following in `src/workbench/viewRegistry.test.ts`:

```ts
it("creates a registered view once and returns the same instance", () => {
  const create = vi.fn(() => ({
    element: {} as HTMLElement,
    dispose: vi.fn(),
  }));
  const registry = createViewRegistry();
  registry.registerView({
    id: "outline",
    titleKey: "outline.title",
    defaultContainerId: "explorer",
    order: 1,
    create,
  });
  expect(registry.resolveView("outline")).toBe(registry.resolveView("outline"));
  expect(create).toHaveBeenCalledTimes(1);
});

it("rejects duplicate ids", () => {
  const registry = createViewRegistry();
  registry.registerContainer({ id: "explorer", titleKey: "view.explorer", icon: "files", order: 0 });
  expect(() => registry.registerContainer({
    id: "explorer",
    titleKey: "view.explorer",
    icon: "files",
    order: 0,
  })).toThrow("Duplicate view container: explorer");
});

it("disposes every created view exactly once", () => {
  const dispose = vi.fn();
  const registry = createViewRegistry();
  registry.registerView({
    id: "outline",
    titleKey: "outline.title",
    defaultContainerId: "explorer",
    order: 1,
    create: () => ({ element: {} as HTMLElement, dispose }),
  });
  registry.resolveView("outline");
  registry.dispose();
  registry.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Verify the tests fail**

```powershell
npx vitest run src/workbench/viewRegistry.test.ts
```

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the minimal registry**

Implement `createViewRegistry()` with private Maps for container contributions, view contributions, and created instances. Expose exactly:

```ts
export interface ViewRegistry {
  registerContainer(value: ViewContainerContribution): void;
  registerView(value: ViewContribution): void;
  containers(): ViewContainerContribution[];
  views(containerId: WorkbenchContainerId): ViewContribution[];
  view(id: WorkbenchViewId): ViewContribution;
  resolveView(id: WorkbenchViewId): WorkbenchView;
  relabel(): void;
  dispose(): void;
}
```

Required behavior:

- Sort `containers()` and `views()` by `order`, then id.
- Throw a specific `Unknown view: <id>` error instead of returning undefined.
- Cache the result of `create()`.
- `relabel()` visits created instances only.
- Make repeated `dispose()` calls safe.
- Do not add events, dependency injection containers, or lazy module imports.

- [ ] **Step 4: Run the registry and model tests**

```powershell
npx vitest run src/workbench/viewRegistry.test.ts src/workbench/workbenchLayout.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the registry**

```powershell
git add src/workbench/viewRegistry.ts src/workbench/viewRegistry.test.ts
git commit -m "feat(workbench): register view containers and views"
```

---

### Task 3: Render the Activity Bar and Primary Sidebar

**Files:**
- Create: `src/workbench/workbench.ts`
- Create: `src/workbench/workbench.test.ts`
- Modify: `index.html`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `ViewRegistry`, normalized `WorkbenchLayoutSnapshot`, existing `#editor-toolbar`, `#editor`, and `#main-col`.
- Produces:

```ts
export interface Workbench {
  snapshot(): WorkbenchLayoutSnapshot;
  restore(snapshot: WorkbenchLayoutSnapshot): void;
  openView(id: WorkbenchViewId): void;
  closeView(id: WorkbenchViewId): void;
  toggleView(id: WorkbenchViewId): void;
  toggleViewCollapsed(id: WorkbenchViewId): void;
  activateContainer(id: WorkbenchContainerId): void;
  resetViewVisibility(): void;
  setPrimarySidebarSize(size: number): void;
  relabel(): void;
  destroy(): void;
}
```

- [ ] **Step 1: Write a focused DOM behavior test**

Use the same local fake-DOM pattern as `paneWorkspace.test.ts`. The fake only needs `createElement`, `appendChild`, `replaceChildren`, `remove`, `classList`, `dataset`, attributes, event listeners, `focus`, and `contains`.

Verify:

- Initial Explorer activation mounts Workspace and Outline in order.
- Resolving/opening/closing Outline does not call its factory twice.
- Closing Outline hides its section but preserves its `element`.
- Clicking the Search Activity Bar button activates Search and mounts its view.
- Closing a focused Outline calls the injected `focusEditor`.
- `onDidChange` receives the latest snapshot after each user action.

- [ ] **Step 2: Verify the test fails**

```powershell
npx vitest run src/workbench/workbench.test.ts
```

Expected: FAIL because `workbench.ts` does not exist.

- [ ] **Step 3: Replace only the hard-coded sidebar markup**

Change the body portion of `index.html` to:

```html
<div id="body" class="workbench">
  <nav id="activitybar" aria-label="Activity Bar"></nav>
  <aside id="primary-sidebar" aria-label="Primary Side Bar"></aside>
  <div id="primary-sidebar-resizer"
       role="separator"
       aria-orientation="vertical"
       aria-label="Resize Primary Side Bar"></div>
  <div id="workbench-center">
    <div id="main-col">
      <div id="editor-toolbar"></div>
      <div id="editor"></div>
    </div>
    <div id="panel-resizer" class="hidden"
         role="separator"
         aria-orientation="horizontal"
         aria-label="Resize Panel"></div>
    <section id="panel" class="hidden" aria-label="Panel"></section>
  </div>
  <div id="secondary-sidebar-resizer" class="hidden"
       role="separator"
       aria-orientation="vertical"
       aria-label="Resize Secondary Side Bar"></div>
  <aside id="secondary-sidebar" class="hidden" aria-label="Secondary Side Bar"></aside>
</div>
```

Do not change titlebar, statusbar, editor toolbar, editor, or banner host ids.

- [ ] **Step 4: Implement the Workbench controller**

`mountWorkbench(options)` takes exact hosts rather than querying document internally:

```ts
export function mountWorkbench(options: {
  activityBar: HTMLElement;
  primarySidebar: HTMLElement;
  primaryResizer: HTMLElement;
  secondarySidebar: HTMLElement;
  secondaryResizer: HTMLElement;
  panel: HTMLElement;
  panelResizer: HTMLElement;
  registry: ViewRegistry;
  initialState: WorkbenchLayoutSnapshot;
  focusEditor: () => void;
  onDidChange: (snapshot: WorkbenchLayoutSnapshot) => void;
}): Workbench
```

Render each active View Container as:

```html
<section class="view-container" data-container-id="explorer">
  <header class="view-container-titlebar">
    <h2>Explorer</h2>
  </header>
  <div class="view-container-body">
    <section class="workbench-view" data-view-id="workspace">
      <header class="workbench-view-header">
        <button class="view-collapse" aria-expanded="true">...</button>
        <span class="view-title">Workspace</span>
        <button class="view-close">...</button>
      </header>
      <div class="workbench-view-body"></div>
    </section>
  </div>
</section>
```

Controller rules:

- Activity Bar buttons represent containers assigned to `primarySidebar`.
- Clicking the active container button toggles the entire Primary Sidebar.
- Clicking an inactive button activates that container and opens the Primary Sidebar.
- Render only the active container, but keep every resolved view instance alive in the registry.
- Move the same `view.element` into the active view body with `appendChild`; never clone it.
- A closed view remains available from a small native `<button class="view-restore">` list in the container titlebar.
- `closeView()` hides the view. If it owned focus, call `focusEditor()`.
- `toggleViewCollapsed()` toggles `.collapsed`, `aria-expanded`, and view-body visibility.
- Pointer resizing uses the existing pointer-capture pattern from `main.ts`, then emits one persisted state change on pointer release.
- `restore()` normalizes before rendering.
- Every public mutation calls one internal `commit(nextState)` function that renders and invokes `onDidChange`.

- [ ] **Step 5: Add Workbench CSS without visual redesign**

Replace fixed `#sidebar`, `#filetree`, `#outline`, and `#outline-resizer` shell rules with:

- Activity Bar fixed width: `3rem`.
- Primary Sidebar width: `var(--primary-sidebar-width, 240px)`.
- Existing six-pixel resizer.
- `#workbench-center` as `flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column`.
- `#main-col` unchanged as the editor column.
- View Container as a full-height flex column.
- Explorer's Workspace body as `flex: 1 1 auto; min-height: 120px; overflow: auto`.
- Explorer's Outline view honoring persisted `--outline-height`.
- Visible focus rings for Activity Bar, collapse, close, and restore buttons.
- `.hidden { display: none !important; }` only if an equivalent global rule does not already exist.

Retain existing `.ft-*` and `.outline-*` content styles.

- [ ] **Step 6: Run focused tests and a production build**

```powershell
npx vitest run src/workbench/workbench.test.ts src/workbench/workbenchLayout.test.ts src/workbench/viewRegistry.test.ts
npm run build
```

Expected: all tests pass and TypeScript/Vite build succeeds.

- [ ] **Step 7: Commit the shell**

```powershell
git add index.html src/styles.css src/workbench/workbench.ts src/workbench/workbench.test.ts
git commit -m "feat(workbench): render activity bar and primary sidebar"
```

---

### Task 4: Register Workspace, Outline, and Search

**Files:**
- Modify: `src/workspace/fileTree.ts`
- Modify: `src/workspace/outlinePanel.ts`
- Modify: `src/workspace/searchPanel.ts`
- Modify: `src/main.ts`
- Test: `src/workspace/fileTree.test.ts`
- Create: `src/workspace/searchPanel.test.ts`

**Interfaces:**
- Consumes: `ViewRegistry`, `Workbench`, existing file/folder commands, `parseHeadings`, and active editor callbacks.
- Produces: registered `workspace`, `outline`, and `search` view instances.

- [ ] **Step 1: Add failing lifecycle tests**

Add these contract checks:

- `FileTree.relabel()` redraws translated empty/workspace labels without losing expanded folders, and `dispose()` clears its host.
- `OutlinePanel.dispose()` clears its host and `relabel()` redraws translated labels without losing items or active line.
- Search mounts into the supplied host, does not append a backdrop to `document.body`, exposes `focus()`, keeps the existing 200 ms debounce, and opens a selected result through `openHit(path, line)`.

- [ ] **Step 2: Verify tests fail**

```powershell
npx vitest run src/workspace/fileTree.test.ts src/workspace/searchPanel.test.ts
```

Expected: FAIL on missing lifecycle methods and the old Search signature.

- [ ] **Step 3: Adapt core views without rewriting their data logic**

Update interfaces to:

```ts
export interface FileTree {
  render(root: FileNode[], folderPath?: string | null): void;
  setActive(path: string | null): void;
  showNoFolder(): void;
  showError(): void;
  relabel(): void;
  dispose(): void;
}

export interface OutlinePanel {
  render(items: HeadingItem[]): void;
  setActiveLine(line: number): void;
  relabel(): void;
  dispose(): void;
}

export interface SearchPanel {
  focus(): void;
  relabel(): void;
  dispose(): void;
}

export function mountSearchPanel(
  host: HTMLElement,
  getFolder: () => string | null,
  openHit: (path: string, line: number) => void,
): SearchPanel
```

For Search, retain the existing input/list/result logic but remove backdrop creation, modal open state, backdrop click handling, and `toggle()`.

- [ ] **Step 4: Register views in `main.ts`**

Replace the top-level fixed mounts with this ordering:

1. Create the `ViewRegistry`.
2. Register `explorer`, `search`, `auxiliary`, and `panel` containers.
3. Register `workspace`, `outline`, and `search` views.
4. Resolve Workspace and Outline immediately so `tree` and `outlinePanel` exist before settings restore.
5. Mount the Workbench with default state.
6. Create `PaneWorkspace` exactly as today.

The Workspace contribution factory creates its own element, assigns `tree`, and returns:

```ts
{
  element,
  relabel: () => tree.relabel(),
  dispose: () => tree.dispose(),
}
```

Implement `FileTree.relabel()` as one call to its existing internal `draw()` function.

Replace:

```ts
searchPanel.toggle();
```

with:

```ts
workbench.toggleView("search");
```

Replace `refreshOutline()`'s fixed panel dependency only with the assigned registered `outlinePanel`; keep its active-pane behavior unchanged.

- [ ] **Step 5: Run view, editor, and build checks**

```powershell
npx vitest run src/workspace/fileTree.test.ts src/workspace/searchPanel.test.ts src/workspace/paneWorkspace.test.ts src/workspace/editorPane.test.ts
npm run build
```

Expected: PASS. Pane and editor tests must remain unchanged.

- [ ] **Step 6: Commit registered views**

```powershell
git add src/main.ts src/workspace/fileTree.ts src/workspace/fileTree.test.ts src/workspace/outlinePanel.ts src/workspace/searchPanel.ts src/workspace/searchPanel.test.ts
git commit -m "refactor(workbench): register workspace outline and search views"
```

---

### Task 5: Persist and Restore Workbench State

**Files:**
- Modify: `src/ipc/bindings.ts`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/main.ts`
- Modify: `src/workspace/layoutSettings.ts`
- Modify: `src/workspace/layoutSettings.test.ts`

**Interfaces:**
- Consumes: `Workbench.snapshot()`, `normalizeWorkbenchLayout()`, legacy `LayoutSettings`.
- Produces: backward-compatible `workbenchLayout` settings persistence.

- [ ] **Step 1: Add failing Rust and TypeScript migration tests**

In Rust:

- Default settings have `workbench_layout == None`.
- A valid arbitrary JSON object roundtrips.
- A malformed pane layout still preserves `workbenchLayout`.

In TypeScript:

- Missing `workbenchLayout` migrates `layout.sidebarWidth` and `layout.outlineHeight`.
- Invalid `workbenchLayout` falls back to the migrated legacy sizes.

- [ ] **Step 2: Verify the tests fail**

```powershell
npx vitest run src/workbench/workbenchLayout.test.ts src/workspace/layoutSettings.test.ts
cargo test --manifest-path src-tauri/Cargo.toml settings
```

Expected: FAIL on missing settings fields and migration wiring.

- [ ] **Step 3: Add a deliberately opaque Rust persistence field**

In `Settings`, add:

```rust
pub workbench_layout: Option<serde_json::Value>,
```

This field is opaque only at the Rust storage layer. TypeScript must normalize it before use. Do not duplicate the evolving View Registry schema in Rust.

In `src/ipc/bindings.ts`, add:

```ts
workbenchLayout: unknown | null;
```

to `Settings`.

- [ ] **Step 4: Wire save and restore**

In `settingsSnapshot()`:

```ts
const workbenchLayout = workbench.snapshot();
```

Include `workbenchLayout` in the returned settings object. Continue populating:

```ts
layout.sidebarWidth = workbenchLayout.parts.primarySidebar.size;
layout.outlineHeight = workbenchLayout.views.outline.size ?? DEFAULT_LAYOUT.outlineHeight;
```

for compatibility.

During `restore()`:

```ts
const workbenchLayout = normalizeWorkbenchLayout(s.workbenchLayout, {
  sidebarWidth: s.layout?.sidebarWidth ?? s.sidebarWidth,
  outlineHeight: s.layout?.outlineHeight,
});
workbench.restore(workbenchLayout);
```

Apply this before folder and pane restoration so the shell is stable before content is loaded.

Remove `applySidebarWidth`, `applyOutlineHeight`, `mountSidebarResizer`, and `mountOutlineResizer` from `main.ts` only after their responsibilities are covered by Workbench. Keep source/preview `splitRatio` functions in `main.ts`.

- [ ] **Step 5: Run persistence and regression tests**

```powershell
npx vitest run src/workbench src/workspace/layoutSettings.test.ts src/workspace/panePersistence.test.ts
cargo test --manifest-path src-tauri/Cargo.toml settings
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit persistence**

```powershell
git add src/main.ts src/ipc/bindings.ts src-tauri/src/settings.rs src/workspace/layoutSettings.ts src/workspace/layoutSettings.test.ts src/workbench/workbenchLayout.ts src/workbench/workbenchLayout.test.ts
git commit -m "feat(workbench): persist view visibility and sizes"
```

---

### Task 6: Add User Controls, Localization, and Release Verification

**Files:**
- Modify: `src/main.ts`
- Modify: `src/chrome/chrome.ts`
- Modify: `src/i18n/i18n.ts`
- Modify: `src/workspace/helpPanel.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: Workbench public commands.
- Produces: discoverable open/close/toggle/reset controls.

- [ ] **Step 1: Add localized labels**

Add equivalent strings in all four locale dictionaries:

```text
view.explorer
view.search
view.workspace
view.outline
view.open
view.close
view.collapse
view.expand
workbench.togglePrimarySidebar
workbench.resetViewVisibility
```

Use native language translations, not copied English fallbacks.

- [ ] **Step 2: Add Workbench commands to the existing palette**

Append plain `PaletteItem` entries; do not introduce a new Command Registry:

```ts
{ label: tr("workbench.togglePrimarySidebar"), run: () => workbench.togglePrimarySidebar() },
{ label: tr("view.workspace"), run: () => workbench.openView("workspace") },
{ label: tr("view.outline"), run: () => workbench.openView("outline") },
{ label: tr("view.search"), run: () => workbench.openView("search") },
{ label: tr("workbench.resetViewVisibility"), run: () => workbench.resetViewVisibility() },
```

Add `togglePrimarySidebar()` to the Workbench interface as a thin state transition.

Do not bind `Mod+B`; Rune already uses it for Markdown bold. This release uses Activity Bar, titlebar controls, and Command Palette.

- [ ] **Step 3: Add titlebar layout controls**

Extend `mountChrome` options with:

```ts
onTogglePrimarySidebar?: () => void;
```

Add one icon button before Settings. Give it translated `title` and `aria-label`; update both in `relabel()`.

- [ ] **Step 4: Run automated verification**

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
git diff --check
```

Expected:

- All Vitest and Rust tests pass.
- Production build succeeds.
- No whitespace errors.

- [ ] **Step 5: Run the desktop smoke matrix**

Run:

```powershell
npm run tauri dev
```

Verify:

1. Existing folder opens and Workspace tree behavior is unchanged.
2. Outline follows the active editor pane and jumps to headings.
3. Closing Outline keeps Workspace open; reopening Outline restores its content and prior height.
4. Explorer Activity Bar button toggles the Primary Sidebar.
5. Search Activity Bar button replaces Explorer in the same Sidebar and opens results in the active pane.
6. Restart restores active container, visible views, collapsed views, and Primary Sidebar size.
7. Nested editor panes, native Markdown drop zones, source/preview split, autosave, find/replace, Settings, and Help still work.
8. Light/dark theme and UI scaling do not clip Activity Bar or view headers.
9. Keyboard focus remains visible; closing a focused view returns focus to CodeMirror.
10. Narrow window keeps at least 220 px for the editor and clamps Sidebar width.

- [ ] **Step 6: Commit final controls**

```powershell
git add src/main.ts src/chrome/chrome.ts src/i18n/i18n.ts src/workspace/helpPanel.ts src/styles.css
git commit -m "feat(workbench): add view controls and activity navigation"
```

---

## Self-Review

### Spec Coverage

- Existing-structure continuity: Tasks 3 and 4 retain editor DOM ids, `PaneWorkspace`, and view internals.
- Open/close/reopen: Tasks 1, 3, 4, and 6.
- VS Code-style Activity Bar/View Containers: Tasks 2, 3, and 6.
- Persistence and legacy migration: Task 5.
- Search as a real view: Task 4.
- Accessibility and focus: Tasks 3 and 6.
- No premature arbitrary docking or plugin system: Global Constraints and Scope Check.

### Type Consistency

- `WorkbenchViewId`: `workspace | outline | search` in model, registry, controller, and callers.
- `WorkbenchContainerId`: `explorer | search | auxiliary | panel` everywhere.
- `workbenchLayout`: camelCase TypeScript/Tauri JSON and `workbench_layout` Rust field through serde camelCase.
- Existing `paneLayout` remains separate and unchanged.

### Placeholder Scan

Every implementation step is concrete. Secondary/Panel mobility is explicitly assigned to the named follow-up plan rather than left unspecified.
