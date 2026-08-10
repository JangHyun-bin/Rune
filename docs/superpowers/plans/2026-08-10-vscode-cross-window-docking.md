# VS Code-style Cross-window Docking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Rune Workbench View or View group be dragged out into a native window and dropped into an exact tab, group, split edge, Sidebar, or Panel target across Rune windows, with atomic rollback and restart-safe persistence.

**Architecture:** Keep the main window as the single layout owner. Source and target windows publish geometry, render drag previews, and exchange versioned messages, but only a main-owned `DockDragCoordinator` may commit a layout transaction. Replace the current HTML5-only View drag path with one pointer/native drag session and retain the existing menu and redock button as accessible fallbacks.

**Tech Stack:** TypeScript, DOM Pointer Events, Tauri 2 WebviewWindow APIs, Rust only if the Task 1 native feasibility gate proves the JavaScript APIs insufficient, Vitest, WebdriverIO, GitHub Actions.

## Global Constraints

- Scope is Workbench Views and View groups; Editor Pane and editor-tab tear-off are a separate project.
- Preserve `Workbench Parts + View Registry`; do not introduce a generalized Dock Tree, extension API, UI framework, or state library.
- Main remains the sole authoritative layout owner; detached windows never commit layout independently.
- Hover and preview must not mutate persisted layout. Apply one atomic transaction only after a valid drop.
- Cancel, stale revision, source closure, target closure, window-creation failure, and IPC failure must preserve the exact source state.
- Existing `Move to New Window` and `Move View Group Back to Main Window` controls remain functional fallbacks.
- Use physical screen coordinates at native boundaries and logical CSS coordinates inside each Webview; all conversions must include each window's scale factor and inner origin.
- Do not claim completion from menu/button automation. Windows, macOS, and Linux must each have an actual pointer drag evidence record.
- Do not bump or tag `v1.0.1` until every task and release gate in this plan is complete.

---

## File and Responsibility Map

| File | Responsibility |
|---|---|
| `src/workbench/dockTypes.ts` | Shared drag payload, target, surface, session, and transaction types |
| `src/workbench/dockGeometry.ts` | Logical/physical coordinate conversion and deterministic target hit testing |
| `src/workbench/dockTransaction.ts` | Pure, revision-checked dock planning and atomic layout transition |
| `src/workbench/dockDragSession.ts` | Pointer/native drag state machine with preview, commit, and cancel |
| `src/workbench/tauriDockDragAdapter.ts` | Tauri cursor, window metrics, native move, and cross-window event adapter |
| `src/workbench/viewGroupLayout.ts` | Existing pure group split/combine/remove operations extended for group moves |
| `src/workbench/workbenchLayout.ts` | Existing Workbench-level transition entry points |
| `src/workbench/workbench.ts` | Main-window source handles, target surfaces, preview overlay, and pointer binding |
| `src/workbench/viewWindowHost.ts` | Main-owned native window lifecycle and transaction orchestration |
| `src/workbench/viewWindowTransfer.ts` | Strictly normalized, versioned cross-window docking protocol |
| `src/workbench/tauriViewWindowAdapter.ts` | Native window creation and geometry capture used by the host |
| `src/workbench/viewWindowLayout.ts` | Version 2 detached-window layout and version 1 migration |
| `src/detachedView.ts` | Detached source handles, target surfaces, preview, and fallback redock UI |
| `src/main.ts` | Coordinator construction, restore order, persistence, and error presentation |
| `src/styles.css` | Drag ghost, target overlay, split-edge, combine, and invalid-target states |
| `src-tauri/capabilities/default.json` | Main-window native drag permissions |
| `src-tauri/capabilities/detached-view.json` | Detached-window native drag permissions |
| `e2e/workbench.docking.smoke.mjs` | Scripted multi-window transport and layout acceptance scenarios |
| `docs/qa/v1.0.1-native-docking.md` | Actual pointer evidence matrix for all supported operating systems |

---

### Task 1: Prove the Native Drag Boundary

**Files:**
- Create: `src/workbench/tauriDockDragAdapter.ts`
- Create: `src/workbench/tauriDockDragAdapter.test.ts`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/capabilities/detached-view.json`
- Create: `docs/qa/v1.0.1-native-docking.md`

**Interfaces:**
- Produces: `NativeDockWindowMetrics`, `NativeDockDragAdapter`, `createTauriDockDragAdapter()`
- Consumes: Tauri `cursorPosition()`, `getCurrentWindow().innerPosition()`, `scaleFactor()`, `startDragging()`, `onMoved()`

- [x] **Step 1: Write the adapter contract and failing unit test**

```ts
export interface NativeDockWindowMetrics {
  windowLabel: string;
  innerOrigin: { x: number; y: number };
  scaleFactor: number;
}

export interface NativeDockDragAdapter {
  metrics(): Promise<NativeDockWindowMetrics>;
  cursor(): Promise<{ x: number; y: number }>;
  startNativeWindowDrag(): Promise<void>;
  onWindowMoved(listener: () => void): Promise<() => void>;
}
```

The test must inject a fake Tauri facade and assert that physical positions and scale factor are returned unchanged, listener disposal is preserved, and a rejected `startDragging()` reaches the caller.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `npx vitest run src/workbench/tauriDockDragAdapter.test.ts`

Expected: FAIL because `createTauriDockDragAdapter` does not exist.

- [x] **Step 3: Implement the minimal Tauri adapter**

Import only from `@tauri-apps/api/window`. Do not add a Rust dependency. Add `core:window:allow-start-dragging` to both capability files if `core:default` does not authorize the call in a production build.

- [x] **Step 4: Validate the unresolved native semantics on all three OSes**

Record these exact observations in `docs/qa/v1.0.1-native-docking.md`:

```markdown
| OS | startDragging resolves after release | onMoved during drag | cursor is physical | mixed-DPI conversion | result |
|---|---:|---:|---:|---:|---|
| Windows | yes/no | yes/no | yes/no | pass/fail | pass/fail |
| macOS | yes/no | yes/no | yes/no | pass/fail | pass/fail |
| Linux | yes/no | yes/no | yes/no | pass/fail | pass/fail |
```

The gate passes only when drag completion and coordinates can be detected without a global input hook. If one OS fails, stop this plan and design one minimal Rust command/event interface before Task 2; do not install a global mouse-hook library that requires macOS Accessibility permission.

- [x] **Step 5: Run tests and commit**

Run: `npx vitest run src/workbench/tauriDockDragAdapter.test.ts`

Commit: `test(workbench): prove native docking drag boundary`

---

### Task 2: Add Atomic Dock Plans

**Files:**
- Create: `src/workbench/dockTypes.ts`
- Create: `src/workbench/dockTransaction.ts`
- Create: `src/workbench/dockTransaction.test.ts`
- Modify: `src/workbench/viewGroupLayout.ts`
- Modify: `src/workbench/viewGroupLayout.test.ts`
- Modify: `src/workbench/workbenchLayout.ts`
- Modify: `src/workbench/workbenchLayout.test.ts`

**Interfaces:**
- Produces: `DockPayload`, `DockTarget`, `DockWorkspaceSnapshot`, `DockPlan`, `planDock()`, `applyDockPlan()`
- Consumes: existing View split, combine, move, remove, and normalization transitions

- [ ] **Step 1: Define strict shared types**

```ts
export interface DockLocation {
  windowLabel: string;
  containerId: WorkbenchContainerId;
  groupId: string;
}

export type DockPayload =
  | { kind: "view"; viewId: WorkbenchViewId; source: DockLocation }
  | { kind: "group"; viewIds: WorkbenchViewId[]; activeViewId: WorkbenchViewId; source: DockLocation };

export type DockTarget =
  | { kind: "tabs"; windowLabel: string; containerId: WorkbenchContainerId; groupId: string; index: number }
  | { kind: "combine"; windowLabel: string; containerId: WorkbenchContainerId; groupId: string }
  | { kind: "split"; windowLabel: string; containerId: WorkbenchContainerId; groupId: string; direction: "row" | "column"; side: "before" | "after" }
  | { kind: "container"; windowLabel: string; containerId: WorkbenchContainerId; index: number }
  | { kind: "new-window"; bounds: WindowBounds };

export interface DockWorkspaceSnapshot {
  revision: number;
  workbench: WorkbenchLayoutSnapshot;
  viewWindows: ViewWindowLayoutSnapshot;
}
```

- [ ] **Step 2: Write the RED transaction matrix**

Tests must cover: View tab reorder, cross-container move, center combine, four split edges, whole-group move, new-window extraction, empty-source cleanup, duplicate View rejection, stale revision rejection, self-drop no-op, and invalid target rejection.

The critical rollback assertion is:

```ts
const before = structuredClone(snapshot);
const plan = planDock(snapshot, payload, invalidTarget);
expect(plan).toEqual({ ok: false, reason: "invalid-target" });
expect(snapshot).toEqual(before);
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `npx vitest run src/workbench/dockTransaction.test.ts src/workbench/viewGroupLayout.test.ts src/workbench/workbenchLayout.test.ts`

- [ ] **Step 4: Implement pure planning and apply functions**

`planDock()` must clone and normalize the candidate, return effects without mutating input, and embed `baseRevision`. `applyDockPlan()` must reject when `current.revision !== plan.baseRevision`; success increments revision exactly once.

- [ ] **Step 5: Run tests and commit**

Commit: `feat(workbench): add atomic cross-window dock plans`

---

### Task 3: Register Screen-space Dock Surfaces

**Files:**
- Create: `src/workbench/dockGeometry.ts`
- Create: `src/workbench/dockGeometry.test.ts`
- Modify: `src/workbench/dockTypes.ts`
- Modify: `src/workbench/workbench.ts`
- Modify: `src/detachedView.ts`

**Interfaces:**
- Produces: `DockSurface`, `DockZone`, `toPhysicalScreenRect()`, `hitDockZone()`
- Consumes: `NativeDockWindowMetrics`, DOM `getBoundingClientRect()`

- [ ] **Step 1: Define geometry types and RED tests**

```ts
export interface LogicalRect { left: number; top: number; width: number; height: number }
export interface PhysicalRect { x: number; y: number; width: number; height: number }
export interface DockZone { id: string; rect: LogicalRect; target: DockTarget; priority: number }
export interface DockSurface { windowLabel: string; revision: number; metrics: NativeDockWindowMetrics; zones: DockZone[] }
```

Tests must include scale factors `1`, `1.25`, `1.5`, and `2`, negative monitor origins, overlapping tab/edge zones, zero-sized hidden elements, and deterministic priority selection.

- [ ] **Step 2: Implement conversions and hit testing**

Use:

```ts
x = innerOrigin.x + logical.left * scaleFactor
y = innerOrigin.y + logical.top * scaleFactor
width = logical.width * scaleFactor
height = logical.height * scaleFactor
```

Round only at the final physical rectangle boundary. Ignore hidden and zero-area zones.

- [ ] **Step 3: Publish surfaces from main and detached windows**

Main publishes View tab strips, group center, four group edges, empty containers, Primary Sidebar, Secondary Sidebar, and Panel. Detached windows initially publish their tab strip and group center; detached split edges are added in Task 7 with layout version 2.

- [ ] **Step 4: Run tests and commit**

Commit: `feat(workbench): map dock targets across native windows`

---

### Task 4: Replace HTML5 View Drag with One Session State Machine

**Files:**
- Create: `src/workbench/dockDragSession.ts`
- Create: `src/workbench/dockDragSession.test.ts`
- Modify: `src/workbench/workbench.ts`
- Modify: `src/workbench/viewDrop.ts`
- Modify: `src/workbench/workbench.test.ts`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `DockDragCoordinator`, `begin()`, `move()`, `drop()`, `cancel()`
- Consumes: `planDock()`, `hitDockZone()`, registered `DockSurface` values

- [ ] **Step 1: Write state-machine RED tests**

Required states are `idle`, `armed`, `dragging`, `committing`, and `cancelled`. The drag threshold is measured in CSS pixels inside a window; native screen coordinates are used after `dragging` begins.

Tests must prove:

- pointerdown alone does not move a View;
- crossing the threshold begins one session;
- hover changes preview without changing snapshot revision;
- Escape cancels and clears every overlay;
- pointer release on a valid target commits once;
- pointer release without a target requests `new-window` only when the pointer is outside every Rune surface;
- a second pointer cannot join an active session.

- [ ] **Step 2: Implement the state machine behind an internal feature flag**

Expose `VITE_NATIVE_DOCKING=1` for development and CI until Task 8. Do not remove the old path yet.

- [ ] **Step 3: Bind View headers and tabs to Pointer Events**

Single View header/tab drag produces `kind: "view"`. A dedicated group drag handle produces `kind: "group"`. Keep click, context menu, collapse, close, and keyboard behavior unchanged.

- [ ] **Step 4: Render one ghost and one target overlay**

The overlay must distinguish `tabs`, `combine`, `split`, `container`, and invalid targets. Use CSS classes with no inline colors so light/dark themes continue to work.

- [ ] **Step 5: Delete the old HTML5 path only after parity tests pass**

Remove `VIEW_DRAG_TYPE`, `DataTransfer` reads, and `window.blur -> finishViewDrag` only when all existing in-window movement tests pass through the new coordinator.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run src/workbench/dockDragSession.test.ts src/workbench/workbench.test.ts src/workbench/viewDrop.test.ts`

Commit: `refactor(workbench): unify view docking drag sessions`

---

### Task 5: Continue Drag-out into a Native Tear-off

**Files:**
- Modify: `src/workbench/viewWindowHost.ts`
- Modify: `src/workbench/viewWindowHost.test.ts`
- Modify: `src/workbench/tauriViewWindowAdapter.ts`
- Modify: `src/workbench/tauriViewWindowAdapter.test.ts`
- Modify: `src/main.ts`
- Modify: `src/detachedView.ts`

**Interfaces:**
- Produces: `tearOffPayload(payload, bounds)`, `beginNativeMove(windowLabel)`, ready/commit acknowledgement
- Consumes: Task 1 native adapter and Task 2 dock transaction

- [ ] **Step 1: Write RED lifecycle tests**

Assert this sequence:

```text
create native window
-> wait for rune:view-window-ready
-> prepare new-window DockPlan
-> apply plan
-> hide committed source
-> send init
-> begin native move
```

Creation error, ready timeout, plan rejection, and `startDragging()` rejection must leave the source visible and close any incomplete target window.

- [ ] **Step 2: Split View and group semantics**

A View dragged from a multi-View group creates a new detached group containing only that View. The explicit menu action and group handle continue to detach the full group.

- [ ] **Step 3: Position and move the window from the pointer**

Create the window around the physical cursor using the last stable size or `420x640`. Clamp it to the cursor's monitor work area before calling `startNativeWindowDrag()`.

- [ ] **Step 4: Run lifecycle tests and commit**

Commit: `feat(workbench): tear off views with native dragging`

---

### Task 6: Commit Detached-to-main and Detached-to-detached Drops

**Files:**
- Modify: `src/workbench/viewWindowTransfer.ts`
- Modify: `src/workbench/viewWindowTransfer.test.ts`
- Modify: `src/workbench/viewWindowHost.ts`
- Modify: `src/workbench/viewWindowHost.test.ts`
- Modify: `src/detachedView.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: protocol version 2 messages `dock:start`, `dock:surface`, `dock:preview`, `dock:commit`, `dock:result`, `dock:cancel`
- Consumes: `DockPayload`, `DockTarget`, `DockPlan`

- [ ] **Step 1: RED-test strict protocol normalization**

Every message must contain `version: 2`, `sessionId`, `sourceWindowLabel`, and exact per-message keys. Reject unknown keys, unsupported View IDs, invalid labels, non-finite coordinates, duplicate View IDs, and mismatched session IDs.

- [ ] **Step 2: Add draggable detached tabs and a group handle**

Detached tab drag emits a View payload. Detached header background/group handle starts native movement with a group payload. The `↙` button remains an explicit original-location fallback.

- [ ] **Step 3: Show target-window previews**

The main coordinator selects one global target and emits preview only to that target window. All previously highlighted windows must clear their overlay on target change, cancel, source loss, or commit.

- [ ] **Step 4: Commit target-aware redock**

Replace targetless `redock(label)` usage for drag drops with `commitDock(sessionId, target)`. Apply the layout plan first, acknowledge the target render, then close an empty source window. A negative acknowledgement restores the source projection without changing revision.

- [ ] **Step 5: Cover the destination matrix**

Tests must cover detached to Primary Sidebar, Secondary Sidebar, Panel, existing group tab index, four main-window split edges, and detached-to-detached center combine.

- [ ] **Step 6: Run tests and commit**

Commit: `feat(workbench): dock view groups across windows`

---

### Task 7: Persist Version 2 Multi-window Layouts and Recovery

**Files:**
- Modify: `src/workbench/viewWindowLayout.ts`
- Modify: `src/workbench/viewWindowLayout.test.ts`
- Modify: `src/workbench/viewWindowHost.ts`
- Modify: `src/workbench/workbench.ts`
- Modify: `src/detachedView.ts`
- Modify: `src/ipc/bindings.ts`
- Modify: `src-tauri/src/settings.rs`
- Modify: `src/workspace/layoutSettings.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `ViewWindowLayoutSnapshot` version 2 and version 1 migration
- Consumes: committed group/window placement from Task 6

- [ ] **Step 1: Define the version 2 persisted shape**

Each window stores its stable label, ordered group references, active group, bounds, monitor snapshot, and no transient drag session. Persist only after a successful dock commit or debounced geometry capture.

- [ ] **Step 2: RED-test migration and corruption handling**

Version 1 must migrate to one group per window. Duplicate group ownership, missing groups, cyclic trees, malformed bounds, unsupported versions, and interrupted transaction data must recover to one authoritative owner without losing visible Views.

- [ ] **Step 3: Restore detached combinations**

Recreate windows, wait for readiness, then project the saved group order. If one target window fails, return its groups to their stored main containers while continuing to restore other valid windows.

- [ ] **Step 4: Add detached split edges only after multi-group restore passes**

Extend detached rendering from a single tab group to the same group-tree renderer used by the main Workbench. Do not duplicate the split algorithm in `detachedView.ts`.

- [ ] **Step 5: Verify Hot Exit isolation**

Dirty editor and PaneWorkspace snapshots remain owned by the editor system. Cross-window View moves must not copy document bodies into View-window transfer messages.

- [ ] **Step 6: Run full tests and commit**

Run: `npm test -- --run`

Commit: `feat(workbench): persist cross-window dock layouts`

---

### Task 8: Replace the False-positive Release Gate

**Files:**
- Create: `e2e/workbench.docking.smoke.mjs`
- Modify: `e2e/workbench.smoke.mjs`
- Modify: `e2e/workbench.restore.smoke.mjs`
- Modify: `wdio.conf.mjs`
- Modify: `wdio.linux.conf.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `docs/qa/v1.0.1-native-docking.md`

**Interfaces:**
- Consumes: production `DockDragCoordinator` through pointer actions and a scripted native adapter only where a hosted runner cannot generate a cross-window OS pointer move
- Produces: deterministic CI evidence plus separate actual-pointer evidence

- [ ] **Step 1: Write a failing E2E that asserts the destination**

The test must not select `Move to New Window` and must not use `.detached-view-redock` for its primary assertion. It must drag Outline out, then dock it into Panel, and assert all of:

- native window count returns from two to one;
- Outline's persisted `containerId` is `panel`;
- Outline is in the requested group/order rather than its original Explorer group;
- dirty editor sentinel remains unchanged.

- [ ] **Step 2: Add cancel and restart E2E scenarios**

Cancel must preserve the exact serialized layout. Restart must recreate a detached View, then a real dock transaction must move it to a new target and persist that target for the next session.

- [ ] **Step 3: Add release-branch native jobs**

Keep deterministic scripted transport checks on every supported runner. Require the actual-pointer evidence table to be completely `pass` before creating the release tag; scripted events cannot satisfy that gate.

- [ ] **Step 4: Run the complete validation stack**

Run:

```powershell
npm test -- --run
npm run build
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit `0`; environment-dependent Pandoc/performance tests may remain explicitly ignored as they are today.

- [ ] **Step 5: Remove the feature flag and update product documentation**

Document actual drag-out, exact-target re-dock, menu fallback, and the View-only scope. Correct earlier claims that button-based return was cross-window drag validation.

- [ ] **Step 6: Commit**

Commit: `test(workbench): gate real cross-window docking`

---

### Task 9: Prepare the v1.0.1 Correction Release

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `README.md`
- Modify: `README.ko.md`

**Interfaces:**
- Consumes: all Task 1-8 acceptance evidence
- Produces: immutable `v1.0.1` source and updater metadata

- [ ] **Step 1: Confirm release blockers are zero**

Required evidence: full local validation, release-branch CI, three-OS actual-pointer matrix, multi-monitor/mixed-DPI result, cancel/failure rollback, restart recovery, and no unresolved critical review findings.

- [ ] **Step 2: Bump every version to `1.0.1` and update fixed download URLs**

Run the README version test before committing.

- [ ] **Step 3: Commit and run release-branch CI**

Commit: `release: prepare v1.0.1`

- [ ] **Step 4: Integrate to main and create an annotated tag only after green CI**

Tag: `v1.0.1`

- [ ] **Step 5: Verify the public release**

Require non-draft, non-prerelease, GitHub Latest, complete installers/signatures/checksums, macOS codesign/notarization/stapling/Gatekeeper, Windows install/launch, Linux package launch, and updater URLs fixed to `v1.0.1`.

---

## Final Acceptance Matrix

| Scenario | Required result |
|---|---|
| Main View dragged outside | New native window follows/lands at the pointer |
| Detached View dropped on a tab strip | Inserts at the indicated index |
| Detached group dropped in group center | Combines without duplicate Views |
| Detached View dropped on group edge | Creates the indicated row/column split |
| Detached View dropped on Sidebar/Panel | Moves to the exact target Part/container |
| Detached group dropped on another detached window | Combines or splits according to target overlay |
| Escape or invalid drop | Exact source layout and window remain |
| Window creation/IPC failure | Exact source remains; incomplete window is closed |
| Source/target closes during drag | Session cancels without lost ownership |
| Restart after successful docking | Last committed target and window layout restore |
| Mixed DPI/negative monitor origin | Overlay and drop resolve under the pointer |
| Dirty editor present | Content, undo history, active pane, and Hot Exit remain unchanged |
| Menu and redock button | Continue to provide accessible fallback behavior |

## Execution Order

Tasks are intentionally sequential. Task 1 is a hard feasibility gate. Tasks 2-4 establish a testable single-window foundation. Tasks 5-7 add native ownership and persistence. Task 8 replaces the misleading release gate. Task 9 is permitted only after every previous gate is green.
